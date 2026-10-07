/**
 * Envio HyperIndex GraphQL (indexer/README.md). Queries mirror indexer/queries/*.graphql, plus a
 * few lookups the app needs (invite preview, claim by signer, sends, key wraps). Entities are per
 * chain, so every query filters by chainId; addresses are lowercase.
 */
import { applyEndpointOverrides, config } from "../../config";
import { fetchJson, NetworkError } from "./http";
import { getRuntimeConfig } from "./relayer";

export class IndexerError extends Error {}

let asking: Promise<void> | null = null;

/**
 * The indexer URL: built in, set in Diagnostics, or published by the relayer (GET /v1/config). Queries
 * made before the relayer has answered wait for that one request; with no URL anywhere they fail
 * without calling any host.
 */
async function graphqlUrl(): Promise<string> {
  if (config.graphqlUrl) return config.graphqlUrl;
  asking ??= getRuntimeConfig()
    .then((rc) => {
      if (rc?.graphqlUrl) applyEndpointOverrides({ graphqlUrl: rc.graphqlUrl });
    })
    .finally(() => {
      asking = null;
    });
  await asking;
  if (!config.graphqlUrl) throw new IndexerError("indexer not available");
  return config.graphqlUrl;
}

export async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetchJson<{ data?: T; errors?: { message: string }[] }>(await graphqlUrl(), {
    method: "POST",
    body: JSON.stringify({ query, variables: { chainId: config.chainId, ...variables } }),
    timeoutMs: 15_000,
  });
  if (r.status >= 500) throw new NetworkError(`indexer ${r.status}`);
  if (r.body?.errors?.length) throw new IndexerError(r.body.errors.map((e) => e.message).join("; "));
  if (!r.body?.data) throw new IndexerError(`indexer ${r.status}`);
  return r.body.data;
}

// ─────────────── types (strings for BigInt fields) ───────────────

export type PotRow = {
  id: string;
  meta: string;
  inviteKeyWrap: string;
  inviteSigner?: string | null;
  creator_id?: string | null;
  status: "Active" | "Settled";
  startTime: string;
  endTime: string;
  reviewWindow?: string;
  settledAt?: number | null;
  balance: string;
  frozenUntil: string;
  ackEpoch?: string;
  acksInEpoch?: number;
  rulesVersion?: string;
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
  totalContributed?: string;
  totalSpent?: string;
  totalPaidOut?: string;
  spendCount?: number;
  memberCount: number;
  activeMemberCount: number;
  countries: string[];
  isDemo?: boolean;
  lastActivityAt?: number | null;
  createdAt?: number | null;
};

export type MemberRow = {
  address: string;
  country?: string | null;
  status: "Active" | "Exited";
  safetyNet: string;
  contributed: string;
  personalPaid: string;
  share: string;
  withdrawn: string;
  net: string;
  debt: string;
  lastAckEpoch?: string | null;
  joinedAt?: number | null;
  memberIndex?: string | null;
};

