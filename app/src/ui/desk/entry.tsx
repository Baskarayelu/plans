/**
 * Laptop layouts for the front door and other full-page moments (designs 102, 106, 107, 116, 130):
 * the wristband illustration on the left and the content on the right. Use only when
 * `useLayout().desk` is true; phones keep their approved screens.
 */
import * as Linking from "expo-linking";
import React from "react";
import { Pressable, ScrollView, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { isTestnet } from "../../config";
import { useColors } from "../../theme/ThemeProvider";
import { fonts, WRISTBANDS } from "../../theme/tokens";
import { router } from "expo-router";
import type { IconName } from "../Icon";
import { Avatar, Btn, Logo, Tile } from "../kit";
import { Screen } from "../layout";
import { useInShell } from "../shell/AppShell";
import { Txt } from "../Text";

export const SITE_URL = "https://plans.0xo.in";
export const DOWNLOAD_URL = "https://plans.0xo.in/download";

function Stripes() {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: -40, top: -40, right: -40, bottom: -40, flexDirection: "row", transform: [{ rotate: "-35deg" }] }}>
      {Array.from({ length: 140 }, (_, i) => (
        <View key={i} style={{ width: 9, marginRight: 9, backgroundColor: "rgba(255,255,255,0.2)" }} />
      ))}
    </View>
  );
}

/** One wide wristband: the plan name three times with the snap dots between (design .band at 64 px). */
function DeskBand({ color, text, top, left, rot }: { color: string; text: string; top: number; left: number; rot: number }) {
  const c = useColors();
  const label = (
    <Txt numberOfLines={1} style={{ fontFamily: fonts.monoSemi, fontSize: 15, letterSpacing: 1.8, color: "#10231B" }}>
      {text}
    </Txt>
  );
  const dot = <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.bg, borderWidth: 5, borderColor: "rgba(16,35,27,0.25)" }} />;
  return (
    <View
      style={{
        position: "absolute",
        top,
        left,
        width: 1500,
        height: 64,
        borderRadius: 12,
        backgroundColor: color,
        flexDirection: "row",
        alignItems: "center",
        gap: 34,
        paddingHorizontal: 18,
        overflow: "hidden",
        transform: [{ rotate: `${rot}deg` }],
      }}
    >
      <Stripes />
      {label}
      {dot}
      {label}
      {dot}
      {label}
    </View>
  );
}

const PEOPLE: [string, string, number, number, number, string][] = [
  ["M", "#D9634B", 76, 90, 150, "🇬🇧"],
  ["S", "#3C78B8", 64, 560, 92, "🇺🇸"],
  ["A", "#8C5CC4", 72, 500, 400, "🇮🇳"],
  ["B", "#2B8A5F", 60, 140, 500, "🇬🇧"],
];

/** The left half of 102/107: four rotated wristbands in real plan colours and four friends. Nothing moves. */
export function BandsArt({ width }: { width: number }) {
  const c = useColors();
  return (
    <View style={{ width, alignSelf: "stretch", overflow: "hidden", backgroundColor: c.surface2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="entry-art">
      <DeskBand color={WRISTBANDS.lagoon} text="LISBON · 12–16 OCT · 4 PEOPLE" top={110} left={-300} rot={-11} />
      <DeskBand color={WRISTBANDS.orchid} text="GLASTONBURY CREW · 24–28 JUN" top={260} left={-200} rot={6} />
      <DeskBand color={WRISTBANDS.marigold} text="BEN'S 30TH · SAT 7 NOV" top={410} left={-380} rot={-5} />
      <DeskBand color={WRISTBANDS.lime} text="SKI WEEK · FEB · 6 PEOPLE" top={560} left={-240} rot={8} />
      {PEOPLE.map(([i, col, s, x, y, f]) => (
        <View key={i} style={{ position: "absolute", left: x, top: y, borderRadius: 999, borderWidth: 3, borderColor: c.bg }}>
          <Avatar initial={i} color={col} size={s} flag={f} />
        </View>
      ))}
      <Txt v="t13" color="muted" style={{ position: "absolute", left: 32, bottom: 28 }}>
        Every band is a real plan colour. Nothing moves.
      </Txt>
    </View>
  );
}

/** True when the right half is as wide as the 1440 design; smaller laptops step the type and margins down. */
export function useEntryRoomy(): boolean {
  const { width } = useWindowDimensions();
  return width - Math.min(720, Math.round(width / 2)) >= 700;
}

/** Split screen: the bands on the left (720 px at 1440, half the window on smaller laptops), content on the right. */
export function EntrySplit({ children, testID, center }: { children: React.ReactNode; testID?: string; center?: boolean }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const art = Math.min(720, Math.round(width / 2));
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: c.bg }} testID={testID}>
      <BandsArt width={art} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[{ flexGrow: 1 }, center ? { alignItems: "center", justifyContent: "center", padding: 40 } : null]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

/** Logo on the left, "What is Plans?" on the right (102). */
export function EntryHeader({ right }: { right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Logo size={26} />
      {right ?? <WhatIsPlans />}
    </View>
  );
}

export function WhatIsPlans() {
  return (
    <Pressable onPress={() => void Linking.openURL(SITE_URL)} accessibilityRole="link" testID="link-what-is-plans" hitSlop={8}>
      <Txt v="t13" color="muted" weight="semi">
        What is Plans?
      </Txt>
    </Pressable>
  );
}

/** "Prefer your phone?" with a QR to the Android download page, and the test chip (102). */
export function PhoneQrRow() {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }} testID="entry-phone-qr">
      <View style={{ padding: 6, backgroundColor: "#FFFFFF", borderRadius: 10 }} accessibilityLabel="Code for the Android app">
        <QRCode value={DOWNLOAD_URL} size={64} color="#10231B" backgroundColor="#FFFFFF" ecl="M" quietZone={0} />
      </View>
      <View style={{ flexShrink: 1, maxWidth: 240 }}>
        <Txt v="t13" weight="bold">
          Prefer your phone?
        </Txt>
        <Txt v="t13" color="muted">
          Scan to get the Android app. Same account on both.
        </Txt>
      </View>
      <View style={{ flex: 1, minWidth: 8 }} />
      {isTestnet ? (
        <View style={{ height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: c.surface2, justifyContent: "center" }} testID="chip-test-version">
          <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 12 }}>Test version · free test dollars</Txt>
        </View>
      ) : null}
    </View>
  );
}

