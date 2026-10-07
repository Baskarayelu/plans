// Public plan data for /v/<pot> (shared plan) and /s/<pot> (proof of a settle-up), read from the Envio
// HyperIndex GraphQL endpoint (indexer/schema.graphql). Only public, onchain facts travel through here:
// the plan's meta stays ciphertext and is opened in the visitor's browser with the secret in the link.
// Never invents numbers: unset or unreachable endpoint → a "can't load right now" state.

import { getShared, getProof, isFixturePot } from "./plans-fixtures";
import { statsChainId } from "./stats";

export const PLAN_REVALIDATE_SECONDS = 30;

export type LoadState = "ok" | "unconfigured" | "unreachable" | "not-found" | "invalid";
export type Loaded<T> = { state: "ok"; data: T } | { state: Exclude<LoadState, "ok"> };

export type SharedPlan = {
  pot: string;
  meta: string;
  inviteKeyWrap: string;
  inviteSigner: string | null;
  /** KeyWrapped entries addressed to the current invite signer (a replacement link) */
  signerWraps: { member: string; wrap: string }[];
  status: "Active" | "Settled";
  startTime: number;
  endTime: number;
  reviewWindow: number;
  settledAt: number | null;
  balance: string;
  memberCount: number;
  activeMemberCount: number;
  memberCountries: (string | null)[];
  isDemo: boolean;
  rules: {
    instantMax: string;
    oneApprovalMax: string;
    highTier: string;
    memberDailyCap: string;
    memberTotalCap: string;
    payeePolicy: string;
    minContribution: string;
    proposalTtl: string;
    ruleTimelock: string;
    categoryBudgets: string[];
  };
};

export type ProofPlan = {
  pot: string;
  status: "Active" | "Settled";
  startTime: number;
  endTime: number;
  reviewWindow: number;
  settledAt: number | null;
  memberCount: number;
  isDemo: boolean;
  totalContributed: string;
  totalSpent: string;
  totalPaidOut: string;
  spendCount: number;
  members: { address: string; country: string | null }[];
  payouts: { account: string; amount: string }[];
  settlements: { paidOut: string; pulledIn: string; timestamp: number; txHash: string }[];
};

const POT_RE = /^0x[0-9a-fA-F]{40}$/;
export const isPotAddress = (s: string) => POT_RE.test(s);

const SHARED_QUERY = /* GraphQL */ `
  query SharedPlan($pot: String!, $chainId: Int!) {
    Pot(where: { id: { _eq: $pot }, chainId: { _eq: $chainId } }) {
      id meta inviteKeyWrap inviteSigner status startTime endTime reviewWindow settledAt balance
      memberCount activeMemberCount isDemo registered
      instantMax oneApprovalMax highTier memberDailyCap memberTotalCap payeePolicy minContribution proposalTtl ruleTimelock categoryBudgets
      members(order_by: { memberIndex: asc }) { country status }
      keyWraps(order_by: { timestamp: asc }) { member_id wrap }
    }
  }
`;

const PROOF_QUERY = /* GraphQL */ `
  query ProofPlan($pot: String!, $chainId: Int!) {
    Pot(where: { id: { _eq: $pot }, chainId: { _eq: $chainId } }) {
      id status startTime endTime reviewWindow settledAt memberCount isDemo registered
      totalContributed totalSpent totalPaidOut spendCount
      members(order_by: { memberIndex: asc }) { address country }
      payouts(order_by: { timestamp: asc }) { account_id amount }
      settlements(order_by: { timestamp: asc }) { paidOut pulledIn timestamp txHash }
    }
  }
`;

type Raw = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? "0" : String(v));
const country = (v: unknown) => (typeof v === "string" && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null);

function envioUrl(): string | null {
  return process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL?.trim() || null;
}

async function queryPot(query: string, pot: string): Promise<Loaded<Raw>> {
  const url = envioUrl();
  if (!url) return { state: "unconfigured" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { pot, chainId: statsChainId() } }),
      next: { revalidate: PLAN_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { state: "unreachable" };
    const json = (await res.json()) as { data?: { Pot?: Raw[] }; errors?: unknown };
    if (json.errors || !json.data) return { state: "unreachable" };
    const row = json.data.Pot?.[0];
    if (!row || row.registered === false) return { state: "not-found" };
    return { state: "ok", data: row };
  } catch {
    return { state: "unreachable" };
  }
}

