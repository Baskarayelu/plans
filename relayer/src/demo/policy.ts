/**
 * Pure decision logic for demo members (unit-tested). The service feeds it the listener's state.
 */
import type { Address } from "viem";
import type { MemberRow, PotRow, ProposalRow } from "../store.js";

const lc = (a: string) => a.toLowerCase();

export function randomDelay(minMs: number, maxMs: number, rng: () => number = Math.random): number {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export interface VoteInput {
  proposal: ProposalRow;
  voters: Address[];
  activeMembers: Address[];
  demo: Set<string>; // lowercased demo addresses
  approveCap: bigint;
  nowSec: number;
  alreadyScheduled: boolean;
}

/**
 * Which demo member (if any) should approve this proposal next. One demo vote is in flight per
 * proposal at a time; if the proposal still needs approvals after it lands, the next tick picks another.
 */
export function pickDemoVoter(i: VoteInput): Address | null {
  const p = i.proposal;
  if (i.alreadyScheduled) return null;
  if (p.status !== "pending") return null;
  if (p.approvalsRequired <= 1) return null;
  if (p.amount > i.approveCap) return null;
  if (p.expiresAt <= i.nowSec + 5) return null;
  const voted = new Set(i.voters.map(lc));
  for (const m of i.activeMembers) {
    const k = lc(m);
    if (!i.demo.has(k)) continue;
    if (k === lc(p.proposer)) continue;
    if (voted.has(k)) continue;
    return m;
  }
  return null;
}

export interface AckInput {
  pot: PotRow;
  members: MemberRow[]; // active members
  demo: Set<string>;
  nowSec: number;
}

/**
 * Demo members ack once the plan's end time has passed, or once any human member has acked in the
 * current epoch. Returns the demo members that still need to ack.
 */
export function demoMembersToAck(i: AckInput): Address[] {
  if (i.pot.settled) return [];
  const isDemo = (m: MemberRow) => i.demo.has(lc(m.member));
  const ended = i.nowSec > i.pot.endTime;
  const humanAcked = i.members.some((m) => m.active && !isDemo(m) && m.ackEpoch !== null && m.ackEpoch === i.pot.ackEpoch);
  if (!ended && !humanAcked) return [];
  return i.members.filter((m) => m.active && isDemo(m) && m.ackEpoch !== i.pot.ackEpoch).map((m) => m.member);
}

/** Backoff tracker so a failing demo action isn't retried every tick. */
export class Backoff {
  #until = new Map<string, number>();
  #fails = new Map<string, number>();
  constructor(
    readonly baseMs = 15_000,
    readonly maxMs = 10 * 60_000,
    readonly now: () => number = Date.now,
  ) {}
  blocked(key: string) {
    const u = this.#until.get(key);
    return u !== undefined && u > this.now();
  }
  fail(key: string) {
    const n = (this.#fails.get(key) ?? 0) + 1;
    this.#fails.set(key, n);
    this.#until.set(key, this.now() + Math.min(this.maxMs, this.baseMs * 2 ** (n - 1)));
    return n;
  }
  ok(key: string) {
    this.#until.delete(key);
    this.#fails.delete(key);
  }
  failures(key: string) {
    return this.#fails.get(key) ?? 0;
  }
}

// ───────────── "Try a settle-up" plan ─────────────

export interface SettleUpPlanInput {
  deposit: bigint;
  maxOutlay: bigint;
  instantMax: bigint;
}

export interface PlannedSpend {
  by: "ben" | "asha" | "maya";
  kind: 0 | 2; // PAY or PERSONAL
  amount: bigint;
  category: number;
  splitWithJudgeOnly?: boolean; // split [proposer, judge] instead of everyone
}

/** Amounts for one run. Total demo outlay is the three deposits, capped by maxOutlay. */
export function planSettleUp(i: SettleUpPlanInput) {
  let deposit = i.deposit;
  if (deposit * 3n > i.maxOutlay) deposit = i.maxOutlay / 3n;
  if (deposit <= 0n) throw new Error("DEMO_MAX_OUTLAY too small for a demo run");
  const cap = (x: bigint) => (x > i.instantMax ? i.instantMax : x);
  const spends: PlannedSpend[] = [
    { by: "ben", kind: 0, amount: cap((deposit * 6n) / 5n), category: 3 }, // Food & drink, pot reimburses Ben
    { by: "asha", kind: 0, amount: cap((deposit * 4n) / 5n), category: 2 }, // Getting around, pot reimburses Asha
    { by: "maya", kind: 2, amount: cap((deposit * 3n) / 5n), category: 3, splitWithJudgeOnly: true }, // Maya paid personally
  ];
  return { deposit, spends, outlay: deposit * 3n };
}

export const SETTLE_UP_STEPS = [
  "maya.contribute",
  "ben.join",
  "ben.contribute",
  "asha.join",
  "asha.contribute",
  "spend.0",
  "spend.1",
  "spend.2",
  "maya.ack",
  "ben.ack",
  "asha.ack",
] as const;
export type SettleUpStep = (typeof SETTLE_UP_STEPS)[number];
