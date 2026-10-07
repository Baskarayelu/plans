/**
 * Shareable settle-up (designs 134–137): the facts on the share card and the public proof link.
 *
 * Only public facts go on the card: how many people, which countries (each member's country as
 * recorded when they joined), the dollars put in and paid out, and how long settling took. No
 * names, notes, receipts or photos. The plan name appears only if the sharer opts in, and then it
 * travels in the link's fragment (#n=…), which browsers never send to a server:
 *
 *   https://plans.0xo.in/s/<pot>            public proof page (counts, countries, amounts)
 *   https://plans.0xo.in/s/<pot>#n=<name>   same page, name unlocked in the viewer's browser
 */
import { countryByCode, formatUsdShort } from "../domain/currency";

export type CardFlag = { code: string; flag: string; name: string; count: number };
export type CardStat = { value: string; label: string };

export type SettleCardInput = {
  pot: string;
  /** Every member who was ever in the plan (active and left), with their recorded country code. */
  members: { country?: string | null }[];
  /** Total put into the pot (AUSD units). */
  totalIn: bigint;
  /** Paid back out at settle-up (AUSD units). */
  paidOut: bigint;
  /** Measured time to settle, when this phone did it. */
  settleMs?: number;
  spendCount?: number;
  /** Unix seconds. */
  settledAt?: number;
  planName?: string;
  showName: boolean;
  host?: string;
};

export type SettleCard = {
  friends: number;
  countries: number;
  /** "4 friends · 3 countries · settled in one tap" */
  countLine: string;
  /** The big line: the count line, or the plan name when the sharer opted in. */
  headline: string;
  /** Under the headline when the name is shown; otherwise undefined. */
  subline?: string;
  flags: CardFlag[];
  /** Three tiles for the story card; the wide card uses the first and last. */
  stats: CardStat[];
  /** "SETTLED · 17 OCT" */
  dateTag: string;
  /** "SETTLED · SAT 17 OCT 2026" */
  dateBand: string;
  /** "UNITED KINGDOM · UNITED STATES · INDIA" */
  placesBand: string;
  url: string;
  /** "plans.0xo.in/s/0x7kq2…92b5" */
  displayUrl: string;
};

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "0.6 s" under 10 seconds, else whole seconds. */
export function settleSeconds(ms: number): string {
  if (ms < 10_000) return `${(Math.max(ms, 50) / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

/** Flags with counts, most people first, then by country name; unknown countries are left out. */
export function flagCounts(members: { country?: string | null }[]): CardFlag[] {
  const by = new Map<string, CardFlag>();
  for (const m of members) {
    const c = countryByCode(m.country);
    if (!c) continue;
    const f = by.get(c.code) ?? { code: c.code, flag: c.flag, name: c.name, count: 0 };
    f.count++;
    by.set(c.code, f);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function countLine(friends: number, countries: number): string {
  const parts = [plural(friends, "friend", "friends")];
  if (countries > 0) parts.push(plural(countries, "country", "countries"));
  parts.push("settled in one tap");
  return parts.join(" · ");
}

/** The public proof link. The plan name, when shared, goes after "#" so it never reaches a server. */
export function proofUrl(pot: string, opts: { name?: string; host?: string } = {}): string {
  const base = `https://${opts.host ?? "plans.0xo.in"}/s/${pot.toLowerCase()}`;
  const name = opts.name?.trim();
  return name ? `${base}#n=${encodeURIComponent(name)}` : base;
}

export function displayProofUrl(pot: string, host = "plans.0xo.in"): string {
  const p = pot.toLowerCase();
  return `${host}/s/${p.length > 12 ? `${p.slice(0, 6)}…${p.slice(-4)}` : p}`;
}

export function settleCard(i: SettleCardInput): SettleCard {
  const flags = flagCounts(i.members);
  const friends = i.members.length;
  const countries = flags.length;
  const line = countLine(friends, countries);
  const name = i.showName ? i.planName?.trim() : undefined;
  const d = i.settledAt ? new Date(i.settledAt * 1000) : null;
  const stats: CardStat[] = [
    { value: formatUsdShort(i.totalIn), label: "put in together" },
    { value: formatUsdShort(i.paidOut), label: "paid back out" },
    i.settleMs !== undefined
      ? { value: settleSeconds(i.settleMs), label: "to settle up" }
      : { value: String(i.spendCount ?? 0), label: i.spendCount === 1 ? "spend" : "spends" },
  ];
  return {
    friends,
    countries,
    countLine: line,
    headline: name || line,
    subline: name ? line : undefined,
    flags,
    stats,
    dateTag: d ? `SETTLED · ${d.getUTCDate()} ${MON[d.getUTCMonth()]}` : "SETTLED",
    dateBand: d ? `SETTLED · ${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "SETTLED IN ONE TAP",
    placesBand: flags.length ? flags.map((f) => f.name.toUpperCase()).join(" · ") : line.toUpperCase(),
    url: proofUrl(i.pot, { name, host: i.host }),
    displayUrl: displayProofUrl(i.pot, i.host),
  };
}

/** The message that goes with the image in the share sheet. */
export function shareMessage(card: SettleCard): string {
  return `${card.headline}${card.subline ? ` · ${card.subline}` : ""}\n${card.url}`;
}