export type BalanceRow = { account_id: string; net: string; owes: string; owedByMembers: string; owedByPot: string; settledUp: boolean };
export type CategoryRow = { category: number; name: string; budget: string; spent: string; refunded: string; remaining?: string | null; spendCount: number };
export type EdgeRow = { kind: "MemberToMember" | "PotToMember" | "MemberToPot"; from_id?: string | null; to_id?: string | null; amount: string; fromCountry?: string | null; toCountry?: string | null };
export type SpendRow = {
  id: string;
  spendId: string;
  kind: "PAY" | "LINK" | "PERSONAL";
  status?: "Pending" | "Approved" | "Executed" | "Cancelled";
  proposer_id: string;
  payee: string;
  amount: string;
  category: number;
  memo: string;
  receiptHash: string;
  approvals: number;
  approvalsRequired: number;
  rejections?: number;
  expiresAt: string;
  proposedAt?: number;
  executedAt?: number | null;
  cancelReason?: number | null;
  claimId?: string | null;
  splitMembers?: string[];
  splitWeights?: string[];
  hasOpenDispute?: boolean;
  txHash?: string;
  votes?: { account_id: string; approve: boolean; timestamp?: number }[];
};
export type DisputeRow = {
  id: string;
  disputeId: string;
  spend_id: string;
  openedBy_id: string;
  reason: number;
  memo?: string;
  status?: "Open" | "Resolved";
  outcome?: string;
  votesSpenderCovers: number;
  votesKeep: number;
  openedAt: number;
  resolvedAt?: number | null;
  previousMembers?: string[];
  previousShares?: string[];
  resolvedMembers?: string[];
  resolvedShares?: string[];
  votes?: { account_id: string; spenderCovers: boolean }[];
};
export type RuleChangeRow = {
  id: string;
  ruleChangeId: string;
  status: "Proposed" | "Approved" | "Applied";
  proposer_id?: string;
  approvals: number;
  rejections?: number;
  eta?: string | null;
  expiresAt: string;
  proposedAt?: number;
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
  votes?: { account_id: string; approve: boolean }[];
};
export type KeyWrapRow = { member_id: string; by_id: string; wrap: string; timestamp: number; pot_id?: string };
export type ActivityRow = { id: string; kind: string; account_id?: string | null; pot_id?: string | null; counterparty?: string | null; amount?: string | null; ref?: string | null; timestamp: number; txHash: string };
export type FreezeRow = { by_id: string; until: string; timestamp: number; liftedAt?: number | null };
export type AckRow = { account_id: string; ackEpoch: string; timestamp: number };
export type PayoutRow = {
  account_id: string;
  amount: string;
  afterSettlement: boolean;
  /** "Collect" when paid by Pot.collect(member) after settlement */
  source?: "Automatic" | "Collect";
  /** who submitted the collect (anyone may); null unless source = "Collect" */
  collectedBy_id?: string | null;
  timestamp: number;
  txHash: string;
};
export type SettlementRow = {
  by_id: string;
  paidOut: string;
  pulledIn: string;
  /** > 0 when a payout was skipped (e.g. AUSD refused it); members can collect it later */
  unpaidClaims: string;
  /** FxReference round fresh at settlement (display label only); "0" = none */
  fxRoundId?: string;
  timestamp: number;
  txHash: string;
};

export type PlanDetail = PotRow & {
  members: MemberRow[];
  balances: BalanceRow[];
  categorySpends: CategoryRow[];
  settlementEdges: EdgeRow[];
  spends: SpendRow[];
  disputes: DisputeRow[];
  ruleChanges: RuleChangeRow[];
  keyWraps: KeyWrapRow[];
  freezes: FreezeRow[];
  acks: AckRow[];
  payouts: PayoutRow[];
  pulls: { account_id: string; amount: string }[];
  settlements: SettlementRow[];
  recent: SpendRow[];
};

// ─────────────── queries ───────────────

const POT_FIELDS = `id meta inviteKeyWrap inviteSigner creator_id status startTime endTime reviewWindow settledAt balance frozenUntil ackEpoch acksInEpoch
  rulesVersion instantMax oneApprovalMax highTier memberDailyCap memberTotalCap payeePolicy minContribution proposalTtl ruleTimelock categoryBudgets
  totalContributed totalSpent totalPaidOut spendCount memberCount activeMemberCount countries isDemo lastActivityAt createdAt`;

const SPEND_FIELDS = `id spendId kind status proposer_id payee amount category memo receiptHash approvals approvalsRequired rejections expiresAt proposedAt executedAt cancelReason claimId splitMembers splitWeights hasOpenDispute txHash votes { account_id approve timestamp }`;

export const Q_MY_PLANS = `query MyPlans($account: String!, $chainId: Int!) {
  Member(where: { account_id: { _eq: $account }, chainId: { _eq: $chainId } }, order_by: { joinedAt: desc }) {
    id status net contributed share debt safetyNet
    pot { ${POT_FIELDS}
      spends(where: { status: { _in: ["Pending", "Approved"] } }) { id spendId proposer_id amount approvals approvalsRequired votes { account_id approve } }
      recent: spends(where: { status: { _eq: "Executed" } }, order_by: { executedAt: desc }, limit: 1) { proposer_id amount executedAt kind }
      members(order_by: { memberIndex: asc }) { address country status }
      keyWraps(order_by: { timestamp: asc }) { member_id by_id wrap timestamp }
    }
  }
  Account(where: { id: { _eq: $account }, chainId: { _eq: $chainId } }) {
    id key country isUser
    keyWraps(order_by: { timestamp: desc }) { pot_id by_id wrap timestamp }
  }
}`;

