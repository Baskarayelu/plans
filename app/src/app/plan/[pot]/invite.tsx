/** 13 Invite friends: QR + link, share, turn off / make a new link, live "joined" avatars. */
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, Share, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createdInviteFor } from "../../../lib/core/draft";
import { toHex } from "../../../lib/crypto/bytes";
import { displayLink, parseLink } from "../../../lib/domain/links";
import { currentInviteUrl, newInviteLink, turnOffInvite } from "../../../lib/domain/planOps";
import { qk, queryClient, usePlan } from "../../../lib/state/data";
import { useAction } from "../../../lib/state/useAction";
import { useColors } from "../../../theme/ThemeProvider";
import { activePeople } from "../../../ui/core/PlanCore";
import { Icon } from "../../../ui/Icon";
import { Banner, Btn, Btns, IconBtn, Row, Skel, Wristband } from "../../../ui/kit";
import { AppBar, Screen } from "../../../ui/layout";
import { People } from "../../../ui/plan/common";
import { dateRange } from "../../../ui/planBits";
import { showToast } from "../../../ui/Toast";
import { Txt } from "../../../ui/Text";

function signerOf(url: string | null): string | null {
  if (!url) return null;
  const l = parseLink(url);
  if (!l || l.kind !== "invite") return null;
  return privateKeyToAccount(toHex(l.secret)).address.toLowerCase();
}

export default function Invite() {
  const { pot: potParam, fresh } = useLocalSearchParams<{ pot: string; fresh?: string }>();
  const pot = (potParam ?? "").toLowerCase();
  const c = useColors();
  const plan = usePlan(pot);
  const [url, setUrl] = useState<string | null>(() => currentInviteUrl(pot) ?? createdInviteFor(pot) ?? null);
  const [turnedOff, setTurnedOff] = useState(false);

  const off = useAction(async () => {
    await turnOffInvite(pot as Address);
    void queryClient.invalidateQueries({ queryKey: qk.plan(pot) });
    return true;
  });
  const make = useAction(async () => {
    const u = await newInviteLink(pot as Address);
    void queryClient.invalidateQueries({ queryKey: qk.plan(pot) });
    return u;
  });

  const p = plan.data;
  const onchainSigner = p?.raw.inviteSigner?.toLowerCase();
  const mySigner = useMemo(() => signerOf(url), [url]);
  // the link works when this phone's secret matches the plan's current invite signer
  const linkOn = !!url && !turnedOff && (!onchainSigner || onchainSigner === mySigner);
  const name = p?.meta.name ?? "your plan";
  const joined = p ? activePeople(p) : [];
  const done = () => {
    if (fresh) router.replace({ pathname: "/plan/[pot]", params: { pot } });
    else router.canGoBack() ? router.back() : router.replace({ pathname: "/plan/[pot]", params: { pot } });
  };

  const copy = async () => {
    if (!url) return;
    await Clipboard.setStringAsync(url);
    showToast({ title: "Link copied", sub: displayLink(url), emoji: "🔗" });
  };
  const share = async () => {
    if (!url) return;
    await Share.share({ message: `Join ${name} on Plans: ${url}` }).catch(() => undefined);
  };
  const onOff = async () => {
    if (await off.run()) setTurnedOff(true);
  };
  const onMake = async () => {
    const u = await make.run();
    if (!u) return;
    setUrl(u);
    setTurnedOff(false);
  };

  const err = off.error ?? make.error;
  const names = joined.map((x) => (x.me ? `${x.name} (you)` : x.name));
  const joinedText =
    names.length <= 1
      ? `${names[0] ?? "You"} ${names.length ? "has" : "have"} joined. Waiting for friends.`
      : names.length <= 3
        ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} have joined.`
        : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more have joined.`;

  return (
    <Screen
      testID="screen-invite"
      dock={
        <Btns>
          <Btn label="Done" kind="sec" onPress={done} testID="btn-done" />
          {linkOn ? <Btn label="Share invite" icon="share" onPress={() => void share()} testID="btn-share-invite" /> : <Btn label="Make a new link" icon="link" loading={make.busy} onPress={() => void onMake()} testID="btn-make-new-link" />}
        </Btns>
      }
    >
      <AppBar icon="x" onBack={done} />
      {p ? (
        <Txt v="d28">Invite friends to {name}</Txt>
      ) : (
        <Skel w="80%" h={30} />
      )}
      <Txt v="t15" color="muted" style={{ marginTop: 8, marginBottom: 16 }}>
        They join with their fingerprint. No app yet? The link helps them install it first.
      </Txt>

      <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 14, overflow: "hidden" }}>
        <Wristband color={p?.meta.color ?? c.skel} text={p ? `${name} · ${dateRange(Number(p.raw.startTime), Number(p.raw.endTime))} · invite` : " "} />
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, alignItems: "center" }}>
          <View style={{ padding: 10, borderRadius: 18, backgroundColor: "#FFFFFF" }} testID="invite-qr" accessibilityLabel={linkOn ? "Invite code" : "Link turned off"}>
            {url ? (
              <View style={{ opacity: linkOn ? 1 : 0.12 }}>
                <QRCode value={url} size={188} color="#10231B" backgroundColor="#FFFFFF" ecl="M" />
              </View>
            ) : (
              <View style={{ width: 188, height: 188, backgroundColor: "#EAEFE7", borderRadius: 8 }} />
            )}
            {!linkOn ? (
              <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
                <Icon name="ban" size={32} color="#5A6B62" />
                <Txt style={{ color: "#10231B", marginTop: 6 }} weight="semi">
                  {url ? "Link turned off" : "No link on this phone"}
                </Txt>
              </View>
            ) : null}
          </View>
          {url && linkOn ? (
            <Row gap={8} style={{ marginTop: 12, justifyContent: "center" }}>
              <Txt v="mono13" testID="invite-link-text">
                {displayLink(url)}
              </Txt>
              <IconBtn name="copy" label="Copy link" filled size={40} onPress={() => void copy()} testID="btn-copy-link" />
            </Row>
          ) : (
            <Txt v="t13" color="muted" center style={{ marginTop: 12 }}>
              {url ? "Old links stop working. Make a new one to invite more people." : "The invite for this plan was made on another phone. Make a new link to invite from here."}
            </Txt>
          )}
        </View>
      </View>

      {linkOn ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="acc" icon="alert" title="Anyone with this link can join" text="Only share it with people on the plan. You can turn it off any time." />
        </View>
      ) : null}

      {err ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title={err.title} text={err.message} />
        </View>
      ) : null}

      {linkOn ? (
        <Row between style={{ marginTop: 12 }}>
          <Row gap={6}>
            <Icon name="clock" size={16} color={c.muted} />
            <Txt v="t13" color="muted">
              Works for 7 days
            </Txt>
          </Row>
          <Pressable testID="btn-turn-off-link" accessibilityRole="button" disabled={off.busy} onPress={() => void onOff()} hitSlop={10}>
            <Txt v="t13" weight="bold" style={{ textDecorationLine: "underline" }}>
              {off.busy ? "Turning off…" : "Turn off link"}
            </Txt>
          </Pressable>
        </Row>
      ) : null}

      <View style={{ marginTop: 16, flexDirection: "row", alignItems: "center", gap: 12 }} testID="invite-joined">
        {joined.length ? <People people={joined} size={32} /> : null}
        <Txt v="t13" color="muted" style={{ flex: 1 }}>
          {p ? joinedText : "Loading who's in…"}
        </Txt>
      </View>
      <View style={{ height: 16 }} />
    </Screen>
  );
}
