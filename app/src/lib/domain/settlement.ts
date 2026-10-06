/**
 * Settle-up preview maths (screens 37, 38, 42).
 *
 * - `minCashFlow` mirrors indexer/src/lib/settlement.ts (the SettlementEdge entities), so the app
 *   can explain "who pays whom" and also recompute it locally from member nets.
 * - `previewSettle` mirrors Pot.settle() in docs/protocol.md: pull each debtor up to
 *   min(−net, allowance, balance), then pay creditors in full or pro rata (floored); unpaid
 *   negative nets become debts.
 * - `splitParts` mirrors the contract's share computation for a split.
 */

export type NetPosition = { address: string; net: bigint };
export type Edge = { kind: "MemberToMember" | "PotToMember" | "MemberToPot"; from?: string; to?: string; amount: bigint };

type Side = { address: string; amount: bigint };

function bySizeThenAddress(a: Side, b: Side): number {
  if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
  const x = a.address.toLowerCase();
  const y = b.address.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

export function minCashFlow(positions: readonly NetPosition[]): Edge[] {
  const debtors: Side[] = [];
  const creditors: Side[] = [];
  for (const p of positions) {
    if (p.net < 0n) debtors.push({ address: p.address, amount: -p.net });
    else if (p.net > 0n) creditors.push({ address: p.address, amount: p.net });
  }
  debtors.sort(bySizeThenAddress);
  creditors.sort(bySizeThenAddress);
  const edges: Edge[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const t = d.amount < c.amount ? d.amount : c.amount;
    edges.push({ kind: "MemberToMember", from: d.address, to: c.address, amount: t });
    d.amount -= t;
    c.amount -= t;
    if (d.amount === 0n) i++;
    if (c.amount === 0n) j++;
  }
  for (; j < creditors.length; j++) if (creditors[j].amount > 0n) edges.push({ kind: "PotToMember", to: creditors[j].address, amount: creditors[j].amount });
  for (; i < debtors.length; i++) if (debtors[i].amount > 0n) edges.push({ kind: "MemberToPot", from: debtors[i].address, amount: debtors[i].amount });
  return edges;
}

export type SettleInput = {
  members: { address: string; net: bigint; allowance: bigint; walletBalance: bigint }[];
  potBalance: bigint;
};

export type SettleResult = {
  pulls: Record<string, bigint>;
  payouts: Record<string, bigint>;
  debts: Record<string, bigint>;
  unpaidClaims: Record<string, bigint>;
  paidOut: bigint;
  pulledIn: bigint;
  /** Final net per member after settlement (0 when square). */
  finalNet: Record<string, bigint>;
};

export function previewSettle(input: SettleInput): SettleResult {
  const pulls: Record<string, bigint> = {};
  const payouts: Record<string, bigint> = {};
  const debts: Record<string, bigint> = {};
  const unpaidClaims: Record<string, bigint> = {};
  const net: Record<string, bigint> = {};
  let balance = input.potBalance;
  let pulledIn = 0n;
  for (const m of input.members) net[m.address] = m.net;
  // 1. pull from debtors through their safety net
  for (const m of input.members) {
    if (m.net < 0n) {
      const owe = -m.net;
      let p = owe;
      if (m.allowance < p) p = m.allowance;
      if (m.walletBalance < p) p = m.walletBalance;
      if (p > 0n) {
        pulls[m.address] = p;
        net[m.address] += p;
        balance += p;
        pulledIn += p;
      }
    }
  }
  // 2–4. pay creditors
  let C = 0n;
  for (const m of input.members) if (net[m.address] > 0n) C += net[m.address];
  let paidOut = 0n;
  for (const m of input.members) {
    const n = net[m.address];
    if (n <= 0n) continue;
    const pay = balance >= C ? n : (n * balance) / C;
    if (pay > 0n) {
      payouts[m.address] = pay;
      paidOut += pay;
      net[m.address] = n - pay;
    }
    if (net[m.address] > 0n) unpaidClaims[m.address] = net[m.address];
  }
  for (const m of input.members) if (net[m.address] < 0n) debts[m.address] = -net[m.address];
  return { pulls, payouts, debts, unpaidClaims, paidOut, pulledIn, finalNet: net };
}

/** Contract share computation: part_i = amount*w_i/Σw for i ≥ 1; part_0 takes the remainder. */
export function splitParts(amount: bigint, weights: readonly number[]): bigint[] {
  if (weights.length === 0) return [];
  const total = weights.reduce((a, b) => a + BigInt(b), 0n);
  const parts = weights.map((w) => (amount * BigInt(w)) / total);
  let rest = 0n;
  for (let i = 1; i < parts.length; i++) rest += parts[i];
  parts[0] = amount - rest;
  return parts;
}

/** What leaving now pays out or pulls (screen 36), per protocol.md `exit`. */
export function previewExit(net: bigint, potBalance: bigint, allowance: bigint, walletBalance: bigint): { paid: bigint; pulled: bigint; debt: bigint } {
  if (net > 0n) return { paid: net < potBalance ? net : potBalance, pulled: 0n, debt: 0n };
  if (net < 0n) {
    let p = -net;
    if (allowance < p) p = allowance;
    if (walletBalance < p) p = walletBalance;
    return { paid: 0n, pulled: p, debt: -net - p };
  }
  return { paid: 0n, pulled: 0n, debt: 0n };
}
