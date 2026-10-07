import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import release from "@/public/release.json";
import { Badge, PageShell } from "@/components/ui/primitives";
import { CopyButton } from "@/components/site/CopyButton";
import { QrCode } from "@/components/plans/QrCode";
import { WebAppButton } from "@/components/plans/WebAppButton";
import { DOWNLOAD_PATH, GITHUB_URL, SITE_HOST, SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Download for Android",
  description: "Download the Plans Android test version (APK), check its SHA-256, and install it in a minute.",
};

type Apk = (typeof release.apks)[number] & { sha256: string | null; sizeBytes: number | null };

function mb(bytes: number | null) {
  return bytes ? `${(bytes / 1_048_576).toFixed(1)} MB` : null;
}

function ApkCard({ apk, live }: { apk: Apk; live: boolean }) {
  const size = mb(apk.sizeBytes);
  return (
    <div className="grid min-w-0 content-start gap-4 rounded-[22px] border border-line bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 font-display text-2xl leading-tight font-bold tracking-[-0.02em]">{apk.label}</h2>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 font-mono text-[11px] leading-none font-semibold uppercase",
            apk.id === "mainnet" ? "border-transparent bg-accent text-on-accent" : "border-line bg-surface-2 text-muted",
          )}
        >
          {apk.network}
        </span>
      </div>
      <p className="m-0 text-[15px] text-muted">
        {apk.description} <span className="font-mono text-[13px] whitespace-nowrap text-ink">{apk.file}</span>
      </p>
      {live ? (
        <a
          href={apk.url}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent px-[22px] text-base font-semibold text-on-accent no-underline shadow-[inset_0_-2px_0_rgba(16,35,27,.18)] hover:brightness-105 sm:w-fit"
        >
          <Download className="size-[18px]" aria-hidden="true" /> Download {apk.file}
          {size ? <span className="font-mono text-xs font-medium opacity-75">{size}</span> : null}
        </a>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-dashed border-line bg-surface-2 px-[22px] text-base font-semibold text-muted sm:w-fit"
        >
          <Download className="size-[18px]" aria-hidden="true" /> {apk.id === "mainnet" ? "Available after launch" : "Available at release"}
        </span>
      )}
      <div className="grid gap-1.5">
        <span className="font-mono text-xs font-semibold tracking-[.06em] text-muted uppercase">SHA-256</span>
        {apk.sha256 ? (
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-[12.5px] leading-relaxed break-all">
              {apk.sha256}
            </code>
            <CopyButton value={apk.sha256} />
          </div>
        ) : (
          <code className="rounded-xl border border-dashed border-line bg-surface-2 px-3 py-2 font-mono text-[12.5px] text-muted">
            Pending: published with the release
          </code>
        )}
      </div>
    </div>
  );
}

const STEPS = [
  {
    t: "Download on your phone",
    d: "Open this page on the Android phone you'll use and tap Download. Your browser may warn that this type of file can be harmful: tap Download anyway.",
  },
  {
    t: "Allow your browser to install apps",
    d: "Open the downloaded file. Android asks for permission the first time: tap Settings, turn on Allow from this source, then go back.",
  },
  { t: "Install", d: "Tap Install." },
  {
    t: "If Google Play Protect warns you",
    d: "Plans isn't in the Play Store yet, so Play Protect may say the developer is unrecognised. Tap More details, then Install anyway.",
  },
  {
    t: "Open Plans and create your account",
    d: "Tap Create account and confirm with your screen lock. If Android asks where to save the passkey, choose Google Password Manager.",
  },
];

const REQUIREMENTS = [
  { t: "Android 9 or newer", d: "Android 10 or newer is recommended. iPhone comes later." },
  { t: "A Google account", d: "Signed in on the phone. Your passkey is saved there, so a new phone restores everything." },
  { t: "A screen lock", d: "PIN, fingerprint or face. It's what you confirm with." },
  {
    t: "Google Password Manager as the passkey provider",
    d: "Plans needs a passkey feature (PRF) that some other password managers don't support. Check under Settings › Passwords & accounts.",
  },
];

