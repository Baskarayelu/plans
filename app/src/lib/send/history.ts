/**
 * Turns the indexer's account history (sends, links, payouts, contributions) and plan activity into
 * one sorted list of rows for the balance screen (09) and Activity (52). Pure: names and plan
 * titles are added by the screens.
 */
import type { ActivityRow, ClaimRow, PayoutRow, SendRow } from "../api/envio";

export type AccountHistory = {
  Activity: ActivityRow[];
  sendsIn: SendRow[];
  sendsOut: SendRow[];
  claimsIn: ClaimRow[];
  claimsOut: ClaimRow[];
  payouts: (PayoutRow & { pot_id: string })[];
};

export type MoneyKind = "sendIn" | "sendOut" | "claimIn" | "linkOut" | "linkBack" | "payout" | "contributed" | "debtPaid";

export type MoneyRow = {
  id: string;
  kind: MoneyKind;
  /** unix seconds */
  at: number;
  /** signed AUSD units: positive in, negative out */
  usd: bigint;
  counterparty?: string;
  pot?: string;
  tx: string;
  send?: SendRow;
  claim?: ClaimRow;
};

const lc = (s?: string | null) => (s ?? "").toLowerCase();
const big = (s?: string | null) => {
  try {
    return BigInt(s ?? "0");
  } catch {
    return 0n;
  }
};

export function moneyRows(d: AccountHistory | undefined, me?: string): MoneyRow[] {
  if (!d) return [];
  const out: MoneyRow[] = [];
  const m = lc(me);
  for (const s of d.sendsIn ?? []) {
    if (lc(s.from_id) === m && lc(s.to_id) === m) continue;
    out.push({ id: `in:${s.id}`, kind: "sendIn", at: s.timestamp, usd: big(s.amount), counterparty: lc(s.from_id), tx: s.txHash, send: s });
  }
  for (const s of d.sendsOut ?? []) {
    if (lc(s.from_id) === m && lc(s.to_id) === m) continue;
    out.push({ id: `out:${s.id}`, kind: "sendOut", at: s.timestamp, usd: -big(s.amount), counterparty: lc(s.to_id), tx: s.txHash, send: s });
  }
  const claimTx = new Map<string, string>();
  for (const a of d.Activity ?? []) if (a.kind === "Claimed" && a.ref) claimTx.set(lc(a.ref), a.txHash);
  for (const c of d.claimsIn ?? []) {
    out.push({ id: `cin:${c.id}`, kind: "claimIn", at: c.claimedAt ?? c.createdAt, usd: big(c.amount), counterparty: lc(c.source), tx: claimTx.get(lc(c.id)) ?? c.txHash, claim: c });
  }
  for (const c of d.claimsOut ?? []) {
    out.push({ id: `cout:${c.id}`, kind: "linkOut", at: c.createdAt, usd: -big(c.amount), tx: c.txHash, claim: c, counterparty: c.recipient_id ? lc(c.recipient_id) : undefined });
    if (c.status === "Refunded" && c.refundedAt) out.push({ id: `cback:${c.id}`, kind: "linkBack", at: c.refundedAt, usd: big(c.amount), tx: c.txHash, claim: c });
  }
  for (const p of d.payouts ?? []) {
    out.push({ id: `pay:${p.txHash}:${p.pot_id}`, kind: "payout", at: p.timestamp, usd: big(p.amount), pot: lc(p.pot_id), tx: p.txHash });
  }
  for (const a of d.Activity ?? []) {
    if (a.kind === "Contributed") out.push({ id: `act:${a.id}`, kind: "contributed", at: a.timestamp, usd: -big(a.amount), pot: lc(a.pot_id), tx: a.txHash });
    else if (a.kind === "DebtPaid") out.push({ id: `act:${a.id}`, kind: "debtPaid", at: a.timestamp, usd: -big(a.amount), pot: lc(a.pot_id), tx: a.txHash });
  }
  return out.sort((x, y) => y.at - x.at || (x.id < y.id ? 1 : -1));
}

/** Distinct people I sent to, newest first (address, last currency/country used). */
export function recentRecipients(d: AccountHistory | undefined, me?: string): { address: string; currency?: string; country?: string; at: number }[] {
  const seen = new Map<string, { address: string; currency?: string; country?: string; at: number }>();
  const m = lc(me);
  for (const s of [...(d?.sendsOut ?? [])].sort((a, b) => b.timestamp - a.timestamp)) {
    const a = lc(s.to_id);
    if (!a || a === m || seen.has(a)) continue;
    seen.set(a, { address: a, currency: s.toCurrency ?? undefined, country: s.toCountry ?? undefined, at: s.timestamp });
  }
  return [...seen.values()];
}

export type PlanEventKind = "SpendExecuted" | "Contributed" | "Settled" | "MemberJoined" | "DebtRecorded";
const PLAN_KINDS = new Set<string>(["SpendExecuted", "Contributed", "Settled", "MemberJoined", "DebtRecorded"]);

export type PlanRow = { id: string; kind: PlanEventKind; at: number; pot: string; who?: string; usd?: bigint; tx: string; ref?: string | null };

/**
 * Plan events worth showing in Activity, from each plan's feed. My own contributions are already
 * money rows; other people joining or adding money, spends and settle-ups are plan rows.
 */
export function planRows(rows: (ActivityRow & { pot_id?: string | null })[], me?: string, potOf?: (r: ActivityRow) => string | undefined): PlanRow[] {
  const m = lc(me);
  const out: PlanRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!PLAN_KINDS.has(r.kind) || seen.has(r.id)) continue;
    const who = r.account_id ? lc(r.account_id) : undefined;
    if (r.kind === "Contributed" && who === m) continue;
    if (r.kind === "MemberJoined" && who === m) continue;
    if (r.kind === "DebtRecorded" && who !== m) continue;
    const pot = lc(potOf?.(r) ?? r.pot_id);
    if (!pot) continue;
    seen.add(r.id);
    out.push({ id: r.id, kind: r.kind as PlanEventKind, at: r.timestamp, pot, who, usd: r.amount ? big(r.amount) : undefined, tx: r.txHash, ref: r.ref });
  }
  return out.sort((x, y) => y.at - x.at);
}
