/**
 * Phone side of "Link this browser" (docs/crypto.md §9). No UI here.
 *
 *   const offer = readLinkFromQr(scannedText)      // or: await fetchOfferByCode(typedCode)
 *   show offer.fingerprint (must match the browser's three emoji) and offer.deviceLabel
 *   await sendAccountToBrowser(offer)               // one fingerprint prompt, then sent
 *
 * The account key is taken from a FRESH passkey ceremony at send time (the unlocked session
 * wipes its PRF outputs), pinned to this device's stored credential, and every buffer is wiped
 * after use. A device that is itself a linked browser (vault account) sends the account from its
 * vault instead.
 */
import { config } from "../../config";
import { equalBytes, fromBase64Url, wipe } from "../crypto/bytes";
import { classifyPasskeyError, freshPrfOutputs, PasskeyError } from "../identity/session";
import { storage, type Profile } from "../state/storage";
import { fetchVaultBox } from "./browserLink";
import { isRemovedVault } from "./devices";
import {
  bundleFromPrf,
  LINK_CLOCK_SKEW_SEC,
  LINK_TTL_SEC,
  LinkError,
  linkFingerprint,
  linkSecretFromCode,
  normaliseCode,
  nowSec,
  openOffer,
  openVault,
  parseLinkQr,
  sealReply,
  slotIds,
  wipeBundle,
  type AccountBundle,
} from "./protocol";
import { getSlot, putSlot, SlotError } from "./slots";

export type PhoneLinkOffer = {
  /** Link secret s (32 bytes). Wiped by sendAccountToBrowser on success. */
  s: Uint8Array;
  linkPub: Uint8Array;
  /** Unix seconds (the browser's clock). */
  exp: number;
  /** Three emoji to compare with the browser's. */
  fingerprint: string;
  /** From the typed-code offer (e.g. "Safari on Mac"); absent for a QR. */
  deviceLabel?: string;
};

/** A link counts as expired on the phone only after exp + 60 s, to allow for clock differences. */
function checkNotExpired(exp: number, now = nowSec()): void {
  if (now > exp + LINK_CLOCK_SKEW_SEC) throw new LinkError("expired", "link expired");
}

/** Reads a scanned QR (https://plans.0xo.in/app/link#c=…&k=…&e=…). Throws LinkError bad-code / expired. */
export function readLinkFromQr(text: string, now = nowSec()): PhoneLinkOffer {
  const q = parseLinkQr(text, { host: config.linkHost });
  checkNotExpired(q.exp, now);
  const s = linkSecretFromCode(q.code);
  return { s, linkPub: q.linkPub, exp: q.exp, fingerprint: linkFingerprint(s, q.linkPub) };
}

/**
 * Looks up the browser's offer for a typed code. Throws LinkError bad-code (malformed code),
 * not-found (no such code, or it expired), tampered, expired; SlotError on network trouble.
 */
export async function fetchOfferByCode(code: string, now = nowSec()): Promise<PhoneLinkOffer> {
  const s = linkSecretFromCode(normaliseCode(code));
  const box = await getSlot(slotIds(s).offer);
  if (!box) {
    wipe(s);
    throw new LinkError("not-found", "no offer for that code");
  }
  try {
    const o = openOffer(s, box, now - LINK_CLOCK_SKEW_SEC);
    return { s, linkPub: o.linkPub, exp: o.exp, fingerprint: linkFingerprint(s, o.linkPub), deviceLabel: o.deviceLabel };
  } catch (e) {
    wipe(s);
    throw e;
  }
}

/**
 * A scanned QR carries no device label. The browser also uploaded its offer (for the typed-code
 * path), which has one: read it, and use it only if it opens with this link's secret and names the
 * same one-time key. Best effort: undefined on any problem. The label stays a hint (design 173).
 */
export async function labelForQrOffer(offer: PhoneLinkOffer, now = nowSec()): Promise<string | undefined> {
  try {
    const box = await getSlot(slotIds(offer.s).offer);
    if (!box) return undefined;
    const o = openOffer(offer.s, box, now - LINK_CLOCK_SKEW_SEC);
    return equalBytes(o.linkPub, offer.linkPub) && o.exp === offer.exp ? o.deviceLabel : undefined;
  } catch {
    return undefined;
  }
}

/** The account bundle from a fresh ceremony (or this device's vault), checked against the stored account. */
async function freshBundle(profile: Profile | undefined): Promise<AccountBundle> {
  const stored = await storage.loadAccount();
  if (!stored) throw new PasskeyError("no-credentials", "no account on this device");
  let bundle: AccountBundle;
  if (stored.vault) {
    const credIdBytes = fromBase64Url(stored.credentialId);
    let box: Uint8Array | null;
    try {
      box = await fetchVaultBox(credIdBytes);
    } catch (e) {
      throw e instanceof SlotError ? e : classifyPasskeyError(e);
    }
    if (!box || isRemovedVault(box)) throw new LinkError("not-found", "this browser's linked account is no longer stored");
    const out = await freshPrfOutputs(stored.credentialId);
    wipe(out.first);
    try {
      bundle = openVault(out.second, credIdBytes, box);
    } finally {
      wipe(out.second);
    }
    bundle.t = nowSec();
    bundle.profile = profile ?? stored.profile ?? bundle.profile;
  } else {
    const out = await freshPrfOutputs(stored.credentialId);
    try {
      bundle = bundleFromPrf(out.first, out.second, profile ?? stored.profile);
    } finally {
      wipe(out.first, out.second);
    }
  }
  if (bundle.address.toLowerCase() !== stored.address.toLowerCase()) {
    wipeBundle(bundle);
    throw new LinkError("wrong-account", "this passkey belongs to a different account than the one on this device");
  }
  return bundle;
}

/**
 * Sends this device's account to the browser: fresh pinned ceremony → bundle → sealed to the
 * browser's one-time key with context "link|hex(s)|exp" → PUT to the reply slot (write-once,
 * TTL ≤ 600 s). Throws PasskeyError (classified), LinkError ("expired", "used",
 * "wrong-account", "not-found") or SlotError (network).
 */
export async function sendAccountToBrowser(offer: PhoneLinkOffer, profile?: Profile): Promise<{ address: `0x${string}`; fingerprint: string }> {
  checkNotExpired(offer.exp);
  const bundle = await freshBundle(profile);
  try {
    checkNotExpired(offer.exp); // the prompt may have taken a while
    const sealed = sealReply(offer.linkPub, offer.s, offer.exp, bundle);
    const ttl = Math.max(60, Math.min(LINK_TTL_SEC, offer.exp - nowSec() + LINK_CLOCK_SKEW_SEC));
    try {
      await putSlot(slotIds(offer.s).reply, sealed, { ttl });
    } catch (e) {
      if (e instanceof SlotError && e.kind === "taken") throw new LinkError("used", "this link was already answered");
      throw e;
    }
    wipe(offer.s);
    return { address: bundle.address, fingerprint: bundle.fingerprint };
  } finally {
    wipeBundle(bundle);
  }
}
