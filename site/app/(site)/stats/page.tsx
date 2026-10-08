import type { Metadata } from "next";
import { Badge, PageShell } from "@/components/ui/primitives";
import { DailyBars } from "@/components/stats/DailyBars";
import {
  ausd,
  chainName,
  flag,
  formatDuration,
  formatInt,
  formatUsd,
  getStats,
  type StatsResult,
} from "@/lib/stats";
import { apkDownloads } from "@/lib/github";
import { GITHUB_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Live stats",
  description: "Plans traction, read live from the Envio indexer on Monad. Demo and team accounts are excluded.",
};

export const revalidate = 60;

// Definitions: docs/traction.md (keep the two in sync).
const DEFS: Array<{ k: string; d: React.ReactNode }> = [
  {
    k: "Users (headline)",
    d: "Accounts that joined at least one counted plan, or sent or claimed at least one send that doesn't involve an internal account",
  },
  { k: "Accounts", d: <>Distinct addresses with a <code>KeyRegistered</code> event, excluding internal accounts. Secondary to Users.</> },
  { k: "Plans created", d: <><code>PotCreated</code> from the Plans factory, counted plans only</> },
  { k: "Funded plans", d: <>Counted plans with at least one <code>Contributed</code></> },
  { k: "Members per plan", d: "Active members at the end, or currently for open plans; median" },
  { k: "Countries per plan", d: "Distinct member country codes; median" },
  {
    k: "Time to first funded action",
    d: <>From an account&apos;s first <code>MemberJoined</code> (in a counted plan) to its first <code>Contributed</code>, <code>Sent</code> or <code>Claimed</code>; median, in seconds</>,
  },
  { k: "Spends", d: <><code>SpendExecuted</code></> },
  { k: "Approvals", d: <><code>Voted</code> with approve = true</> },
  { k: "Settlements and settled volume", d: <><code>Settled</code>, and the sum of its <code>Payout</code>s</> },
  {
    k: "Cross-border volume",
    d: "AUSD moved between accounts with different country codes, by country pair. Covers direct sends, claimed links (including a plan's link spends), settlement collections and debt payments.",
  },
  { k: "APK downloads (offchain)", d: "GitHub release asset download count" },
];

function Metric({
  label,
  value,
  note,
  big,
  live,
}: {
  label: string;
  value: string;
  note?: string;
  big?: boolean;
  live: boolean;
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5 rounded-[22px] border border-line bg-surface p-5", big && "p-7")}>
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span
        className={cn(
          "font-display leading-none font-extrabold tracking-[-0.03em] tnum",
          big ? "text-[clamp(56px,9vw,96px)]" : "text-[clamp(30px,3.4vw,40px)]",
          live ? "text-ink" : "text-muted",
        )}
      >
        {value}
      </span>
      {note ? <span className="font-mono text-xs leading-snug text-muted">{note}</span> : null}
    </div>
  );
}

function EmptyState({ stats }: { stats: StatsResult }) {
  const why =
    stats.state === "unconfigured"
      ? "The live indexer isn't connected to this page yet."
      : stats.state === "unreachable"
        ? "The indexer can't be reached right now, so no numbers are shown rather than old or estimated ones."
        : "The indexer is live, but nothing has been counted yet.";
  return (
    <div className="mt-8 grid justify-items-center gap-2 rounded-[22px] border border-dashed border-[color-mix(in_srgb,var(--accent)_60%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-5 py-7 text-center">
      <span className="font-display text-2xl font-bold tracking-[-0.02em]">Counting starts at launch</span>
      <p className="m-0 max-w-[560px] text-[15px] text-muted">
        {why} Plans reports only numbers that can be read onchain, from the moment its contracts go live on Monad
        mainnet. Until then every figure below shows a dash, never an estimate.
      </p>
    </div>
  );
}

