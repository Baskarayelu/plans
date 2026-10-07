/**
 * "Devices with your passkey" and the link screens' logic (designs 165–178): the encrypted device
 * list, removing a linked browser (its vault is overwritten, so its passkey can't open the account
 * again), notices on the other devices, the 176a refusal of a phone's passkey without the keys
 * output, the QR's device label and the link's network status. Passkey, storage and relayer are
 * mocked as in linkSession.test.ts.
 */
jest.mock("../config", () => ({ config: { relayerUrl: "https://relayer.test", linkHost: "plans.0xo.in", rpId: "plans.0xo.in" } }));

const mockKv = new Map<string, string>();
jest.mock("../lib/state/kv", () => ({
  kvGet: async (k: string) => mockKv.get(k) ?? null,
  kvSet: async (k: string, v: string) => void mockKv.set(k, v),
  kvDelete: async (k: string) => void mockKv.delete(k),
}));

type Req = { allowCredentials?: { id: string }[]; user?: { id: string }; extensions?: { prf?: { eval?: { first?: string; second?: string } } } };
const mockPk = {
  /** credential id (b64u) → [first, second] PRF outputs (b64u); second may be absent. */
  outputs: new Map<string, [string, string | undefined]>(),
  /** which credential a discoverable get picks */
  discover: "AQID",
  /** the credential a create makes */
  createId: "BAUG",
  calls: [] as { kind: string; req: Req }[],
  ignoreSecond: new Set<string>(),
  /** the create ceremony returns no `second` (gets still do) */
  createNoSecond: false,
  /** authenticatorAttachment of gets ("cross-platform": a phone over the browser's QR) */
  attachment: undefined as string | undefined,
};
jest.mock("react-native-passkey", () => ({
  Passkey: {
    async createPlatformKey(req: Req) {
      mockPk.calls.push({ kind: "create", req });
      const [first, second0] = mockPk.outputs.get(mockPk.createId)!;
      const second = mockPk.createNoSecond || mockPk.ignoreSecond.has(mockPk.createId) ? undefined : second0;
      return {
        id: mockPk.createId,
        rawId: mockPk.createId,
        response: { clientDataJSON: "", attestationObject: "", transports: ["internal"] },
        clientExtensionResults: { prf: { enabled: true, results: { first, ...(second ? { second } : {}) } } },
      };
    },
    async getPlatformKey(req: Req) {
      mockPk.calls.push({ kind: "get", req });
      const id = req.allowCredentials?.[0]?.id ?? mockPk.discover;
      const [first, second] = mockPk.outputs.get(id)!;
      // A keys-only ceremony asks for one salt (the keys salt): the authenticator answers it with
      // the keys output. `ignoreSecond` models a provider that drops the second salt of a pair.
      const ev = req.extensions?.prf?.eval;
      const keysOnly = !ev?.second && ev?.first !== mockAccountSalt;
      const results = keysOnly ? { first: second } : { first, ...(second && !mockPk.ignoreSecond.has(id) ? { second } : {}) };
      return { id, rawId: id, authenticatorAttachment: mockPk.attachment, response: {}, clientExtensionResults: { prf: { results } } };
    },
    async getImmediate() {
      throw { error: "NoCredentials", message: "none" };
    },
  },
}));

import { createHash } from "node:crypto";
import { fromBase64Url, toBase64Url, toHex } from "../lib/crypto/bytes";
import { deriveAccountPrivateKey, deriveKeys } from "../lib/crypto/keys";
import { identity } from "../lib/identity/session";
import { accountAddress, bundleFromPrf, linkSecretFromCode, slotIds, vaultId, type LinkError } from "../lib/link/protocol";
import type { PasskeyError } from "../lib/identity/session";

const mockAccountSalt = createHash("sha256").update("mera.prf.salt.v1").digest("base64url");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const session = require("../lib/identity/session") as typeof import("../lib/identity/session");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const browserLink = require("../lib/link/browserLink") as typeof import("../lib/link/browserLink");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const phoneLink = require("../lib/link/phoneLink") as typeof import("../lib/link/phoneLink");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const storage = (require("../lib/state/storage") as typeof import("../lib/state/storage")).storage;

const b = (n: number) => new Uint8Array(32).fill(n);
const b64 = (u: Uint8Array) => toBase64Url(u);
// phone passkey (Google Password Manager)
const PHONE_ID = "AQID";
const P1 = b(0x11);
const P2 = b(0x22);
// browser link passkey (iCloud Keychain)
const LINK_ID = "BAUG";
const L1 = b(0x33);
const L2 = b(0x44);

const phoneAddress = accountAddress(deriveAccountPrivateKey(new Uint8Array(P1)));
const phoneFp = deriveKeys(new Uint8Array(P2)).fingerprint;
const linkFirstAddress = accountAddress(deriveAccountPrivateKey(new Uint8Array(L1)));

