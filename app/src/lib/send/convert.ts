/**
 * Pure money maths for the Send screens: typed amount → dollars that move → what the other person
 * gets, reference-rate captions, receipt references and times. No React, no network.
 *
 * Conventions: AUSD base units (6 decimals, = US dollars) as bigint; local amounts in 1e8 fixed
 * point ("E8"); rates are 1e8 fixed point. `usdTo*` rates are units of that currency per 1 USD.
 */
import { currencyFor, formatFixed, formatRate, localE8ToUsd, parseAmount, usdToLocalE8 } from "../domain/currency";

export const E8 = 100_000_000n;

/** AUSD units (6 dp) → 1e8 fixed point. */
export const unitsToE8 = (u: bigint): bigint => u * 100n;
/** 1e8 fixed point → AUSD units (6 dp), floored. */
export const e8ToUnits = (e8: bigint): bigint => e8 / 100n;

/** Typed text in `currency` (its own decimals) → 1e8 fixed point. null when empty or invalid. */
export function textToE8(text: string, currency: string): bigint | null {
  const dec = currencyFor(currency).decimals;
  const v = parseAmount(text, dec);
  if (v === null) return null;
  return v * 10n ** BigInt(8 - dec);
}

/** 1e8 fixed point → keypad text with at most `currency` decimals (rounded half up, trailing zeros trimmed). */
export function e8ToText(e8: bigint, currency: string): string {
  const dec = currencyFor(currency).decimals;
  const div = 10n ** BigInt(8 - dec);
  const r = (e8 + div / 2n) / div;
  if (dec === 0) return r.toString();
  const s = r.toString().padStart(dec + 1, "0");
  const i = s.slice(0, -dec);
  const f = s.slice(-dec).replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
}

/** Formats a 1e8 amount in `currency`. */
export function fmtE8(e8: bigint, currency: string, opts: { sign?: boolean } = {}): string {
  return formatFixed(e8, 8, currency, opts);
}

export type QuoteInput = {
  /** keypad text */
  text: string;
  /** the keypad is in dollars (else in `myCurrency`) */
  inDollars: boolean;
  myCurrency: string;
  theirCurrency: string;
  /** USD → my currency (1e8); undefined while loading */
  usdToMy?: bigint;
  /** USD → their currency (1e8); undefined while loading */
  usdToTheir?: bigint;
};

export type Quote = {
  /** parsed keypad value is valid and positive */
  valid: boolean;
  /** dollars that move (AUSD units); null while a needed rate is loading */
  usdUnits: bigint | null;
  /** amount in my currency (1e8); null while loading */
  myE8: bigint | null;
  /** amount in their currency (1e8); null while loading */
  theirE8: bigint | null;
};

const rateFor = (cur: string, r?: bigint) => (cur === "USD" ? E8 : r);

/**
 * What a typed amount means: dollars that move, my money and their money. If my money isn't
 * dollars, my amount → dollars uses USD→mine (floored, so the sender never sends more than typed),
 * then dollars → theirs uses USD→theirs.
 */
export function quote(q: QuoteInput): Quote {
  const usdToMy = rateFor(q.myCurrency, q.usdToMy);
  const usdToTheir = rateFor(q.theirCurrency, q.usdToTheir);
  const dollars = q.inDollars || q.myCurrency === "USD";
  const typed = textToE8(q.text, dollars ? "USD" : q.myCurrency);
  const valid = typed !== null && typed > 0n;
  const typedE8 = typed ?? 0n;
  let usdUnits: bigint | null;
  let myE8: bigint | null;
  if (dollars) {
    usdUnits = e8ToUnits(typedE8);
    myE8 = usdToMy ? usdToLocalE8(usdUnits, usdToMy) : null;
  } else {
    myE8 = typedE8;
    usdUnits = usdToMy ? localE8ToUsd(typedE8, usdToMy) : null;
  }
  const theirE8 = usdUnits !== null && usdToTheir ? usdToLocalE8(usdUnits, usdToTheir) : null;
  return { valid, usdUnits, myE8, theirE8 };
}

