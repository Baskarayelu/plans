import Link from "next/link";
import { CloudOff, SearchX, Link2Off } from "lucide-react";
import type { LoadState } from "@/lib/plans-data";

const COPY: Record<Exclude<LoadState, "ok">, { icon: typeof CloudOff; title: string; body: string }> = {
  unconfigured: {
    icon: CloudOff,
    title: "We can’t load this plan right now",
    body: "This page reads the plan from the public record on Monad, and that lookup isn’t available at the moment. Please try again later.",
  },
  unreachable: {
    icon: CloudOff,
    title: "We can’t load this plan right now",
    body: "This page reads the plan from the public record on Monad, and that lookup didn’t answer. Try again in a minute.",
  },
  "not-found": {
    icon: SearchX,
    title: "We couldn’t find this plan",
    body: "The link may be mistyped, or the plan is very new and not on the public record yet. Try again in a minute.",
  },
  invalid: {
    icon: Link2Off,
    title: "This doesn’t look like a Plans link",
    body: "The address after plans.0xo.in should be a long code starting with 0x. Ask for the link again.",
  },
};

export function PlanUnavailable({ state, children }: { state: Exclude<LoadState, "ok">; children?: React.ReactNode }) {
  const c = COPY[state];
  const Icon = c.icon;
  return (
    <div className="mx-auto grid max-w-[620px] gap-5 pt-12 sm:pt-16">
      <div role="status" className="relative isolate grid justify-items-center gap-4 overflow-hidden rounded-[35px] border border-line bg-surface px-5 py-12 text-center sm:px-10">
        <div aria-hidden="true" className="dots-bg absolute inset-0 -z-10 opacity-70" />
        <span className="grid size-16 place-items-center rounded-full bg-surface-2 text-muted">
          <Icon className="size-7" aria-hidden="true" />
        </span>
        <h1 className="m-0 font-display text-[clamp(28px,6vw,40px)] leading-[1.06] font-extrabold tracking-[-0.03em] text-balance">
          {c.title}
        </h1>
        <p className="m-0 max-w-[460px] text-[17px] text-pretty text-muted">{c.body}</p>
        {children}
        <Link href="/" className="text-[15px] font-semibold text-ink underline underline-offset-2">
          What is Plans?
        </Link>
      </div>
    </div>
  );
}
