/**
 * "Devices with your passkey" for the screens (designs 171, 174, 177, 178): this device's place in
 * the account's device list, removing a linked browser (a passkey confirmation on whichever device
 * does it), and the notices other devices show on their next open. The list itself is
 * lib/link/devices.ts.
 */
import { fromBase64Url, randomBytes, toHex, wipe } from "../crypto/bytes";
import { currentDevicesRoot, freshPrfOutputs, LockedError, signOut } from "../identity/session";
import { kvGet, kvSet } from "../state/kv";
import { createStore } from "../state/observable";
import { storage } from "../state/storage";
import { isSlotConflictError, relayerSlotIO, updateSlot, type SlotIO } from "./cas";
import { activeDevices, isRemovedVault, markRemoved, REMOVED_VAULT, updateDevices, upsertSelf, unseenEvents, fetchDevices, type DeviceEntry, type DeviceEvent, type DeviceKind, type DeviceList } from "./devices";
import { nowSec, vaultId, vaultKeys } from "./protocol";
import { ensureNotRemoved } from "./removalWatch";

const DEVICE_KEY = "plans.device.v1";
/** kv flag: the "New" chip on You → Add a browser goes after the first visit (171). */
export const ADD_BROWSER_SEEN = "plans.seen.add-browser";
const seenKey = (address: string) => `plans.devices.seen.${address.toLowerCase()}`;

/** The latest list this device has read (for the You page and the devices screen). */
export const devicesStore = createStore<{ address?: string; list: DeviceList | null; myId?: string; at: number }>({ list: null, at: 0 });

/** A random id for this install (16 hex), made once. Not secret, never sent in clear (it's inside the encrypted list). */
export async function myDeviceId(): Promise<string> {
  const raw = await kvGet(DEVICE_KEY);
  try {
    const id = raw ? (JSON.parse(raw) as { id?: string }).id : undefined;
    if (id && /^[0-9a-f]{16}$/.test(id)) return id;
  } catch {
    /* make a new one */
  }
  const id = toHex(randomBytes(8)).slice(2);
  await kvSet(DEVICE_KEY, JSON.stringify({ id }));
  return id;
}

/** Vault slot and overwrite auth of a linked browser's passkey (§9.6), for its entry in the list. */
export function vaultRef(b2: Uint8Array, credentialId: string): { id: string; auth: string } {
  const { key, auth } = vaultKeys(b2);
  try {
    return { id: vaultId(fromBase64Url(credentialId)), auth: toHex(auth).slice(2) };
  } finally {
    wipe(key, auth);
  }
}

/**
 * Puts this device in the account's list (or refreshes it). Linked browsers pass their vault ref
 * right after linking, which also tells the other devices "… can now use your account". Needs the
 * keys (null when they aren't unlocked). Network or decryption problems are thrown.
 */
export async function syncThisDevice(opts: { kind: DeviceKind; label: string; vault?: { id: string; auth: string } }): Promise<DeviceList | null> {
  const root = currentDevicesRoot();
  const stored = await storage.loadAccount();
  if (!root || !stored) return null;
  // A linked browser that was removed meanwhile must not list itself again: this locks it instead.
  if (stored.vault && !opts.vault) await ensureNotRemoved({ maxAgeMs: 0 });
  const id = await myDeviceId();
  const list = await updateDevices(root, (l) => upsertSelf(l, { id, kind: opts.kind, label: opts.label, linked: !!stored.vault, vault: opts.vault }, nowSec()));
  devicesStore.set({ address: stored.address.toLowerCase(), list, myId: id, at: Date.now() });
  return list;
}

/** Reads the list again (no write). Null when the keys aren't unlocked. */
export async function refreshDevices(): Promise<DeviceList | null> {
  const root = currentDevicesRoot();
  const stored = await storage.loadAccount();
  if (!root || !stored) return null;
  const [list, id] = await Promise.all([fetchDevices(root), myDeviceId()]);
  devicesStore.set({ address: stored.address.toLowerCase(), list, myId: id, at: Date.now() });
  return list;
}

/**
 * Removes a device from the account (design 178): one passkey confirmation on THIS device (its
 * own passkey, pinned), then the target's vault is overwritten so its passkey no longer opens the
 * account, then the list records it (the other devices see a notice). Removing this browser signs
 * it out. Only linked browsers can be removed: a device using the account's own passkey can't be
 * shut out from here (the passkey is the account).
 */
