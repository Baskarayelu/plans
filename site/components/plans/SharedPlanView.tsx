"use client";

// plans.0xo.in/v/<pot>#s=<invite secret>&n=<inviter>: a read-only view of a plan for people who aren't
// members yet (design 122–124). Counts, dates, the pot total and the rules come from the public record.
// The plan's name and emoji are encrypted; they are opened HERE, in this browser, with the invite secret
// from the part of the link after "#". Browsers never send that part to a server, and this page never
// logs, stores or transmits it: it is read from window.location, used, and handed only to the Android
// intent when the visitor taps "Join with fingerprint".

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { EyeOff, Fingerprint, Link2, Lock, LockOpen, User } from "lucide-react";
import { intentUrl } from "@/components/links/OpenInApp";
import { AskButton } from "./AskButton";
import { WebAppButton } from "./WebAppButton";
import { inviteSecretFrom, parseFragment, unlockPlan, wipe, type PlanMeta } from "@/lib/plans-crypto";
import type { SharedPlan } from "@/lib/plans-data";
import { DOWNLOAD_PATH } from "@/lib/site";
import { cn } from "@/lib/utils";

export type SharedFacts = {
  dates: string;
  endShort: string;
  days: number;
  pot: string; // formatted dollars
  people: number;
  countries: { flag: string; count: number; name: string }[];
  countryCount: number;
  rules: string[];
  ended: boolean;
  full: boolean;
};

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
const getHash = () => window.location.hash;
const getServerHash = () => null;

type View =
  | { kind: "pending" }
  | { kind: "missing" }
  | { kind: "off" }
  | { kind: "ok"; meta: PlanMeta | null };

const NOT_SHOWN_MEMBERS = "Names, who paid for what, what anything was for, receipts, photos, notes, and anyone’s balance. Only members see those, after they join.";

export function NotShown({ text = NOT_SHOWN_MEMBERS }: { text?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2 px-4 py-3.5">
      <div className="flex items-center gap-2 font-semibold">
        <EyeOff className="size-[18px] text-muted" aria-hidden="true" /> Not shown here
      </div>
      <p className="mt-1.5 mb-0 text-[14px] text-pretty text-muted">{text}</p>
    </div>
  );
}

function FragmentNote() {
  return (
    <p className="m-0 text-xs text-pretty text-muted">
      The plan name is unlocked in this browser by the part of the link after “#”. Browsers never send that part to
      Plans, so our servers can’t read it.
    </p>
  );
}

function Avatars({ countries }: { countries: SharedFacts["countries"] }) {
  const people = countries.flatMap((c) => Array.from({ length: c.count }, () => c.flag)).slice(0, 8);
  return (
    <span className="flex" aria-hidden="true">
      {people.map((f, i) => (
        <span
          key={i}
          className={cn(
            "relative grid size-10 place-items-center rounded-full border-2 border-surface bg-[#7a8a99] text-white",
            i > 0 && "-ml-2",
          )}
        >
          <User className="size-5" />
          {f ? <b className="absolute -right-1 -bottom-1 text-[15px] leading-none">{f}</b> : null}
        </span>
      ))}
    </span>
  );
}

