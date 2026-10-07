import { readFileSync } from "node:fs";
import { BaseError, decodeErrorResult, type Abi, type Hex } from "viem";
import { commonErrorsAbi, potAbi } from "./abi.js";

/** Plain-English messages for SpendBlocked(uint8 reason), from docs/protocol.md "Spending rules". */
export const SPEND_BLOCKED_REASONS: Record<number, { code: string; message: string }> = {
  1: { code: "NOT_ACTIVE_MEMBER", message: "You're not an active member of this plan." },
  2: { code: "PLAN_NOT_OPEN", message: "This plan isn't open for spending: it hasn't started, has ended, or is settled." },
  3: { code: "FROZEN", message: "Spending is paused: a member pressed pause on this plan." },
  4: { code: "MIN_CONTRIBUTION_NOT_MET", message: "Spending opens once every member has added the minimum contribution." },
  5: { code: "PAYEE_NOT_ALLOWED", message: "The plan's rules don't allow paying this person or business." },
  6: { code: "OVER_CATEGORY_BUDGET", message: "This would go over the plan's budget for this category." },
  7: { code: "OVER_DAILY_CAP", message: "This would go over your daily spending limit for this plan." },
  8: { code: "OVER_TOTAL_CAP", message: "This would go over your total spending limit for this plan." },
  9: { code: "INSUFFICIENT_POT_BALANCE", message: "There isn't enough money in the pot for this spend." },
  10: { code: "INVALID_SPLIT", message: "The split isn't valid: everyone in it must be an active member, with no duplicates and weights above zero." },
  11: { code: "INVALID_AMOUNT_OR_CATEGORY", message: "The amount must be above zero and the category must be one of the eight categories." },
};

export const SPEND_CANCEL_REASONS: Record<number, string> = { 0: "withdrawn by proposer", 1: "rejected", 2: "expired" };

export const CATEGORIES = [
  "Stay",
  "Travel",
  "Getting around",
  "Food & drink",
  "Tickets & activities",
  "Groceries",
  "Shopping",
  "Other",
] as const;

