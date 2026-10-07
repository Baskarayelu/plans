/**
 * 42 Debt carried: what's still owed after settle-up when a safety net wasn't enough, with one tap
 * to pay it (Pot.payDebt). The creditor sees the mirror: "<Name> owes you £8.91".
 */
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import type { Address } from "viem";
import { settledMs, type RelayResult } from "../../../lib/api/relayer";
import { payDebt } from "../../../lib/chain/actions";
import { formatUsd } from "../../../lib/domain/currency";
import { fetchMemberLedger } from "../../../lib/ending/queries";
import { debtDistribution, explainEdges } from "../../../lib/ending/settleView";
import { queryClient, qk, useBalance, useMe, usePlan } from "../../../lib/state/data";
import { putReceipt, useAction } from "../../../lib/state/useAction";
import { dayMonth, NoticeScreen, personOf, PlanProblem, PlanSkeleton, usePeopleMoney } from "../../../ui/ending/common";
import { Banner, BigIcon, Btn, Card, Hr, ListItem, Proof, Row, SettledIn, Skel } from "../../../ui/kit";
import { Screen } from "../../../ui/layout";
import { PersonAvatar, PersonName, PlanTop, useMoney } from "../../../ui/plan/common";
import { Txt } from "../../../ui/Text";
import { showToast } from "../../../ui/Toast";
import { DeskColumn } from "../../../ui/desk/plan";
import { useLayout } from "../../../ui/shell/responsive";

