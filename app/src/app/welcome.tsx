import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import { View } from "react-native";
import { failureKind, passkeyNotice, type PasskeyContext, type PasskeyNotice } from "../lib/identity/flows";
import { createOrRestore, identity, restoreWithPasskey } from "../lib/identity/session";
import { usePasskeyWait } from "../lib/identity/usePasskeyWait";
import { useColors } from "../theme/ThemeProvider";
import { WRISTBANDS } from "../theme/tokens";
import { Avatar, Band, Banner, Btn, Logo, Row } from "../ui/kit";
import { Screen } from "../ui/layout";
import { Txt } from "../ui/Text";

/**
 * 01/125 Welcome. Create account → 02 (Android's own passkey sheet) → 03. I already use Plans → 04 → 05.
 * 126: if the sheet takes over a second, the button says so. 127–129: a cancel, a phone without
 * passkeys, or a failure each get a banner that says what happened and what to do next.
 */
export default function Welcome() {
  const c = useColors();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [busy, setBusy] = useState<PasskeyContext | null>(null);
  const [notice, setNotice] = useState<(PasskeyNotice & { ctx: PasskeyContext }) | null>(null);
  const wait = usePasskeyWait();
  const inFlight = useRef(false);
  const runId = useRef(0);

  const after = (restored: boolean) => {
    const hasProfile = !!identity.get().profile;
    if (restored) router.replace({ pathname: "/restored", params: next ? { next } : {} });
    else if (!hasProfile) router.replace({ pathname: "/profile", params: next ? { next } : {} });
    else router.replace((next as never) ?? "/(tabs)");
  };

  const run = async (ctx: "create" | "restore") => {
    // A second tap while the first is still waiting does nothing (and nothing changes on screen
    // for the first second, 126), except after 15 s when "Try again" is offered.
    if (inFlight.current && wait.phase !== "stuck") return;
    inFlight.current = true;
    const id = ++runId.current;
    const current = () => id === runId.current;
    setNotice(null);
    setBusy(ctx);
    wait.start(ctx);
    try {
      if (ctx === "create") {
        const r = await createOrRestore("Plans");
        if (current()) wait.finish("ok");
        after(r.restored);
      } else {
        await restoreWithPasskey();
        if (current()) wait.finish("ok");
        after(true);
      }
    } catch (e) {
      if (!current()) return;
      const kind = failureKind(e);
      wait.finish(kind);
      setNotice({ ...passkeyNotice(kind, ctx), ctx });
    } finally {
      if (current()) {
        inFlight.current = false;
        setBusy(null);
      }
    }
  };

  // 129 when the sheet hasn't appeared after 15 s: say so and let them try again.
  const stuck = wait.phase === "stuck";
  const shown = stuck && busy ? { ...passkeyNotice("stuck", busy), ctx: busy } : notice;
  const waiting = wait.phase === "waiting" && !!busy;

  const primary = (() => {
    if (waiting && busy === "create") return <Btn label="Opening passkey…" loading disabled testID="btn-create-account" />;
    if (!shown || stuck) {
      if (shown && stuck) return <Btn label="Try again" icon="refresh" onPress={() => void run(shown.ctx === "restore" ? "restore" : "create")} testID="btn-try-again" />;
      return <Btn label="Create account" icon="fp" onPress={() => void run("create")} testID="btn-create-account" />;
    }
    if (shown.action === "setup") return <Btn label="How to turn it on" onPress={() => router.push({ pathname: "/unsupported", params: { why: shown.kind } })} testID="btn-how-to-turn-it-on" />;
    if (shown.action === "create") return <Btn label="Create account" icon="fp" onPress={() => void run("create")} testID="btn-create-account" />;
    return <Btn label="Try again" icon={shown.kind === "cancelled" ? "fp" : "refresh"} onPress={() => void run(shown.ctx === "restore" ? "restore" : "create")} testID="btn-try-again" />;
  })();

  const secondary = (() => {
    if (waiting && busy === "restore") return <Btn label="Opening passkey…" kind="sec" loading disabled style={{ marginTop: 8 }} testID="btn-restore" />;
    if (waiting) return <Btn label="I already use Plans" kind="off" disabled style={{ marginTop: 8 }} testID="btn-restore" />;
    if (shown && !stuck && (shown.action === "setup" || shown.action === "create"))
      return <Btn label="Try again" kind="sec" onPress={() => void run(shown.ctx === "restore" ? "restore" : "create")} style={{ marginTop: 8 }} testID="btn-try-again-secondary" />;
    if (shown && !stuck && shown.ctx === "restore") return <Btn label="Create account" kind="sec" onPress={() => void run("create")} style={{ marginTop: 8 }} testID="btn-create-account-secondary" />;
    return <Btn label="I already use Plans" kind="sec" onPress={() => void run("restore")} style={{ marginTop: 8 }} testID="btn-restore" />;
  })();

  return (
    <Screen testID="screen-welcome">
      <Row style={{ height: 52 }}>
        <Logo size={22} />
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
      {shown ? (
        <View style={{ marginBottom: 12 }}>
          <Banner kind={shown.tone} icon={shown.icon} title={shown.title} text={shown.text} testID={`welcome-notice-${shown.kind}`} />
        </View>
      ) : null}
      {primary}
      {secondary}
      <Txt v="t13" color="muted" center style={{ marginTop: 12 }} testID="welcome-foot">
        {waiting ? "Your phone is getting the passkey ready." : "No passwords. Your fingerprint is your key."}
      </Txt>
    </Screen>
  );
}
