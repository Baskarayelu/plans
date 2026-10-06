import { xchacha20, xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, fromUtf8, randomBytes, utf8 } from "./bytes";

/**
 * Plans encryption formats. Exact construction in docs/crypto.md.
 *
 * Sealed box (to an X25519 public key):
 *   0x01 || ephPub(32) || nonce(24) || XChaCha20-Poly1305(key, nonce, plaintext, aad)
 *   key = HKDF-SHA256(ikm = X25519(ephSecret, recipientPub), salt = ephPub || recipientPub,
 *                     info = "plans/v1/seal", 32)
 *   aad = utf8("plans/v1/seal|" + context)
 *
 * Group box (with a 32-byte group key):
 *   0x01 || nonce(24) || XChaCha20-Poly1305(groupKey, nonce, plaintext, aad = utf8("plans/v1/" + kind + "|" + pot))
 */
export const SEAL_VERSION = 0x01;
export const GROUP_BOX_VERSION = 0x01;

const SEAL_INFO = utf8("plans/v1/seal");

function sealKey(shared: Uint8Array, ephPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, concatBytes(ephPub, recipientPub), SEAL_INFO, 32);
}

export function seal(recipientPub: Uint8Array, plaintext: Uint8Array, context = "", ephSecret?: Uint8Array, nonce?: Uint8Array): Uint8Array {
  if (recipientPub.length !== 32) throw new Error("recipient key must be 32 bytes");
  const eph = ephSecret ?? x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(eph);
  const shared = x25519.getSharedSecret(eph, recipientPub);
  const key = sealKey(shared, ephPub, recipientPub);
  const n = nonce ?? randomBytes(24);
  const ct = xchacha20poly1305(key, n, utf8(`plans/v1/seal|${context}`)).encrypt(plaintext);
  shared.fill(0);
  key.fill(0);
  if (!ephSecret) eph.fill(0);
  return concatBytes(new Uint8Array([SEAL_VERSION]), ephPub, n, ct);
}

export function open(recipientSecret: Uint8Array, sealed: Uint8Array, context = ""): Uint8Array {
  if (sealed.length < 1 + 32 + 24 + 16 || sealed[0] !== SEAL_VERSION) throw new Error("not a sealed box");
  const ephPub = sealed.slice(1, 33);
  const n = sealed.slice(33, 57);
  const ct = sealed.slice(57);
  const recipientPub = x25519.getPublicKey(recipientSecret);
  const shared = x25519.getSharedSecret(recipientSecret, ephPub);
  const key = sealKey(shared, ephPub, recipientPub);
  try {
    return xchacha20poly1305(key, n, utf8(`plans/v1/seal|${context}`)).decrypt(ct);
  } finally {
    shared.fill(0);
    key.fill(0);
  }
}

/** Content kinds bound into the group box AAD. */
export type GroupBoxKind = "meta" | "memo" | "profile" | "receipt" | "dispute" | "note";

function groupAad(kind: GroupBoxKind, pot: string): Uint8Array {
  return utf8(`plans/v1/${kind}|${pot.toLowerCase()}`);
}

export function groupEncrypt(groupKey: Uint8Array, kind: GroupBoxKind, pot: string, plaintext: Uint8Array, nonce?: Uint8Array): Uint8Array {
  if (groupKey.length !== 32) throw new Error("group key must be 32 bytes");
  const n = nonce ?? randomBytes(24);
  const ct = xchacha20poly1305(groupKey, n, groupAad(kind, pot)).encrypt(plaintext);
  return concatBytes(new Uint8Array([GROUP_BOX_VERSION]), n, ct);
}

export function groupDecrypt(groupKey: Uint8Array, kind: GroupBoxKind, pot: string, box: Uint8Array): Uint8Array {
  if (box.length < 1 + 24 + 16 || box[0] !== GROUP_BOX_VERSION) throw new Error("not a group box");
  return xchacha20poly1305(groupKey, box.slice(1, 25), groupAad(kind, pot)).decrypt(box.slice(25));
}