export const Q_PLAN_DETAIL = `query PlanDetail($pot: String!, $chainId: Int!) {
  Pot(where: { id: { _eq: $pot }, chainId: { _eq: $chainId } }) {
    ${POT_FIELDS}
    members(order_by: { memberIndex: asc }) { address country status safetyNet contributed personalPaid share withdrawn net debt lastAckEpoch joinedAt memberIndex }
    balances(order_by: { net: desc }) { account_id net owes owedByMembers owedByPot settledUp }
    categorySpends(order_by: { category: asc }) { category name budget spent refunded remaining spendCount }
    settlementEdges(order_by: { amount: desc }) { kind from_id to_id amount fromCountry toCountry }
    spends(where: { status: { _in: ["Pending", "Approved"] } }, order_by: { proposedAt: desc }) { ${SPEND_FIELDS} }
    recent: spends(order_by: { proposedAt: desc }, limit: 40) { ${SPEND_FIELDS} }
    disputes(order_by: { openedAt: desc }) { id disputeId spend_id openedBy_id reason memo status outcome votesSpenderCovers votesKeep openedAt resolvedAt votes { account_id spenderCovers } }
    ruleChanges(order_by: { proposedAt: desc }, limit: 5) { id ruleChangeId status proposer_id approvals rejections eta expiresAt proposedAt instantMax oneApprovalMax highTier memberDailyCap memberTotalCap payeePolicy minContribution proposalTtl ruleTimelock categoryBudgets votes { account_id approve } }
    keyWraps(order_by: { timestamp: asc }) { member_id by_id wrap timestamp }
    freezes(order_by: { timestamp: desc }, limit: 3) { by_id until timestamp liftedAt }
    acks(order_by: { timestamp: desc }) { account_id ackEpoch timestamp }
    payouts(order_by: { timestamp: desc }) { account_id amount afterSettlement source collectedBy_id timestamp txHash }
    pulls { account_id amount }
    settlements { by_id paidOut pulledIn unpaidClaims fxRoundId timestamp txHash }
  }
}`;

export const Q_POT_PREVIEW = `query PotPreview($pot: String!, $chainId: Int!) {
  Pot(where: { id: { _eq: $pot }, chainId: { _eq: $chainId } }) {
    ${POT_FIELDS}
    members(order_by: { memberIndex: asc }) { address country status }
    keyWraps(order_by: { timestamp: asc }) { member_id by_id wrap timestamp }
  }
}`;

export const Q_PLAN_ACTIVITY = `query PlanActivity($pot: String!, $chainId: Int!, $limit: Int = 50, $offset: Int = 0) {
  Activity(where: { pot_id: { _eq: $pot }, chainId: { _eq: $chainId } }, order_by: [{ timestamp: desc }, { id: desc }], limit: $limit, offset: $offset) {
    id kind account_id counterparty amount ref timestamp txHash
  }
}`;

const SEND_FIELDS = `id from_id to_id amount fromCountry toCountry fromCurrency toCurrency fxRateE8 fxTimestamp fxRoundId refRateE8 fxDiffBps memoHash timestamp txHash`;

export const Q_ACCOUNT_ACTIVITY = `query AccountActivity($account: String!, $chainId: Int!, $limit: Int = 60) {
  Activity(where: { account_id: { _eq: $account }, chainId: { _eq: $chainId } }, order_by: [{ timestamp: desc }, { id: desc }], limit: $limit) {
    id kind pot_id counterparty amount ref timestamp txHash
  }
  sendsIn: Send(where: { to_id: { _eq: $account }, chainId: { _eq: $chainId } }, order_by: { timestamp: desc }, limit: 30) {
    ${SEND_FIELDS}
  }
  sendsOut: Send(where: { from_id: { _eq: $account }, chainId: { _eq: $chainId } }, order_by: { timestamp: desc }, limit: 30) {
    ${SEND_FIELDS}
  }
  claimsIn: Claim(where: { recipient_id: { _eq: $account }, chainId: { _eq: $chainId } }, order_by: { claimedAt: desc }, limit: 20) {
    id claimId source amount fromCountry toCountry status createdAt claimedAt txHash
  }
  claimsOut: Claim(where: { sourceAccount_id: { _eq: $account }, chainId: { _eq: $chainId } }, order_by: { createdAt: desc }, limit: 20) {
    id claimId claimSigner amount expiry status createdAt claimedAt refundedAt recipient_id txHash
  }
  payouts: Payout(where: { account_id: { _eq: $account }, chainId: { _eq: $chainId } }, order_by: { timestamp: desc }, limit: 20) {
    pot_id amount afterSettlement timestamp txHash
  }
}`;

