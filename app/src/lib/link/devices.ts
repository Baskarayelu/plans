/**
 * "Devices with your passkey" (designs 171, 174, 178; docs/crypto.md §9.9). Every device on an
 * account keeps one shared list in a relayer slot, encrypted under a key that only devices holding
 * the account's keys can derive. The relayer sees an id, ciphertext and its size, nothing else.
 *
 *   root  = HKDF(ikm = keys-namespace PRF output (the IKM of §3), salt = "", info = "plans/v1/devices", 32)
 *   id    = hex(HKDF(root, "", "plans/v1/devices-id", 32))
 *   key   = HKDF(root, "", "plans/v1/devices-key", 32)
 *   auth  = hex(HKDF(root, "", "plans/v1/devices-auth", 32))
 *   box   = 0x01 ‖ nonce(24) ‖ XChaCha20-Poly1305(key, nonce, JSON, aad = "plans/v1/devices|" + id)
 *   PUT /v1/slots/<id> {data: b64u(box), auth}       (permanent; overwritable only with auth)
 *
 * A linked browser's entry carries its vault slot id and vault auth (§9.6), so any device on the
 * account can remove it: removing overwrites that vault with REMOVED_VAULT, after which the
 * browser's own passkey no longer opens the account.
 *
 * Pure functions here (plus fetch/save through slots.ts); the passkey confirmation and the screens
 * are in deviceOps.ts and the UI.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, equalBytes, fromUtf8, randomBytes, toHex, utf8, wipe } from "../crypto/bytes";
import { BOX_VERSION, LinkError } from "./protocol";
import { relayerSlotIO, updateSlot, type SlotIO } from "./cas";

export const DEVICES_VERSION = 1;
export const MAX_DEVICES = 24;
export const MAX_EVENTS = 30;

const INFO_ROOT = "plans/v1/devices";
const INFO_ID = "plans/v1/devices-id";
const INFO_KEY = "plans/v1/devices-key";
const INFO_AUTH = "plans/v1/devices-auth";
const AAD = "plans/v1/devices|";

/** What a removed browser's vault slot is overwritten with: 0x00 ‖ UTF-8("plans/v1/removed"). Not a vault box (those start 0x01). */
export const REMOVED_VAULT = concatBytes(new Uint8Array([0x00]), utf8("plans/v1/removed"));

export function isRemovedVault(box: Uint8Array | null | undefined): boolean {
  return !!box && box.length === REMOVED_VAULT.length && equalBytes(box, REMOVED_VAULT);
}

export type DeviceKind = "phone" | "browser";

export type DeviceEntry = {
  /** Random per install (16 hex), see deviceOps.myDeviceId(). */
  id: string;
  kind: DeviceKind;
  /** "Pixel 8", "Chrome on a Mac". From the device itself: a hint, not proof. */
  label: string;
  /** A browser linked with a code (its own passkey and a vault), not the account's own passkey. */
  linked: boolean;
  /** Unix seconds. */
  addedAt: number;
  seenAt?: number;
  removedAt?: number;
  /** Linked browsers: their vault slot (§9.6) and its overwrite auth, so another device can remove them. */
  vault?: { id: string; auth: string };
};

export type DeviceEvent = { t: number; kind: "added" | "removed"; device: string; label: string; by: string };

export type DeviceList = { v: 1; devices: DeviceEntry[]; events: DeviceEvent[] };

export const emptyDevices = (): DeviceList => ({ v: DEVICES_VERSION, devices: [], events: [] });

const hex = (b: Uint8Array) => toHex(b).slice(2);

/** root = HKDF(keys IKM, "", "plans/v1/devices", 32). The caller wipes it with the other keys. */
export function devicesRootFrom(keysIkm: Uint8Array): Uint8Array {
  if (keysIkm.length !== 32) throw new Error("keys output must be 32 bytes");
  return hkdf(sha256, keysIkm, undefined, utf8(INFO_ROOT), 32);
}

export function devicesSlot(root: Uint8Array): { id: string; auth: string } {
  const id = hkdf(sha256, root, undefined, utf8(INFO_ID), 32);
  const auth = hkdf(sha256, root, undefined, utf8(INFO_AUTH), 32);
  try {
    return { id: hex(id), auth: hex(auth) };
  } finally {
    wipe(id, auth);
  }
}

function boxKey(root: Uint8Array): Uint8Array {
  return hkdf(sha256, root, undefined, utf8(INFO_KEY), 32);
}