/** Friendly messages for error names we expect from the contracts; matched by exact name, then by pattern. */
const NAMED: Record<string, string> = {
  // Pot / factory / registry / escrow / send (contracts/src)
  AlreadyAcked: "You've already confirmed this plan's summary.",
  AlreadyInitialized: "This plan is already set up.",
  AlreadyMember: "You're already in this plan (or left it before).",
  AlreadyVoted: "You've already voted on this.",
  CannotSettle: "The plan can't be settled yet: wait for everyone to confirm, or for the review window to end, and for open spends and disputes to close.",
  ClaimExpired: "This claim link has expired.",
  DataTooLong: "A note or attachment is too long.",
  DebtNotDue: "There's no debt to pay on this plan.",
  DisputeAlreadyOpen: "There's already an open dispute on this spend.",
  FreezeCooldown: "You can pause this plan at most once every 24 hours.",
  HasOpenItems: "You can't leave while you have an open spend or dispute.",
  InvalidAmount: "That amount isn't valid.",
  InvalidDisputeReason: "That dispute reason isn't valid.",
  InvalidExpiry: "That expiry time isn't valid.",
  InvalidInvite: "This invite link is no longer valid. Ask the group for a new one.",
  InvalidOutcome: "That dispute outcome isn't valid.",
  InvalidRefund: "That refund isn't valid.",
  InvalidRules: "Those rules aren't valid.",
  InvalidSchedule: "The plan's dates aren't valid: the end must be after the start and within 365 days.",
  InvalidSignature: "A signature didn't check out. Please try again.",
  UsedOrCanceledAuthorization: "This payment was already sent or cancelled. Check your balance before trying again.",
  ExpiredAuthorization: "This payment request has expired. Please try again.",
  InvalidSplit: "The split isn't valid: everyone in it must be an active member, with no duplicates and weights above zero.",
  InvalidStatus: "That proposal or dispute can't take this action in its current state.",
  NonceAlreadyUsed: "This request was already used. Please try again.",
  NonceMismatch: "The signed transfer doesn't match the request.",
  NotActiveMember: "You're not an active member of this plan.",
  NotEligibleVoter: "You can't vote on this dispute.",
  NotExpired: "This claim link hasn't expired yet.",
  NotFrozen: "This plan isn't paused.",
  NothingToDispute: "There's nothing to dispute on that spend.",
  NotInSplit: "Only members included in the split can dispute this spend.",
  NotMember: "You're not a member of this plan.",
  NotOpen: "This claim link has already been used or refunded.",
  NotProposer: "Only the person who proposed this spend can do that.",
  PermitFailed: "The settle-up allowance couldn't be set.",
  PotFull: "This plan is full.",
  PotSettled: "This plan is already settled.",
  ProposalExpired: "This proposal has expired.",
  ProposalNotExpired: "This proposal hasn't expired yet.",
  SafetyNetMismatch: "The settle-up allowance doesn't match the plan request.",
  SignatureExpired: "This request has expired. Please try again.",
  StaleRegistration: "A newer key registration already exists.",
  TooEarly: "It's too early for that.",
  TooManyEntries: "Too many entries.",
  VotingClosed: "Voting on this has closed.",
  ZeroAddress: "An address is missing.",
  ZeroAmount: "The amount must be above zero.",
  ZeroKey: "The key is missing.",
  // Pot.collect (after settlement)
  NotSettled: "This plan isn't settled yet, so there's nothing to collect. Settle up first.",
  NothingToCollect: "There's nothing to collect: this plan doesn't owe this member anything right now.",
  PayoutRefused: "AUSD refused the payout (for example, the account is frozen). The claim is kept: try again later.",
  // PlansSend FX reference
  FxRoundUnknown: "That reference exchange rate isn't on chain. Refresh the quote and try again.",
  FxRoundStale: "The reference exchange rate is more than 6 hours old. Refresh the quote and try again.",
  FxPairUnavailable: "The reference exchange rate doesn't cover these currencies. Refresh the quote, or send without a reference rate.",
  // FxReference (written by the Chainlink CRE workflow; never relayed for the app)
  InvalidSender: "Only the Chainlink forwarder can write reference rates.",
  InvalidTransmitter: "Only the configured transmitter can write reference rates in simulation mode.",
  InvalidMetadata: "The rate report's metadata isn't valid.",
  InvalidWorkflowId: "The rate report came from an unexpected workflow.",
  InvalidWorkflowOwner: "The rate report came from an unexpected workflow owner.",
  WrongChain: "The rate report is for a different chain.",
  StaleReport: "That rate report is older than the latest round.",
  FutureReport: "That rate report is scheduled in the future.",
  InvalidRateDate: "The rate report's date isn't valid.",
  InvalidLength: "The rate report's lists don't match in length.",
  CurrencyMismatch: "The rate report's currencies aren't in the expected order.",
  MissingSources: "A reference rate needs at least two agreeing sources.",
  RateMoveTooLarge: "A reference rate moved more than the allowed amount since the last round.",
  EmptyReport: "The rate report has no rates.",
  InvalidConfig: "That configuration isn't valid.",
  // tokens
  TransferFailed: "A token transfer failed.",
  TransferFromFailed: "Couldn't collect the money: the balance or allowance is too low.",
  InsufficientBalance: "Not enough AUSD in the account.",
  InsufficientGas: "The transaction ran with too little gas to pay everyone. Please try again.",
  ERC20InsufficientBalance: "Not enough AUSD in the account.",
  InsufficientAllowance: "The allowance is too low.",
  ERC20InsufficientAllowance: "The allowance is too low.",
};
const PATTERNS: Array<[RegExp, string]> = [
  [/signature|signer/i, "A signature didn't check out. Please try again."],
  [/deadline|expired/i, "This request has expired. Please try again."],
  [/nonce/i, "This request was already used. Please try again."],
  [/invite/i, "This invite link is no longer valid. Ask the group for a new one."],
  [/already.*member|alreadyjoined/i, "You're already in this plan (or left it before)."],
  [/notmember|notactive/i, "You're not an active member of this plan."],
  [/settled/i, "This plan is already settled."],
  [/full|maxmembers|toomany/i, "This plan is full."],
  [/frozen/i, "Spending is paused on this plan."],
  [/cannotsettle|notsettleable|settlenotallowed/i, "The plan can't be settled yet: wait for everyone to confirm, or for the review window to end."],
  [/dispute/i, "That dispute action isn't possible right now."],
  [/proposal|notpending|notapproved/i, "That proposal can't take this action in its current state."],
  [/voted/i, "You've already voted on this."],
  [/timelock|eta/i, "This rule change isn't ready yet."],
  [/claim/i, "This claim link can't be used (already claimed, refunded or expired)."],
  [/split/i, "The split isn't valid."],
  [/time|duration|start|end/i, "The plan's dates aren't valid."],
];