export async function removeDevice(target: DeviceEntry): Promise<{ self: boolean }> {
  const root = currentDevicesRoot();
  const stored = await storage.loadAccount();
  if (!root || !stored) throw new LockedError();
  const myId = await myDeviceId();
  const self = target.id === myId;
  if (!target.linked) throw new Error("Only a linked browser can be removed.");
  // The confirmation: a fresh ceremony pinned to this device's own passkey ("Confirm with passkey" / fingerprint).
  const out = await freshPrfOutputs(stored.credentialId);
  wipe(out.first);
  let vault = target.vault;
  try {
    // This browser removing itself knows its own vault directly from its passkey.
    if (self && stored.vault) vault = vaultRef(out.second, stored.credentialId);
  } finally {
    wipe(out.second);
  }
  // 1. The vault (what actually shuts the browser out), as a compare-and-set. A conflict that never
  // resolves here throws SlotConflictError: nothing was changed. 2. The list.
  const vaultRemoved = vault ? await markVaultRemoved(vault) : false;
  try {
    await removeFromList(target, { stored, root, myId });
  } catch (e) {
    // The browser is already shut out; only the list is behind. Leave it removed (safer) and let
    // the person re-run just the list edit (retryRemovalList).
    if (isSlotConflictError(e) && vaultRemoved) throw new RemovedListBehindError(target);
    throw e;
  }
  if (self) await signOut();
  return { self };
}

/** The "removed" marker is in the browser's vault, but the list kept conflicting and still shows it. */
export class RemovedListBehindError extends Error {
  constructor(public target: DeviceEntry) {
    super(REMOVED_LIST_BEHIND_MESSAGE);
    this.name = "RemovedListBehindError";
  }
  get friendly(): string {
    return REMOVED_LIST_BEHIND_MESSAGE;
  }
}
export const REMOVED_LIST_BEHIND_MESSAGE =
  "That browser is removed. Your device list didn't update because it changed on another device at the same moment — it may still show that browser until you try again.";
export const isRemovedListBehindError = (e: unknown): e is RemovedListBehindError => e instanceof RemovedListBehindError;

async function removeFromList(target: DeviceEntry, c: { stored: { address: string }; root: Uint8Array; myId: string }): Promise<void> {
  const at = nowSec();
  const list = await updateDevices(c.root, (l) => markRemoved(l, target.id, c.myId, at));
  devicesStore.set({ address: c.stored.address.toLowerCase(), list, myId: c.myId, at: Date.now() });
}

/**
 * "Try again" after RemovedListBehindError: re-runs only the list edit (no passkey prompt, the vault
 * is already marked). A browser that removed itself signs out once the list is done. Throws
 * SlotConflictError again if the list still conflicts.
 */
export async function retryRemovalList(target: DeviceEntry): Promise<{ self: boolean }> {
  const root = currentDevicesRoot();
  const stored = await storage.loadAccount();
  if (!root || !stored) throw new LockedError();
  const myId = await myDeviceId();
  await removeFromList(target, { stored, root, myId });
  const self = target.id === myId;
  if (self) await signOut();
  return { self };
}

/**
 * Overwrites a linked browser's vault with REMOVED_VAULT (compare-and-set, the same retry loop;
 * nothing to write when it already holds the marker). Resolves true once the vault holds the
 * marker; throws SlotConflictError when every try conflicted (the marker never landed).
 */
export async function markVaultRemoved(vault: { id: string; auth: string }, io: SlotIO = relayerSlotIO): Promise<boolean> {
  await updateSlot<Uint8Array | null>(vault.id, {
    decode: (b) => b,
    apply: (b) => (isRemovedVault(b) ? null : REMOVED_VAULT),
    encode: (b) => b!,
    auth: vault.auth,
    io,
  });
  return true;
}

/**
 * Notices this device hasn't shown yet: "Chrome on a Mac can now use your account" and
 * "… was removed" (design 174, lead's decision 5: in the app on next open, no push). The first
 * time a device reads the list it only remembers where it is, so old history isn't replayed.
 */
export async function takeDeviceNotices(list: DeviceList, address: string, myId: string): Promise<DeviceEvent[]> {
  const raw = await kvGet(seenKey(address));
  const since = raw ? Number(raw) : NaN;
  const newest = list.events.reduce((m, e) => Math.max(m, e.t), 0);
  if (!Number.isFinite(since)) {
    await kvSet(seenKey(address), String(Math.max(newest, nowSec())));
    return [];
  }
  const out = unseenEvents(list, myId, since);
  if (newest > since) await kvSet(seenKey(address), String(newest));
  return out;
}

export { activeDevices };
