import { HighTier, PayeePolicy, type Rules } from "../chain/eip712";
import { formatUsdShort, ONE_DOLLAR } from "./currency";

/** Category ids 0..7 (docs/protocol.md). */
export const CATEGORIES = [
  { id: 0, name: "Stay", emoji: "🛏️" },
  { id: 1, name: "Travel", emoji: "✈️" },
  { id: 2, name: "Getting around", emoji: "🚋" },
  { id: 3, name: "Food & drink", emoji: "🍽️" },
  { id: 4, name: "Tickets & activities", emoji: "⛵" },
  { id: 5, name: "Groceries", emoji: "🛒" },
  { id: 6, name: "Shopping", emoji: "🛍️" },
  { id: 7, name: "Other", emoji: "✨" },
] as const;

export function categoryOf(id: number) {
  return CATEGORIES[id] ?? CATEGORIES[7];
}

export const UINT64_MAX = (1n << 64n) - 1n;
const $ = (d: number) => BigInt(Math.round(d * 100)) * (ONE_DOLLAR / 100n);
const NO_BUDGETS = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as const;

export type PresetId = "easygoing" | "balanced" | "strict" | "pilot" | "demo";

export type Preset = {
  id: PresetId;
  title: string;
  rules: Rules;
  /** Plan length the preset implies (seconds), when it fixes one. */
  durationSec?: number;
  reviewWindowSec: number;
  tag?: string;
  hidden?: boolean;
};

/** docs/protocol.md "Rules presets (app side)". */
export const PRESETS: Record<PresetId, Preset> = {
  easygoing: {
    id: "easygoing",
    title: "Easygoing",
    reviewWindowSec: 24 * 3600,
    rules: {
      instantMax: $(100),
      oneApprovalMax: UINT64_MAX,
      highTier: HighTier.MAJORITY,
      memberDailyCap: 0n,
      memberTotalCap: 0n,
      payeePolicy: PayeePolicy.ANYONE,
      minContribution: 0n,
      proposalTtl: 24 * 3600,
      ruleTimelock: 3600,
      categoryBudgets: NO_BUDGETS,
    },
  },
  balanced: {
    id: "balanced",
    title: "Balanced",
    tag: "Recommended",
    reviewWindowSec: 24 * 3600,
    rules: {
      instantMax: $(25),
      oneApprovalMax: $(200),
      highTier: HighTier.MAJORITY,
      memberDailyCap: $(150),
      memberTotalCap: 0n,
      payeePolicy: PayeePolicy.ANYONE,
      minContribution: 0n,
      proposalTtl: 24 * 3600,
      ruleTimelock: 3600,
      categoryBudgets: NO_BUDGETS,
    },
  },
  strict: {
    id: "strict",
    title: "Strict",
    reviewWindowSec: 24 * 3600,
    rules: {
      instantMax: 0n,
      oneApprovalMax: $(100),
      highTier: HighTier.ALL,
      memberDailyCap: $(100),
      memberTotalCap: 0n,
      payeePolicy: PayeePolicy.MEMBERS_AND_ALLOWLIST,
      minContribution: 0n,
      proposalTtl: 24 * 3600,
      ruleTimelock: 3600,
      categoryBudgets: NO_BUDGETS,
    },
  },
  pilot: {
    id: "pilot",
    title: "Pilot",
    tag: "Small amounts",
    durationSec: 48 * 3600,
    reviewWindowSec: 0,
    rules: {
      instantMax: $(0.25),
      oneApprovalMax: $(1),
      highTier: HighTier.MAJORITY,
      memberDailyCap: 0n,
      memberTotalCap: 0n,
      payeePolicy: PayeePolicy.ANYONE,
      minContribution: 0n,
      proposalTtl: 24 * 3600,
      ruleTimelock: 3600,
      categoryBudgets: NO_BUDGETS,
    },
  },
  demo: {
    id: "demo",
    title: "Demo",
    hidden: true,
    reviewWindowSec: 0,
    rules: {
      instantMax: $(0.25),
      oneApprovalMax: $(1),
      highTier: HighTier.MAJORITY,
      memberDailyCap: 0n,
      memberTotalCap: 0n,
      payeePolicy: PayeePolicy.ANYONE,
      minContribution: 0n,
      proposalTtl: 3600,
      ruleTimelock: 300,
      categoryBudgets: NO_BUDGETS,
    },
  },
};

