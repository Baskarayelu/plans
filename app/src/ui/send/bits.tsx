/** Building blocks shared by the Send and account screens (43–55, 09). */
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { getFx } from "../../lib/api/relayer";
import { currencyFor } from "../../lib/domain/currency";
import { useColors } from "../../theme/ThemeProvider";
import { fonts } from "../../theme/tokens";
import { Icon, type IconName } from "../Icon";
import { Tile } from "../kit";
import { Txt } from "../Text";

/** Reference rate `from` → `to` (units of `to` per 1 `from`, 1e8). Refreshed after a minute. */
export function useFxPair(from: string, to: string, opts: { refetchMs?: number } = {}) {
  return useQuery({
    queryKey: ["fxpair", from, to],
    enabled: !!from && !!to && from !== to,
    queryFn: async () => {
      const q = await getFx(from, to);
      return { rateE8: BigInt(q.rateE8), timestamp: q.timestamp, source: q.source, fetchedAt: Date.now() };
    },
    staleTime: 60_000,
    refetchInterval: opts.refetchMs,
    retry: 2,
  });
}

/**
 * Pill caption with an info tap ("Digital dollars (AUSD)" on 09, 43 and 45). The label and the
 * explanation are passed in by those screens.
 */
export function InfoPill({ label, info, testID, align = "center" }: { label: string; info: string; testID?: string; align?: "center" | "flex-start" | "flex-end" }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ alignItems: align }}>
      <Pressable
        testID={testID ?? "pill-info"}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Explains what this is"
        onPress={() => setOpen((o) => !o)}
        hitSlop={6}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.surface2 }}
      >
        <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 12 }}>{label}</Txt>
        <Icon name="info" size={15} strokeWidth={2} />
      </Pressable>
      {open ? (
        <Txt v="t13" color="muted" center={align === "center"} style={{ marginTop: 6, maxWidth: 280 }} testID={`${testID ?? "pill-info"}-text`}>
          {info}
        </Txt>
      ) : null}
    </View>
  );
}

/** Three big tiles (design .big3). The first is highlighted. */
export function Big3({ items }: { items: { icon: IconName; label: string; onPress: () => void; testID: string; hi?: boolean }[] }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {items.map((it) => (
        <Pressable
          key={it.testID}
          testID={it.testID}
          accessibilityRole="button"
          accessibilityLabel={it.label}
          onPress={it.onPress}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 96,
            borderRadius: 14,
            padding: 12,
            paddingVertical: 14,
            gap: 10,
            backgroundColor: it.hi ? c.accent : c.surface,
            borderWidth: 1,
            borderColor: it.hi ? c.accent : c.line,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          {it.hi ? (
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(16,35,27,0.12)", alignItems: "center", justifyContent: "center" }}>
              <Icon name={it.icon} size={22} color="#10231B" />
            </View>
          ) : (
            <Tile icon={it.icon} />
          )}
          <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 14, color: it.hi ? c.onAccent : c.ink }}>{it.label}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

/** The big typed amount with a caret (design 45/50). */
export function BigAmount({ text, currency, testID, size = 56 }: { text: string; currency: string; testID?: string; size?: number }) {
  const c = useColors();
  const sym = currencyFor(currency).symbol;
  const shown = `${sym}${text || "0"}`;
  const fs = shown.length > 10 ? size * 0.7 : shown.length > 8 ? size * 0.82 : size;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
      <Txt testID={testID} tnum numberOfLines={1} style={{ fontFamily: fonts.display, fontSize: fs, lineHeight: fs * 1.08, letterSpacing: -fs * 0.045, color: text ? c.ink : c.muted }}>
        {shown}
      </Txt>
      <View style={{ width: 3, height: fs * 0.82, backgroundColor: c.accent, marginLeft: 3, borderRadius: 2 }} />
    </View>
  );
}

/** Striped "TEST VERSION · NOT REAL MONEY" ribbon (design .testrib). */
export function TestRibbon() {
  return (
    <View style={{ height: 26, marginHorizontal: -16, overflow: "hidden", backgroundColor: "#F5B83D", alignItems: "center", justifyContent: "center" }} testID="test-ribbon">
      <View pointerEvents="none" style={{ position: "absolute", left: -40, right: -40, top: -40, bottom: -40, flexDirection: "row", transform: [{ rotate: "45deg" }] }}>
        {Array.from({ length: 70 }, (_, i) => (
          <View key={i} style={{ width: 10, marginRight: 10, backgroundColor: "#F7C862" }} />
        ))}
      </View>
      <Txt style={{ fontFamily: fonts.monoSemi, fontSize: 11, letterSpacing: 1.1, color: "#10231B" }}>TEST VERSION · NOT REAL MONEY</Txt>
    </View>
  );
}

/** Label / value row inside a details card. */
export function KV({ k, v, testID, pos }: { k: string; v: React.ReactNode; testID?: string; pos?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "center" }} testID={testID}>
      <Txt v="t15" color="muted">
        {k}
      </Txt>
      {typeof v === "string" ? (
        <Txt v="t15" weight="bold" color={pos ? "pos" : "ink"} style={{ flexShrink: 1, textAlign: "right" }}>
          {v}
        </Txt>
      ) : (
        v
      )}
    </View>
  );
}

/** Small mono caption line (rate). */
export function Mono({ children, center, testID }: { children: React.ReactNode; center?: boolean; testID?: string }) {
  return (
    <Txt v="mono11" color="muted" center={center} testID={testID}>
      {children}
    </Txt>
  );
}
