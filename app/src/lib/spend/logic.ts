/**
 * Pure helpers for the spending screens (20–32): amounts, splits, rule wording, dispute tallies,
 * dates. No React and no I/O, so they are unit tested in src/__tests__/spendLogic.test.ts.
 */
import { HighTier } from "../chain/eip712";
import { currencyFor, formatUsdShort, localE8ToUsd, parseAmount } from "../domain/currency";
import { UINT64_MAX } from "../domain/rules";
import { splitParts } from "../domain/settlement";

/** docs/protocol.md DISPUTE_PERIOD. */
export const DISPUTE_PERIOD = 48 * 3600;

const lc = (s: string) => s.toLowerCase();

// ─────────────── amounts ───────────────

/** Keeps digits and one point, at most `decimals` places and 9 whole digits. */
export function sanitizeAmountText(next: string, decimals: number): string {
  let t = next.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const dot = t.indexOf(".");
  if (dot >= 0) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, "");
  if (decimals === 0) t = t.replace(/\..*$/, "");
  let [i, f] = t.split(".");
  i = (i ?? "").replace(/^0+(?=\d)/, "").slice(0, 9);
  if (f !== undefined) return `${i || "0"}.${f.slice(0, decimals)}`;
  return i;
}

/** Dollar units (6 decimals) for typed text, in dollars or in the viewer's currency. */
export function amountUnits(text: string, inLocal: boolean, currency: string, rateE8: bigint | undefined): bigint | null {
  if (!text) return null;
  if (!inLocal || currency === "USD") return parseAmount(text, 6);
  if (!rateE8) return null;
  const local = parseAmount(text, 8);
  if (local === null) return null;
  return localE8ToUsd(local, rateE8);
}

/** Plain editable text for a fixed-point value: 18_500_000n (6) → "18.5" at 2 places. */
export function plainFixed(v: bigint, decimalsIn: number, decimalsOut: number): string {
  if (v <= 0n) return "";
  let r: bigint;
  if (decimalsOut >= decimalsIn) r = v * 10n ** BigInt(decimalsOut - decimalsIn);
  else {
    const div = 10n ** BigInt(decimalsIn - decimalsOut);
    r = (v + div / 2n) / div;
  }
  if (decimalsOut === 0) return r.toString();
  const s = r.toString().padStart(decimalsOut + 1, "0");
  const i = s.slice(0, -decimalsOut);
  const f = s.slice(-decimalsOut).replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
}

export function amountDecimals(inLocal: boolean, currency: string): number {
  return inLocal ? currencyFor(currency).decimals : 2;
}

// ─────────────── names ───────────────

/** "Sam", "Sam and Asha", "Sam, Asha and Ben". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ─────────────── splits ───────────────

export type SplitMode = "everyone" | "pick" | "custom";

/** Shares exactly as the contract computes them (first member takes the remainder). */
export function sharesFor(amount: bigint, weights: readonly number[]): bigint[] {
  if (weights.length === 0) return [];
  if (amount <= 0n) return weights.map(() => 0n);
  return splitParts(amount, weights);
}

/** The "each" amount when everyone has the same weight (the non-remainder part), else null. */
export function eachAmount(amount: bigint, weights: readonly number[]): bigint | null {
  if (weights.length === 0) return null;
  if (weights.some((w) => w !== weights[0])) return null;
  const parts = sharesFor(amount, weights);
  return parts[parts.length - 1];
}

/** Orders chosen members the way the plan lists them; weights default to 1. */
export function orderedSplit(planOrder: readonly string[], chosen: readonly string[], weights: Record<string, number> = {}, custom = false): { members: string[]; weights: number[] } {
  const set = new Set(chosen.map(lc));
  const members = planOrder.map(lc).filter((a) => set.has(a));
  return { members, weights: members.map((a) => (custom ? Math.min(9, Math.max(1, weights[a] ?? 1)) : 1)) };
}

// ─────────────── rules in words ───────────────

export type TierRules = { instantMax: bigint; oneApprovalMax: bigint; highTier: HighTier };

export const oks = (n: number) => (n === 1 ? "1 OK" : `${n} OKs`);

