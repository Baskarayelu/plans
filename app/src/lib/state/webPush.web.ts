/**
 * Browser notifications with Plans closed (Web Push). Only on plans.0xo.in (and local test hosts):
 * - startWebPush(): registers /app/sw.js (scope /app) at launch — no prompt — and routes a click
 *   on a notification inside an open, unlocked tab;
 * - enableWebPush(): from the notifications screen's button only (a user gesture: Safari and
 *   Firefox show no prompt without one). Subscribes with the relayer's VAPID key and registers the
 *   subscription with the account's proof (POST /v1/push/web), like the APK's Expo token;
 * - syncWebPush(): on unlock, re-registers a subscription that changed (never prompts);
 * - disableWebPush(): unsubscribes and tells the relayer.
 * Pure logic and the per-browser rules: webPushState.ts, docs/web-notifications.md.
 */
import { router } from "expo-router";
import type { LocalAccount } from "viem";
import { getWebPushKey, registerWebPush, unregisterWebPush } from "../api/relayer";
import { storage } from "./storage";
import {
  appRouteFromUrl,
  base64UrlToBytes,
  isAllowedHost,
  isIOSDevice,
  isMobileDevice,
  needsRegister,
  sameKey,
  setWebPushActive,
  webNotifyState,
  webPushRegisterMessage,
  type WebNotifyState,
  type WebPushEnv,
  type WebSubscriptionJSON,
} from "./webPushState";

export type { WebNotifyState } from "./webPushState";

const SW_URL = "/app/sw.js";
// "/app" covers /app itself (needs the Service-Worker-Allowed header from the site); "/app/" is the fallback.
const SCOPES = ["/app", "/app/"];

let regP: Promise<ServiceWorkerRegistration | null> | null = null;
let keyP: Promise<string | null> | null = null;
// Kept from the last read so the button can call pushManager.subscribe() first thing in the tap.
let lastReg: ServiceWorkerRegistration | null = null;
let lastKey: string | null = null;
let lastSub: PushSubscription | null = null;
let started = false;

const hasWindow = () => typeof window !== "undefined" && typeof navigator !== "undefined";
const hostOk = () => hasWindow() && isAllowedHost(window.location.hostname);
const swOk = () => hasWindow() && "serviceWorker" in navigator;
const pushOk = () => hasWindow() && "PushManager" in window;
const N = (): typeof Notification | null => (typeof Notification !== "undefined" ? Notification : null);

function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!hostOk() || !swOk()) return Promise.resolve(null);
  regP ??= (async () => {
    for (const scope of SCOPES) {
      try {
        return await navigator.serviceWorker.register(SW_URL, { scope, updateViaCache: "none" });
      } catch {
        /* next scope */
      }
    }
    return null;
  })().then((r) => {
    if (!r) regP = null; // try again next time
    lastReg = r;
    return r;
  });
  return regP;
}

function serverKey(): Promise<string | null> {
  keyP ??= getWebPushKey()
    .catch(() => null)
    .then((k) => {
      if (!k) keyP = null;
      lastKey = k;
      return k;
    });
  return keyP;
}

function onMessage(e: MessageEvent) {
  const d = e.data as { type?: string; url?: string } | null;
  if (!d || d.type !== "plans:open" || typeof d.url !== "string") return;
  const route = appRouteFromUrl(d.url, window.location.origin);
  if (route) router.push(route as never);
}

/** At launch, web only: register the service worker (no prompt) and listen for notification clicks. */
export function startWebPush(): void {
  if (started || !hostOk() || !swOk()) return;
  started = true;
  navigator.serviceWorker.addEventListener("message", onMessage);
  void registration();
}

function subJSON(sub: PushSubscription): WebSubscriptionJSON {
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  return { endpoint: j.endpoint ?? sub.endpoint, keys: { p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "" } };
}

async function current(): Promise<{ reg: ServiceWorkerRegistration | null; key: string | null; sub: PushSubscription | null }> {
  if (!hostOk() || !swOk() || !pushOk()) return { reg: null, key: null, sub: null };
  const [reg, key] = await Promise.all([registration(), serverKey()]);
  let sub: PushSubscription | null = null;
  try {
    sub = reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    sub = null;
  }
  lastSub = sub;
  return { reg, key, sub };
}

