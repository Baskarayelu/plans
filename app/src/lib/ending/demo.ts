/**
 * "Try a settle-up" (screens 56–57): the relayer's run status mapped to three human steps, and a
 * small in-memory note of a run that was created but not joined yet (so a failed join is retried
 * without starting a second run).
 */
import { createStore } from "../state/observable";

export type DemoRunLike = { stage: string; step?: string | null; stepIndex: number; totalSteps: number } | null | undefined;

export type DemoProgress = {
  step: 1 | 2 | 3;
  label: string;
  /** 0–100 */
  pct: number;
  state: "working" | "ready" | "done" | "failed" | "abandoned" | "unknown";
};

export const DEMO_STEPS = [
  "The demo friends join and spend from the pot. You see it live.",
  "They check the numbers and say it looks right.",
  "You end the plan and settle up in one tap.",
] as const;

const LABELS = ["They join and spend", "They check the numbers", "You end the plan and settle up"] as const;

export function demoProgress(run: DemoRunLike, settled: boolean): DemoProgress {
  if (settled || run?.stage === "done") return { step: 3, label: "Settled", pct: 100, state: "done" };
  if (!run) return { step: 1, label: LABELS[0], pct: 0, state: "unknown" };
  switch (run.stage) {
    case "awaiting_judge":
      return { step: 1, label: "Adding you to the plan", pct: 3, state: "working" };
    case "running": {
      const total = Math.max(1, run.totalSteps);
      const ackStart = Math.max(1, total - 3);
      const i = Math.max(0, Math.min(run.stepIndex, total));
      const acking = (run.step ?? "").endsWith(".ack") || i >= ackStart;
      if (!acking) return { step: 1, label: LABELS[0], pct: Math.round(3 + (i / ackStart) * 30), state: "working" };
      return { step: 2, label: LABELS[1], pct: Math.round(33 + ((i - ackStart) / Math.max(1, total - ackStart)) * 33), state: "working" };
    }
    case "ready":
      return { step: 3, label: LABELS[2], pct: 80, state: "ready" };
    case "failed":
      return { step: 2, label: "The demo friends got stuck", pct: 50, state: "failed" };
    case "abandoned":
      return { step: 1, label: "This demo ran out of time", pct: 0, state: "abandoned" };
    default:
      return { step: 1, label: LABELS[0], pct: 0, state: "unknown" };
  }
}

/** "1:10" */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Deposit the person brings into the demo: $0.10 when they have it, else nothing. */
export const DEMO_DEPOSIT = 100_000n;
export const DEMO_SAFETY_NET = 1_000_000n;
export function demoDeposit(balance: bigint | undefined): bigint {
  return balance !== undefined && balance >= DEMO_DEPOSIT ? DEMO_DEPOSIT : 0n;
}

/** A run created for `member` whose join hasn't gone through yet. */
export type PendingRun = { member: string; pot: `0x${string}`; inviteSecret: `0x${string}`; createdAt: number; endTime: number };
export const pendingRun = createStore<PendingRun | null>(null);

export function usablePendingRun(member: string | undefined, nowSec: number): PendingRun | null {
  const r = pendingRun.get();
  if (!r || !member || r.member.toLowerCase() !== member.toLowerCase()) return null;
  return nowSec < r.endTime - 60 ? r : null;
}
