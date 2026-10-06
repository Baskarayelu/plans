/**
 * Hand-off between the Send screens: amount (45) → check (46) → receipt (47). Kept in memory only.
 */
import type { Address } from "viem";
import { rememberCode } from "../domain/planOps";
import { countryByCode, currencyFor } from "../domain/currency";
import { personFor } from "../state/data";
import { createStore } from "../state/observable";
import { getReceipt, putReceipt, type ReceiptData } from "../state/useAction";

export type Recipient = { address: Address; name: string; city?: string; country?: string; currency: string };

export type SendDraft = {
  to: Recipient;
  /** keypad text and mode, so the check screen can recompute with a fresher rate */
  text: string;
  inDollars: boolean;
  myCurrency: string;
};

export const sendDraft = createStore<SendDraft | null>(null);

/** Recipient from route params (a Plans code or a recent row), falling back to what we already know. */
export function recipientFrom(p: { to?: string; n?: string; c?: string; cc?: string; cur?: string }): Recipient | null {
  if (!p.to || !/^0x[0-9a-fA-F]{40}$/.test(p.to)) return null;
  const known = personFor(p.to);
  const country = (p.cc || known.country || undefined)?.toUpperCase();
  const cur = (p.cur || "").toUpperCase();
  const currency = cur && currencyFor(cur).code === cur ? cur : known.currency || countryByCode(country)?.currency || "USD";
  const name = p.n || known.name;
  const city = p.c || known.city;
  if (p.n) rememberCode(p.to, { name: p.n, city, country, currency });
  return { address: p.to.toLowerCase() as Address, name, city, country, currency };
}

/** "<City> · gets <currency plural>" (falls back to the country name). */
export function placeLine(r: { city?: string; country?: string; currency: string }): string {
  const place = r.city || countryByCode(r.country)?.name;
  const gets = `gets ${currencyFor(r.currency).plural}`;
  return place ? `${place} · ${gets}` : gets.charAt(0).toUpperCase() + gets.slice(1);
}

export type SendReceipt = ReceiptData & {
  kind: "send";
  to: Recipient;
  from: { name: string; city?: string; country?: string };
  myCurrency: string;
  myE8: string | null;
  usdUnits: string;
  theirE8: string | null;
  rateE8: string;
  fromCurrency: string;
  fxTimestamp: number;
  source?: string;
  note?: string;
};

export function putSendReceipt(r: Omit<SendReceipt, "kind">): void {
  putReceipt({ ...r, kind: "send" } as SendReceipt);
}

export function getSendReceipt(tx?: string): SendReceipt | undefined {
  const r = getReceipt(tx);
  return r && r.kind === "send" ? (r as SendReceipt) : undefined;
}
