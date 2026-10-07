/**
 * Browser notifications: the pure part (no DOM), shared by webPush.web.ts and the tests.
 * What each browser allows is in docs/web-notifications.md. In short: Chrome, Edge, Firefox and
 * Safari on a Mac can get notifications with Plans closed (Web Push); on iPhone and iPad only a
 * Plans icon added to the Home Screen can (iOS 16.4+), never a Safari tab.
 */

/** What the notifications screen shows on the web. */
export type WebNotifyState =
  /** iPhone/iPad in a browser tab: Add to Home Screen first. */
  | "install"
  /** No notifications at all in this browser. */
  | "unsupported"
  /** The person (or the browser) said no; only the browser's site settings can undo it. */
  | "blocked"
  /** Not asked yet: the button asks (from the tap) and then subscribes. */
  | "ask"
  /** Allowed, push possible, but this browser has no subscription with us: the button subscribes, no prompt. */
  | "off"
  /** Subscribed: notifications arrive with Plans closed. */
  | "on"
  /** Allowed, but this browser (or our server) can't do push: notifications only while a Plans tab is open. */
  | "tab";

export type WebPushEnv = {
  /** "serviceWorker" in navigator */
  serviceWorker: boolean;
  /** "PushManager" in window */
  pushManager: boolean;
  /** typeof Notification !== "undefined" */
  notification: boolean;
  /** Notification.permission, or null without the API */
  permission: "default" | "granted" | "denied" | null;
  /** iPhone, iPad or iPod (including iPadOS reporting itself as a Mac) */
  ios: boolean;
  /** Opened from the Home Screen / installed (display-mode standalone, navigator.standalone) */
  standalone: boolean;
  /** plans.0xo.in or a local test host */
  hostAllowed: boolean;
  /** The relayer published a VAPID key (GET /v1/config webPushPublicKey) */
  serverKey: boolean;
  /** This browser has a push subscription for our key */
  subscribed: boolean;
};

/** Whether this browser can get notifications with Plans closed (given permission). */
export function canPush(e: WebPushEnv): boolean {
  return e.hostAllowed && e.serviceWorker && e.pushManager && e.notification && e.serverKey;
}

export function webNotifyState(e: WebPushEnv): WebNotifyState {
  // iOS Safari tabs have no Notification or PushManager at all; a Home Screen app (16.4+) has both.
  if (e.ios && !e.standalone && !(e.pushManager && e.notification)) return "install";
  if (!e.notification || e.permission === null) return "unsupported";
  if (e.permission === "denied") return "blocked";
  if (e.permission === "default") return "ask";
  if (!canPush(e)) return "tab";
  return e.subscribed ? "on" : "off";
}

export function isIOSDevice(ua: string, platform = "", maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(ua) || /^(iPhone|iPad|iPod)/.test(platform)) return true;
  // iPadOS 13+ asks for desktop sites and reports "Macintosh"; a Mac has no touch screen.
  return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

/** Phones and tablets get push with the browser closed; desktops only while the browser runs. */
export function isMobileDevice(ua: string, ios: boolean): boolean {
  return ios || /Android|Mobile/i.test(ua);
}

export const WEB_PUSH_HOSTS = ["plans.0xo.in", "localhost", "127.0.0.1"];

export function isAllowedHost(hostname: string): boolean {
  return WEB_PUSH_HOSTS.includes(hostname.toLowerCase());
}

export type WebSubscriptionJSON = { endpoint: string; keys: { p256dh: string; auth: string } };

/** The exact message signed to register a browser subscription (relayer/src/webpush.ts webPushRegisterMessage). */
export function webPushRegisterMessage(address: string, sub: WebSubscriptionJSON, deadline: number): string {
  return [
    "Plans web push notifications",
    `Address: ${address}`,
    `Endpoint: ${sub.endpoint}`,
    `Keys: ${sub.keys.p256dh} ${sub.keys.auth}`,
    `Deadline: ${deadline}`,
  ].join("\n");
}

/** VAPID public key (base64url) → the bytes pushManager.subscribe wants. */
export function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(b: ArrayBuffer | Uint8Array | null | undefined): string {
  if (!b) return "";
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let bin = "";
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return globalThis.btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Does the existing subscription use this server key? (A new key pair on the relayer needs a new subscription.) */
export function sameKey(subKey: ArrayBuffer | Uint8Array | null | undefined, serverKey: string): boolean {
  return !!subKey && bytesToBase64Url(subKey) === serverKey.replace(/=+$/, "");
}

/** What we last told the relayer, kept in prefs. */
export type WebPushRecord = { endpoint: string; address: string; at: number };

/** Register again when the subscription or the account changed, or every 12 hours (the relayer keeps the newest 5). */
export function needsRegister(rec: WebPushRecord | undefined, endpoint: string, address: string, now = Date.now()): boolean {
  if (!rec) return true;
  if (rec.endpoint !== endpoint || rec.address.toLowerCase() !== address.toLowerCase()) return true;
  return now - rec.at > 12 * 3600_000;
}

/**
 * A notification click (service worker message or URL) → an app route, e.g.
 * https://plans.0xo.in/app/plan/0xab…/approve/4 → /plan/0xab…/approve/4. Other origins → null.
 */
export function appRouteFromUrl(url: string, origin: string): string | null {
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  if (u.pathname !== "/app" && !u.pathname.startsWith("/app/")) return null;
  const path = u.pathname.slice(4).replace(/\/+$/, "") || "/";
  if (!/^[A-Za-z0-9/_\-.]*$/.test(path) || path.includes("..")) return null;
  return path + u.search;
}

/**
 * Set while this browser gets Web Push: the push notification then covers an event, so the
 * in-tab notification (notify.web.ts attention) is skipped instead of showing it twice.
 */
let pushActive = false;
export function setWebPushActive(on: boolean): void {
  pushActive = on;
}
export function webPushActive(): boolean {
  return pushActive;
}
