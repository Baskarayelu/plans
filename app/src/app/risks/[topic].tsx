/**
 * 144 Lost phone · 145 Someone won't pay · 146 Plans' service is down · 147 Digital dollar frozen.
 * What protects you, what doesn't, and what to do. `?pot=` (from a plan) makes the buttons go to
 * that plan.
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { usePlan } from "../../lib/state/data";
import { AboutDollarsSheet } from "../../ui/agora/dollars";
import { BigIcon, Btn } from "../../ui/kit";
import { DeskScreen } from "../../ui/desk/money";
import { AppBar } from "../../ui/layout";
import { riskTopic } from "../../ui/risks/content";
import { RiskActions as Actions, RiskBox as Box } from "../../ui/risks/parts";
import { Txt } from "../../ui/Text";

export default function RiskDetail() {
  const { topic, pot } = useLocalSearchParams<{ topic: string; pot?: string }>();
  const t = riskTopic(topic);
  const plan = usePlan(pot);
  const [about, setAbout] = useState(false);
  if (!t) {
    return (
      <DeskScreen testID="screen-risk-missing">
        <AppBar title="What could go wrong" />
        <Txt v="t15" color="muted">
          That page isn't here.
        </Txt>
        <Btn label="See all" kind="sec" onPress={() => router.replace("/risks")} style={{ marginTop: 16 }} testID="btn-risks-see-all" />
      </DeskScreen>
    );
  }
  return (
    <DeskScreen testID={`screen-risk-${t.id}`}>
      <AppBar title="" sub="What could go wrong" />
      <View style={{ alignSelf: "flex-start" }}>
        <BigIcon icon={t.icon} kind={t.kind} size={56} />
      </View>
      <Txt v="d28" style={{ marginTop: 12 }}>
        {t.title}
      </Txt>
      <Txt v="t15" style={{ marginTop: 8, marginBottom: 14 }}>
        {t.summary}
      </Txt>
      <Box yes items={t.yes} testID="risk-protects" />
      <View style={{ height: 8 }} />
      <Box yes={false} items={t.no} testID="risk-doesnt" />
      {t.todo ? (
        <>
          <Txt v="ov" color="muted" style={{ marginTop: 16 }}>
            What to do
          </Txt>
          <Txt v="t15" style={{ marginTop: 4 }}>
            {t.todo}
          </Txt>
        </>
      ) : null}
      <View style={{ flex: 1, minHeight: 16 }} />
      <Actions t={t} pot={pot} planName={plan.data?.meta.name} onAbout={() => setAbout(true)} />
      <AboutDollarsSheet visible={about} onClose={() => setAbout(false)} />
    </DeskScreen>
  );
}
