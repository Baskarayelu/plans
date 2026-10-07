/**
 * Small key-value store for non-secret metadata. Android: SecureStore (Keystore-backed,
 * this-device-only). Web: kv.web.ts (localStorage). Never used for PRF outputs or keys.
 */
import * as SecureStore from "expo-secure-store";

const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function kvGet(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key, OPTS);
}

export async function kvSet(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, OPTS);
}

export async function kvDelete(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, OPTS);
}
