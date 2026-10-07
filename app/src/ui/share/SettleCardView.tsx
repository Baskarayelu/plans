/**
 * 134 Share card (1080 × 1350, "story") and 135 (1200 × 630, "wide"), drawn with ordinary views so
 * fonts and flag emoji render exactly as in the app. Sizes are the design's pixels times `scale`, so
 * the same component is the small preview in the sheet and the full-size copy that gets captured.
 * Light or dark follows the sharer's app theme.
 */
import React from "react";
import { Text, View, type TextStyle } from "react-native";
import type { SettleCard } from "../../lib/share/settleCard";
import { useColors } from "../../theme/ThemeProvider";
import { fonts, WRISTBANDS } from "../../theme/tokens";

type Props = { card: SettleCard; shape: "story" | "wide"; width: number };

const T = (style: TextStyle, children: React.ReactNode, lines?: number) => (
  <Text allowFontScaling={false} numberOfLines={lines} style={style}>
    {children}
  </Text>
);

function Mark({ s, size }: { s: number; size: number }) {
  const c = useColors();
  const z = size * s;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: z * 0.45 }}>
      <View style={{ width: z * 1.2, height: z * 0.55, borderRadius: z * 0.14, overflow: "hidden", flexDirection: "row" }}>
        {Array.from({ length: 4 }, (_, i) => (
          <React.Fragment key={i}>
            <View style={{ width: z * 0.27, backgroundColor: c.accent }} />
            <View style={{ width: z * 0.09, backgroundColor: c.ink }} />
          </React.Fragment>
        ))}
      </View>
      {T({ fontFamily: fonts.display, fontSize: z, lineHeight: z * 1.15, letterSpacing: -0.4 * s, color: c.ink }, "plans")}
    </View>
  );
}

/** A long rotated wristband behind the content (design .band). */
function BigBand({ s, color, text, top, left, rot, h = 120, fs = 30 }: { s: number; color: string; text: string; top: number; left: number; rot: number; h?: number; fs?: number }) {
  const c = useColors();
  const label = T({ fontFamily: fonts.monoSemi, fontSize: fs * s, letterSpacing: fs * s * 0.12, color: "#10231B" }, text, 1);
  const hole = <View style={{ width: 48 * s, height: 48 * s, borderRadius: 24 * s, backgroundColor: c.bg, borderWidth: 10 * s, borderColor: "rgba(16,35,27,0.25)" }} />;
  return (
    <View
      style={{
        position: "absolute",
        top: top * s,
        left: left * s,
        width: 2600 * s,
        height: h * s,
        borderRadius: 24 * s,
        backgroundColor: color,
        flexDirection: "row",
        alignItems: "center",
        gap: 60 * s,
        paddingHorizontal: 40 * s,
        transform: [{ rotate: `${rot}deg` }],
        overflow: "hidden",
      }}
    >
      {label}
      {hole}
      {label}
      {hole}
      {label}
    </View>
  );
}

function FlagPill({ s, flag, count, big = 1 }: { s: number; flag: string; count: number; big?: number }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 * s, backgroundColor: c.surface, borderWidth: 2 * s, borderColor: c.line, borderRadius: 999, paddingVertical: 10 * s, paddingLeft: 14 * s, paddingRight: 26 * s }}>
      {T({ fontSize: 52 * s * big, lineHeight: 62 * s * big }, flag)}
      {T({ fontFamily: fonts.bodyBold, fontSize: 34 * s * big, color: c.ink }, String(count))}
    </View>
  );
}

function StatTile({ s, value, label, v = 56, l = 26, pad = [26, 28], r = 28 }: { s: number; value: string; label: string; v?: number; l?: number; pad?: [number, number]; r?: number }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.surface, borderWidth: 2 * s, borderColor: c.line, borderRadius: r * s, paddingVertical: pad[0] * s, paddingHorizontal: pad[1] * s }}>
      {T({ fontFamily: fonts.display, fontSize: v * s, lineHeight: v * s * 1.1, letterSpacing: -0.03 * v * s, color: c.ink }, value, 1)}
      {T({ fontFamily: fonts.bodyMedium, fontSize: l * s, color: c.muted, marginTop: 10 * s }, label, 1)}
    </View>
  );
}

