/**
 * What backs the digital dollar (designs 140–141): the latest monthly reserves attestation, bundled
 * as attestation.json and updated by hand when Agora publishes a new one, plus Agora's live public
 * supply figures for Monad (GET https://api.agora.finance/v0/metrics). The live figure is optional:
 * any failure hides it and the static text stays.
 */
import attestation from "./attestation.json";

export type Attestation = { date: string; firm: string; url: string };

export const ATTESTATION: Attestation = attestation;
export const AGORA_METRICS_URL = "https://api.agora.finance/v0/metrics";
export const AGORA_DATA_DOCS_URL = "https://docs.agora.finance/api";
const MONAD_CAIP2 = "eip155:143";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");

/** "2026-08-31" → "31 Aug 2026" (calendar date, no time zone shift); "" when it isn't a date. */
export function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return "";
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${d} ${MON[mo - 1]} ${m[1]}`;
}

/** "Attested 31 Aug 2026 (Grant Thornton)". */
export function attestationLine(a: Attestation = ATTESTATION): string {
  const day = formatDay(a.date);
  return day ? `Attested ${day} (${a.firm})` : `Attested by ${a.firm}`;
}

export type MonadSupply = {
  /** Dollars in circulation on Monad. */
  circulating: number;
  /** Dollars issued on Monad. */
  total: number;
  /** When Agora's server answered (the response's Date header). */
  asOf?: Date;
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Picks Monad out of the metrics body. Returns null when the shape isn't what we expect. */
export function parseMetrics(body: unknown, dateHeader?: string | null): MonadSupply | null {
  if (!body || typeof body !== "object") return null;
  const chains = (body as { chains?: unknown }).chains;
  if (!Array.isArray(chains)) return null;
  const row = chains.find((c) => c && typeof c === "object" && ((c as { chainId?: unknown }).chainId === MONAD_CAIP2 || (c as { network?: unknown }).network === "monad")) as
    | { circulatingSupply?: unknown; totalSupply?: unknown }
    | undefined;
  if (!row) return null;
  const circulating = num(row.circulatingSupply);
  const total = num(row.totalSupply);
  if (circulating === null || total === null) return null;
  const d = dateHeader ? new Date(dateHeader) : null;
  return { circulating, total, asOf: d && !Number.isNaN(d.getTime()) ? d : undefined };
}

/** 140489319.97 → "$140.5 million"; 2.1e9 → "$2.1 billion"; 12345 → "$12,345". */
export function formatSupply(n: number): string {
  const one = (x: number) => {
    const s = (Math.round(x * 10) / 10).toFixed(1);
    return s.endsWith(".0") ? s.slice(0, -2) : s;
  };
  if (n >= 1e9) return `$${one(n / 1e9)} billion`;
  if (n >= 1e6) return `$${one(n / 1e6)} million`;
  return `$${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** "7 Oct 2026, 09:15 UTC". */
export function formatAsOf(d: Date): string {
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}

/** Fetches Agora's public figures for Monad. Throws on any failure; callers stay quiet. */
export async function fetchMonadSupply(fetchImpl: typeof fetch = fetch, timeoutMs = 8_000): Promise<MonadSupply> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(AGORA_METRICS_URL, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`metrics ${r.status}`);
    const parsed = parseMetrics(await r.json(), r.headers.get("date"));
    if (!parsed) throw new Error("metrics shape");
    return parsed;
  } finally {
    clearTimeout(t);
  }
}
