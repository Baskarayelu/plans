/**
 * Session-level linking: vault-aware restore/unlock, the browser's link passkey, and the phone →
 * browser hand-over end to end (passkey, storage and relayer mocked).
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
      return { id, rawId: id, response: {}, clientExtensionResults: { prf: { results } } };
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
  const id = /\/v1\/slots\/([^?]+)/.exec(url)![1];
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
  mockPk.outputs.clear();
  mockPk.outputs.set(PHONE_ID, [b64(P1), b64(P2)]);
  mockPk.outputs.set(LINK_ID, [b64(L1), b64(L2)]);
  mockPk.discover = PHONE_ID;
  mockPk.createId = LINK_ID;
  session.lock();
  identity.set({ status: "none", keysPending: false });
});

/** The phone's side: signs in with its own passkey, then answers a browser link. */
async function phoneSendsTo(link: { qrUrl: string }) {
  mockKv.clear();
  mockPk.discover = PHONE_ID;
  await session.restoreWithPasskey();
  const offer = phoneLink.readLinkFromQr(link.qrUrl);
  return phoneLink.sendAccountToBrowser(offer);
}

describe("link end to end", () => {
  it("browser link passkey → QR → phone sends → browser opens the SAME account and keeps it via the vault", async () => {
    // Browser: its own passkey (no session opened).
    const lp = await session.createLinkPasskey("Leah");
    expect(lp.credentialId).toBe(LINK_ID);
    expect(toHex(lp.b2)).toBe(toHex(L2));
    expect(identity.get().status).toBe("none");
    // its user handle is marked as a link passkey
    const handle = fromBase64Url(mockPk.calls[0].req.user!.id);
    expect(Buffer.from(handle.slice(0, 14)).toString()).toBe("plans-link/v1:");

    const link = await browserLink.startBrowserLink({ b2: lp.b2, credentialId: lp.credentialId, deviceLabel: "Safari on Mac", pollMs: 1 });
    const waiting = link.wait();

    // Phone (a different store in reality; here we swap the kv contents around the call).
    const browserKv = new Map(mockKv);
    const sent = await phoneSendsTo(link);
    expect(sent.address).toBe(phoneAddress);
    expect(sent.fingerprint).toBe(phoneFp);
    // the phone's send ran a fresh ceremony pinned to its own credential
    const lastGet = mockPk.calls.filter((c) => c.kind === "get").pop()!;
    expect(lastGet.req.allowCredentials?.[0].id).toBe(PHONE_ID);
    session.lock();
    mockKv.clear();
    for (const [k, v] of browserKv) mockKv.set(k, v);

    const bundle = await waiting;
    await session.openFromBundle(bundle, lp.credentialId);
    expect(identity.get()).toMatchObject({ status: "unlocked", address: phoneAddress, fingerprint: phoneFp, credentialId: LINK_ID });
    expect(session.currentAccount().address).toBe(phoneAddress);
    expect((await storage.loadAccount())!.vault).toBe(true);
    expect(bundle.accountKey.every((x) => x === 0)).toBe(true); // consumed

    // Later: unlock in this browser → pinned to the link passkey → vault → same account.
    session.lock();
    await session.unlockStored();
    expect(identity.get()).toMatchObject({ status: "unlocked", address: phoneAddress });
    expect(mockPk.calls.at(-1)!.req.allowCredentials?.[0].id).toBe(LINK_ID);

    // Another browser with the synced link passkey: discoverable restore finds the vault.
    session.lock();
    mockKv.clear();
    mockPk.discover = LINK_ID;
    const r = await session.restoreWithPasskey();
    expect(r.linked).toBe(true);
    expect(identity.get().address).toBe(phoneAddress);
    expect(identity.get().address).not.toBe(linkFirstAddress);
  });
});

