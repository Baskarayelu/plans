/**
 * Shared pieces of the "link a browser" screens (designs 165–178): the full-page frame (the
 * welcome bands on a laptop, a plain page on a phone), the step bar, the three link pictures, the
 * code in letters and the option cards of 166.
 */
import React from "react";
import { Platform, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { useColors } from "../../theme/ThemeProvider";
import { fonts, mix } from "../../theme/tokens";
import { Icon, type IconName } from "../Icon";
import { Logo, Tile } from "../kit";
import { Screen } from "../layout";
import { EntryHeader, EntrySplit, useEntryRoomy } from "../desk/entry";
import { useLayout } from "../shell/responsive";
import { Txt } from "../Text";

/** A phone browser (iPhone Safari, Android Chrome): the account's own passkey is on "your other phone". */
export function useOtherPhone(): boolean {
  const { mode } = useLayout();
  return Platform.OS === "web" && mode === "phone";
}

/** "Link this browser · step 2 of 3" and three bars (169); "2 of 3" on phones. */
export function StepBar({ step, compact }: { step: 1 | 2 | 3; compact?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }} testID={`link-step-${step}`} accessibilityLabel={`Step ${step} of 3`}>
      <Txt v="t13" color="muted" weight="medium">
        {compact ? `${step} of 3` : `Link this browser · step ${step} of 3`}
      </Txt>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: i <= step ? c.ink : c.line }} />
        ))}
      </View>
    </View>
  );
}

/**
 * The full-page frame: on a laptop the welcome split (bands left, content right, 102/168–170); on a
 * phone a plain page with the logo row. `dock` holds the main buttons (bottom on phones).
 */
export function LinkFrame({
  step,
  children,
  dock,
  testID,
  card,
  right,
}: {
  step?: 1 | 2 | 3;
  children: React.ReactNode;
  dock?: React.ReactNode;
  testID: string;
  /** 170: the content sits in a card in the middle of the right half. */
  card?: boolean;
  right?: React.ReactNode;
}) {
  const c = useColors();
  const { desk } = useLayout();
  const roomy = useEntryRoomy();
  if (desk) {
    if (card)
      return (
        <Screen testID={testID} pad={false} scroll={false} bottomInset={false}>
          <EntrySplit center>
            <View style={{ width: 560, maxWidth: "100%", backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.line, padding: 32 }}>
              {children}
              {dock ? <View style={{ width: 240, maxWidth: "100%", marginTop: 20, gap: 8 }}>{dock}</View> : null}
            </View>
          </EntrySplit>
        </Screen>
      );
    return (
      <Screen testID={testID} pad={false} scroll={false} bottomInset={false}>
        <EntrySplit>
          <View style={{ flex: 1, paddingTop: 56, paddingBottom: 40, paddingHorizontal: roomy ? 88 : 56, minHeight: 640 }}>
            <EntryHeader right={right ?? (step ? <StepBar step={step} /> : undefined)} />
            <View style={{ flex: 1, minHeight: 32 }} />
            <View style={{ maxWidth: 560 }}>{children}</View>
            {dock ? <View style={{ width: 400, maxWidth: "100%", marginTop: 24, gap: 8 }}>{dock}</View> : null}
            <View style={{ flex: 1, minHeight: 32 }} />
          </View>
        </EntrySplit>
      </Screen>
    );
  }
  return (
    <Screen testID={testID} dock={dock}>
      <View style={{ height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Logo size={22} />
        {right ?? (step ? <StepBar step={step} compact /> : null)}
      </View>
      {children}
    </Screen>
  );
}

/** The three pictures made from one link (not the key fingerprint): 169 and 173. */
export function LinkPictures({ emoji, big, dim, testID = "link-pictures" }: { emoji: string; big?: boolean; dim?: boolean; testID?: string }) {
  const c = useColors();
  const parts = Array.from(emoji);
  return (
    <View
      testID={testID}
      accessibilityLabel={`Pictures: ${parts.join(" ")}`}
      style={{
        flexDirection: "row",
        alignSelf: big ? "center" : "flex-start",
        gap: big ? 18 : 12,
        paddingVertical: big ? 14 : 6,
        paddingHorizontal: big ? 28 : 16,
        borderRadius: 999,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.line,
        opacity: dim ? 0.45 : 1,
      }}
    >
      {parts.map((e, i) => (
        <Txt key={i} style={{ fontSize: big ? 44 : 26, lineHeight: big ? 54 : 34 }}>
          {e}
        </Txt>
      ))}
    </View>
  );
}

/** "K7Q2-9RXD-M4TA" in big mono letters. */
export function CodeLetters({ code, size = 28, dim, center }: { code: string; size?: number; dim?: boolean; center?: boolean }) {
  return (
    <Txt testID="link-code" selectable style={{ fontFamily: fonts.monoSemi, fontSize: size, lineHeight: size * 1.25, letterSpacing: size * 0.08, opacity: dim ? 0.45 : 1, textAlign: center ? "center" : "left" }}>
      {code}
    </Txt>
  );
}

/** One of the three choices on 166: a bordered card with an icon tile, title, line and chevron. `outlined` marks the suggested one (176a). */
export function OptionCard({
  icon,
  accent,
  title,
  sub,
  onPress,
  disabled,
  outlined,
  testID,
}: {
  icon: IconName;
  accent?: boolean;
  title: string;
  sub: string;
  onPress: () => void;
  disabled?: boolean;
  outlined?: boolean;
  testID: string;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        padding: 14,
        paddingHorizontal: 16,
        borderRadius: 14,
        backgroundColor: outlined ? mix(c.accent, 0.1, c.surface) : c.surface,
        borderWidth: outlined ? 2 : 1,
        borderColor: outlined ? c.accent : c.line,
        opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      <Tile icon={icon} kind={accent ? "a" : undefined} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt v="lt">{title}</Txt>
        <Txt v="t13" color="muted">
          {sub}
        </Txt>
      </View>
      <Icon name="chev" size={20} />
    </Pressable>
  );
}

/** An icon well and two lines, for the three promises of 168 and the facts of 174. */
export function Fact({ icon, title, text, style }: { icon: IconName; title: string; text: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: "row", gap: 14, alignItems: "flex-start" }, style]}>
      <Tile icon={icon} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt v="lt">{title}</Txt>
        <Txt v="t13" color="muted" style={{ fontSize: 14, lineHeight: 20 }}>
          {text}
        </Txt>
      </View>
    </View>
  );
}

/** "HH:MM" in local time for a unix-seconds instant. */
export function clock(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
