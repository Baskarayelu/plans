import React from "react";
import { View } from "react-native";
import Svg, { Circle, Defs, Mask, Rect } from "react-native-svg";
import { useColors } from "../theme/ThemeProvider";
import { fonts } from "../theme/tokens";
import { Txt } from "./Text";

/**
 * One mono line of a stub (label left, value right; no label: a muted note line). Receipts and the
 * previews before confirming draw their rate lines with this, so they read the same.
 */
export function StubLine({ k, v, testID }: { k: string; v: React.ReactNode; testID?: string }) {
  const c = useColors();
  return k ? (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }} testID={testID}>
      <Txt style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 22, color: c.muted }}>{k}</Txt>
      {typeof v === "string" ? <Txt style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 22, textAlign: "right", flexShrink: 1 }}>{v}</Txt> : v}
    </View>
  ) : (
    <Txt style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 22, color: c.muted }} testID={testID}>
      {v as string}
    </Txt>
  );
}

/**
 * Ticket-stub receipt (design .stub): head, perforation with side notches, mono lines,
 * optional foot row (Settled in · Proof), scalloped bottom edge.
 */
export function Stub({ head, lines, foot, testID }: { head: React.ReactNode; lines: [string, React.ReactNode][]; foot?: React.ReactNode; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID ?? "receipt-stub"}>
      <View style={{ backgroundColor: c.surface, borderTopLeftRadius: 14, borderTopRightRadius: 14, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 12 }}>{head}</View>
      <View style={{ height: 24 }}>
        <Svg width="100%" height={24}>
          <Defs>
            <Mask id="perf">
              <Rect x="0" y="0" width="100%" height="24" fill="white" />
              <Circle cx="0" cy="12" r="11" fill="black" />
              <Circle cx="100%" cy="12" r="11" fill="black" />
            </Mask>
          </Defs>
          <Rect x="0" y="0" width="100%" height="24" fill={c.surface} mask="url(#perf)" />
        </Svg>
        <View style={{ position: "absolute", left: 20, right: 20, top: 11, borderTopWidth: 2, borderStyle: "dashed", borderColor: c.line }} />
      </View>
      <View style={{ backgroundColor: c.surface, paddingHorizontal: 18, paddingTop: 6, paddingBottom: 10 }}>
        {lines.map(([k, v], i) => (
          <StubLine key={i} k={k} v={v} />
        ))}
        {foot ? (
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderStyle: "dashed", borderColor: c.line }}>{foot}</View>
        ) : null}
      </View>
      <Svg width="100%" height={9}>
        {Array.from({ length: 60 }, (_, i) => (
          <Circle key={i} cx={6 + i * 12} cy={0} r={6} fill={c.surface} />
        ))}
      </Svg>
    </View>
  );
}
