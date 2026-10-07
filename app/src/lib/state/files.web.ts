/**
 * Web byte files: localStorage under "plans.<folder>.<name>", base64url. Only ciphertext is ever
 * written (the cache is XChaCha20-Poly1305 under the passkey-derived cache key; receipt blobs are
 * group-key ciphertext). When storage is full or blocked, receipt blobs fall back to memory for
 * the session, and the cache simply isn't kept (everything rebuilds from the network).
 */
import { fromBase64Url, toBase64Url } from "../crypto/bytes";

export type Folder = "cache" | "blobs";

const mem = new Map<string, Uint8Array>();
const key = (folder: Folder, name: string) => `plans.${folder}.${name}`;

function ls(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function fileWrite(folder: Folder, name: string, bytes: Uint8Array): void {
  const k = key(folder, name);
  try {
    ls()?.setItem(k, toBase64Url(bytes));
    mem.delete(k);
  } catch {
    if (folder === "blobs") mem.set(k, bytes.slice());
    else throw new Error("storage unavailable");
  }
}

export function fileRead(folder: Folder, name: string): Uint8Array | null {
  const k = key(folder, name);
  try {
    const v = ls()?.getItem(k);
    if (v) return fromBase64Url(v);
  } catch {
    /* fall through */
  }
  return mem.get(k) ?? null;
}

export function fileDelete(folder: Folder, name: string): void {
  const k = key(folder, name);
  mem.delete(k);
  try {
    ls()?.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function folderClear(folder: Folder): void {
  const prefix = `plans.${folder}.`;
  for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
  const s = ls();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    /* ignore */
  }
}
