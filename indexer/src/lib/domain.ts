// Domain helpers: entity factories, ledger, settle-up graph, corridors and traction stats.
// All functions mutate objects owned by the handler's Store; the handler calls s.flush() at the end.
import { internalKindOf } from "./internal.js";
import { allocateAcrossEdges, minCashFlow } from "./settlement.js";
import type { E, Store } from "./store.js";
import {
  CATEGORY_NAMES,
  MAX_MEMBERS,
  TTFFA_BUCKETS,
  clampIndex,
  dateOf,
  categoryId,
  lc,
  medianBucket,
  medianFromHistogram,
  memberId,
  netOf,
  ttffaBucketOf,
} from "./util.js";

type Pot = E<"Pot">;
type Account = E<"Account">;
type Member = E<"Member">;
type Global = E<"GlobalStats">;

const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

// ───────────────────────────── stats singletons ─────────────────────────────

export async function globalStats(s: Store): Promise<Global> {
  const { e } = await s.getOr("GlobalStats", "global", () => ({
    id: "global",
    users: 0,
    accounts: 0,
    potsCreated: 0,
    fundedPots: 0,
    contributionVolume: 0n,
    contributionCount: 0,
    spends: 0,
    spendVolume: 0n,
    approvals: 0,
    settlements: 0,
    settledVolume: 0n,
    sends: 0,
    sendVolume: 0n,
    claims: 0,
    claimVolume: 0n,
    crossBorderVolume: 0n,
    crossBorderCount: 0,
    membersPerPotHistogram: zeros(MAX_MEMBERS + 1),
    medianMembersPerPot: 0,
    countriesPerPotHistogram: zeros(MAX_MEMBERS + 1),
    medianCountriesPerPot: 0,
    ttffaBucketsSeconds: [...TTFFA_BUCKETS],
    ttffaHistogram: zeros(TTFFA_BUCKETS.length),
    ttffaSamples: 0,
    medianTtffaLowerSeconds: 0,
    medianTtffaUpperSeconds: 0,
    allPots: 0,
    demoPots: 0,
    allAccounts: 0,
    internalAccounts: 0,
    updatedAt: s.m.ts,
  }));
  e.updatedAt = s.m.ts;
  return e;
}

export async function dailyStats(s: Store, day: number): Promise<E<"DailyStats">> {
  const { e } = await s.getOr("DailyStats", String(day), () => ({
    id: String(day),
    day,
    date: dateOf(day),
    newUsers: 0,
    potsCreated: 0,
    fundedPots: 0,
    contributionVolume: 0n,
    contributionCount: 0,
    spendVolume: 0n,
    spends: 0,
    approvals: 0,
    settlements: 0,
    settledVolume: 0n,
    sends: 0,
    sendVolume: 0n,
    claims: 0,
    claimVolume: 0n,
    crossBorderVolume: 0n,
    crossBorderCount: 0,
  }));
  return e;
}

// ───────────────────────────── entity factories ─────────────────────────────

export async function ensureAccount(s: Store, address: string): Promise<Account> {
  const addr = lc(address);
  const { e, created } = await s.getOr("Account", addr, () => {
    const kind = internalKindOf(addr);
    return {
      id: addr,
      address: addr,
      isInternal: kind !== "None",
      internalKind: kind,
      key: undefined,
      keyRegisteredAt: undefined,
      country: undefined,
      firstSeen: s.m.ts,
      firstSeenBlock: s.m.block,
      isUser: false,
      userSinceDay: undefined,
      nonDemoPotCount: 0,
      nonInternalSendCount: 0,
      firstJoinedAt: undefined,
      firstJoinPot_id: undefined,
      firstFundedActionAt: undefined,
      timeToFirstFundedAction: undefined,
      ttffaCounted: false,
    };
  });
  if (created) {
    const g = await globalStats(s);
    g.allAccounts += 1;
    if (e.isInternal) g.internalAccounts += 1;
  }
  return e;
}