// ─────────────── relayer slots (in memory, with rev / ifRev like relayer/src/slots.ts) ───────────────
const relayer = {
  slots: new Map<string, { data: string; expiresAt: number | null; auth?: string; rev: number }>(),
  down: false,
  status: 0,
  /** Slot ids whose conditional writes always conflict (a persistent race). */
  forceConflict: new Set<string>(),
  puts: [] as { id: string; ifRev?: number; status: number }[],
  gets: 0,
};
const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body), headers: new Headers() }) as unknown as Response;
(globalThis as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
  if (relayer.down) throw new TypeError("Failed to fetch");
  if (relayer.status) return json(relayer.status, { error: { code: "INTERNAL" } });
  const id = /\/v1\/slots\/(.+)$/.exec(url)![1];
  if ((init.method ?? "GET") === "PUT") {
    const body = JSON.parse(String(init.body));
    const cur = relayer.slots.get(id);
    const done = (status: number, out: unknown) => (relayer.puts.push({ id, ifRev: body.ifRev, status }), json(status, out));
    if (cur && (!cur.auth || cur.auth !== body.auth)) return done(409, { error: { code: "SLOT_TAKEN" } });
    const rev = cur?.rev ?? 0;
    if (body.ifRev !== undefined && (body.ifRev !== rev || relayer.forceConflict.has(id))) return done(409, { error: { code: "SLOT_CONFLICT", currentRev: rev } });
    relayer.slots.set(id, { data: body.data, expiresAt: body.ttl ? Math.floor(Date.now() / 1000) + body.ttl : null, auth: body.auth, rev: rev + 1 });
    return done(cur ? 200 : 201, { created: !cur, rev: rev + 1 });
  }
  relayer.gets++;
  const cur = relayer.slots.get(id);
  return cur ? json(200, { data: cur.data, expiresAt: cur.expiresAt, rev: cur.rev }) : json(404, { error: { code: "NOT_FOUND" } });
});

