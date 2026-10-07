/**
 * Browser notifications (Web Push) exist only in the web build: webPush.web.ts. The APK uses
 * Expo push (effects.tsx), so on Android these are no-ops.
 */
import type { LocalAccount } from "viem";
import type { WebNotifyState } from "./webPushState";

export type { WebNotifyState } from "./webPushState";

export function startWebPush(): void {}

export async function readWebPush(): Promise<{ state: WebNotifyState; mobile: boolean }> {
  return { state: "unsupported", mobile: true };
}

export async function enableWebPush(_account: LocalAccount | null): Promise<WebNotifyState> {
  return "unsupported";
}

export async function disableWebPush(): Promise<WebNotifyState> {
  return "unsupported";
}

export async function syncWebPush(_account: LocalAccount): Promise<void> {}
