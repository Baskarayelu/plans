/** 33 Pause spending: an emergency brake anyone in the plan can pull (Pot.freeze). */
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Address } from "viem";
import { freeze } from "../../../lib/chain/actions";
import { majority } from "../../../lib/ending/ruleDiff";
import { queryClient, qk, usePlan } from "../../../lib/state/data";
import { useAction } from "../../../lib/state/useAction";
import { useColors } from "../../../theme/ThemeProvider";
import { dayMonth, PlanProblem, PlanSkeleton, timeOfDay } from "../../../ui/ending/common";
import { Icon, type IconName } from "../../../ui/Icon";
import { Banner, BigIcon, Btn, Btns, Card, Hero, Overline } from "../../../ui/kit";
import { Screen } from "../../../ui/layout";
import { PlanTop, useMoney } from "../../../ui/plan/common";
import { Txt } from "../../../ui/Text";
import { showToast } from "../../../ui/Toast";

function Line({ icon, children }: { icon: IconName; children: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
      <Icon name={icon} size={18} color={c.muted} />
      <Txt v="t13" style={{ flex: 1 }}>
        {children}
      </Txt>
    </View>
  );
}

export default function PauseSpending() {
  const { pot } = useLocalSearchParams<{ pot: string }>();
  const c = useColors();
  const ins = useSafeAreaInsets();
  const q = usePlan(pot);
  const money = useMoney();
  const act = useAction(async () => {
    const r = await freeze(pot as Address);
    await queryClient.invalidateQueries({ queryKey: qk.plan(pot) });
    return r;
  });

  if (q.isLoading) return <PlanSkeleton title="Pause spending" />;
  if (q.isError || !q.data) return <PlanProblem title="Pause spending" missing={!q.isError} onRetry={() => void q.refetch()} />;
  const plan = q.data;
  const active = plan.raw.activeMemberCount;
  const need = majority(active);
  const close = () => (router.canGoBack() ? router.back() : router.replace({ pathname: "/plan/[pot]", params: { pot: plan.pot } }));
  const balance = BigInt(plan.raw.balance);

  const pauseNow = async () => {
    const r = await act.run();
    if (!r) return;
    showToast({ title: "Spending is paused", sub: `${plan.meta.name} · everyone has been told`, emoji: "⏸️" });
    close();
  };

  let blocked: string | null = null;
  if (plan.settled) blocked = "This plan is settled, so there's nothing to pause.";
  else if (!plan.isMember) blocked = "Only people in the plan can pause it.";

  return (
    <Screen scroll={false} pad={false} bottomInset={false} testID="screen-pause">
      {/* the plan, dimmed behind the sheet */}
      <View style={{ paddingHorizontal: 16, opacity: 0.6 }} pointerEvents="none">
        <PlanTop plan={plan} right={<View />} />
        <Card style={{ marginTop: 12 }}>
          <Overline>In the pot</Overline>
          <View style={{ marginTop: 4 }}>
            <Hero big={money.usd(balance)} small={money.local(balance)} />
          </View>
        </Card>
      </View>
      <Pressable style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.scrim }} onPress={close} accessibilityLabel="Close" testID="sheet-scrim" />
      <View
        testID="sheet-pause"
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, paddingHorizontal: 16, paddingBottom: 24 + ins.bottom }}
      >
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.muted, opacity: 0.45, alignSelf: "center", marginBottom: 18 }} />
        <View style={{ alignSelf: "flex-start" }}>
          <BigIcon icon="pause" kind="n" size={56} />
        </View>
        <Txt v="d22" style={{ marginTop: 12 }}>
          {plan.frozen ? "Spending is paused" : "Pause spending?"}
        </Txt>
        <Txt v="t15" color="muted" style={{ marginTop: 6, marginBottom: 12 }}>
          {plan.frozen
            ? `No one can pay from the pot until the group votes to resume, or until ${timeOfDay(plan.frozenUntil)} on ${dayMonth(plan.frozenUntil)} at the latest. The money stays put.`
            : "No one can pay from the pot until the group votes to resume, or for 24 hours. The money stays put."}
        </Txt>
        <View style={{ gap: 8 }}>
          <Line icon="phone">Use it if a phone is lost or a spend looks wrong.</Line>
          <Line icon="bell">Everyone is told straight away.</Line>
          <Line icon="vote">{`Resuming needs ${need} of ${active} to agree.`}</Line>
          <Line icon="info">Adding money, questions and ending the plan still work while it's paused.</Line>
        </View>
        {blocked ? (
          <View style={{ marginTop: 16 }}>
            <Banner kind="mut" icon="info" title={blocked} />
          </View>
        ) : null}
        {act.error ? (
          <View style={{ marginTop: 16 }}>
            <Banner kind="neg" icon="alert" title={act.error.code === "FREEZE_COOLDOWN" ? "You paused recently" : act.error.title} text={act.error.code === "FREEZE_COOLDOWN" ? "Each person can pause a plan once every 24 hours. Anyone else in the plan can still pause it." : act.error.message} testID="pause-error" />
          </View>
        ) : null}
        <Btns style={{ marginTop: 16 }}>
          <Btn label="Cancel" kind="sec" onPress={close} />
          {plan.frozen ? (
            <Btn label="Already paused" kind="off" icon="pause" disabled testID="btn-already-paused" />
          ) : (
            <Btn label="Pause now" kind="dng" icon="pause" loading={act.busy} disabled={!!blocked} onPress={() => void pauseNow()} testID="btn-pause-now" />
          )}
        </Btns>
      </View>
    </Screen>
  );
}
