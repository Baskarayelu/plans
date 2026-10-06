/**
 * Group keys, plan meta, member profiles and contacts.
 *
 * A plan's group key reaches a member through (in order):
 *   1. memory / the encrypted cache,
 *   2. a KeyWrapped entry sealed to the member's X25519 key (createPot's creatorKeyWrap, or a
 *      re-wrap any member posts after seeing MemberJoined),
 *   3. the invite key wrap, opened with the invite secret from the link (kept in the encrypted cache).
 * Member profiles are KeyWrapped entries a member posts for themself: 0x50 || groupBox(profile).
 */
import type { Address, Hex } from "viem";
import { fromHex, toHex } from "../crypto/bytes";
import { inviteKeyPair } from "../crypto/keys";
import { decodeMeta, decodeProfileWrap, unwrapGroupKey, WRAP_GROUP_KEY, WRAP_PROFILE, type PlanMeta, type Profile } from "../crypto/seal";
import { currentKeys, onSignOut } from "../identity/session";
import { cacheRead, cacheWrite } from "../state/cache";
import type { KeyWrapRow } from "../api/envio";

const memGroupKeys = new Map<string, Uint8Array>();
const lc = (a: string) => a.toLowerCase();

export function rememberGroupKey(pot: string, key: Uint8Array): void {
  memGroupKeys.set(lc(pot), key);
  const all = cacheRead<Record<string, string>>("groupkeys") ?? {};
  all[lc(pot)] = toHex(key);
  cacheWrite("groupkeys", all);
}

export function rememberInviteSecret(pot: string, secret: Uint8Array): void {
  const all = cacheRead<Record<string, string>>("invites") ?? {};
  all[lc(pot)] = toHex(secret);
  cacheWrite("invites", all);
}

export function inviteSecretFor(pot: string): Uint8Array | null {
  const all = cacheRead<Record<string, string>>("invites") ?? {};
  const h = all[lc(pot)];
  return h ? fromHex(h) : null;
}

/** Finds the plan's group key, or null when it isn't reachable yet (keys locked or no wrap yet). */
export function groupKeyFor(pot: string, opts: { me?: string; keyWraps?: KeyWrapRow[]; inviteKeyWrap?: string; inviteSecret?: Uint8Array | null }): Uint8Array | null {
  const p = lc(pot);
  const m = memGroupKeys.get(p);
  if (m) return m;
  const cached = (cacheRead<Record<string, string>>("groupkeys") ?? {})[p];
  if (cached) {
    const k = fromHex(cached);
    memGroupKeys.set(p, k);
    return k;
  }
  const keys = currentKeys();
  if (keys && opts.me && opts.keyWraps) {
    const mine = opts.keyWraps.filter((w) => lc(w.member_id) === lc(opts.me!) && w.wrap.startsWith("0x01"));
    for (const w of [...mine].reverse()) {
      try {
        const k = unwrapGroupKey(keys.x25519Secret, fromHex(w.wrap), p);
        rememberGroupKey(p, k);
        return k;
      } catch {
        /* sealed to an older key */
      }
    }
  }
  const secret = opts.inviteSecret ?? (keys ? inviteSecretFor(p) : null);
  if (secret && opts.inviteKeyWrap && opts.inviteKeyWrap.length > 4) {
    try {
      const k = unwrapGroupKey(inviteKeyPair(secret).secret, fromHex(opts.inviteKeyWrap), p);
      if (keys) rememberGroupKey(p, k);
      else memGroupKeys.set(p, k);
      return k;
    } catch {
      /* not for this secret */
    }
  }
  return null;
}

export function planMeta(pot: string, metaHex: string, gk: Uint8Array | null): PlanMeta | null {
  if (!metaHex || metaHex === "0x") return null;
  try {
    return decodeMeta(fromHex(metaHex), pot, gk ?? undefined);
  } catch {
    return null;
  }
}

