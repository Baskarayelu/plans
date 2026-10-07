// Pot events: membership, ledger, spends, disputes, rules, safety controls and settlement.
// Ledger (docs/protocol.md): net = contributed + personalPaid − share − withdrawn, per member.
import { indexer } from "envio";
import {
  activity,
  attributeDebtorPayment,
  bumpPot,
  dailyStats,
  ensureAccount,
  ensureCategory,
  ensureMember,
  ensurePot,
  fundedAction,
  globalStats,
  markDemo,
  moveCountriesHist,
  moveMembersHist,
  recomputeSettlement,
  refreshCategory,
  refreshNet,
  updateUser,
} from "../lib/domain.js";
import { proRataReduction } from "../lib/settlement.js";
import { type E, Store } from "../lib/store.js";
import {
  CATEGORY_NAMES,
  DISPUTE_OUTCOMES,
  HIGH_TIERS,
  PAYEE_POLICIES,
  SPEND_KINDS,
  categoryId,
  clampIndex,
  decodeCode,
  disputeEntityId,
  fxRoundEntityId,
  lc,
  maxBig,
  memberId,
  metaOf,
  ruleChangeEntityId,
  rulesVersionId,
  spendEntityId,
} from "../lib/util.js";

type Pot = E<"Pot">;
type Spend = E<"Spend">;

type RulesParam = {
  readonly instantMax: bigint;
  readonly oneApprovalMax: bigint;
  readonly highTier: bigint;
  readonly memberDailyCap: bigint;
  readonly memberTotalCap: bigint;
  readonly payeePolicy: bigint;
  readonly minContribution: bigint;
  readonly proposalTtl: bigint;
  readonly ruleTimelock: bigint;
  readonly categoryBudgets: readonly bigint[];
};

function rulesFields(r: RulesParam) {
  return {
    instantMax: r.instantMax,
    oneApprovalMax: r.oneApprovalMax,
    highTier: HIGH_TIERS[Number(r.highTier)] ?? String(r.highTier),
    memberDailyCap: r.memberDailyCap,
    memberTotalCap: r.memberTotalCap,
    payeePolicy: PAYEE_POLICIES[Number(r.payeePolicy)] ?? String(r.payeePolicy),
    minContribution: r.minContribution,
    proposalTtl: r.proposalTtl,
    ruleTimelock: r.ruleTimelock,
    categoryBudgets: Array.from({ length: 8 }, (_, i) => r.categoryBudgets[i] ?? 0n),
  };
}

/** Loads a spend; if it is missing (should not happen: SpendProposed always comes first) a stub is created. */
async function loadSpend(s: Store, pot: Pot, id: bigint): Promise<Spend> {
  const sid = spendEntityId(pot.id, id);
  const found = await s.load("Spend", sid);
  if (found) return found;
  if (!s.ctx.isPreload) s.ctx.log.error(`Spend ${sid} not found; creating a stub (kind PAY assumed)`);
  const cat = await ensureCategory(s, pot, 7);
  return s.put("Spend", {
    id: sid,
    pot_id: pot.id,
    spendId: id,
    proposer_id: pot.id,
    proposerMember_id: memberId(pot.id, pot.id),
    kind: "PAY",
    payee: "0x0000000000000000000000000000000000000000",
    amount: 0n,
    category: 7,
    categoryName: CATEGORY_NAMES[7],
    categorySpend_id: cat.id,
    splitMembers: [],
    splitWeights: [],
    receiptHash: "0x",
    memo: "0x",
    approvalsRequired: 1,
    approvals: 1,
    rejections: 0,
    status: "Pending",
    cancelReason: undefined,
    expiresAt: 0n,
    proposedAt: s.m.ts,
    approvedAt: undefined,
    executedAt: undefined,
    cancelledAt: undefined,
    claimId: undefined,
    refunded: 0n,
    refundedAt: undefined,
    disputeCount: 0,
    hasOpenDispute: false,
    lastDisputeOutcome: "None",
    shareVersion: 0,
    shareMembers: [],
    shareWeights: [],
    txHash: s.m.tx,
  });
}