beforeEach(async () => {
  mockKv.clear();
  relayer.slots.clear();
  relayer.down = false;
  relayer.status = 0;
  relayer.forceConflict.clear();
  relayer.puts.length = 0;
  relayer.gets = 0;
  mockPk.calls.length = 0;
  mockPk.ignoreSecond.clear();
  mockPk.createNoSecond = false;
  mockPk.attachment = undefined;
  mockPk.outputs.clear();
  mockPk.outputs.set(PHONE_ID, [b64(P1), b64(P2)]);
  mockPk.outputs.set(LINK_ID, [b64(L1), b64(L2)]);
  mockPk.discover = PHONE_ID;
  mockPk.createId = LINK_ID;
  session.lock();
  identity.set({ status: "none", keysPending: false });
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const devices = require("../lib/link/devices") as typeof import("../lib/link/devices");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deviceOps = require("../lib/link/deviceOps") as typeof import("../lib/link/deviceOps");

const NOW = 1_800_000_000;
const rootA = () => devices.devicesRootFrom(new Uint8Array(P2));

/** Browser links with the phone, like the /link screen does: passkey, code, phone sends, open, list itself. */
async function linkBrowser(label = "Chrome on a Mac") {
  const lp = await session.createLinkPasskey("Plans");
  const link = await browserLink.startBrowserLink({ b2: lp.b2, credentialId: lp.credentialId, deviceLabel: label, pollMs: 1 });
  const waiting = link.wait();
  const browserKv = new Map(mockKv);
  // phone
  mockKv.clear();
  mockPk.discover = PHONE_ID;
  await session.restoreWithPasskey();
  const phoneKv = new Map(mockKv);
  await phoneLink.sendAccountToBrowser(phoneLink.readLinkFromQr(link.qrUrl));
  session.lock();
  mockKv.clear();
  for (const [k, v] of browserKv) mockKv.set(k, v);
  const bundle = await waiting;
  await session.openFromBundle(bundle, lp.credentialId);
  await deviceOps.syncThisDevice({ kind: "browser", label, vault: deviceOps.vaultRef(lp.b2, lp.credentialId) });
  const browserState = new Map(mockKv);
  return { lp, phoneKv, browserState };
}

function useKv(state: Map<string, string>) {
  mockKv.clear();
  for (const [k, v] of state) mockKv.set(k, v);
}

describe("device list: construction", () => {
  it("derives a stable slot from the keys output; different keys, different slot", () => {
    const a = devices.devicesSlot(rootA());
    expect(a.id).toMatch(/^[0-9a-f]{64}$/);
    expect(a.auth).toMatch(/^[0-9a-f]{64}$/);
    expect(a.id).not.toBe(a.auth);
    expect(devices.devicesSlot(rootA())).toEqual(a);
    expect(devices.devicesSlot(devices.devicesRootFrom(b(0x23))).id).not.toBe(a.id);
    // matches HKDF-SHA256 from node:crypto
    const { hkdfSync } = require("node:crypto") as typeof import("node:crypto"); // eslint-disable-line @typescript-eslint/no-require-imports
    const root = Buffer.from(hkdfSync("sha256", P2, Buffer.alloc(0), "plans/v1/devices", 32));
    expect(toHex(rootA())).toBe("0x" + root.toString("hex"));
    expect(a.id).toBe(Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), "plans/v1/devices-id", 32)).toString("hex"));
  });

  it("seals and opens; another account's key, a changed byte or a moved box don't open", () => {
    const list = devices.upsertSelf(devices.emptyDevices(), { id: "a1b2c3d4e5f60718", kind: "phone", label: "Pixel 8", linked: false }, NOW)!;
    const box = devices.sealDevices(rootA(), list);
    expect(devices.openDevices(rootA(), box)).toEqual(list);
    expect(() => devices.openDevices(devices.devicesRootFrom(b(0x23)), box)).toThrow(/tampered/);
    const bad = new Uint8Array(box);
    bad[bad.length - 1] ^= 1;
    expect(() => devices.openDevices(rootA(), bad)).toThrow(/tampered/);
    expect(() => devices.openDevices(rootA(), new Uint8Array([1, 2, 3]))).toThrow(/tampered/);
  });

  it("decoding drops malformed entries and keeps caps", () => {
    const raw = { v: 1, devices: [{ id: "zz", kind: "phone", addedAt: 1 }, { id: "a1b2c3d4", kind: "browser", label: "x".repeat(200), addedAt: 2, linked: true, vault: { id: "nothex", auth: "f".repeat(64) } }], events: [{ t: 1 }, { t: 3, kind: "added", device: "a1b2c3d4", label: "x", by: "a1b2c3d4" }] };
    const l = devices.decodeDevices(new TextEncoder().encode(JSON.stringify(raw)));
    expect(l.devices).toHaveLength(1);
    expect(l.devices[0].label).toHaveLength(60);
    expect(l.devices[0].vault).toBeUndefined();
    expect(l.events).toHaveLength(1);
    let big = devices.emptyDevices();
    for (let i = 0; i < 40; i++) big = devices.upsertSelf(big, { id: `d${String(i).padStart(7, "0")}`, kind: "browser", label: `B${i}`, linked: true, vault: { id: "a".repeat(64), auth: "b".repeat(64) } }, NOW + i)!;
    expect(big.devices.length).toBe(devices.MAX_DEVICES);
    expect(big.events.length).toBe(devices.MAX_EVENTS);
    expect(big.devices.at(-1)!.label).toBe("B39"); // the oldest went first
  });

  it("REMOVED_VAULT is recognised and is never a vault box", () => {
    expect(devices.isRemovedVault(devices.REMOVED_VAULT)).toBe(true);
    expect(devices.isRemovedVault(new Uint8Array([1, ...devices.REMOVED_VAULT.slice(1)]))).toBe(false);
    expect(devices.isRemovedVault(null)).toBe(false);
    expect(devices.REMOVED_VAULT[0]).toBe(0);
  });
});

