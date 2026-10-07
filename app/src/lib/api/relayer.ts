/**
 * Plans relayer client (relayer/README.md). Every write is POST /v1/relay {action, params};
 * the relayer validates, simulates and submits, and returns the receipt with measured latency.
 * Errors come back as {error: {code, message, reason?}}; `friendlyError` turns them into the
 * app's own plain words (the relayer's messages may use words the app never shows).
 */
import type { Hex } from "viem";
import { config } from "../../config";
import { fetchJson, jsonStringify, NetworkError } from "./http";

export type RelayEvent = { address?: string; name: string; logIndex?: number; args: Record<string, unknown> };

export type RelayResult = {
  action: string;
  txHash: Hex;
  blockNumber: string;
  status: "success" | "reverted";
  gasUsed?: string;
  latencyMs?: number;
  totalMs?: number;
  events: RelayEvent[];
  /** measured by the app: request sent → response with receipt */
  clientMs: number;
};

export class RelayError extends Error {
  constructor(
    public status: number,
    public code: string,
    public serverMessage: string,
    public reason?: number,
    public retryAfter?: number,
  ) {
    super(code);
  }
}

export async function relay(action: string, params: Record<string, unknown>): Promise<RelayResult> {
  const t0 = Date.now();
  const r = await fetchJson<RelayResult & { error?: { code: string; message: string; reason?: number } }>(`${config.relayerUrl}/v1/relay`, {
    method: "POST",
    body: jsonStringify({ action, params }),
    timeoutMs: 45_000,
  });
  if (r.status >= 400 || r.body?.error) {
    const e = r.body?.error ?? { code: `HTTP_${r.status}`, message: "" };
    const ra = Number(r.headers.get("retry-after") ?? "");
    throw new RelayError(r.status, e.code, e.message, e.reason, Number.isFinite(ra) ? ra : undefined);
  }
  const res = { ...r.body, clientMs: Date.now() - t0 };
  if (res.status === "reverted") throw new RelayError(200, "REVERTED_ONCHAIN", "The request was included but failed because things changed.", undefined);
  return res;
}

/** Settled time shown on receipts: the relayer's submit→receipt latency when given, else ours. */
export function settledMs(r: Pick<RelayResult, "latencyMs" | "clientMs">): number {
  return r.latencyMs ?? r.clientMs;
}

export function findEvent(r: RelayResult, name: string): RelayEvent | undefined {
  return r.events?.find((e) => e.name === name);
}

// ─────────────── other endpoints ───────────────

export type FxQuote = {
  from: string;
  to: string;
  rate: string;
  rateE8: string;
  timestamp: number;
  date: string;
  source: string;
  signer: Hex;
  message: string;
  signature: Hex;
};

export async function getFx(from: string, to: string): Promise<FxQuote> {
  const r = await fetchJson<FxQuote & { error?: { code: string; message: string } }>(`${config.relayerUrl}/v1/fx?from=${from}&to=${to}`, { timeoutMs: 10_000 });
  if (r.status >= 400 || r.body?.error) throw new RelayError(r.status, r.body?.error?.code ?? "FX_FAILED", r.body?.error?.message ?? "");
  return r.body;
}

export async function requestFaucet(address: string): Promise<{ txHash?: Hex; amount?: string }> {
  const r = await fetchJson<{ txHash?: Hex; amount?: string; error?: { code: string; message: string } }>(`${config.relayerUrl}/v1/faucet`, {
    method: "POST",
    body: jsonStringify({ address }),
  });
  if (r.status >= 400 || r.body?.error) throw new RelayError(r.status, r.body?.error?.code ?? "FAUCET_FAILED", r.body?.error?.message ?? "");
  return r.body;
}

export async function registerPush(body: { address: string; expoPushToken: string; deadline: number; signature: Hex }): Promise<void> {
  const r = await fetchJson<{ error?: { code: string; message: string } }>(`${config.relayerUrl}/v1/push/register`, { method: "POST", body: jsonStringify(body) });
  if (r.status >= 400) throw new RelayError(r.status, r.body?.error?.code ?? "PUSH_FAILED", r.body?.error?.message ?? "");
}

export type DemoAccounts = { enabled: boolean; accounts: { name: string; city: string; country: string; address: string }[]; pots: { pot: string; stage: string; createdAt: number }[] };

export async function getDemoAccounts(): Promise<DemoAccounts> {
  const r = await fetchJson<DemoAccounts>(`${config.relayerUrl}/v1/demo/accounts`, { timeoutMs: 10_000 });
  if (r.status >= 400) throw new RelayError(r.status, "DEMO_UNAVAILABLE", "");
  return r.body;
}

