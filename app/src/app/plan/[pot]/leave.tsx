/** 36 Leave the plan: your share back now (Pot.exit), or what you pay to leave if you owe. */
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { View } from "react-native";
import type { Address } from "viem";
import { settledMs } from "../../../lib/api/relayer";
import { exitPot } from "../../../lib/chain/actions";
import { formatUsd } from "../../../lib/domain/currency";
import { previewExit } from "../../../lib/domain/settlement";
import { leaveBlockers, leaveSummary } from "../../../lib/ending/planChecks";
import { queryClient, qk, useAllowance, useBalance, useMe, usePlan } from "../../../lib/state/data";
import { putReceipt, useAction } from "../../../lib/state/useAction";
import { NoticeScreen, PlanProblem, PlanSkeleton, spendLabel, useRatesLine } from "../../../ui/ending/common";
import { Banner, Btn, Hero, Overline, Row, Skel } from "../../../ui/kit";
import { AppBar, Screen } from "../../../ui/layout";
import { useMoney } from "../../../ui/plan/common";
import { Stub } from "../../../ui/Stub";
import { Txt } from "../../../ui/Text";
import { showToast } from "../../../ui/Toast";
import { DeskColumn } from "../../../ui/desk/plan";
import { useLayout } from "../../../ui/shell/responsive";

