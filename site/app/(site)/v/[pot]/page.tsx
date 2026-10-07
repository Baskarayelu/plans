import type { Metadata } from "next";
import { PlanUnavailable } from "@/components/plans/PlanUnavailable";
import { SharedPlanView, type SharedFacts } from "@/components/plans/SharedPlanView";
import { loadSharedPlan, type SharedPlan } from "@/lib/plans-data";
import { countryCounts, countryName, dateRange, days, flagFor, formatUsd, big, rulesInWords, shortDate } from "@/lib/plans-format";

export const metadata: Metadata = {
  title: "A shared plan",
  description: "A read-only view of a plan on Plans. Open the whole link to see its name and join with one fingerprint.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const revalidate = 30; // same as PLAN_REVALIDATE_SECONDS in lib/plans-data.ts

const MAX_MEMBERS = 50;

function factsOf(p: SharedPlan): SharedFacts {
  const counts = countryCounts(p.memberCountries);
  const now = Math.floor(Date.now() / 1000);
  return {
    dates: dateRange(p.startTime, p.endTime),
    endShort: shortDate(p.endTime),
    days: days(p.startTime, p.endTime),
    pot: formatUsd(big(p.balance)),
    people: p.activeMemberCount,
    countries: counts.map((c) => ({ flag: flagFor(c.code), count: c.count, name: countryName(c.code) })),
    countryCount: counts.filter((c) => c.code).length,
    rules: rulesInWords(p.rules, { reviewWindowSec: p.reviewWindow }),
    ended: p.status === "Settled" || now > p.endTime,
    full: p.memberCount >= MAX_MEMBERS,
  };
}

export default async function SharedPlanPage({ params }: { params: Promise<{ pot: string }> }) {
  const { pot } = await params;
  const r = await loadSharedPlan(pot);
  if (r.state !== "ok") return <PlanUnavailable state={r.state} />;
  return <SharedPlanView plan={r.data} facts={factsOf(r.data)} />;
}
