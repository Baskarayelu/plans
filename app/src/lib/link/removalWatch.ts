/**
 * A linked browser that another device removed (docs/crypto.md §9.8a) stops quickly even with a
 * tab already open and unlocked: it notices its vault slot now holds REMOVED_VAULT, then locks
 * itself (session and keys wiped, its stored account and local cache deleted) and goes to "This
 * browser was removed". It checks
 *   (a) before anything signs or relays (guard.ts; a check that passed is trusted for 5 s, so
 *       typing and quick taps don't each cost a request),
 *   (b) when the tab gets focus or becomes visible, and
 *   (c) every 30 s while the tab is visible.
 * The check is one GET of the vault slot and a 17-byte compare, nothing decrypted. Only the
 * marker locks: a network error, a 5xx or a missing vault never does (offline is not removed).
 * Devices using the account's own passkey can't be removed and never check.
 */
import { fromBase64Url } from "../crypto/bytes";
import { setBeforeSensitive } from "../identity/guard";
import { identity, signOut } from "../identity/session";
import { cacheClearAll } from "../state/cache";
import { createStore } from "../state/observable";
import { storage } from "../state/storage";
import { fetchVaultBox } from "./browserLink";
import { isRemovedVault } from "./devices";

/** How long a passed check is trusted before an action (ms). */
export const CHECK_CACHE_MS = 5_000;
/** Background check interval while the tab is visible (ms). */
export const POLL_MS = 30_000;

export type Probe = "removed" | "present" | "unknown";

/**
 * What a vault read means for an open tab. Only the removed marker is "removed"; an error
 * (offline, 5xx, rate limit) and a missing vault (lost, or a different relayer) are "unknown",
 * which never locks.
 */
export function classifyProbe(r: { ok: true; box: Uint8Array | null } | { ok: false; error: unknown }): Probe {
  if (!r.ok) return "unknown";
  if (isRemovedVault(r.box)) return "removed";
  return r.box ? "present" : "unknown";
}

/** Whether to read the vault now: only for a linked browser that is unlocked, and not if a check passed within maxAgeMs. */
export function shouldProbe(s: { linked: boolean; unlocked: boolean; now: number; lastOkAt: number; maxAgeMs: number }): boolean {
  return s.linked && s.unlocked && (s.maxAgeMs <= 0 || s.now - s.lastOkAt >= s.maxAgeMs);
}

export class BrowserRemovedError extends Error {
  constructor() {
    super("This browser was removed from your account.");
    this.name = "BrowserRemovedError";
  }
}
export const isBrowserRemovedError = (e: unknown): e is BrowserRemovedError => e instanceof BrowserRemovedError;

/** Set (before sign-out) when this tab locked itself because it was removed; the UI routes to "This browser was removed". */
export const browserRemoved = createStore<boolean>(false);

let lastOkAt = 0;
let inflight: Promise<Probe> | null = null;

/** Tests. */
export function resetRemovalWatch(): void {
  lastOkAt = 0;
  inflight = null;
  browserRemoved.set(false);
}

async function probe(credentialId: string): Promise<Probe> {
  try {
    return classifyProbe({ ok: true, box: await fetchVaultBox(fromBase64Url(credentialId)) });
  } catch (error) {
    return classifyProbe({ ok: false, error });
  }
}

/** Locks this removed browser: session and keys wiped, stored account and local cache deleted. */
async function lockRemoved(): Promise<void> {
  lastOkAt = 0;
  browserRemoved.set(true);
  cacheClearAll();
  await signOut();
}

/**
 * Throws BrowserRemovedError (after locking) when this linked browser was removed; otherwise
 * returns. Never throws for network trouble. maxAgeMs 0 = always read.
 */
export async function ensureNotRemoved(opts: { maxAgeMs?: number } = {}): Promise<void> {
  if (identity.get().status !== "unlocked") return;
  const stored = await storage.loadAccount();
  const linked = !!stored?.vault;
  if (!stored || !shouldProbe({ linked, unlocked: true, now: Date.now(), lastOkAt, maxAgeMs: opts.maxAgeMs ?? CHECK_CACHE_MS })) return;
  const p = await (inflight ??= probe(stored.credentialId).finally(() => (inflight = null)));
  if (p === "present") lastOkAt = Date.now();
  if (p !== "removed") return;
  // Still the same account (it wasn't switched or signed out while the read was out)?
  const now = await storage.loadAccount();
  if (now?.credentialId !== stored.credentialId) return;
  await lockRemoved();
  throw new BrowserRemovedError();
}

setBeforeSensitive(() => ensureNotRemoved());

/**
 * Starts (b) and (c) in a browser tab; returns a stop function. A no-op where there is no
 * document (Android: no linked browsers there; the action check still runs).
 */
export function startRemovalWatch(opts: { pollMs?: number } = {}): () => void {
  if (typeof document === "undefined" || typeof window === "undefined" || typeof window.addEventListener !== "function") return () => undefined;
  const visible = () => document.visibilityState !== "hidden";
  const check = () => void ensureNotRemoved().catch(() => undefined);
  const onVisibility = () => visible() && check();
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", onVisibility);
  const t = setInterval(() => visible() && check(), opts.pollMs ?? POLL_MS);
  return () => {
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", onVisibility);
    clearInterval(t);
  };
}
