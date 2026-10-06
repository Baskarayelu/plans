/**
 * Settled plan memory (screen 41): stats, "Where it went" bars, and the CSV summary. Pure, plus
 * one GraphQL query for every executed spend (the plan detail only carries the latest 40).
 */
import { gql } from "../api/envio";
import { categoryOf } from "../domain/rules";

export type SpendLite = { spendId: string; kind: "PAY" | "LINK" | "PERSONAL"; proposer_id: string; amount: string; category: number; memo: string; executedAt?: number | null; proposedAt?: number; status?: string; txHash?: string };

const Q_ALL_SPENDS = `query AllSpends($pot: String!, $chainId: Int!) {
  Spend(where: { pot_id: { _eq: $pot }, chainId: { _eq: $chainId }, status: { _eq: "Executed" } }, order_by: { executedAt: asc }, limit: 1000) {
    spendId kind proposer_id amount category memo executedAt proposedAt status txHash
  }
}`;

export async function fetchExecutedSpends(pot: string): Promise<SpendLite[]> {
  return (await gql<{ Spend: SpendLite[] }>(Q_ALL_SPENDS, { pot: pot.toLowerCase() })).Spend;
}

export function biggestSpend<T extends { amount: string }>(spends: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const s of spends) if (!best || BigInt(s.amount) > BigInt(best.amount)) best = s;
  return best;
}

export type CategoryBar = { category: number; label: string; amount: bigint; pct: number };

/** Categories with money spent (net of refunds), largest first, bar widths relative to the largest. */
export function categoryBars(rows: readonly { category: number; spent: string; refunded?: string }[]): CategoryBar[] {
  const items = rows
    .map((r) => ({ category: r.category, amount: BigInt(r.spent) - BigInt(r.refunded ?? "0") }))
    .filter((r) => r.amount > 0n)
    .sort((a, b) => (a.amount === b.amount ? a.category - b.category : a.amount > b.amount ? -1 : 1));
  const max = items[0]?.amount ?? 0n;
  return items.map((r) => {
    const c = categoryOf(r.category);
    return { category: r.category, label: `${c.emoji} ${c.name}`, amount: r.amount, pct: max > 0n ? Number((r.amount * 1000n) / max) / 10 : 0 };
  });
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function dollars(units: bigint): string {
  const neg = units < 0n;
  const a = neg ? -units : units;
  const cents = (a + 5_000n) / 10_000n;
  return `${neg ? "-" : ""}${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export type CsvRow = { at?: number | null; who: string; kind: string; category: number; amount: bigint; note?: string };

/** Spends as CSV: date (UTC), who, kind, category, amount in dollars, note. */
export function spendsCsv(rows: readonly CsvRow[]): string {
  const head = ["Date (UTC)", "Who", "Kind", "Category", "Amount (USD)", "Note"];
  const lines = rows.map((r) => {
    const d = r.at ? new Date(r.at * 1000).toISOString().slice(0, 16).replace("T", " ") : "";
    return [d, r.who, r.kind, categoryOf(r.category).name, dollars(r.amount), r.note ?? ""].map(csvCell).join(",");
  });
  return [head.join(","), ...lines].join("\n");
}

export function kindWord(kind: string): string {
  return kind === "PERSONAL" ? "Paid themselves" : kind === "LINK" ? "Paid by link" : "Paid from the pot";
}
