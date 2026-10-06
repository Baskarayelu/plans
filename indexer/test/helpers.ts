// Test helpers: an event builder for createTestIndexer().process({ simulate }) and invariant checks.
import { createTestIndexer } from "envio";
import { expect } from "vitest";

export const CHAIN = 10143;
export const FACTORY = "0x00000000000000000000000000000000000f1001";
export const KEYS = "0x00000000000000000000000000000000000f1002";
export const ESCROW = "0x00000000000000000000000000000000000f1003";
export const SEND = "0x00000000000000000000000000000000000f1004";

// real users
export const ALICE = "0xa11ce00000000000000000000000000000000001";
export const BOB = "0xb0b0000000000000000000000000000000000002";
export const CARL = "0xca71000000000000000000000000000000000003";
export const DIA = "0xd1a0000000000000000000000000000000000004";
export const EVE = "0xe7e0000000000000000000000000000000000005";
// internal (see test/fixtures/internal-accounts.json)
export const BEN = "0xbe00000000000000000000000000000000000001";
export const ASHA = "0xa500000000000000000000000000000000000002";
export const MAYA = "0x3a00000000000000000000000000000000000003";
export const TEAM = "0x7e00000000000000000000000000000000000004";

export const USD = (n: number): bigint => BigInt(Math.round(n * 1_000_000));
export const cc = (code: string): string =>
  "0x" + [...code].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
export const ZERO2 = "0x0000";

export const rules = (budgets: bigint[] = Array.from({ length: 8 }, () => 0n)) => ({
  instantMax: USD(25),
  oneApprovalMax: USD(200),
  highTier: 0n,
  memberDailyCap: USD(150),
  memberTotalCap: 0n,
  payeePolicy: 0n,
  minContribution: 0n,
  proposalTtl: 86_400n,
  ruleTimelock: 3_600n,
  categoryBudgets: budgets,
});

type Item = Record<string, unknown>;

/** Builds simulate items with increasing block numbers / timestamps. One tx per `tx()` call. */
export class Sim {
  block = 1_000;
  ts = 1_760_000_000; // 2025-10-09
  private items: Item[] = [];
  indexer = createTestIndexer();

  /** Advance to a new block (new transaction) `dt` seconds later. */
  tx(dt = 60): this {
    this.block += 1;
    this.ts += dt;
    return this;
  }

  ev(contract: string, event: string, srcAddress: string, params: Record<string, unknown>): this {
    this.items.push({
      contract,
      event,
      srcAddress,
      block: { number: this.block, timestamp: this.ts },
      transaction: { hash: `0x${this.block.toString(16).padStart(64, "0")}` },
      params,
    });
    return this;
  }

  pot(pot: string, event: string, params: Record<string, unknown>): this {
    return this.ev("Pot", event, pot, params);
  }

  async run(): Promise<void> {
    const simulate = this.items;
    this.items = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.indexer.process({ chains: { [CHAIN]: { simulate } } } as any);
  }

  // ── composite actions ──
  createPot(pot: string, creator: string, country: string, budgets?: bigint[]): this {
    this.tx();
    this.ev("PlansFactory", "PotCreated", FACTORY, {
      pot,
      creator,
      startTime: BigInt(this.ts),
      endTime: BigInt(this.ts + 7 * 86_400),
      reviewWindow: 86_400n,
      meta: "0xc0ffee",
      inviteKeyWrap: "0xbeef",
    });
    this.pot(pot, "RulesSet", { version: 1n, rules: rules(budgets) });
    this.pot(pot, "MemberJoined", { member: creator, country: cc(country), safetyNet: 0n, memberIndex: 0n });
    return this;
  }

  join(pot: string, member: string, country: string, index = 1n): this {
    return this.tx().pot(pot, "MemberJoined", { member, country: cc(country), safetyNet: USD(500), memberIndex: index });
  }

  contribute(pot: string, member: string, amount: bigint, dt = 60): this {
    return this.tx(dt).pot(pot, "Contributed", { member, amount });
  }

  /** Instant spend: SpendProposed + SpendExecuted in one tx. kind 0 PAY, 1 LINK, 2 PERSONAL. */
  spend(
    pot: string,
    id: bigint,
    proposer: string,
    kind: 0 | 1 | 2,
    amount: bigint,
    category: number,
    members: string[],
    shares: bigint[],
    opts: { claimId?: bigint; payee?: string } = {},
  ): this {
    this.tx();
    this.proposeOnly(pot, id, proposer, kind, amount, category, members, 1, opts.payee);
    return this.pot(pot, "SpendExecuted", { id, amount, members, shares, claimId: opts.claimId ?? 0n });
  }

