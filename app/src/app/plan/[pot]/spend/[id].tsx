/**
 * 29 Spend detail: the receipt photo (opened with the group key), the note, who shares it (each
 * in their own money), rule and rate, Proof, and "Question this spend" while questions are open.
 * On a laptop the plan stays in the main column and the spend opens in the right-hand panel (109).
 */
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { View } from "react-native";
import { useSpendDetail } from "../../../../lib/spend/hooks";
import { usePlan, type PlanVM } from "../../../../lib/state/data";
import { SpendPanel } from "../../../../ui/desk/plan";
import { SpendDetailBody } from "../../../../ui/desk/spend";
import { SidePanel } from "../../../../ui/shell/panel";
import { useLayout } from "../../../../ui/shell/responsive";
import PlanHome from "../index";
import { ErrorScreen, LoadingScreen, PlanGate } from "../../../../ui/spend/parts";

export default function SpendDetailScreen() {
  const { pot, id } = useLocalSearchParams<{ pot: string; id: string }>();
  const q = usePlan(pot);
  const { desk } = useLayout();
  // 109: on a laptop a spend's own URL shows the plan with the spend open in the right panel.
  if (desk)
    return (
      <>
        <PlanHome />
        <SidePanel kind="detail" onClose={() => (router.canGoBack() ? router.back() : router.replace({ pathname: "/plan/[pot]", params: { pot } }))}>
          {q.data ? <SpendPanel plan={q.data} id={id} /> : <View testID="screen-spend" />}
        </SidePanel>
      </>
    );
  return (
    <PlanGate q={q} testID="screen-spend">
      {(plan) => <Loader plan={plan} id={id} />}
    </PlanGate>
  );
}

function Loader({ plan, id }: { plan: PlanVM; id: string }) {
  const s = useSpendDetail(plan.pot, id, 15_000);
  if (s.isLoading) return <LoadingScreen testID="screen-spend" />;
  if (s.isError && !s.data) return <ErrorScreen onRetry={() => void s.refetch()} testID="screen-spend" />;
  if (!s.data) return <ErrorScreen title="Spend" message="We couldn't find this spend yet. It may still be arriving." onRetry={() => void s.refetch()} testID="screen-spend" />;
  return <SpendDetailBody plan={plan} s={s.data} />;
}