export default function LeavePlan() {
  const { desk } = useLayout();
  const { pot } = useLocalSearchParams<{ pot: string }>();
  const q = usePlan(pot);
  const me = useMe();
  const money = useMoney();
  const bal = useBalance();
  const allowance = useAllowance(pot);
  const rates = useRatesLine([money.currency]);
  const act = useAction(async () => {
    const r = await exitPot(pot as Address);
    void queryClient.invalidateQueries({ queryKey: qk.plan(pot) });
    void queryClient.invalidateQueries({ queryKey: qk.myPlans(me.address) });
    void queryClient.invalidateQueries({ queryKey: qk.balance(me.address) });
    void queryClient.invalidateQueries({ queryKey: qk.activity(me.address) });
    return r;
  });

  if (q.isLoading) return <PlanSkeleton title="Leave" />;
  if (q.isError || !q.data) return <PlanProblem title="Leave" missing={!q.isError} onRetry={() => void q.refetch()} />;
  const plan = q.data;
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: "/plan/[pot]", params: { pot: plan.pot } }));

  if (plan.settled) return <NoticeScreen title={`Leave ${plan.meta.name}?`} heading="This plan is settled" text="Everyone has been paid, so there's nothing to leave. It stays as a read-only memory." action={back} testID="screen-leave" />;
  if (!plan.myMember || plan.myMember.status !== "Active")
    return <NoticeScreen title={`Leave ${plan.meta.name}?`} heading="You've left this plan" text="To come back, someone will need to invite you again." action={() => router.replace("/")} actionLabel="Home" testID="screen-leave" />;

  const blockers = leaveBlockers(plan.raw, plan.me);
  const s = leaveSummary(plan.myMember);
  const potBalance = BigInt(plan.raw.balance);
  const loadingMine = s.net < 0n && (bal.isLoading || allowance.isLoading);
  const ex = previewExit(s.net, potBalance, allowance.data ?? 0n, bal.data ?? 0n);
  const fmt = (u: bigint) => money.local(u) ?? formatUsd(u);

  const leave = async () => {
    const r = await act.run();
    if (!r) return;
    const ev = r.events?.find((e) => e.name === "MemberExited");
    const paid = ev?.args?.paidOut !== undefined ? BigInt(String(ev.args.paidOut)) : ex.paid;
    const pulled = ev?.args?.pulledIn !== undefined ? BigInt(String(ev.args.pulledIn)) : ex.pulled;
    putReceipt({ kind: "exit", txHash: r.txHash, settledMs: settledMs(r), at: Math.floor(Date.now() / 1000), pot: plan.pot, plan: plan.meta.name, paid: paid.toString(), pulled: pulled.toString() });
    showToast({
      title: `You left ${plan.meta.name}`,
      sub: paid > 0n ? `${money.both(paid)} back to your Plans account` : pulled > 0n ? `You paid ${money.both(pulled)}` : "All square",
      emoji: plan.meta.emoji,
    });
    router.dismissTo("/");
  };

  const owes = s.net < 0n;
  const square = s.net === 0n;
  const label = owes ? `Leave and pay ${fmt(ex.pulled + ex.debt)}` : square ? "Leave the plan" : `Leave and get ${fmt(ex.paid)}`;

  return (
    <Screen
      testID="screen-leave"
      dock={desk ? undefined : <>
          <Btn label={label} kind="dng" icon="logout" loading={act.busy} disabled={blockers.length > 0 || loadingMine} onPress={() => void leave()} testID="btn-leave-plan" />
          <Btn label="Stay in the plan" kind="txt" onPress={back} testID="btn-stay-in-the-plan" />
        </>}
    >
      <DeskColumn dock={<>
          <Btn label={label} kind="dng" icon="logout" loading={act.busy} disabled={blockers.length > 0 || loadingMine} onPress={() => void leave()} testID="btn-leave-plan" />
          <Btn label="Stay in the plan" kind="txt" onPress={back} testID="btn-stay-in-the-plan" />
        </>}>
      <AppBar title={`Leave ${plan.meta.name}?`} icon="x" />
      <Txt v="t15" color="muted" style={{ marginBottom: 16 }}>
        {owes ? "You've used more than you put in, so you settle your part now. Spends you were part of stay split as they are." : "You get your share back now. Spends you were part of stay split as they are."}
      </Txt>

      {blockers.length > 0 ? (
        <View style={{ marginBottom: 16, gap: 8 }}>
          {blockers.map((b) => (
            <Banner
              key={`${b.kind}-${b.spendId}`}
              kind="inf"
              icon="clock"
              title={`Wait for the vote on ${spendLabel(plan, b)}`}
              text={b.kind === "spend" ? "You can leave once your request is approved, cancelled or runs out." : "You can leave once the question about this spend is settled."}
              testID="leave-blocked"
            >
              <View style={{ marginTop: 8 }}>
                <Btn label="Open it" kind="sec" sm onPress={() => router.push({ pathname: "/plan/[pot]/spend/[id]", params: { pot: plan.pot, id: b.spendId } })} testID={`btn-open-${b.kind}-${b.spendId}`} />
              </View>
            </Banner>
          ))}
        </View>
      ) : null}

      <Stub
        testID="leave-stub"
        head={
          <View>
            <Row between>
              <Overline>{owes ? `You pay · ${plan.meta.name}` : `Your share · ${plan.meta.name}`}</Overline>
              <Txt>{plan.meta.emoji}</Txt>
            </Row>
            <View style={{ marginTop: 8 }}>
              {loadingMine ? (
                <Skel w={160} h={36} />
              ) : (
                <Hero big={fmt(owes ? ex.pulled + ex.debt : ex.paid)} small={money.local(owes ? ex.pulled + ex.debt : ex.paid) ? formatUsd(owes ? ex.pulled + ex.debt : ex.paid) : undefined} testID="leave-amount" />
              )}
            </View>
            <Txt v="t15" weight="bold" style={{ marginTop: 4 }}>
              {owes ? (ex.debt > 0n ? "From your safety net, the rest is owed" : "From your safety net") : square ? "You're all square" : "Back to your Plans account"}
            </Txt>
          </View>
        }
        lines={[
          ["Put in", formatUsd(s.contributed)],
          ["Paid yourself", formatUsd(s.personalPaid, { sign: true })],
          ["Your share of spends", formatUsd(-s.share)],
          ...(s.withdrawn > 0n ? ([["Already back to you", formatUsd(-s.withdrawn)]] as [string, string][]) : []),
          owes ? ["You owe", formatUsd(-s.net)] : ["Back to you", formatUsd(ex.paid)],
          ...(owes && ex.debt > 0n ? ([["Owed after you leave", formatUsd(ex.debt)]] as [string, string][]) : []),
          ...(!owes && ex.paid < s.net ? ([["Still owed to you", formatUsd(s.net - ex.paid)]] as [string, string][]) : []),
          ...(rates ? ([["", rates]] as [string, string][]) : []),
        ]}
      />

      <View style={{ marginTop: 16, gap: 8 }}>
        {owes && ex.debt > 0n ? (
          <Banner kind="neg" icon="alert" title={`${fmt(ex.debt)} stays owed`} text="Your safety net and Plans balance don't cover all of it. You can pay the rest later from the plan." />
        ) : null}
        <Banner kind="acc" icon="alert" title="Leaving is final" text="To come back, someone will need to invite you again." />
        {act.error ? <Banner kind="neg" icon="alert" title={act.error.title} text={act.error.message} testID="leave-error" /> : null}
      </View>
    </DeskColumn>
    </Screen>
  );
}
