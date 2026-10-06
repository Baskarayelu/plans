import { HighTier } from "../lib/chain/eip712";
import { clock, demoDeposit, demoProgress } from "../lib/ending/demo";
import { biggestSpend, categoryBars, spendsCsv } from "../lib/ending/memory";
import { ackStatus, hasAcked, leaveBlockers, openItems } from "../lib/ending/planChecks";
import { majority, ruleChangePhase, ruleChangeTitle, ruleDiff, rulesFromRow, timeLeft } from "../lib/ending/ruleDiff";
import { debtDistribution, explainEdges, payoutsFromEvents, rowStates, rowsDoneMs, settleView } from "../lib/ending/settleView";
import { PRESETS } from "../lib/domain/rules";

const $ = (d: number) => BigInt(Math.round(d * 1e6));

describe("settle-up preview view model", () => {
  const members = [
    { address: "MAYA", net: $(52.35), allowance: 0n, walletBalance: 0n, active: true },
    { address: "sam", net: $(28.1), allowance: 0n, walletBalance: 0n, active: true },
    { address: "asha", net: $(-8.08), allowance: $(100), walletBalance: $(50), active: true },
    { address: "ben", net: $(-16.17), allowance: $(100), walletBalance: $(50), active: true },
  ];
  const potBalance = $(52.35 + 28.1 - 8.08 - 16.17);

  it("pays every creditor in full when the safety nets cover the debtors", () => {
    const nets = members.map((m) => ({ address: m.address, net: m.net }));
    const vm = settleView({ members, potBalance, edges: explainEdges([], nets) });
    const maya = vm.rows.find((r) => r.address === "maya")!;
    expect(maya.payout).toBe($(52.35));
    expect(vm.rows.find((r) => r.address === "ben")!.pulled).toBe($(16.17));
    expect(vm.shortfall).toBe(false);
    expect(vm.anyDebt).toBe(false);
    expect(vm.edges.every((e) => e.covered === "full")).toBe(true);
    expect(vm.paidOut).toBe($(80.45));
    // leftover is what the pot pays after the member-to-member arrows
    expect(vm.leftoverTotal + vm.edges.reduce((a, e) => a + e.amount, 0n)).toBe($(80.45));
  });

  it("labels an arrow partly covered and records debt when the safety net is short", () => {
    const m = members.map((x) => (x.address === "ben" ? { ...x, allowance: $(10) } : x));
    const nets = m.map((x) => ({ address: x.address, net: x.net }));
    const vm = settleView({ members: m, potBalance, edges: explainEdges([], nets) });
    const ben = vm.rows.find((r) => r.address === "ben")!;
    expect(ben.pulled).toBe($(10));
    expect(ben.debt).toBe($(6.17));
    expect(vm.anyDebt).toBe(true);
    expect(vm.shortfall).toBe(true);
    const benEdge = vm.edges.find((e) => e.from === "ben")!;
    expect(benEdge.covered).toBe("part");
  });

  it("uses the indexer's graph when it has one and spots equal leftover shares", () => {
    const rows = [
      { kind: "PotToMember" as const, to_id: "0xA", amount: "5000000" },
      { kind: "PotToMember" as const, to_id: "0xB", amount: "5000000" },
    ];
    const vm = settleView({
      members: [
        { address: "0xa", net: $(5), allowance: 0n, walletBalance: 0n, active: true },
        { address: "0xb", net: $(5), allowance: 0n, walletBalance: 0n, active: true },
      ],
      potBalance: $(10),
      edges: explainEdges(rows, []),
    });
    expect(vm.equalShare).toBe($(5));
    expect(vm.leftover.map((l) => l.to)).toEqual(["0xa", "0xb"]);
  });

  it("keeps exited members only when money moves for them", () => {
    const vm = settleView({
      members: [
        { address: "a", net: $(1), allowance: 0n, walletBalance: 0n, active: true },
        { address: "gone", net: 0n, allowance: 0n, walletBalance: 0n, active: false },
      ],
      potBalance: $(1),
      edges: [],
    });
    expect(vm.rows.map((r) => r.address)).toEqual(["a"]);
  });
});