export type TrySettleUp = {
  pot: Hex;
  inviteSecret: Hex;
  inviteSigner: Hex;
  creator: Hex;
  startTime: number;
  endTime: number;
  rules: { instantMax: string; oneApprovalMax: string; reviewWindow: number };
  demoMembers: { name: string; city: string; country: string; address: string }[];
  txHash: Hex;
  latencyMs: number;
};

export async function startTrySettleUp(body: { member: string; meta?: Hex; inviteKeyWrap?: Hex; creatorKeyWrap?: Hex; inviteSecret?: Hex; memos?: Hex[] }): Promise<TrySettleUp> {
  const r = await fetchJson<TrySettleUp & { error?: { code: string; message: string } }>(`${config.relayerUrl}/v1/demo/try-settle-up`, {
    method: "POST",
    body: jsonStringify(body),
    timeoutMs: 45_000,
  });
  if (r.status >= 400 || r.body?.error) throw new RelayError(r.status, r.body?.error?.code ?? "DEMO_FAILED", r.body?.error?.message ?? "");
  return r.body;
}

export type DemoRunStatus = { pot: string; stage: string; step: string | null; stepIndex: number; totalSteps: number; endTime?: number; lastError?: string | null };

export async function getTrySettleUp(pot: string): Promise<DemoRunStatus | null> {
  const r = await fetchJson<DemoRunStatus>(`${config.relayerUrl}/v1/demo/try-settle-up/${pot}`, { timeoutMs: 10_000 });
  if (r.status === 404) return null;
  if (r.status >= 400) throw new RelayError(r.status, "DEMO_STATUS_FAILED", "");
  return r.body;
}

export type Health = { chainId?: number; blockNumber?: string | number; contracts?: Record<string, string>; lanes?: { address: string }[]; [k: string]: unknown };

export async function getHealth(): Promise<{ ok: boolean; body: Health | null; ms: number }> {
  const t0 = Date.now();
  try {
    const r = await fetchJson<Health>(`${config.relayerUrl}/v1/health`, { timeoutMs: 8_000 });
    return { ok: r.status === 200, body: r.body, ms: Date.now() - t0 };
  } catch {
    return { ok: false, body: null, ms: Date.now() - t0 };
  }
}

// ─────────────── receipt photo blobs (optional relayer endpoint) ───────────────

/**
 * Receipt photo ciphertext storage: PUT/GET /v1/blobs/<sha256 hex> (being added to the relayer).
 * Reports `false`/`null` when the endpoint is missing; the photo then stays on this phone only and
 * the receiptHash onchain still commits to the ciphertext.
 */
export async function putBlob(hashHex: string, base64: string): Promise<boolean> {
  try {
    const r = await fetchJson(`${config.relayerUrl}/v1/blobs/${hashHex.replace(/^0x/, "")}`, { method: "PUT", body: jsonStringify({ data: base64 }), timeoutMs: 30_000 });
    return r.status >= 200 && r.status < 300;
  } catch {
    return false;
  }
}

export async function getBlob(hashHex: string): Promise<string | null> {
  try {
    const r = await fetchJson<{ data?: string }>(`${config.relayerUrl}/v1/blobs/${hashHex.replace(/^0x/, "")}`, { timeoutMs: 30_000 });
    return r.status === 200 && typeof r.body?.data === "string" ? r.body.data : null;
  } catch {
    return null;
  }
}

/**
 * GET /v1/tx/:hash (being added to the relayer): the relayer's measured submit→receipt latency for
 * a transaction it sent, so the receiving phone can show "Settled in 0.x s" (screen 48).
 * Returns null when unknown (endpoint missing, or not sent by this relayer).
 */
export async function getTxLatency(hash: string): Promise<{ latencyMs: number; [k: string]: unknown } | null> {
  try {
    const r = await fetchJson<{ latencyMs?: number }>(`${config.relayerUrl}/v1/tx/${hash}`, { timeoutMs: 8_000 });
    return r.status === 200 && typeof r.body?.latencyMs === "number" ? (r.body as { latencyMs: number }) : null;
  } catch {
    return null;
  }
}

// ─────────────── friendly errors ───────────────