export default async function StatsPage() {
  const [stats, downloads] = await Promise.all([getStats(), apkDownloads()]);
  const live = stats.state === "ok" && !!stats.global;
  const g = stats.global;
  const dash = "—";
  // Hasura may send numeric columns as strings (HASURA_GRAPHQL_STRINGIFY_NUMERIC_TYPES): coerce first.
  const n = (v: number | string | undefined) => (live && v !== undefined ? formatInt(Number(v)) : dash);
  const usd = (v: number | string | undefined) => (live && v !== undefined ? formatUsd(ausd(v)) : dash);
  const med = (v: number | string | undefined) => {
    const x = Number(v);
    return live && v !== undefined && Number.isFinite(x) ? (Number.isInteger(x) ? String(x) : x.toFixed(1)) : dash;
  };
  const ttffa =
    live && stats.ttffaMedianSeconds !== null
      ? formatDuration(stats.ttffaMedianSeconds)
      : live && g && g.ttffaSamples > 0
        ? `${formatDuration(g.medianTtffaLowerSeconds)}–${formatDuration(g.medianTtffaUpperSeconds)}`
        : dash;
  const daily = live ? stats.daily : [];

  return (
    <PageShell>
      <div className="grid justify-items-center gap-3.5 text-center">
        <Badge>Live traction</Badge>
        <h1 className="m-0 font-display text-[clamp(36px,5.4vw,60px)] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance">
          Plans, by the numbers
        </h1>
        <p className="m-0 max-w-[640px] text-lg text-pretty text-muted">
          Read live from the Plans indexer (Envio HyperIndex) on {chainName(stats.chainId)}. Only numbers that can be
          read onchain are reported. Demo accounts and team accounts are excluded from every figure.
        </p>
        {live && g ? (
          <span className="font-mono text-xs text-muted">
            Indexer updated {new Date(g.updatedAt * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC · page
            refreshes every minute
          </span>
        ) : null}
      </div>

      {!live ? <EmptyState stats={stats} /> : null}

      <div className="mt-8 grid grid-cols-1 gap-4 min-[761px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Metric big label="Users" value={n(g?.users)} live={live} note="Joined a real plan, or sent or claimed money" />
        <div className="grid grid-cols-2 gap-4">
          <Metric label="Accounts" value={n(g?.accounts)} live={live} />
          <Metric label="Plans created" value={n(g?.potsCreated)} live={live} />
          <Metric label="Funded plans" value={n(g?.fundedPots)} live={live} />
          <Metric
            label="APK downloads"
            value={downloads.state === "ok" ? formatInt(downloads.count) : dash}
            live={downloads.state === "ok"}
            note={downloads.state === "none" ? "offchain · no release yet" : "offchain · GitHub"}
          />
        </div>
      </div>

      <h2 className="mt-12 mb-4 font-display text-2xl font-bold tracking-[-0.02em]">Plans and people</h2>
      <div className="grid grid-cols-1 gap-4 min-[561px]:grid-cols-3">
        <Metric label="Members per plan (median)" value={med(g?.medianMembersPerPot)} live={live} />
        <Metric label="Countries per plan (median)" value={med(g?.medianCountriesPerPot)} live={live} />
        <Metric
          label="Time to first funded action (median)"
          value={ttffa}
          live={live}
          note={live && g ? `${formatInt(g.ttffaSamples)} accounts` : undefined}
        />
      </div>

      <h2 className="mt-12 mb-4 font-display text-2xl font-bold tracking-[-0.02em]">Money moving</h2>
      <div className="grid grid-cols-2 gap-4 min-[761px]:grid-cols-4">
        <Metric label="Spends" value={n(g?.spends)} live={live} />
        <Metric label="Approvals" value={n(g?.approvals)} live={live} />
        <Metric label="Settlements" value={n(g?.settlements)} live={live} />
        <Metric label="Settled volume" value={usd(g?.settledVolume)} live={live} />
      </div>

      <h2 className="mt-12 mb-4 font-display text-2xl font-bold tracking-[-0.02em]">Cross-border volume by country pair</h2>
      <div className="overflow-hidden rounded-[22px] border border-line bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
          <span className="font-semibold">Total across borders</span>
          <span className="font-display text-2xl font-extrabold tnum">
            {usd(g?.crossBorderVolume)}
            {live && g ? (
              <span className="ml-2 font-mono text-xs font-medium text-muted">{formatInt(g.crossBorderCount)} transfers</span>
            ) : null}
          </span>
        </div>
        {live && stats.corridors.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[15px]">
              <thead>
                <tr className="text-sm text-muted">
                  <th scope="col" className="px-5 py-3 font-semibold">Pair</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Volume</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Transfers</th>
                </tr>
              </thead>
              <tbody>
                {stats.corridors.map((c) => (
                  <tr key={`${c.fromCountry}-${c.toCountry}`} className="border-t border-line">
                    <td className="px-5 py-3 whitespace-nowrap">
                      {flag(c.fromCountry)} {c.fromCountry} → {flag(c.toCountry)} {c.toCountry}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tnum">{formatUsd(ausd(c.volume))}</td>
                    <td className="px-5 py-3 text-right font-mono tnum">{formatInt(c.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="m-0 px-5 py-6 text-[15px] text-muted">No cross-border transfers counted yet.</p>
        )}
      </div>

      <h2 className="mt-12 mb-4 font-display text-2xl font-bold tracking-[-0.02em]">Daily activity</h2>
      {daily.length ? (
        <>
          <div className="grid grid-cols-1 gap-4 min-[901px]:grid-cols-3">
            <DailyBars title="New users per day" points={daily.map((d) => ({ date: d.date, value: d.newUsers }))} format={formatInt} />
            <DailyBars title="Spends per day" points={daily.map((d) => ({ date: d.date, value: d.spends }))} format={formatInt} />
            <DailyBars
              title="Settled volume per day"
              points={daily.map((d) => ({ date: d.date, value: ausd(d.settledVolume) }))}
              format={formatUsd}
            />
          </div>
          <details className="mt-4 rounded-2xl border border-line bg-surface px-5 py-4">
            <summary className="cursor-pointer font-semibold">Show daily data as a table</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-left font-mono text-[13px] tnum">
                <thead>
                  <tr className="text-muted">
                    {["Day (UTC)", "New users", "Plans", "Funded", "Spends", "Approvals", "Settlements", "Settled", "Cross-border"].map((h) => (
                      <th key={h} scope="col" className="py-2 pr-4 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {daily.map((d) => (
                    <tr key={d.date} className="border-t border-line">
                      <td className="py-2 pr-4 whitespace-nowrap">{d.date}</td>
                      <td className="py-2 pr-4">{formatInt(d.newUsers)}</td>
                      <td className="py-2 pr-4">{formatInt(d.potsCreated)}</td>
                      <td className="py-2 pr-4">{formatInt(d.fundedPots)}</td>
                      <td className="py-2 pr-4">{formatInt(d.spends)}</td>
                      <td className="py-2 pr-4">{formatInt(d.approvals)}</td>
                      <td className="py-2 pr-4">{formatInt(d.settlements)}</td>
                      <td className="py-2 pr-4">{formatUsd(ausd(d.settledVolume))}</td>
                      <td className="py-2 pr-4">{formatUsd(ausd(d.crossBorderVolume))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="m-0 rounded-[22px] border border-line bg-surface px-5 py-6 text-[15px] text-muted">
          The daily chart appears with the first counted day.
        </p>
      )}

      <section aria-labelledby="defs-title" className="mt-14 rounded-[22px] border border-line bg-surface p-6">
        <h2 id="defs-title" className="m-0 font-display text-2xl font-bold tracking-[-0.02em]">
          What each number means
        </h2>
        <p className="mt-3 mb-0 text-[15px] text-muted">
          <b className="text-ink">Excluded from every metric:</b> the demo accounts (Ben, Asha, Maya), our team accounts
          (treasury, deployer, test phones), every plan created by a team account, and every plan any demo account has
          joined. The list is{" "}
          <a href={`${GITHUB_URL}/blob/main/indexer/internal-accounts.json`} className="text-ink underline underline-offset-2">
            indexer/internal-accounts.json
          </a>
          . If a demo account joins a plan after it was counted, the plan&apos;s numbers are withdrawn. All metrics come
          from the Envio indexer, except APK downloads.
        </p>
        <dl className="mt-5 mb-0 grid gap-0 [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px]">
          {DEFS.map((d) => (
            <div key={d.k} className="grid gap-1 border-t border-line py-3 min-[761px]:grid-cols-[260px_1fr] min-[761px]:gap-6">
              <dt className="font-semibold">{d.k}</dt>
              <dd className="m-0 text-[15px] text-muted">{d.d}</dd>
            </div>
          ))}
        </dl>
      </section>
    </PageShell>
  );
}