describe("settling rows never show paid before the response", () => {
  it("waits, then ticks over in order", () => {
    expect(rowStates(3, null)).toEqual(["q", "q", "q"]);
    expect(rowStates(3, 0, 100)).toEqual(["go", "q", "q"]);
    expect(rowStates(3, 150, 100)).toEqual(["ok", "go", "q"]);
    expect(rowStates(3, 300, 100)).toEqual(["ok", "ok", "ok"]);
    expect(rowsDoneMs(3, 100, 400)).toBe(700);
  });
});

describe("settle receipt events", () => {
  it("sums Payout and Pulled per member and ignores other contracts", () => {
    const r = payoutsFromEvents(
      [
        { name: "Pulled", address: "0xPot", args: { member: "0xB", amount: "2000000" } },
        { name: "Payout", address: "0xPot", args: { member: "0xA", amount: "3000000" } },
        { name: "Payout", address: "0xPot", args: { member: "0xa", amount: "1000000" } },
        { name: "Transfer", address: "0xAusd", args: { from: "0xPot", to: "0xA", value: "3000000" } },
        { name: "Payout", address: "0xOther", args: { member: "0xC", amount: "9" } },
      ],
      "0xpot",
    );
    expect(r.payouts).toEqual({ "0xa": 4_000_000n });
    expect(r.pulls).toEqual({ "0xb": 2_000_000n });
    expect(r.paidOut).toBe(4_000_000n);
  });
});

describe("debt distribution", () => {
  it("is pro rata, floored and capped at what creditors are owed", () => {
    expect(debtDistribution($(12), [{ address: "Ben", net: $(12) }])).toEqual([{ address: "ben", amount: $(12) }]);
    const d = debtDistribution(10n, [
      { address: "a", net: 1n },
      { address: "b", net: 2n },
      { address: "x", net: -5n },
    ]);
    expect(d).toEqual([
      { address: "a", amount: 1n },
      { address: "b", amount: 2n },
    ]);
    expect(debtDistribution(3n, [{ address: "a", net: 0n }])).toEqual([]);
  });
});

describe("rule change diff", () => {
  const cur = PRESETS.balanced.rules;
  it("lists only changed fields and names categories", () => {
    const budgets = [...cur.categoryBudgets] as bigint[];
    budgets[3] = $(180);
    const next = { ...cur, memberDailyCap: $(400), categoryBudgets: budgets as unknown as typeof cur.categoryBudgets };
    const rows = ruleDiff(cur, next);
    expect(rows.map((r) => r.key)).toEqual(["memberDailyCap", "budget3"]);
    expect(rows[1].label).toContain("Food & drink");
    expect(rows[1].before).toBe("None");
    expect(rows[1].after).toBe("$180");
    expect(rows[0].title).toBe("Raise the daily limit");
    expect(ruleChangeTitle(rows)).toBe("Raise the daily limit, and 1 more");
    expect(ruleChangeTitle([])).toBe("Keep the rules as they are");
  });
  it("describes tier and payee changes in words", () => {
    const rows = ruleDiff(cur, { ...cur, highTier: HighTier.ALL });
    expect(rows[0]).toMatchObject({ before: "A majority", after: "Everyone" });
  });
  it("majority and phases", () => {
    expect(majority(4)).toBe(3);
    expect(majority(5)).toBe(3);
    expect(majority(1)).toBe(1);
    expect(ruleChangePhase({ status: "Proposed", expiresAt: "100" }, 50)).toBe("voting");
    expect(ruleChangePhase({ status: "Proposed", expiresAt: "100" }, 101)).toBe("closed");
    expect(ruleChangePhase({ status: "Approved", expiresAt: "100", eta: "200" }, 150)).toBe("waiting");
    expect(ruleChangePhase({ status: "Approved", expiresAt: "100", eta: "200" }, 200)).toBe("ready");
    expect(ruleChangePhase({ status: "Applied", expiresAt: "100" }, 1)).toBe("applied");
    expect(timeLeft(3600 * 22 + 5, 0)).toBe("22 h");
    expect(timeLeft(90, 0)).toBe("1 min");
  });
  it("fills missing proposal fields from the rules in force", () => {
    const r = rulesFromRow({ instantMax: "5000000" }, { instantMax: "1", oneApprovalMax: "2", highTier: "MAJORITY", memberDailyCap: "0", memberTotalCap: "0", payeePolicy: "ANYONE", minContribution: "0", proposalTtl: "3600", ruleTimelock: "60", categoryBudgets: [] });
    expect(r.instantMax).toBe(5_000_000n);
    expect(r.oneApprovalMax).toBe(2n);
    expect(r.categoryBudgets.length).toBe(8);
  });
});