export async function ensurePot(s: Store, address: string): Promise<Pot> {
  const addr = lc(address);
  const { e } = await s.getOr("Pot", addr, () => ({
    id: addr,
    address: addr,
    registered: false,
    factory: undefined,
    creator_id: undefined,
    createdAt: undefined,
    createdBlock: undefined,
    createdTx: undefined,
    createdDay: undefined,
    startTime: 0n,
    endTime: 0n,
    reviewWindow: 0n,
    meta: "0x",
    inviteKeyWrap: "0x",
    inviteSigner: undefined,
    status: "Active" as const,
    settledAt: undefined,
    frozenUntil: 0n,
    lastFreeze_id: undefined,
    ackEpoch: 0n,
    acksInEpoch: 0,
    rulesVersion: 0n,
    currentRules_id: undefined,
    instantMax: 0n,
    oneApprovalMax: 0n,
    highTier: "MAJORITY",
    memberDailyCap: 0n,
    memberTotalCap: 0n,
    payeePolicy: "ANYONE",
    minContribution: 0n,
    proposalTtl: 0n,
    ruleTimelock: 0n,
    categoryBudgets: Array.from({ length: 8 }, () => 0n),
    memberCount: 0,
    activeMemberCount: 0,
    countryCount: 0,
    countries: [],
    memberAddresses: [],
    balance: 0n,
    totalContributed: 0n,
    totalPulled: 0n,
    totalDebtPaid: 0n,
    totalSpent: 0n,
    totalPotSpent: 0n,
    totalPersonalSpent: 0n,
    totalRefunded: 0n,
    totalPaidOut: 0n,
    totalDebtRecorded: 0n,
    contributionCount: 0,
    spendCount: 0,
    approvalCount: 0,
    settlementCount: 0,
    settledVolume: 0n,
    crossBorderVolume: 0n,
    crossBorderCount: 0,
    fundedAt: undefined,
    fundedDay: undefined,
    lastActivityAt: undefined,
    isDemo: false,
    hasDemoMember: false,
    countedInStats: false,
    dailyIds: [],
    corridorIds: [],
    edgeIds: [],
  }));
  return e;
}

/** Loads (or creates a stub for) a member. Stubs are added to the pot's member list. */
export async function ensureMember(s: Store, pot: Pot, address: string): Promise<Member> {
  const addr = lc(address);
  await ensureAccount(s, addr);
  const { e } = await s.getOr("Member", memberId(pot.id, addr), () => ({
    id: memberId(pot.id, addr),
    pot_id: pot.id,
    account_id: addr,
    address: addr,
    memberIndex: undefined,
    country: undefined,
    safetyNet: 0n,
    status: "Active" as const,
    joinedAt: undefined,
    exitedAt: undefined,
    contributed: 0n,
    personalPaid: 0n,
    share: 0n,
    withdrawn: 0n,
    net: 0n,
    pulled: 0n,
    debtPaid: 0n,
    debt: 0n,
    lastAckEpoch: undefined,
    netAtExit: undefined,
    paidOutAtExit: undefined,
    pulledInAtExit: undefined,
  }));
  if (!pot.memberAddresses.includes(addr)) pot.memberAddresses = [...pot.memberAddresses, addr];
  return e;
}

export function refreshNet(m: Member): void {
  m.net = netOf(m);
}

export async function ensureCategory(s: Store, pot: Pot, category: number): Promise<E<"CategorySpend">> {
  const c = clampIndex(category, 7);
  const { e } = await s.getOr("CategorySpend", categoryId(pot.id, c), () => ({
    id: categoryId(pot.id, c),
    pot_id: pot.id,
    category: c,
    name: CATEGORY_NAMES[c] ?? "Other",
    budget: pot.categoryBudgets[c] ?? 0n,
    spent: 0n,
    refunded: 0n,
    netSpent: 0n,
    remaining: undefined,
    spendCount: 0,
    updatedAt: s.m.ts,
  }));
  refreshCategory(e, s.m.ts);
  return e;
}

export function refreshCategory(c: E<"CategorySpend">, ts: number): void {
  c.netSpent = c.spent - c.refunded;
  c.remaining = c.budget > 0n ? c.budget - c.spent : undefined;
  c.updatedAt = ts;
}

// ───────────────────────────── per-pot metrics ─────────────────────────────

type MetricKey =
  | "contributionVolume"
  | "contributionCount"
  | "spendVolume"
  | "spendCount"
  | "approvals"
  | "settlements"
  | "settledVolume"
  | "crossBorderVolume"
  | "crossBorderCount";

