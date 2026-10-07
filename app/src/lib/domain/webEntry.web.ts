/**
 * Web link entry. public/index.html parses a Plans link (/app/j/…#s=…, /app/join#…, /app/claim#…,
 * /app/v/…#…, /app/c/…, /app/p/…) BEFORE the router reads the address, replaces the history entry
 * with the app route (no secret in it) and leaves the raw path and "#" part in window.__plansLink.
 * This module (imported first by the root layout) turns that into `pendingLink` (memory only) and
 * deletes the global. See webLinks.ts.
 */
import { pendingLink, webPathToLink } from "./webLinks";

type Raw = { path: string; hash: string };
const w = (typeof window !== "undefined" ? window : undefined) as (Window & { __plansLink?: Raw }) | undefined;

export function takeRawLink(raw: Raw | undefined): void {
  if (!raw) return;
  const link = webPathToLink(raw.path, raw.hash);
  // A link that's missing its secret (or has a malformed one) opens its screen in the "incomplete link" state.
  if (link) pendingLink.set(link);
}

if (w?.__plansLink) {
  takeRawLink(w.__plansLink);
  delete w.__plansLink;
}

export {};
