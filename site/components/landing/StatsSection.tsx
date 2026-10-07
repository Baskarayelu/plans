// Aceternity UI Pro "Stats Sections": "Stats With Grid Background" for MEASURED (fixed, measured on Monad mainnet)
// and the "Stats With Number Ticker" layout for the live counters (from Envio via lib/stats.ts).
import Link from "next/link";
import { SectionHeader } from "@/components/ui/primitives";
import { CountUp } from "./CountUp";
import { CornerGrid, EdgeFold } from "@/components/ui/grid-pattern";
import { ausd, formatInt, formatUsd, type StatsResult } from "@/lib/stats";

export interface MeasuredStat {
  value: React.ReactNode;
  label: string;
  source: string;
  icon: React.ReactNode;
  squares: number[][];
}

function Glyph({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function IconContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-surface-2 to-surface to-50% p-1">
      <div className="flex size-full items-center justify-center rounded-lg bg-ink text-accent">{children}</div>
    </div>
  );
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
    icon: <Glyph d="M4 7h4v4H4zM10 13h4v4h-4zM16 7h4v4h-4zM8 9h2M14 15h2" />,
    squares: [[8, 2], [9, 5], [10, 1], [7, 4], [10, 6]],
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
    icon: <Glyph d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 12.5l2.5 2.5 4.5-5" />,
    squares: [[7, 1], [9, 3], [10, 5], [8, 6], [9, 2]],
  },
  {
    value: "$0.0004",
    label: "to send digital dollars, paid by Plans",
    source: "112,910 gas · 102 gwei · MON $0.031",
    icon: <Glyph d="M12 3v18M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.6 0-4.5 1.3-4.5 3.2 0 4.3 9 2.3 9 6.6 0 1.9-1.9 3.2-4.5 3.2-2.2 0-3.9-.8-4.7-2.1" />,
    squares: [[10, 2], [8, 4], [7, 1], [9, 6], [10, 4]],
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
      <div className="overflow-hidden rounded-[22px] border border-line bg-surface">
        <div className="grid grid-cols-1 min-[761px]:grid-cols-3">
          {MEASURED.map((m, i) => (
            <div
              key={m.label}
              className={
                "group/card relative grid content-start gap-3 overflow-hidden p-[26px] min-[761px]:p-8 " +
                (i < MEASURED.length - 1 ? "border-b border-line min-[761px]:border-r min-[761px]:border-b-0" : "")
              }
            >
              <CornerGrid squares={m.squares} />
              <EdgeFold />
              <div className="relative flex items-center gap-3">
                <IconContainer>{m.icon}</IconContainer>
                <div className="font-display text-[clamp(40px,5vw,56px)] leading-none font-extrabold tracking-[-0.04em] tnum">
                  {m.value}
                </div>
              </div>
              <p className="relative m-0 mt-1 text-[15px] text-balance text-muted">{m.label}</p>
              <span className="relative font-mono text-[11.5px] leading-snug font-medium text-muted">{m.source}</span>
            </div>
          ))}
        </div>
      </div>
      <div
        aria-label={ok ? "Live usage from the Plans indexer" : "Live usage, counting starts at launch"}
        className="mx-auto mt-12 grid max-w-[1000px] grid-cols-2 gap-x-6 gap-y-8 min-[761px]:grid-cols-4"
      >
        {live.map((c) => (
          <div key={c.k} className="grid content-start gap-2">
            <span className={"font-display text-[clamp(30px,3.6vw,40px)] leading-none font-extrabold tnum " + (ok ? "text-ink" : "text-muted")}>
              {c.v}
            </span>
            <span className="text-[15px] text-balance text-muted">{c.k}</span>
          </div>
        ))}
      </div>
      <p className="mt-10 text-center font-mono text-xs leading-snug font-medium text-muted">
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