/** One row per traction metric: field on Pot, PotDaily, GlobalStats and DailyStats. */
const METRICS: { k: MetricKey; pot: string; pd: string; g: string; big: boolean }[] = [
  { k: "contributionVolume", pot: "totalContributed", pd: "contributionVolume", g: "contributionVolume", big: true },
  { k: "contributionCount", pot: "contributionCount", pd: "contributionCount", g: "contributionCount", big: false },
  { k: "spendVolume", pot: "totalSpent", pd: "spendVolume", g: "spendVolume", big: true },
  { k: "spendCount", pot: "spendCount", pd: "spendCount", g: "spends", big: false },
  { k: "approvals", pot: "approvalCount", pd: "approvals", g: "approvals", big: false },
  { k: "settlements", pot: "settlementCount", pd: "settlements", g: "settlements", big: false },
  { k: "settledVolume", pot: "settledVolume", pd: "settledVolume", g: "settledVolume", big: true },
  { k: "crossBorderVolume", pot: "crossBorderVolume", pd: "crossBorderVolume", g: "crossBorderVolume", big: true },
  { k: "crossBorderCount", pot: "crossBorderCount", pd: "crossBorderCount", g: "crossBorderCount", big: false },
];

export type PotDelta = Partial<Record<MetricKey, bigint | number>>;

function addTo(obj: unknown, field: string, v: bigint | number, sign: number, big: boolean): void {
  const o = obj as Record<string, bigint | number>;
  if (big) o[field] = (o[field] as bigint) + BigInt(sign) * BigInt(v);
  else o[field] = (o[field] as number) + sign * Number(v);
}

export async function potDaily(s: Store, pot: Pot, day: number): Promise<E<"PotDaily">> {
  const id = `${pot.id}-${day}`;
  const { e, created } = await s.getOr("PotDaily", id, () => ({
    id,
    pot_id: pot.id,
    day,
    date: dateOf(day),
    contributionVolume: 0n,
    contributionCount: 0,
    spendVolume: 0n,
    spendCount: 0,
    approvals: 0,
    settlements: 0,
    settledVolume: 0n,
    crossBorderVolume: 0n,
    crossBorderCount: 0,
    eventCount: 0,
  }));
  if (created && !pot.dailyIds.includes(id)) pot.dailyIds = [...pot.dailyIds, id];
  return e;
}

/**
 * Adds a delta to the pot's accumulators and its PotDaily row, and — only while the pot is
 * counted in traction (registered and not demo) — to GlobalStats and DailyStats.
 */
export async function bumpPot(s: Store, pot: Pot, delta: PotDelta): Promise<void> {
  const pd = await potDaily(s, pot, s.m.day);
  const g = pot.countedInStats ? await globalStats(s) : undefined;
  const d = pot.countedInStats ? await dailyStats(s, s.m.day) : undefined;
  for (const m of METRICS) {
    const v = delta[m.k];
    if (v === undefined) continue;
    addTo(pot, m.pot, v, 1, m.big);
    addTo(pd, m.pd, v, 1, m.big);
    if (g) addTo(g, m.g, v, 1, m.big);
    if (d) addTo(d, m.g, v, 1, m.big);
  }
}

// ───────────────────────────── histograms ─────────────────────────────

function histAdd(hist: number[], index: number, sign: number): number[] {
  const h = [...hist];
  const i = clampIndex(index, h.length - 1);
  h[i] = (h[i] ?? 0) + sign;
  return h;
}

function refreshMedians(g: Global): void {
  g.medianMembersPerPot = medianFromHistogram(g.membersPerPotHistogram);
  g.medianCountriesPerPot = medianFromHistogram(g.countriesPerPotHistogram);
  const b = medianBucket(g.ttffaHistogram);
  g.medianTtffaLowerSeconds = b < 0 ? 0 : (TTFFA_BUCKETS[b] ?? 0);
  // open-ended last bucket: upper = lower
  g.medianTtffaUpperSeconds = b < 0 ? 0 : (TTFFA_BUCKETS[b + 1] ?? TTFFA_BUCKETS[b] ?? 0);
}

/** Moves a counted pot between member-count buckets. */
export async function moveMembersHist(s: Store, pot: Pot, from: number, to: number): Promise<void> {
  if (!pot.countedInStats || from === to) return;
  const g = await globalStats(s);
  g.membersPerPotHistogram = histAdd(histAdd(g.membersPerPotHistogram, from, -1), to, 1);
  refreshMedians(g);
}