export function newGroupKey(): Uint8Array {
  return randomBytes(32);
}

// ─────────────── key-wrap entries posted with postKeyWraps / createPot ───────────────

/** A KeyWrapped event's `wrap` bytes start with a type byte. */
export const WRAP_GROUP_KEY = 0x01; // the sealed box itself (its version byte doubles as the type)
export const WRAP_PROFILE = 0x50; // 'P': 0x50 || groupBox(profile JSON); posted by a member for themself

export function wrapGroupKey(memberPub: Uint8Array, groupKey: Uint8Array, pot: string): Uint8Array {
  return seal(memberPub, groupKey, `groupkey|${pot.toLowerCase()}`);
}

export function unwrapGroupKey(secret: Uint8Array, wrap: Uint8Array, pot: string): Uint8Array {
  return open(secret, wrap, `groupkey|${pot.toLowerCase()}`);
}

export type Profile = { name: string; city?: string; country?: string; currency?: string };

export function encodeProfileWrap(groupKey: Uint8Array, pot: string, p: Profile): Uint8Array {
  const json = JSON.stringify({ v: 1, n: p.name.slice(0, 40), c: p.city?.slice(0, 40), cc: p.country, cur: p.currency });
  return concatBytes(new Uint8Array([WRAP_PROFILE]), groupEncrypt(groupKey, "profile", pot, utf8(json)));
}

export function decodeProfileWrap(groupKey: Uint8Array, pot: string, wrap: Uint8Array): Profile | null {
  if (wrap[0] !== WRAP_PROFILE) return null;
  try {
    const o = JSON.parse(fromUtf8(groupDecrypt(groupKey, "profile", pot, wrap.slice(1)))) as Record<string, unknown>;
    if (typeof o.n !== "string") return null;
    return {
      name: o.n,
      city: typeof o.c === "string" ? o.c : undefined,
      country: typeof o.cc === "string" ? o.cc : undefined,
      currency: typeof o.cur === "string" ? o.cur : undefined,
    };
  } catch {
    return null;
  }
}

// ─────────────── plan meta ───────────────

export type PlanMeta = { name: string; emoji: string; color: string; demo?: boolean; ends?: number };

/** Meta bytes: 0x00 || plaintext JSON (relayer demo default), or 0x01 || groupBox(JSON). */
export function encodeMeta(groupKey: Uint8Array, pot: string, m: PlanMeta): Uint8Array {
  const json = JSON.stringify({ v: 1, name: m.name.slice(0, 60), emoji: m.emoji, color: m.color, demo: m.demo || undefined });
  return groupEncrypt(groupKey, "meta", pot, utf8(json));
}

export function decodeMeta(meta: Uint8Array, pot: string, groupKey?: Uint8Array): PlanMeta | null {
  try {
    let raw: Uint8Array;
    if (meta.length === 0) return null;
    if (meta[0] === 0x00) raw = meta.slice(1);
    else if (groupKey) raw = groupDecrypt(groupKey, "meta", pot, meta);
    else return null;
    const o = JSON.parse(fromUtf8(raw)) as Record<string, unknown>;
    if (typeof o.name !== "string") return null;
    return {
      name: o.name,
      emoji: typeof o.emoji === "string" ? o.emoji : "🎟️",
      color: typeof o.color === "string" ? o.color : "#2FA6B8",
      demo: o.demo === true,
    };
  } catch {
    return null;
  }
}

// ─────────────── memos (spend notes, dispute notes) ───────────────

export type Memo = { text: string; reason?: string; photo?: string /* receiptHash hex */ };

export function encodeMemo(groupKey: Uint8Array, pot: string, kind: "memo" | "dispute", m: Memo): Uint8Array {
  if (!m.text && !m.reason) return new Uint8Array();
  const json = JSON.stringify({ v: 1, t: m.text.slice(0, 280), r: m.reason });
  const box = groupEncrypt(groupKey, kind, pot, utf8(json));
  if (box.length > 512) throw new Error("note too long");
  return box;
}

