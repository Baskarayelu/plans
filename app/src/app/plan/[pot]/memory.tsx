/** 41 Settled plan memory: a keepsake summary of a settled plan, with a CSV of every spend. */
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Share, View } from "react-native";
import { formatUsd, formatUsdShort } from "../../../lib/domain/currency";
import { categoryOf } from "../../../lib/domain/rules";
import { biggestSpend, categoryBars, fetchExecutedSpends, kindWord, spendsCsv } from "../../../lib/ending/memory";
import { usePlan } from "../../../lib/state/data";
import { getReceipt } from "../../../lib/state/useAction";
import { dayMonth, personOf, PlanProblem, PlanSkeleton, spendNote, Stat } from "../../../ui/ending/common";
import { Band, Banner, Bar, Btn, Card, DemoTag, IconBtn, Overline, Row, Skel } from "../../../ui/kit";
import { AppBar, Bleed, Screen } from "../../../ui/layout";
import { dateRange } from "../../../ui/planBits";
import { People } from "../../../ui/plan/common";
import { SettleShareSheet } from "../../../ui/share/SettleShareSheet";
import { Txt } from "../../../ui/Text";
import { DeskColumn } from "../../../ui/desk/plan";
import { useLayout } from "../../../ui/shell/responsive";
import { CheckRate, useSettleRates } from "../../../ui/fx/rates";
import { fonts } from "../../../theme/tokens";