describe("device list: changes", () => {
  const me = { id: "1111111111111111", kind: "browser" as const, label: "Chrome on a Mac", linked: true, vault: { id: "a".repeat(64), auth: "b".repeat(64) } };
  const phone = { id: "2222222222222222", kind: "phone" as const, label: "Pixel 8", linked: false };

  it("a newly linked browser is added with an 'added' event; a phone joins quietly; a refresh within a day writes nothing", () => {
    let l = devices.upsertSelf(devices.emptyDevices(), phone, NOW)!;
    expect(l.events).toEqual([]);
    l = devices.upsertSelf(l, me, NOW + 5)!;
    expect(l.events).toEqual([{ t: NOW + 5, kind: "added", device: me.id, label: "Chrome on a Mac", by: me.id }]);
    expect(devices.upsertSelf(l, me, NOW + 60)).toBeNull();
    expect(devices.upsertSelf(l, me, NOW + 90_000)).not.toBeNull(); // seenAt refresh after a day
    // linked again (a new vault) is news again
    const again = devices.upsertSelf(l, { ...me, vault: { id: "c".repeat(64), auth: "d".repeat(64) } }, NOW + 100)!;
    expect(again.events.filter((e) => e.kind === "added")).toHaveLength(2);
    // the root watcher listed the browser before the link screen added its vault ref: one "added" only
    const early = devices.upsertSelf(devices.emptyDevices(), { ...me, vault: undefined }, NOW)!;
    const withVault = devices.upsertSelf(early, me, NOW + 1)!;
    expect(withVault.events.filter((e) => e.kind === "added")).toHaveLength(1);
    expect(withVault.devices[0].vault).toEqual(me.vault);
    // a later sync without the vault ref keeps the one it had
    const kept = devices.upsertSelf(l, { ...me, vault: undefined }, NOW + 200_000)!;
    expect(kept.devices.find((d) => d.id === me.id)!.vault).toEqual(me.vault);
  });

  it("markRemoved records who did it, forgets the vault auth, and only once", () => {
    let l = devices.upsertSelf(devices.upsertSelf(devices.emptyDevices(), phone, NOW)!, me, NOW)!;
    l = devices.markRemoved(l, me.id, phone.id, NOW + 10)!;
    const d = l.devices.find((x) => x.id === me.id)!;
    expect(d.removedAt).toBe(NOW + 10);
    expect(d.vault).toBeUndefined();
    expect(l.events.at(-1)).toEqual({ t: NOW + 10, kind: "removed", device: me.id, label: "Chrome on a Mac", by: phone.id });
    expect(devices.markRemoved(l, me.id, phone.id, NOW + 20)).toBeNull();
    expect(devices.activeDevices(l, phone.id).map((x) => x.id)).toEqual([phone.id]);
  });

  it("unseen events: other devices' news only, and not this device's own removals of others", () => {
    let l = devices.upsertSelf(devices.upsertSelf(devices.emptyDevices(), phone, NOW)!, me, NOW + 1)!;
    expect(devices.unseenEvents(l, phone.id, NOW)).toHaveLength(1); // the phone hears "added"
    expect(devices.unseenEvents(l, me.id, NOW)).toHaveLength(0); // the browser doesn't hear about itself
    expect(devices.unseenEvents(l, phone.id, NOW + 1)).toHaveLength(0); // already seen
    l = devices.markRemoved(l, me.id, me.id, NOW + 2)!; // the browser removes itself
    expect(devices.unseenEvents(l, phone.id, NOW + 1).map((e) => e.kind)).toEqual(["removed"]);
    const other = devices.markRemoved(devices.upsertSelf(l, { ...me, id: "3333333333333333" }, NOW + 3)!, "3333333333333333", phone.id, NOW + 4)!;
    expect(devices.unseenEvents(other, phone.id, NOW + 3)).toHaveLength(0); // the phone did that itself
  });
});