/** Removes the spend's current share assignment from the members' ledgers. */
async function removeShares(s: Store, pot: Pot, spend: Spend): Promise<void> {
  for (const addr of spend.shareMembers) {
    const sh = await s.get("SpendShare", `${spend.id}-${addr}`);
    if (!sh) continue;
    const mem = await ensureMember(s, pot, addr);
    mem.share -= sh.amount;
    refreshNet(mem);
    s.del("SpendShare", sh.id);
  }
  spend.shareMembers = [];
}

/** Applies an exact share assignment (SpendExecuted / DisputeResolved) to the ledgers. */
async function assignShares(
  s: Store,
  pot: Pot,
  spend: Spend,
  members: readonly string[],
  shares: readonly bigint[],
): Promise<void> {
  spend.shareVersion += 1;
  const order: string[] = [];
  for (let i = 0; i < members.length; i++) {
    const addr = lc(members[i]!);
    const amt = shares[i] ?? 0n;
    const mem = await ensureMember(s, pot, addr);
    mem.share += amt;
    refreshNet(mem);
    order.push(addr);
    s.put("SpendShare", {
      id: `${spend.id}-${addr}`,
      spend_id: spend.id,
      pot_id: pot.id,
      member_id: mem.id,
      account_id: addr,
      position: i,
      version: spend.shareVersion,
      originalAmount: amt,
      refunded: 0n,
      amount: amt,
    });
  }
  spend.shareMembers = order;
}

async function currentShares(s: Store, spend: Spend): Promise<{ members: string[]; amounts: bigint[] }> {
  const members: string[] = [];
  const amounts: bigint[] = [];
  for (const addr of spend.shareMembers) {
    const sh = await s.get("SpendShare", `${spend.id}-${addr}`);
    members.push(addr);
    amounts.push(sh?.amount ?? 0n);
  }
  return { members, amounts };
}

// ───────────────────────────── rules ─────────────────────────────

indexer.onEvent({ contract: "Pot", event: "RulesSet" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const pot = await ensurePot(s, event.srcAddress);
  const r = rulesFields(event.params.rules);
  const id = rulesVersionId(pot.id, event.params.version);
  s.put("RulesVersion", { id, pot_id: pot.id, version: event.params.version, ...r, setAt: s.m.ts, txHash: s.m.tx });
  Object.assign(pot, r, { rulesVersion: event.params.version, currentRules_id: id });
  for (let c = 0; c < 8; c++) {
    const cat = await ensureCategory(s, pot, c);
    cat.budget = r.categoryBudgets[c] ?? 0n;
    refreshCategory(cat, s.m.ts);
  }
  await activity(s, "RulesSet", { pot, ref: id });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "AllowlistChanged" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const pot = await ensurePot(s, event.srcAddress);
  const payee = lc(event.params.payee);
  s.put("AllowlistEntry", {
    id: `${pot.id}-${payee}`,
    pot_id: pot.id,
    payee,
    allowed: event.params.allowed,
    updatedAt: s.m.ts,
  });
  await activity(s, "AllowlistChanged", { pot, counterparty: payee });
  s.flush();
});

// ───────────────────────────── membership ─────────────────────────────

