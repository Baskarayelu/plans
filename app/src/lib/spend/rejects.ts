/**
 * Votes carry no note onchain, so the reason someone gives for saying no (27b) stays on their own
 * phone, in the encrypted cache. The proposer sees only that they said no.
 */
import { cacheRead, cacheWrite } from "../state/cache";

type Rejects = Record<string, { reason: string; note?: string; at: number }>;

const NAME = "spend-rejects";
const k = (pot: string, id: string) => `${pot.toLowerCase()}:${id}`;

export function saveRejectReason(pot: string, id: string, reason: string, note?: string): void {
  const all = cacheRead<Rejects>(NAME) ?? {};
  all[k(pot, id)] = { reason, note: note?.trim() || undefined, at: Math.floor(Date.now() / 1000) };
  cacheWrite(NAME, all);
}

export function rejectReasonFor(pot: string, id: string): { reason: string; note?: string } | null {
  return (cacheRead<Rejects>(NAME) ?? {})[k(pot, id)] ?? null;
}

export const REJECT_REASONS = ["Too expensive", "Not what we agreed", "Wrong amount", "Let's talk first"] as const;
