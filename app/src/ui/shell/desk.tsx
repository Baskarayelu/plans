/**
 * Building blocks for laptop layouts (designs 108–118). Use them only when `useLayout().desk` is
 * true; phone screens keep their own approved layout.
 */
import { router } from "expo-router";
import React from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { useColors } from "../../theme/ThemeProvider";
import { fonts } from "../../theme/tokens";
import { Icon } from "../Icon";
import { Txt } from "../Text";

/** Page heading: small greeting/overline, a big title, actions on the right (108, 114, 117, 118). */
export function DeskTitle({ over, title, sub, right, size = 44, testID }: { over?: string; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; size?: number; testID?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginTop: 12, marginBottom: 16 }} testID={testID}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {over ? (
          <Txt v="t15" color="muted">
            {over}
          </Txt>
        ) : null}
        {typeof title === "string" ? <Txt style={{ fontFamily: fonts.display, fontSize: size, lineHeight: size * 1.08, letterSpacing: -size * 0.03 }}>{title}</Txt> : title}
        {sub ? (typeof sub === "string" ? <Txt v="t15" color="muted" style={{ marginTop: 4 }}>{sub}</Txt> : sub) : null}
      </View>
      {right ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{right}</View> : null}
    </View>
  );
}

/** Breadcrumb: "Plans › Lisbon, 12–16 Oct › Pay" (109, 110). */
export function Crumbs({ items, right }: { items: { label: string; href?: string | { pathname: string; params?: Record<string, string> } }[]; right?: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 32 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
        {items.map((it, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <Icon name="chev" size={14} color={c.muted} /> : null}
            {it.href && i < items.length - 1 ? (
              <Pressable onPress={() => router.navigate(it.href as never)} accessibilityRole="link">
                <Txt v="t13" color="muted" weight="medium">
                  {it.label}
                </Txt>
              </Pressable>
            ) : (
              <Txt v="t13" weight="semi" numberOfLines={1}>
                {it.label}
              </Txt>
            )}
          </React.Fragment>
        ))}
      </View>
      {right}
    </View>
  );
}

/** A grid of equal columns that wraps (cards on Home, members on Plan home). */
export function Grid({ cols, gap = 16, children, style }: { cols: number; gap?: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const items = React.Children.toArray(children).filter(Boolean);
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return (
    <View style={[{ gap }, style]}>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", gap }}>
          {r.map((ch, j) => (
            <View key={j} style={{ flex: 1, minWidth: 0 }}>
              {ch}
            </View>
          ))}
          {Array.from({ length: cols - r.length }, (_, k) => (
            <View key={`pad${k}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Two columns side by side with a fixed gap; the right one can be fixed width. */
export function Cols({ left, right, rightWidth, gap = 24 }: { left: React.ReactNode; right: React.ReactNode; rightWidth?: number; gap?: number }) {
  return (
    <View style={{ flexDirection: "row", gap, alignItems: "flex-start" }}>
      <View style={{ flex: 1, minWidth: 0 }}>{left}</View>
      <View style={rightWidth ? { width: rightWidth } : { flex: 1, minWidth: 0 }}>{right}</View>
    </View>
  );
}

/** Panel heading: "WHAT WILL HAPPEN", "NEEDS YOUR OK", or a d22 title (110, 111, 114, 118). */
export function PanelHead({ over, title, right }: { over?: string; title?: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, minHeight: 28 }}>
      <View>
        {over ? (
          <Txt v="ov" color="muted">
            {over}
          </Txt>
        ) : null}
        {title ? <Txt v="d22">{title}</Txt> : null}
      </View>
      {right}
    </View>
  );
}