indexer.onEvent({ contract: "Pot", event: "MemberJoined" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { member, country, safetyNet, memberIndex } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  const acc = await ensureAccount(s, member);

  // A Demo account joining makes the plan demo (and retracts it from traction if it was counted).
  if (acc.internalKind === "Demo" && !pot.hasDemoMember) {
    pot.hasDemoMember = true;
    await markDemo(s, pot);
  }

  const mem = await ensureMember(s, pot, member);
  const cc = decodeCode(country);
  if (cc) {
    mem.country = cc;
    acc.country = cc;
  }
  mem.safetyNet = safetyNet;
  mem.memberIndex = memberIndex;
  mem.status = "Active";

  if (mem.joinedAt === undefined) {
    mem.joinedAt = s.m.ts;
    const before = pot.activeMemberCount;
    pot.memberCount += 1;
    pot.activeMemberCount += 1;
    await moveMembersHist(s, pot, before, pot.activeMemberCount);
    if (pot.countedInStats) {
      acc.nonDemoPotCount += 1;
      await updateUser(s, acc);
    }
    if (acc.firstJoinedAt === undefined) {
      acc.firstJoinedAt = s.m.ts;
      acc.firstJoinPot_id = pot.id;
      // a deposit emitted before MemberJoined in the same join counts as funded at join time
      if (mem.contributed > 0n) await fundedAction(s, acc);
    }
  }
  if (cc && !pot.countries.includes(cc)) {
    const before = pot.countryCount;
    pot.countries = [...pot.countries, cc];
    pot.countryCount += 1;
    await moveCountriesHist(s, pot, before, pot.countryCount);
  }
  await recomputeSettlement(s, pot);
  await activity(s, "MemberJoined", { pot, account: member, ref: mem.id });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "InviteRotated" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const pot = await ensurePot(s, event.srcAddress);
  pot.inviteSigner = lc(event.params.newSigner);
  await ensureAccount(s, event.params.by);
  await activity(s, "InviteRotated", { pot, account: event.params.by, counterparty: event.params.newSigner });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "KeyWrapped" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const pot = await ensurePot(s, event.srcAddress);
  await ensureAccount(s, event.params.member);
  await ensureAccount(s, event.params.by);
  s.put("KeyWrap", {
    id: s.m.eventId,
    pot_id: pot.id,
    member_id: lc(event.params.member),
    by_id: lc(event.params.by),
    wrap: event.params.wrap,
    timestamp: s.m.ts,
  });
  await activity(s, "KeyWrapped", { pot, account: event.params.by, counterparty: event.params.member });
  s.flush();
});

// ───────────────────────────── money in ─────────────────────────────

indexer.onEvent({ contract: "Pot", event: "Contributed" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { member, amount } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  const acc = await ensureAccount(s, member);
  const mem = await ensureMember(s, pot, member);
  mem.contributed += amount;
  refreshNet(mem);
  pot.balance += amount;

  const first = pot.contributionCount === 0;
  await bumpPot(s, pot, { contributionVolume: amount, contributionCount: 1 });
  if (first) {
    pot.fundedAt = s.m.ts;
    pot.fundedDay = s.m.day;
    if (pot.countedInStats) {
      (await globalStats(s)).fundedPots += 1;
      (await dailyStats(s, s.m.day)).fundedPots += 1;
    }
  }
  s.put("Contribution", {
    id: s.m.eventId,
    pot_id: pot.id,
    member_id: mem.id,
    account_id: mem.address,
    amount,
    timestamp: s.m.ts,
    txHash: s.m.tx,
  });
  await fundedAction(s, acc);
  await recomputeSettlement(s, pot);
  await activity(s, "Contributed", { pot, account: member, amount });
  s.flush();
});

// ───────────────────────────── spends ─────────────────────────────

