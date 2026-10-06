// Traction stats, read live from the Envio HyperIndex GraphQL endpoint.
// Definitions: docs/traction.md and indexer/README.md "Metric definitions". Query: indexer/queries/stats.graphql.
// Never invents numbers: if the endpoint is unset, unreachable or has no GlobalStats row yet, callers get a
// non-"ok" state and show "Counting starts at launch".

export const STATS_REVALIDATE_SECONDS = 60;

const STATS_QUERY = /* GraphQL */ `
  query Stats($chainId: Int!) {
    GlobalStats(where: { id: { _eq: "global" }, chainId: { _eq: $chainId } }) {
      users
      accounts
      potsCreated
      fundedPots
      medianMembersPerPot
      medianCountriesPerPot
      ttffaSamples
      medianTtffaLowerSeconds
      medianTtffaUpperSeconds
      spends
      spendVolume
      approvals
      settlements
      settledVolume
      sends
      sendVolume
      claims
      claimVolume
      crossBorderVolume
      crossBorderCount
      contributionVolume
      allPots
      demoPots
      updatedAt
    }
    DailyStats(where: { chainId: { _eq: $chainId } }, order_by: { day: asc }) {
      date
      newUsers
      potsCreated
      fundedPots
      spends
      approvals
      settlements
      settledVolume
      sendVolume
      crossBorderVolume
    }
    Corridor(
      where: { chainId: { _eq: $chainId }, isCrossBorder: { _eq: true }, count: { _gt: 0 } }
      order_by: { volume: desc }
    ) {
      fromCountry
      toCountry
      volume
      count
      sendVolume
      claimVolume
      potVolume
    }
    Account(
      where: { chainId: { _eq: $chainId }, ttffaCounted: { _eq: true } }
      order_by: { timeToFirstFundedAction: asc }
    ) {
      timeToFirstFundedAction
    }
  }
`;

type Num = number | string;

export interface GlobalStats {
  users: number;
  accounts: number;
  potsCreated: number;
  fundedPots: number;
  medianMembersPerPot: number;
  medianCountriesPerPot: number;
  ttffaSamples: number;
  medianTtffaLowerSeconds: number;
  medianTtffaUpperSeconds: number;
  spends: number;
  spendVolume: Num;
  approvals: number;
  settlements: number;
  settledVolume: Num;
  sends: number;
  sendVolume: Num;
  claims: number;
  claimVolume: Num;
  crossBorderVolume: Num;
  crossBorderCount: number;
  contributionVolume: Num;
  allPots: number;
  demoPots: number;
  updatedAt: number;
}

export interface DailyRow {
  date: string;
  newUsers: number;
  potsCreated: number;
  fundedPots: number;
  spends: number;
  approvals: number;
  settlements: number;
  settledVolume: Num;
  sendVolume: Num;
  crossBorderVolume: Num;
}

export interface CorridorRow {
  fromCountry: string;
  toCountry: string;
  volume: Num;
  count: number;
  sendVolume: Num;
  claimVolume: Num;
  potVolume: Num;
}

export type StatsState = "unconfigured" | "unreachable" | "empty" | "ok";

export interface StatsResult {
  state: StatsState;
  chainId: number;
  global: GlobalStats | null;
  daily: DailyRow[];
  corridors: CorridorRow[];
  /** exact median of Account.timeToFirstFundedAction over counted accounts, seconds */
  ttffaMedianSeconds: number | null;
  fetchedAt: number;
}

export function statsChainId(): number {
  const n = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 143);
  return Number.isFinite(n) && n > 0 ? n : 143;
}

export function chainName(chainId: number): string {
  if (chainId === 143) return "Monad mainnet";
  if (chainId === 10143) return "Monad testnet";
  return `chain ${chainId}`;
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

export async function getStats(): Promise<StatsResult> {
  const chainId = statsChainId();
  const base: StatsResult = {
    state: "unconfigured",
    chainId,
    global: null,
    daily: [],
    corridors: [],
    ttffaMedianSeconds: null,
    fetchedAt: Date.now(),
  };
  const url = process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL?.trim();
  if (!url) return base;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: STATS_QUERY, operationName: "Stats", variables: { chainId } }),
      next: { revalidate: STATS_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { ...base, state: "unreachable" };
    const json = (await res.json()) as {
      data?: {
        GlobalStats?: GlobalStats[];
        DailyStats?: DailyRow[];
        Corridor?: CorridorRow[];
        Account?: { timeToFirstFundedAction: number | null }[];
      };
      errors?: unknown;
    };
    if (json.errors || !json.data) return { ...base, state: "unreachable" };
    const g = json.data.GlobalStats?.[0] ?? null;
    const samples = (json.data.Account ?? [])
      .map((a) => a.timeToFirstFundedAction)
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);
    return {
      ...base,
      state: g ? "ok" : "empty",
      global: g,
      daily: json.data.DailyStats ?? [],
      corridors: json.data.Corridor ?? [],
      ttffaMedianSeconds: median(samples),
    };
  } catch {
    return { ...base, state: "unreachable" };
  }
}

// ───────────── formatting ─────────────

/** AUSD base units (6 decimals) → number of dollars. Precise enough for display. */
export function ausd(v: Num | null | undefined): number {
  if (v === null || v === undefined) return 0;
  try {
    const big = BigInt(typeof v === "number" ? Math.trunc(v) : String(v).split(".")[0]);
    const whole = big / BigInt(1_000_000);
    const frac = big % BigInt(1_000_000);
    return Number(whole) + Number(frac) / 1e6;
  } catch {
    return Number(v) / 1e6 || 0;
  }
}

export function formatUsd(dollars: number): string {
  const digits = dollars !== 0 && Math.abs(dollars) < 100 ? 2 : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(dollars);
}

export function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(seconds < 600 ? 1 : 0)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} days`;
}

export function flag(cc: string): string {
  if (!/^[A-Za-z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