const CODE_COPY: Record<string, string> = {
  USED_OR_CANCELED_AUTHORIZATION: "This payment already went through or was cancelled. Check your balance before trying again.",
  EXPIRED_AUTHORIZATION: "This payment took too long and expired. Nothing moved. Please try again.",
  NOT_ACTIVE_MEMBER: "You're not an active member of this plan.",
  PLAN_NOT_OPEN: "This plan isn't open for spending right now.",
  FROZEN: "Spending is paused on this plan.",
  MIN_CONTRIBUTION_NOT_MET: "Spending opens once everyone has put in the minimum.",
  PAYEE_NOT_ALLOWED: "The plan's rules don't allow paying them.",
  OVER_CATEGORY_BUDGET: "This would go over the budget for this category.",
  OVER_DAILY_CAP: "This would go over your daily limit for this plan.",
  OVER_TOTAL_CAP: "This would go over your total limit for this plan.",
  INSUFFICIENT_POT_BALANCE: "There isn't enough money in the pot for this.",
  INVALID_SPLIT: "The split isn't valid. Check who's in it.",
  INVALID_AMOUNT_OR_CATEGORY: "Check the amount and category.",
  INVALID_INVITE: "This invite has stopped working. Ask for a new link.",
  ALREADY_MEMBER: "You're already in this plan, or left it before.",
  POT_FULL: "This plan is full.",
  POT_SETTLED: "This plan is already settled.",
  CANNOT_SETTLE: "It can't be settled yet: everyone needs to check the numbers, or the review time has to pass.",
  ALREADY_VOTED: "You've already voted on this.",
  ALREADY_ACKED: "You've already said it looks right.",
  FREEZE_COOLDOWN: "You can pause this plan once every 24 hours.",
  HAS_OPEN_ITEMS: "Wait for your open requests or questions to finish first.",
  NOT_FROZEN: "The plan isn't paused.",
  NOT_IN_SPLIT: "Only people in the split can question this spend.",
  DISPUTE_ALREADY_OPEN: "Someone has already questioned this spend.",
  NOT_ELIGIBLE_VOTER: "You can't vote on this one.",
  VOTING_CLOSED: "Voting has closed.",
  PROPOSAL_EXPIRED: "This request ran out.",
  CLAIM_EXPIRED: "This link ran out. The money went back to the sender.",
  NOT_OPEN: "Someone already claimed this link, or it was cancelled.",
  SIGNATURE_EXPIRED: "That took too long. Try again.",
  EXPIRED: "That took too long. Try again.",
  NONCE_ALREADY_USED: "That request was already used. Try again.",
  INVALID_SIGNATURE: "Your confirmation didn't check out. Try again.",
  TRANSFER_FROM_FAILED: "There isn't enough money in your Plans account.",
  INSUFFICIENT_BALANCE: "There isn't enough money in your Plans account.",
  ERC20_INSUFFICIENT_BALANCE: "There isn't enough money in your Plans account.",
  STALE_REGISTRATION: "Your key is already up to date.",
  TOO_EARLY: "It's too early for that.",
  DEMO_LIMIT: "You've started enough demo settle-ups for today. Try again tomorrow.",
  DEMO_NOT_CONFIGURED: "The demo friends are taking a break. Try again later.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
  TARGET_NOT_ALLOWED: "Plans can't do that.",
  GAS_CAP_EXCEEDED: "That's too big to do in one go.",
  REVERTED_ONCHAIN: "Things changed while we were sending it. Nothing moved; check and try again.",
  FAUCET_LIMIT: "You've had today's test dollars. Come back tomorrow.",
};

const BANNED = /\b(wallet|address|gas|token|chain|transaction|blockchain|crypto|sign(ature|ed|ing)?|ausd|nonce|revert(ed)?|contract|erc\d*|allowance|permit)\b/i;

export function friendlyError(e: unknown): { title: string; message: string; code: string; offline: boolean } {
  if (e instanceof NetworkError) {
    return { title: "You're offline", message: "Check your connection and try again. Nothing moved.", code: "OFFLINE", offline: true };
  }
  if (e instanceof RelayError) {
    if (e.status === 429 && !CODE_COPY[e.code]) return { title: "Slow down a little", message: CODE_COPY.RATE_LIMITED, code: e.code, offline: false };
    if (e.status >= 500) return { title: "Plans is having a moment", message: "Our side didn't respond properly. Nothing moved. Try again in a minute.", code: e.code, offline: false };
    const mapped = CODE_COPY[e.code];
    const server = e.serverMessage && !BANNED.test(e.serverMessage) ? e.serverMessage : undefined;
    return { title: "That didn't go through", message: mapped ?? server ?? "Nothing moved. Check the details and try again.", code: e.code, offline: false };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { title: "Something went wrong", message: BANNED.test(msg) ? "Nothing moved. Try again." : msg || "Nothing moved. Try again.", code: "UNKNOWN", offline: false };
}

export { NetworkError };

/** Runtime endpoints published by the relayer (GET /v1/config), so a new indexer URL needs no app rebuild. */
export async function getRuntimeConfig(): Promise<{ chainId: number; graphqlUrl: string | null } | null> {
  try {
    const r = await fetchJson<{ chainId: number; graphqlUrl: string | null }>(`${config.relayerUrl}/v1/config`, { timeoutMs: 4_000 });
    return r.status === 200 && r.body?.chainId === config.chainId ? r.body : null;
  } catch {
    return null;
  }
}