indexer.onEvent({ contract: "Pot", event: "SpendProposed" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const p = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  const proposer = await ensureMember(s, pot, p.proposer);
  const category = clampIndex(Number(p.category), 7);
  const cat = await ensureCategory(s, pot, category);
  const id = spendEntityId(pot.id, p.id);
  s.put("Spend", {
    id,
    pot_id: pot.id,
    spendId: p.id,
    proposer_id: proposer.address,
    proposerMember_id: proposer.id,
    kind: SPEND_KINDS[Number(p.kind)] ?? "PAY",
    payee: lc(p.payee),
    amount: p.amount,
    category,
    categoryName: CATEGORY_NAMES[category] ?? "Other",
    categorySpend_id: cat.id,
    splitMembers: p.splitMembers.map(lc),
    splitWeights: [...p.splitWeights],
    receiptHash: p.receiptHash,
    memo: p.memo,
    approvalsRequired: Number(p.approvalsRequired),
    approvals: 1,
    rejections: 0,
    status: "Pending",
    cancelReason: undefined,
    expiresAt: p.expiresAt,
    proposedAt: s.m.ts,
    approvedAt: undefined,
    executedAt: undefined,
    cancelledAt: undefined,
    claimId: undefined,
    refunded: 0n,
    refundedAt: undefined,
    disputeCount: 0,
    hasOpenDispute: false,
    lastDisputeOutcome: "None",
    shareVersion: 0,
    shareMembers: [],
    shareWeights: [],
    txHash: s.m.tx,
  });
  await activity(s, "SpendProposed", { pot, account: p.proposer, amount: p.amount, counterparty: p.payee, ref: id });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "Voted" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { id, member, approve } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  await ensureAccount(s, member);
  const spend = await loadSpend(s, pot, id);
  s.put("Vote", {
    id: `${spend.id}-${lc(member)}`,
    spend_id: spend.id,
    pot_id: pot.id,
    account_id: lc(member),
    approve,
    timestamp: s.m.ts,
    txHash: s.m.tx,
  });
  if (approve) {
    spend.approvals += 1;
    await bumpPot(s, pot, { approvals: 1 });
  } else {
    spend.rejections += 1;
  }
  await activity(s, "Voted", { pot, account: member, ref: spend.id });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "SpendApproved" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const pot = await ensurePot(s, event.srcAddress);
  const spend = await loadSpend(s, pot, event.params.id);
  if (spend.status === "Pending") spend.status = "Approved";
  spend.approvedAt = s.m.ts;
  await activity(s, "SpendApproved", { pot, ref: spend.id, amount: spend.amount });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "SpendExecuted" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { id, amount, members, shares, claimId } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  const spend = await loadSpend(s, pot, id);
  spend.status = "Executed";
  spend.executedAt = s.m.ts;
  if (spend.kind === "LINK" || claimId > 0n) spend.claimId = claimId;

  if (spend.kind === "PERSONAL") {
    // no money moves: the proposer paid out of pocket
    const proposer = await ensureMember(s, pot, spend.proposer_id);
    proposer.personalPaid += amount;
    refreshNet(proposer);
    pot.totalPersonalSpent += amount;
  } else {
    // PAY / LINK: the pot sends `amount` out (LINK: into ClaimEscrow)
    pot.balance -= amount;
    pot.totalPotSpent += amount;
  }
  await bumpPot(s, pot, { spendVolume: amount, spendCount: 1 });
  await assignShares(s, pot, spend, members, shares);
  // the executed split is the proposed split (same order), so its weights are known
  spend.shareWeights = spend.splitWeights.length === members.length ? [...spend.splitWeights] : [...shares];

  const cat = await ensureCategory(s, pot, spend.category);
  cat.spent += amount;
  cat.spendCount += 1;
  refreshCategory(cat, s.m.ts);

  await recomputeSettlement(s, pot);
  await activity(s, "SpendExecuted", { pot, account: spend.proposer_id, amount, counterparty: spend.payee, ref: spend.id });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "SpendCancelled" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const pot = await ensurePot(s, event.srcAddress);
  const spend = await loadSpend(s, pot, event.params.id);
  spend.status = "Cancelled";
  spend.cancelReason = Number(event.params.reason);
  spend.cancelledAt = s.m.ts;
  await activity(s, "SpendCancelled", { pot, account: spend.proposer_id, amount: spend.amount, ref: spend.id });
  s.flush();
});

// ───────────────────────────── disputes ─────────────────────────────