/** Short rule line for receipts and the approval card: "Under $25", "$25–$200 needs 1 OK", "Over $200 needs 2 OKs". */
export function ruleLine(r: TierRules, amount: bigint, approvalsRequired: number): string {
  const friends = Math.max(0, approvalsRequired - 1);
  if (friends === 0) {
    if (amount <= r.instantMax && r.instantMax > 0n) return amount === r.instantMax ? `Up to ${formatUsdShort(r.instantMax)}` : `Under ${formatUsdShort(r.instantMax)}`;
    return "Only one person in the plan";
  }
  if (r.oneApprovalMax >= UINT64_MAX || amount <= r.oneApprovalMax) {
    if (r.instantMax === 0n) return r.oneApprovalMax >= UINT64_MAX ? `Every spend needs ${oks(friends)}` : `Up to ${formatUsdShort(r.oneApprovalMax)} needs ${oks(friends)}`;
    if (r.oneApprovalMax >= UINT64_MAX) return `Over ${formatUsdShort(r.instantMax)} needs ${oks(friends)}`;
    return `${formatUsdShort(r.instantMax)}–${formatUsdShort(r.oneApprovalMax)} needs ${oks(friends)}`;
  }
  return `Over ${formatUsdShort(r.oneApprovalMax)} needs ${oks(friends)}`;
}

/** The sentence under "Needs N more approvals": "$25–$200 needs one friend's OK." */
export function tierSentence(r: TierRules, amount: bigint, approvalsRequired: number): string {
  const friends = Math.max(0, approvalsRequired - 1);
  const midTier = r.oneApprovalMax >= UINT64_MAX || amount <= r.oneApprovalMax;
  if (midTier) {
    if (r.instantMax === 0n) return r.oneApprovalMax >= UINT64_MAX ? "Every spend needs one friend's OK." : `Up to ${formatUsdShort(r.oneApprovalMax)} needs one friend's OK.`;
    return r.oneApprovalMax >= UINT64_MAX
      ? `Over ${formatUsdShort(r.instantMax)} needs one friend's OK.`
      : `${formatUsdShort(r.instantMax)}–${formatUsdShort(r.oneApprovalMax)} needs one friend's OK.`;
  }
  const who = r.highTier === HighTier.ALL ? "everyone's OK" : "a majority's OK";
  return `Over ${formatUsdShort(r.oneApprovalMax)} needs ${who}, so ${friends} ${friends === 1 ? "friend" : "friends"} besides you.`;
}

// ─────────────── budgets ───────────────

export type CategoryUse = { budget: string; spent: string; refunded?: string; remaining?: string | null };

/** Budget for a category (rules first, the indexer row as fallback) and what's left. Null when no budget. */
export function budgetInfo(rulesBudget: bigint, row?: CategoryUse): { budget: bigint; spent: bigint; remaining: bigint } | null {
  const budget = rulesBudget > 0n ? rulesBudget : row ? BigInt(row.budget || "0") : 0n;
  if (budget <= 0n) return null;
  const spent = row ? BigInt(row.spent || "0") - BigInt(row.refunded || "0") : 0n;
  const used = spent < 0n ? 0n : spent;
  const remaining = budget > used ? budget - used : 0n;
  return { budget, spent: used, remaining };
}

// ─────────────── payees ───────────────

export type RecentSpendLike = { kind: string; payee: string; status?: string; category: number; amount: string; executedAt?: number | null; proposedAt?: number };

/** Businesses paid before: distinct PAY payees that aren't members, newest first. */
export function paidBefore(recent: readonly RecentSpendLike[], memberAddrs: readonly string[]): { payee: string; category: number; amount: bigint; at: number }[] {
  const members = new Set(memberAddrs.map(lc));
  const seen = new Set<string>();
  const out: { payee: string; category: number; amount: bigint; at: number }[] = [];
  const rows = [...recent].sort((a, b) => (b.executedAt ?? b.proposedAt ?? 0) - (a.executedAt ?? a.proposedAt ?? 0));
  for (const s of rows) {
    if (s.kind !== "PAY" || s.status !== "Executed") continue;
    const p = lc(s.payee);
    if (members.has(p) || seen.has(p) || /^0x0+$/.test(p)) continue;
    seen.add(p);
    out.push({ payee: p, category: s.category, amount: BigInt(s.amount), at: s.executedAt ?? s.proposedAt ?? 0 });
  }
  return out;
}