describe("vault-aware sign-in", () => {
  it("restore without a vault (404) opens the passkey's own account", async () => {
    const r = await session.restoreWithPasskey();
    expect(r).toEqual({ isNew: true, linked: false });
    expect(identity.get().address).toBe(phoneAddress);
    expect((await storage.loadAccount())!.vault).toBeUndefined();
  });

  it("restore whose vault lookup fails (not a 404) throws instead of falling back", async () => {
    relayer.status = 500;
    await expect(session.restoreWithPasskey()).rejects.toMatchObject({ kind: "failed" });
    expect(identity.get().status).not.toBe("unlocked");
    relayer.status = 0;
    relayer.down = true;
    await expect(session.findExistingAccount({ hints: ["hybrid"] })).rejects.toMatchObject({ kind: "failed" });
  });

  it("findExistingAccount passes hints and reports a restored account", async () => {
    const r = await session.findExistingAccount({ hints: ["hybrid"] });
    expect(r).toMatchObject({ kind: "restored", linked: false });
    expect((mockPk.calls[0].req as { hints?: string[] }).hints).toEqual(["hybrid"]);
  });

  it("a vault account whose vault is gone fails clearly on unlock", async () => {
    const lp = await session.createLinkPasskey("Leah");
    const bundle = bundleFromPrf(P1, P2, undefined);
    await browserLink.saveVault(bundle, lp.b2, lp.credentialIdBytes);
    await session.openFromBundle(bundle, lp.credentialId);
    session.lock();
    relayer.slots.delete(vaultId(fromBase64Url(LINK_ID)));
    const e = (await session.unlockStored().catch((x) => x)) as PasskeyError;
    expect(e.kind).toBe("failed");
    expect(e.detail).toMatch(/Link this browser again/);
    expect(identity.get().status).not.toBe("unlocked");
  });

  it("a vault account without a `second` PRF output falls back to one keys-only ceremony", async () => {
    const lp = await session.createLinkPasskey("Leah");
    const bundle = bundleFromPrf(P1, P2, undefined);
    await browserLink.saveVault(bundle, lp.b2, lp.credentialIdBytes);
    await session.openFromBundle(bundle, lp.credentialId);
    session.lock();
    mockPk.ignoreSecond.add(LINK_ID);
    mockPk.calls.length = 0;
    await session.unlockStored();
    expect(mockPk.calls.map((c) => c.kind)).toEqual(["get", "get"]);
    expect(mockPk.calls[1].req.extensions?.prf?.eval?.second).toBeUndefined();
    expect(identity.get()).toMatchObject({ status: "unlocked", address: phoneAddress });
  });

  it("createLinkPasskey without a create-time `second` runs one pinned get for both salts", async () => {
    mockPk.createNoSecond = true; // the create gives no second; the follow-up get does
    const lp = await session.createLinkPasskey("Leah");
    expect(mockPk.calls.map((c) => c.kind)).toEqual(["create", "get"]);
    expect(mockPk.calls[1].req.allowCredentials?.[0].id).toBe(LINK_ID);
    expect(toHex(lp.b2)).toBe(toHex(L2));
    expect(identity.get().status).toBe("none");
  });

  it("a link passkey whose vault is gone is not silently opened as its own account (web user handle)", async () => {
    // discoverable sign-in picks the link passkey; there's no vault; the bridge reports its handle
    const pb = require("../lib/identity/passkeyBridge") as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-require-imports
    pb.takeLastUserHandle = () => toBase64Url(new Uint8Array([...Buffer.from("plans-link/v1:"), ...new Uint8Array(18)]));
    mockPk.discover = LINK_ID;
    try {
      const e = (await session.restoreWithPasskey().catch((x) => x)) as PasskeyError;
      expect(e.kind).toBe("failed");
      expect(identity.get().status).not.toBe("unlocked");
    } finally {
      delete pb.takeLastUserHandle;
    }
  });
});

describe("phone side", () => {
  it("refuses to send when the passkey's account isn't the one stored on this device", async () => {
    await session.restoreWithPasskey();
    const prev = (await storage.loadAccount())!;
    await storage.saveAccount({ ...prev, address: "0x000000000000000000000000000000000000dEaD" });
    const link = await browserLink.startBrowserLink({ pollMs: 1 });
    const e = (await phoneLink.sendAccountToBrowser(phoneLink.readLinkFromQr(link.qrUrl)).catch((x) => x)) as LinkError;
    expect(e.kind).toBe("wrong-account");
    expect(relayer.slots.has(slotIds(linkSecretFromCode(link.code)).reply)).toBe(false);
    link.cancel();
  });

  it("a typed code finds the offer; a second send to the same link is 'used'", async () => {
    await session.restoreWithPasskey();
    const link = await browserLink.startBrowserLink({ deviceLabel: "Firefox on Linux", pollMs: 1 });
    const offer = await phoneLink.fetchOfferByCode(link.displayCode.toLowerCase());
    expect(offer.deviceLabel).toBe("Firefox on Linux");
    expect(offer.fingerprint).toBe(link.fingerprint);
    await phoneLink.sendAccountToBrowser({ ...offer, s: new Uint8Array(offer.s) });
    const e = (await phoneLink.sendAccountToBrowser(offer).catch((x) => x)) as LinkError;
    expect(e.kind).toBe("used");
    await expect(phoneLink.fetchOfferByCode("ZZZZ-ZZZZ-ZZZZ")).rejects.toMatchObject({ kind: "not-found" });
    link.cancel();
  });
});
