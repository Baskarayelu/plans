import { createECDH, randomBytes } from "node:crypto";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import webpush from "web-push";
import { describe, expect, it, vi } from "vitest";
import { createApp, type AppServices } from "../../src/app.js";
import { parseWebPush, Secret } from "../../src/config.js";
import type { ChainEvent } from "../../src/listener.js";
import { PushDispatcher, pushRegisterMessage } from "../../src/push.js";
import { Store } from "../../src/store.js";
import {
  isAllowedEndpoint,
  verifyWebPushRegistration,
  WebPush,
  webPushRegisterMessage,
  webRouteFor,
  type WebPushConfig,
  type WebPushSend,
  type WebSubscription,
} from "../../src/webpush.js";

const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const other = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const realClient = { verifyMessage: (args: Parameters<typeof verifyMessage>[0]) => verifyMessage(args) };
const POT = getAddress("0x9000000000000000000000000000000000000009");
const A = getAddress("0x00000000000000000000000000000000000000a1");
const B = getAddress("0x00000000000000000000000000000000000000b2");
const C = getAddress("0x00000000000000000000000000000000000000c3");

const vapid = webpush.generateVAPIDKeys();
const CFG: WebPushConfig = { publicKey: vapid.publicKey, privateKey: new Secret(vapid.privateKey), subject: "mailto:ops@plans.0xo.in" };