indexer.onEvent({ contract: "Pot", event: "DisputeOpened" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { disputeId, spendId, by, reason, memo } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  await ensureAccount(s, by);
  const spend = await loadSpend(s, pot, spendId);
  const prev = await currentShares(s, spend);
  const id = disputeEntityId(pot.id, disputeId);
  s.put("Dispute", {
    id,
    pot_id: pot.id,
    disputeId,
    spend_id: spend.id,
    openedBy_id: lc(by),
    reason: Number(reason),
    memo,
    status: "Open",
    outcome: "None",
    votesSpenderCovers: 0,
    votesKeep: 0,
    openedAt: s.m.ts,
    resolvedAt: undefined,
    previousMembers: prev.members,
    previousShares: prev.amounts,
    resolvedMembers: [],
    resolvedShares: [],
  });
  spend.disputeCount += 1;
  spend.hasOpenDispute = true;
  await activity(s, "DisputeOpened", { pot, account: by, amount: spend.amount, ref: id });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "DisputeVoted" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { disputeId, member, spenderCovers } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  await ensureAccount(s, member);
  const id = disputeEntityId(pot.id, disputeId);
  s.put("DisputeVote", {
    id: `${id}-${lc(member)}`,
    dispute_id: id,
    pot_id: pot.id,
    account_id: lc(member),
    spenderCovers,
    timestamp: s.m.ts,
  });
  const d = await s.load("Dispute", id);
  if (d) {
    if (spenderCovers) d.votesSpenderCovers += 1;
    else d.votesKeep += 1;
  }
  await activity(s, "DisputeVoted", { pot, account: member, ref: id });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "DisputeResolved" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { disputeId, outcome, members, shares } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  const id = disputeEntityId(pot.id, disputeId);
  const d = await s.load("Dispute", id);
  const out = DISPUTE_OUTCOMES[Number(outcome)] ?? "None";
  if (!d) {
    if (!context.isPreload) context.log.error(`Dispute ${id} not found`);
    s.flush();
    return;
  }
  d.status = "Resolved";
  d.outcome = out;
  d.resolvedAt = s.m.ts;
  d.resolvedMembers = members.map(lc);
  d.resolvedShares = [...shares];
  const spend = await s.load("Spend", d.spend_id);
  if (spend) {
    spend.hasOpenDispute = false;
    spend.lastDisputeOutcome = out;
    // Keep: the contract re-emits the current assignment but moves no shares — leave the ledger alone.
    // Resplit / SpenderCovers: the event carries the exact replacement assignment.
    if (out !== "Keep" && members.length > 0) {
      await removeShares(s, pot, spend);
      await assignShares(s, pot, spend, members, shares);
      // SpenderCovers stores weight [1]; Resplit weights are not in the event, so the parts stand in
      // for them (exact for full refunds, which is all ClaimEscrow produces).
      spend.shareWeights = out === "SpenderCovers" ? [1n] : [...shares];
      await recomputeSettlement(s, pot);
    }
  }
  await activity(s, "DisputeResolved", { pot, ref: id, amount: spend?.amount });
  s.flush();
});

// ───────────────────────────── safety controls ─────────────────────────────

indexer.onEvent({ contract: "Pot", event: "Frozen" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const pot = await ensurePot(s, event.srcAddress);
  await ensureAccount(s, event.params.by);
  s.put("Freeze", {
    id: s.m.eventId,
    pot_id: pot.id,
    by_id: lc(event.params.by),
    until: event.params.until,
    timestamp: s.m.ts,
    liftedAt: undefined,
    liftedBy: undefined,
    txHash: s.m.tx,
  });
  pot.frozenUntil = event.params.until;
  pot.lastFreeze_id = s.m.eventId;
  await activity(s, "Frozen", { pot, account: event.params.by, ref: s.m.eventId });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "Unfrozen" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const pot = await ensurePot(s, event.srcAddress);
  pot.frozenUntil = 0n;
  if (pot.lastFreeze_id) {
    const f = await s.load("Freeze", pot.lastFreeze_id);
    if (f) {
      f.liftedAt = s.m.ts;
      f.liftedBy = lc(event.params.lastVoter);
    }
  }
  await activity(s, "Unfrozen", { pot, account: event.params.lastVoter });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "RuleChangeProposed" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const p = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  await ensureAccount(s, p.proposer);
  const id = ruleChangeEntityId(pot.id, p.id);
  s.put("RuleChange", {
    id,
    pot_id: pot.id,
    ruleChangeId: p.id,
    proposer_id: lc(p.proposer),
    ...rulesFields(p.rules),
    allowAdd: p.allowAdd.map(lc),
    allowRemove: p.allowRemove.map(lc),
    expiresAt: p.expiresAt,
    status: "Proposed",
    approvals: 1,
    rejections: 0,
    eta: undefined,
    appliedRulesVersion: undefined,
    proposedAt: s.m.ts,
    approvedAt: undefined,
    appliedAt: undefined,
  });
  await activity(s, "RuleChangeProposed", { pot, account: p.proposer, ref: id });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "RuleChangeVoted" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { id, member, approve } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  await ensureAccount(s, member);
  const rid = ruleChangeEntityId(pot.id, id);
  s.put("RuleChangeVote", { id: `${rid}-${lc(member)}`, ruleChange_id: rid, account_id: lc(member), approve, timestamp: s.m.ts });
  const rc = await s.load("RuleChange", rid);
  if (rc) {
    if (approve) rc.approvals += 1;
    else rc.rejections += 1;
  }
  await activity(s, "RuleChangeVoted", { pot, account: member, ref: rid });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "RuleChangeApproved" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const pot = await ensurePot(s, event.srcAddress);
  const rid = ruleChangeEntityId(pot.id, event.params.id);
  const rc = await s.load("RuleChange", rid);
  if (rc) {
    rc.status = "Approved";
    rc.eta = event.params.eta;
    rc.approvedAt = s.m.ts;
  }
  await activity(s, "RuleChangeApproved", { pot, ref: rid });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "RuleChangeApplied" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const pot = await ensurePot(s, event.srcAddress);
  const rid = ruleChangeEntityId(pot.id, event.params.id);
  const rc = await s.load("RuleChange", rid);
  if (rc) {
    rc.status = "Applied";
    rc.appliedAt = s.m.ts;
    rc.appliedRulesVersion = event.params.rulesVersion;
  }
  await activity(s, "RuleChangeApplied", { pot, ref: rid });
  s.flush();
});