  proposeOnly(
    pot: string,
    id: bigint,
    proposer: string,
    kind: 0 | 1 | 2,
    amount: bigint,
    category: number,
    members: string[],
    approvalsRequired = 1,
    payee = "0x9a9e000000000000000000000000000000000009",
  ): this {
    return this.pot(pot, "SpendProposed", {
      id,
      proposer,
      kind: BigInt(kind),
      payee,
      amount,
      category: BigInt(category),
      splitMembers: members,
      splitWeights: members.map(() => 1n),
      receiptHash: "0x" + "ab".repeat(32),
      memo: "0x1234",
      approvalsRequired: BigInt(approvalsRequired),
      expiresAt: BigInt(this.ts + 86_400),
    });
  }
}

/** Equal split exactly as the contract computes it: part_i = amount*w/Σw for i ≥ 1, remainder to 0. */
export function equalShares(amount: bigint, n: number): bigint[] {
  const parts = Array.from({ length: n }, () => amount / BigInt(n));
  parts[0] = amount - parts.slice(1).reduce((a, b) => a + b, 0n);
  return parts;
}

export async function members(sim: Sim, pot: string) {
  return (await sim.indexer.Member.getAll()).filter((m) => m.pot_id === pot);
}

export async function member(sim: Sim, pot: string, addr: string) {
  return sim.indexer.Member.getOrThrow(`${pot}-${addr}`);
}

export async function edges(sim: Sim, pot: string) {
  return (await sim.indexer.SettlementEdge.getAll()).filter((e) => e.pot_id === pot);
}

export async function global(sim: Sim) {
  return sim.indexer.GlobalStats.getOrThrow("global");
}

/**
 * Checks, for one pot:
 *  - every member's net == contributed + personalPaid − share − withdrawn
 *  - Σ net == indexed pot balance (invariant I1)
 *  - Σ SpendShare.amount per member == member.share
 *  - SettlementEdges: Σ out of debtors == Σ debts, Σ into creditors == Σ credits, each member on
 *    one side only, member edges ≤ debtors + creditors − 1, MemberBalance mirrors net/owes.
 */
export async function checkPotInvariants(sim: Sim, pot: string): Promise<void> {
  const p = await sim.indexer.Pot.getOrThrow(pot);
  const ms = await members(sim, pot);
  let sum = 0n;
  for (const m of ms) {
    expect(m.net, `net formula for ${m.address}`).toBe(m.contributed + m.personalPaid - m.share - m.withdrawn);
    sum += m.net;
  }
  expect(sum, "Σ net == pot balance (I1)").toBe(p.balance);

  const shares = (await sim.indexer.SpendShare.getAll()).filter((s) => s.pot_id === pot);
  for (const m of ms) {
    const total = shares.filter((s) => s.member_id === m.id).reduce((a, s) => a + s.amount, 0n);
    expect(total, `Σ SpendShare == member.share for ${m.address}`).toBe(m.share);
  }

  const es = await edges(sim, pot);
  expect(new Set(es.map((e) => e.id)).size).toBe(es.length);
  expect([...es.map((e) => e.id)].sort()).toEqual([...p.edgeIds].sort());
  const debts = ms.filter((m) => m.net < 0n).reduce((a, m) => a - m.net, 0n);
  const credits = ms.filter((m) => m.net > 0n).reduce((a, m) => a + m.net, 0n);
  const outOfDebtors = es.filter((e) => e.from_id).reduce((a, e) => a + e.amount, 0n);
  const intoCreditors = es.filter((e) => e.to_id).reduce((a, e) => a + e.amount, 0n);
  expect(outOfDebtors, "Σ edges from debtors == Σ debts").toBe(debts);
  expect(intoCreditors, "Σ edges into creditors == Σ credits").toBe(credits);
  for (const m of ms) {
    const out = es.filter((e) => e.from_id === m.address).reduce((a, e) => a + e.amount, 0n);
    const inn = es.filter((e) => e.to_id === m.address).reduce((a, e) => a + e.amount, 0n);
    expect(out === 0n || inn === 0n, `${m.address} on one side only`).toBe(true);
    if (m.net < 0n) expect(out).toBe(-m.net);
    if (m.net > 0n) expect(inn).toBe(m.net);
    if (m.net === 0n) expect(out + inn).toBe(0n);
    const bal = await sim.indexer.MemberBalance.getOrThrow(m.id);
    expect(bal.net).toBe(m.net);
    expect(bal.owes).toBe(out);
    expect(bal.owedByMembers + bal.owedByPot).toBe(inn);
  }
  const nDebtors = ms.filter((m) => m.net < 0n).length;
  const nCreditors = ms.filter((m) => m.net > 0n).length;
  const memberEdges = es.filter((e) => e.kind === "MemberToMember").length;
  if (nDebtors > 0 && nCreditors > 0) expect(memberEdges).toBeLessThanOrEqual(nDebtors + nCreditors - 1);
  expect(es.every((e) => e.amount > 0n)).toBe(true);
}
