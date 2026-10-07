// What the public proof page (/s/<pot>) and its link-preview image say about a settled plan.
// Counts, countries and amounts from the public record only; never names, notes, receipts or photos.

import { explorerTx, type ProofPlan } from "./plans-data";
import { big, countryCounts, countryName, dateRange, days, duration, flagFor, formatUsd, formatUsdShort, longDate, utcTime } from "./plans-format";

export type ProofSummary = {
  settled: boolean;
  people: number;
  countryCount: number;
  headline: string;
  countries: { code: string | null; flag: string; name: string; count: number; got: string }[];
  putIn: string;
  putInShort: string;
  spent: string;
  paidOut: string;
  spends: number;
  days: number;
  dates: string;
  settleTime: { value: string; label: string };
  settledOn: string | null;
  settledAt: string | null;
  transactions: number;
  txUrl: string | null;
  isDemo: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function summarize(p: ProofPlan): ProofSummary {
  const counts = countryCounts(p.members.map((m) => m.country));
  const countryOf = new Map(p.members.map((m) => [m.address, m.country]));
  const got = new Map<string | null, bigint>();
  for (const x of p.payouts) {
    const c = countryOf.get(x.account) ?? null;
    got.set(c, (got.get(c) ?? 0n) + big(x.amount));
  }
  const people = p.members.length || p.memberCount;
  const countryCount = counts.filter((c) => c.code).length;
  const who = `${plural(people, "friend", "friends")}${countryCount > 0 ? ` in ${plural(countryCount, "country", "countries")}` : ""}`;
  const last = p.settlements[p.settlements.length - 1];
  const settledAt = p.settledAt ?? last?.timestamp ?? null;

  let settleTime = { value: "—", label: "to settle up" };
  if (settledAt) {
    settleTime =
      settledAt >= p.endTime
        ? { value: duration(settledAt - p.endTime), label: "from the plan’s end to settled" }
        : { value: "Early", label: "settled before the end date, by agreement" };
  }

  return {
    settled: p.status === "Settled",
    people,
    countryCount,
    headline: `${who} settled up in one tap`,
    countries: counts.map((c) => ({
      code: c.code,
      flag: flagFor(c.code),
      name: countryName(c.code),
      count: c.count,
      got: formatUsd(got.get(c.code) ?? 0n),
    })),
    putIn: formatUsd(big(p.totalContributed)),
    putInShort: formatUsdShort(big(p.totalContributed)),
    spent: formatUsd(big(p.totalSpent)),
    paidOut: formatUsd(big(p.totalPaidOut)),
    spends: p.spendCount,
    days: days(p.startTime, p.endTime),
    dates: dateRange(p.startTime, p.endTime),
    settleTime,
    settledOn: settledAt ? longDate(settledAt) : null,
    settledAt: settledAt ? utcTime(settledAt) : null,
    transactions: p.settlements.length,
    txUrl: last?.txHash ? explorerTx(last.txHash) : null,
    isDemo: p.isDemo,
  };
}
