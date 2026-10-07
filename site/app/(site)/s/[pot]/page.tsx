import type { Metadata } from "next";
import Link from "next/link";
import { Clock, ExternalLink } from "lucide-react";
import { PlanUnavailable } from "@/components/plans/PlanUnavailable";
import { ProofHeadline } from "@/components/plans/ProofHeadline";
import { NotShown } from "@/components/plans/SharedPlanView";
import { Button } from "@/components/ui/primitives";
import { loadProof } from "@/lib/plans-data";
import { summarize, type ProofSummary } from "@/lib/plans-proof";
import { DOWNLOAD_PATH } from "@/lib/site";
import { chainName, statsChainId } from "@/lib/stats";

export const revalidate = 30; // same as PLAN_REVALIDATE_SECONDS in lib/plans-data.ts

type Props = { params: Promise<{ pot: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pot } = await params;
  const r = await loadProof(pot);
  const s = r.state === "ok" ? summarize(r.data) : null;
  const title = s?.settled ? s.headline : "A plan on Plans";
  const description = s?.settled
    ? `${s.putIn} put in together, ${s.paidOut} paid back out. Every number checks out on Monad.`
    : "A group money pot for trips and plans, settled up in one tap.";
  return {
    title,
    description,
    robots: { index: false, follow: true },
    referrer: "no-referrer",
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const PRIVATE_TEXT =
  "Names, who paid for what, what anything was for, receipts, notes and anyone’s balance. The group kept those private, and photos never appear on this page.";

function Band({ text }: { text: string }) {
  return (
    <div
      className="flex h-10 items-center rounded-xl px-4 font-mono text-xs font-semibold tracking-[.08em] text-[#10231b] uppercase"
      style={{ background: "repeating-linear-gradient(90deg, #2fa6b8 0 14px, #59b9c7 14px 16px)" }}
    >
      <span className="truncate">{text}</span>
    </div>
  );
}

function CountryRows({ s }: { s: ProofSummary }) {
  return (
    <ul className="m-0 list-none divide-y divide-line rounded-[22px] border border-line bg-surface px-5 py-1 shadow-card">
      {s.countries.map((c) => (
        <li key={c.code ?? "none"} className="flex items-center gap-3.5 py-3.5">
          <span aria-hidden="true" className="w-10 flex-none text-center text-[28px] leading-none">
            {c.flag || "🌐"}
          </span>
          <span className="min-w-0 flex-1 font-semibold">
            {c.count} {c.count === 1 ? "person" : "people"}
            <span className="font-normal text-muted"> · {c.name}</span>
          </span>
          <span className="flex-none font-semibold tnum">got {c.got}</span>
        </li>
      ))}
    </ul>
  );
}

function Stats({ s }: { s: ProofSummary }) {
  const items: [string, string][] = [
    [s.putIn, "put in together"],
    [s.spent, "spent on the plan"],
    [s.paidOut, "paid back out"],
    [s.settleTime.value, s.settleTime.label],
    [String(s.spends), s.spends === 1 ? "spend" : "spends"],
    [`${s.days} ${s.days === 1 ? "day" : "days"}`, s.dates],
  ];
  return (
    <dl className="m-0 grid grid-cols-2 gap-2.5">
      {items.map(([v, l]) => (
        <div key={l} className="rounded-2xl border border-line bg-surface px-4 py-3.5">
          <dt className="sr-only">{l}</dt>
          <dd className="m-0 font-display text-[clamp(22px,2.4vw,28px)] leading-none font-extrabold tracking-[-0.02em] tnum">{v}</dd>
          <dd className="m-0 mt-1.5 text-[13px] leading-snug text-muted">{l}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProofCard({ s }: { s: ProofSummary }) {
  return (
    <div className="grid gap-2 rounded-[22px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <span className="font-semibold">Settled on {chainName(statsChainId())}</span>
          <span className="text-[13px] text-muted">
            {s.settledOn} · {s.settledAt}
          </span>
        </div>
        {s.txUrl ? (
          <a
            href={s.txUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-4 text-sm font-semibold text-ink no-underline hover:brightness-95"
          >
            Proof <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </div>
      <p className="m-0 text-[13px] text-pretty text-muted">
        {s.transactions === 1 ? "Everyone was paid in one transaction. " : ""}Every number on this page can be checked
        in public. Proof opens the settle-up on the Monad explorer.
      </p>
    </div>
  );
}

export default async function ProofPage({ params }: Props) {
  const { pot } = await params;
  const r = await loadProof(pot);
  if (r.state !== "ok") return <PlanUnavailable state={r.state} />;
  const s = summarize(r.data);

  if (!s.settled) {
    return (
      <div className="mx-auto grid max-w-[620px] justify-items-center gap-4 pt-12 text-center sm:pt-16">
        <span className="grid size-16 place-items-center rounded-full bg-surface-2 text-muted">
          <Clock className="size-7" aria-hidden="true" />
        </span>
        <h1 className="m-0 font-display text-[clamp(28px,6vw,40px)] leading-[1.06] font-extrabold tracking-[-0.03em] text-balance">
          This plan hasn’t settled up yet
        </h1>
        <p className="m-0 max-w-[460px] text-[17px] text-pretty text-muted">
          {s.people} {s.people === 1 ? "person" : "people"} · {s.dates}. The proof appears here once the group settles
          up.
        </p>
        <Link href="/" className="text-[15px] font-semibold text-ink underline underline-offset-2">
          What is Plans?
        </Link>
      </div>
    );
  }

  const band = `Settled · ${s.settledOn} · ${s.people} ${s.people === 1 ? "person" : "people"}${s.isDemo ? " · demo" : ""}`;
  return (
    <div className="mx-auto grid max-w-[1120px] gap-6 pt-10 pb-6 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-14">
      <div className="grid min-w-0 gap-5">
        <Band text={band} />
        <ProofHeadline headline={s.headline} className="text-[clamp(34px,5vw,60px)]" />
        <CountryRows s={s} />
        <ProofCard s={s} />
      </div>
      <div className="grid gap-4">
        <Stats s={s} />
        <NotShown text={PRIVATE_TEXT} />
        <div className="flex flex-wrap items-center gap-4 rounded-[22px] border border-line bg-surface p-5">
          <div className="grid min-w-[180px] flex-1 gap-0.5">
            <span className="font-semibold">Planning something?</span>
            <span className="text-[13px] text-muted">One pot, rules you agree, settled in one tap.</span>
          </div>
          <Button href={DOWNLOAD_PATH} className="min-h-11 px-5 text-[15px]">
            Start a plan
          </Button>
        </div>
        <Link href="/" className="justify-self-center text-[15px] font-semibold text-ink underline underline-offset-2">
          What is Plans?
        </Link>
      </div>
    </div>
  );
}
