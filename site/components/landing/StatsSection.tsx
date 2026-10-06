// PRO BLOCK SLOT: "Stats Sections" (Aceternity UI Pro). Replace the two grids with the Pro stats block; feed it
// MEASURED (fixed, measured on Monad mainnet) and `live` (from Envio via lib/stats.ts). Keep id "numbers".
import Link from "next/link";
import { SectionHeader } from "@/components/ui/primitives";
import { CountUp } from "./CountUp";
import { ausd, formatInt, formatUsd, type StatsResult } from "@/lib/stats";

export interface MeasuredStat {
  value: React.ReactNode;
  label: string;
  source: string;
}

export const MEASURED: MeasuredStat[] = [
  {
    value: (
      <>
        <CountUp to={301} />
        <small className="ml-1 text-[.42em] tracking-normal text-muted">ms</small>
      </>
    ),
    label: "between blocks, median",
    source: "196 blocks · websocket timing",
  },
  {
    value: (
      <>
        <CountUp to={0.58} decimals={2} />
        <small className="ml-1 text-[.42em] tracking-normal text-muted">s</small>
      </>
    ),
    label: "until a payment is final, median",
    source: "0.65 s at p95 · 93 blocks",
  },
  {
    value: "$0.0004",
    label: "to send digital dollars, paid by Plans",
    source: "112,910 gas · 102 gwei · MON $0.031",
  },
];

export function liveCounters(stats: StatsResult) {
  const g = stats.state === "ok" ? stats.global : null;
  return [
    { k: "Plans created", v: g ? formatInt(g.potsCreated) : "—" },
    { k: "Users", v: g ? formatInt(g.users) : "—" },
    { k: "Settled up", v: g ? formatInt(g.settlements) : "—" },
    { k: "Cross-border volume", v: g ? formatUsd(ausd(g.crossBorderVolume)) : "—" },
  ];
}

export function StatsSection({ stats }: { stats: StatsResult }) {
  const live = liveCounters(stats);
  const ok = stats.state === "ok";
  return (
    <section id="numbers" aria-labelledby="numbers-title" className="mx-auto max-w-[1180px] scroll-mt-24 pt-[104px]">
      <SectionHeader
        id="numbers-title"
        badge="Why it feels instant"
        title="Built on Monad, measured, not promised"
        lede="We measured the network on 5 October 2026. These numbers are why a spend reaches every phone before you put yours down."
      />
      <div className="grid grid-cols-1 gap-4 min-[761px]:grid-cols-3">
        {MEASURED.map((m) => (
          <div key={m.label} className="relative grid gap-2 rounded-[22px] border border-line bg-surface p-[26px]">
            <div className="font-display text-[clamp(44px,6vw,64px)] leading-none font-extrabold tracking-[-0.04em] tnum">
              {m.value}
            </div>
            <p className="m-0 text-[15px] text-muted">{m.label}</p>
            <span className="font-mono text-[11.5px] leading-snug font-medium text-muted">{m.source}</span>
          </div>
        ))}
      </div>
      <div className="h-4" />
      <div
        aria-label={ok ? "Live usage from the Plans indexer" : "Live usage, counting starts at launch"}
        className="relative grid grid-cols-2 overflow-hidden rounded-[22px] border border-line bg-surface min-[761px]:grid-cols-4"
      >
        {live.map((c, i) => (
          <div
            key={c.k}
            className={
              "grid gap-1.5 p-[22px] " +
              (i % 2 === 1 ? "border-l border-line " : "") +
              (i >= 2 ? "border-t border-line min-[761px]:border-t-0 min-[761px]:border-l" : "")
            }
          >
            <span className={"font-display text-4xl leading-none font-extrabold tnum " + (ok ? "text-ink" : "text-muted")}>
              {c.v}
            </span>
            <span className="text-sm text-muted">{c.k}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center font-mono text-xs leading-snug font-medium text-muted">
        {ok
          ? "Live from the Plans indexer on Monad. Demo and team accounts are never counted. "
          : "Live counts start when Plans launches on Monad mainnet. Demo accounts are never counted. "}
        <Link href="/stats" className="text-ink underline underline-offset-2">
          See all stats
        </Link>
      </p>
    </section>
  );
}
