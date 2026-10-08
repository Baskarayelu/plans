/**
 * 38 Settle-up preview → 39 Settling → 40 Settled, as states of one screen.
 * The preview runs the contract's own settle maths (previewSettle) on live nets, each debtor's
 * safety-net allowance and balance; the settled state shows the receipt's Payout events, or the
 * indexer's payouts when the plan was already settled.
 */
import { useQueries } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import type { Address } from "viem";
import { RelayError, settledMs, type RelayResult } from "../../../lib/api/relayer";
import { settle } from "../../../lib/chain/actions";
import { ausdAllowance, ausdBalance } from "../../../lib/chain/rpc";
import { formatUsd } from "../../../lib/domain/currency";
import { explainEdges, payoutsFromEvents, rowsDoneMs, rowStates, settleView, type RowState } from "../../../lib/ending/settleView";
import { queryClient, qk, useMe, usePlan, type Person, type PlanVM } from "../../../lib/state/data";
import { getReceipt, putReceipt, useAction } from "../../../lib/state/useAction";
import { useColors } from "../../../theme/ThemeProvider";
import { fonts, WRISTBANDS } from "../../../theme/tokens";
import { EdgeArrow, personOf, PlanProblem, PlanSkeleton, SpinnerRing, useCanSettle, useNow, usePeopleMoney } from "../../../ui/ending/common";
import { Icon } from "../../../ui/Icon";
import { Banner, BigIcon, Btn, Btns, Card, Chip, Confetti, formatSeconds, ListItem, Overline, Proof, Row, SettledIn, Skel } from "../../../ui/kit";
import { AppBar, Screen } from "../../../ui/layout";
import { dateRange } from "../../../ui/planBits";
import { PersonAvatar, PersonName } from "../../../ui/plan/common";
import { SettleShareSheet } from "../../../ui/share/SettleShareSheet";
import { Stub } from "../../../ui/Stub";
import { CheckRate, RateLines, RatesOutOfDate, usePreviewRates, useSettleRates } from "../../../ui/fx/rates";
import { DeskSettled, DeskSettlePreview } from "../../../ui/desk/settle";
import { useLayout } from "../../../ui/shell/responsive";
import { Txt } from "../../../ui/Text";

const ROW_STEP_MS = 140;
const SLOW_MS = 5_000;
const lc = (s: string) => s.toLowerCase();

type Done = { payouts: Record<string, bigint>; debts: Record<string, bigint>; paidOut: bigint; txHash?: string; ms?: number; fxRoundId?: string };