// ─────────────── encoding ───────────────

const HEX64 = /^[0-9a-f]{64}$/;
const DEVICE_ID = /^[0-9a-f]{8,32}$/;
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const str = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");

function cleanDevice(d: unknown): DeviceEntry | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  if (typeof o.id !== "string" || !DEVICE_ID.test(o.id) || (o.kind !== "phone" && o.kind !== "browser") || !num(o.addedAt)) return null;
  const v = o.vault as Record<string, unknown> | undefined;
  const vault = v && typeof v.id === "string" && HEX64.test(v.id) && typeof v.auth === "string" && HEX64.test(v.auth) ? { id: v.id, auth: v.auth } : undefined;
  return {
    id: o.id,
    kind: o.kind,
    label: str(o.label, 60) || (o.kind === "phone" ? "A phone" : "A browser"),
    linked: o.linked === true,
    addedAt: o.addedAt,
    ...(num(o.seenAt) ? { seenAt: o.seenAt } : {}),
    ...(num(o.removedAt) ? { removedAt: o.removedAt } : {}),
    ...(vault ? { vault } : {}),
  };
}

function cleanEvent(e: unknown): DeviceEvent | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  if (!num(o.t) || (o.kind !== "added" && o.kind !== "removed") || typeof o.device !== "string" || typeof o.by !== "string") return null;
  return { t: o.t, kind: o.kind, device: o.device.slice(0, 32), label: str(o.label, 60), by: o.by.slice(0, 32) };
}

/** Keeps the list within its caps: removed devices go first, then the oldest; the newest events. */
export function trimDevices(list: DeviceList): DeviceList {
  let devices = list.devices;
  if (devices.length > MAX_DEVICES) {
    const order = [...devices].sort((a, b) => (a.removedAt ? 0 : 1) - (b.removedAt ? 0 : 1) || a.addedAt - b.addedAt);
    const drop = new Set(order.slice(0, devices.length - MAX_DEVICES).map((d) => d.id));
    devices = devices.filter((d) => !drop.has(d.id));
  }
  const events = [...list.events].sort((a, b) => a.t - b.t).slice(-MAX_EVENTS);
  return { v: DEVICES_VERSION, devices, events };
}

export function encodeDevices(list: DeviceList): Uint8Array {
  return utf8(JSON.stringify(trimDevices(list)));
}

export function decodeDevices(bytes: Uint8Array): DeviceList {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(fromUtf8(bytes, true)) as Record<string, unknown>;
  } catch {
    throw new LinkError("tampered", "device list is not JSON");
  }
  if (o.v !== DEVICES_VERSION || !Array.isArray(o.devices) || !Array.isArray(o.events)) throw new LinkError("tampered", "device list fields");
  const seen = new Set<string>();
  const devices: DeviceEntry[] = [];
  for (const d of o.devices.map(cleanDevice)) if (d && !seen.has(d.id)) (seen.add(d.id), devices.push(d));
  return { v: DEVICES_VERSION, devices, events: o.events.map(cleanEvent).filter((e): e is DeviceEvent => !!e) };
}

export function sealDevices(root: Uint8Array, list: DeviceList, nonce: Uint8Array = randomBytes(24)): Uint8Array {
  const { id } = devicesSlot(root);
  const key = boxKey(root);
  const pt = encodeDevices(list);
  try {
    return concatBytes(new Uint8Array([BOX_VERSION]), nonce, xchacha20poly1305(key, nonce, utf8(AAD + id)).encrypt(pt));
  } finally {
    wipe(key, pt);
  }
}

export function openDevices(root: Uint8Array, box: Uint8Array): DeviceList {
  if (box.length < 1 + 24 + 16 || box[0] !== BOX_VERSION) throw new LinkError("tampered", "not a device list box");
  const { id } = devicesSlot(root);
  const key = boxKey(root);
  let pt: Uint8Array;
  try {
    pt = xchacha20poly1305(key, box.slice(1, 25), utf8(AAD + id)).decrypt(box.slice(25));
  } catch {
    throw new LinkError("tampered", "device list did not decrypt");
  } finally {
    wipe(key);
  }
  try {
    return decodeDevices(pt);
  } finally {
    wipe(pt);
  }
}

// ─────────────── list operations (pure) ───────────────

export type SelfInfo = { id: string; kind: DeviceKind; label: string; linked: boolean; vault?: { id: string; auth: string } };

const DAY = 86_400;

