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

// ─────────────── relayer slots (in memory) ───────────────
const relayer = { slots: new Map<string, { data: string; expiresAt: number | null; auth?: string }>(), down: false, status: 0 };
const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body), headers: new Headers() }) as unknown as Response;
(globalThis as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
  if (relayer.down) throw new TypeError("Failed to fetch");
  if (relayer.status) return json(relayer.status, { error: { code: "INTERNAL" } });
  const id = /\/v1\/slots\/(.+)$/.exec(url)![1];
  if ((init.method ?? "GET") === "PUT") {
    const body = JSON.parse(String(init.body));
    const cur = relayer.slots.get(id);
    if (cur && (!cur.auth || cur.auth !== body.auth)) return json(409, { error: { code: "SLOT_TAKEN" } });
    relayer.slots.set(id, { data: body.data, expiresAt: body.ttl ? Math.floor(Date.now() / 1000) + body.ttl : null, auth: body.auth });
    return json(cur ? 200 : 201, { created: !cur });
  }
  const cur = relayer.slots.get(id);
  return cur ? json(200, { data: cur.data, expiresAt: cur.expiresAt }) : json(404, { error: { code: "NOT_FOUND" } });
});

beforeEach(async () => {
  mockKv.clear();
  relayer.slots.clear();
  relayer.down = false;
  relayer.status = 0;
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
