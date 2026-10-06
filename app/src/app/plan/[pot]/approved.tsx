/**
 * 28 Approved and paid: your OK was the last one needed, so the money moved straight away. The
 * timeline (asked → each OK → paid) comes from the votes; settled time is the measured one.
 */
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { View } from "react-native";
import { formatUsd } from "../../../lib/domain/currency";
import { categoryOf } from "../../../lib/domain/rules";
import { memoText, useSpendDetail, type SpendDetail } from "../../../lib/spend/hooks";
import { eachAmount, fmtClock, sharesFor } from "../../../lib/spend/logic";
import { useStore } from "../../../lib/state/observable";
import { usePlan, type PlanVM } from "../../../lib/state/data";
import { receipts, type ReceiptData } from "../../../lib/state/useAction";
import { BigIcon, Btn, formatSeconds, Proof, Row, SettledIn } from "../../../ui/kit";
import { AppBar, Screen } from "../../../ui/layout";
import { useMoney } from "../../../ui/plan/common";
import { ErrorScreen, LoadingScreen, payeeName, personOf, PlanGate, Timeline, useRateLine, type TimelineItem } from "../../../ui/spend/parts";
import { Stub } from "../../../ui/Stub";
import { Txt } from "../../../ui/Text";

export default function ApprovedPaid() {
  const { pot, id, tx } = useLocalSearchParams<{ pot: string; id: string; tx?: string }>();
  const q = usePlan(pot);
  return (
    <PlanGate q={q} testID="screen-approved">
      {(plan) => <Loader plan={plan} id={id} tx={tx} />}
    </PlanGate>
  );
}

function Loader({ plan, id, tx }: { plan: PlanVM; id: string; tx?: string }) {
  const s = useSpendDetail(plan.pot, id, 5000);
  const r = useStore(receipts, (x) => (tx ? x[tx] : undefined));
  if (s.isLoading) return <LoadingScreen testID="screen-approved" />;
  if (s.isError && !s.data) return <ErrorScreen onRetry={() => void s.refetch()} testID="screen-approved" />;
  if (!s.data) return <LoadingScreen testID="screen-approved" />;
  return <Body plan={plan} s={s.data} r={r} tx={tx} />;
}

function Body({ plan, s, r, tx }: { plan: PlanVM; s: SpendDetail; r?: ReceiptData; tx?: string }) {
  const m = useMoney();
  const rate = useRateLine();
  const amount = BigInt(s.amount);
  const who = personOf(plan, s.proposer_id);
  const whoName = who.me ? "You" : who.name;
  const note = memoText(plan, s.memo);
  const payee = payeeName(plan, s.kind, s.payee, s.proposer_id);
  const cat = categoryOf(s.category);
  const weights = (s.splitWeights ?? []).map(Number);
  const members = s.splitMembers ?? [];
  const each = eachAmount(amount, weights);
  const parts = sharesFor(amount, weights);
  const ms = r?.settledMs;
  const yes = (s.votes ?? []).filter((v) => v.approve && v.account_id.toLowerCase() !== s.proposer_id.toLowerCase()).sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const mineIndexed = yes.some((v) => v.account_id.toLowerCase() === plan.me);
  const items: TimelineItem[] = [{ title: `${whoName} asked for ${formatUsd(amount)}`, sub: s.proposedAt ? fmtClock(s.proposedAt) : undefined, state: "done" }];
  for (const v of yes) {
    const p = personOf(plan, v.account_id);
    items.push({ title: `${p.me ? "You" : p.name} said OK`, sub: v.timestamp ? fmtClock(v.timestamp) : undefined, state: "done" });
  }
  if (!mineIndexed && r) items.push({ title: "You said OK", sub: fmtClock(r.at), state: "done" });
  const paidAt = s.executedAt ?? r?.at;
  const executed = s.status === "Executed" || !!r;
  items.push({
    title: s.kind === "PERSONAL" ? "Added to the plan" : s.kind === "LINK" ? "Pay link made" : "Paid from the pot",
    sub: executed ? [paidAt ? fmtClock(paidAt) : null, ms !== undefined ? `settled in ${formatSeconds(ms)}` : null].filter(Boolean).join(" · ") : undefined,
    state: executed ? "now" : "next",
  });
  const approvers = [...yes.map((v) => personOf(plan, v.account_id)), ...(!mineIndexed && r && plan.me ? [personOf(plan, plan.me)] : [])].map((p) => p.name);
  const needed = Math.max(1, s.approvalsRequired - 1);
  const lines: [string, React.ReactNode][] = [
    [s.kind === "PERSONAL" ? "Paid by" : "To", s.kind === "PERSONAL" ? whoName : payee],
    ["Approved", `${approvers.join(", ")} · ${approvers.length} of ${needed}`],
    ["Split", `${members.length} ${members.length === 1 ? "person" : "people"} · ${each !== null ? `${formatUsd(each)} each` : `from ${formatUsd(parts.reduce((a, b) => (b < a ? b : a), amount))}`}`],
  ];
  if (rate) lines.push(["", rate]);
  const home = () => router.dismissTo({ pathname: "/plan/[pot]", params: { pot: plan.pot } });
  const proof = tx ?? s.txHash;

  return (
    <Screen testID="screen-approved" dock={<Btn label="Done" onPress={home} testID="btn-done" />}>
      <AppBar icon="x" onBack={home} />
      <View style={{ alignItems: "center" }}>
        <BigIcon icon="check" kind="p" />
        <Txt v="d28" center style={{ marginTop: 12 }} testID="approved-title">
          {s.kind === "PERSONAL" ? "Approved and added" : "Approved and paid"}
        </Txt>
        <Txt v="t15" color="muted" center style={{ marginTop: 6, marginHorizontal: 16, marginBottom: 16 }}>
          {s.kind === "PERSONAL" ? `${whoName}'s ${formatUsd(amount)} is on the plan now.` : s.kind === "LINK" ? `The ${formatUsd(amount)} pay link is live. ${whoName} can share it.` : `${payee} got ${formatUsd(amount)}. ${who.me ? "" : `${whoName} knows.`}`}
        </Txt>
      </View>
      <Timeline items={items} />
      <View style={{ height: 16 }} />
      <Stub
        head={
          <>
            <Row between>
              <Txt v="ov" color="muted">
                {plan.meta.name} pot · receipt
              </Txt>
              <Txt>{cat.emoji}</Txt>
            </Row>
            <Row gap={10} align="baseline" style={{ marginTop: 8 }} wrap>
              <Txt v="d34" tnum>
                {formatUsd(amount)}
              </Txt>
              {m.local(amount) ? (
                <Txt v="t17" color="muted" weight="medium">
                  {m.local(amount)}
                </Txt>
              ) : null}
            </Row>
            {note ? (
              <Txt v="t15" weight="bold" style={{ marginTop: 4 }}>
                {note}
              </Txt>
            ) : null}
          </>
        }
        lines={lines}
        foot={
          <>
            {ms !== undefined ? <SettledIn ms={ms} /> : <View />}
            <Proof hash={proof} />
          </>
        }
      />
    </Screen>
  );
}
