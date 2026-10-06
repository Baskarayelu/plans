/**
 * Device storage. Nothing secret is stored: the PRF outputs, signing key, X25519 secret and cache
 * key live in memory only and are re-derived from the passkey on every unlock.
 *
 *   SecureStore "plans.account.v1"  – address, credential id, X25519 public key, profile (ungated)
 *   SecureStore "plans.nonce.<addr>" – nonce prefix + counter (see lib/chain/nonces.ts)
 *   SecureStore "plans.prefs.v1"    – theme override, dismissed cards, endpoint overrides
 *   files  <documents>/cache/*.bin  – XChaCha20-Poly1305 under the cache key (lib/state/cache.ts)
 */
import * as SecureStore from "expo-secure-store";
import type { NonceState, NonceStore } from "../chain/nonces";

const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export type Profile = { name: string; country: string; currency: string; city?: string };

export type StoredAccount = {
  v: 1;
  address: `0x${string}`;
  credentialId: string;
  x25519Public?: string; // hex, public
  fingerprint?: string;
  profile?: Profile;
  createdAt: number;
  keyRegistered?: boolean;
};

export type Prefs = {
  theme?: "system" | "light" | "dark";
  hideDemoCard?: boolean;
  endpoints?: { relayerUrl?: string; graphqlUrl?: string; rpcUrl?: string; wsUrl?: string };
  pushRegisteredAt?: number;
  lastFaucetAt?: number;
};

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key, OPTS);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, v: unknown): Promise<void> {
  await SecureStore.setItemAsync(key, JSON.stringify(v), OPTS);
}

export const storage = {
  loadAccount: () => readJson<StoredAccount>("plans.account.v1"),
  saveAccount: (a: StoredAccount) => writeJson("plans.account.v1", a),
  clearAccount: () => SecureStore.deleteItemAsync("plans.account.v1", OPTS),
  loadPrefs: async () => (await readJson<Prefs>("plans.prefs.v1")) ?? {},
  savePrefs: (p: Prefs) => writeJson("plans.prefs.v1", p),
};

export const secureNonceStore: NonceStore = {
  async load(account: string): Promise<NonceState | null> {
    return readJson<NonceState>(`plans.nonce.${account.toLowerCase()}`);
  },
  async save(account: string, s: NonceState): Promise<void> {
    await writeJson(`plans.nonce.${account.toLowerCase()}`, s);
  },
};