function useSettlePreview(plan: PlanVM | undefined) {
  const members = plan?.raw.members ?? [];
  const debtors = members.filter((m) => BigInt(m.net) < 0n).map((m) => m.address.toLowerCase());
  const pot = plan?.pot ?? "";
  const reads = useQueries({
    queries: debtors.flatMap((a) => [
      { queryKey: qk.allowance(a, pot), queryFn: () => ausdAllowance(a as Address, pot as Address), enabled: !!pot && !plan?.settled, staleTime: 10_000 },
      { queryKey: qk.balance(a), queryFn: () => ausdBalance(a as Address), enabled: !!pot && !plan?.settled, staleTime: 10_000 },
    ]),
  });
  const loading = reads.some((r) => r.isLoading);
  const failed = reads.some((r) => r.isError);
  const vm = useMemo(() => {
    if (!plan || loading) return null;
    const val: Record<string, { allowance: bigint; balance: bigint }> = {};
    debtors.forEach((a, i) => (val[a] = { allowance: (reads[i * 2]?.data as bigint | undefined) ?? 0n, balance: (reads[i * 2 + 1]?.data as bigint | undefined) ?? 0n }));
    const input = members.map((m) => {
      const a = m.address.toLowerCase();
      return { address: a, net: BigInt(m.net), allowance: val[a]?.allowance ?? 0n, walletBalance: val[a]?.balance ?? 0n, active: m.status === "Active" };
    });
    return settleView({
      members: input,
      potBalance: BigInt(plan.raw.balance),
      edges: explainEdges(plan.raw.settlementEdges, input.map((m) => ({ address: m.address, net: m.net }))),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, loading, reads.map((r) => String(r.data)).join(",")]);
  return { vm, loading, failed, retry: () => reads.forEach((r) => void r.refetch()) };
}

export default function SettleUp() {
  const { pot } = useLocalSearchParams<{ pot: string }>();
  const q = usePlan(pot);
  const me = useMe();
  const plan = q.data ?? undefined;
  const [phase, setPhase] = useState<"preview" | "settling" | "settled">("preview");
  const [t0, setT0] = useState(0);
  const [tRes, setTRes] = useState<number | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const preview = useSettlePreview(plan);
  const { desk } = useLayout();
  const settleQ = useCanSettle(pot, !!plan && !plan.settled && phase === "preview");
  const people = useMemo(() => Object.values(plan?.people ?? {}), [plan]);
  // 38/112: amounts and rate lines at the rates the settle-up receipt will use (the latest round
  // while it is fresh, which the pot records, else Plans' quote); out-of-date rates block the button.
  const fx = usePreviewRates({ currencies: people.map((p) => p.currency), records: true, needed: !!plan && !plan.settled && phase === "preview" });
  const base = usePeopleMoney(people);
  const localAt = (units: bigint, p: Person | undefined, o: { sign?: boolean } = {}) => (p && p.currency !== "USD" ? fx.local(units, p.currency, o) : undefined);
  const money: ReturnType<typeof usePeopleMoney> = {
    ...base,
    local: (units, p, o = {}) => localAt(units, p, o) ?? formatUsd(units, o),
    // the small second line: dollars under their money, or just "dollars" when that's all there is
    second: (units, p) => (localAt(units, p) ? formatUsd(units) : "dollars"),
  };
  const paidCurrencies = Array.from(new Set((preview.vm?.rows ?? []).filter((r) => r.payout > 0n).map((r) => plan?.people[r.address]?.currency ?? "USD")));
  const rateCurrencies = paidCurrencies.length ? paidCurrencies : people.map((p) => p.currency);
  const rateRows = fx.gate === "ok" ? fx.lines(rateCurrencies) : [];
  const checkRates = fx.gate === "ok" ? Array.from(new Set(rateCurrencies.map((c) => (c === "AUSD" ? "USD" : c)))).map((c) => fx.rates[c]).filter(Boolean) : [];
  const ratesOk = fx.gate === "ok";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  // Someone else settled first: wait for the indexer to show their receipt.
  const waitingForIndexer = phase === "settled" && !done && !!plan && !plan.settled;
  useEffect(() => {
    if (!waitingForIndexer) return;
    const t = setInterval(() => void q.refetch(), 2_000);
    return () => clearInterval(t);
  }, [waitingForIndexer, q]);

  const act = useAction(
    async (): Promise<RelayResult | "already"> => {
      try {
        return await settle(pot as Address);
      } catch (e) {
        if (e instanceof RelayError && e.code === "POT_SETTLED") return "already";
        throw e;
      }
    },
    { fatal: true, context: "Nobody was paid; try again." },
  );

  const start = async () => {
    setT0(Date.now());
    setTRes(null);
    setPhase("settling");
    const r = await act.run();
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: qk.plan(pot) });
      void queryClient.invalidateQueries({ queryKey: qk.myPlans(me.address) });
      void queryClient.invalidateQueries({ queryKey: qk.balance(me.address) });
      void queryClient.invalidateQueries({ queryKey: qk.activity(me.address) });
    };
    if (r === undefined) {
      setPhase("preview");
      return;
    }
    if (r === "already") {
      invalidate();
      await q.refetch();
      setPhase("settled");
      return;
    }
    const ev = payoutsFromEvents(r.events, pot);
    const debts: Record<string, bigint> = {};
    for (const e of r.events ?? []) {
      if (e.name === "DebtRecorded" && typeof e.args.member === "string") debts[lc(e.args.member)] = (debts[lc(e.args.member)] ?? 0n) + BigInt(String(e.args.amount ?? 0));
    }
    const ms = settledMs(r);
    // The reference round the pot recorded with this settle-up ("0" = none fresh enough).
    const settledEv = r.events?.find((e) => e.name === "Settled" && (!e.address || lc(e.address) === lc(pot)));
    const fxRoundId = settledEv?.args.fxRoundId !== undefined && settledEv?.args.fxRoundId !== null ? String(settledEv.args.fxRoundId) : undefined;
    putReceipt({ kind: "settle", txHash: r.txHash, settledMs: ms, at: Math.floor(Date.now() / 1000), pot, paidOut: ev.paidOut.toString(), plan: plan?.meta.name ?? "", fxRoundId });
    setDone({ payouts: ev.payouts, debts, paidOut: ev.paidOut, txHash: r.txHash, ms, fxRoundId });
    setTRes(Date.now());
    invalidate();
    const n = Math.max(1, Object.keys(ev.payouts).length);
    timer.current = setTimeout(() => setPhase("settled"), rowsDoneMs(n, ROW_STEP_MS));
  };

  if (q.isLoading) return <PlanSkeleton title="Settle up" />;
  if (q.isError || !plan) return <PlanProblem title="Settle up" missing={!q.isError} onRetry={() => void q.refetch()} />;
  const sub = `${plan.meta.name}, ${dateRange(Number(plan.raw.startTime), Number(plan.raw.endTime))}`;

  if (desk && phase !== "settled" && !plan.settled)
    return (
      <Screen testID={phase === "settling" ? "screen-settle-preview-settling" : "screen-settle-preview"} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
        <DeskSettlePreview
          plan={plan}
          vm={preview.vm}
          can={settleQ.data === true}
          checking={settleQ.isLoading}
          busy={act.busy}
          onSettle={() => void start()}
          failed={preview.failed}
          onRetry={preview.retry}
          rateRows={rateRows}
          checkRates={checkRates}
          rateGate={fx.gate}
          onRefreshRates={fx.refresh}
          refreshingRates={fx.refreshing}
          money={money}
          settling={phase === "settling" ? <Settling plan={plan} preview={preview.vm} done={done} t0={t0} tRes={tRes} money={money} panel /> : undefined}
        />
      </Screen>
    );
  if (phase === "settling") return <Settling plan={plan} preview={preview.vm} done={done} t0={t0} tRes={tRes} money={money} />;

  if (phase === "settled" && !done && !plan.settled) return <PlanSkeleton title="All settled" />;
  if (phase === "settled" || plan.settled) {
    const fromIndexer: Done = (() => {
      const payouts: Record<string, bigint> = {};
      let paidOut = 0n;
      for (const p of plan.raw.payouts) {
        if (p.afterSettlement) continue;
        payouts[lc(p.account_id)] = (payouts[lc(p.account_id)] ?? 0n) + BigInt(p.amount);
        paidOut += BigInt(p.amount);
      }
      const debts: Record<string, bigint> = {};
      for (const m of plan.raw.members) if (BigInt(m.debt) > 0n) debts[lc(m.address)] = BigInt(m.debt);
      const s = plan.raw.settlements[0];
      const txHash = s?.txHash;
      return { payouts, debts, paidOut: s ? BigInt(s.paidOut) : paidOut, txHash, ms: getReceipt(txHash)?.settledMs, fxRoundId: s?.fxRoundId };
    })();
    return <Settled plan={plan} data={done ?? fromIndexer} />;
  }

  // ─────────────── 38 preview ───────────────
  const vm = preview.vm;
  const can = settleQ.data === true;
  const rows = vm ? [...vm.rows].sort((a, b) => (a.address === plan.me ? -1 : b.address === plan.me ? 1 : 0)) : [];
  const leftoverText = (() => {
    if (!vm || vm.leftover.length === 0) return null;
    const total = formatUsd(vm.leftoverTotal);
    if (vm.equalShare !== undefined) return `Then the ${total} left in the pot is shared ${vm.leftover.length} ways, ${formatUsd(vm.equalShare)} each.`;
    const names = vm.leftover.map((l) => {
      const p = personOf(plan, l.to);
      return `${p?.me ? "you" : (p?.name ?? "Friend")} ${money.local(l.amount, p)}`;
    });
    if (vm.leftover.length === 1) {
      const p = personOf(plan, vm.leftover[0].to);
      return `Then the ${total} left in the pot goes to ${p?.me ? "you" : (p?.name ?? "Friend")}.`;
    }
    return `Then the ${total} left in the pot goes to ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}.`;
  })();

  return (
    <Screen
      testID="screen-settle-preview"
      refreshing={q.isRefetching}
      onRefresh={() => {
        void q.refetch();
        preview.retry();
        void settleQ.refetch();
      }}
      dock={
        <>
          {!can && !settleQ.isLoading ? (
            <Btn label="Check the numbers first" kind="sec" onPress={() => router.push({ pathname: "/plan/[pot]/review", params: { pot: plan.pot } })} testID="btn-check-the-numbers" />
          ) : null}
          <Btn label="Settle up · one tap" icon="fp" disabled={!can || !vm || !ratesOk} loading={act.busy || settleQ.isLoading} onPress={() => void start()} testID="btn-settle-up" />
        </>
      }
    >
      <AppBar title="Settle up" sub={sub} />
      <Txt v="d28">Here's who gets what</Txt>
      <Txt v="t15" color="muted" style={{ marginTop: 8, marginBottom: 12 }}>
        Everyone is paid at once, in their own money.
      </Txt>

      {!can && !settleQ.isLoading ? (
        <View style={{ marginBottom: 12 }}>
          <Banner kind="inf" icon="clock" title="Settle-up isn't open yet" text="It opens when everyone has said the numbers look right and nothing is still waiting for a vote, or when the review time is over." testID="settle-not-open" />
        </View>
      ) : null}
      {fx.gate === "stale" || fx.gate === "missing" ? (
        <View style={{ marginBottom: 12 }}>
          <RatesOutOfDate gate={fx.gate} onRefresh={fx.refresh} refreshing={fx.refreshing} />
        </View>
      ) : null}
      {preview.failed ? (
        <View style={{ marginBottom: 12 }}>
          <Banner kind="neg" icon="wifioff" title="Couldn't check everyone's safety net" text="The amounts below may change. Check your connection.">
            <View style={{ marginTop: 8 }}>
              <Btn label="Try again" kind="sec" sm icon="refresh" onPress={preview.retry} testID="btn-try-again" />
            </View>
          </Banner>
        </View>
      ) : null}

      <Card style={{ paddingVertical: 4 }} testID="settle-payouts">
        {!vm
          ? [0, 1, 2].map((i) => (
              <View key={i} style={{ flexDirection: "row", gap: 12, alignItems: "center", minHeight: 64 }}>
                <Skel w={40} h={40} r={20} />
                <Skel w="50%" h={16} />
              </View>
            ))
          : rows.map((r, i) => {
              const p = personOf(plan, r.address);
              if (!p) return null;
              let right: React.ReactNode;
              let rsub: string | undefined;
              if (r.payout > 0n) {
                right = <Txt v="d17">{money.local(r.payout, p)}</Txt>;
                rsub = r.unpaid > 0n ? `${money.second(r.payout, p)} · ${formatUsd(r.unpaid)} still owed` : money.second(r.payout, p);
              } else if (r.pulled > 0n || r.debt > 0n) {
                right = (
                  <Txt v="d17" color="neg">
                    {money.local(-(r.pulled + r.debt), p)}
                  </Txt>
                );
                rsub = r.debt > 0n ? (r.pulled > 0n ? `${formatUsd(r.pulled)} from safety net · ${formatUsd(r.debt)} owed` : `${formatUsd(r.debt)} carried as debt`) : "from safety net";
              } else {
                right = <Txt v="t15" color="muted">All square</Txt>;
              }
              return (
                <ListItem
                  key={r.address}
                  last={i === rows.length - 1}
                  left={<PersonAvatar p={p} size={40} />}
                  title={<PersonName p={p} />}
                  sub={p.city}
                  right={right}
                  rsub={rsub}
                  testID={`payout-${r.address.slice(2, 8)}`}
                />
              );
            })}
      </Card>

      {vm && (vm.edges.length > 0 || leftoverText) ? (
        <>
          <Overline style={{ marginTop: 20 }}>How we got there</Overline>
          <Card style={{ marginTop: 8, paddingTop: 12 }} testID="settle-edges">
            {vm.edges.map((e, i) => {
              const from = personOf(plan, e.from);
              const to = personOf(plan, e.to);
              if (!from || !to) return null;
              const a = money.local(e.amount, from);
              const b = money.local(e.amount, to);
              const label = a === b ? a : `${a} · ${b}`;
              const note = e.covered === "full" ? "from safety net" : e.covered === "part" ? "part from safety net, rest owed" : "owed after settle-up";
              return (
                <View key={`${e.from}-${e.to}`} style={{ marginBottom: i === vm.edges.length - 1 ? 0 : 10 }}>
                  <EdgeArrow from={from} to={to} label={label} note={note} testID={`edge-${i}`} />
                </View>
              );
            })}
            {leftoverText ? (
              <Txt v="t13" color="muted" style={{ marginTop: vm.edges.length ? 12 : 0 }} testID="settle-leftover">
                {leftoverText}
              </Txt>
            ) : null}
          </Card>
        </>
      ) : vm && vm.rows.every((r) => r.payout === 0n && r.pulled === 0n && r.debt === 0n) ? (
        <Txt v="t15" color="muted" style={{ marginTop: 16 }}>
          Everyone is square. Settling up closes the plan.
        </Txt>
      ) : null}

      {vm?.shortfall ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="acc" icon="info" title="The pot can't cover everyone in full" text="Each person owed gets the same share of what they're owed now. The rest stays owed to them and is paid as soon as it comes in." />
        </View>
      ) : null}
      {vm?.anyDebt ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="mut" icon="info" title="Some of it is carried as a debt" text="When someone owes more than their safety net covers, the rest stays owed. They can pay it later from the plan." />
        </View>
      ) : null}
      {rateRows.length ? (
        <Card style={{ marginTop: 12 }}>
          <RateLines lines={rateRows} testID="settle-rates" />
        </Card>
      ) : null}
      {checkRates.length ? <CheckRate rates={checkRates} subtitle="For the settle-up payouts." style={{ marginTop: 12 }} /> : null}
    </Screen>
  );
}