export async function readWebPush(): Promise<{ state: WebNotifyState; mobile: boolean }> {
  const ios = hasWindow() && isIOSDevice(navigator.userAgent, navigator.platform ?? "", navigator.maxTouchPoints ?? 0);
  const mobile = hasWindow() && isMobileDevice(navigator.userAgent, ios);
  const { key, sub } = await current();
  const prefs = await storage.loadPrefs().catch(() => ({}) as Awaited<ReturnType<typeof storage.loadPrefs>>);
  const n = N();
  const env: WebPushEnv = {
    serviceWorker: swOk(),
    pushManager: pushOk(),
    notification: !!n,
    permission: n ? (n.permission as WebPushEnv["permission"]) : null,
    ios,
    standalone:
      hasWindow() &&
      ((typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true),
    hostAllowed: hostOk(),
    serverKey: !!key,
    subscribed: !!sub && !!key && sameKey(sub.options?.applicationServerKey, key) && prefs.webPush?.endpoint === sub.endpoint,
  };
  const state = webNotifyState(env);
  setWebPushActive(state === "on");
  return { state, mobile };
}

async function register(account: LocalAccount, sub: PushSubscription): Promise<void> {
  const s = subJSON(sub);
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const signature = await account.signMessage({ message: webPushRegisterMessage(account.address, s, deadline) });
  await registerWebPush({ address: account.address, subscription: s, deadline, signature });
  const prefs = await storage.loadPrefs();
  await storage.savePrefs({ ...prefs, webPush: { endpoint: s.endpoint, address: account.address, at: Date.now() } });
}

function askPermission(n: typeof Notification): Promise<NotificationPermission> {
  return new Promise((resolve) => {
    try {
      // Old Safari takes a callback and returns undefined.
      const p = n.requestPermission((r) => resolve(r));
      if (p && typeof p.then === "function") p.then(resolve, () => resolve(n.permission));
    } catch {
      resolve(n.permission);
    }
  });
}

/**
 * Call straight from the button's onPress. The first thing it does is the call that may prompt
 * (pushManager.subscribe, or Notification.requestPermission when push isn't possible here), so
 * the browser still sees the tap. With no account (locked) the subscription is sent at unlock.
 */
export async function enableWebPush(account: LocalAccount | null): Promise<WebNotifyState> {
  const n = N();
  if (!n) return (await readWebPush()).state;
  const reg = lastReg;
  const key = lastKey;
  const old = lastSub;
  let pending: Promise<PushSubscription | null> | null = null;
  if (reg && key && n.permission !== "denied") {
    const opts = { userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) as BufferSource };
    if (old && sameKey(old.options?.applicationServerKey, key)) pending = Promise.resolve(old);
    // A subscription for an old server key: permission is already granted, so no tap is needed after this await.
    else if (old) pending = old.unsubscribe().catch(() => false).then(() => reg.pushManager.subscribe(opts));
    // Called synchronously inside the tap: this is what shows the browser's prompt.
    else pending = reg.pushManager.subscribe(opts);
  } else if (n.permission === "default") {
    await askPermission(n);
  }
  if (pending) {
    try {
      const sub = await pending;
      if (sub && account) await register(account, sub);
    } catch {
      /* denied, or the relayer is unreachable: the screen shows what is true now */
    }
  }
  return (await readWebPush()).state;
}

export async function disableWebPush(): Promise<WebNotifyState> {
  const { sub } = await current();
  if (sub) {
    await unregisterWebPush(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe().catch(() => false);
  }
  const prefs = await storage.loadPrefs();
  if (prefs.webPush) {
    const { webPush: _drop, ...rest } = prefs;
    await storage.savePrefs(rest);
  }
  return (await readWebPush()).state;
}

/** On unlock: keep the relayer's copy current (new account, rotated subscription, every 12 h). Never prompts. */
export async function syncWebPush(account: LocalAccount): Promise<void> {
  const n = N();
  if (!n || n.permission !== "granted" || !hostOk() || !swOk() || !pushOk()) return;
  try {
    const prefs = await storage.loadPrefs();
    let { sub, reg, key } = await current();
    if (!reg || !key) return;
    if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
      await sub.unsubscribe().catch(() => false);
      sub = null;
    }
    // Only bring back a subscription the person turned on here before (the browser or a new server key dropped it).
    if (!sub && prefs.webPush) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) as BufferSource });
    if (!sub) return;
    if (needsRegister(prefs.webPush, sub.endpoint, account.address)) await register(account, sub);
    setWebPushActive(true);
  } catch {
    /* best effort, retried next unlock */
  }
}
