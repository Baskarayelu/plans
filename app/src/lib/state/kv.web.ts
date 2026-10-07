/**
 * Web key-value store: localStorage under "plans.kv.". Holds exactly what SecureStore holds on
 * Android (account metadata: address, credential id, X25519 public key, profile; prefs; the nonce
 * allocator). Nothing secret: PRF outputs and keys never leave memory. Works without storage
 * (private windows, blocked site data): reads return null and writes are dropped.
 */
const P = "plans.kv.";

function ls(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export async function kvGet(key: string): Promise<string | null> {
  try {
    return ls()?.getItem(P + key) ?? null;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  try {
    ls()?.setItem(P + key, value);
  } catch {
    /* storage full or blocked */
  }
}

export async function kvDelete(key: string): Promise<void> {
  try {
    ls()?.removeItem(P + key);
  } catch {
    /* ignore */
  }
}
