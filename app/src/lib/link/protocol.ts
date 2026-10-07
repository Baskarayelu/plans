/**
 * "Link this browser" protocol v1 (docs/crypto.md §9). Pure functions: no React Native imports,
 * no network, no clock unless one is passed (defaults to Date.now()).
 *
 *   code      12 Crockford base32 chars (60 random bits), shown XXXX-XXXX-XXXX
 *   s         = HKDF(ikm = UTF-8(code), salt = UTF-8("plans/v1/link"), info = "plans/v1/link-secret", 32)
 *   offerSlot = hex(SHA-256(UTF-8("plans/v1/link-offer|") ‖ s))
 *   replySlot = hex(SHA-256(UTF-8("plans/v1/link-reply|") ‖ s))
 *   offer     = 0x01 ‖ nonce(24) ‖ XChaCha20-Poly1305(HKDF(s, "", "plans/v1/link-offer"), nonce,
 *               {"v":1,"k":b64u(linkPub),"e":exp,"d":label}, aad = "plans/v1/link-offer")
 *   QR        https://<host>/app/link#c=<code>&k=<b64u linkPub>&e=<exp>
 *   fp        = EMOJI[d0..d2], d = SHA-256("plans/v1/link-fp" ‖ s ‖ linkPub)
 *   reply     = seal(linkPub, bundle JSON, context = "link|" + hex(s) + "|" + exp)
 *   vault     = 0x01 ‖ nonce(24) ‖ XChaCha20-Poly1305(HKDF(b2, "", "plans/v1/vault"), nonce,
 *               bundle JSON (t → linkedAt), aad = "plans/v1/vault|" + vaultId)
 *   vaultId   = hex(SHA-256(credential id bytes)); vaultAuth = HKDF(b2, "", "plans/v1/vault-auth")
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { getAddress } from "viem";
import { concatBytes, fromBase64Url, fromHex, fromUtf8, randomBytes, toBase64Url, toHex, utf8, wipe } from "../crypto/bytes";
import { emojiFromDigest } from "../crypto/fingerprint";
import { deriveAccountPrivateKey, deriveKeys } from "../crypto/keys";
import { open, seal } from "../crypto/seal";

// ─────────────── constants ───────────────

export const LINK_VERSION = 1;
/** Link lifetime: the browser's one-time key, the offer and the reply live 10 minutes. */
export const LINK_TTL_SEC = 600;
/** Reply `t` must be within [now - LINK_TTL_SEC - 60, now + 60] on the browser. */
export const LINK_CLOCK_SKEW_SEC = 60;
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LINK_CODE_LENGTH = 12;
export const BOX_VERSION = 0x01;

const SALT_LINK = "plans/v1/link";
const INFO_LINK_SECRET = "plans/v1/link-secret";
const INFO_LINK_OFFER = "plans/v1/link-offer";
const AAD_LINK_OFFER = "plans/v1/link-offer";
const PREFIX_OFFER_SLOT = "plans/v1/link-offer|";
const PREFIX_REPLY_SLOT = "plans/v1/link-reply|";
const PREFIX_LINK_FP = "plans/v1/link-fp";
const INFO_VAULT = "plans/v1/vault";
const INFO_VAULT_AUTH = "plans/v1/vault-auth";
const AAD_VAULT = "plans/v1/vault|";

// ─────────────── errors ───────────────

/**
 * expired       link past its 10 minutes, or a reply whose time is outside the window
 * bad-code      the typed code or scanned QR isn't a Plans link
 * tampered      a box failed to decrypt/authenticate or decoded to something malformed
 * wrong-account the bundle's key doesn't give the address / fingerprint it claims, or the
 *               passkey used doesn't belong to the account on this device
 * not-found     no offer for that code (wrong code, or it expired) / no vault for this passkey
 * used          the link was already answered (its reply slot is taken)
 */
export type LinkErrorKind = "expired" | "bad-code" | "tampered" | "wrong-account" | "not-found" | "used";