/** Latest self-posted profile per member. */
export function profilesFrom(pot: string, wraps: KeyWrapRow[], gk: Uint8Array | null): Record<string, Profile> {
  const out: Record<string, Profile> = {};
  if (!gk) return out;
  for (const w of wraps) {
    if (lc(w.member_id) !== lc(w.by_id) || !w.wrap.startsWith(`0x${WRAP_PROFILE.toString(16)}`)) continue;
    const p = decodeProfileWrap(gk, pot, fromHex(w.wrap));
    if (p) out[lc(w.member_id)] = p;
  }
  return out;
}

/** Members who have a registered key but no group-key wrap in this plan yet. */
export function membersNeedingWrap(members: { address: string; status: string }[], wraps: KeyWrapRow[], keysByAccount: Record<string, string | null | undefined>): { member: Address; pubKey: Hex }[] {
  const has = new Set(wraps.filter((w) => w.wrap.startsWith(`0x0${WRAP_GROUP_KEY}`)).map((w) => lc(w.member_id)));
  const out: { member: Address; pubKey: Hex }[] = [];
  for (const m of members) {
    if (m.status !== "Active") continue;
    const k = keysByAccount[lc(m.address)];
    if (!k || /^0x0+$/.test(k) || has.has(lc(m.address))) continue;
    out.push({ member: m.address as Address, pubKey: k as Hex });
  }
  return out;
}

// ─────────────── contacts (names for addresses) ───────────────

export type Contact = { name: string; city?: string; country?: string; currency?: string; demo?: boolean; updatedAt: number };

/**
 * Contacts live in the encrypted cache, which is readable only while the keys are unlocked.
 * The in-memory copy is tied to the key set it was loaded with: while locked, nothing is loaded
 * or written (names learnt then are kept in `pendingContacts`), and on the first call after an
 * unlock the saved contacts are read and the pending ones merged in. A locked first call can
 * therefore never cache an empty list that later overwrites the saved contacts.
 */
let contactsMem: Record<string, Contact> | null = null;
let contactsKeys: object | null = null;
const pendingContacts: Record<string, Contact> = {};

export function contacts(): Record<string, Contact> {
  const keys = currentKeys();
  if (!keys) {
    contactsMem = null;
    contactsKeys = null;
    return { ...pendingContacts };
  }
  if (!contactsMem || contactsKeys !== keys) {
    const saved = cacheRead<Record<string, Contact>>("contacts") ?? {};
    const merged = { ...saved };
    let changed = false;
    for (const [a, c] of Object.entries(pendingContacts)) {
      if (!merged[a] || merged[a].updatedAt < c.updatedAt) {
        merged[a] = c;
        changed = true;
      }
      delete pendingContacts[a];
    }
    contactsMem = merged;
    contactsKeys = keys;
    if (changed) cacheWrite("contacts", merged);
  }
  return contactsMem;
}

export function rememberContact(address: string, c: Omit<Contact, "updatedAt">): void {
  const a = lc(address);
  const all = contacts();
  const prev = all[a];
  if (prev && prev.name === c.name && prev.city === c.city && prev.country === c.country && prev.currency === c.currency && prev.demo === c.demo) return;
  const next: Contact = { ...prev, ...c, updatedAt: Date.now() };
  if (!currentKeys()) {
    pendingContacts[a] = next;
    return;
  }
  contactsMem = { ...all, [a]: next };
  cacheWrite("contacts", contactsMem);
}

export function contactFor(address?: string | null): Contact | undefined {
  if (!address) return undefined;
  return contacts()[lc(address)];
}

/** Forget everything held in memory (sign out). Saved contacts stay in the encrypted cache. */
export function resetContactsMemory(): void {
  contactsMem = null;
  contactsKeys = null;
  for (const k of Object.keys(pendingContacts)) delete pendingContacts[k];
  memGroupKeys.clear();
}

onSignOut(resetContactsMemory);
