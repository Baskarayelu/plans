/**
 * Web attention: while the Plans tab is open but hidden, each live banner also becomes a
 * browser notification (if allowed) and the tab title shows a count, "(2) Plans", cleared when
 * the tab is visible again. Web push (notifications with the tab closed) isn't used: the APK gets
 * Expo push; the web app only knows what happens while it is open.
 */
export type NotifyPermission = { status: "granted" | "denied" | "undetermined"; canAskAgain: boolean };

const N = () => (typeof Notification !== "undefined" ? Notification : null);

function current(): NotifyPermission {
  const n = N();
  if (!n) return { status: "denied", canAskAgain: false };
  if (n.permission === "granted") return { status: "granted", canAskAgain: false };
  if (n.permission === "denied") return { status: "denied", canAskAgain: false };
  return { status: "undetermined", canAskAgain: true };
}

export async function getNotifyPermission(): Promise<NotifyPermission> {
  return current();
}

export async function requestNotifyPermission(): Promise<NotifyPermission> {
  const n = N();
  if (!n) return current();
  try {
    await n.requestPermission();
  } catch {
    /* old Safari callback form or blocked */
  }
  return current();
}

let unseen = 0;
let baseTitle: string | null = null;

function setTitle() {
  if (typeof document === "undefined") return;
  if (baseTitle === null) baseTitle = document.title.replace(/^\(\d+\)\s*/, "") || "Plans";
  document.title = unseen > 0 ? `(${unseen}) ${baseTitle}` : baseTitle;
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && unseen > 0) {
      unseen = 0;
      setTitle();
    }
  });
}

export function attention(t: { title: string; sub?: string }): void {
  if (typeof document === "undefined" || !document.hidden) return;
  unseen++;
  setTitle();
  const n = N();
  if (n && n.permission === "granted") {
    try {
      const note = new n(t.title, { body: t.sub, icon: `${location.origin}/app/favicon.ico`, tag: "plans-live" });
      note.onclick = () => {
        window.focus();
        note.close();
      };
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }
}

export const usesPush = false;