export async function moveCountriesHist(s: Store, pot: Pot, from: number, to: number): Promise<void> {
  if (!pot.countedInStats || from === to) return;
  const g = await globalStats(s);
  g.countriesPerPotHistogram = histAdd(histAdd(g.countriesPerPotHistogram, from, -1), to, 1);
  refreshMedians(g);
}

function ttffaAdd(g: Global, seconds: number, sign: number): void {
  g.ttffaHistogram = histAdd(g.ttffaHistogram, ttffaBucketOf(seconds), sign);
  g.ttffaSamples += sign;
  refreshMedians(g);
}

// ───────────────────────────── users / TTFFA ─────────────────────────────

/** Re-evaluates the "user" definition for an account and keeps GlobalStats/DailyStats in sync. */
export async function updateUser(s: Store, acc: Account): Promise<void> {
  const should = !acc.isInternal && (acc.nonDemoPotCount > 0 || acc.nonInternalSendCount > 0);
  if (should && !acc.isUser) {
    const g = await globalStats(s);
    const d = await dailyStats(s, s.m.day);
    acc.isUser = true;
    acc.userSinceDay = s.m.day;
    g.users += 1;
    d.newUsers += 1;
  } else if (!should && acc.isUser) {
    const g = await globalStats(s);
    if (acc.userSinceDay !== undefined) (await dailyStats(s, acc.userSinceDay)).newUsers -= 1;
    acc.isUser = false;
    acc.userSinceDay = undefined;
    g.users -= 1;
  }
}

/** Records the first funded action (Contributed / Sent / Claimed) after the account's first join. */
export async function fundedAction(s: Store, acc: Account): Promise<void> {
  if (acc.firstJoinedAt === undefined || acc.firstFundedActionAt !== undefined) return;
  acc.firstFundedActionAt = s.m.ts;
  const secs = Math.max(0, s.m.ts - acc.firstJoinedAt);
  acc.timeToFirstFundedAction = secs;
  if (acc.isInternal || !acc.firstJoinPot_id) return;
  const pot = await s.get("Pot", acc.firstJoinPot_id);
  if (pot?.countedInStats) {
    ttffaAdd(await globalStats(s), secs, 1);
    acc.ttffaCounted = true;
  }
}

// ───────────────────────────── demo plans ─────────────────────────────

/**
 * Adds (sign = +1) or removes (sign = −1) everything a pot contributed to traction stats:
 * pot counters, funded flag, per-day rows, histograms, corridors, member "user" status and
 * time-to-first-funded-action samples. Used when a pot becomes counted (PotCreated, non-demo)
 * and when it turns demo later (a Demo account joins).
 */
export async function applyPotToStats(s: Store, pot: Pot, sign: 1 | -1): Promise<void> {
  if ((sign === 1) === pot.countedInStats) return;
  const g = await globalStats(s);
  g.potsCreated += sign;
  if (pot.createdDay !== undefined) (await dailyStats(s, pot.createdDay)).potsCreated += sign;
  if (pot.fundedDay !== undefined) {
    g.fundedPots += sign;
    (await dailyStats(s, pot.fundedDay)).fundedPots += sign;
  }
  for (const m of METRICS) addTo(g, m.g, (pot as unknown as Record<string, bigint | number>)[m.pot]!, sign, m.big);
  for (const id of pot.dailyIds) {
    const pd = await s.get("PotDaily", id);
    if (!pd) continue;
    const d = await dailyStats(s, pd.day);
    for (const m of METRICS) addTo(d, m.g, (pd as unknown as Record<string, bigint | number>)[m.pd]!, sign, m.big);
  }
  g.membersPerPotHistogram = histAdd(g.membersPerPotHistogram, pot.activeMemberCount, sign);
  g.countriesPerPotHistogram = histAdd(g.countriesPerPotHistogram, pot.countryCount, sign);
  for (const id of pot.corridorIds) {
    const pc = await s.get("PotCorridor", id);
    if (!pc) continue;
    const c = await s.load("Corridor", pc.corridor_id);
    if (!c) continue;
    c.volume += BigInt(sign) * pc.volume;
    c.count += sign * pc.count;
    c.potVolume += BigInt(sign) * pc.volume;
    c.updatedAt = s.m.ts;
  }
  pot.countedInStats = sign === 1;
  for (const addr of pot.memberAddresses) {
    const mem = await s.get("Member", memberId(pot.id, addr));
    if (!mem || mem.joinedAt === undefined) continue;
    const acc = await s.load("Account", addr);
    if (!acc) continue;
    acc.nonDemoPotCount += sign;
    await updateUser(s, acc);
    if (acc.firstJoinPot_id === pot.id && acc.timeToFirstFundedAction !== undefined && !acc.isInternal) {
      if (sign === 1 && !acc.ttffaCounted) {
        ttffaAdd(g, acc.timeToFirstFundedAction, 1);
        acc.ttffaCounted = true;
      } else if (sign === -1 && acc.ttffaCounted) {
        ttffaAdd(g, acc.timeToFirstFundedAction, -1);
        acc.ttffaCounted = false;
      }
    }
  }
  refreshMedians(g);
}