export type SendRow = {
  id: string;
  from_id: string;
  to_id: string;
  amount: string;
  fromCountry?: string | null;
  toCountry?: string | null;
  fromCurrency?: string | null;
  toCurrency?: string | null;
  /** applied rate (signed by the sender): toCurrency per 1 fromCurrency, 8 decimals */
  fxRateE8: string;
  fxTimestamp: string;
  /** FxReference round the quote came from; "0" = none */
  fxRoundId?: string;
  /** the round's toCurrency per 1 fromCurrency, 8 decimals, floored; "0" without a round */
  refRateE8?: string;
  /** (fxRateE8 - refRateE8) * 10000 / refRateE8, truncated toward zero, signed; "0" without a round */
  fxDiffBps?: string;
  memoHash: string;
  timestamp: number;
  txHash: string;
};

/** One FxReference round (indexer entity FxRound, id = roundId). Rates: USD per 1 unit, 8 decimals; "0" = absent. */
export type FxRoundRow = {
  id: string;
  fxReference: string;
  roundId: string;
  /** CRE cron scheduled time (unix seconds, BigInt as string); staleness is measured from this */
  scheduledTime: string;
  writtenAt: number;
  /** yyyymmdd */
  rateDate: number;
  sourceMask: number;
  rateGBP: string;
  rateEUR: string;
  rateINR: string;
  rateNGN: string;
  rateJPY: string;
  rateCHF: string;
  rateAED: string;
  rateSGD: string;
  blockNumber: number;
  txHash: string;
};

const FX_ROUND_FIELDS = `id fxReference roundId scheduledTime writtenAt rateDate sourceMask rateGBP rateEUR rateINR rateNGN rateJPY rateCHF rateAED rateSGD blockNumber txHash`;

export const Q_LATEST_FX_ROUND = `query LatestFxRound($chainId: Int!) {
  FxRound(where: { chainId: { _eq: $chainId } }, order_by: { roundId: desc }, limit: 1) { ${FX_ROUND_FIELDS} }
}`;

export const Q_FX_ROUND = `query FxRoundById($roundId: numeric!, $chainId: Int!) {
  FxRound(where: { roundId: { _eq: $roundId }, chainId: { _eq: $chainId } }, limit: 1) { ${FX_ROUND_FIELDS} }
}`;

export const FX_ROUND_CURRENCIES = ["GBP", "EUR", "INR", "NGN", "JPY", "CHF", "AED", "SGD"] as const;

/** USD per 1 unit (8 decimals) by ISO code from an FxRound row; currencies absent from the round are left out. */
export function fxRoundRates(r: FxRoundRow): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const c of FX_ROUND_CURRENCIES) {
    const v = BigInt(r[`rate${c}`] ?? "0");
    if (v > 0n) out[c] = v;
  }
  return out;
}
export type ClaimRow = { id: string; claimId: string; source?: string; claimSigner?: string; amount: string; expiry?: string; fromCountry?: string | null; toCountry?: string | null; status: "Open" | "Claimed" | "Refunded"; createdAt: number; claimedAt?: number | null; refundedAt?: number | null; recipient_id?: string | null; sourceAccount_id?: string | null; sourcePot_id?: string | null; spend_id?: string | null; txHash: string };

export const Q_SPEND_DETAIL = `query SpendDetail($spend: String!, $chainId: Int!) {
  Spend(where: { id: { _eq: $spend }, chainId: { _eq: $chainId } }) {
    ${SPEND_FIELDS} categoryName refunded lastDisputeOutcome
    shares(order_by: { position: asc }) { account_id originalAmount refunded amount }
    disputes { id disputeId status outcome reason memo openedBy_id openedAt resolvedAt votesSpenderCovers votesKeep previousMembers previousShares resolvedMembers resolvedShares votes { account_id spenderCovers } }
    claims { id claimId status amount expiry toCountry recipient_id claimedAt }
  }
}`;

