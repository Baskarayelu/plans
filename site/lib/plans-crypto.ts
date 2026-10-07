/**
 * The Plans decryption construction, copied from the app (app/src/lib/crypto/{bytes,keys,seal}.ts)
 * and specified in app/docs/crypto.md. Pure functions on @noble/*; nothing here touches the network,
 * storage or the console. Kept byte-for-byte compatible with the app; do not change one side alone.
 *
 *   inviteX25519Secret = HKDF-SHA256(ikm = inviteSecret, salt = "", info = "plans/v1/invite-x25519", 32)
 *   sealed  = 0x01 ‖ ephPub(32) ‖ nonce(24) ‖ XChaCha20-Poly1305(key, nonce, pt, aad = "plans/v1/seal|" + context)
 *             key = HKDF-SHA256(ikm = X25519(secret, ephPub), salt = ephPub ‖ recipientPub, info = "plans/v1/seal", 32)
 *             context for a group key = "groupkey|" + pot (lowercase hex)
 *   meta    = 0x00 ‖ JSON (plaintext demo plans) or 0x01 ‖ nonce(24) ‖ XChaCha20-Poly1305(groupKey, nonce, JSON, aad = "plans/v1/meta|" + pot)
 *   inviteSigner = Ethereum address of the invite secret used as a secp256k1 private key
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

// ─────────────── bytes ───────────────

const HEX = "0123456789abcdef";

export function toHex(bytes: Uint8Array): `0x${string}` {
  let s = "0x";
  for (const b of bytes) s += HEX[b >> 4] + HEX[b & 15];
  return s as `0x${string}`;
}

export function fromHex(hex: string): Uint8Array {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error("invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    s += B64U[a >> 2] + B64U[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) s += B64U[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) s += B64U[c & 63];
  }
  return s;
}

export function fromBase64Url(s: string): Uint8Array {
  const clean = s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64U.indexOf(ch);
    if (v < 0) throw new Error("invalid base64url");
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export function wipe(...arrays: (Uint8Array | undefined | null)[]): void {
  for (const a of arrays) a?.fill(0);
}

// ─────────────── keys ───────────────

const HKDF_INFO_INVITE = utf8("plans/v1/invite-x25519");
const SEAL_INFO = utf8("plans/v1/seal");
export const SEAL_VERSION = 0x01;
export const GROUP_BOX_VERSION = 0x01;

/** X25519 key pair derived from an invite secret (32 bytes): opens the invite key wrap. */
export function inviteKeyPair(inviteSecret: Uint8Array): { secret: Uint8Array; publicKey: Uint8Array } {
  if (inviteSecret.length !== 32) throw new Error("invite secret must be 32 bytes");
  const secret = hkdf(sha256, inviteSecret, undefined, HKDF_INFO_INVITE, 32);
  return { secret, publicKey: x25519.getPublicKey(secret) };
}

/** Lowercase Ethereum address of a secp256k1 private key (the pot's `inviteSigner` for an invite secret). */
export function addressOf(privateKey: Uint8Array): `0x${string}` {
  const pub = secp256k1.getPublicKey(privateKey, false); // 0x04 ‖ X ‖ Y
  return toHex(keccak_256(pub.slice(1)).slice(12));
}

// ─────────────── sealed box ───────────────

function sealKey(shared: Uint8Array, ephPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, concatBytes(ephPub, recipientPub), SEAL_INFO, 32);
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
    wipe(shared, key);
  }
}

/** Seal with an explicit ephemeral secret and nonce. Used only to build the local test fixture. */
export function sealDeterministic(recipientPub: Uint8Array, plaintext: Uint8Array, context: string, ephSecret: Uint8Array, nonce: Uint8Array): Uint8Array {
  const ephPub = x25519.getPublicKey(ephSecret);
  const key = sealKey(x25519.getSharedSecret(ephSecret, recipientPub), ephPub, recipientPub);
  const ct = xchacha20poly1305(key, nonce, utf8(`plans/v1/seal|${context}`)).encrypt(plaintext);
  return concatBytes(new Uint8Array([SEAL_VERSION]), ephPub, nonce, ct);
}

export function unwrapGroupKey(secret: Uint8Array, wrap: Uint8Array, pot: string): Uint8Array {
  return open(secret, wrap, `groupkey|${pot.toLowerCase()}`);
}

// ─────────────── group box and plan meta ───────────────

