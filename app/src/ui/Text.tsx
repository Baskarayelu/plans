import React from "react";
import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { useColors } from "../theme/ThemeProvider";
import { fonts } from "../theme/tokens";

type Variant =
  | "d56"
  | "d44"
  | "d34"
  | "d28"
  | "d22"
  | "d17"
  | "t17"
  | "t15"
  | "t13"
  | "t11"
  | "ov"
  | "mono13"
  | "mono11"
  | "lt";

const V: Record<Variant, TextStyle> = {
  d56: { fontFamily: fonts.display, fontSize: 56, lineHeight: 58, letterSpacing: -2.5 },
  d44: { fontFamily: fonts.display, fontSize: 44, lineHeight: 46, letterSpacing: -1.8 },
  d34: { fontFamily: fonts.display, fontSize: 34, lineHeight: 37, letterSpacing: -1.2 },
  d28: { fontFamily: fonts.display, fontSize: 28, lineHeight: 31, letterSpacing: -0.85 },
  d22: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 26, letterSpacing: -0.45 },
  d17: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 21, letterSpacing: -0.17 },
  t17: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24 },
  t15: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  t13: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  t11: { fontFamily: fonts.body, fontSize: 11, lineHeight: 15 },
  ov: { fontFamily: fonts.monoSemi, fontSize: 11, lineHeight: 14, letterSpacing: 1, textTransform: "uppercase" },
  mono13: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18 },
  mono11: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 15 },
  lt: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 20 },
};

export type TxtProps = TextProps & {
  v?: Variant;
  color?: "ink" | "muted" | "pos" | "neg" | "info" | "onAccent" | "bg" | string;
  weight?: "regular" | "medium" | "semi" | "bold";
  center?: boolean;
  tnum?: boolean;
};

export function Txt({ v = "t15", color = "ink", weight, center, tnum, style, ...rest }: TxtProps) {
  const c = useColors();
  const map: Record<string, string> = { ink: c.ink, muted: c.muted, pos: c.pos, neg: c.neg, info: c.info, onAccent: c.onAccent, bg: c.bg };
  const base = V[v];
  const isBody = base.fontFamily === fonts.body;
  const fam =
    weight && isBody
      ? { regular: fonts.body, medium: fonts.bodyMedium, semi: fonts.bodySemi, bold: fonts.bodyBold }[weight]
      : base.fontFamily;
  return (
    <RNText
      allowFontScaling
      maxFontSizeMultiplier={1.4}
      style={[
        base,
        { color: map[color] ?? color, fontFamily: fam },
        center ? { textAlign: "center" } : null,
        tnum ? { fontVariant: ["tabular-nums"] } : null,
        style,
      ]}
      {...rest}
    />
  );
}