describe("demo progress", () => {
  const run = (stage: string, stepIndex = 0, step: string | null = null) => ({ stage, stepIndex, totalSteps: 11, step });
  it("maps the relayer's run to three steps", () => {
    expect(demoProgress(run("awaiting_judge"), false)).toMatchObject({ step: 1, state: "working" });
    const s1 = demoProgress(run("running", 4, "asha.contribute"), false);
    expect(s1.step).toBe(1);
    expect(s1.pct).toBeGreaterThan(3);
    expect(s1.pct).toBeLessThan(34);
    const s2 = demoProgress(run("running", 9, "ben.ack"), false);
    expect(s2.step).toBe(2);
    expect(s2.pct).toBeGreaterThanOrEqual(33);
    expect(s2.pct).toBeLessThanOrEqual(66);
    expect(demoProgress(run("ready", 11), false)).toMatchObject({ step: 3, state: "ready" });
    expect(demoProgress(run("ready", 11), true)).toMatchObject({ step: 3, pct: 100, state: "done" });
    expect(demoProgress(run("failed", 5), false).state).toBe("failed");
    expect(demoProgress(null, false).state).toBe("unknown");
  });
  it("formats the clock and the deposit", () => {
    expect(clock(70)).toBe("1:10");
    expect(clock(5)).toBe("0:05");
    expect(demoDeposit(undefined)).toBe(0n);
    expect(demoDeposit(99_999n)).toBe(0n);
    expect(demoDeposit(5_000_000n)).toBe(100_000n);
  });
});

describe("plan checks", () => {
  const plan = {
    ackEpoch: "3",
    members: [
      { address: "0xA", status: "Active", lastAckEpoch: "3" },
      { address: "0xB", status: "Active", lastAckEpoch: "2" },
      { address: "0xC", status: "Exited", lastAckEpoch: "3" },
    ],
    spends: [{ id: "p-7", spendId: "7", status: "Pending", proposer_id: "0xB", amount: "1000000", category: 3, memo: "0x" }],
    disputes: [{ id: "p-d1", spend_id: "p-5", openedBy_id: "0xa", status: "Open" }],
    recent: [{ id: "p-5", spendId: "5", proposer_id: "0xC", amount: "2000000", category: 1, memo: "0x" }],
  } as never;
  it("counts acks in the current epoch for active members", () => {
    expect(ackStatus(plan)).toEqual([
      { address: "0xa", acked: true },
      { address: "0xb", acked: false },
    ]);
    expect(hasAcked(plan, "0xA")).toBe(true);
    expect(hasAcked(plan, "0xB")).toBe(false);
  });
  it("finds open items and what blocks leaving", () => {
    expect(openItems(plan).map((i) => `${i.kind}:${i.spendId}`)).toEqual(["spend:7", "dispute:5"]);
    expect(leaveBlockers(plan, "0xb").map((i) => i.spendId)).toEqual(["7"]);
    expect(leaveBlockers(plan, "0xA").map((i) => i.kind)).toEqual(["dispute"]);
    expect(leaveBlockers(plan, "0xC").map((i) => i.kind)).toEqual(["dispute"]);
    expect(leaveBlockers(plan, "0xD")).toEqual([]);
  });
});

describe("plan memory", () => {
  it("bars, biggest spend and CSV", () => {
    const bars = categoryBars([
      { category: 3, spent: "147600000", refunded: "0" },
      { category: 4, spent: "250000000", refunded: "0" },
      { category: 1, spent: "0", refunded: "0" },
    ]);
    expect(bars.map((b) => b.category)).toEqual([4, 3]);
    expect(bars[0].pct).toBe(100);
    expect(bars[1].pct).toBeCloseTo(59, 0);
    expect(biggestSpend([{ amount: "5" }, { amount: "12" }, { amount: "7" }])).toEqual({ amount: "12" });
    const csv = spendsCsv([{ at: 1760000000, who: 'Ben "B"', kind: "Paid from the pot", category: 3, amount: 36_004_999n, note: "Dinner, late" }]);
    const [head, line] = csv.split("\n");
    expect(head).toBe("Date (UTC),Who,Kind,Category,Amount (USD),Note");
    expect(line).toBe('2025-10-09 08:53,"Ben ""B""",Paid from the pot,Food & drink,36.00,"Dinner, late"');
  });
});
