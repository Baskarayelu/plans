/**
 * View models for the ending screens (38 settle-up preview, 39 settling, 42 debt). Pure, so they
 * are unit tested. Money is AUSD base units (bigint); people are lowercase hex ids.
 */
import { minCashFlow, previewSettle, type Edge, type SettleResult } from "../domain/settlement";

const lc = (s: string) => s.toLowerCase();

export type SettleMemberInput = { address: string; net: bigint; allowance: bigint; walletBalance: bigint; active: boolean };

export type PayoutRowVM = {
  address: string;
  active: boolean;
  net: bigint;
  /** paid out to them by settle() */
  payout: bigint;
  /** pulled from their safety net */
  pulled: bigint;
  /** what stays owed by them after settle-up */
  debt: bigint;
  /** what stays owed to them after settle-up (pot short) */
  unpaid: bigint;
};

export type EdgeVM = { from: string; to: string; amount: bigint; covered: "full" | "part" | "none" };

export type SettleVM = {
  rows: PayoutRowVM[];
  edges: EdgeVM[];
  leftover: { to: string; amount: bigint }[];
  leftoverTotal: bigint;
  /** set when the leftover is shared equally between 2+ people */
  equalShare?: bigint;
  paidOut: bigint;
  pulledIn: bigint;
  /** the pot can't cover every claim (pro rata) */
  shortfall: boolean;
  anyDebt: boolean;
  result: SettleResult;
};

/** Indexer edge rows (strings) → domain edges. */
export function edgesFromRows(rows: readonly { kind: Edge["kind"]; from_id?: string | null; to_id?: string | null; amount: string }[]): Edge[] {
  return rows.map((r) => ({ kind: r.kind, from: r.from_id ? lc(r.from_id) : undefined, to: r.to_id ? lc(r.to_id) : undefined, amount: BigInt(r.amount) }));
}

/** The indexer's graph when present, else the same greedy graph computed from member nets. */
export function explainEdges(rows: readonly { kind: Edge["kind"]; from_id?: string | null; to_id?: string | null; amount: string }[], nets: { address: string; net: bigint }[]): Edge[] {
  const fromIndexer = edgesFromRows(rows).filter((e) => e.amount > 0n);
  if (fromIndexer.length > 0) return fromIndexer;
  return minCashFlow(nets.map((n) => ({ address: lc(n.address), net: n.net })));
}

export function settleView(input: { members: SettleMemberInput[]; potBalance: bigint; edges: Edge[] }): SettleVM {
  const members = input.members.map((m) => ({ ...m, address: lc(m.address) }));
  const result = previewSettle({ members, potBalance: input.potBalance });
  const rows: PayoutRowVM[] = members
    .map((m) => ({
      address: m.address,
      active: m.active,
      net: m.net,
      payout: result.payouts[m.address] ?? 0n,
      pulled: result.pulls[m.address] ?? 0n,
      debt: result.debts[m.address] ?? 0n,
      unpaid: result.unpaidClaims[m.address] ?? 0n,
    }))
    .filter((r) => r.active || r.payout > 0n || r.pulled > 0n || r.debt > 0n || r.unpaid > 0n);

  // Each debtor's pull is spent on their edges in order: the first edges are fully covered.
  const budget: Record<string, bigint> = { ...result.pulls };
  const edges: EdgeVM[] = [];
  const leftover: { to: string; amount: bigint }[] = [];
  for (const e of input.edges) {
    if (e.kind === "MemberToMember" && e.from && e.to) {
      const from = lc(e.from);
      const b = budget[from] ?? 0n;
      const covered: EdgeVM["covered"] = b >= e.amount ? "full" : b > 0n ? "part" : "none";
      budget[from] = b > e.amount ? b - e.amount : 0n;
      edges.push({ from, to: lc(e.to), amount: e.amount, covered });
    } else if (e.kind === "PotToMember" && e.to) {
      leftover.push({ to: lc(e.to), amount: e.amount });
    }
  }
  const leftoverTotal = leftover.reduce((a, x) => a + x.amount, 0n);
  const equalShare = leftover.length > 1 && leftover.every((x) => x.amount === leftover[0].amount) ? leftover[0].amount : undefined;
  return {
    rows,
    edges,
    leftover,
    leftoverTotal,
    equalShare,
    paidOut: result.paidOut,
    pulledIn: result.pulledIn,
    shortfall: Object.keys(result.unpaidClaims).length > 0,
    anyDebt: Object.keys(result.debts).length > 0,
    result,
  };
}

// ─────────────── screen 39: row animation ───────────────

export type RowState = "ok" | "go" | "q";

/**
 * Row states while settling. Before the response every row waits ("q"): one request pays
 * everyone, so nothing is shown as paid until it has happened. Once the response is in, rows tick
 * over quickly: row i is "go" during [i·step, (i+1)·step) and "ok" after.
 */
export function rowStates(n: number, sinceResultMs: number | null, stepMs = 140): RowState[] {
  return Array.from({ length: n }, (_, i) => {
    if (sinceResultMs === null) return "q";
    if (sinceResultMs >= (i + 1) * stepMs) return "ok";
    if (sinceResultMs >= i * stepMs) return "go";
    return "q";
  });
}

/** How long the tick-over takes, plus a short beat before moving on. */
export function rowsDoneMs(n: number, stepMs = 140, beatMs = 450): number {
  return n * stepMs + beatMs;
}

// ─────────────── settled result (screen 40) ───────────────

type Ev = { name: string; address?: string; args: Record<string, unknown> };

/** Payout and Pulled events in a settle() receipt, summed per member. */
export function payoutsFromEvents(events: readonly Ev[] | undefined, pot?: string): { payouts: Record<string, bigint>; pulls: Record<string, bigint>; paidOut: bigint } {
  const payouts: Record<string, bigint> = {};
  const pulls: Record<string, bigint> = {};
  let paidOut = 0n;
  for (const e of events ?? []) {
    if (pot && e.address && lc(e.address) !== lc(pot)) continue;
    const who = e.args.member;
    const amt = e.args.amount;
    if (typeof who !== "string" || amt === undefined || amt === null) continue;
    const v = BigInt(String(amt));
    if (e.name === "Payout") {
      payouts[lc(who)] = (payouts[lc(who)] ?? 0n) + v;
      paidOut += v;
    } else if (e.name === "Pulled") {
      pulls[lc(who)] = (pulls[lc(who)] ?? 0n) + v;
    }
  }
  return { payouts, pulls, paidOut };
}

// ─────────────── debt (screen 42) ───────────────

/**
 * What a payment of `amount` by a debtor gives each creditor (payDebt after settlement: pro rata
 * to positive nets, floored). Never more than each creditor is owed.
 */
export function debtDistribution(amount: bigint, creditors: { address: string; net: bigint }[]): { address: string; amount: bigint }[] {
  const pos = creditors.filter((c) => c.net > 0n);
  const C = pos.reduce((a, c) => a + c.net, 0n);
  if (C === 0n || amount <= 0n) return [];
  const pay = amount < C ? amount : C;
  return pos.map((c) => ({ address: lc(c.address), amount: (c.net * pay) / C }));
}
