import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { handlePasskeyFailure } from "../lib/identity/flows";
import { createOrRestore, identity, restoreWithPasskey } from "../lib/identity/session";
import { useColors } from "../theme/ThemeProvider";
import { WRISTBANDS } from "../theme/tokens";
import { Avatar, Band, Btn, Chip, Logo, Row } from "../ui/kit";
import { Screen } from "../ui/layout";
import { Txt } from "../ui/Text";

/** 01 Welcome. Create account → 02 (Android's own passkey sheet) → 03. I already use Plans → 04 → 05. */
export default function Welcome() {
  const c = useColors();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [busy, setBusy] = useState<"create" | "restore" | null>(null);
  const [msg, setMsg] = useState<string | undefined>();

  const after = (restored: boolean) => {
    const hasProfile = !!identity.get().profile;
    if (restored) router.replace({ pathname: "/restored", params: next ? { next } : {} });
    else if (!hasProfile) router.replace({ pathname: "/profile", params: next ? { next } : {} });
    else router.replace((next as never) ?? "/(tabs)");
  };

  const create = async () => {
    setMsg(undefined);
    setBusy("create");
    try {
      const r = await createOrRestore("Plans");
      after(r.restored);
    } catch (e) {
      setMsg(handlePasskeyFailure(e).inline);
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setMsg(undefined);
    setBusy("restore");
    try {
      await restoreWithPasskey();
      after(true);
    } catch (e) {
      setMsg(handlePasskeyFailure(e).inline);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen testID="screen-welcome">
      <Row between style={{ height: 52 }}>
        <Logo size={22} />
        <Chip label="English" ol sm />
      </Row>
      <View style={{ height: 330, marginHorizontal: -16, overflow: "hidden" }}>
        <Band color={WRISTBANDS.lagoon} text="LISBON · 12–16 OCT · 4 PEOPLE" style={{ position: "absolute", width: 600, top: 34, left: -150, transform: [{ rotate: "-11deg" }] }} />
        <Band color={WRISTBANDS.orchid} text="GLASTONBURY CREW · 24–28 JUN" style={{ position: "absolute", width: 600, top: 118, left: -70, transform: [{ rotate: "6deg" }] }} />
        <Band color={WRISTBANDS.marigold} text="BEN'S 30TH · SAT 7 NOV" style={{ position: "absolute", width: 600, top: 200, left: -190, transform: [{ rotate: "-5deg" }] }} />
        <Band color={WRISTBANDS.lime} text="SKI WEEK · FEB · 6 PEOPLE" style={{ position: "absolute", width: 600, top: 270, left: -100, transform: [{ rotate: "8deg" }] }} />
        {[
          ["M", "#D9634B", 54, 36, 62, "🇬🇧"],
          ["S", "#3C78B8", 46, 296, 30, "🇺🇸"],
          ["A", "#8C5CC4", 52, 262, 214, "🇮🇳"],
          ["B", "#2B8A5F", 44, 64, 246, "🇬🇧"],
        ].map(([i, col, s, x, y, f]) => (
          <View key={String(i)} style={{ position: "absolute", left: Number(x), top: Number(y), borderRadius: 999, borderWidth: 3, borderColor: c.bg }}>
            <Avatar initial={String(i)} color={String(col)} size={Number(s)} flag={String(f)} />
          </View>
        ))}
      </View>
      <Txt v="d34" style={{ fontSize: 38, lineHeight: 40 }}>
        One pot for the{"\n"}whole plan.
      </Txt>
      <Txt v="t17" color="muted" style={{ marginTop: 12 }}>
        Friends anywhere chip in, spend under rules you agree, and settle up in one tap.
      </Txt>
      <View style={{ flex: 1, minHeight: 16 }} />
      {msg ? (
        <Txt v="t13" color="neg" center style={{ marginBottom: 8 }} testID="welcome-message">
          {msg}
        </Txt>
      ) : null}
      <Btn label="Create account" icon="fp" onPress={create} loading={busy === "create"} disabled={!!busy} testID="btn-create-account" />
      <Btn label="I already use Plans" kind="sec" onPress={restore} loading={busy === "restore"} disabled={!!busy} style={{ marginTop: 8 }} testID="btn-restore" />
      <Txt v="t13" color="muted" center style={{ marginTop: 12 }}>
        No passwords. Your fingerprint is your key.
      </Txt>
    </Screen>
  );
}
