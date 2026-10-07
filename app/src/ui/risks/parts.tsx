/** Pieces of "What could go wrong" (144–148) shared by the phone pages and the laptop panel. */
import { router } from "expo-router";
import * as Linking from "expo-linking";
import React from "react";
import { View } from "react-native";
import { useColors } from "../../theme/ThemeProvider";
import { fonts, mix } from "../../theme/tokens";
import { Icon } from "../Icon";
import { Btn } from "../kit";
import { Txt } from "../Text";
import { ABOUT_DOLLARS_LABEL, WITHOUT_SERVICE_GUIDE_URL, type RiskTopic } from "./content";

export function RiskBox({ yes, items, testID, compact }: { yes: boolean; items: string[]; testID: string; compact?: boolean }) {
  const c = useColors();
  const k = yes ? c.pos : c.neg;
  return (
    <View testID={testID} style={{ backgroundColor: mix(k, 0.1, c.surface), borderRadius: compact ? 10 : 14, padding: compact ? 12 : 14, gap: compact ? 4 : 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={yes ? "check" : "x"} size={14} strokeWidth={2.6} color={k} />
        <Txt style={{ fontFamily: fonts.monoSemi, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: k }}>{compact ? (yes ? "Protects you" : "Doesn't") : yes ? "What protects you" : "What doesn't"}</Txt>
      </View>
      {compact
        ? items.map((x, i) => (
            <Txt key={i} v="t13">
              {x}
            </Txt>
          ))
        : items.map((x, i) => (
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

export function RiskActions({ t, pot, planName, onAbout }: { t: RiskTopic; pot?: string; planName?: string; onAbout: () => void }) {
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
      return <Btn label={ABOUT_DOLLARS_LABEL} kind="sec" icon="info" onPress={onAbout} testID="btn-risk-about-digital-dollars" />;
  }
}
