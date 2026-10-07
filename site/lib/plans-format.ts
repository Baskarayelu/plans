/**
 * Formatting and "rules in plain words", copied from the app (app/src/lib/domain/{currency,rules}.ts)
 * so the shared-plan page says exactly what the app says. Pure; safe on server and client.
 */

export const ONE_DOLLAR = 1_000_000n; // AUSD has 6 decimals
export const UINT64_MAX = (1n << 64n) - 1n;

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Dollars from AUSD base units: 446000000n → "$446.00". */
export function formatUsd(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const cents = (abs + 5_000n) / 10_000n;
  const s = cents.toString().padStart(3, "0");
  return `${neg ? "−" : ""}$${group(s.slice(0, -2))}.${s.slice(-2)}`;
}

/** Short dollars: "$36" when whole, else "$36.50". */
export function formatUsdShort(units: bigint): string {
  if (units % ONE_DOLLAR === 0n) {
    const neg = units < 0n;
    return `${neg ? "−" : ""}$${group(((neg ? -units : units) / ONE_DOLLAR).toString())}`;
  }
  return formatUsd(units);
}

export const big = (v: string | number | null | undefined): bigint => {
  try {
    return BigInt(v ?? 0);
  } catch {
    return 0n;
  }
};

// ─────────────── rules ───────────────

export const CATEGORY_NAMES = ["Stay", "Travel", "Getting around", "Food & drink", "Tickets & activities", "Groceries", "Shopping", "Other"];

export type RulesRow = {
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

const hours = (s: number) => (s % 3600 === 0 ? `${s / 3600}\u00a0h` : `${Math.round(s / 60)}\u00a0min`);

/** The rules in plain words (the app's screens 11, 14, 17). */
export function rulesInWords(p: RulesRow, opts: { reviewWindowSec?: number } = {}): string[] {
  const instantMax = big(p.instantMax);
  const oneApprovalMax = big(p.oneApprovalMax);
  const all = p.highTier === "ALL" || p.highTier === "1";
  const daily = big(p.memberDailyCap);
  const total = big(p.memberTotalCap);
  const minC = big(p.minContribution);
  const timelock = Number(p.ruleTimelock) || 0;
  const policy = p.payeePolicy;

  const out: string[] = [];
  const unlimited = oneApprovalMax >= UINT64_MAX;
  const high = all ? "everyone's OK" : "a majority's OK";
  if (instantMax === 0n) out.push("Every spend needs at least one friend's OK.");
  else out.push(`Spends up to ${formatUsdShort(instantMax)} go through straight away.`);
  if (unlimited) out.push("Bigger spends need one friend's OK.");
  else if (instantMax === 0n) out.push(`Up to ${formatUsdShort(oneApprovalMax)} needs one friend's OK. Over that needs ${high}.`);
  else
    out.push(
      `${formatUsdShort(instantMax)}–${formatUsdShort(oneApprovalMax)} needs one friend's OK. Over ${formatUsdShort(oneApprovalMax)} needs ${high}.`,
    );
  if (daily > 0n) out.push(`Each person can spend up to ${formatUsdShort(daily)} a day from the pot.`);
  if (total > 0n) out.push(`Each person can spend up to ${formatUsdShort(total)} in total.`);
  const budgets = (p.categoryBudgets ?? [])
    .map((b, i) => (big(b) > 0n ? `${CATEGORY_NAMES[i] ?? "Other"} ${formatUsdShort(big(b))}` : null))
    .filter(Boolean);
  if (budgets.length) out.push(`Budgets: ${budgets.join(", ")}.`);
  if (policy === "MEMBERS_ONLY" || policy === "1") out.push("Only people in the plan can be paid, plus anyone by link.");
  else if (policy === "MEMBERS_AND_ALLOWLIST" || policy === "2")
    out.push("Only people in the plan and saved businesses can be paid, plus anyone by link.");
  else out.push("Can pay members, businesses, and anyone by link.");
  if (minC > 0n) out.push(`Spending opens once everyone has put in ${formatUsdShort(minC)}.`);
  out.push("Anyone in a split can question a spend; the group votes for 48 hours.");
  if (opts.reviewWindowSec !== undefined) {
    out.push(
      opts.reviewWindowSec > 0
        ? `What's left is shared out when the plan ends, after a ${hours(opts.reviewWindowSec)} check.`
        : "What's left is shared out as soon as the plan ends.",
    );
  }
  out.push(`Rule changes need a majority and wait ${hours(timelock)} before they apply.`);
  return out;
}

// ─────────────── countries ───────────────

/** ISO 3166-1 alpha-2 → flag emoji; "" for anything else. */
export function flagFor(code?: string | null): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "";
  const c = code.toUpperCase();
  return String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65, 0x1f1e6 + c.charCodeAt(1) - 65);
}

let regionNames: Intl.DisplayNames | null = null;
export function countryName(code?: string | null): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "No country given";
  try {
    regionNames ??= new Intl.DisplayNames(["en-GB"], { type: "region" });
    return regionNames.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** Countries with how many members each, most first; members without a country come last. */
export function countryCounts(codes: (string | null | undefined)[]): { code: string | null; count: number }[] {
  const m = new Map<string | null, number>();
  for (const raw of codes) {
    const c = raw && /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null;
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => (a.code === null ? 1 : b.code === null ? -1 : b.count - a.count || a.code.localeCompare(b.code)));
}

// ─────────────── dates (always UTC, so server and browser render the same text) ───────────────

const DAY = 86_400;

function parts(unix: number) {
  const d = new Date(unix * 1000);
  return {
    wd: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
    day: d.getUTCDate(),
    mon: d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
    year: d.getUTCFullYear(),
  };
}

/** "Mon 12 – Fri 16 Oct" (same month), "Mon 28 Sep – Fri 2 Oct", with the year when it isn't this year. */
export function dateRange(start: number, end: number, now = Date.now() / 1000): string {
  const a = parts(start);
  const b = parts(end);
  const yr = b.year !== parts(now).year ? ` ${b.year}` : "";
  if (a.mon === b.mon && a.year === b.year) return `${a.wd} ${a.day} – ${b.wd} ${b.day} ${b.mon}${yr}`;
  return `${a.wd} ${a.day} ${a.mon} – ${b.wd} ${b.day} ${b.mon}${yr}`;
}

export function shortDate(unix: number): string {
  const p = parts(unix);
  return `${p.day} ${p.mon}`;
}

export function longDate(unix: number): string {
  const p = parts(unix);
  return `${p.wd} ${p.day} ${p.mon} ${p.year}`;
}

export function utcTime(unix: number): string {
  const d = new Date(unix * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export function days(start: number, end: number): number {
  return Math.max(1, Math.round((end - start) / DAY));
}

/** "40 s", "14 min", "3 h", "2 days". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 2 * DAY) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / DAY)} days`;
}