function loadGeneratedErrors(): Abi {
  for (const rel of ["./abi.errors.generated.json", "../src/abi.errors.generated.json"]) {
    try {
      const raw = readFileSync(new URL(rel, import.meta.url), "utf8");
      const items = JSON.parse(raw) as Abi;
      if (Array.isArray(items)) return items.filter((x) => x.type === "error");
    } catch {
      /* not generated yet */
    }
  }
  return [];
}

function dedupe(abi: Abi): Abi {
  const seen = new Set<string>();
  return abi.filter((x) => {
    if (x.type !== "error") return false;
    const key = `${x.name}(${x.inputs.map((i) => i.type).join(",")})`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

let errorsAbi: Abi = dedupe([...potAbi.filter((x) => x.type === "error"), ...commonErrorsAbi, ...loadGeneratedErrors()]);

/** Extend the decoder at runtime, e.g. with ABIs loaded from contracts/out in tests. */
export function registerErrors(abi: Abi) {
  errorsAbi = dedupe([...errorsAbi, ...abi.filter((x) => x.type === "error")]);
}

export interface DecodedRevert {
  error: string; // error name, "Error" for require strings, "Panic", or "Unknown"
  code: string; // machine code for the app
  message: string; // plain English
  reason?: number; // SpendBlocked reason
  args?: unknown[];
  data?: Hex;
}

function humanize(name: string) {
  const s = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

function toCode(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

export function friendlyForName(name: string): string {
  if (NAMED[name]) return NAMED[name];
  for (const [re, msg] of PATTERNS) if (re.test(name)) return msg;
  return humanize(name);
}

export function decodeRevert(data: Hex | undefined): DecodedRevert {
  if (!data || data === "0x") {
    return { error: "Unknown", code: "REVERTED", message: "The transaction would fail (no reason given)." };
  }
  try {
    const d = decodeErrorResult({ abi: errorsAbi, data });
    const args = (d.args ?? []) as unknown[];
    if (d.errorName === "SpendBlocked") {
      const reason = Number(args[0]);
      const r = SPEND_BLOCKED_REASONS[reason];
      return {
        error: "SpendBlocked",
        code: r?.code ?? "SPEND_BLOCKED",
        message: r?.message ?? `This spend is blocked by the plan's rules (reason ${reason}).`,
        reason,
        args,
        data,
      };
    }
    if (d.errorName === "Error") {
      const msg = String(args[0] ?? "");
      return { error: "Error", code: "REVERTED", message: msg || "The transaction would fail.", args, data };
    }
    if (d.errorName === "Panic") {
      return { error: "Panic", code: "PANIC", message: `The contract hit an internal error (panic ${String(args[0])}).`, args, data };
    }
    return { error: d.errorName, code: toCode(d.errorName), message: friendlyForName(d.errorName), args, data };
  } catch {
    return { error: "Unknown", code: "REVERTED", message: `The transaction would fail (unrecognised error ${data.slice(0, 10)}).`, data };
  }
}

/** Walk a viem/RPC error and pull out revert data, if any. */
export function extractRevertData(err: unknown): Hex | undefined {
  const isHex = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v) && v.length >= 10;
  const visit = (e: unknown, depth: number): Hex | undefined => {
    if (!e || typeof e !== "object" || depth > 8) return undefined;
    const o = e as Record<string, unknown>;
    if (isHex(o.data)) return o.data;
    if (o.data && typeof o.data === "object") {
      const inner = o.data as Record<string, unknown>;
      if (isHex(inner.data)) return inner.data;
    }
    if (o.error) {
      const r = visit(o.error, depth + 1);
      if (r) return r;
    }
    return visit(o.cause, depth + 1);
  };
  if (err instanceof BaseError) {
    let found: Hex | undefined;
    err.walk((e) => {
      const d = (e as { data?: unknown }).data;
      if (isHex(d)) {
        found = d;
        return true;
      }
      if (d && typeof d === "object" && isHex((d as { data?: unknown }).data)) {
        found = (d as { data: Hex }).data;
        return true;
      }
      return false;
    });
    if (found) return found;
  }
  return visit(err, 0);
}

/** Thrown for any request the relayer refuses; rendered as JSON by the HTTP layer. */
export class RelayError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
  toJSON() {
    return { code: this.code, message: this.message, ...(this.details ?? {}) };
  }
}