export default function DownloadPage() {
  const live = release.status === "live";
  const apks = release.apks as Apk[];
  return (
    <PageShell>
      <div className="grid justify-items-center gap-3.5 text-center">
        <Badge>{live ? "Android test version" : "Android"}</Badge>
        <h1 className="m-0 font-display text-[clamp(36px,5.4vw,60px)] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance">
          Get Plans for Android
        </h1>
        <p className="m-0 max-w-[620px] text-lg text-pretty text-muted">
          {live
            ? "The test version runs on Monad testnet with free test dollars. It installs straight from this page in about a minute. No SIM, VPN or local account needed."
            : "Plans installs straight from this page in about a minute. No SIM, VPN or local account needed."}
        </p>
      </div>

      <div
        role="status"
        className={cn(
          "mx-auto mt-8 max-w-[860px] rounded-2xl border px-4 py-3 text-center text-[15px]",
          live
            ? "border-[color-mix(in_srgb,var(--pos)_40%,var(--line))] bg-[color-mix(in_srgb,var(--pos)_10%,transparent)]"
            : "border-[color-mix(in_srgb,var(--accent)_60%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]",
        )}
      >
        {live ? (
          <>
            <b>Version {release.version}</b>
            {release.publishedAt ? <> · published {release.publishedAt}</> : null} ·{" "}
            <a href={release.notes} className="underline underline-offset-2">
              release notes
            </a>
          </>
        ) : (
          <>
            <b>First release pending.</b> The download buttons and SHA-256
            fingerprints appear here when it is published.
          </>
        )}
      </div>

      {/* Computers (133): the APK is no use on this machine, so lead with a QR that opens this page on the phone. */}
      <section
        aria-labelledby="qr-title"
        className="mx-auto mt-6 hidden max-w-[1000px] items-center gap-7 rounded-[22px] border border-line bg-surface p-6 desktop:flex"
      >
        <div className="flex-none rounded-2xl border border-line bg-white p-2.5">
          <QrCode value={`${SITE_URL}${DOWNLOAD_PATH}`} size={168} label={`QR code that opens ${SITE_HOST}${DOWNLOAD_PATH}`} />
        </div>
        <div className="grid flex-1 gap-2">
          <span className="font-mono text-xs font-semibold tracking-[.08em] text-muted uppercase">On a computer?</span>
          <h2 id="qr-title" className="m-0 font-display text-2xl font-bold tracking-[-0.02em]">
            Scan to download on your phone
          </h2>
          <p className="m-0 text-[15px] text-pretty text-muted">
            Opens this page on your Android phone, where the file installs. iPhone or no phone to hand? Plans in your
            browser is coming soon.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <WebAppButton />
            <span className="font-mono text-[13px] text-muted">
              {SITE_HOST}
              {DOWNLOAD_PATH}
            </span>
          </div>
        </div>
      </section>

      <div className="mx-auto mt-6 grid max-w-[1000px] grid-cols-1 gap-4 min-[861px]:grid-cols-2">
        {apks.map((a) => (
          <ApkCard key={a.id} apk={a} live={live && !!a.sha256} />
        ))}
      </div>
      <p className="mx-auto mt-4 flex max-w-[1000px] flex-wrap items-center justify-center gap-3 text-[15px] text-muted desktop:hidden">
        No Android phone? <WebAppButton className="min-h-10 px-4 text-sm" />
      </p>
      <p className="mx-auto mt-4 max-w-[1000px] text-sm text-muted">
        Check the file before installing (optional): on a computer run{" "}
        <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] break-all">shasum -a 256 plans.apk</code>{" "}
        and compare it with the SHA-256 above. Both builds are produced from the public source at{" "}
        <a href={GITHUB_URL} className="text-ink underline underline-offset-2">
          github.com/Baskarayelu/plans
        </a>
        .
      </p>

      <div className="mx-auto mt-14 grid max-w-[1000px] grid-cols-1 gap-4 min-[861px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section aria-labelledby="install-title" className="self-start rounded-[22px] border border-line bg-surface p-6">
          <h2 id="install-title" className="m-0 font-display text-2xl font-bold tracking-[-0.02em]">
            Install in five steps
          </h2>
          <ol className="mt-5 mb-0 grid list-none gap-5 p-0">
            {STEPS.map((s, i) => (
              <li key={s.t} className="grid grid-cols-[32px_1fr] gap-3">
                <span className="grid size-8 place-items-center rounded-full bg-surface-2 font-mono text-sm font-semibold">
                  {i + 1}
                </span>
                <div className="grid gap-1">
                  <h3 className="m-0 text-base font-semibold">{s.t}</h3>
                  <p className="m-0 text-[15px] text-muted">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid content-start gap-4">
          <section aria-labelledby="req-title" className="rounded-[22px] border border-line bg-surface p-6">
            <h2 id="req-title" className="m-0 font-display text-2xl font-bold tracking-[-0.02em]">
              What you need
            </h2>
            <ul className="mt-4 mb-0 grid list-none gap-3.5 p-0">
              {REQUIREMENTS.map((r) => (
                <li key={r.t} className="grid gap-0.5">
                  <span className="font-semibold">{r.t}</span>
                  <span className="text-[15px] text-muted">{r.d}</span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="help-title" className="rounded-[22px] border border-line bg-surface p-6">
            <h2 id="help-title" className="m-0 font-display text-2xl font-bold tracking-[-0.02em]">
              If something fails
            </h2>
            <ul className="mt-4 mb-0 grid list-none gap-3.5 p-0 text-[15px]">
              <li>
                <span className="font-semibold">“Passkey not supported”</span>
                <span className="block text-muted">
                  Make Google Password Manager your passkey provider, then try again.
                </span>
              </li>
              <li>
                <span className="font-semibold">An invite opens in the browser</span>
                <span className="block text-muted">
                  Tap Open in Plans on that page, or copy the link and paste it into Plans › Join.
                </span>
              </li>
            </ul>
            <p className="mt-4 mb-0 text-[15px] text-muted">
              More in the{" "}
              <Link href="/docs/getting-started" className="text-ink underline underline-offset-2">
                getting started guide
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