describe("linked browser, end to end with the device list", () => {
  it("linking lists the browser with its vault; the phone gets one notice on its next open", async () => {
    const { phoneKv } = await linkBrowser();
    const list = await devices.fetchDevices(rootA());
    const browser = list.devices.find((d) => d.kind === "browser")!;
    expect(browser).toMatchObject({ label: "Chrome on a Mac", linked: true });
    expect(browser.vault!.id).toBe(vaultId(fromBase64Url(LINK_ID)));
    // the relayer only ever held ciphertext for the list
    const stored = relayer.slots.get(devices.devicesSlot(rootA()).id)!;
    expect(Buffer.from(stored.data, "base64url").toString("latin1")).not.toMatch(/Chrome|Mac/);

    // Phone opens Plans again: it takes its place, then sees the notice once.
    session.lock();
    useKv(phoneKv);
    mockPk.discover = PHONE_ID;
    await session.unlockStored();
    const first = (await deviceOps.syncThisDevice({ kind: "phone", label: "Pixel 8" }))!;
    const myId = deviceOps.devicesStore.get().myId!;
    // first read on a device remembers where it is; the event happened before → set the mark in the past to model "seen before linking"
    mockKv.set(`plans.devices.seen.${phoneAddress.toLowerCase()}`, String(browser.addedAt - 1));
    const notices = await deviceOps.takeDeviceNotices(first, phoneAddress, myId);
    expect(notices.map((n) => [n.kind, n.label])).toEqual([["added", "Chrome on a Mac"]]);
    expect(await deviceOps.takeDeviceNotices(first, phoneAddress, myId)).toEqual([]);
  });

  it("a device's first read of the list doesn't replay old history", async () => {
    await linkBrowser();
    const list = await devices.fetchDevices(rootA());
    expect(await deviceOps.takeDeviceNotices(list, phoneAddress, "9999999999999999")).toEqual([]);
  });

  it("the phone removes the browser (passkey confirmation on the phone): its vault is overwritten and it can't open the account again", async () => {
    const { phoneKv, browserState } = await linkBrowser();
    // phone
    session.lock();
    useKv(phoneKv);
    await session.unlockStored();
    await deviceOps.syncThisDevice({ kind: "phone", label: "Pixel 8" });
    const target = (await devices.fetchDevices(rootA())).devices.find((d) => d.kind === "browser")!;
    mockPk.calls.length = 0;
    const r = await deviceOps.removeDevice(target);
    expect(r).toEqual({ self: false });
    // one fresh ceremony pinned to the PHONE's passkey
    expect(mockPk.calls.map((c) => c.kind)).toEqual(["get"]);
    expect(mockPk.calls[0].req.allowCredentials?.[0].id).toBe(PHONE_ID);
    expect(identity.get().status).toBe("unlocked"); // the phone stays as it is
    const vault = relayer.slots.get(vaultId(fromBase64Url(LINK_ID)))!;
    expect(devices.isRemovedVault(fromBase64Url(vault.data))).toBe(true);
    const after = await devices.fetchDevices(rootA());
    expect(after.devices.find((d) => d.id === target.id)!.removedAt).toBeDefined();
    expect(after.events.at(-1)).toMatchObject({ kind: "removed", label: "Chrome on a Mac" });

    // the browser, later: Unlock → "removed", nothing opened
    session.lock();
    useKv(browserState);
    const e = await session.unlockStored().catch((x) => x);
    expect(session.isLinkedBrowserError(e) && e.reason).toBe("removed");
    expect(identity.get().status).not.toBe("unlocked");
    // and a discoverable sign-in with its passkey (another browser where it synced) is refused too
    mockKv.clear();
    mockPk.discover = LINK_ID;
    const e2 = await session.restoreWithPasskey().catch((x) => x);
    expect(session.isLinkedBrowserError(e2) && e2.reason).toBe("removed");
    expect(identity.get().status).not.toBe("unlocked");
  });

  it("a browser removing itself: its own passkey confirms, its vault goes, it's signed out", async () => {
    const { browserState } = await linkBrowser();
    useKv(browserState);
    const myId = await deviceOps.myDeviceId();
    const me = (await devices.fetchDevices(rootA())).devices.find((d) => d.id === myId)!;
    mockPk.calls.length = 0;
    // even if its list entry had lost the vault ref, the browser's own passkey gives it
    const r = await deviceOps.removeDevice({ ...me, vault: undefined });
    expect(r).toEqual({ self: true });
    expect(mockPk.calls[0].req.allowCredentials?.[0].id).toBe(LINK_ID);
    expect(devices.isRemovedVault(fromBase64Url(relayer.slots.get(vaultId(fromBase64Url(LINK_ID)))!.data))).toBe(true);
    expect(identity.get().status).toBe("none");
    expect(await storage.loadAccount()).toBeNull();
  });

  it("removing needs the passkey: a closed prompt changes nothing", async () => {
    const { phoneKv } = await linkBrowser();
    session.lock();
    useKv(phoneKv);
    await session.unlockStored();
    const target = (await devices.fetchDevices(rootA())).devices.find((d) => d.kind === "browser")!;
    const getter = jest.requireMock("react-native-passkey").Passkey;
    const orig = getter.getPlatformKey;
    getter.getPlatformKey = async () => {
      throw { error: "UserCancelled", message: "closed" };
    };
    try {
      await expect(deviceOps.removeDevice(target)).rejects.toMatchObject({ kind: "cancelled" });
    } finally {
      getter.getPlatformKey = orig;
    }
    expect(devices.isRemovedVault(fromBase64Url(relayer.slots.get(vaultId(fromBase64Url(LINK_ID)))!.data))).toBe(false);
    expect((await devices.fetchDevices(rootA())).devices.find((d) => d.id === target.id)!.removedAt).toBeUndefined();
  });

  it("a device using the account's own passkey can't be 'removed'", async () => {
    await session.restoreWithPasskey();
    await deviceOps.syncThisDevice({ kind: "phone", label: "Pixel 8" });
    const me = (await devices.fetchDevices(rootA())).devices[0];
    await expect(deviceOps.removeDevice(me)).rejects.toThrow(/Only a linked browser/);
  });

  it("a linked browser whose vault is gone is 'gone' (→ 166), not a different account", async () => {
    const { browserState } = await linkBrowser();
    useKv(browserState);
    session.lock();
    relayer.slots.delete(vaultId(fromBase64Url(LINK_ID)));
    const e = await session.unlockStored().catch((x) => x);
    expect(session.isLinkedBrowserError(e) && e.reason).toBe("gone");
  });
});

describe("176a: the phone's passkey over the browser's QR without the keys output", () => {
  it("requireKeys: true refuses an answer without `second` and saves nothing", async () => {
    mockPk.ignoreSecond.add(PHONE_ID);
    await expect(session.findExistingAccount({ hints: ["hybrid"], requireKeys: true })).rejects.toMatchObject({ kind: "prf-unavailable" });
    expect(identity.get().status).toBe("none");
    expect(await storage.loadAccount()).toBeNull();
  });

  it("'cross-device' only refuses when the passkey came from another device", async () => {
    mockPk.ignoreSecond.add(PHONE_ID);
    mockPk.attachment = "cross-platform";
    await expect(session.findExistingAccount({ requireKeys: "cross-device" })).rejects.toMatchObject({ kind: "prf-unavailable" });
    expect(await storage.loadAccount()).toBeNull();
    mockPk.attachment = "platform";
    await expect(session.findExistingAccount({ requireKeys: "cross-device" })).resolves.toMatchObject({ kind: "restored" });
    expect(identity.get()).toMatchObject({ status: "unlocked", keysPending: true });
  });

  it("with both outputs the phone's passkey opens the same account", async () => {
    mockPk.attachment = "cross-platform";
    await expect(session.findExistingAccount({ hints: ["hybrid"], requireKeys: true })).resolves.toMatchObject({ kind: "restored", linked: false });
    expect(identity.get().address).toBe(phoneAddress);
    expect(session.currentDevicesRoot()).not.toBeNull();
    session.lock();
    expect(session.currentDevicesRoot()).toBeNull();
  });
});

