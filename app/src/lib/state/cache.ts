/**
 * Encrypted on-device cache, keyed by the cache key from the keys namespace
 * (HKDF "plans/v1/cache"). Files are 0x01 || nonce(24) || XChaCha20-Poly1305(cacheKey, nonce,
 * JSON, aad = "plans/v1/cache|" + name). Without an unlocked passkey the files are unreadable, so a
 * copied backup reveals nothing. Holds: group keys, decrypted names/notes, contacts, pending
 * claim keys for pay links, and receipt-photo ciphertext waiting for upload.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { Directory, File, Paths } from "expo-file-system";
import { concatBytes, fromUtf8, randomBytes, utf8 } from "../crypto/bytes";
import { currentKeys } from "../identity/session";

function dir(): Directory {
  const d = new Directory(Paths.document, "cache");
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

const safe = (name: string) => name.replace(/[^a-zA-Z0-9_.-]/g, "_");

export function cacheWrite(name: string, value: unknown): boolean {
  const k = currentKeys();
  if (!k) return false;
  try {
    const nonce = randomBytes(24);
    const ct = xchacha20poly1305(k.cacheKey, nonce, utf8(`plans/v1/cache|${name}`)).encrypt(utf8(JSON.stringify(value)));
    const f = new File(dir(), `${safe(name)}.bin`);
    f.write(concatBytes(new Uint8Array([1]), nonce, ct));
    return true;
  } catch {
    return false;
  }
}

export function cacheRead<T>(name: string): T | null {
  const k = currentKeys();
  if (!k) return null;
  try {
    const f = new File(dir(), `${safe(name)}.bin`);
    if (!f.exists) return null;
    const b = f.bytesSync();
    if (b[0] !== 1) return null;
    const pt = xchacha20poly1305(k.cacheKey, b.slice(1, 25), utf8(`plans/v1/cache|${name}`)).decrypt(b.slice(25));
    return JSON.parse(fromUtf8(pt)) as T;
  } catch {
    return null;
  }
}

export function cacheDelete(name: string): void {
  try {
    const f = new File(dir(), `${safe(name)}.bin`);
    if (f.exists) f.delete();
  } catch {
    /* ignore */
  }
}

export function cacheClearAll(): void {
  try {
    const d = new Directory(Paths.document, "cache");
    if (d.exists) d.delete();
  } catch {
    /* ignore */
  }
}

/** Raw (already encrypted) blob store for receipt photo ciphertext. */
export function blobWrite(hashHex: string, bytes: Uint8Array): void {
  const d = new Directory(Paths.document, "blobs");
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  new File(d, `${safe(hashHex)}.bin`).write(bytes);
}

export function blobRead(hashHex: string): Uint8Array | null {
  try {
    const f = new File(new Directory(Paths.document, "blobs"), `${safe(hashHex)}.bin`);
    return f.exists ? f.bytesSync() : null;
  } catch {
    return null;
  }
}