/** "ECB" from "ECB reference rates via frankfurter.app". */
export function rateSource(source?: string): string {
  if (!source) return "Reference";
  if (/\bECB\b/.test(source)) return "ECB";
  return source.split(/\s+/)[0] || "Reference";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "14:05 UTC" for a unix time in seconds. */
export function utcHm(sec: number): string {
  const d = new Date(sec * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC". `rateE8` = `to` per 1 `from`. */
export function rateLine(from: string, to: string, rateE8: bigint, timestamp?: number, source?: string): string {
  const base = `Rate ${formatRate(from, to, rateE8)}`;
  return timestamp ? `${base} · ${rateSource(source)} ${utcHm(timestamp)}` : base;
}

/** "#7Q2-1405": first 3 and last 4 characters of the receipt id. */
export function shortRef(tx?: string | null): string {
  if (!tx) return "";
  const h = tx.replace(/^0x/i, "").toUpperCase();
  if (h.length < 8) return `#${h}`;
  return `#${h.slice(0, 3)}-${h.slice(-4)}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 13 Oct · 14:05:12" in the phone's local time (pass `offsetMin` = minutes east of UTC to fix the zone, for tests). */
export function whenText(ms: number, offsetMin?: number): string {
  const d = offsetMin === undefined ? new Date(ms) : new Date(ms + offsetMin * 60_000);
  const get = offsetMin === undefined
    ? { day: d.getDay(), date: d.getDate(), month: d.getMonth(), h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() }
    : { day: d.getUTCDay(), date: d.getUTCDate(), month: d.getUTCMonth(), h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds() };
  return `${DAYS[get.day]} ${get.date} ${MONTHS[get.month]} · ${pad(get.h)}:${pad(get.m)}:${pad(get.s)}`;
}

/** "14:05:12" local. */
export function hms(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** "UTC+1" / "UTC−4" / "UTC" for minutes east of UTC. */
export function utcOffsetLabel(offsetMin: number): string {
  if (offsetMin === 0) return "UTC";
  const sign = offsetMin > 0 ? "+" : "−";
  const a = Math.abs(offsetMin);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `UTC${sign}${h}${m ? `:${pad(m)}` : ""}`;
}

/** The phone's time zone short name ("EDT", "BST") when the runtime knows it, else "UTC−4". */
export function zoneLabel(ms: number): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date(ms));
    const z = parts.find((p) => p.type === "timeZoneName")?.value;
    if (z && !/^GMT[+-]/.test(z)) return z;
  } catch {
    /* no Intl time zones */
  }
  return utcOffsetLabel(-new Date(ms).getTimezoneOffset());
}

/**
 * Both sides of a recorded send. `rateE8` is the recorded reference rate (`to` per 1 `from`);
 * `usdToFrom` / `usdToTo` are today's rates, used only when neither side is dollars.
 */
export function sendSides(p: { usdUnits: bigint; from: string; to: string; rateE8: bigint; usdToFrom?: bigint; usdToTo?: bigint }): { fromE8: bigint | null; toE8: bigint | null } {
  const usdE8 = unitsToE8(p.usdUnits);
  let fromE8: bigint | null = null;
  let toE8: bigint | null = null;
  if (p.from === "USD") fromE8 = usdE8;
  if (p.to === "USD") toE8 = usdE8;
  if (fromE8 === null && p.to === "USD" && p.rateE8 > 0n) fromE8 = (usdE8 * E8) / p.rateE8;
  if (toE8 === null && p.from === "USD" && p.rateE8 > 0n) toE8 = (usdE8 * p.rateE8) / E8;
  if (fromE8 === null && p.usdToFrom) fromE8 = usdToLocalE8(p.usdUnits, p.usdToFrom);
  if (toE8 === null && fromE8 !== null && p.rateE8 > 0n) toE8 = (fromE8 * p.rateE8) / E8;
  if (toE8 === null && p.usdToTo) toE8 = usdToLocalE8(p.usdUnits, p.usdToTo);
  return { fromE8, toE8 };
}

/** UTF-8 length of a string. */
export function utf8Len(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** The private note rides in 24 bytes with the sender's name and city: how many bytes the note can use. */
export function noteBudget(name: string, city?: string): number {
  return Math.max(0, 24 - utf8Len(name) - 1 - utf8Len(city ?? "") - 1);
}

/** The part of `note` that fits in `budget` bytes (whole characters only). */
export function fitNote(note: string, budget: number): string {
  let out = "";
  let n = 0;
  for (const ch of note) {
    const l = utf8Len(ch);
    if (n + l > budget) break;
    out += ch;
    n += l;
  }
  return out;
}

/** Days left until `expirySec` (rounded up), 0 when past. */
export function daysLeft(expirySec: number, nowMs = Date.now()): number {
  const d = (expirySec * 1000 - nowMs) / 86_400_000;
  return d <= 0 ? 0 : Math.ceil(d);
}

/** "Tue 20 Oct". */
export function dayText(sec: number): string {
  const d = new Date(sec * 1000);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "14:05" today, else "28 Jun". */
export function rowTime(sec: number, nowMs = Date.now()): string {
  const d = new Date(sec * 1000);
  const n = new Date(nowMs);
  if (d.toDateString() === n.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function isToday(sec: number, nowMs = Date.now()): boolean {
  return new Date(sec * 1000).toDateString() === new Date(nowMs).toDateString();
}

/** Capitalised plural: "Pounds". */
export function pluralCap(currency: string): string {
  const p = currencyFor(currency).plural;
  return p.charAt(0).toUpperCase() + p.slice(1);
}
