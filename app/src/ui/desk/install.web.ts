/**
 * Web: keeps the browser's `beforeinstallprompt` event (Chrome and Edge fire it once the app can be
 * installed) so the You page can offer "Install Plans on this computer" (118). Captured as soon as
 * this module loads; the card only shows when the event has fired.
 */
import { createStore, useStore } from "../../lib/state/observable";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };

const pending = createStore<InstallEvent | null>(null);

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    pending.set(e as InstallEvent);
  });
  window.addEventListener("appinstalled", () => pending.set(null));
}

export function useInstallPrompt(): { available: boolean; install: () => Promise<void> } {
  const ev = useStore(pending);
  return {
    available: !!ev,
    install: async () => {
      if (!ev) return;
      try {
        await ev.prompt();
        await ev.userChoice;
      } catch {
        /* dismissed */
      }
      // The event can only be used once.
      pending.set(null);
    },
  };
}

/** "Chrome on macOS", from the browser's user agent. */
export function thisBrowser(): string | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /SamsungBrowser\//.test(ua)
          ? "Samsung Internet"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "This browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  return os ? `${browser} on ${os}` : browser;
}
