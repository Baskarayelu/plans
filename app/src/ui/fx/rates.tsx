/**
 * Exchange rates on receipts (Group 2, designs 150–152): reading the reference round a receipt
 * recorded (or the one in effect when the money moved), Plans' quote as the fallback, the money in
 * both currencies at that rate, and the "Check this rate" sheet. Which rate wins and how it reads is
 * decided in lib/fx/receiptRate.ts.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { fetchFxRound, fetchFxRoundAt } from "../../lib/api/envio";
import { getFx, getFxRound } from "../../lib/api/relayer";
import { fxRoundById } from "../../lib/chain/rpc";
import { currencyFor, formatUsd } from "../../lib/domain/currency";
import {
  diffText,
  formatLocalAt,
  groupedRateLines,
  normCurrency,
  pairTexts,
  pickReceiptRate,
  quoteSourceName,
  rateLines,
  roundFromMap,
  roundFromRow,
  shareRateLine,
  sourceText,
  utcClockSec,
  type QuoteLike,
  type ReceiptRate,
  type RoundLike,
} from "../../lib/fx/receiptRate";
import { qk, type PlanVM } from "../../lib/state/data";
import { useColors } from "../../theme/ThemeProvider";
import { fonts } from "../../theme/tokens";
import { Icon } from "../Icon";
import { Btn, Card, Proof, Row } from "../kit";
import { Sheet } from "../layout";
import { Txt } from "../Text";

// ─────────────── reads ───────────────

const isRound = (id?: string | bigint | null) => id !== undefined && id !== null && String(id) !== "" && String(id) !== "0";

/** A round by id: the indexer, else FxReference itself, else the relayer's latest when it is that round. */
async function loadRoundById(id: string): Promise<RoundLike | null> {
  try {
    const row = await fetchFxRound(id);
    if (row) return roundFromRow(row);
  } catch {
    /* indexer not reachable: read the round itself */
  }
  try {
    const r = await fxRoundById(BigInt(id));
    if (r) return roundFromMap(r);
  } catch {
    /* no network read */
  }
  try {
    const info = await getFxRound();
    if (info && info.roundId === id) return roundFromMap(info);
  } catch {
    /* nothing more to try */
  }
  return null;
}

/** The round with `id` (rounds never change, so a found round is kept). */
export function useFxRoundById(id?: string | bigint | null) {
  const sid = isRound(id) ? String(id) : "";
  return useQuery({
    queryKey: ["fxRound", sid],
    enabled: !!sid,
    queryFn: () => loadRoundById(sid),
    staleTime: (q) => (q.state.data ? Infinity : 30_000),
    retry: 1,
  });
}

/** The round in effect at `atSec`: the indexer's newest at or before it, else the relayer's latest. */
export function useFxRoundAt(atSec?: number) {
  const minute = atSec ? Math.floor(atSec / 60) : 0;
  return useQuery({
    queryKey: ["fxRoundAt", minute],
    enabled: minute > 0,
    queryFn: async (): Promise<RoundLike | null> => {
      try {
        const row = await fetchFxRoundAt(minute * 60 + 59);
        if (row) return roundFromRow(row);
      } catch {
        /* fall back to the relayer's latest round */
      }
      try {
        const info = await getFxRound();
        if (info) return roundFromMap(info);
      } catch {
        /* none */
      }
      return null;
    },
    staleTime: 60_000,
    retry: 1,
  });
}

/** Plans' quotes USD → each currency (shared cache with useFx). Missing entries: not loaded or none. */
export function useFxQuotes(currencies: string[]) {
  const uniq = Array.from(new Set(currencies.map(normCurrency).filter((c) => c !== "USD")));
  const res = useQueries({
    queries: uniq.map((to) => ({
      queryKey: qk.fx(to),
      queryFn: async () => {
        const q = await getFx("USD", to);
        return { rateE8: BigInt(q.rateE8), timestamp: q.timestamp, source: q.source, date: q.date };
      },
      staleTime: 10 * 60_000,
    })),
  });
  const quotes: Record<string, QuoteLike> = {};
  uniq.forEach((c, i) => {
    const d = res[i]?.data;
    if (d) quotes[c] = d;
  });
  return { quotes, loading: res.some((r) => r.isLoading) };
}

/**
 * Rates USD → each currency for a receipt, with amounts at those rates:
 *   roundId given (a settle-up's recorded round, "0" = none) → that round, else Plans' quote;
 *   otherwise the round in effect at `atSec`, else Plans' quote.
 */
