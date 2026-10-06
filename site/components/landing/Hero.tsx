import { Fragment } from "react";
import { Button, BtnTag, Card, Chip } from "@/components/ui/primitives";
import { BETA_DATE, DOWNLOAD_PATH } from "@/lib/site";
import { cn } from "@/lib/utils";

const HEADLINE: Array<{ w: string; hl?: boolean }> = [
  ..."A shared pot for every plan, wherever your".split(" ").map((w) => ({ w })),
  { w: "friends", hl: true },
  { w: "live." },
];

function Floating({ className, delay, children }: { className: string; delay: number; children: React.ReactNode }) {
  // CSS keyframes (globals.css `bob`): negative delays de-synchronise the cards; off under reduced motion.
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute z-[1]", className)}>
      <div className="animate-bob motion-reduce:animate-none" style={{ animationDelay: `-${delay}s` }}>
        {children}
      </div>
    </div>
  );
}

export function TicketStub({
  className,
  title,
  tag,
  amount,
  sub,
  foot,
}: {
  className?: string;
  title: React.ReactNode;
  tag?: React.ReactNode;
  amount: React.ReactNode;
  sub: React.ReactNode;
  foot: React.ReactNode;
}) {
  return (
    <div className={cn("relative w-[236px] overflow-hidden rounded-[14px] border border-line bg-surface text-ink shadow-card", className)}>
      <div className="grid gap-1.5 px-4 pt-3.5 pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-xs leading-tight font-medium text-muted">{title}</span>
          {tag}
        </div>
        <div className="font-display text-[26px] leading-none font-extrabold tracking-[-0.02em] tnum">{amount}</div>
        <div className="font-mono text-xs leading-tight font-medium text-muted tnum">{sub}</div>
      </div>
      <div className="perf" />
      <div className="px-4 pt-2 pb-3.5 font-mono text-[11.5px] leading-normal font-medium text-muted">{foot}</div>
    </div>
  );
}