export function approvalsRequired(r: Pick<Rules, "instantMax" | "oneApprovalMax" | "highTier">, amount: bigint, active: number): number {
  let n: number;
  if (amount <= r.instantMax) n = 1;
  else if (amount <= r.oneApprovalMax) n = 2;
  else n = r.highTier === HighTier.ALL ? active : Math.floor(active / 2) + 1;
  return Math.max(1, Math.min(n, Math.max(active, 1)));
}

const hours = (s: number) => (s % 3600 === 0 ? `${s / 3600} h` : `${Math.round(s / 60)} min`);

/**
 * The rules in plain words (screens 11, 14, 17/149). With `active` (people in the plan now) the
 * majority is spelled out as a count: "Over $200 needs 3 of 4."
 */
export function rulesInWords(r: Rules, opts: { reviewWindowSec?: number; active?: number } = {}): string[] {
  const out: string[] = [];
  const big = r.oneApprovalMax >= UINT64_MAX;
  const n = opts.active ?? 0;
  const high = r.highTier === HighTier.ALL ? "everyone's OK" : n >= 3 ? `${Math.floor(n / 2) + 1} of ${n}` : "a majority's OK";
  if (r.instantMax === 0n) out.push("Every spend needs at least one friend's OK.");
  else out.push(`Spends up to ${formatUsdShort(r.instantMax)} go through straight away.`);
  if (big) out.push(`Bigger spends need one friend's OK.`);
  else if (r.instantMax === 0n) out.push(`Up to ${formatUsdShort(r.oneApprovalMax)} needs one friend's OK. Over that needs ${high}.`);
  else out.push(`${formatUsdShort(r.instantMax)}–${formatUsdShort(r.oneApprovalMax)} needs one friend's OK. Over ${formatUsdShort(r.oneApprovalMax)} needs ${high}.`);
  if (r.memberDailyCap > 0n) out.push(`Each person can spend up to ${formatUsdShort(r.memberDailyCap)} a day from the pot.`);
  if (r.memberTotalCap > 0n) out.push(`Each person can spend up to ${formatUsdShort(r.memberTotalCap)} in total.`);
  const budgets = r.categoryBudgets.map((b, i) => (b > 0n ? `${CATEGORIES[i].name} ${formatUsdShort(b)}` : null)).filter(Boolean);
  if (budgets.length) out.push(`Budgets: ${budgets.join(", ")}.`);
  if (r.payeePolicy === PayeePolicy.MEMBERS_ONLY) out.push("Only people in the plan can be paid, plus anyone by link.");
  else if (r.payeePolicy === PayeePolicy.MEMBERS_AND_ALLOWLIST) out.push("Only people in the plan and saved businesses can be paid, plus anyone by link.");
  else out.push("Can pay members, businesses, and anyone by link.");
  if (r.minContribution > 0n) out.push(`Spending opens once everyone has put in ${formatUsdShort(r.minContribution)}.`);
  out.push("Anyone in a split can question a spend for 48 hours.");
  if (opts.reviewWindowSec !== undefined) {
    out.push(
      opts.reviewWindowSec > 0
        ? `What's left is shared out when the plan ends, after a ${hours(opts.reviewWindowSec)} check.`
        : "What's left is shared out as soon as the plan ends.",
    );
  }
  out.push(`Rule changes need a majority and wait ${hours(r.ruleTimelock)} before they apply.`);
  return out;
}