function PlanCard({ facts, view, big }: { facts: SharedFacts; view: View; big?: boolean }) {
  const meta = view.kind === "ok" ? view.meta : null;
  const color = meta?.color ?? "#7a8a99";
  const name = meta?.name ?? (view.kind === "pending" ? "Unlocking…" : "A plan on Plans");
  const status =
    view.kind === "pending" ? (
      <>
        <Lock className="size-3.5" aria-hidden="true" /> Unlocking the name in this browser…
      </>
    ) : meta ? (
      <>
        <LockOpen className="size-3.5" aria-hidden="true" /> Name unlocked in this browser
      </>
    ) : (
      <>
        <Lock className="size-3.5" aria-hidden="true" /> The name stays locked without the whole link
      </>
    );
  return (
    <div className="overflow-hidden rounded-[22px] border border-line bg-surface shadow-card">
      <div
        className="flex h-9 items-center gap-2 px-4 font-mono text-[11.5px] font-semibold tracking-[.08em] text-[#10231b] uppercase"
        style={{ background: `repeating-linear-gradient(90deg, ${color} 0 14px, color-mix(in srgb, ${color} 82%, #fff) 14px 16px)` }}
      >
        <span className="truncate">
          {facts.dates} · {facts.days} {facts.days === 1 ? "day" : "days"}
        </span>
      </div>
      <div className="grid gap-4 p-5">
        <div className="flex items-center gap-3.5">
          <span
            className={cn("grid flex-none place-items-center rounded-2xl", big ? "size-14 text-[30px]" : "size-12 text-[26px]")}
            style={{ background: `color-mix(in srgb, ${color} 28%, var(--surface))` }}
            aria-hidden="true"
          >
            {meta?.emoji ?? "🔒"}
          </span>
          <div className="grid min-w-0 gap-1">
            <div
              className={cn(
                "font-display leading-[1.05] font-extrabold tracking-[-0.025em] break-words",
                big ? "text-[clamp(26px,3vw,34px)]" : "text-[22px]",
                !meta && "text-muted",
              )}
            >
              {name}
            </div>
            <div className="flex items-center gap-1.5 text-[13px] text-muted">{status}</div>
          </div>
          {facts.ended ? (
            <span className="ml-auto flex-none self-start rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs font-semibold">
              Ended {facts.endShort}
            </span>
          ) : null}
        </div>
        <dl className="m-0 flex flex-wrap gap-x-7 gap-y-3">
          <div>
            <dt className="font-mono text-[11px] font-semibold tracking-[.08em] text-muted uppercase">Dates</dt>
            <dd className="m-0 mt-1 font-semibold">{facts.dates}</dd>
          </div>
          <div>
            <dt className="font-mono text-[11px] font-semibold tracking-[.08em] text-muted uppercase">In the pot</dt>
            <dd className="m-0 mt-1 font-semibold tnum">{facts.pot}</dd>
          </div>
          <div>
            <dt className="font-mono text-[11px] font-semibold tracking-[.08em] text-muted uppercase">People</dt>
            <dd className="m-0 mt-1 font-semibold">
              {facts.people} · {facts.countryCount} {facts.countryCount === 1 ? "country" : "countries"}
            </dd>
          </div>
        </dl>
        {facts.people > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Avatars countries={facts.countries} />
            <span className="text-[13px] text-muted">
              {facts.countries.map((c, i) => (
                <span key={i} title={c.name}>
                  {i > 0 ? " · " : ""}
                  {c.flag || "🏳️"} {c.count}
                </span>
              ))}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Rules({ rules, twoCol }: { rules: string[]; twoCol?: boolean }) {
  return (
    <section aria-labelledby="rules-title" className="grid gap-3">
      <h2 id="rules-title" className="m-0 font-mono text-xs font-semibold tracking-[.08em] text-muted uppercase">
        The rules, in plain words
      </h2>
      <ul className={cn("m-0 grid list-none gap-2.5 p-0", twoCol && "lg:grid-cols-2 lg:gap-x-6")}>
        {rules.map((r) => (
          <li key={r} className="flex items-start gap-2.5 text-[15px]">
            <span aria-hidden="true" className="mt-0.5 font-bold text-pos">
              ✓
            </span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Item 124: the messenger cut the link before "#…", or the end is damaged. Public facts still show. */
function MissingSecret({ facts }: { facts: SharedFacts }) {
  return (
    <div className="mx-auto grid max-w-[560px] gap-5 pt-12 text-center sm:pt-16">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-surface-2 text-muted">
        <Link2 className="size-7" aria-hidden="true" />
      </span>
      <h1 className="m-0 font-display text-[clamp(28px,6vw,40px)] leading-[1.06] font-extrabold tracking-[-0.03em] text-balance">
        This link is missing its last part
      </h1>
      <p className="m-0 text-[17px] text-pretty text-muted">
        Some messaging apps cut long links. Without the end of it we can’t unlock the plan’s name, and you can’t join.
      </p>
      <div className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-4 text-left">
        <span className="grid size-12 flex-none place-items-center rounded-2xl bg-surface-2 text-[24px]" aria-hidden="true">
          🔒
        </span>
        <div className="grid gap-0.5">
          <span className="font-semibold">A plan on Plans</span>
          <span className="text-[14px] text-muted">
            {facts.people} {facts.people === 1 ? "person" : "people"} · {facts.countryCount}{" "}
            {facts.countryCount === 1 ? "country" : "countries"} · {facts.ended ? "ended" : "ends"} {facts.endShort}
          </span>
        </div>
      </div>
      <div className="grid gap-2">
        <AskButton label="Ask for the whole link" message="Can you send the Plans link again? Mine was cut off." />
        <Link href="/" className="inline-flex min-h-12 items-center justify-center text-base font-semibold text-ink no-underline hover:underline">
          What is Plans?
        </Link>
      </div>
    </div>
  );
}

/** Link turned off (a member made a new link): design 14b's copy. */
function LinkOff({ facts, inviter }: { facts: SharedFacts; inviter?: string }) {
  return (
    <div className="mx-auto grid max-w-[560px] gap-5 pt-12 text-center sm:pt-16">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-surface-2 text-muted">
        <Link2 className="size-7" aria-hidden="true" />
      </span>
      <h1 className="m-0 font-display text-[clamp(28px,6vw,40px)] leading-[1.06] font-extrabold tracking-[-0.03em] text-balance">
        This invite has stopped working
      </h1>
      <p className="m-0 text-[17px] text-pretty text-muted">
        {inviter ?? "Someone in the plan"} turned off this link and made a new one. Nothing was charged.
      </p>
      <PlanCard facts={facts} view={{ kind: "missing" }} />
      <AskButton
        label={inviter ? `Ask ${inviter} for a new link` : "Ask for a new link"}
        message="The Plans link you sent me has stopped working. Can you send the new one?"
      />
    </div>
  );
}

export function SharedPlanView({ plan, facts }: { plan: SharedPlan; facts: SharedFacts }) {
  const hash = useSyncExternalStore(subscribe, getHash, getServerHash);

  const view: View = useMemo(() => {
    if (hash === null) return { kind: "pending" };
    const secret = inviteSecretFrom(hash);
    if (!secret) return { kind: "missing" };
    try {
      const r = unlockPlan({
        pot: plan.pot,
        secret,
        meta: plan.meta,
        inviteKeyWrap: plan.inviteKeyWrap,
        inviteSigner: plan.inviteSigner,
        signerWraps: plan.signerWraps,
      });
      if (r.state === "rotated") return { kind: "off" };
      if (r.state === "failed") return { kind: "missing" };
      return { kind: "ok", meta: r.meta };
    } finally {
      wipe(secret);
    }
  }, [hash, plan]);

  const inviter = useMemo(() => {
    const n = hash ? parseFragment(hash).n?.trim() : undefined;
    return n ? n.slice(0, 40) : undefined;
  }, [hash]);

  if (view.kind === "missing") return <MissingSecret facts={facts} />;
  if (view.kind === "off") return <LinkOff facts={facts} inviter={inviter} />;

  const ready = view.kind === "ok";
  const name = view.kind === "ok" && view.meta ? view.meta.name : "this plan";
  const canJoin = !facts.ended && !facts.full;

  let join: React.ReactNode;
  if (!canJoin) {
    join = facts.full ? (
      <>
        <p className="m-0 rounded-xl bg-surface-2 px-3 py-2.5 text-[15px] font-semibold">This plan is full (50 people).</p>
        <AskButton label={inviter ? `Ask ${inviter} for a new plan` : "Ask for a new plan"} message="That Plans plan is full. Could you start a new one?" />
      </>
    ) : (
      <>
        <p className="m-0 rounded-xl bg-surface-2 px-3 py-2.5 text-[15px] font-semibold">This plan ended on {facts.endShort}.</p>
        <AskButton
          label={inviter ? `Ask ${inviter} for a new plan` : "Ask for a new plan"}
          message="That Plans plan has ended. Want to start a new one?"
        />
      </>
    );
  } else {
    join = (
      <>
        {ready && hash ? (
          <a
            href={intentUrl(`/j/${plan.pot}${hash}`)}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent px-[22px] text-base font-semibold text-on-accent no-underline shadow-[inset_0_-2px_0_rgba(16,35,27,.18)] hover:brightness-105"
          >
            <Fingerprint className="size-5" aria-hidden="true" /> Join with fingerprint
          </a>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-surface-2 px-[22px] text-base font-semibold text-muted"
          >
            <Fingerprint className="size-5" aria-hidden="true" /> Join with fingerprint
          </span>
        )}
        <WebAppButton label="Continue in your browser" className="w-full" />
        <p className="m-0 text-[13px] text-pretty text-muted">
          Join with fingerprint opens the Plans app on Android. No app yet?{" "}
          <Link href={DOWNLOAD_PATH} className="font-semibold text-ink underline underline-offset-2">
            Get the Android app
          </Link>
          , then tap this link again. Joining asks you to add money only if you want to.
        </p>
      </>
    );
  }

  return (
    <div className="mx-auto grid max-w-[1080px] gap-8 pt-10 pb-6 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-14">
      <div className="grid min-w-0 gap-6">
        <div className="grid gap-3">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--info)_35%,var(--line))] bg-[color-mix(in_srgb,var(--info)_10%,transparent)] px-2.5 py-1.5 text-[13px] font-semibold text-info">
            <Link2 className="size-3.5" aria-hidden="true" /> Invitation · read-only
          </span>
          <h1 className="m-0 font-display text-[clamp(30px,4.6vw,48px)] leading-[1.04] font-extrabold tracking-[-0.03em] text-balance">
            {inviter ? `${inviter} invited you to a plan` : "You’re invited to a plan"}
          </h1>
        </div>
        <PlanCard facts={facts} view={view} big />
        <Rules rules={facts.rules} twoCol />
      </div>
      <aside className="grid gap-4 lg:sticky lg:top-24">
        <div className="grid gap-3 rounded-[22px] border border-line bg-surface p-6 shadow-card">
          <h2 className="m-0 font-display text-[22px] leading-tight font-bold tracking-[-0.02em] break-words">
            {canJoin ? `Join ${name}` : facts.full ? "No room left" : "This plan has ended"}
          </h2>
          {canJoin ? (
            <p className="m-0 text-[15px] text-pretty text-muted">
              You’ll see who’s in, every spend and every receipt once you join.
            </p>
          ) : null}
          {join}
        </div>
        <NotShown />
        <FragmentNote />
      </aside>
    </div>
  );
}