/**
 * Adds or refreshes this device. A newly linked browser (or one linked again) gets an "added"
 * event, which the other devices show as a notice. Returns null when nothing needs saving.
 */
export function upsertSelf(list: DeviceList, me: SelfInfo, now: number): DeviceList | null {
  const cur = list.devices.find((d) => d.id === me.id);
  const fresh: DeviceEntry = {
    id: me.id,
    kind: me.kind,
    label: me.label.slice(0, 60),
    linked: me.linked,
    addedAt: cur && !cur.removedAt ? cur.addedAt : now,
    seenAt: now,
    ...(me.vault ? { vault: me.vault } : !me.linked ? {} : cur?.vault ? { vault: cur.vault } : {}),
  };
  // New: not listed yet, removed before, or linked again (a different vault). A first vault ref for an
  // entry that had none (the screen and the root watcher listing the same browser) isn't news.
  const isNew = !cur || !!cur.removedAt || (me.linked && !!me.vault && !!cur.vault && cur.vault.id !== me.vault.id);
  const same =
    cur &&
    !isNew &&
    cur.kind === fresh.kind &&
    cur.label === fresh.label &&
    cur.linked === fresh.linked &&
    cur.vault?.id === fresh.vault?.id &&
    cur.vault?.auth === fresh.vault?.auth &&
    now - (cur.seenAt ?? 0) < DAY;
  if (same) return null;
  const devices = cur ? list.devices.map((d) => (d.id === me.id ? fresh : d)) : [...list.devices, fresh];
  const events = isNew && me.linked ? [...list.events, { t: now, kind: "added" as const, device: me.id, label: fresh.label, by: me.id }] : list.events;
  return trimDevices({ v: DEVICES_VERSION, devices, events });
}

/** Marks a device removed (kept for the record) and adds a "removed" event. Null if it isn't there or already removed. */
export function markRemoved(list: DeviceList, deviceId: string, by: string, now: number): DeviceList | null {
  const cur = list.devices.find((d) => d.id === deviceId);
  if (!cur || cur.removedAt) return null;
  const devices = list.devices.map((d) => {
    if (d.id !== deviceId) return d;
    // The vault's auth isn't needed any more once it's been overwritten.
    const { vault: _gone, ...rest } = d;
    return { ...rest, removedAt: now };
  });
  return trimDevices({ v: DEVICES_VERSION, devices, events: [...list.events, { t: now, kind: "removed", device: deviceId, label: cur.label, by }] });
}

/** Devices to show: not removed, this one first, then phones, then by when they were added. */
export function activeDevices(list: DeviceList, myId?: string): DeviceEntry[] {
  return list.devices
    .filter((d) => !d.removedAt)
    .sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : 0) || (a.kind === b.kind ? 0 : a.kind === "phone" ? -1 : 1) || a.addedAt - b.addedAt);
}

/** Events this device hasn't shown yet: newer than `since`, about another device, made by another device. */
export function unseenEvents(list: DeviceList, myId: string, since: number): DeviceEvent[] {
  return list.events.filter((e) => e.t > since && e.device !== myId && !(e.kind === "removed" && e.by === myId));
}

// ─────────────── network ───────────────

/** The account's device list (empty when none was saved yet). Throws SlotError on network trouble, LinkError when it doesn't open. */
export async function fetchDevices(root: Uint8Array, io: SlotIO = relayerSlotIO): Promise<DeviceList> {
  const cur = await io.get(devicesSlot(root).id);
  return cur ? openDevices(root, cur.data) : emptyDevices();
}

/**
 * Changes the list without losing anyone else's change: read (list, rev) → `change` → write with
 * ifRev; on a conflict, read again and apply the same `change` again (cas.ts). `change` must be an
 * idempotent edit by device id (upsertSelf, markRemoved) and return null for "nothing to do".
 * Throws SlotConflictError when every try conflicted (nothing written), SlotError on network
 * trouble, LinkError when the stored list doesn't open.
 */
export async function updateDevices(root: Uint8Array, change: (list: DeviceList) => DeviceList | null, opts: { io?: SlotIO; attempts?: number } = {}): Promise<DeviceList> {
  const { id, auth } = devicesSlot(root);
  const r = await updateSlot<DeviceList>(id, {
    decode: (bytes) => (bytes ? openDevices(root, bytes) : emptyDevices()),
    apply: change,
    encode: (list) => sealDevices(root, list),
    auth,
    ...opts,
  });
  return trimDevices(r.value);
}