// ─────────────── 39 settling ───────────────

function Settling({
  plan,
  preview,
  done,
  t0,
  tRes,
  money,
  panel,
}: {
  plan: PlanVM;
  preview: ReturnType<typeof settleView> | null;
  done: Done | null;
  t0: number;
  tRes: number | null;
  money: ReturnType<typeof usePeopleMoney>;
  /** Laptop: the progress list inside the settle-up panel (112 → 39). */
  panel?: boolean;
}) {
  const c = useColors();
  const now = useNow(50);
  const elapsed = (tRes ?? now) - t0;
  const slow = tRes === null && elapsed > SLOW_MS;
  const payees = (() => {
    const fromPreview = (preview?.rows ?? []).filter((r) => r.payout > 0n).map((r) => ({ address: r.address, amount: r.payout }));
    if (done) {
      const real = Object.entries(done.payouts).map(([address, amount]) => ({ address, amount }));
      if (real.length) return real;
    }
    return fromPreview;
  })();
  const states: RowState[] = rowStates(payees.length, tRes === null ? null : now - tRes, ROW_STEP_MS);
  const leave = <Txt v="t13" color="muted" center>{slow ? "Taking longer than usual. You can leave; we'll tell you when it's done." : "You can leave this screen. We'll tell you when it's done."}</Txt>;
  const body = (
    <>
      <View style={{ marginTop: panel ? 8 : 32, alignItems: "center" }}>
        <SpinnerRing label={formatSeconds(Math.max(0, elapsed))} size={panel ? 96 : undefined} />
        <Txt v="d28" center style={{ marginTop: 20 }}>
          {tRes === null ? "Settling up…" : "Paid"}
        </Txt>
        <Txt v="t15" color="muted" center style={{ marginTop: 8, marginHorizontal: 16, marginBottom: 24 }}>
          {slow ? "Taking longer than usual. Nobody is paid twice; it either all happens or none of it does." : "Paying everyone at once. This usually takes under a second."}
        </Txt>
      </View>
      {payees.length > 0 ? (
        <Card style={{ paddingVertical: 4 }} testID="settling-rows">
          {payees.map((r, i) => {
            const p = personOf(plan, r.address);
            if (!p) return null;
            const s = states[i];
            return (
              <ListItem
                key={r.address}
                last={i === payees.length - 1}
                left={<PersonAvatar p={p} size={36} />}
                title={<PersonName p={p} you={false} />}
                sub={money.local(r.amount, p)}
                right={
                  s === "ok" ? (
                    <Row gap={4}>
                      <Icon name="check" size={16} strokeWidth={2.6} color={c.pos} />
                      <Txt v="t15" color="pos" weight="bold">
                        Paid
                      </Txt>
                    </Row>
                  ) : s === "go" ? (
                    <Row gap={6}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent }} />
                      <Txt v="t15" weight="bold">
                        Paying
                      </Txt>
                    </Row>
                  ) : (
                    <Txt v="t15" color="muted">
                      Next
                    </Txt>
                  )
                }
                testID={`settling-row-${i}`}
              />
            );
          })}
        </Card>
      ) : null}
    </>
  );
  if (panel)
    return (
      <View testID="screen-settling" style={{ flex: 1 }}>
        {body}
        <View style={{ flex: 1, minHeight: 16 }} />
        {leave}
      </View>
    );
  return (
    <Screen testID="screen-settling" dock={leave}>
      {body}
    </Screen>
  );
}

