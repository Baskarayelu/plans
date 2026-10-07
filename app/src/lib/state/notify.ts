/**
 * Notification permission and in-app attention. Android: expo-notifications permission (push
 * itself is registered in effects.tsx); a live banner is the toast. Web: notify.web.ts (browser
 * Notification API while the tab is hidden, and a count in the document title).
 */
import * as Notifications from "expo-notifications";

export type NotifyPermission = { status: "granted" | "denied" | "undetermined"; canAskAgain: boolean };

export async function getNotifyPermission(): Promise<NotifyPermission> {
  const p = await Notifications.getPermissionsAsync();
  return { status: p.granted ? "granted" : p.status === "undetermined" ? "undetermined" : "denied", canAskAgain: p.canAskAgain };
}

export async function requestNotifyPermission(): Promise<NotifyPermission> {
  const p = await Notifications.requestPermissionsAsync();
  return { status: p.granted ? "granted" : "denied", canAskAgain: p.canAskAgain };
}

/** Called for every live banner; push covers the app being closed on Android. */
export function attention(_t: { title: string; sub?: string }): void {}

/** Web push isn't used; Android registers Expo push in effects.tsx. */
export const usesPush = true;