/** Marks a pot as demo; if it was counted, retracts it from every traction metric. */
export async function markDemo(s: Store, pot: Pot): Promise<void> {
  if (pot.isDemo) return;
  pot.isDemo = true;
  if (pot.registered) (await globalStats(s)).demoPots += 1;
  if (pot.countedInStats) await applyPotToStats(s, pot, -1);
}

// ───────────────────────────── corridors ─────────────────────────────

export type FlowSource = "Send" | "SendLinkClaim" | "PotLinkClaim" | "SettlementPull" | "DebtPayment";

/**
 * Attributes an AUSD flow to the (fromCountry → toCountry) corridor.
 * Pot flows are counted iff the pot is counted; other flows use `counted`.
 * Flows with an unknown country on either side are not attributed.
 */
export async function recordFlow(
  s: Store,
  a: {
    source: FlowSource;
    fromCountry: string | undefined;
    toCountry: string | undefined;
    amount: bigint;
    from: string;
    to: string;
    pot?: Pot;
    counted?: boolean;
  },
): Promise<void> {
  if (!a.fromCountry || !a.toCountry || a.amount <= 0n) return;
  const counted = a.pot ? a.pot.countedInStats : (a.counted ?? false);
  const cross = a.fromCountry !== a.toCountry;
  const cid = `${a.fromCountry}-${a.toCountry}`;
  const { e: c } = await s.getOr("Corridor", cid, () => ({
    id: cid,
    fromCountry: a.fromCountry!,
    toCountry: a.toCountry!,
    isCrossBorder: cross,
    volume: 0n,
    count: 0,
    sendVolume: 0n,
    claimVolume: 0n,
    potVolume: 0n,
    volumeAll: 0n,
    countAll: 0,
    updatedAt: s.m.ts,
  }));
  c.volumeAll += a.amount;
  c.countAll += 1;
  c.updatedAt = s.m.ts;
  if (counted) {
    c.volume += a.amount;
    c.count += 1;
    if (a.source === "Send") c.sendVolume += a.amount;
    else if (a.source === "SendLinkClaim") c.claimVolume += a.amount;
    else c.potVolume += a.amount;
  }
  if (a.pot) {
    const pot = a.pot;
    const pcid = `${pot.id}-${cid}`;
    const { e: pc, created } = await s.getOr("PotCorridor", pcid, () => ({
      id: pcid,
      pot_id: pot.id,
      corridor_id: cid,
      volume: 0n,
      count: 0,
    }));
    if (created && !pot.corridorIds.includes(pcid)) pot.corridorIds = [...pot.corridorIds, pcid];
    pc.volume += a.amount;
    pc.count += 1;
    if (cross) await bumpPot(s, pot, { crossBorderVolume: a.amount, crossBorderCount: 1 });
  } else if (counted && cross) {
    const g = await globalStats(s);
    const d = await dailyStats(s, s.m.day);
    g.crossBorderVolume += a.amount;
    g.crossBorderCount += 1;
    d.crossBorderVolume += a.amount;
    d.crossBorderCount += 1;
  }
  s.put("CorridorFlow", {
    id: `${s.m.eventId}-${lc(a.from)}-${lc(a.to)}`,
    corridor_id: cid,
    source: a.source,
    pot_id: a.pot?.id,
    from: lc(a.from),
    to: lc(a.to),
    amount: a.amount,
    counted,
    timestamp: s.m.ts,
    txHash: s.m.tx,
  });
}

/**
 * A debtor paid `amount` into the pot (settlement pull or payDebt). Attributes it to corridors
 * along the debtor's current MemberToMember edges (computed before the payment is applied).
 */