export class LinkError extends Error {
  constructor(
    public kind: LinkErrorKind,
    public detail = "",
  ) {
    super(kind);
    this.name = "LinkError";
  }
}

export const isLinkError = (e: unknown): e is LinkError => e instanceof LinkError;

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

const hex = (b: Uint8Array) => toHex(b).slice(2);

// ─────────────── code ───────────────

/** 12 Crockford base32 characters from 60 random bits (unformatted). */
export function newLinkCode(rand: (n: number) => Uint8Array = randomBytes): string {
  const r = rand(8); // 64 bits, the first 60 are used
  let out = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i++) {
    let v = 0;
    for (let j = 0; j < 5; j++) {
      const bit = i * 5 + j;
      v = (v << 1) | ((r[bit >> 3] >> (7 - (bit & 7))) & 1);
    }
    out += CROCKFORD[v];
  }
  wipe(r);
  return out;
}

/** Uppercase, drop spaces and dashes, I/L → 1, O → 0; U and anything else outside the alphabet is invalid. */
export function normaliseCode(input: string): string {
  const c = input.toUpperCase().replace(/[\s\-‐-―]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (c.length !== LINK_CODE_LENGTH) throw new LinkError("bad-code", `expected ${LINK_CODE_LENGTH} characters`);
  for (const ch of c) if (!CROCKFORD.includes(ch)) throw new LinkError("bad-code", `invalid character ${ch}`);
  return c;
}

/** "XXXX-XXXX-XXXX". */
export function formatCode(code: string): string {
  const c = normaliseCode(code);
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}

/** s = HKDF-SHA256(ikm = UTF-8(normalised code), salt = UTF-8("plans/v1/link"), info = "plans/v1/link-secret", 32). */
export function linkSecretFromCode(code: string): Uint8Array {
  return hkdf(sha256, utf8(normaliseCode(code)), utf8(SALT_LINK), utf8(INFO_LINK_SECRET), 32);
}

/** Slot ids (64 lowercase hex) for the offer and the reply. */
export function slotIds(s: Uint8Array): { offer: string; reply: string } {
  if (s.length !== 32) throw new Error("link secret must be 32 bytes");
  return {
    offer: hex(sha256(concatBytes(utf8(PREFIX_OFFER_SLOT), s))),
    reply: hex(sha256(concatBytes(utf8(PREFIX_REPLY_SLOT), s))),
  };
}

// ─────────────── offer (typed-code path) ───────────────

export type LinkOfferContent = { linkPub: Uint8Array; exp: number; deviceLabel?: string };

function offerKey(s: Uint8Array): Uint8Array {
  return hkdf(sha256, s, undefined, utf8(INFO_LINK_OFFER), 32);
}

export function makeOffer(s: Uint8Array, linkPub: Uint8Array, exp: number, deviceLabel?: string, nonce: Uint8Array = randomBytes(24)): Uint8Array {
  if (linkPub.length !== 32) throw new Error("link key must be 32 bytes");
  const pt = utf8(JSON.stringify({ v: LINK_VERSION, k: toBase64Url(linkPub), e: exp, d: deviceLabel ? deviceLabel.slice(0, 60) : undefined }));
  const key = offerKey(s);
  try {
    return concatBytes(new Uint8Array([BOX_VERSION]), nonce, xchacha20poly1305(key, nonce, utf8(AAD_LINK_OFFER)).encrypt(pt));
  } finally {
    wipe(key);
  }
}

export function openOffer(s: Uint8Array, box: Uint8Array, now = nowSec()): LinkOfferContent {
  if (box.length < 1 + 24 + 16 || box[0] !== BOX_VERSION) throw new LinkError("tampered", "not an offer box");
  const key = offerKey(s);
  let pt: Uint8Array;
  try {
    pt = xchacha20poly1305(key, box.slice(1, 25), utf8(AAD_LINK_OFFER)).decrypt(box.slice(25));
  } catch {
    throw new LinkError("tampered", "offer did not decrypt");
  } finally {
    wipe(key);
  }
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(fromUtf8(pt, true)) as Record<string, unknown>;
  } catch {
    throw new LinkError("tampered", "offer is not JSON");
  }
  if (o.v !== LINK_VERSION || typeof o.k !== "string" || typeof o.e !== "number" || !Number.isInteger(o.e)) throw new LinkError("tampered", "offer fields");
  const linkPub = decodeKey(o.k);
  if (now > o.e) throw new LinkError("expired", "offer expired");
  return { linkPub, exp: o.e, deviceLabel: typeof o.d === "string" ? o.d : undefined };
}

