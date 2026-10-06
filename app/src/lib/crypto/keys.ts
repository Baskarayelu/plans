import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { utf8, wipe } from "./bytes";
import { keyFingerprint } from "./fingerprint";

/**
 * Two PRF namespaces on the same passkey (see docs/crypto.md):
 *
 *   account: Mera's default salt sha256("mera.prf.salt.v1") → BIP-39 → m/44'/60'/0'/0/0 (Mera's recipe)
 *   keys:    sha256("plans.keys.v1") → HKDF-SHA256 → X25519 identity + local cache key
 */
export const ACCOUNT_PRF_SALT = sha256(utf8("mera.prf.salt.v1"));
export const KEYS_PRF_SALT = sha256(utf8("plans.keys.v1"));

export const HKDF_INFO_X25519 = "plans/v1/x25519";
export const HKDF_INFO_CACHE = "plans/v1/cache";
export const HKDF_INFO_INVITE = "plans/v1/invite-x25519";

const EVM_PATH = "m/44'/60'/0'/0/0";

/**
 * Mera's documented account recipe: the 32-byte PRF output is BIP-39 entropy (24 words), the
 * BIP-39 seed (PBKDF2, empty passphrase) roots a BIP-32 tree, and the account key is m/44'/60'/0'/0/0.
 * The same passkey therefore gives the same address in Mera's own demos.
 */
export function deriveAccountPrivateKey(prfFirst: Uint8Array): Uint8Array {
  if (prfFirst.length !== 32) throw new Error("PRF output must be 32 bytes");
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfFirst, wordlist));
  try {
    const node = HDKey.fromMasterSeed(seed).derive(EVM_PATH);
    if (!node.privateKey) throw new Error("BIP-32 derivation produced no private key");
    return new Uint8Array(node.privateKey);
  } finally {
    wipe(seed);
  }
}

export type PlansKeys = {
  /** X25519 secret key (32 bytes). Memory only. */
  x25519Secret: Uint8Array;
  /** X25519 public key (32 bytes), registered in KeyRegistry. */
  x25519Public: Uint8Array;
  /** Key for the encrypted on-device cache (32 bytes). Memory only; re-derived on every unlock. */
  cacheKey: Uint8Array;
  /** Three-emoji fingerprint of x25519Public. */
  fingerprint: string;
};

/**
 * Derives the Plans keys from the keys-namespace PRF output:
 *   x25519Secret = HKDF-SHA256(ikm = prf, salt = empty, info = "plans/v1/x25519", 32)
 *   cacheKey     = HKDF-SHA256(ikm = prf, salt = empty, info = "plans/v1/cache", 32)
 * The X25519 secret is clamped by X25519 itself (RFC 7748).
 */
export function deriveKeys(prfSecond: Uint8Array): PlansKeys {
  if (prfSecond.length !== 32) throw new Error("PRF output must be 32 bytes");
  const x25519Secret = hkdf(sha256, prfSecond, undefined, utf8(HKDF_INFO_X25519), 32);
  const cacheKey = hkdf(sha256, prfSecond, undefined, utf8(HKDF_INFO_CACHE), 32);
  const x25519Public = x25519.getPublicKey(x25519Secret);
  return { x25519Secret, x25519Public, cacheKey, fingerprint: keyFingerprint(x25519Public) };
}

/** X25519 key pair derived from an invite secret (32 bytes): used for the invite key wrap. */
export function inviteKeyPair(inviteSecret: Uint8Array): { secret: Uint8Array; publicKey: Uint8Array } {
  if (inviteSecret.length !== 32) throw new Error("invite secret must be 32 bytes");
  const secret = hkdf(sha256, inviteSecret, undefined, utf8(HKDF_INFO_INVITE), 32);
  return { secret, publicKey: x25519.getPublicKey(secret) };
}

export function x25519PublicKey(secret: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secret);
}