// ───────────────────────────── acks ─────────────────────────────

indexer.onEvent({ contract: "Pot", event: "Acked" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { member, ackEpoch } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  const mem = await ensureMember(s, pot, member);
  mem.lastAckEpoch = ackEpoch;
  if (ackEpoch === pot.ackEpoch) pot.acksInEpoch += 1;
  else if (ackEpoch > pot.ackEpoch) {
    pot.ackEpoch = ackEpoch;
    pot.acksInEpoch = 1;
  }
  s.put("Ack", { id: `${mem.id}-${ackEpoch}`, pot_id: pot.id, account_id: mem.address, ackEpoch, timestamp: s.m.ts });
  await activity(s, "Acked", { pot, account: member });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "AcksReset" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const pot = await ensurePot(s, event.srcAddress);
  pot.ackEpoch = event.params.newAckEpoch;
  pot.acksInEpoch = 0;
  await activity(s, "AcksReset", { pot });
  s.flush();
});

// ───────────────────────────── ending ─────────────────────────────

indexer.onEvent({ contract: "Pot", event: "Pulled" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { member, amount } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  const mem = await ensureMember(s, pot, member);
  // corridor attribution uses the graph as it was before this payment
  await attributeDebtorPayment(s, pot, mem, amount, "SettlementPull");
  mem.contributed += amount; // protocol: each pull counts as contributed
  mem.pulled += amount;
  refreshNet(mem);
  pot.balance += amount;
  pot.totalPulled += amount;
  s.put("Pull", { id: s.m.eventId, pot_id: pot.id, account_id: mem.address, amount, timestamp: s.m.ts, txHash: s.m.tx });
  await recomputeSettlement(s, pot);
  await activity(s, "Pulled", { pot, account: member, amount });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "Payout" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { member, amount } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  const mem = await ensureMember(s, pot, member);
  mem.withdrawn += amount;
  refreshNet(mem);
  pot.balance -= amount;
  pot.totalPaidOut += amount;
  s.put("Payout", {
    id: s.m.eventId,
    pot_id: pot.id,
    account_id: mem.address,
    amount,
    afterSettlement: pot.status === "Settled",
    // set to Collect by the Collected event that follows a collect() payout
    source: "Automatic",
    collectedBy_id: undefined,
    timestamp: s.m.ts,
    txHash: s.m.tx,
  });
  await recomputeSettlement(s, pot);
  await activity(s, "Payout", { pot, account: member, amount });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "DebtRecorded" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { member, amount } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  const mem = await ensureMember(s, pot, member);
  mem.debt += amount;
  pot.totalDebtRecorded += amount;
  s.put("Debt", { id: s.m.eventId, pot_id: pot.id, account_id: mem.address, kind: "Recorded", amount, timestamp: s.m.ts, txHash: s.m.tx });
  await activity(s, "DebtRecorded", { pot, account: member, amount });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "DebtPaid" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { member, amount } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  const mem = await ensureMember(s, pot, member);
  await attributeDebtorPayment(s, pot, mem, amount, "DebtPayment");
  // payDebt deposits into the pot: counts as contributed (the distribution emits Payout events)
  mem.contributed += amount;
  mem.debtPaid += amount;
  mem.debt = maxBig(0n, mem.debt - amount);
  refreshNet(mem);
  pot.balance += amount;
  pot.totalDebtPaid += amount;
  s.put("Debt", { id: s.m.eventId, pot_id: pot.id, account_id: mem.address, kind: "Paid", amount, timestamp: s.m.ts, txHash: s.m.tx });
  await recomputeSettlement(s, pot);
  await activity(s, "DebtPaid", { pot, account: member, amount });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "MemberExited" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { member, netAtExit, paidOut, pulledIn } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  const mem = await ensureMember(s, pot, member);
  if (mem.status === "Active") {
    const before = pot.activeMemberCount;
    pot.activeMemberCount = Math.max(0, pot.activeMemberCount - 1);
    await moveMembersHist(s, pot, before, pot.activeMemberCount);
  }
  mem.status = "Exited";
  mem.exitedAt = s.m.ts;
  mem.netAtExit = netAtExit;
  mem.paidOutAtExit = paidOut;
  mem.pulledInAtExit = pulledIn;
  await activity(s, "MemberExited", { pot, account: member, amount: paidOut });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "Settled" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { by, paidOut, pulledIn, unpaidClaims, fxRoundId } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  await ensureAccount(s, by);
  s.put("PotSettlement", {
    id: s.m.eventId,
    pot_id: pot.id,
    by_id: lc(by),
    paidOut,
    pulledIn,
    unpaidClaims,
    // display label only: the FxReference round fresh at settle time (0 = none)
    fxRoundId,
    fxRound_id: fxRoundEntityId(fxRoundId),
    timestamp: s.m.ts,
    txHash: s.m.tx,
  });
  pot.status = "Settled";
  pot.settledAt = s.m.ts;
  await bumpPot(s, pot, { settlements: 1, settledVolume: paidOut });
  await activity(s, "Settled", { pot, account: by, amount: paidOut });
  s.flush();
});