export function SettleCardView({ card, shape, width }: Props) {
  const c = useColors();
  if (shape === "wide") {
    const s = width / 1200;
    return (
      <View style={{ width, height: 630 * s, backgroundColor: c.bg, overflow: "hidden", flexDirection: "row", gap: 56 * s, paddingTop: 52 * s, paddingHorizontal: 64 * s, paddingBottom: 120 * s }}>
        <BigBand s={s} color={WRISTBANDS.lagoon} text={`${card.dateBand} · ${card.countLine.split(" · settled")[0].toUpperCase()}`} top={548} left={-300} rot={-2} h={84} fs={22} />
        <View style={{ flex: 1 }}>
          <Mark s={s} size={40} />
          {T({ fontFamily: fonts.display, fontSize: 76 * s, lineHeight: 78 * s, letterSpacing: -0.04 * 76 * s, color: c.ink, marginTop: 40 * s }, card.headline, 4)}
          {card.subline ? T({ fontFamily: fonts.bodySemi, fontSize: 26 * s, color: c.muted, marginTop: 12 * s }, card.subline, 2) : null}
          <View style={{ flex: 1 }} />
          {T({ fontFamily: fonts.mono, fontSize: 20 * s, color: c.muted }, `${card.displayUrl} · Proof on Monad`, 1)}
        </View>
        <View style={{ width: 330 * s, gap: 16 * s, paddingTop: 8 * s }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 * s }}>
            {card.flags.slice(0, 6).map((f) => (
              <FlagPill key={f.code} s={s} flag={f.flag} count={f.count} big={0.78} />
            ))}
          </View>
          {[card.stats[0], card.stats[2]].map((st) => (
            <View key={st.label} style={{ flexDirection: "row" }}>
              <StatTile s={s} value={st.value} label={st.label} v={44} l={20} pad={[18, 22]} r={22} />
            </View>
          ))}
        </View>
      </View>
    );
  }
  const s = width / 1080;
  return (
    <View style={{ width, height: 1350 * s, backgroundColor: c.bg, overflow: "hidden", paddingTop: 84 * s, paddingHorizontal: 84 * s, paddingBottom: 72 * s }}>
      <BigBand s={s} color={WRISTBANDS.lagoon} text={card.dateBand} top={770} left={-400} rot={-6} />
      <BigBand s={s} color={WRISTBANDS.marigold} text={card.placesBand} top={900} left={-700} rot={4} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Mark s={s} size={56} />
        {T({ fontFamily: fonts.mono, fontSize: 26 * s, letterSpacing: 2.6 * s, color: c.muted }, card.dateTag)}
      </View>
      {T({ fontFamily: fonts.display, fontSize: 118 * s, lineHeight: 120 * s, letterSpacing: -0.045 * 118 * s, color: c.ink, marginTop: 84 * s }, card.headline, 4)}
      {card.subline ? T({ fontFamily: fonts.bodySemi, fontSize: 40 * s, color: c.muted, marginTop: 24 * s }, card.subline, 2) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 18 * s, marginTop: 56 * s }}>
        {card.flags.slice(0, 6).map((f) => (
          <FlagPill key={f.code} s={s} flag={f.flag} count={f.count} />
        ))}
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: "row", gap: 20 * s }}>
        {card.stats.map((st) => (
          <StatTile key={st.label} s={s} value={st.value} label={st.label} />
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 36 * s }}>
        {T({ fontFamily: fonts.mono, fontSize: 26 * s, color: c.muted }, card.displayUrl, 1)}
        {T({ fontFamily: fonts.mono, fontSize: 26 * s, color: c.muted }, "Proof on Monad", 1)}
      </View>
    </View>
  );
}
