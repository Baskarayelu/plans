/**
 * 30 Question a spend. Anyone in the split can ask, until settle-up; one open question per spend.
 * Reasons map onto the protocol's three (0 wrong amount, 1 wrong split, 2 not a group cost);
 * the chosen words and the note travel encrypted in the dispute memo.
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import type { Address, Hex } from "viem";
import * as A from "../../../../lib/chain/actions";
import { findEvent } from "../../../../lib/api/relayer";
import { toHex } from "../../../../lib/crypto/bytes";
import { encodeMemo } from "../../../../lib/crypto/seal";
import { formatUsd } from "../../../../lib/domain/currency";
import { memoText, refreshSpend, useSpendDetail, type SpendDetail } from "../../../../lib/spend/hooks";
import { DISPUTE_CHOICES } from "../../../../lib/spend/logic";
import { usePlan, type PlanVM } from "../../../../lib/state/data";
import { useAction } from "../../../../lib/state/useAction";
import { useColors } from "../../../../theme/ThemeProvider";
import { Banner, Btn, Field, Radio } from "../../../../ui/kit";
import { AppBar, Screen } from "../../../../ui/layout";
import { ErrorScreen, LoadingScreen, personOf, PlanGate, SpendSummaryCard } from "../../../../ui/spend/parts";
import { Txt } from "../../../../ui/Text";
import { showToast } from "../../../../ui/Toast";
import { DeskColumn } from "../../../../ui/desk/plan";
import { useLayout } from "../../../../ui/shell/responsive";

export default function QuestionSpend() {
  const { pot, id } = useLocalSearchParams<{ pot: string; id: string }>();
  const q = usePlan(pot);
  return (
    <PlanGate q={q} title="Question a spend" testID="screen-question">
      {(plan) => <Loader plan={plan} id={id} />}
    </PlanGate>
  );
}

function Loader({ plan, id }: { plan: PlanVM; id: string }) {
  const s = useSpendDetail(plan.pot, id, 30_000);
  if (s.isLoading) return <LoadingScreen title="Question a spend" testID="screen-question" />;
  if (s.isError || !s.data) return <ErrorScreen title="Question a spend" onRetry={() => void s.refetch()} testID="screen-question" />;
  return <Body plan={plan} s={s.data} />;
}

type ChoiceKey = (typeof DISPUTE_CHOICES)[number]["key"];

function Body({ plan, s }: { plan: PlanVM; s: SpendDetail }) {
  const { desk } = useLayout();
  const c = useColors();
  const [choice, setChoice] = useState<ChoiceKey | null>(null);
  const [note, setNote] = useState("");
  const amount = BigInt(s.amount);
  const who = personOf(plan, s.proposer_id);
  const spendNote = memoText(plan, s.memo);
  const open = s.disputes?.find((d) => d.status === "Open");
  const inSplit = !!plan.me && ((s.shares ?? []).some((x) => x.account_id.toLowerCase() === plan.me) || (s.splitMembers ?? []).some((a) => a.toLowerCase() === plan.me));
  const refunded = BigInt(s.refunded ?? "0") > 0n;
  let blocked: string | null = null;
  if (plan.settled) blocked = "This plan is settled, so questions are closed.";
  else if (!plan.isMember) blocked = "Only people in the plan can question a spend.";
  else if (s.status !== "Executed" || amount === 0n || refunded) blocked = "Only spends that went through can be questioned.";
  else if (!inSplit) blocked = "Only people in the split can question this spend.";

  const send = useAction(async () => {
    const pick = DISPUTE_CHOICES.find((x) => x.key === choice)!;
    let memo: Hex = "0x";
    if (plan.gk) memo = toHex(encodeMemo(plan.gk, plan.pot, "dispute", { text: note.trim(), reason: pick.label })) as Hex;
    return A.openDispute(plan.pot as Address, BigInt(s.spendId), pick.code, memo);
  });

  const submit = async () => {
    const r = await send.run();
    if (!r) return;
    refreshSpend(plan.pot, s.spendId);
    const ev = findEvent(r, "DisputeOpened");
    const did = ev?.args?.disputeId !== undefined ? String(ev.args.disputeId) : undefined;
    showToast({ title: "Sent to the group", sub: "Everyone can vote for 48 hours", emoji: plan.meta.emoji });
    if (did) router.replace({ pathname: "/plan/[pot]/dispute/[id]", params: { pot: plan.pot, id: did } });
    else router.back();
  };

  const theirName = who.me ? "you" : who.name;
  return (
    <Screen
      testID="screen-question"
      dock={desk ? undefined : blocked || open ? undefined : <Btn label="Send to the group" icon="send" disabled={!choice} loading={send.busy} onPress={() => void submit()} testID="btn-send-to-the-group" />}
    >
      <DeskColumn dock={blocked || open ? undefined : <Btn label="Send to the group" icon="send" disabled={!choice} loading={send.busy} onPress={() => void submit()} testID="btn-send-to-the-group" />}>
      <AppBar icon="x" title="Question a spend" />
      <SpendSummaryCard plan={plan} spend={s} note={spendNote} />
      {open ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="inf" icon="scale" title="Someone already questioned this" text="There's one question per spend. Have your say in the vote." testID="banner-already-open">
            <View style={{ marginTop: 8 }}>
              <Btn label="See the vote" kind="sec" sm onPress={() => router.replace({ pathname: "/plan/[pot]/dispute/[id]", params: { pot: plan.pot, id: open.disputeId } })} testID="btn-see-the-vote" />
            </View>
          </Banner>
        </View>
      ) : blocked ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="mut" icon="info" title="You can't question this one" text={blocked} testID="banner-blocked" />
        </View>
      ) : (
        <>
          <Txt v="d22" style={{ marginTop: 20 }}>
            What's wrong with it?
          </Txt>
          <View style={{ marginTop: 8 }}>
            {DISPUTE_CHOICES.map((x, i) => {
              const on = choice === x.key;
              return (
                <Pressable
                  key={x.key}
                  testID={`radio-reason-${x.key}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={x.label}
                  onPress={() => setChoice(x.key)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderBottomWidth: i === DISPUTE_CHOICES.length - 1 ? 0 : 1, borderBottomColor: c.line }}
                >
                  <Radio on={on} />
                  <Txt v="lt">
                    {x.label}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
          <View style={{ marginTop: 12 }}>
            <Field label="Note for the group" value={note} onChangeText={setNote} placeholder="Say what happened" maxLength={200} multiline testID="field-note" />
          </View>
          <View style={{ marginTop: 12, gap: 8 }}>
            <Banner
              kind="inf"
              icon="scale"
              title="What happens next"
              text={`Everyone else votes for 48 hours. If most say ${theirName} should cover it, ${formatUsd(amount)} moves to ${who.me ? "your" : "their"} share. ${who.me ? "You" : who.name} can also settle it straight away. Nothing is charged now.`}
            />
            {send.error ? <Banner kind="neg" icon="alert" title={send.error.title} text={send.error.message} testID="banner-action-error" /> : null}
          </View>
        </>
      )}
    </DeskColumn>
    </Screen>
  );
}