export default function PlanMemory() {
  const { desk } = useLayout();
  const { pot } = useLocalSearchParams<{ pot: string }>();
  const q = usePlan(pot);
  const spendsQ = useQuery({ queryKey: ["allSpends", (pot ?? "").toLowerCase()], queryFn: () => fetchExecutedSpends(pot!), enabled: !!pot, staleTime: 60_000 });
  const [sharing, setSharing] = useState(false);
  const fx = useSettleRates(q.data ?? undefined);

  if (q.isLoading) return <PlanSkeleton />;
  if (q.isError || !q.data) return <PlanProblem missing={!q.isError} onRetry={() => void q.refetch()} />;
  const plan = q.data;
  const d = plan.raw;
  const dates = dateRange(Number(d.startTime), Number(d.endTime));
  const settledAt = d.settledAt ?? d.settlements[0]?.timestamp;
  const settleMs = getReceipt(d.settlements[0]?.txHash)?.settledMs;
  const members = d.members.map((m) => personOf(plan, m.address)).filter((p): p is NonNullable<typeof p> => !!p);
  const countries = new Set(d.members.map((m) => m.country).filter(Boolean)).size;
  const spends = spendsQ.data ?? [];
  const big = biggestSpend(spends);
  const bars = categoryBars(d.categorySpends);
  const total = BigInt(d.totalSpent ?? "0");
  // The money in my currency too, at the rate the settle-up recorded (else Plans' quote), and those rates.
  const meCur = plan.me ? plan.people[plan.me]?.currency : undefined;
  const totalLocal = meCur && meCur !== "USD" ? fx.local(total, meCur) : undefined;
  const memberCurrencies = members.map((p) => p.currency);
  const rateRows = fx.lines(memberCurrencies);
  const memoryRates = Array.from(new Set(memberCurrencies)).map((c) => fx.rates[c]).filter(Boolean);

  const csv = () =>
    spendsCsv(
      spends.map((s) => ({
        at: s.executedAt ?? s.proposedAt,
        who: personOf(plan, s.proposer_id)?.name ?? "Friend",
        kind: kindWord(s.kind),
        category: s.category,
        amount: BigInt(s.amount),
        note: spendNote(plan, s) ?? "",
      })),
    );
  const download = () => void Share.share({ title: `${plan.meta.name} · spends`, message: csv() }).catch(() => undefined);
  const shareSummary = () =>
    void Share.share({
      title: plan.meta.name,
      message: `${plan.meta.emoji} ${plan.meta.name}, ${dates}: ${formatUsd(total)} spent together across ${d.spendCount ?? spends.length} spends, settled${settledAt ? ` ${dayMonth(settledAt)}` : ""}.`,
    }).catch(() => undefined);

  return (
    <Screen
      testID="screen-memory"
      refreshing={q.isRefetching}
      onRefresh={() => {
        void q.refetch();
        void spendsQ.refetch();
      }}
      dock={desk ? undefined : <>
          <Btn label="Download summary" kind="sec" icon="download" disabled={!spendsQ.data} loading={spendsQ.isLoading} onPress={download} testID="btn-download-summary" />
          <Btn label="Start a new plan with these people" kind="txt" onPress={() => router.push({ pathname: "/plan/new", params: { from: plan.pot } })} testID="btn-start-a-new-plan-with-these-people" />
        </>}
    >
      <DeskColumn dock={<>
          <Btn label="Download summary" kind="sec" icon="download" disabled={!spendsQ.data} loading={spendsQ.isLoading} onPress={download} testID="btn-download-summary" />
          <Btn label="Start a new plan with these people" kind="txt" onPress={() => router.push({ pathname: "/plan/new", params: { from: plan.pot } })} testID="btn-start-a-new-plan-with-these-people" />
        </>} max={680}>
      <AppBar right={<IconBtn name="share" label="Share" onPress={plan.settled ? () => setSharing(true) : shareSummary} testID="btn-share-memory" />} />
      {plan.settled ? <SettleShareSheet visible={sharing} onClose={() => setSharing(false)} plan={plan} paidOut={BigInt(d.settlements[0]?.paidOut ?? "0")} settleMs={settleMs} rateLine={fx.cardLine(BigInt(d.settlements[0]?.paidOut ?? "0"))} /> : null}
      <Bleed style={{ overflow: "hidden", paddingVertical: 12 }}>
        <Band color={plan.meta.color} text={`${plan.meta.name} · ${dates} · ${plan.settled ? "settled" : "ended"}`.toUpperCase()} style={{ marginHorizontal: -40, transform: [{ rotate: "-3deg" }], justifyContent: "center" }} />
      </Bleed>
      <View style={{ alignItems: "center", marginTop: 16 }}>
        <Row gap={0}>
          <Txt v="d34" center>
            {`${plan.meta.name}, ${dates}`}
          </Txt>
          {plan.meta.demo || d.isDemo ? <DemoTag /> : null}
        </Row>
        <Txt v="t15" color="muted" style={{ marginTop: 6 }}>
          {plan.settled ? `Settled${settledAt ? ` ${dayMonth(settledAt)}` : ""} · read-only` : "Not settled yet"}
        </Txt>
        <Row style={{ marginTop: 12 }}>
          <People people={members} size={32} />
          <Txt v="t13" color="muted">
            {`${members.length} ${members.length === 1 ? "person" : "friends"}${countries > 1 ? ` · ${countries} countries` : ""}`}
          </Txt>
        </Row>
      </View>

      {!plan.settled ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="inf" icon="clock" title="This plan isn't settled yet" text="The summary is final once everyone is paid.">
            <View style={{ marginTop: 8 }}>
              <Btn label="Go to settle-up" kind="sec" sm onPress={() => router.push({ pathname: "/plan/[pot]/settle", params: { pot: plan.pot } })} testID="btn-go-to-settle-up" />
            </View>
          </Banner>
        </View>
      ) : null}

      <View style={{ marginTop: 20, gap: 8 }} testID="memory-stats">
        <Row gap={8}>
          <Stat value={formatUsd(total)} label={totalLocal ? `spent together · ${totalLocal}` : "spent together"} testID="memory-spent" />
          <Stat value={String(d.spendCount ?? spends.length)} label={(d.spendCount ?? spends.length) === 1 ? "spend" : "spends"} />
        </Row>
        <Row gap={8}>
          {spendsQ.isLoading ? (
            <Card p={14} style={{ flex: 1 }}>
              <Skel w="60%" h={22} />
              <Skel w="80%" h={14} style={{ marginTop: 6 }} />
            </Card>
          ) : big ? (
            <Stat value={`${categoryOf(big.category).emoji} ${formatUsdShort(BigInt(big.amount))}`} label={`biggest: ${spendNote(plan, big) ?? categoryOf(big.category).name.toLowerCase()}`} />
          ) : (
            <Stat value="—" label="no spends" />
          )}
          {settleMs !== undefined ? <Stat value={`${(settleMs / 1000).toFixed(1)} s`} label="to settle up" /> : <View style={{ flex: 1 }} />}
        </Row>
      </View>
      {spendsQ.isError ? (
        <View style={{ marginTop: 8 }}>
          <Banner kind="neg" icon="wifioff" title="Couldn't load every spend" text="Check your connection and try again.">
            <View style={{ marginTop: 8 }}>
              <Btn label="Try again" kind="sec" sm icon="refresh" onPress={() => void spendsQ.refetch()} testID="btn-try-again" />
            </View>
          </Banner>
        </View>
      ) : null}

      {bars.length > 0 ? (
        <Card style={{ marginTop: 12 }} testID="memory-categories">
          <Overline>Where it went</Overline>
          {bars.map((b) => (
            <View key={b.category} style={{ marginTop: 12 }}>
              <Row between>
                <Txt v="t13" weight="bold">
                  {b.label}
                </Txt>
                <Txt v="t13" color="muted" tnum>
                  {formatUsd(b.amount)}
                </Txt>
              </Row>
              <View style={{ marginTop: 4 }}>
                <Bar pct={b.pct} color={plan.meta.color} />
              </View>
            </View>
          ))}
        </Card>
      ) : null}
      {plan.settled && rateRows.length > 0 ? (
        <Card style={{ marginTop: 12 }} testID="memory-rates">
          <Overline>Exchange rates at settle-up</Overline>
          <View style={{ marginTop: 8 }}>
            {rateRows.map(([k, v], i) => (
              <View key={`${k}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <Txt style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 22 }} color="muted">
                  {k}
                </Txt>
                <Txt style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 22, flexShrink: 1, textAlign: "right" }}>{v}</Txt>
              </View>
            ))}
          </View>
          {fx.loading ? null : <CheckRate rates={memoryRates} usedAt={settledAt ?? undefined} subtitle="For the settle-up payouts." style={{ marginTop: 10 }} />}
        </Card>
      ) : null}
    </DeskColumn>
    </Screen>
  );
}
