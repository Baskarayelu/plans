import { router } from "expo-router";
import React from "react";
import { View } from "react-native";
import { identity } from "../lib/identity/session";
import { useStore } from "../lib/state/observable";
import { useColors } from "../theme/ThemeProvider";
import { Avatar, Btn, Card, Pill, Row, Tile } from "../ui/kit";
import { AppBar, Screen } from "../ui/layout";
import { Txt } from "../ui/Text";
import type { IconName } from "../ui/Icon";
import { DeskColumn, KeyWhy } from "../ui/desk/money";
import { useLayout } from "../ui/shell/responsive";

function Why({ icon, children }: { icon: IconName; children: string }) {
  return (
    <Row align="flex-start" gap={14}>
      <Tile icon={icon} />
      <Txt v="t15" style={{ flex: 1, marginTop: 2 }}>
        {children}
      </Txt>
    </Row>
  );
}

/** 54 Your key: what the three pictures mean, in plain words. */
export default function YourKey() {
  const c = useColors();
  const st = useStore(identity, (s) => s);
  const parts = st.fingerprint ? Array.from(st.fingerprint) : ["·", "·", "·"];
  const { desk } = useLayout();
  return (
    <Screen testID="screen-key" dock={<Btn label={st.keysPending ? "Unlock my key" : "Got it"} kind="sec" onPress={() => (st.keysPending ? router.push("/unlock-keys") : router.back())} testID="btn-got-it" />}>
      <DeskColumn>
      <AppBar title="Your key" />
      <View style={{ alignItems: "center", marginTop: 8 }}>
        <Txt v="ov" color="muted">
          Key fingerprint
        </Txt>
        <View style={{ flexDirection: "row", gap: 14, marginTop: 12, paddingVertical: 14, paddingHorizontal: 22, borderRadius: 999, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
          {parts.map((e, i) => (
            <Txt key={i} style={{ fontSize: 44, lineHeight: 52 }} testID={`key-emoji-${i}`}>
              {e}
            </Txt>
          ))}
        </View>
      </View>
      <Txt v="d22" style={{ marginTop: 24 }}>
        Your receipts are locked to your plans
      </Txt>
      {desk ? (
        <View style={{ marginTop: 16 }}>
          <KeyWhy />
        </View>
      ) : (
      <View style={{ gap: 16, marginTop: 16 }}>
        <Why icon="lock">Receipt photos and notes are scrambled before they leave your phone. Only people in that plan can open them.</Why>
        <Why icon="key">Your key comes from your passkey. Use Plans on a new phone and you get the same key, so nothing is lost.</Why>
        <Why icon="eye">Plans can't see your photos or notes. Neither can anyone outside the plan.</Why>
        <Why icon="users">The three pictures are a short name for your key. Friends see the same three next to your name. If they change and you didn't get a new phone, tell us.</Why>
      </View>
      )}
      <Card tint style={{ marginTop: 20 }}>
        <Txt v="ov" color="muted">
          How friends see you
        </Txt>
        <Row style={{ marginTop: 8 }}>
          <Avatar initial={(st.profile?.name?.[0] ?? "?").toUpperCase()} color="#D9634B" size={36} />
          <Txt v="lt" style={{ flex: 1 }}>
            {st.profile?.name ?? "You"}
          </Txt>
          <Pill>
            <Txt style={{ fontSize: 15, letterSpacing: 3 }}>{st.fingerprint ?? "· · ·"}</Txt>
          </Pill>
        </Row>
      </Card>
      </DeskColumn>
    </Screen>
  );
}