export function Hero() {
  return (
    <header
      id="top"
      className="relative isolate mx-auto mt-5 max-w-[1180px] overflow-hidden rounded-[35px] border border-line bg-surface px-5 pt-24 pb-[120px] max-[760px]:pt-20 max-[760px]:pb-[110px]"
    >
      <div aria-hidden="true" className="dots-bg absolute inset-0 -z-10" />

      <Floating
        delay={1}
        className="top-16 left-[4%] rotate-[-12deg] max-[1080px]:-left-10 max-[760px]:top-2.5 max-[760px]:-left-[70px] max-[760px]:scale-[.72] max-[760px]:opacity-55"
      >
        <TicketStub
          title="Dinner at Taberna"
          tag={<Chip>🍽 Food</Chip>}
          amount="$36.00"
          sub="£26.72 · split 3 ways"
          foot={
            <>
              Paid from the Lisbon pot
              <br />
              <b className="font-semibold text-pos">Settled in 0.6 s</b>
            </>
          }
        />
      </Floating>

      <Floating
        delay={3}
        className="top-[70px] right-[5%] rotate-[9deg] max-[1080px]:-right-[60px] max-[760px]:top-1.5 max-[760px]:-right-[120px] max-[760px]:scale-[.72] max-[760px]:opacity-55"
      >
        <Card className="grid w-[250px] gap-2.5">
          <div className="flex items-center gap-2.5 text-sm font-semibold">
            <span className="grid size-[34px] flex-none place-items-center rounded-full bg-[#9ED3B8] font-display text-sm font-bold text-on-accent">
              A
            </span>
            <span>
              Asha wants <span className="tnum">$250</span> for the boat trip
            </span>
          </div>
          <div className="flex gap-2 text-[13px] font-semibold">
            <span className="flex-1 rounded-full border border-line py-[9px] text-center">Not now</span>
            <span className="flex-1 rounded-full bg-accent py-[9px] text-center text-on-accent">Approve</span>
          </div>
        </Card>
      </Floating>

      <Floating
        delay={2}
        className="bottom-[-18px] left-[7%] rotate-[8deg] max-[760px]:-bottom-[60px] max-[760px]:-left-[60px] max-[760px]:scale-[.72] max-[760px]:opacity-55"
      >
        <Card className="grid w-[228px] gap-2 font-mono text-[15px] leading-none font-semibold">
          <div className="flex justify-between tnum">
            <span>£1.50</span>
            <span className="font-medium text-muted">you send</span>
          </div>
          <div className="flex justify-between tnum">
            <span>$2.02</span>
            <span className="font-medium text-muted">Sam gets</span>
          </div>
          <div className="text-[10.5px] font-medium whitespace-nowrap text-muted">1 GBP = 1.3472 USD · ECB 14:05</div>
        </Card>
      </Floating>

      <Floating
        delay={4.5}
        className="right-[4%] bottom-[26px] rotate-[-10deg] max-[760px]:-right-[110px] max-[760px]:-bottom-10 max-[760px]:scale-[.72] max-[760px]:opacity-55"
      >
        <Card className="grid w-[220px] gap-2.5 text-sm">
          <div className="font-display text-[15px] leading-tight font-bold">Settled up 🎉</div>
          <div className="flex justify-between tnum">
            <span>Maya · London</span>
            <Chip tone="pos">+£8.20</Chip>
          </div>
          <div className="flex justify-between tnum">
            <span>Sam · New York</span>
            <Chip tone="pos">+$10.40</Chip>
          </div>
          <div className="flex justify-between tnum">
            <span>Asha · Bengaluru</span>
            <Chip tone="neg">−₹350</Chip>
          </div>
        </Card>
      </Floating>

      <Floating delay={5.5} className="bottom-[150px] left-[1%] rotate-[16deg] max-[1080px]:hidden">
        <Card className="inline-flex items-center gap-2.5 text-[13px] font-semibold">
          <span>Your key</span>
          <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1.5 text-lg tracking-[2px]">🦊🌵🎈</span>
        </Card>
      </Floating>

      <div className="relative z-[5] mx-auto grid max-w-[760px] justify-items-center gap-[26px] text-center">
        <span className="inline-flex items-center gap-2.5 rounded-full border border-line bg-surface-2 py-[7px] pr-3.5 pl-2 text-[13px] font-semibold whitespace-nowrap min-[420px]:text-sm">
          <span className="inline-flex" aria-hidden="true">
            {["🇬🇧", "🇺🇸", "🇮🇳", "🇵🇹"].map((f, i) => (
              <span
                key={f}
                className={cn(
                  "grid size-6 place-items-center rounded-full border border-line bg-surface text-[13px]",
                  i > 0 && "-ml-1.5",
                )}
              >
                {f}
              </span>
            ))}
          </span>
          Friends in four countries, one pot
        </span>

        <h1 className="m-0 font-display text-[clamp(40px,6.4vw,76px)] leading-none font-extrabold tracking-[-0.035em] text-balance">
          {HEADLINE.map(({ w, hl }, i) => (
            <Fragment key={i}>
              {/* CSS reveal (globals.css `word`): renders visible without JS, instant under reduced motion */}
              <span className={cn("inline-block animate-word", hl && "hl")} style={{ animationDelay: `${0.12 + i * 0.07}s` }}>
                {w}
              </span>
              {i < HEADLINE.length - 1 ? " " : null}
            </Fragment>
          ))}
        </h1>

        <p className="m-0 max-w-[600px] text-[clamp(17px,2vw,20px)] text-pretty text-muted">
          Join with one fingerprint. Spend from the pot under rules the group agrees on. When the plan ends, everyone
          is settled in one tap, in pounds, dollars or rupees.
        </p>

        <div className="flex flex-wrap justify-center gap-3">
          <Button href={DOWNLOAD_PATH}>
            Get the Android app <BtnTag>Beta · {BETA_DATE}</BtnTag>
          </Button>
          <Button href="#how" variant="ghost">
            See how it works
          </Button>
        </div>
        <span className="font-mono text-xs leading-snug font-medium text-muted">
          No bank account in common. No app password. Free for groups.
        </span>
      </div>
    </header>
  );
}