// collect(member) after settlement pays one member through _tryPay, which emits Payout(member, amount)
// and then, with no external call in between, Collected(member, by, amount). The ledger (withdrawn,
// balance, totalPaidOut) already moved on that Payout, so this handler only labels it: no money here.
indexer.onEvent({ contract: "Pot", event: "Collected" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { member, by, amount } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  await ensureAccount(s, by);
  const payoutId = `${s.m.block}-${s.m.logIndex - 1}`;
  const payout = await s.get("Payout", payoutId);
  if (payout && payout.pot_id === pot.id && payout.account_id === lc(member) && payout.amount === amount && payout.txHash === s.m.tx) {
    payout.source = "Collect";
    payout.collectedBy_id = lc(by);
    s.put("Payout", payout);
    pot.totalCollected += amount;
  } else if (!context.isPreload) {
    context.log.error(`Collected ${s.m.eventId}: no matching Payout at ${payoutId}; ledger unaffected`);
  }
  await activity(s, "Collected", { pot, account: member, counterparty: by, amount, ref: payoutId });
  s.flush();
});

indexer.onEvent({ contract: "Pot", event: "EscrowRefunded" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const { spendId, amount } = event.params;
  const pot = await ensurePot(s, event.srcAddress);
  const spend = await loadSpend(s, pot, spendId);
  pot.balance += amount;
  pot.totalRefunded += amount;

  // Reverse the spend's shares pro rata, remainder to position 0, exactly like the contract's
  // _parts(refund, weights). Falls back to the current share amounts when weights are unknown
  // (identical result for a full refund).
  const cur = await currentShares(s, spend);
  const w = spend.shareWeights;
  const useWeights = w.length === cur.members.length && w.some((x) => x > 0n);
  const red = proRataReduction(useWeights ? w : cur.amounts, amount);
  for (let i = 0; i < cur.members.length; i++) {
    const addr = cur.members[i]!;
    const r = red[i] ?? 0n;
    const sh = await s.load("SpendShare", `${spend.id}-${addr}`);
    if (sh) {
      sh.refunded += r;
      sh.amount -= r;
    }
    const mem = await ensureMember(s, pot, addr);
    mem.share -= r;
    refreshNet(mem);
  }
  spend.refunded += amount;
  spend.refundedAt = s.m.ts;

  const cat = await s.load("CategorySpend", categoryId(pot.id, spend.category));
  if (cat) {
    cat.refunded += amount;
    refreshCategory(cat, s.m.ts);
  }
  await recomputeSettlement(s, pot);
  await activity(s, "EscrowRefunded", { pot, amount, ref: spend.id });
  s.flush();
});