export function groupDecrypt(groupKey: Uint8Array, kind: "meta", pot: string, box: Uint8Array): Uint8Array {
  if (box.length < 1 + 24 + 16 || box[0] !== GROUP_BOX_VERSION) throw new Error("not a group box");
  return xchacha20poly1305(groupKey, box.slice(1, 25), utf8(`plans/v1/${kind}|${pot.toLowerCase()}`)).decrypt(box.slice(25));
}

/** Used only to build the local test fixture. */
export function groupEncrypt(groupKey: Uint8Array, kind: "meta", pot: string, plaintext: Uint8Array, nonce: Uint8Array): Uint8Array {
  const ct = xchacha20poly1305(groupKey, nonce, utf8(`plans/v1/${kind}|${pot.toLowerCase()}`)).encrypt(plaintext);
  return concatBytes(new Uint8Array([GROUP_BOX_VERSION]), nonce, ct);
}

export type PlanMeta = { name: string; emoji: string; color: string; demo: boolean };

/** Meta bytes: 0x00 ‖ plaintext JSON (relayer demo plans), or 0x01 ‖ groupBox(JSON). */
export function decodeMeta(meta: Uint8Array, pot: string, groupKey?: Uint8Array | null): PlanMeta | null {
  try {
    if (meta.length === 0) return null;
    let raw: Uint8Array;
    if (meta[0] === 0x00) raw = meta.slice(1);
    else if (groupKey) raw = groupDecrypt(groupKey, "meta", pot, meta);
    else return null;
    const o = JSON.parse(fromUtf8(raw)) as Record<string, unknown>;
    if (typeof o.name !== "string") return null;
    return {
      name: o.name.slice(0, 60),
      emoji: typeof o.emoji === "string" ? o.emoji : "🎟️",
      color: typeof o.color === "string" && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : "#2FA6B8",
      demo: o.demo === true,
    };
  } catch {
    return null;
  }
}

// ─────────────── the invite link ───────────────

/** Fragment of /v/<pot> and /j/<pot> links: `#s=<invite secret, base64url>&n=<inviter name>`. */
export function parseFragment(hash: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of hash.replace(/^#/, "").split("&")) {
    const i = kv.indexOf("=");
    if (i <= 0) continue;
    try {
      out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    } catch {
      /* ignore a damaged pair */
    }
  }
  return out;
}

export function inviteSecretFrom(hash: string): Uint8Array | null {
  const s = parseFragment(hash).s;
  if (!s) return null;
  try {
    const b = fromBase64Url(s);
    return b.length === 32 ? b : null;
  } catch {
    return null;
  }
}

export type UnlockResult =
  | { state: "unlocked"; meta: PlanMeta | null; signer: string }
  | { state: "rotated"; signer: string }
  | { state: "failed" };

/**
 * Opens the plan's meta with the invite secret, in this browser only.
 * Candidates: the createPot invite wrap, then KeyWrapped entries addressed to the secret's signer
 * address (posted when a member makes a new link). Returns "rotated" when the secret no longer
 * matches the pot's current invite signer (the link was turned off).
 */
export function unlockPlan(input: {
  pot: string;
  secret: Uint8Array;
  meta: string;
  inviteKeyWrap: string;
  inviteSigner: string | null;
  signerWraps: { member: string; wrap: string }[];
}): UnlockResult {
  const pot = input.pot.toLowerCase();
  let signer: string;
  try {
    signer = addressOf(input.secret);
  } catch {
    return { state: "failed" };
  }
  if (input.inviteSigner && input.inviteSigner.toLowerCase() !== signer) return { state: "rotated", signer };
  const candidates: string[] = [];
  if (input.inviteKeyWrap && input.inviteKeyWrap.length > 4) candidates.push(input.inviteKeyWrap);
  for (const w of [...input.signerWraps].reverse()) if (w.member.toLowerCase() === signer && w.wrap.startsWith("0x01")) candidates.push(w.wrap);
  const inv = inviteKeyPair(input.secret).secret;
  try {
    let metaBytes: Uint8Array;
    try {
      metaBytes = fromHex(input.meta || "0x");
    } catch {
      return { state: "failed" };
    }
    if (metaBytes[0] === 0x00) return { state: "unlocked", meta: decodeMeta(metaBytes, pot), signer };
    for (const c of candidates) {
      let gk: Uint8Array | null = null;
      try {
        gk = unwrapGroupKey(inv, fromHex(c), pot);
        const meta = decodeMeta(metaBytes, pot, gk);
        if (meta) return { state: "unlocked", meta, signer };
      } catch {
        /* not for this secret */
      } finally {
        wipe(gk);
      }
    }
    return { state: "failed" };
  } finally {
    wipe(inv);
  }
}
