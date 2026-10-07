/**
 * 144 Lost phone · 145 Someone won't pay · 146 Plans' service is down · 147 Digital dollar frozen.
 * What protects you, what doesn't, and what to do. `?pot=` (from a plan) makes the buttons go to
 * that plan.
 */
import { router, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import React, { useState } from "react";
import { View } from "react-native";
import { usePlan } from "../../lib/state/data";
import { useColors } from "../../theme/ThemeProvider";
import { fonts, mix } from "../../theme/tokens";
import { AboutDollarsSheet } from "../../ui/agora/dollars";
import { Icon } from "../../ui/Icon";
import { BigIcon, Btn } from "../../ui/kit";
import { AppBar, Screen } from "../../ui/layout";
import { riskTopic, WITHOUT_SERVICE_GUIDE_URL, type RiskTopic } from "../../ui/risks/content";
import { Txt } from "../../ui/Text";

function Box({ yes, items, testID }: { yes: boolean; items: string[]; testID: string }) {
  const c = useColors();
  const k = yes ? c.pos : c.neg;
  return (
    <View testID={testID} style={{ backgroundColor: mix(k, 0.1, c.surface), borderRadius: 14, padding: 14, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={yes ? "check" : "x"} size={14} strokeWidth={2.6} color={k} />
        <Txt style={{ fontFamily: fonts.monoSemi, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: k }}>{yes ? "What protects you" : "What doesn't"}</Txt>
      </View>
      {items.map((x, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8 }}>
          <Txt v="t15" color="muted">
            •
          </Txt>
          <Txt v="t15" style={{ flex: 1 }}>
            {x}
          </Txt>
        </View>
      ))}
    </View>
  );
}

function Actions({ t, pot, planName, onAbout }: { t: RiskTopic; pot?: string; planName?: string; onAbout: () => void }) {
  switch (t.id) {
    case "lost-phone":
      return (
        <>
          <Btn label="Check my passkey" icon="key" onPress={() => router.push("/key")} testID="btn-check-my-passkey" />
          <Btn
            label="Pause a plan"
            kind="sec"
            icon="pause"
            onPress={() => (pot ? router.push({ pathname: "/plan/[pot]/pause", params: { pot } }) : router.navigate("/(tabs)"))}
            style={{ marginTop: 8 }}
            testID="btn-risk-pause-a-plan"
          />
        </>
      );
    case "wont-pay":
      return pot ? <Btn label={planName ? `See ${planName}'s rules` : "See the plan's rules"} icon="note" onPress={() => router.push({ pathname: "/plan/[pot]/members", params: { pot } })} testID="btn-see-plan-rules" /> : null;
    case "service-down":
      return <Btn label="Guide: sending directly" kind="sec" icon="out" onPress={() => void Linking.openURL(WITHOUT_SERVICE_GUIDE_URL)} testID="btn-guide-sending-directly" />;
    case "frozen":
      return <Btn label="About digital dollars" kind="sec" icon="info" onPress={onAbout} testID="btn-risk-about-digital-dollars" />;
  }
}

export default function RiskDetail() {
  const { topic, pot } = useLocalSearchParams<{ topic: string; pot?: string }>();
  const t = riskTopic(topic);
  const plan = usePlan(pot);
  const [about, setAbout] = useState(false);
  if (!t) {
    return (
      <Screen testID="screen-risk-missing">
        <AppBar title="What could go wrong" />
        <Txt v="t15" color="muted">
          That page isn't here.
        </Txt>
        <Btn label="See all" kind="sec" onPress={() => router.replace("/risks")} style={{ marginTop: 16 }} testID="btn-risks-see-all" />
      </Screen>
    );
  }
  return (
    <Screen testID={`screen-risk-${t.id}`}>
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
    </Screen>
  );
}
