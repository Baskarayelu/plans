import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import { Platform, View } from "react-native";
import { failureKind, passkeyNotice, type PasskeyContext, type PasskeyNotice } from "../lib/identity/flows";
import { createOrRestore, identity, restoreWithPasskey } from "../lib/identity/session";
import { usePasskeyWait } from "../lib/identity/usePasskeyWait";
import { createAsNew, signInWithPhone, webCreateStart } from "../lib/identity/webCreate";
import { useColors } from "../theme/ThemeProvider";
import { WRISTBANDS } from "../theme/tokens";
import { Avatar, Band, Banner, Btn, Logo, Row } from "../ui/kit";
import { EntryHeader, EntrySplit, PhoneQrRow, useEntryRoomy } from "../ui/desk/entry";
import { Screen } from "../ui/layout";
import { useLayout } from "../ui/shell/responsive";
import { Txt } from "../ui/Text";

/**
 * 01/125 Welcome. Create account → 02 (Android's own passkey sheet) → 03. I already use Plans → 04 → 05.
 * 126: if the sheet takes over a second, the button says so. 127–129: a cancel, a phone without
 * passkeys, or a failure each get a banner that says what happened and what to do next.
 */
export default function Welcome() {
  const c = useColors();
  const { desk } = useLayout();
  const roomy = useEntryRoomy();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [busy, setBusy] = useState<PasskeyContext | null>(null);
  const [notice, setNotice] = useState<(PasskeyNotice & { ctx: PasskeyContext }) | null>(null);
  const wait = usePasskeyWait();
  const inFlight = useRef(false);
  const runId = useRef(0);
  // Web: "Create account" first asks the browser for any Plans passkey; when none is picked the person
  // chooses (lib/identity/webCreate.ts). INTERIM choice UI with approved components until design 166 is approved.
  const [choose, setChoose] = useState(false);

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
      if (ctx === "create" && Platform.OS === "web") {
        const r = await webCreateStart();
        if (current()) wait.finish("ok");
        if (r.kind === "restored") after(true);
        else if (current()) setChoose(true);
      } else if (ctx === "create") {
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

  const runChoice = async (which: "phone" | "new") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setNotice(null);
    setBusy("create");
    try {
      if (which === "phone") {
        await signInWithPhone();
        setChoose(false);
        after(true);
      } else {
        await createAsNew("Plans");
        setChoose(false);
        after(false);
      }
    } catch (e) {
      const kind = failureKind(e);
      // The phone's passkey answered but can't open Plans here: that's what "Link this browser" is for (pending design 166–170).
      setNotice({ ...passkeyNotice(kind, which === "phone" ? "restore" : "create"), ctx: "create" });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  // 129 when the sheet hasn't appeared after 15 s: say so and let them try again.
  const stuck = wait.phase === "stuck";
  const shown = stuck && busy ? { ...passkeyNotice("stuck", busy), ctx: busy } : notice;
  const waiting = wait.phase === "waiting" && !!busy;

  let primary = (() => {
    if (waiting && busy === "create") return <Btn label="Opening passkey…" loading disabled testID="btn-create-account" />;
    if (!shown || stuck) {
      if (shown && stuck) return <Btn label="Try again" icon="refresh" onPress={() => void run(shown.ctx === "restore" ? "restore" : "create")} testID="btn-try-again" />;
      return <Btn label="Create account" icon="fp" onPress={() => void run("create")} testID="btn-create-account" />;
    }
    if (shown.action === "setup") return <Btn label="How to turn it on" onPress={() => router.push({ pathname: "/unsupported", params: { why: shown.kind } })} testID="btn-how-to-turn-it-on" />;
    if (shown.action === "create") return <Btn label="Create account" icon="fp" onPress={() => void run("create")} testID="btn-create-account" />;
    return <Btn label="Try again" icon={shown.kind === "cancelled" ? "fp" : "refresh"} onPress={() => void run(shown.ctx === "restore" ? "restore" : "create")} testID="btn-try-again" />;
  })();

  let secondary = (() => {
    if (waiting && busy === "restore") return <Btn label="Opening passkey…" kind="sec" loading disabled style={{ marginTop: 8 }} testID="btn-restore" />;
    if (waiting) return <Btn label="I already use Plans" kind="off" disabled style={{ marginTop: 8 }} testID="btn-restore" />;
    if (shown && !stuck && (shown.action === "setup" || shown.action === "create"))
      return <Btn label="Try again" kind="sec" onPress={() => void run(shown.ctx === "restore" ? "restore" : "create")} style={{ marginTop: 8 }} testID="btn-try-again-secondary" />;
    if (shown && !stuck && shown.ctx === "restore") return <Btn label="Create account" kind="sec" onPress={() => void run("create")} style={{ marginTop: 8 }} testID="btn-create-account-secondary" />;
    return <Btn label="I already use Plans" kind="sec" onPress={() => void run("restore")} style={{ marginTop: 8 }} testID="btn-restore" />;
  })();

  let noticeEl = shown ? <Banner kind={shown.tone} icon={shown.icon} title={shown.title} text={shown.text} testID={`welcome-notice-${shown.kind}`} /> : null;
  if (choose) {
    noticeEl = (
      <View style={{ gap: 8 }}>
        <Banner kind="inf" icon="key" title="Use Plans on your phone already?" text="Use your phone's passkey to bring your account here. Plans never makes a second account unless you say you're new." testID="welcome-choice" />
        {shown ? <Banner kind={shown.tone} icon={shown.icon} title={shown.title} text={shown.text} testID={`welcome-notice-${shown.kind}`} /> : null}
      </View>
    );
    primary = <Btn label="Use your phone's passkey" icon="phone" loading={!!busy} disabled={!!busy} onPress={() => void runChoice("phone")} testID="btn-use-phone" />;
    secondary = <Btn label="I'm new to Plans" kind="sec" disabled={!!busy} onPress={() => void runChoice("new")} style={{ marginTop: 8 }} testID="btn-new-to-plans" />;
  }

  if (desk) {
    // 102 on a laptop: the bands on the left, one clear choice on the right (130 puts the notice above the buttons).
    return (
      <Screen testID="screen-welcome" pad={false} scroll={false} bottomInset={false}>
        <EntrySplit>
          <View style={{ flex: 1, paddingTop: 56, paddingBottom: 40, paddingHorizontal: roomy ? 88 : 56, minHeight: 640 }}>
            <EntryHeader />
            <View style={{ flex: 1, minHeight: 32 }} />
            <Txt v="d56" style={roomy ? { fontSize: 64, lineHeight: 64, letterSpacing: -2.8 } : { fontSize: 52, lineHeight: 54, letterSpacing: -2.2 }} accessibilityRole="header">
              One pot for the{"\n"}whole plan.
            </Txt>
            <Txt v="t17" color="muted" style={{ fontSize: 19, lineHeight: 27, marginTop: 16, marginBottom: 28, maxWidth: 520 }}>
              Friends anywhere chip in, spend under rules you agree, and settle up in one tap. Right here in your browser.
            </Txt>
            {noticeEl ? <View style={{ marginBottom: 20, maxWidth: 520 }}>{noticeEl}</View> : null}
            <View style={{ width: 400, maxWidth: "100%" }}>
              {primary}
              {secondary}
            </View>
            <Txt v="t13" color="muted" style={{ marginTop: 14, maxWidth: 460 }} testID="welcome-foot">
              {waiting
                ? "Your browser is getting the passkey ready."
                : "No passwords. Your browser saves a passkey, unlocked with your fingerprint, face or screen lock. Your phone can do it instead."}
            </Txt>
            <View style={{ flex: 1, minHeight: 32 }} />
            <PhoneQrRow />
          </View>
        </EntrySplit>
      </Screen>
    );
  }

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
      {noticeEl ? <View style={{ marginBottom: 12 }}>{noticeEl}</View> : null}
      {primary}
      {secondary}
      <Txt v="t13" color="muted" center style={{ marginTop: 12 }} testID="welcome-foot">
        {waiting ? "Your phone is getting the passkey ready." : "No passwords. Your fingerprint is your key."}
      </Txt>
    </Screen>
  );
}