describe("link screens' helpers", () => {
  it("a scanned QR gets the browser's label from its offer, only when it's the same link", async () => {
    const link = await browserLink.startBrowserLink({ deviceLabel: "Safari on an iPhone", pollMs: 1 });
    const offer = phoneLink.readLinkFromQr(link.qrUrl);
    expect(await phoneLink.labelForQrOffer(offer)).toBe("Safari on an iPhone");
    const other = await browserLink.startBrowserLink({ deviceLabel: "Edge on Windows", pollMs: 1 });
    // same secret, a different one-time key → no label
    expect(await phoneLink.labelForQrOffer({ ...offer, linkPub: phoneLink.readLinkFromQr(other.qrUrl).linkPub })).toBeUndefined();
    relayer.down = true;
    expect(await phoneLink.labelForQrOffer(offer)).toBeUndefined();
    link.cancel();
    other.cancel();
  });

  it("wait() reports a lost connection and keeps waiting, then 'online' again", async () => {
    const link = await browserLink.startBrowserLink({ pollMs: 1 });
    const seen: string[] = [];
    relayer.down = true;
    const p = link.wait(undefined, (s) => {
      seen.push(s);
      if (seen.length === 3) relayer.down = false;
      if (s === "online") link.cancel();
    });
    await expect(p).rejects.toMatchObject({ kind: "expired" });
    expect(seen.slice(0, 3)).toEqual(["offline", "offline", "offline"]);
    expect(seen).toContain("online");
  });

  it("the code never appears in the QR's path or query, only after '#'", async () => {
    const link = await browserLink.startBrowserLink({ pollMs: 1 });
    const u = new URL(link.qrUrl);
    expect(u.pathname).toBe("/app/link");
    expect(u.search).toBe("");
    expect(u.hash).toContain(`c=${link.code}`);
    link.cancel();
  });
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cas = require("../lib/link/cas") as typeof import("../lib/link/cas");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const watch = require("../lib/link/removalWatch") as typeof import("../lib/link/removalWatch");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const api = require("../lib/api/relayer") as typeof import("../lib/api/relayer");

describe("concurrent changes to the device list (rev / ifRev)", () => {
  const listSlot = () => devices.devicesSlot(rootA()).id;
  const vaultSlot = () => vaultId(fromBase64Url(LINK_ID));

  it("every list write is conditional (ifRev = the rev it read)", async () => {
    await linkBrowser();
    const writes = relayer.puts.filter((p) => p.id === listSlot());
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w.ifRev).toEqual(expect.any(Number));
    expect(relayer.slots.get(listSlot())!.rev).toBe(writes.filter((w) => w.status < 300).length);
  });

  it("a conflict on the list is re-read and the same change applied again: both changes survive", async () => {
    const { phoneKv } = await linkBrowser();
    session.lock();
    useKv(phoneKv);
    await session.unlockStored();
    // Another device lists itself between the phone's read and its write (once).
    const realFetch = (globalThis as unknown as { fetch: jest.Mock }).fetch;
    const impl = realFetch.getMockImplementation()!;
    let injected = false;
    realFetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (!injected && init.method === "PUT" && url.endsWith(listSlot())) {
        injected = true;
        await devices.updateDevices(rootA(), (l) => devices.upsertSelf(l, { id: "abcdefabcdef0001", kind: "browser", label: "Firefox on Linux", linked: false }, NOW));
      }
      return impl(url, init);
    });
    try {
      await deviceOps.syncThisDevice({ kind: "phone", label: "Pixel 8" });
    } finally {
      realFetch.mockImplementation(impl);
    }
    const conflicts = relayer.puts.filter((p) => p.id === listSlot() && p.status === 409);
    expect(conflicts).toHaveLength(1);
    const ids = (await devices.fetchDevices(rootA())).devices.map((d) => d.label);
    expect(ids).toEqual(expect.arrayContaining(["Chrome on a Mac", "Firefox on Linux", "Pixel 8"]));
  });

  it("removal: a conflict on the vault marker is retried; the browser ends up removed", async () => {
    const { phoneKv } = await linkBrowser();
    session.lock();
    useKv(phoneKv);
    await session.unlockStored();
    const target = (await devices.fetchDevices(rootA())).devices.find((d) => d.kind === "browser")!;
    const realFetch = (globalThis as unknown as { fetch: jest.Mock }).fetch;
    const impl = realFetch.getMockImplementation()!;
    let once = false;
    realFetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (!once && init.method === "PUT" && url.endsWith(vaultSlot())) {
        once = true;
        const v = relayer.slots.get(vaultSlot())!;
        relayer.slots.set(vaultSlot(), { ...v, rev: v.rev + 1 }); // someone wrote the vault meanwhile
      }
      return impl(url, init);
    });
    try {
      await deviceOps.removeDevice(target);
    } finally {
      realFetch.mockImplementation(impl);
    }
    expect(relayer.puts.filter((p) => p.id === vaultSlot()).map((p) => p.status)).toEqual([201, 409, 200]);
    expect(devices.isRemovedVault(fromBase64Url(relayer.slots.get(vaultSlot())!.data))).toBe(true);
    expect((await devices.fetchDevices(rootA())).devices.find((d) => d.id === target.id)!.removedAt).toBeDefined();
  });

  it("removal: when the list keeps conflicting after the marker landed, the browser stays removed; 'Try again' re-runs only the list edit", async () => {
    const { phoneKv } = await linkBrowser();
    session.lock();
    useKv(phoneKv);
    await session.unlockStored();
    await deviceOps.syncThisDevice({ kind: "phone", label: "Pixel 8" });
    const target = (await devices.fetchDevices(rootA())).devices.find((d) => d.kind === "browser")!;
    const listBefore = relayer.slots.get(listSlot())!.data;
    relayer.forceConflict.add(listSlot());
    const e = await deviceOps.removeDevice(target).catch((x) => x);
    expect(deviceOps.isRemovedListBehindError(e)).toBe(true);
    expect(e.friendly).toBe(
      "That browser is removed. Your device list didn't update because it changed on another device at the same moment — it may still show that browser until you try again.",
    );
    expect(relayer.puts.filter((p) => p.id === listSlot() && p.status === 409)).toHaveLength(cas.CAS_ATTEMPTS);
    expect(relayer.slots.get(listSlot())!.data).toBe(listBefore);
    // no rollback: the browser is shut out
    expect(devices.isRemovedVault(fromBase64Url(relayer.slots.get(vaultSlot())!.data))).toBe(true);
    expect(identity.get().status).toBe("unlocked");
    // "Try again" while it still conflicts: the same situation, no passkey prompt
    mockPk.calls.length = 0;
    await expect(deviceOps.retryRemovalList(target)).rejects.toBeInstanceOf(cas.SlotConflictError);
    // once the race is over: only the list edit runs (no passkey prompt, no vault write)
    relayer.forceConflict.clear();
    const vaultPuts = relayer.puts.filter((p) => p.id === vaultSlot()).length;
    expect(await deviceOps.retryRemovalList(target)).toEqual({ self: false });
    expect(mockPk.calls).toHaveLength(0);
    expect(relayer.puts.filter((p) => p.id === vaultSlot())).toHaveLength(vaultPuts);
    expect((await devices.fetchDevices(rootA())).devices.find((d) => d.id === target.id)!.removedAt).toBeDefined();
  }, 20_000);

  it("removal: when the marker write itself keeps conflicting, 'Nothing was changed here' and nothing changed", async () => {
    const { phoneKv } = await linkBrowser();
    session.lock();
    useKv(phoneKv);
    await session.unlockStored();
    const target = (await devices.fetchDevices(rootA())).devices.find((d) => d.kind === "browser")!;
    const vaultBefore = relayer.slots.get(vaultSlot())!.data;
    const listBefore = relayer.slots.get(listSlot())!.data;
    relayer.forceConflict.add(vaultSlot());
    const e = await deviceOps.removeDevice(target).catch((x) => x);
    expect(cas.isSlotConflictError(e)).toBe(true);
    expect(e.friendly).toBe("Your devices changed on another device at the same moment. Nothing was changed here — try again.");
    expect(relayer.slots.get(vaultSlot())!.data).toBe(vaultBefore);
    expect(relayer.slots.get(listSlot())!.data).toBe(listBefore);
  }, 20_000);
});