/** A real-looking browser subscription: a P-256 public key and a 16-byte auth secret. */
function subscription(endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString("hex")}`): WebSubscription {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
}

async function signed(signer = acct, sub = subscription(), deadline = Math.floor(Date.now() / 1000) + 600, address: Address = signer.address) {
  const signature = await signer.signMessage({ message: webPushRegisterMessage(address, sub, deadline) });
  return { address, subscription: sub, deadline, signature };
}

const ev = (name: string, args: Record<string, unknown>, live = true): ChainEvent => ({
  name, args, address: POT, blockNumber: 1n, logIndex: 0, txHash: ("0x" + "ee".repeat(32)) as Hex, live,
});

function setupStore() {
  const s = new Store(":memory:");
  s.upsertPot({ address: POT, creator: A, startTime: 0, endTime: 10, reviewWindow: 0, createdBlock: 1 });
  for (const [i, m] of [A, B, C].entries()) s.upsertMember(POT, m, "GB", i);
  return s;
}

function buildApp(cfg: WebPushConfig | null = CFG, client: unknown = realClient) {
  const store = new Store(":memory:");
  const webPush = new WebPush(store.db, cfg, cfg ? vi.fn<WebPushSend>() : null);
  const services = {
    cfg: {
      chainId: 10143,
      chainName: "Monad Testnet",
      isMainnet: false,
      push: { enabled: true, url: "x" },
      http: { bodyLimit: 64 * 1024, corsOrigins: ["https://plans.0xo.in"], trustProxy: true, ipPerMin: 100, addressPerMin: 2, createPotPerIpPerDay: 30 },
    },
    client,
    store,
    push: new PushDispatcher(store, { enabled: false, url: "x" }),
    webPush,
  } as unknown as AppServices;
  return { app: createApp(services), store, webPush };
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { "content-type": "application/json", origin: "https://plans.0xo.in" } });

describe("web push registration (same proof as Expo push)", () => {
  it("accepts a fresh signature by the account over the subscription", async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = await signed(acct, subscription(), now + 600);
    const r = await verifyWebPushRegistration(realClient as never, { ...body, address: acct.address.toLowerCase() }, now);
    expect(r.address).toBe(acct.address);
    expect(webPushRegisterMessage(acct.address, body.subscription, now + 600)).toBe(
      `Plans web push notifications\nAddress: ${acct.address}\nEndpoint: ${body.subscription.endpoint}\nKeys: ${body.subscription.keys.p256dh} ${body.subscription.keys.auth}\nDeadline: ${now + 600}`,
    );
  });

  it("rejects someone else's account, swapped subscriptions, expired and far deadlines", async () => {
    const now = Math.floor(Date.now() / 1000);
    // other signs, but claims acct's account
    const forged = await signed(other, subscription(), now + 600, acct.address);
    await expect(verifyWebPushRegistration(realClient as never, forged, now)).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
    // a valid proof replayed with a different endpoint or keys
    const good = await signed(acct, subscription(), now + 600);
    await expect(verifyWebPushRegistration(realClient as never, { ...good, subscription: subscription() }, now)).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
    await expect(
      verifyWebPushRegistration(realClient as never, { ...good, subscription: { ...good.subscription, keys: subscription().keys } }, now),
    ).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
    await expect(verifyWebPushRegistration(realClient as never, good, now + 601)).rejects.toMatchObject({ code: "EXPIRED" });
    const far = await signed(acct, subscription(), now + 90_000);
    await expect(verifyWebPushRegistration(realClient as never, far, now)).rejects.toMatchObject({ code: "DEADLINE_TOO_FAR" });
    // an Expo registration signature is not a web registration signature
    const expoSig = await acct.signMessage({ message: pushRegisterMessage(acct.address, "ExponentPushToken[abcdefghijkl]", now + 600) });
    await expect(verifyWebPushRegistration(realClient as never, { ...good, signature: expoSig }, now)).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
  });

  it("fails closed when the signature can't be checked", async () => {
    const body = await signed();
    await expect(verifyWebPushRegistration({} as never, body)).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
  });

  it("only accepts push-service endpoints and well-formed keys", async () => {
    expect(isAllowedEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedEndpoint("https://web.push.apple.com/QM8abc")).toBe(true);
    expect(isAllowedEndpoint("https://wns2-par02p.notify.windows.com/w/?token=abc")).toBe(true);
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilpush.apple.com.example/x",
      "https://169.254.169.254/latest",
      "https://localhost/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "not a url",
    ]) {
      expect(isAllowedEndpoint(bad), bad).toBe(false);
    }
    const ssrf = await signed(acct, subscription("http://relayer.railway.internal:8080/v1/faucet"));
    await expect(verifyWebPushRegistration(realClient as never, ssrf)).rejects.toThrow(/push service/);
    const sub = subscription();
    const shortKey = await signed(acct, { ...sub, keys: { ...sub.keys, auth: randomBytes(8).toString("base64url") } });
    await expect(verifyWebPushRegistration(realClient as never, shortKey)).rejects.toThrow(/16 bytes/);
  });
});

describe("web push HTTP routes", () => {
  it("publishes the VAPID public key in /v1/config and keeps the existing fields", async () => {
    const { app } = buildApp();
    const j = (await (await app.request("/v1/config")).json()) as Record<string, unknown>;
    expect(j).toEqual({ chainId: 10143, graphqlUrl: null, webPushPublicKey: CFG.publicKey });
    const off = (await (await buildApp(null).app.request("/v1/config")).json()) as Record<string, unknown>;
    expect(off.webPushPublicKey).toBeNull();
  });

  it("stores a subscription only with the account's own proof", async () => {
    const { app, webPush } = buildApp();
    const body = await signed();
    const ok = await app.request("/v1/push/web", json("POST", body));
    expect(ok.status).toBe(200);
    expect(webPush.store.forAddresses([acct.address])).toEqual([{ address: acct.address, ...body.subscription }]);

    const forged = await signed(other, subscription(), undefined, B);
    const bad = await app.request("/v1/push/web", json("POST", forged));
    expect(bad.status).toBe(401);
    expect(webPush.store.forAddresses([B])).toEqual([]);

    const noSig = await app.request("/v1/push/web", json("POST", { address: B, subscription: subscription(), deadline: Math.floor(Date.now() / 1000) + 60 }));
    expect(noSig.status).toBe(400);
    expect(webPush.store.count()).toBe(1);
  });

  it("unregisters by endpoint, and allows DELETE from the web app's origin", async () => {
    const { app, webPush } = buildApp();
    const body = await signed();
    await app.request("/v1/push/web", json("POST", body));
    const pre = await app.request("/v1/push/web", {
      method: "OPTIONS",
      headers: { origin: "https://plans.0xo.in", "access-control-request-method": "DELETE", "access-control-request-headers": "content-type" },
    });
    expect(pre.headers.get("access-control-allow-methods")).toContain("DELETE");
    const del = await app.request("/v1/push/web", json("DELETE", { endpoint: body.subscription.endpoint }));
    expect(await del.json()).toEqual({ ok: true, removed: true });
    expect(webPush.store.count()).toBe(0);
    const again = await app.request("/v1/push/web", json("DELETE", { endpoint: body.subscription.endpoint }));
    expect(await again.json()).toEqual({ ok: true, removed: false });
  });

  it("404s when VAPID keys aren't configured", async () => {
    const { app } = buildApp(null);
    const r = await app.request("/v1/push/web", json("POST", await signed()));
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("WEB_PUSH_DISABLED");
  });
});

describe("web push storage", () => {
  it("moves an endpoint to the last account that registered it and keeps 5 per account", () => {
    const s = new Store(":memory:");
    const w = new WebPush(s.db, CFG, vi.fn<WebPushSend>());
    const sub = subscription();
    w.store.add(A, sub, 100);
    w.store.add(B, sub, 101);
    expect(w.store.forAddresses([A])).toEqual([]);
    expect(w.store.forAddresses([B]).map((x) => x.endpoint)).toEqual([sub.endpoint]);
    const subs = Array.from({ length: 7 }, () => subscription());
    subs.forEach((x, i) => w.store.add(C, x, 200 + i));
    const kept = w.store.forAddresses([C]).map((x) => x.endpoint).sort();
    expect(kept).toEqual(subs.slice(2).map((x) => x.endpoint).sort());
  });

  it("survives a restart (same SQLite file)", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const path = join(mkdtempSync(join(tmpdir(), "wp-")), "r.sqlite");
    const s1 = new Store(path);
    new WebPush(s1.db, CFG).store.add(A, subscription("https://web.push.apple.com/abc"));
    s1.close();
    const s2 = new Store(path);
    expect(new WebPush(s2.db, CFG).store.forAddresses([A])[0].endpoint).toBe("https://web.push.apple.com/abc");
    s2.close();
  });
});

describe("web push dispatch", () => {
  function setup(send: WebPushSend, cfg: WebPushConfig | null = CFG) {
    const s = setupStore();
    const web = new WebPush(s.db, cfg, cfg ? send : null);
    const expo = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const msgs = JSON.parse(String(init!.body)) as unknown[];
      return new Response(JSON.stringify({ data: msgs.map(() => ({ status: "ok" })) }));
    });
    const d = new PushDispatcher(s, { enabled: true, url: "https://exp.host/--/api/v2/push/send" }, new Set(), expo as never, web);
    return { s, web, d, expo };
  }

  it("sends every Expo notification to the account's browser subscriptions too", async () => {
    const send = vi.fn<WebPushSend>(async () => ({ statusCode: 201 }));
    const { s, web, d, expo } = setup(send);
    s.addPushToken(B, "ExponentPushToken[abcdefghijkl]");
    const subB = subscription();
    const subC = subscription("https://updates.push.services.mozilla.com/wpush/v2/xyz");
    web.store.add(B, subB);
    web.store.add(C, subC);
    d.handle(ev("SpendProposed", { id: 4n, proposer: A, amount: 400_000n, category: 3, approvalsRequired: 2 }));
    await d.flush();
    expect(expo).toHaveBeenCalledTimes(1);
    const expoMsg = (JSON.parse(String(expo.mock.calls[0][1]!.body)) as { title: string; body: string }[])[0];
    expect(send).toHaveBeenCalledTimes(2);
    const byEndpoint = new Map(send.mock.calls.map(([sub, payload, opts]) => [sub.endpoint, { payload: JSON.parse(payload), opts }]));
    const toB = byEndpoint.get(subB.endpoint)!;
    // Declarative Web Push JSON: Safari 18.4+ shows it directly, the service worker elsewhere.
    expect(toB.payload).toEqual({
      web_push: 8030,
      notification: {
        title: expoMsg.title,
        body: expoMsg.body,
        navigate: `https://plans.0xo.in/app/plan/${POT.toLowerCase()}/approve/4`,
        lang: "en-US",
      },
      tag: `SpendProposed:0x${"ee".repeat(32)}`,
    });
    expect(toB.opts).toEqual({ TTL: 86_400, urgency: "high" });
    expect(byEndpoint.get(subC.endpoint)!.payload.notification.body).toBe("A $0.40 spend (Food & drink) needs your approval.");
    expect(Buffer.byteLength(send.mock.calls[0][1])).toBeLessThan(1024);
    expect(web.sent).toBe(2);
    expect(d.pending).toBe(0);
  });

  it("drops subscriptions the push service says are gone (404/410) and keeps them on other errors", async () => {
    const gone = subscription();
    const missing = subscription();
    const flaky = subscription();
    const send = vi.fn<WebPushSend>(async (sub) => {
      const code = sub.endpoint === gone.endpoint ? 410 : sub.endpoint === missing.endpoint ? 404 : 503;
      throw Object.assign(new Error("Received unexpected response code"), { statusCode: code });
    });
    const { web, d } = setup(send);
    web.store.add(B, gone);
    web.store.add(B, missing);
    web.store.add(C, flaky);
    d.handle(ev("Contributed", { member: A, amount: 250_000n }));
    await d.flush();
    expect(send).toHaveBeenCalledTimes(3);
    expect(web.store.forAddresses([B])).toEqual([]);
    expect(web.store.forAddresses([C]).map((x) => x.endpoint)).toEqual([flaky.endpoint]);
    expect(web.removed).toBe(2);
    expect(web.failed).toBe(3);
  });

  it("sends nothing for backfill, without VAPID keys, or to demo accounts", async () => {
    const send = vi.fn<WebPushSend>(async () => ({ statusCode: 201 }));
    const a = setup(send);
    a.web.store.add(B, subscription());
    a.d.handle(ev("Contributed", { member: A, amount: 1n }, false));
    await a.d.flush();
    expect(send).not.toHaveBeenCalled();

    const b = setup(send, null);
    b.web.store.add(B, subscription());
    b.d.handle(ev("Contributed", { member: A, amount: 1n }));
    await b.d.flush();
    expect(send).not.toHaveBeenCalled();

    const s = setupStore();
    const web = new WebPush(s.db, CFG, send);
    web.store.add(B, subscription());
    const d = new PushDispatcher(s, { enabled: true, url: "x" }, new Set([B.toLowerCase()]), (async () => new Response("{}")) as never, web);
    d.handle(ev("Contributed", { member: A, amount: 1n }));
    await d.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("routes clicks to the right app screen", () => {
    const pot = POT.toLowerCase();
    expect(webRouteFor({ type: "SpendProposed", pot: POT, id: "7" })).toBe(`/app/plan/${pot}/approve/7`);
    expect(webRouteFor({ type: "SpendExecuted", pot: POT, id: "7" })).toBe(`/app/plan/${pot}`);
    expect(webRouteFor({ type: "Settled", pot: POT })).toBe(`/app/plan/${pot}`);
    expect(webRouteFor({ type: "Payout", pot: POT })).toBe(`/app/plan/${pot}`);
    expect(webRouteFor({ type: "Sent", from: A })).toBe("/app/activity");
    expect(webRouteFor({ type: "Claimed", id: "1" })).toBe("/app/activity");
    expect(webRouteFor({ type: "SpendProposed", pot: "../../evil", id: "x" })).toBe("/app");
  });

  it("the real sender builds an encrypted VAPID request (no network)", () => {
    const sub = subscription();
    const payload = JSON.stringify({ title: "Money added", body: "$0.25 was added to the pot.", url: "/app" });
    const req = webpush.generateRequestDetails(sub, payload, {
      vapidDetails: { subject: CFG.subject, publicKey: CFG.publicKey, privateKey: CFG.privateKey.reveal() },
      TTL: 86_400,
      urgency: "high",
      contentEncoding: "aes128gcm",
    });
    expect(req.endpoint).toBe(sub.endpoint);
    expect(req.headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${CFG.publicKey}$`));
    expect(req.headers.TTL).toBe(86_400);
    expect(req.headers.Urgency).toBe("high");
    expect(req.headers["Content-Encoding"]).toBe("aes128gcm");
    expect((req.body as Buffer).length).toBeGreaterThan(payload.length);
    expect((req.body as Buffer).includes(Buffer.from("Money added"))).toBe(false);
  });
});

describe("VAPID configuration", () => {
  it("is all-or-nothing and validated without echoing the private key", () => {
    expect(parseWebPush(undefined, undefined, undefined)).toBeNull();
    expect(parseWebPush("", " ", "")).toBeNull();
    const ok = parseWebPush(vapid.publicKey, vapid.privateKey, "https://plans.0xo.in");
    expect(ok?.publicKey).toBe(vapid.publicKey);
    expect(JSON.stringify(ok)).not.toContain(vapid.privateKey);
    expect(() => parseWebPush(vapid.publicKey, undefined, "mailto:a@b.c")).toThrow(/all of/);
    expect(() => parseWebPush(vapid.publicKey, vapid.privateKey, "ops@plans")).toThrow(/mailto/);
    expect(() => parseWebPush("abc", vapid.privateKey, "mailto:a@b.c")).toThrow(/PUBLIC/);
    try {
      parseWebPush(vapid.publicKey, vapid.privateKey + "x", "mailto:a@b.c");
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain(vapid.privateKey);
    }
  });
});