/** One-line preset description (screen 11). */
export function presetBlurb(r: Rules): string {
  const big = r.oneApprovalMax >= UINT64_MAX;
  if (r.instantMax === 0n) {
    return `Every spend needs 1 OK. Over ${formatUsdShort(r.oneApprovalMax)} needs ${r.highTier === HighTier.ALL ? "everyone" : "a majority"}.${
      r.payeePolicy === PayeePolicy.MEMBERS_AND_ALLOWLIST ? " Only members and saved businesses can be paid." : ""
    }`;
  }
  if (big) return `Spends up to ${formatUsdShort(r.instantMax)} go through now. Bigger ones need 1 OK.`;
  return `Up to ${formatUsdShort(r.instantMax)} goes through now. ${formatUsdShort(r.instantMax)}–${formatUsdShort(r.oneApprovalMax)} needs 1 OK. Over ${formatUsdShort(
    r.oneApprovalMax,
  )} needs ${r.highTier === HighTier.ALL ? "everyone" : "a majority"}.${r.memberDailyCap > 0n ? ` Up to ${formatUsdShort(r.memberDailyCap)} a day each.` : ""}`;
}

/** Tier strip segments for the preset cards: [flex, label]. */
export function tierStrip(r: Rules): { flex: number; label: string; kind: "now" | "one" | "high" }[] {
  const segs: { flex: number; label: string; kind: "now" | "one" | "high" }[] = [];
  if (r.instantMax > 0n) segs.push({ flex: r.oneApprovalMax >= UINT64_MAX ? 3 : 1, label: "Now", kind: "now" });
  segs.push({ flex: r.oneApprovalMax >= UINT64_MAX ? 1 : 2, label: "1 OK", kind: "one" });
  if (r.oneApprovalMax < UINT64_MAX) segs.push({ flex: 1.4, label: r.highTier === HighTier.ALL ? "Everyone" : "Majority", kind: "high" });
  return segs;
}

export function rulesFromIndexer(p: {
  instantMax: string;
  oneApprovalMax: string;
  highTier: string;
  memberDailyCap: string;
  memberTotalCap: string;
  payeePolicy: string;
  minContribution: string;
  proposalTtl: string;
  ruleTimelock: string;
  categoryBudgets?: string[];
}): Rules {
  const b = (p.categoryBudgets ?? []).map((x) => BigInt(x));
  while (b.length < 8) b.push(0n);
  return {
    instantMax: BigInt(p.instantMax),
    oneApprovalMax: BigInt(p.oneApprovalMax),
    highTier: p.highTier === "ALL" || p.highTier === "1" ? HighTier.ALL : HighTier.MAJORITY,
    memberDailyCap: BigInt(p.memberDailyCap),
    memberTotalCap: BigInt(p.memberTotalCap),
    payeePolicy:
      p.payeePolicy === "MEMBERS_ONLY" || p.payeePolicy === "1"
        ? PayeePolicy.MEMBERS_ONLY
        : p.payeePolicy === "MEMBERS_AND_ALLOWLIST" || p.payeePolicy === "2"
          ? PayeePolicy.MEMBERS_AND_ALLOWLIST
          : PayeePolicy.ANYONE,
    minContribution: BigInt(p.minContribution),
    proposalTtl: Number(p.proposalTtl),
    ruleTimelock: Number(p.ruleTimelock),
    categoryBudgets: b.slice(0, 8) as unknown as Rules["categoryBudgets"],
  };
}

/** Spend-blocked reason codes (docs/protocol.md) in plain words for the rule preview. */
export const BLOCK_REASONS: Record<number, string> = {
  1: "You're not an active member of this plan.",
  2: "This plan isn't open for spending right now.",
  3: "The plan is paused.",
  4: "Spending opens once everyone has put in the minimum.",
  5: "The plan's rules don't allow paying them.",
  6: "This would go over the budget for this category.",
  7: "This would go over your daily limit.",
  8: "This would go over your total limit.",
  9: "There isn't enough money in the pot.",
  10: "The split isn't valid.",
  11: "Check the amount and category.",
};