// ─────────────── disputes ───────────────

export const DISPUTE_CHOICES = [
  { key: "not-part", label: "Not part of the plan", code: 2 },
  { key: "wrong-amount", label: "Wrong amount", code: 0 },
  { key: "not-there", label: "I wasn't there", code: 1 },
  { key: "paid-twice", label: "Paid twice", code: 0 },
  { key: "wrong-split", label: "Wrong split", code: 1 },
] as const;

export function disputeReasonLabel(code: number): string {
  return code === 0 ? "Wrong amount" : code === 1 ? "Wrong split" : "Not a group cost";
}

/** Eligible voters: active members other than the spend's proposer and the opener. */
export function eligibleVoters(active: readonly string[], proposer: string, opener: string): string[] {
  const skip = new Set([lc(proposer), lc(opener)]);
  return active.map(lc).filter((a) => !skip.has(a));
}

export function disputeTally(eligible: readonly string[], votes: readonly { account_id: string; spenderCovers: boolean }[]) {
  const voted = new Map(votes.map((v) => [lc(v.account_id), v.spenderCovers]));
  const cover = votes.filter((v) => v.spenderCovers).length;
  const keep = votes.length - cover;
  const waiting = eligible.filter((a) => !voted.has(a));
  return { cover, keep, waiting, allVoted: eligible.length > 0 && waiting.length === 0, voted };
}

/** Strict majority of votes cast for "spender covers"; anything else keeps it. */
export function likelyOutcome(cover: number, keep: number): "SpenderCovers" | "Keep" {
  return cover * 2 > cover + keep ? "SpenderCovers" : "Keep";
}

export function canFinalize(openedAt: number, now: number, eligibleCount: number, allVoted: boolean): boolean {
  return now >= openedAt + DISPUTE_PERIOD || (eligibleCount > 0 && allVoted);
}

/** Per-member share change from a dispute resolution (only members whose share moved). */
export function shareChanges(prevMembers: readonly string[], prevShares: readonly string[], newMembers: readonly string[], newShares: readonly string[]) {
  const before = new Map<string, bigint>();
  const after = new Map<string, bigint>();
  prevMembers.forEach((m, i) => before.set(lc(m), (before.get(lc(m)) ?? 0n) + BigInt(prevShares[i] ?? "0")));
  newMembers.forEach((m, i) => after.set(lc(m), (after.get(lc(m)) ?? 0n) + BigInt(newShares[i] ?? "0")));
  const all = Array.from(new Set([...before.keys(), ...after.keys()]));
  return all
    .map((address) => {
      const b = before.get(address) ?? 0n;
      const a = after.get(address) ?? 0n;
      return { address, before: b, after: a, diff: a - b };
    })
    .filter((x) => x.diff !== 0n)
    .sort((x, y) => (x.diff > y.diff ? -1 : x.diff < y.diff ? 1 : 0));
}

// ─────────────── time ───────────────

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");

export function fmtClock(sec: number): string {
  const d = new Date(sec * 1000);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function fmtUtcClock(sec: number): string {
  const d = new Date(sec * 1000);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}

export function fmtDay(sec: number): string {
  const d = new Date(sec * 1000);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "Tue 13 Oct · 14:05" */
export function fmtWhen(sec: number): string {
  return `${fmtDay(sec)} · ${fmtClock(sec)}`;
}

/** "18 h 20 m", "45 m", "2 d 3 h"; "0 m" when past. */
export function durationText(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return `${h} h ${m} m`;
  return `${m} m`;
}

/** "in 22 h" style short form for expiry lines. */
export function inText(sec: number): string {
  const s = Math.max(0, sec);
  if (s >= 2 * 86400) return `${Math.round(s / 86400)} days`;
  if (s >= 3600) return `${Math.round(s / 3600)} h`;
  return `${Math.max(1, Math.round(s / 60))} min`;
}

// ─────────────── bytes ───────────────

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 with padding (data: URIs need this, not base64url). */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    s += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    s += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : "=";
    s += i + 2 < bytes.length ? B64[c & 63] : "=";
  }
  return s;
}

export const ZERO_HASH = /^0x0*$/;