function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "the group";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export default function DebtCarried() {
  const { desk } = useLayout();
  const { pot } = useLocalSearchParams<{ pot: string }>();
  const q = usePlan(pot);
  const me = useMe();
  const myMoney = useMoney();
  const bal = useBalance();
  const plan = q.data ?? undefined;
  const people = plan ? Object.values(plan.people) : [];
  const money = usePeopleMoney(people);
  const ledger = useQuery({ queryKey: ["memberLedger", (pot ?? "").toLowerCase(), me.address?.toLowerCase()], queryFn: () => fetchMemberLedger(pot!, me.address!), enabled: !!pot && !!me.address });
  const [paid, setPaid] = useState<RelayResult | null>(null);
  const act = useAction(async (amount: bigint) => {
    const r = await payDebt(pot as Address, amount);
    void queryClient.invalidateQueries({ queryKey: qk.plan(pot) });
    void queryClient.invalidateQueries({ queryKey: qk.myPlans(me.address) });
    void queryClient.invalidateQueries({ queryKey: qk.balance(me.address) });
    void queryClient.invalidateQueries({ queryKey: qk.activity(me.address) });
    void ledger.refetch();
    return r;
  });

  if (q.isLoading) return <PlanSkeleton />;
  if (q.isError || !plan) return <PlanProblem missing={!q.isError} onRetry={() => void q.refetch()} />;
  const d = plan.raw;
  const nets = d.members.map((m) => ({ address: m.address.toLowerCase(), net: BigInt(m.net) }));
  const edges = explainEdges(d.settlementEdges, nets).filter((e) => e.kind === "MemberToMember");
  const myNet = plan.myMember ? BigInt(plan.myMember.net) : 0n;
  const myDebt = plan.myMember ? BigInt(plan.myMember.debt) : 0n;
  const owe = myDebt > 0n ? myDebt : myNet < 0n && plan.settled ? -myNet : 0n;
  const settledAt = d.settledAt ?? d.settlements[0]?.timestamp;
  const band = plan.settled ? `Ended ${dayMonth(Number(d.endTime))} · settled` : undefined;
  const top = <PlanTop plan={plan} band={band} right={<View />} />;
  const toPlan = () => router.replace({ pathname: "/plan/[pot]", params: { pot: plan.pot } });

  // ─────────────── paid ───────────────
  if (paid) {
    const ms = settledMs(paid);
    return (
      <Screen testID="screen-debt-paid" dock={desk ? undefined : <Btn label="Done" onPress={toPlan} testID="btn-done" />}>
        <DeskColumn dock={<Btn label="Done" onPress={toPlan} testID="btn-done" />}>
        {top}
        <View style={{ alignItems: "center", marginTop: 24 }}>
          <BigIcon icon="check" kind="p" size={72} />
          <Txt v="d34" center style={{ marginTop: 16 }}>
            All clear
          </Txt>
          <Txt v="t15" color="muted" center style={{ marginTop: 8 }}>
            It's cleared for both of you.
          </Txt>
        </View>
        <Card style={{ marginTop: 20 }}>
          <Row between>
            <SettledIn ms={ms} />
            <Proof hash={paid.txHash} />
          </Row>
        </Card>
      </DeskColumn>
      </Screen>
    );
  }

  // ─────────────── I owe ───────────────
  if (owe > 0n) {
    const creditorIds = edges.filter((e) => e.from === plan.me).map((e) => e.to!);
    const creditors = (creditorIds.length ? creditorIds : nets.filter((n) => n.net > 0n).map((n) => n.address)).map((a) => personOf(plan, a)).filter((p): p is NonNullable<typeof p> => !!p);
    const dist = debtDistribution(
      owe,
      nets.filter((n) => n.net > 0n),
    );
    const L = ledger.data;
    const pulled = L ? BigInt(L.pulled) : 0n;
    const debtPaid = L ? BigInt(L.debtPaid) : 0n;
    const owedAtSettle = pulled + debtPaid + owe;
    const enough = bal.data !== undefined && bal.data >= owe;
    const first = creditors[0];
    const title = `You owe ${names(creditors.map((p) => p.name))} ${formatUsd(owe)}`;
    const pay = async () => {
      const r = await act.run(owe);
      if (!r) return;
      putReceipt({ kind: "debt", txHash: r.txHash, settledMs: settledMs(r), at: Math.floor(Date.now() / 1000), pot: plan.pot, amount: owe.toString() });
      showToast({ title: "Paid", sub: `${formatUsd(owe)} to ${names(creditors.map((p) => p.name))}`, emoji: plan.meta.emoji });
      setPaid(r);
    };
    return (
      <Screen
        testID="screen-debt"
        refreshing={q.isRefetching}
        onRefresh={() => {
          void q.refetch();
          void ledger.refetch();
          void bal.refetch();
        }}
        dock={desk ? undefined : bal.isLoading ? (
            <Btn label="Checking your balance" kind="off" disabled loading testID="btn-pay-debt" />
          ) : enough ? (
            <Btn label={`Pay now · ${formatUsd(owe)}`} icon={desk ? "key" : "fp"} loading={act.busy} onPress={() => void pay()} testID="btn-pay-debt" />
          ) : (
            <Btn label="Add money first" icon="plus" onPress={() => router.push("/add-balance")} testID="btn-add-money-first" />
          )}
      >
        <DeskColumn dock={bal.isLoading ? (
            <Btn label="Checking your balance" kind="off" disabled loading testID="btn-pay-debt" />
          ) : enough ? (
            <Btn label={`Pay now · ${formatUsd(owe)}`} icon={desk ? "key" : "fp"} loading={act.busy} onPress={() => void pay()} testID="btn-pay-debt" />
          ) : (
            <Btn label="Add money first" icon="plus" onPress={() => router.push("/add-balance")} testID="btn-add-money-first" />
          )}>
        {top}
        <View style={{ alignItems: "center", marginTop: 24 }}>
          <BigIcon icon="receipt" kind="n" size={72} />
          <Txt v="d34" center style={{ marginTop: 16 }} testID="debt-title">
            {title}
          </Txt>
          {myMoney.local(owe) ? (
            <Txt v="t17" color="muted" weight="medium" style={{ marginTop: 4 }}>
              {myMoney.local(owe)}
            </Txt>
          ) : null}
        </View>
        <Card style={{ marginTop: 20, gap: 8 }} testID="debt-breakdown">
          {ledger.isLoading ? (
            <Skel w="80%" h={16} />
          ) : L ? (
            <>
              <Row between>
                <Txt v="t15" color="muted">
                  You owed at settle-up
                </Txt>
                <Txt v="t15" tnum>
                  {formatUsd(owedAtSettle)}
                </Txt>
              </Row>
              {pulled > 0n ? (
                <Row between>
                  <Txt v="t15" color="muted">
                    Safety net covered
                  </Txt>
                  <Txt v="t15" color="pos" tnum>
                    {formatUsd(-pulled)}
                  </Txt>
                </Row>
              ) : null}
              {debtPaid > 0n ? (
                <Row between>
                  <Txt v="t15" color="muted">
                    Already paid
                  </Txt>
                  <Txt v="t15" color="pos" tnum>
                    {formatUsd(-debtPaid)}
                  </Txt>
                </Row>
              ) : null}
            </>
          ) : null}
          <Hr m={4} />
          <Row between>
            <Txt v="t15" weight="bold">
              Still to pay
            </Txt>
            <Txt v="t15" weight="bold" tnum>
              {myMoney.local(owe) ? `${formatUsd(owe)} · ${myMoney.local(owe)}` : formatUsd(owe)}
            </Txt>
          </Row>
        </Card>
        {creditors.map((p) => (
          <ListItem
            key={p.address}
            left={<PersonAvatar p={p} size={40} />}
            title={<PersonName p={p} />}
            sub={settledAt ? `${p.city ? `${p.city} · ` : ""}Waiting since ${dayMonth(settledAt)}` : p.city}
            testID={`creditor-${p.address.slice(2, 8)}`}
            last
          />
        ))}
        <View style={{ marginTop: 8, gap: 8 }}>
          {!plan.settled ? (
            <Banner kind="mut" icon="info" title="It goes back into the pot" text="It's shared out with everything else at settle-up. No fees." />
          ) : dist.length === 1 && first ? (
            <Banner kind="mut" icon="info" title={`${first.name} gets ${money.local(dist[0].amount, first)} straight away`} text="No fees. It clears for both of you." />
          ) : dist.length > 1 ? (
            <Banner
              kind="mut"
              icon="info"
              title="Everyone owed is paid straight away"
              text={`${dist
                .map((x) => {
                  const p = personOf(plan, x.address);
                  return `${p?.name ?? "Friend"} ${money.local(x.amount, p)}`;
                })
                .join(", ")}. No fees.`}
            />
          ) : null}
          {!bal.isLoading && !enough ? (
            <Banner kind="acc" icon="alert" title="Not enough in your Plans account" text={`You have ${formatUsd(bal.data ?? 0n)}. Add money, then come back to pay.`} testID="debt-low-balance" />
          ) : null}
          {act.error ? <Banner kind="neg" icon="alert" title={act.error.title} text={act.error.message} testID="debt-error" /> : null}
        </View>
      </DeskColumn>
      </Screen>
    );
  }

  // ─────────────── I'm owed (mirror) ───────────────
  if (plan.settled && myNet > 0n) {
    const debtorIds = edges.filter((e) => e.to === plan.me).map((e) => e.from!);
    const debtors = (debtorIds.length ? debtorIds : nets.filter((n) => n.net < 0n).map((n) => n.address)).map((a) => personOf(plan, a)).filter((p): p is NonNullable<typeof p> => !!p);
    const meP = plan.me ? personOf(plan, plan.me) : undefined;
    return (
      <Screen testID="screen-debt-owed" dock={desk ? undefined : <Btn label="Back to the plan" kind="sec" onPress={toPlan} testID="btn-back-to-the-plan" />}>
        <DeskColumn dock={<Btn label="Back to the plan" kind="sec" onPress={toPlan} testID="btn-back-to-the-plan" />}>
        {top}
        <View style={{ alignItems: "center", marginTop: 24 }}>
          <BigIcon icon="receipt" kind="i" size={72} />
          <Txt v="d34" center style={{ marginTop: 16 }} testID="debt-title">
            {debtors.length ? `${names(debtors.map((p) => p.name))} ${debtors.length === 1 ? "owes" : "owe"} you ${money.local(myNet, meP)}` : `You're owed ${money.local(myNet, meP)}`}
          </Txt>
          <Txt v="t17" color="muted" weight="medium" style={{ marginTop: 4 }}>
            {formatUsd(myNet)}
          </Txt>
        </View>
        {debtors.map((p) => (
          <ListItem
            key={p.address}
            left={<PersonAvatar p={p} size={40} />}
            title={<PersonName p={p} />}
            sub={settledAt ? `${p.city ? `${p.city} · ` : ""}Owing since ${dayMonth(settledAt)}` : p.city}
            testID={`debtor-${p.address.slice(2, 8)}`}
            last
          />
        ))}
        <View style={{ marginTop: 8 }}>
          <Banner kind="mut" icon="info" title="You're paid straight away when they pay" text="It goes to your Plans account in your own money. No fees." />
        </View>
      </DeskColumn>
      </Screen>
    );
  }

  return <NoticeScreen heading="Nothing is owed" text="Everyone in this plan is square." action={toPlan} testID="screen-debt-none" />;
}