export function useReceiptRates({ currencies, atSec, roundId }: { currencies: string[]; atSec?: number; roundId?: string | null }) {
  const recorded = roundId !== undefined && roundId !== null;
  const byId = useFxRoundById(recorded ? roundId : null);
  const at = useFxRoundAt(recorded ? undefined : atSec);
  const { quotes, loading: quotesLoading } = useFxQuotes(currencies);
  const round = (recorded ? byId.data : at.data) ?? null;
  const roundLoading = recorded ? byId.isLoading : at.isLoading;
  const uniq = Array.from(new Set(currencies.map(normCurrency)));
  const rates: Record<string, ReceiptRate> = {};
  for (const cur of uniq) rates[cur] = pickReceiptRate({ from: "USD", to: cur, recorded: recorded ? { roundId } : undefined, round, atSec, quote: quotes[cur] });
  const loading = roundLoading || (quotesLoading && uniq.some((c) => rates[c].kind === "none"));
  /** Dollars in `cur` at this receipt's rate; undefined when there is none (or still loading). */
  const local = (units: bigint, cur: string, o: { sign?: boolean } = {}) => {
    const c = normCurrency(cur);
    if (c === "USD") return formatUsd(units, o);
    const r = rates[c];
    return loading || !r ? undefined : formatLocalAt(units, r, o);
  };
  /** Stub lines for the given currencies (all by default). */
  const lines = (only?: string[]): [string, string][] => {
    const list = (only ?? uniq).map(normCurrency).filter((c, i, a) => a.indexOf(c) === i);
    if (loading) return [["Rate", "Loading"]];
    return groupedRateLines(list.map((c) => rates[c]).filter(Boolean));
  };
  return { rates, local, lines, loading, round };
}

// ─────────────── "Check this rate" (152) ───────────────

export function CheckRateLink({ onPress, testID = "btn-check-rate" }: { onPress: () => void; testID?: string }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Check this rate" hitSlop={8} testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "center" }}>
      <Icon name="search" size={14} strokeWidth={2.2} color={c.info} />
      <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 13, color: c.info, textDecorationLine: "underline" }}>Check this rate</Txt>
    </Pressable>
  );
}

/** Whether a receipt with these rates has anything to check (not when it's dollars to dollars only). */
export const hasRateToCheck = (rates: ReceiptRate[]) => rates.some((r) => r.kind !== "same");

function KV({ k, v, tone }: { k: string; v: string; tone?: "pos" | "neg" }) {
  return (
    <Row between gap={12}>
      <Txt v="t15" color="muted">
        {k}
      </Txt>
      <Txt v="t15" weight="bold" color={tone ?? "ink"} style={{ flexShrink: 1, textAlign: "right" }}>
        {v}
      </Txt>
    </Row>
  );
}

function Point({ icon, children }: { icon: "globe" | "clock" | "info"; children: string }) {
  const c = useColors();
  return (
    <Row gap={8} align="flex-start">
      <View style={{ marginTop: 1 }}>
        <Icon name={icon} size={16} color={c.muted} />
      </View>
      <Txt v="t13" style={{ flex: 1 }}>
        {children}
      </Txt>
    </Row>
  );
}

function RateBlock({ r, usedAt, what }: { r: ReceiptRate; usedAt?: number; what?: string }) {
  const c = useColors();
  if (r.kind === "same") return null;
  const name = (cur: string) => currencyFor(cur).plural;
  const head = what ?? `${name(r.from).charAt(0).toUpperCase()}${name(r.from).slice(1)} to ${name(r.to)}`;
  const used = r.kind === "round" ? (r.appliedE8 ?? r.rateE8) : r.kind === "quote" ? r.rateE8 : undefined;
  const ref = r.kind === "round" ? r.rateE8 : undefined;
  const [usedText, refText] = pairTexts(r.from, r.to, [used ?? 0n, ref ?? 0n]);
  const ecb = r.kind === "quote" && quoteSourceName(r.source) === "ECB";
  return (
    <View style={{ gap: 8 }} testID={`rate-check-${r.from === "USD" ? r.to : r.from}`}>
      <Txt v="t13" color="muted">
        {head}
      </Txt>
      <Card style={{ gap: 6 }}>
        {r.kind === "none" ? (
          <KV k="Plans used" v="No rate" />
        ) : (
          <>
            <KV k="Plans used" v={usedText} />
            {r.kind === "round" ? <KV k="Reference" v={ref ? refText : "Loading"} /> : null}
            {r.kind === "round" && r.diffBps !== undefined ? <KV k="Difference" v={diffText(r.diffBps)} tone={r.diffBps === 0n ? "pos" : undefined} /> : null}
          </>
        )}
      </Card>
      <Card tint p={12}>
        <Txt style={{ fontFamily: fonts.mono, fontSize: 11, lineHeight: 20, color: c.ink }} testID="rate-check-source">
          {sourceText(r)}
          {r.kind === "round" && (r.at || usedAt) ? `\n${r.at ? `Published ${utcClockSec(r.at)}` : ""}${r.at && usedAt ? " · " : ""}${usedAt ? `used ${utcClockSec(usedAt)}` : ""}` : ""}
          {r.kind === "quote" && usedAt ? `\nUsed ${utcClockSec(usedAt)}` : ""}
        </Txt>
      </Card>
      <View style={{ gap: 8, marginTop: 4 }}>
        {r.kind === "round" ? (
          <>
            <Point icon="globe">Chainlink's workflow service gathers reference rates from the European Central Bank and other public sources, checks they agree, and writes each round to a public record. Anyone can look up this round.</Point>
            <Point icon="clock">{r.recorded ? "This round was recorded with the money. A payment can only name a round from the last 6 hours." : "Nothing was recorded with this one, so this is the round that was current when it happened (rounds count for 6 hours)."}</Point>
          </>
        ) : r.kind === "quote" ? (
          <Point icon="info">{`No public round covers this receipt, so this is the rate Plans quoted${ecb ? " from the European Central Bank's reference rates" : ""} at the time shown.`}</Point>
        ) : (
          <Point icon="info">This receipt has no reference rate recorded, so amounts are shown in dollars, the money that moved.</Point>
        )}
      </View>
      {r.kind === "round" && r.txHash ? (
        <Row between style={{ marginTop: 4 }}>
          <Txt v="t13" color="muted">
            Look it up yourself
          </Txt>
          <Proof hash={r.txHash} testID="proof-rate-round" />
        </Row>
      ) : null}
    </View>
  );
}