// ─────────────── 40 settled ───────────────

const CONFETTI: [number, number, string, number][] = [
  [30, 30, WRISTBANDS.lagoon, 20],
  [90, 90, WRISTBANDS.marigold, -30],
  [300, 40, WRISTBANDS.orchid, 45],
  [340, 110, WRISTBANDS.lime, -15],
  [200, 20, WRISTBANDS.coral, 30],
  [150, 130, WRISTBANDS.iris, 60],
];

function Settled({ plan, data }: { plan: PlanVM; data: Done }) {
  // 151: payouts in each person's money at the round the settle-up recorded (else Plans' quote), with the rates used.
  const fx = useSettleRates(plan, { fxRoundId: data.fxRoundId });
  const local = (units: bigint, p: Person | undefined) => (p ? fx.local(units, p.currency) : undefined) ?? formatUsd(units);
  const both = (units: bigint, p: Person | undefined) => {
    const l = p && p.currency !== "USD" ? fx.local(units, p.currency) : undefined;
    return l ? `${l} · ${formatUsd(units)}` : formatUsd(units);
  };
  const head = `${plan.meta.name}, ${dateRange(Number(plan.raw.startTime), Number(plan.raw.endTime))} · settle-up`;
  const entries = Object.entries(data.payouts).filter(([, v]) => v > 0n);
  const debtEntries = Object.entries(data.debts).filter(([, v]) => v > 0n);
  const label = (p: Person | undefined) => (p ? `${p.me ? `${p.name} (you)` : p.name}${p.demo ? " · Demo" : ""}${p.city ? ` · ${p.city}` : ""}` : "Friend");
  const lines: [string, React.ReactNode][] = [
    ...entries.map(([a, v]): [string, React.ReactNode] => {
      const p = personOf(plan, a);
      return [label(p), <Txt key={a} style={{ fontFamily: fonts.monoSemi, fontSize: 12, lineHeight: 22, flexShrink: 1, textAlign: "right" }}>{both(v, p)}</Txt>];
    }),
    ...debtEntries.map(([a, v]): [string, React.ReactNode] => {
      const p = personOf(plan, a);
      return [`${p?.name ?? "Friend"} still owes`, formatUsd(v)];
    }),
    ...(fx.lines(entries.map(([a]) => personOf(plan, a)?.currency ?? "USD")) as [string, React.ReactNode][]),
    ["Network cost", "covered by Plans"],
  ];
  const paidCurrencies = Array.from(new Set(entries.map(([a]) => personOf(plan, a)?.currency ?? "USD")));
  const checkRates = paidCurrencies.map((cur) => fx.rates[cur]).filter(Boolean);
  const cardLine = fx.cardLine(data.paidOut);
  const settledAtSec = plan.raw.settlements[0]?.timestamp ?? getReceipt(data.txHash)?.at;
  const myPayout = plan.me ? (data.payouts[plan.me] ?? 0n) : 0n;
  const me = plan.me ? personOf(plan, plan.me) : undefined;

  const [sharing, setSharing] = useState(false);
  const { desk } = useLayout();
  const stubHead = (
    <View>
      <Row between>
        <Overline style={{ flex: 1 }}>{head}</Overline>
        <Txt>{plan.meta.emoji}</Txt>
      </Row>
      <Txt v="d28" style={{ marginTop: 8 }} testID="settled-paid-out">
        {`${formatUsd(data.paidOut)} paid out`}
      </Txt>
    </View>
  );
  const owe = debtEntries.some(([a]) => a === plan.me) ? (
    <Banner kind="neg" icon="receipt" title="You still owe a little" text="Your safety net didn't cover all of it.">
      <View style={{ marginTop: 8 }}>
        <Btn label="See what you owe" kind="sec" sm onPress={() => router.push({ pathname: "/plan/[pot]/debt", params: { pot: plan.pot } })} testID="btn-see-what-you-owe" />
      </View>
    </Banner>
  ) : null;

  if (desk)
    return (
      <Screen testID="screen-settled">
        <DeskSettled
          plan={plan}
          head={stubHead}
          lines={lines}
          paidOut={data.paidOut}
          ms={data.ms}
          txHash={data.txHash}
          myLine={me && myPayout > 0n ? `You got ${local(myPayout, me)}, already in your Plans account.` : null}
          oweBanner={owe}
          foot={
            <>
              <SettledIn ms={data.ms} />
              <Proof hash={data.txHash} />
            </>
          }
          afterStub={fx.loading ? null : <CheckRate rates={checkRates} usedAt={settledAtSec} subtitle="For the settle-up payouts." style={{ marginTop: 12 }} />}
          rateLine={cardLine}
        />
      </Screen>
    );

  return (
    <Screen
      testID="screen-settled"
      dock={
        <Btns>
          <Btn label="Share" kind="sec" icon="share" onPress={() => setSharing(true)} testID="btn-share" />
          <Btn label="Done" onPress={() => router.replace({ pathname: "/plan/[pot]/memory", params: { pot: plan.pot } })} testID="btn-done" />
        </Btns>
      }
    >
      <Confetti pieces={CONFETTI} />
      <View style={{ marginTop: 24, alignItems: "center" }}>
        <BigIcon icon="check" kind="p" size={72} />
        <Txt v="d34" center style={{ marginTop: 12 }} testID="settled-title">
          All settled
        </Txt>
        {data.ms !== undefined ? (
          <View style={{ marginTop: 8 }}>
            <Chip sm tone="pos" icon="zap" label={`Settled in ${formatSeconds(data.ms)}`} />
          </View>
        ) : null}
        {me && myPayout > 0n ? (
          <Txt v="t15" color="muted" center style={{ marginTop: 8 }}>
            {`You got ${local(myPayout, me)}, already in your Plans account.`}
          </Txt>
        ) : null}
      </View>
      <View style={{ marginTop: 20 }}>
        <Stub
          testID="settled-stub"
          head={
            <View>
              <Row between>
                <Overline style={{ flex: 1 }}>{head}</Overline>
                <Txt>{plan.meta.emoji}</Txt>
              </Row>
              <Txt v="d28" style={{ marginTop: 8 }} testID="settled-paid-out">
                {`${formatUsd(data.paidOut)} paid out`}
              </Txt>
            </View>
          }
          lines={lines}
          foot={
            <>
              <SettledIn ms={data.ms} />
              <Proof hash={data.txHash} />
            </>
          }
        />
        {fx.loading ? null : <CheckRate rates={checkRates} usedAt={settledAtSec} subtitle="For the settle-up payouts." style={{ marginTop: 12 }} />}
      </View>
      {debtEntries.some(([a]) => a === plan.me) ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="receipt" title="You still owe a little" text="Your safety net didn't cover all of it.">
            <View style={{ marginTop: 8 }}>
              <Btn label="See what you owe" kind="sec" sm onPress={() => router.push({ pathname: "/plan/[pot]/debt", params: { pot: plan.pot } })} testID="btn-see-what-you-owe" />
            </View>
          </Banner>
        </View>
      ) : null}
      <SettleShareSheet visible={sharing} onClose={() => setSharing(false)} plan={plan} paidOut={data.paidOut} settleMs={data.ms} rateLine={cardLine} />
    </Screen>
  );
}
