/** Browser notifications: which state the notifications screen shows, and the helpers around Web Push. */
import { createECDH } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import {
  appRouteFromUrl,
  base64UrlToBytes,
  bytesToBase64Url,
  canPush,
  isAllowedHost,
  isIOSDevice,
  isMobileDevice,
  needsRegister,
  sameKey,
  setWebPushActive,
  webNotifyState,
  webPushActive,
  webPushRegisterMessage,
  type WebPushEnv,
} from "../lib/state/webPushState";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
  ipadDesktopMode: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
  winChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
};

/** A desktop Chrome on plans.0xo.in with the relayer's key, not asked yet. */
const base: WebPushEnv = {
  serviceWorker: true,
  pushManager: true,
  notification: true,
  permission: "default",
  ios: false,
  standalone: false,
  hostAllowed: true,
  serverKey: true,
  subscribed: false,
};
const env = (o: Partial<WebPushEnv>): WebPushEnv => ({ ...base, ...o });

describe("web notification state", () => {
  it("asks first, then is on once subscribed; granted without a subscription is 'off' (no prompt needed)", () => {
    expect(webNotifyState(base)).toBe("ask");
    expect(webNotifyState(env({ permission: "granted", subscribed: true }))).toBe("on");
    expect(webNotifyState(env({ permission: "granted", subscribed: false }))).toBe("off");
  });

  it("is blocked when the browser said no, whatever else is true", () => {
    expect(webNotifyState(env({ permission: "denied" }))).toBe("blocked");
    expect(webNotifyState(env({ permission: "denied", serverKey: false, pushManager: false }))).toBe("blocked");
  });

  it("iPhone/iPad in a browser tab: Add to Home Screen (no API to ask with)", () => {
    const tab = env({ ios: true, standalone: false, pushManager: false, notification: false, permission: null });
    expect(webNotifyState(tab)).toBe("install");
    // the same phone from the Home Screen (iOS 16.4+): the normal flow
    expect(webNotifyState(env({ ios: true, standalone: true }))).toBe("ask");
    expect(webNotifyState(env({ ios: true, standalone: true, permission: "granted", subscribed: true }))).toBe("on");
    // a Home Screen app on iOS older than 16.4 has neither API
    expect(webNotifyState(env({ ios: true, standalone: true, pushManager: false, notification: false, permission: null }))).toBe("unsupported");
  });

  it("falls back to in-tab notifications when push can't work here", () => {
    for (const o of [{ pushManager: false }, { serviceWorker: false }, { serverKey: false }, { hostAllowed: false }] as Partial<WebPushEnv>[]) {
      expect(canPush(env(o))).toBe(false);
      expect(webNotifyState(env({ ...o, permission: "granted" }))).toBe("tab");
      expect(webNotifyState(env(o))).toBe("ask"); // the button still asks, for in-tab notifications
    }
    expect(webNotifyState(env({ notification: false, permission: null, pushManager: false }))).toBe("unsupported");
  });

  it("tells iPhones, iPads (even in desktop mode) and phones apart from desktops", () => {
    expect(isIOSDevice(UA.iphoneSafari)).toBe(true);
    expect(isIOSDevice(UA.iphoneChrome)).toBe(true);
    expect(isIOSDevice(UA.ipadDesktopMode, "MacIntel", 5)).toBe(true);
    expect(isIOSDevice(UA.macSafari, "MacIntel", 0)).toBe(false);
    expect(isIOSDevice(UA.androidChrome, "Linux armv81", 5)).toBe(false);
    expect(isMobileDevice(UA.androidChrome, false)).toBe(true);
    expect(isMobileDevice(UA.winChrome, false)).toBe(false);
    expect(isMobileDevice(UA.ipadDesktopMode, true)).toBe(true);
  });

  it("only registers on plans.0xo.in and local test hosts", () => {
    expect(isAllowedHost("plans.0xo.in")).toBe(true);
    expect(isAllowedHost("localhost")).toBe(true);
    expect(isAllowedHost("127.0.0.1")).toBe(true);
    expect(isAllowedHost("plans-git-preview.vercel.app")).toBe(false);
    expect(isAllowedHost("evil.0xo.in")).toBe(false);
  });
});

describe("web push helpers", () => {
  it("round-trips the VAPID key and compares it with a subscription's key", () => {
    const ecdh = createECDH("prime256v1");
    const key = ecdh.generateKeys().toString("base64url");
    const bytes = base64UrlToBytes(key);
    expect(bytes.length).toBe(65);
    expect(bytesToBase64Url(bytes)).toBe(key);
    expect(sameKey(bytes.buffer as ArrayBuffer, key)).toBe(true);
    expect(sameKey(new Uint8Array(65), key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });

  it("signs the exact message the relayer verifies", async () => {
    const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "BPxx", auth: "c2VjcmV0" } };
    const message = webPushRegisterMessage(acct.address, sub, 1760000600);
    // relayer/src/webpush.ts webPushRegisterMessage (checksummed address)
    expect(message).toBe(`Plans web push notifications\nAddress: ${acct.address}\nEndpoint: ${sub.endpoint}\nKeys: BPxx c2VjcmV0\nDeadline: 1760000600`);
    const signature = await acct.signMessage({ message });
    expect(await verifyMessage({ address: acct.address, message, signature })).toBe(true);
  });

  it("re-registers when the subscription or account changes, and twice a day", () => {
    const now = 1_760_000_000_000;
    const rec = { endpoint: "https://e/1", address: "0xAbC0000000000000000000000000000000000001", at: now - 3600_000 };
    expect(needsRegister(undefined, "https://e/1", rec.address, now)).toBe(true);
    expect(needsRegister(rec, "https://e/1", rec.address.toLowerCase(), now)).toBe(false);
    expect(needsRegister(rec, "https://e/2", rec.address, now)).toBe(true);
    expect(needsRegister(rec, "https://e/1", "0x0000000000000000000000000000000000000002", now)).toBe(true);
    expect(needsRegister({ ...rec, at: now - 13 * 3600_000 }, "https://e/1", rec.address, now)).toBe(true);
  });

  it("turns a notification click into an app route, and nothing else", () => {
    const o = "https://plans.0xo.in";
    expect(appRouteFromUrl("https://plans.0xo.in/app/plan/0xab12/approve/4", o)).toBe("/plan/0xab12/approve/4");
    expect(appRouteFromUrl("https://plans.0xo.in/app/activity", o)).toBe("/activity");
    expect(appRouteFromUrl("https://plans.0xo.in/app", o)).toBe("/");
    expect(appRouteFromUrl("https://plans.0xo.in/app/", o)).toBe("/");
    expect(appRouteFromUrl("/app/plan/0xab12", o)).toBe("/plan/0xab12");
    expect(appRouteFromUrl("https://evil.example/app/plan/0xab12", o)).toBeNull();
    expect(appRouteFromUrl("https://plans.0xo.in/docs", o)).toBeNull();
    expect(appRouteFromUrl("https://plans.0xo.in/apple", o)).toBeNull();
    expect(appRouteFromUrl("javascript:alert(1)", o)).toBeNull();
  });

  it("skips the in-tab notification while Web Push is on", () => {
    expect(webPushActive()).toBe(false);
    setWebPushActive(true);
    expect(webPushActive()).toBe(true);
    setWebPushActive(false);
  });
});