/** 152: the rate used, its public reference (round and times), the difference, and where to check it. */
export function CheckRateSheet({ visible, onClose, rates, usedAt, subtitle }: { visible: boolean; onClose: () => void; rates: ReceiptRate[]; usedAt?: number; subtitle?: string }) {
  const shown = rates.filter((r) => r.kind !== "same");
  return (
    <Sheet visible={visible} onClose={onClose} testID="sheet-check-rate">
      <Txt v="d22">Check this rate</Txt>
      {subtitle ? (
        <Txt v="t13" color="muted" style={{ marginTop: 4 }}>
          {subtitle}
        </Txt>
      ) : null}
      <View style={{ gap: 20, marginTop: 12 }}>
        {shown.map((r) => (
          <RateBlock key={`${r.from}-${r.to}`} r={r} usedAt={usedAt} what={shown.length > 1 ? `Dollars to ${currencyFor(r.to).plural}` : undefined} />
        ))}
      </View>
      <Btn label="Done" kind="sec" onPress={onClose} style={{ marginTop: 16 }} testID="btn-rate-done" />
    </Sheet>
  );
}

/** Link + sheet in one, for a receipt. Renders nothing when there's no exchange to check. */
export function CheckRate({ rates, usedAt, subtitle, style }: { rates: ReceiptRate[]; usedAt?: number; subtitle?: string; style?: object }) {
  const [open, setOpen] = useState(false);
  if (!hasRateToCheck(rates)) return null;
  return (
    <View style={style}>
      <CheckRateLink onPress={() => setOpen(true)} />
      <CheckRateSheet visible={open} onClose={() => setOpen(false)} rates={rates} usedAt={usedAt} subtitle={subtitle} />
    </View>
  );
}

export { rateLines };

// ─────────────── settle-up (151) ───────────────

/**
 * Rates for a plan's settle-up receipt: the round its `Settled` event recorded (`fxRoundId`, "0" =
 * none, then Plans' quote), for every member's currency. `override` is the round from a settle this
 * phone just made, before the indexer has it. `cardLine` is the one line the share card carries.
 */
export function useSettleRates(plan: PlanVM | undefined, override?: { fxRoundId?: string }) {
  const s = plan?.raw.settlements[0];
  const roundId = override?.fxRoundId ?? s?.fxRoundId ?? null;
  const atSec = s?.timestamp ?? plan?.raw.settledAt ?? undefined;
  const people = Object.values(plan?.people ?? {});
  const rr = useReceiptRates({ currencies: people.map((p) => p.currency), roundId, atSec: atSec ?? undefined });
  const meCur = plan?.me ? plan.people[plan.me]?.currency : undefined;
  const cardCur = [meCur, ...people.map((p) => p.currency)].map((c) => (c ? normCurrency(c) : "")).find((c) => c && c !== "USD");
  /** "Paid out $112.40 = £83.43 · 1 GBP = 1.3472 USD · Chainlink-fed reference rate, round 41, 7 Oct 10:42 UTC" */
  const cardLine = (paidOut: bigint): string | undefined => {
    if (!cardCur || rr.loading) return undefined;
    const r = rr.rates[cardCur];
    if (!r || r.kind === "none") return undefined;
    const local = rr.local(paidOut, cardCur);
    return [local ? `Paid out ${formatUsd(paidOut)} = ${local}` : null, shareRateLine(r)].filter(Boolean).join(" · ");
  };
  return { ...rr, cardLine };
}
