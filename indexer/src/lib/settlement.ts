// Pure settle-up math. No Envio imports, so it is unit-testable and deterministic.

export type EdgeKind = "MemberToMember" | "PotToMember" | "MemberToPot";

export type NetPosition = { address: string; net: bigint };

export type PlannedEdge = {
  kind: EdgeKind;
  /** undefined = the pot */
  from: string | undefined;
  /** undefined = the pot */
  to: string | undefined;
  amount: bigint;
};

type Side = { address: string; amount: bigint };

/** Sort by amount desc, then address asc (lowercase compare): the deterministic order. */
function bySizeThenAddress(a: Side, b: Side): number {
  if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
  const x = a.address.toLowerCase();
  const y = b.address.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Deterministic greedy min-cash-flow.
 *
 * Debtors (net < 0) and creditors (net > 0) are each sorted by amount desc then address asc and
 * matched greedily: the largest remaining debtor pays the largest remaining creditor
 * min(debt, credit), and whichever side reaches zero advances. This gives at most
 * (#debtors + #creditors − 1) member edges and every member appears on one side only.
 *
 * Σ nets == pot balance (invariant I1), so credits normally exceed debts by the pot balance:
 * the creditors' unmatched remainder becomes PotToMember edges (the pot's own money).
 * If debts ever exceed credits (only possible while a transaction's events are half-applied),
 * the debtors' remainder becomes MemberToPot edges. Either way:
 *   Σ edges out of debtors == Σ debts   and   Σ edges into creditors == Σ credits.
 */
export function minCashFlow(positions: readonly NetPosition[]): PlannedEdge[] {
  const debtors: Side[] = [];
  const creditors: Side[] = [];
  for (const p of positions) {
    if (p.net < 0n) debtors.push({ address: p.address, amount: -p.net });
    else if (p.net > 0n) creditors.push({ address: p.address, amount: p.net });
  }
  debtors.sort(bySizeThenAddress);
  creditors.sort(bySizeThenAddress);

  const edges: PlannedEdge[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]!;
    const c = creditors[j]!;
    const t = d.amount < c.amount ? d.amount : c.amount;
    edges.push({ kind: "MemberToMember", from: d.address, to: c.address, amount: t });
    d.amount -= t;
    c.amount -= t;
    if (d.amount === 0n) i++;
    if (c.amount === 0n) j++;
  }
  for (; j < creditors.length; j++) {
    const c = creditors[j]!;
    if (c.amount > 0n) edges.push({ kind: "PotToMember", from: undefined, to: c.address, amount: c.amount });
  }
  for (; i < debtors.length; i++) {
    const d = debtors[i]!;
    if (d.amount > 0n) edges.push({ kind: "MemberToPot", from: d.address, to: undefined, amount: d.amount });
  }
  return edges;
}

/**
 * Pro-rata split with the remainder to position 0 — the contract's `_parts(amount, w)`:
 *   r_i = refund * w_i / Σw  (floored)  for i ≥ 1
 *   r_0 = refund − Σ_{i≥1} r_i
 * Used for escrow refunds with the spend's current split weights (or, if unknown, its current
 * share amounts — identical for a full refund, the only case ClaimEscrow produces).
 */
export function proRataReduction(weights: readonly bigint[], refund: bigint): bigint[] {
  const total = weights.reduce((a, b) => a + b, 0n);
  if (weights.length === 0) return [];
  if (total === 0n) return weights.map((_, i) => (i === 0 ? refund : 0n));
  const out = weights.map((a) => (refund * a) / total);
  let rest = 0n;
  for (let i = 1; i < out.length; i++) rest += out[i]!;
  out[0] = refund - rest;
  return out;
}

/**
 * Splits a debtor's payment across that debtor's outgoing member edges (in edge order:
 * amount desc, creditor address asc) — used to attribute settlement pulls and debt payments
 * to country corridors. Any part beyond the debtor's member edges is unattributed.
 */
export function allocateAcrossEdges(
  payment: bigint,
  edges: readonly { to: string; amount: bigint }[],
): { to: string; amount: bigint }[] {
  const sorted = [...edges].sort((a, b) => bySizeThenAddress({ address: a.to, amount: a.amount }, { address: b.to, amount: b.amount }));
  const out: { to: string; amount: bigint }[] = [];
  let left = payment;
  for (const e of sorted) {
    if (left <= 0n) break;
    const t = left < e.amount ? left : e.amount;
    if (t > 0n) out.push({ to: e.to, amount: t });
    left -= t;
  }
  return out;
}
