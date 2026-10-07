/**
 * PLANS_TIMING marks for measuring "landing page → first confirmed transaction" (docs/first-tx-timing.md).
 *
 * Each mark is one line `PLANS_TIMING {"event":…,"t":<ms since app start>,…}`:
 *   Android: logcat tag PLANS_TIMING (adb logcat -s PLANS_TIMING)
 *   Web:     console, `performance.mark("plans:<event>")`, and `window.__plansTiming` (read by e2e/web)
 * Events: app_boot, app_ready, route:<path> (first visit of each route), passkey_start/passkey_done
 * (kind create|get, ok), relay_ok (action, txHash, latencyMs, clientMs), faucet_ok, demo_started,
 * tx_first (the first confirmed transaction of this app session).
 */
import { Platform } from "react-native";
import { logLine } from "../../modules/plans-native";

type Mark = { event: string; t: number; wall: number; [k: string]: unknown };

const g = globalThis as unknown as { __plansTiming?: Mark[]; performance?: Performance };
const start = Date.now();
let firstTx = false;

function now(): number {
  return Platform.OS === "web" && g.performance?.now ? Math.round(g.performance.now()) : Date.now() - start;
}

export function mark(event: string, extra: Record<string, unknown> = {}): void {
  if (typeof process !== "undefined" && process.env?.JEST_WORKER_ID) return;
  const m: Mark = { event, t: now(), wall: Date.now(), ...extra };
  try {
    if (Platform.OS === "web") {
      (g.__plansTiming ??= []).push(m);
      g.performance?.mark?.(`plans:${event}`);
      console.log(`PLANS_TIMING ${JSON.stringify(m)}`);
    } else {
      logLine("PLANS_TIMING", JSON.stringify(m));
    }
  } catch {
    /* never let timing break the app */
  }
}

/** Marks a confirmed transaction; the first one in this session also gets "tx_first". */
export function markTx(kind: string, extra: Record<string, unknown> = {}): void {
  mark(kind, extra);
  if (!firstTx) {
    firstTx = true;
    mark("tx_first", { kind, ...extra });
  }
}

const seenRoutes = new Set<string>();
export function markRoute(path: string): void {
  if (seenRoutes.has(path)) return;
  seenRoutes.add(path);
  mark(`route:${path}`);
}