export function decodeMemo(groupKey: Uint8Array | undefined, pot: string, kind: "memo" | "dispute", box: Uint8Array): Memo | null {
  if (box.length === 0) return null;
  if (box[0] === 0x00) {
    return { text: fromUtf8(box.slice(1)) };
  }
  if (!groupKey) return null;
  try {
    const o = JSON.parse(fromUtf8(groupDecrypt(groupKey, kind, pot, box))) as Record<string, unknown>;
    return { text: typeof o.t === "string" ? o.t : "", reason: typeof o.r === "string" ? o.r : undefined };
  } catch {
    return null;
  }
}

// ─────────────── send note carried in PlansSend.SendMeta.salt ───────────────

/**
 * The 32-byte SendMeta.salt carries a short note from sender to receiver:
 *   salt = r(7) || (pt(25) XOR XChaCha20(key, nonce = r || 0^17))
 *   pt   = 0x01 || utf8(name + "\x1f" + city + "\x1f" + note), cut to 24 bytes on a character
 *          boundary and zero padded
 *   key  = HKDF-SHA256(X25519(mySecret, theirPub), salt = empty,
 *                      info = "plans/v1/send-note|" + from + "|" + to (lowercase hex), 32)
 * Both sides compute the same X25519 secret from their KeyRegistry keys. No tag: the note is a
 * courtesy label, and the salt is already bound to the sender's signature through the 3009 nonce.
 * With no recipient key the salt is 32 random bytes.
 */
export type SendNote = { name: string; city?: string; note?: string };

function sendNoteKey(mySecret: Uint8Array, theirPub: Uint8Array, from: string, to: string): Uint8Array {
  const shared = x25519.getSharedSecret(mySecret, theirPub);
  const key = hkdf(sha256, shared, undefined, utf8(`plans/v1/send-note|${from.toLowerCase()}|${to.toLowerCase()}`), 32);
  shared.fill(0);
  return key;
}

function cutUtf8(s: string, max: number): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const b = utf8(ch);
    if (out.length + b.length > max) break;
    out.push(...b);
  }
  return new Uint8Array(out);
}

export function encodeSendNote(
  mySecret: Uint8Array,
  theirPub: Uint8Array,
  from: string,
  to: string,
  n: SendNote,
  r: Uint8Array = randomBytes(7),
): Uint8Array {
  const text = [n.name, n.city ?? "", n.note ?? ""].join("\x1f").replace(/\x1f+$/, "");
  const pt = new Uint8Array(25);
  pt[0] = 0x01;
  pt.set(cutUtf8(text, 24), 1);
  const key = sendNoteKey(mySecret, theirPub, from, to);
  const nonce = new Uint8Array(24);
  nonce.set(r, 0);
  const ct = xchacha20(key, nonce, pt);
  key.fill(0);
  return concatBytes(r, ct);
}

export function decodeSendNote(mySecret: Uint8Array, theirPub: Uint8Array, from: string, to: string, salt: Uint8Array): SendNote | null {
  if (salt.length !== 32) return null;
  try {
    const r = salt.slice(0, 7);
    const key = sendNoteKey(mySecret, theirPub, from, to);
    const nonce = new Uint8Array(24);
    nonce.set(r, 0);
    const pt = xchacha20(key, nonce, salt.slice(7));
    key.fill(0);
    if (pt[0] !== 0x01) return null;
    let end = pt.length;
    while (end > 1 && pt[end - 1] === 0) end--;
    const text = fromUtf8(pt.slice(1, end), true);
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1e\x7f]/.test(text)) return null;
    const [name, city, note] = text.split("\x1f");
    if (!name) return null;
    return { name, city: city || undefined, note: note || undefined };
  } catch {
    return null;
  }
}