/** A centred column for pages that aren't in the shell (claim, invite, profile): no phone-width strip. */
export function DeskCard({ children, width = 520, style, testID }: { children: React.ReactNode; width?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={[{ width, maxWidth: "100%", alignSelf: "center", backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.line, padding: 32 }, style]}>
      {children}
    </View>
  );
}

/** A web page outside the app shell (116 claim, invites): a top bar, the content centred, an optional footer row. */
export function WebPageFrame({ children, footer, testID }: { children: React.ReactNode; footer?: React.ReactNode; testID?: string }) {
  const c = useColors();
  // Signed in, the page sits in the app's main column (rail on the left): no second top bar.
  if (useInShell())
    return (
      <Screen testID={testID} bottomInset={false}>
        <View style={{ flex: 1, justifyContent: "center", paddingVertical: 24 }}>{children}</View>
      </Screen>
    );
  return (
    <Screen testID={testID} pad={false} bottomInset={false}>
      <View style={{ height: 72, flexDirection: "row", alignItems: "center", paddingHorizontal: 48, gap: 24, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Pressable onPress={() => router.replace("/")} accessibilityRole="link" accessibilityLabel="Plans" testID="btn-close">
          <Logo size={24} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => void Linking.openURL(SITE_URL)} accessibilityRole="link" testID="link-what-is-plans">
          <Txt v="t15" color="muted" weight="medium">
            What is Plans?
          </Txt>
        </Pressable>
        <Pressable onPress={() => router.push("/help")} accessibilityRole="link" testID="link-help">
          <Txt v="t15" color="muted" weight="medium">
            Help
          </Txt>
        </Pressable>
        <Btn label="Open the app" kind="sec" sm onPress={() => router.replace("/")} testID="btn-open-the-app" style={{ height: 44, minHeight: 44, alignSelf: "center" }} />
      </View>
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 48, paddingVertical: 48 }}>{children}</View>
      {footer ? <View style={{ paddingHorizontal: 48, paddingBottom: 32 }}>{footer}</View> : null}
    </Screen>
  );
}

const FEATURES: [IconName, string, string][] = [
  ["zap", "Free and instant", "Money between people on Plans arrives in under a second, with no fee."],
  ["fp", "Your fingerprint is your key", "No password to forget. Your passkey lives in your phone or browser."],
  ["globe", "Friends in any country", "Everyone sees amounts in their own money: pounds, dollars, rupees, euros."],
];

/** The three reasons along the bottom of 116. */
export function ClaimFeatures() {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 16 }}>
      {FEATURES.map(([icon, t, d]) => (
        <View key={t} style={{ flex: 1, flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 16 }}>
          <Tile icon={icon} />
          <View style={{ flex: 1 }}>
            <Txt v="lt">{t}</Txt>
            <Txt v="t13" color="muted">
              {d}
            </Txt>
          </View>
        </View>
      ))}
    </View>
  );
}