export async function loadSharedPlan(potParam: string): Promise<Loaded<SharedPlan>> {
  if (!isPotAddress(potParam)) return { state: "invalid" };
  const pot = potParam.toLowerCase();
  if (isFixturePot(pot)) return getShared(pot);
  const r = await queryPot(SHARED_QUERY, pot);
  if (r.state !== "ok") return r;
  const p = r.data;
  const signer = typeof p.inviteSigner === "string" ? p.inviteSigner.toLowerCase() : null;
  const members = (p.members as Raw[] | undefined) ?? [];
  const wraps = (p.keyWraps as Raw[] | undefined) ?? [];
  return {
    state: "ok",
    data: {
      pot,
      meta: String(p.meta ?? "0x"),
      inviteKeyWrap: String(p.inviteKeyWrap ?? "0x"),
      inviteSigner: signer,
      // Only wraps sealed for the current invite key; members' own wraps and profiles stay out of the page.
      signerWraps: signer
        ? wraps
            .filter((w) => String(w.member_id).toLowerCase() === signer && String(w.wrap).startsWith("0x01"))
            .map((w) => ({ member: signer, wrap: String(w.wrap) }))
        : [],
      status: p.status === "Settled" ? "Settled" : "Active",
      startTime: num(p.startTime),
      endTime: num(p.endTime),
      reviewWindow: num(p.reviewWindow),
      settledAt: p.settledAt ? num(p.settledAt) : null,
      balance: str(p.balance),
      memberCount: num(p.memberCount),
      activeMemberCount: num(p.activeMemberCount),
      memberCountries: members.filter((m) => m.status !== "Exited").map((m) => country(m.country)),
      isDemo: p.isDemo === true,
      rules: {
        instantMax: str(p.instantMax),
        oneApprovalMax: str(p.oneApprovalMax),
        highTier: String(p.highTier ?? "MAJORITY"),
        memberDailyCap: str(p.memberDailyCap),
        memberTotalCap: str(p.memberTotalCap),
        payeePolicy: String(p.payeePolicy ?? "ANYONE"),
        minContribution: str(p.minContribution),
        proposalTtl: str(p.proposalTtl),
        ruleTimelock: str(p.ruleTimelock),
        categoryBudgets: ((p.categoryBudgets as unknown[]) ?? []).map(str),
      },
    },
  };
}

export async function loadProof(potParam: string): Promise<Loaded<ProofPlan>> {
  if (!isPotAddress(potParam)) return { state: "invalid" };
  const pot = potParam.toLowerCase();
  if (isFixturePot(pot)) return getProof(pot);
  const r = await queryPot(PROOF_QUERY, pot);
  if (r.state !== "ok") return r;
  const p = r.data;
  return {
    state: "ok",
    data: {
      pot,
      status: p.status === "Settled" ? "Settled" : "Active",
      startTime: num(p.startTime),
      endTime: num(p.endTime),
      reviewWindow: num(p.reviewWindow),
      settledAt: p.settledAt ? num(p.settledAt) : null,
      memberCount: num(p.memberCount),
      isDemo: p.isDemo === true,
      totalContributed: str(p.totalContributed),
      totalSpent: str(p.totalSpent),
      totalPaidOut: str(p.totalPaidOut),
      spendCount: num(p.spendCount),
      members: ((p.members as Raw[]) ?? []).map((m) => ({ address: String(m.address).toLowerCase(), country: country(m.country) })),
      payouts: ((p.payouts as Raw[]) ?? []).map((x) => ({ account: String(x.account_id).toLowerCase(), amount: str(x.amount) })),
      settlements: ((p.settlements as Raw[]) ?? []).map((s) => ({
        paidOut: str(s.paidOut),
        pulledIn: str(s.pulledIn),
        timestamp: num(s.timestamp),
        txHash: String(s.txHash),
      })),
    },
  };
}

/** Monad explorer link for a transaction, by NEXT_PUBLIC_CHAIN_ID (10143 testnet, otherwise mainnet). */
export function explorerTx(hash: string): string {
  const base = statsChainId() === 10143 ? "https://testnet.monadvision.com" : "https://monadvision.com";
  return `${base}/tx/${hash}`;
}