function decodeKey(b64: string): Uint8Array {
  let k: Uint8Array;
  try {
    k = fromBase64Url(b64);
  } catch {
    throw new LinkError("bad-code", "key is not base64url");
  }
  if (k.length !== 32) throw new LinkError("bad-code", "key must be 32 bytes");
  return k;
}

// ─────────────── QR ───────────────

/** https://<host>/app/link#c=<code>&k=<b64u linkPub>&e=<exp>. The secret stays in the fragment. */
export function linkQrUrl(code: string, linkPub: Uint8Array, exp: number, host: string): string {
  return `https://${host}/app/link#c=${normaliseCode(code)}&k=${toBase64Url(linkPub)}&e=${exp}`;
}

/** Parses a link QR. `host`, when given, must match. Throws LinkError("bad-code"). */
export function parseLinkQr(text: string, opts: { host?: string } = {}): { code: string; linkPub: Uint8Array; exp: number } {
  const m = /^https:\/\/([^/?#]+)\/app\/link\/?(?:\?[^#]*)?#(.+)$/i.exec(text.trim());
  if (!m) throw new LinkError("bad-code", "not a link address");
  if (opts.host && m[1].toLowerCase() !== opts.host.toLowerCase()) throw new LinkError("bad-code", "wrong host");
  const params = new Map<string, string>();
  for (const part of m[2].split("&")) {
    const i = part.indexOf("=");
    if (i > 0) params.set(part.slice(0, i), decodeURIComponent(part.slice(i + 1)));
  }
  const c = params.get("c");
  const k = params.get("k");
  const e = params.get("e");
  if (!c || !k || !e || !/^\d{1,12}$/.test(e)) throw new LinkError("bad-code", "missing fields");
  return { code: normaliseCode(c), linkPub: decodeKey(k), exp: Number(e) };
}

// ─────────────── fingerprint ───────────────

/** Three emoji both screens show before the account is sent: d = SHA-256("plans/v1/link-fp" ‖ s ‖ linkPub). */
export function linkFingerprint(s: Uint8Array, linkPub: Uint8Array): string {
  return emojiFromDigest(sha256(concatBytes(utf8(PREFIX_LINK_FP), s, linkPub)));
}

// ─────────────── account bundle ───────────────

export type LinkProfile = { name: string; country: string; currency: string; city?: string };

export type AccountBundle = {
  /** The account's secp256k1 private key (32 bytes) = deriveAccountPrivateKey(PRF first). */
  accountKey: Uint8Array;
  /** The keys-namespace PRF output (32 bytes), the IKM of deriveKeys. */
  keysIkm: Uint8Array;
  /** Checksummed address of accountKey. */
  address: `0x${string}`;
  /** deriveKeys(keysIkm).fingerprint. */
  fingerprint: string;
  profile?: LinkProfile;
  /** Unix seconds: when the phone sent it (reply `t`) or when the browser was linked (vault `linkedAt`). */
  t: number;
};

/** Checksummed EVM address of a secp256k1 private key. */
export function accountAddress(privateKey: Uint8Array): `0x${string}` {
  if (privateKey.length !== 32) throw new Error("private key must be 32 bytes");
  const pub = secp256k1.getPublicKey(privateKey, false);
  return getAddress(toHex(keccak_256(pub.slice(1)).slice(12)));
}

/** The phone's bundle from fresh PRF outputs. Copies; the caller wipes its inputs and, later, the bundle. */
export function bundleFromPrf(prfFirst: Uint8Array, prfSecond: Uint8Array, profile: LinkProfile | undefined, t = nowSec()): AccountBundle {
  const accountKey = deriveAccountPrivateKey(prfFirst);
  const keys = deriveKeys(prfSecond);
  wipe(keys.x25519Secret, keys.cacheKey);
  return { accountKey, keysIkm: new Uint8Array(prfSecond), address: accountAddress(accountKey), fingerprint: keys.fingerprint, profile, t };
}

export function wipeBundle(b: AccountBundle | null | undefined): void {
  if (b) wipe(b.accountKey, b.keysIkm);
}

type TimeField = "t" | "linkedAt";

/** {"v":1,"a":hex,"k":hex,"addr","fp","p"?,"t"} (or "linkedAt" in the vault). Caller wipes the result. */
export function encodeBundle(b: AccountBundle, timeField: TimeField = "t"): Uint8Array {
  const p = b.profile ? { name: b.profile.name, country: b.profile.country, currency: b.profile.currency, city: b.profile.city } : undefined;
  return utf8(JSON.stringify({ v: LINK_VERSION, a: hex(b.accountKey), k: hex(b.keysIkm), addr: b.address, fp: b.fingerprint, p, [timeField]: b.t }));
}

function decodeProfile(p: unknown): LinkProfile | undefined {
  if (!p || typeof p !== "object") return undefined;
  const o = p as Record<string, unknown>;
  if (typeof o.name !== "string" || typeof o.country !== "string" || typeof o.currency !== "string") return undefined;
  return { name: o.name.slice(0, 60), country: o.country.slice(0, 8), currency: o.currency.slice(0, 8), city: typeof o.city === "string" ? o.city.slice(0, 60) : undefined };
}

export function decodeBundle(bytes: Uint8Array, timeField: TimeField = "t"): AccountBundle {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(fromUtf8(bytes, true)) as Record<string, unknown>;
  } catch {
    throw new LinkError("tampered", "bundle is not JSON");
  }
  const t = o[timeField];
  if (
    o.v !== LINK_VERSION ||
    typeof o.a !== "string" ||
    !/^[0-9a-f]{64}$/i.test(o.a) ||
    typeof o.k !== "string" ||
    !/^[0-9a-f]{64}$/i.test(o.k) ||
    typeof o.addr !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(o.addr) ||
    typeof o.fp !== "string" ||
    typeof t !== "number" ||
    !Number.isFinite(t)
  ) {
    throw new LinkError("tampered", "bundle fields");
  }
  return { accountKey: fromHex(o.a), keysIkm: fromHex(o.k), address: o.addr as `0x${string}`, fingerprint: o.fp, profile: decodeProfile(o.p), t };
}

/**
 * Checks a bundle: with `exp`, the link must not have expired; with `now`, `t` must be within
 * [now - 660, now + 60]; always, address(a) = addr and fingerprint(deriveKeys(k)) = fp.
 */
export function verifyBundle(b: AccountBundle, o: { now?: number; exp?: number; checkTime?: boolean } = {}): void {
  const now = o.now ?? nowSec();
  if (o.exp !== undefined && now > o.exp) throw new LinkError("expired", "link expired");
  if (o.checkTime !== false && o.exp !== undefined) {
    if (b.t < now - LINK_TTL_SEC - LINK_CLOCK_SKEW_SEC || b.t > now + LINK_CLOCK_SKEW_SEC) throw new LinkError("expired", "reply time outside the window");
  }
  if (b.accountKey.length !== 32 || b.keysIkm.length !== 32) throw new LinkError("tampered", "key lengths");
  let addr: string;
  try {
    addr = accountAddress(b.accountKey);
  } catch {
    throw new LinkError("wrong-account", "invalid account key");
  }
  if (addr.toLowerCase() !== b.address.toLowerCase()) throw new LinkError("wrong-account", "address does not match the key");
  const keys = deriveKeys(b.keysIkm);
  wipe(keys.x25519Secret, keys.cacheKey);
  if (keys.fingerprint !== b.fingerprint) throw new LinkError("wrong-account", "fingerprint does not match the keys");
}

// ─────────────── reply ───────────────

/** Sealed-box context binding the reply to this link: "link|" + hex(s) + "|" + exp. */
export function replyContext(s: Uint8Array, exp: number): string {
  return `link|${hex(s)}|${exp}`;
}

export function sealReply(linkPub: Uint8Array, s: Uint8Array, exp: number, bundle: AccountBundle): Uint8Array {
  const pt = encodeBundle(bundle, "t");
  try {
    return seal(linkPub, pt, replyContext(s, exp));
  } finally {
    wipe(pt);
  }
}

/** Opens and verifies the phone's reply. Throws LinkError expired / tampered / wrong-account. */
export function openReply(linkSecret: Uint8Array, s: Uint8Array, exp: number, sealed: Uint8Array, now = nowSec()): AccountBundle {
  if (now > exp) throw new LinkError("expired", "link expired");
  let pt: Uint8Array;
  try {
    pt = open(linkSecret, sealed, replyContext(s, exp));
  } catch {
    throw new LinkError("tampered", "reply did not open");
  }
  let b: AccountBundle;
  try {
    b = decodeBundle(pt, "t");
  } finally {
    wipe(pt);
  }
  try {
    verifyBundle(b, { now, exp });
  } catch (e) {
    wipeBundle(b);
    throw e;
  }
  return b;
}

// ─────────────── vault ───────────────

/** vaultKey = HKDF(b2, "", "plans/v1/vault", 32); vaultAuth = HKDF(b2, "", "plans/v1/vault-auth", 32). */
export function vaultKeys(b2: Uint8Array): { key: Uint8Array; auth: Uint8Array } {
  if (b2.length !== 32) throw new Error("PRF output must be 32 bytes");
  return { key: hkdf(sha256, b2, undefined, utf8(INFO_VAULT), 32), auth: hkdf(sha256, b2, undefined, utf8(INFO_VAULT_AUTH), 32) };
}

/** hex(SHA-256(raw credential id bytes)). */
export function vaultId(credentialIdBytes: Uint8Array): string {
  if (credentialIdBytes.length === 0) throw new Error("empty credential id");
  return hex(sha256(credentialIdBytes));
}

/** Encrypts the bundle (its `t` as linkedAt) for this browser's passkey. Returns the slot id, the box and hex(vaultAuth). */
export function sealVault(b2: Uint8Array, credentialIdBytes: Uint8Array, bundle: AccountBundle, nonce: Uint8Array = randomBytes(24)): { id: string; box: Uint8Array; auth: string } {
  const id = vaultId(credentialIdBytes);
  const { key, auth } = vaultKeys(b2);
  const pt = encodeBundle(bundle, "linkedAt");
  try {
    const box = concatBytes(new Uint8Array([BOX_VERSION]), nonce, xchacha20poly1305(key, nonce, utf8(AAD_VAULT + id)).encrypt(pt));
    return { id, box, auth: hex(auth) };
  } finally {
    wipe(key, auth, pt);
  }
}

/** Decrypts and checks a vault box. Throws LinkError tampered / wrong-account. */
export function openVault(b2: Uint8Array, credentialIdBytes: Uint8Array, box: Uint8Array): AccountBundle {
  if (box.length < 1 + 24 + 16 || box[0] !== BOX_VERSION) throw new LinkError("tampered", "not a vault box");
  const id = vaultId(credentialIdBytes);
  const { key, auth } = vaultKeys(b2);
  wipe(auth);
  let pt: Uint8Array;
  try {
    pt = xchacha20poly1305(key, box.slice(1, 25), utf8(AAD_VAULT + id)).decrypt(box.slice(25));
  } catch {
    throw new LinkError("tampered", "vault did not decrypt");
  } finally {
    wipe(key);
  }
  let b: AccountBundle;
  try {
    b = decodeBundle(pt, "linkedAt");
  } finally {
    wipe(pt);
  }
  try {
    verifyBundle(b, { checkTime: false });
  } catch (e) {
    wipeBundle(b);
    throw e;
  }
  return b;
}
