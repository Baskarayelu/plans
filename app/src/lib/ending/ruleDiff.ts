/**
 * Rule change (screen 35): the before → after rows between the rules in force and a proposal,
 * a one-line title, and vote thresholds. Pure.
 */
import { HighTier, PayeePolicy, type Rules } from "../chain/eip712";
import { formatUsdShort } from "../domain/currency";
import { CATEGORIES, rulesFromIndexer, UINT64_MAX } from "../domain/rules";

export type DiffRow = { key: string; label: string; before: string; after: string; title: string };

/** MAJORITY of active members (protocol.md): floor(active / 2) + 1. */
export function majority(active: number): number {
  return Math.floor(Math.max(active, 0) / 2) + 1;
}

const money = (v: bigint, none = "None") => (v === 0n ? none : formatUsdShort(v));
const span = (s: number) => (s % 86400 === 0 && s >= 86400 ? `${s / 86400} d` : s % 3600 === 0 && s >= 3600 ? `${s / 3600} h` : `${Math.round(s / 60)} min`);
const tier = (t: HighTier) => (t === HighTier.ALL ? "Everyone" : "A majority");
const payees = (p: PayeePolicy) => (p === PayeePolicy.MEMBERS_ONLY ? "Members only" : p === PayeePolicy.MEMBERS_AND_ALLOWLIST ? "Members and saved businesses" : "Anyone");

function verb(before: bigint, after: bigint, noun: string): string {
  if (before === 0n) return `Set ${noun}`;
  if (after === 0n) return `Remove ${noun}`;
  return `${after > before ? "Raise" : "Lower"} ${noun}`;
}

/** Only the fields that change, in the order people read the rules. */
export function ruleDiff(cur: Rules, next: Rules): DiffRow[] {
  const out: DiffRow[] = [];
  if (cur.instantMax !== next.instantMax)
    out.push({ key: "instantMax", label: "Goes through straight away up to", before: money(cur.instantMax, "Nothing"), after: money(next.instantMax, "Nothing"), title: verb(cur.instantMax, next.instantMax, "the instant limit") });
  if (cur.oneApprovalMax !== next.oneApprovalMax) {
    const f = (v: bigint) => (v >= UINT64_MAX ? "No limit" : money(v, "Nothing"));
    out.push({
      key: "oneApprovalMax",
      label: "One friend's OK up to",
      before: f(cur.oneApprovalMax),
      after: f(next.oneApprovalMax),
      title: next.oneApprovalMax > cur.oneApprovalMax ? "Raise the one-OK limit" : "Lower the one-OK limit",
    });
  }
  if (cur.highTier !== next.highTier) out.push({ key: "highTier", label: "Bigger spends need", before: tier(cur.highTier), after: tier(next.highTier), title: next.highTier === HighTier.ALL ? "Big spends need everyone" : "Big spends need a majority" });
  if (cur.memberDailyCap !== next.memberDailyCap)
    out.push({ key: "memberDailyCap", label: "Daily limit each", before: money(cur.memberDailyCap), after: money(next.memberDailyCap), title: verb(cur.memberDailyCap, next.memberDailyCap, "the daily limit") });
  if (cur.memberTotalCap !== next.memberTotalCap)
    out.push({ key: "memberTotalCap", label: "Total limit each", before: money(cur.memberTotalCap), after: money(next.memberTotalCap), title: verb(cur.memberTotalCap, next.memberTotalCap, "the total limit") });
  for (let i = 0; i < 8; i++) {
    const a = cur.categoryBudgets[i] ?? 0n;
    const b = next.categoryBudgets[i] ?? 0n;
    if (a === b) continue;
    const c = CATEGORIES[i];
    out.push({ key: `budget${i}`, label: `${c.emoji} ${c.name} budget`, before: money(a), after: money(b), title: verb(a, b, `the ${c.name.toLowerCase()} budget`) });
  }
  if (cur.payeePolicy !== next.payeePolicy) out.push({ key: "payeePolicy", label: "Who can be paid", before: payees(cur.payeePolicy), after: payees(next.payeePolicy), title: "Change who can be paid" });
  if (cur.minContribution !== next.minContribution)
    out.push({ key: "minContribution", label: "Everyone puts in at least", before: money(cur.minContribution), after: money(next.minContribution), title: verb(cur.minContribution, next.minContribution, "the minimum to put in") });
  if (cur.proposalTtl !== next.proposalTtl) out.push({ key: "proposalTtl", label: "Requests stay open for", before: span(cur.proposalTtl), after: span(next.proposalTtl), title: "Change how long requests stay open" });
  if (cur.ruleTimelock !== next.ruleTimelock) out.push({ key: "ruleTimelock", label: "Rule changes wait", before: span(cur.ruleTimelock), after: span(next.ruleTimelock), title: "Change how long rule changes wait" });
  return out;
}

export function ruleChangeTitle(rows: DiffRow[]): string {
  if (rows.length === 0) return "Keep the rules as they are";
  if (rows.length === 1) return rows[0].title;
  return `${rows[0].title}, and ${rows.length - 1} more`;
}

type RuleFields = {
  instantMax?: string;
  oneApprovalMax?: string;
  highTier?: string;
  memberDailyCap?: string;
  memberTotalCap?: string;
  payeePolicy?: string;
  minContribution?: string;
  proposalTtl?: string;
  ruleTimelock?: string;
  categoryBudgets?: string[];
};

/** Rules from an indexer row, with any missing field taken from `fallback` (another row). */
export function rulesFromRow(row: RuleFields, fallback: RuleFields): Rules {
  const pick = (k: Exclude<keyof RuleFields, "categoryBudgets">) => row[k] ?? fallback[k] ?? "0";
  return rulesFromIndexer({
    instantMax: pick("instantMax"),
    oneApprovalMax: pick("oneApprovalMax"),
    highTier: pick("highTier"),
    memberDailyCap: pick("memberDailyCap"),
    memberTotalCap: pick("memberTotalCap"),
    payeePolicy: pick("payeePolicy"),
    minContribution: pick("minContribution"),
    proposalTtl: pick("proposalTtl"),
    ruleTimelock: pick("ruleTimelock"),
    categoryBudgets: row.categoryBudgets ?? fallback.categoryBudgets,
  });
}

export type RuleChangePhase = "voting" | "waiting" | "ready" | "applied" | "closed";

/** Where a rule change is, given its indexer status and the clock (seconds). */
export function ruleChangePhase(r: { status: "Proposed" | "Approved" | "Applied"; expiresAt: string; eta?: string | null }, now: number): RuleChangePhase {
  if (r.status === "Applied") return "applied";
  if (r.status === "Approved") return r.eta && now < Number(r.eta) ? "waiting" : "ready";
  return now > Number(r.expiresAt) ? "closed" : "voting";
}

/** "22 h", "35 min", "40 s" until `t` (seconds). */
export function timeLeft(t: number, now: number): string {
  const d = Math.max(0, Math.floor(t - now));
  if (d >= 2 * 86400) return `${Math.floor(d / 86400)} days`;
  if (d >= 3600) return `${Math.floor(d / 3600)} h`;
  if (d >= 60) return `${Math.floor(d / 60)} min`;
  return `${d} s`;
}