export async function attributeDebtorPayment(
  s: Store,
  pot: Pot,
  debtor: Member,
  amount: bigint,
  source: "SettlementPull" | "DebtPayment",
): Promise<void> {
  const edges: { to: string; amount: bigint }[] = [];
  const loaded = await Promise.all(pot.edgeIds.map((id) => s.get("SettlementEdge", id)));
  for (const e of loaded) {
    if (e && e.kind === "MemberToMember" && e.from_id === debtor.address && e.to_id) {
      edges.push({ to: e.to_id, amount: e.amount });
    }
  }
  for (const part of allocateAcrossEdges(amount, edges)) {
    const creditor = await s.get("Member", memberId(pot.id, part.to));
    await recordFlow(s, {
      source,
      fromCountry: debtor.country,
      toCountry: creditor?.country,
      amount: part.amount,
      from: debtor.address,
      to: part.to,
      pot,
    });
  }
}

// ───────────────────────────── settle-up graph ─────────────────────────────

/**
 * Recomputes the pot's SettlementEdges (greedy min-cash-flow over current nets), deletes stale
 * edges and rewrites every MemberBalance. Called after every change to any member's net.
 */
export async function recomputeSettlement(s: Store, pot: Pot): Promise<void> {
  // concurrent loads let the preload phase batch them into one query
  const loaded = await Promise.all(pot.memberAddresses.map((addr) => s.get("Member", memberId(pot.id, addr))));
  const members = loaded.filter((m): m is Member => m !== undefined);
  const byAddr = new Map(members.map((m) => [m.address, m] as const));
  const planned = minCashFlow(members.map((m) => ({ address: m.address, net: m.net })));
  const owes = new Map<string, bigint>();
  const owedByMembers = new Map<string, bigint>();
  const owedByPot = new Map<string, bigint>();
  const add = (map: Map<string, bigint>, k: string, v: bigint) => map.set(k, (map.get(k) ?? 0n) + v);

  const newIds: string[] = [];
  for (const e of planned) {
    const id = `${pot.id}-${e.from ?? "pot"}-${e.to ?? "pot"}`;
    newIds.push(id);
    if (e.from) add(owes, e.from, e.amount);
    if (e.to && e.from) add(owedByMembers, e.to, e.amount);
    if (e.to && !e.from) add(owedByPot, e.to, e.amount);
    s.put("SettlementEdge", {
      id,
      pot_id: pot.id,
      kind: e.kind,
      from_id: e.from,
      to_id: e.to,
      fromMember_id: e.from ? memberId(pot.id, e.from) : undefined,
      toMember_id: e.to ? memberId(pot.id, e.to) : undefined,
      amount: e.amount,
      fromCountry: e.from ? byAddr.get(e.from)?.country : undefined,
      toCountry: e.to ? byAddr.get(e.to)?.country : undefined,
      updatedAt: s.m.ts,
    });
  }
  const keep = new Set(newIds);
  for (const old of pot.edgeIds) if (!keep.has(old)) s.del("SettlementEdge", old);
  pot.edgeIds = newIds;

  for (const m of members) {
    s.put("MemberBalance", {
      id: m.id,
      pot_id: pot.id,
      member_id: m.id,
      account_id: m.address,
      net: m.net,
      owes: owes.get(m.address) ?? 0n,
      owedByMembers: owedByMembers.get(m.address) ?? 0n,
      owedByPot: owedByPot.get(m.address) ?? 0n,
      settledUp: m.net === 0n,
      updatedAt: s.m.ts,
    });
  }
}

// ───────────────────────────── activity feed ─────────────────────────────

export async function activity(
  s: Store,
  kind: E<"Activity">["kind"],
  o: { pot?: Pot; account?: string; amount?: bigint; counterparty?: string; ref?: string },
): Promise<void> {
  s.put("Activity", {
    id: s.m.eventId,
    pot_id: o.pot?.id,
    account_id: o.account ? lc(o.account) : undefined,
    kind,
    amount: o.amount,
    counterparty: o.counterparty ? lc(o.counterparty) : undefined,
    ref: o.ref,
    timestamp: s.m.ts,
    block: s.m.block,
    txHash: s.m.tx,
  });
  if (o.pot) {
    o.pot.lastActivityAt = s.m.ts;
    (await potDaily(s, o.pot, s.m.day)).eventCount += 1;
  }
}
