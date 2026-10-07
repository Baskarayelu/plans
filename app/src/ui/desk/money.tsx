/**
 * Small shared pieces for the laptop layouts of the Send / Activity / You screens (114–118, 142,
 * 148). Phones never render these: callers check `useLayout().desk` first (DeskColumn passes its
 * children straight through on phones).
 */
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { useColors } from "../../theme/ThemeProvider";
import type { IconName } from "../Icon";
import { Row, Tile } from "../kit";
import { Screen } from "../layout";
import { useInShell } from "../shell/AppShell";
import { useLayout } from "../shell/responsive";
import { Txt } from "../Text";

/** A centred column on a laptop (no full-width stretch, no phone-width strip); children as is on phones. */
export function DeskColumn({ children, width = 640, style }: { children: React.ReactNode; width?: number; style?: StyleProp<ViewStyle> }) {
  const { desk } = useLayout();
  if (!desk) return <>{children}</>;
  return <View style={[{ width: "100%", maxWidth: width, alignSelf: "center", flexGrow: 1 }, style]}>{children}</View>;
}

type ScreenProps = React.ComponentProps<typeof Screen>;

/**
 * Screen for secondary pages (invite, join with a link, add money, help…): on phones exactly
 * `Screen`; on a laptop the content sits in a centred ~640 px column, and outside the shell (no
 * rail, e.g. an invite opened before signing in) the dock's buttons follow the content instead
 * of stretching across the window.
 */
export function DeskScreen({ width = 640, ...props }: ScreenProps & { width?: number }) {
  const { desk } = useLayout();
  const shell = useInShell();
  if (!desk) return <Screen {...props} />;
  if (shell)
    return (
      <Screen {...props}>
        <DeskColumn width={width}>{props.children}</DeskColumn>
      </Screen>
    );
  return (
    <Screen {...props} dock={undefined} bottomInset={false}>
      <DeskColumn width={width} style={{ paddingVertical: 32 }}>
        {props.children}
        {props.dock ? <View style={{ marginTop: 24, gap: 8, width: 400, maxWidth: "100%", alignSelf: "center" }}>{props.dock}</View> : null}
      </DeskColumn>
    </Screen>
  );
}

/** A computer screen, for "This browser" in the passkey device list (118). */
export function ComputerIcon({ size = 22, color }: { size?: number; color?: string }) {
  const c = useColors();
  const col = color ?? c.ink;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="2" y="3" width="20" height="14" rx="2" />
      <Path d="M8 21h8M12 17v4" />
    </Svg>
  );
}

/** A square icon well like kit's Tile, for an icon drawn here. */
export function IconWell({ children, size = 40 }: { children: React.ReactNode; size?: number }) {
  const c = useColors();
  return <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>{children}</View>;
}

/** What the three pictures mean, in the words of a computer (118's panel, the key page on a laptop). */
export function KeyWhy({ compact }: { compact?: boolean }) {
  const items: [IconName, string][] = [
    ["lock", "Receipt photos and notes are scrambled before they leave this computer. Only people in that plan can open them."],
    ["key", "Your key comes from your passkey, so this browser and your phone have the same one."],
    ["eye", "Plans can't see your photos or notes. Neither can anyone outside the plan."],
    ["users", "If a friend's three pictures change and they didn't get a new device, ask them before approving anything."],
  ];
  return (
    <View style={{ gap: compact ? 14 : 18 }}>
      {items.map(([icon, text]) => (
        <Row key={icon} align="flex-start" gap={14}>
          <Tile icon={icon} size={compact ? 36 : 40} />
          <Txt v={compact ? "t15" : "t17"} style={{ flex: 1, marginTop: 2 }}>
            {text}
          </Txt>
        </Row>
      ))}
    </View>
  );
}