export const Q_CLAIM_BY_SIGNER = `query ClaimBySigner($signer: String!, $chainId: Int!) {
  Claim(where: { claimSigner: { _eq: $signer }, chainId: { _eq: $chainId } }, order_by: { createdAt: desc }, limit: 1) {
    id claimId source sourceAccount_id sourcePot_id spend_id claimSigner amount expiry fromCountry toCountry status createdAt claimedAt refundedAt recipient_id txHash
  }
}`;

export const Q_ACCOUNT_KEY = `query AccountKey($account: String!, $chainId: Int!) {
  Account(where: { id: { _eq: $account }, chainId: { _eq: $chainId } }) { id key country }
}`;

export const Q_ACCOUNT_KEYS = `query AccountKeys($accounts: [String!]!, $chainId: Int!) {
  Account(where: { id: { _in: $accounts }, chainId: { _eq: $chainId } }) { id key country }
}`;

// ─────────────── fetchers ───────────────

const lc = (a: string) => a.toLowerCase();

export type MyPlansResult = {
  Member: (Pick<MemberRow, "status" | "net" | "contributed" | "share" | "debt" | "safetyNet"> & {
    id: string;
    pot: PotRow & {
      spends: Pick<SpendRow, "id" | "spendId" | "proposer_id" | "amount" | "approvals" | "approvalsRequired" | "votes">[];
      recent: Pick<SpendRow, "proposer_id" | "amount" | "executedAt" | "kind">[];
      members: Pick<MemberRow, "address" | "country" | "status">[];
      keyWraps: KeyWrapRow[];
    };
  })[];
  Account: { id: string; key?: string | null; country?: string | null; isUser: boolean; keyWraps: KeyWrapRow[] }[];
};

export const fetchMyPlans = (account: string) => gql<MyPlansResult>(Q_MY_PLANS, { account: lc(account) });
export const fetchPlanDetail = async (pot: string) => (await gql<{ Pot: PlanDetail[] }>(Q_PLAN_DETAIL, { pot: lc(pot) })).Pot[0] ?? null;
export const fetchPotPreview = async (pot: string) =>
  (await gql<{ Pot: (PotRow & { members: Pick<MemberRow, "address" | "country" | "status">[]; keyWraps: KeyWrapRow[] })[] }>(Q_POT_PREVIEW, { pot: lc(pot) })).Pot[0] ?? null;
export const fetchPlanActivity = (pot: string, limit = 50) => gql<{ Activity: ActivityRow[] }>(Q_PLAN_ACTIVITY, { pot: lc(pot), limit });
export const fetchAccountActivity = (account: string) =>
  gql<{ Activity: ActivityRow[]; sendsIn: SendRow[]; sendsOut: SendRow[]; claimsIn: ClaimRow[]; claimsOut: ClaimRow[]; payouts: (PayoutRow & { pot_id: string })[] }>(Q_ACCOUNT_ACTIVITY, {
    account: lc(account),
  });
export const fetchSpendDetail = async (spendEntityId: string) =>
  (
    await gql<{
      Spend: (SpendRow & {
        categoryName: string;
        refunded: string;
        lastDisputeOutcome: string;
        shares: { account_id: string; originalAmount: string; refunded: string; amount: string }[];
        disputes: DisputeRow[];
        claims: ClaimRow[];
      })[];
    }>(Q_SPEND_DETAIL, { spend: lc(spendEntityId) })
  ).Spend[0] ?? null;
export const fetchClaimBySigner = async (signer: string) => (await gql<{ Claim: ClaimRow[] }>(Q_CLAIM_BY_SIGNER, { signer: lc(signer) })).Claim[0] ?? null;
export const fetchLatestFxRound = async () => (await gql<{ FxRound: FxRoundRow[] }>(Q_LATEST_FX_ROUND, {})).FxRound[0] ?? null;
export const fetchFxRound = async (roundId: bigint | string) => (await gql<{ FxRound: FxRoundRow[] }>(Q_FX_ROUND, { roundId: String(roundId) })).FxRound[0] ?? null;
export const fetchAccountKeys = async (accounts: string[]) =>
  (await gql<{ Account: { id: string; key?: string | null; country?: string | null }[] }>(Q_ACCOUNT_KEYS, { accounts: accounts.map(lc) })).Account;
