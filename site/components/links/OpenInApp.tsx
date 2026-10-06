"use client";

// Fallback for plans.0xo.in/j/… (invites), /c/… (claim links) and /p/… (Plans codes) when the app isn't installed
// or the link opened in a browser. The secret after "#" is read from window.location only, in this browser:
// URL fragments are never sent to a server (not in requests, not in Referer), and this page never logs,
// stores or transmits it. It is only placed into the intent:// URL handed to Android when the user taps the button.

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Smartphone, ShieldCheck } from "lucide-react";
import { CopyButton } from "@/components/site/CopyButton";
import { ANDROID_PACKAGE, DOWNLOAD_PATH, SITE_HOST, SITE_URL } from "@/lib/site";

export type LinkKind = "j" | "c" | "p";

const COPY: Record<LinkKind, { badge: string; title: string; body: string; needsSecret: boolean; pasteHint: string }> = {
  j: {
    badge: "Plan invite",
    title: "You’re invited to a plan",
    body: "Open this invite in the Plans app to see the plan, who’s in and its rules, then join with one fingerprint.",
    needsSecret: true,
    pasteHint: "or copy the link and paste it into Plans › Join.",
  },
  c: {
    badge: "Money link",
    title: "Someone sent you money",
    body: "Open this link in the Plans app and confirm with your fingerprint to claim it. New to Plans? Your account is made in the same step.",
    needsSecret: true,
    pasteHint: "or copy the link and paste it into Plans.",
  },
  p: {
    badge: "Plans code",
    title: "Send money to a friend",
    body: "This is someone’s Plans code. Open it in the Plans app to send them digital dollars, wherever they live.",
    needsSecret: false,
    pasteHint: "or copy the link and paste it into Plans › Send.",
  },
};

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
const getHref = () => window.location.pathname + window.location.search + window.location.hash;
const getHasHash = () => window.location.hash.length > 1;
const getServer = () => null;

export function intentUrl(pathAndHash: string) {
  const fallback = encodeURIComponent(`${SITE_URL}${DOWNLOAD_PATH}`);
  // Android's Intent.parseUri splits at the LAST '#', so a fragment in the data part survives.
  return `intent://${SITE_HOST}${pathAndHash}#Intent;scheme=https;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;
}

export function OpenInApp({ kind }: { kind: LinkKind }) {
  const c = COPY[kind];
  const href = useSyncExternalStore(subscribe, getHref, getServer);
  const hasHash = useSyncExternalStore(subscribe, getHasHash, getServer);
  const ready = href !== null;
  const incomplete = ready && c.needsSecret && !hasHash;

  return (
    <div className="mx-auto grid max-w-[620px] gap-5 pt-12 sm:pt-16">
      <div className="relative isolate overflow-hidden rounded-[35px] border border-line bg-surface px-5 py-12 text-center sm:px-10">
        <div aria-hidden="true" className="dots-bg absolute inset-0 -z-10 opacity-70" />
        <div className="grid justify-items-center gap-4">
          <span className="rounded-full border border-line bg-surface-2 px-[11px] py-[7px] font-mono text-xs leading-none font-semibold tracking-[.08em] text-muted uppercase">
            {c.badge}
          </span>
          <h1 className="m-0 font-display text-[clamp(32px,7vw,48px)] leading-[1.04] font-extrabold tracking-[-0.03em] text-balance">
            {c.title}
          </h1>
          <p className="m-0 max-w-[460px] text-[17px] text-pretty text-muted">{c.body}</p>

          {incomplete ? (
            <p role="alert" className="m-0 rounded-xl bg-[color-mix(in_srgb,var(--neg)_10%,transparent)] px-3 py-2.5 text-sm font-semibold text-neg">
              This link looks incomplete: the part after “#” is missing. Ask for the link again and open it from the
              message.
            </p>
          ) : null}

          <div className="mt-2 grid w-full gap-3 sm:w-auto sm:grid-flow-col">
            {ready && !incomplete ? (
              <a
                href={intentUrl(href)}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-accent px-[22px] text-base font-semibold text-on-accent no-underline shadow-[inset_0_-2px_0_rgba(16,35,27,.18)] hover:brightness-105"
              >
                <Smartphone className="size-[18px]" aria-hidden="true" /> Open in Plans
              </a>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-surface-2 px-[22px] text-base font-semibold text-muted"
              >
                <Smartphone className="size-[18px]" aria-hidden="true" /> Open in Plans
              </span>
            )}
            <Link
              href={DOWNLOAD_PATH}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-surface px-[22px] text-base font-semibold text-ink no-underline hover:bg-surface-2"
            >
              Get the app
            </Link>
          </div>
          {ready && !incomplete ? (
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted">
              <CopyButton value={`${SITE_URL}${href}`} label="Copy link" />
              <span>{c.pasteHint}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 rounded-[22px] border border-line bg-surface p-6">
        <h2 className="m-0 font-display text-xl font-bold tracking-[-0.02em]">Don’t have Plans yet?</h2>
        <ol className="m-0 grid list-none gap-3 p-0 text-[15px]">
          {[
            "Get the Android app from the download page. It takes about a minute.",
            "Come back to the message with this link and tap it again. It opens in Plans.",
            "Confirm with your fingerprint. That’s your account, done.",
          ].map((t, i) => (
            <li key={t} className="grid grid-cols-[28px_1fr] items-start gap-3">
              <span className="grid size-7 place-items-center rounded-full bg-surface-2 font-mono text-[13px] font-semibold">
                {i + 1}
              </span>
              <span className="pt-0.5 text-muted">{t}</span>
            </li>
          ))}
        </ol>
        <p className="m-0 flex items-start gap-2 text-sm text-muted">
          <ShieldCheck className="mt-0.5 size-4 flex-none text-pos" aria-hidden="true" />
          {kind === "p"
            ? "Android 9 or newer with a screen lock. iPhone comes later."
            : "The secret part of this link (after “#”) stays on this phone: browsers never send it to any server, and this page doesn’t store it."}
        </p>
      </div>
    </div>
  );
}