describe("a removed browser's open tab locks itself", () => {
  const vaultSlot = () => vaultId(fromBase64Url(LINK_ID));
  const markRemoved = () => {
    const v = relayer.slots.get(vaultSlot())!;
    relayer.slots.set(vaultSlot(), { ...v, data: toBase64Url(devices.REMOVED_VAULT), rev: v.rev + 1 });
  };
  beforeEach(() => watch.resetRemovalWatch());

  it("the check: present → nothing; removed marker → locked, signed out, stored account gone, BrowserRemovedError", async () => {
    await linkBrowser();
    expect(identity.get().status).toBe("unlocked");
    await watch.ensureNotRemoved({ maxAgeMs: 0 });
    expect(identity.get().status).toBe("unlocked");
    markRemoved();
    const e = await watch.ensureNotRemoved({ maxAgeMs: 0 }).catch((x) => x);
    expect(watch.isBrowserRemovedError(e)).toBe(true);
    expect(identity.get().status).toBe("none");
    expect(session.currentKeys()).toBeNull();
    expect(session.currentDevicesRoot()).toBeNull();
    expect(await storage.loadAccount()).toBeNull();
    expect(watch.browserRemoved.get()).toBe(true);
  });

  it("an action right after removal is refused before anything is signed or relayed, and locks", async () => {
    await linkBrowser();
    const acct = session.currentAccount();
    await expect(acct.signMessage({ message: "hello" })).resolves.toMatch(/^0x/);
    markRemoved();
    watch.resetRemovalWatch(); // the last passed check is older than the cache
    await expect(acct.signMessage({ message: "hello" })).rejects.toBeInstanceOf(watch.BrowserRemovedError);
    expect(identity.get().status).toBe("none");
    expect(() => session.currentAccount()).toThrow();
  });

  it("relaying is refused too (no request reaches /v1/relay)", async () => {
    await linkBrowser();
    markRemoved();
    const before = (globalThis as unknown as { fetch: jest.Mock }).fetch.mock.calls.length;
    await expect(api.relay("vote", {})).rejects.toBeInstanceOf(watch.BrowserRemovedError);
    const urls = (globalThis as unknown as { fetch: jest.Mock }).fetch.mock.calls.slice(before).map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/v1/relay"))).toBe(false);
  });

  it("a passed check is trusted for a few seconds (no request per keystroke)", async () => {
    await linkBrowser();
    await watch.ensureNotRemoved();
    const n = relayer.gets;
    await watch.ensureNotRemoved();
    await watch.ensureNotRemoved();
    expect(relayer.gets).toBe(n);
    await watch.ensureNotRemoved({ maxAgeMs: 0 });
    expect(relayer.gets).toBe(n + 1);
  });

  it("never locks on network trouble, a server error or a missing vault (offline ≠ removed)", async () => {
    await linkBrowser();
    relayer.down = true;
    await watch.ensureNotRemoved({ maxAgeMs: 0 });
    relayer.down = false;
    relayer.status = 503;
    await watch.ensureNotRemoved({ maxAgeMs: 0 });
    relayer.status = 0;
    relayer.slots.delete(vaultSlot());
    await watch.ensureNotRemoved({ maxAgeMs: 0 });
    expect(identity.get().status).toBe("unlocked");
    expect(await storage.loadAccount()).not.toBeNull();
  });

  it("a device using the account's own passkey never checks", async () => {
    await session.restoreWithPasskey();
    const n = relayer.gets;
    await watch.ensureNotRemoved({ maxAgeMs: 0 });
    await session.currentAccount().signMessage({ message: "x" });
    expect(relayer.gets).toBe(n);
  });

  it("a removed browser's open tab doesn't list itself again; it locks instead", async () => {
    await linkBrowser();
    markRemoved();
    const list0 = relayer.slots.get(devices.devicesSlot(rootA()).id)!.data;
    await expect(deviceOps.syncThisDevice({ kind: "browser", label: "Chrome on a Mac" })).rejects.toBeInstanceOf(watch.BrowserRemovedError);
    expect(relayer.slots.get(devices.devicesSlot(rootA()).id)!.data).toBe(list0);
    expect(identity.get().status).toBe("none");
  });

  it("the watcher checks on focus, on becoming visible and on its interval only while visible; then locks", async () => {
    await linkBrowser();
    const listeners: Record<string, (() => void)[]> = {};
    const add = (t: string, f: () => void) => (listeners[t] ??= []).push(f);
    const g = globalThis as Record<string, unknown>;
    const doc = { visibilityState: "visible", addEventListener: add, removeEventListener: jest.fn() };
    g.document = doc;
    g.window = { addEventListener: add, removeEventListener: jest.fn() };
    const settle = () => new Promise((r) => setTimeout(r, 20));
    const stop = watch.startRemovalWatch({ pollMs: 60 });
    try {
      let n = relayer.gets;
      listeners.focus[0]();
      await settle();
      expect(relayer.gets).toBe(n + 1);
      watch.resetRemovalWatch();
      n = relayer.gets;
      listeners.visibilitychange[0]();
      await settle();
      expect(relayer.gets).toBe(n + 1);
      // hidden: the interval doesn't read
      doc.visibilityState = "hidden";
      watch.resetRemovalWatch();
      n = relayer.gets;
      await new Promise((r) => setTimeout(r, 150));
      expect(relayer.gets).toBe(n);
      // visible again, and removed meanwhile: the interval finds it and the tab locks without any action
      markRemoved();
      doc.visibilityState = "visible";
      await new Promise((r) => setTimeout(r, 150));
      expect(identity.get().status).toBe("none");
      expect(watch.browserRemoved.get()).toBe(true);
    } finally {
      stop();
      delete g.document;
      delete g.window;
    }
  });
});
