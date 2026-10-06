/**
 * Plans UI kit: React Native versions of the approved design's building blocks
 * (design/gen/app.css). Every interactive element takes a `testID`; when omitted it is derived
 * from the label so uiautomator / Maestro can find it by id or by text.
 */
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Switch,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { explorerTxUrl } from "../config";
import { useColors } from "../theme/ThemeProvider";
import { fonts, mix, withAlpha } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Text";

export const tid = (label: string) =>
  label
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

// ───────────────────────── layout ─────────────────────────

export function Row({ children, gap = 12, style, between, align = "center", wrap }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle>; between?: boolean; align?: ViewStyle["alignItems"]; wrap?: boolean }) {
  return (
    <View style={[{ flexDirection: "row", alignItems: align, gap, justifyContent: between ? "space-between" : undefined, flexWrap: wrap ? "wrap" : undefined }, style]}>
      {children}
    </View>
  );
}

export function Col({ children, gap = 12, style }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export const Spacer = ({ h = 0, flex }: { h?: number; flex?: boolean }) => <View style={flex ? { flex: 1, minHeight: h } : { height: h }} />;

export function Hr({ m = 12 }: { m?: number }) {
  const c = useColors();
  return <View style={{ height: 1, backgroundColor: c.line, marginVertical: m }} />;
}

// ───────────────────────── buttons ─────────────────────────

export type BtnKind = "pri" | "sec" | "out" | "ink" | "txt" | "dng" | "dngo" | "off";

export function Btn({
  label,
  kind = "pri",
  icon,
  onPress,
  sm,
  disabled,
  loading,
  testID,
  style,
  flex,
  a11y,
}: {
  label: string;
  kind?: BtnKind;
  icon?: IconName;
  onPress?: () => void;
  sm?: boolean;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  flex?: boolean;
  a11y?: string;
}) {
  const c = useColors();
  const off = disabled || kind === "off";
  const k = off ? "off" : kind;
  const bg: Record<BtnKind, string> = {
    pri: c.accent,
    sec: c.surface2,
    out: "transparent",
    ink: c.ink,
    txt: "transparent",
    dng: c.neg,
    dngo: "transparent",
    off: c.surface2,
  };
  const fg: Record<BtnKind, string> = {
    pri: c.onAccent,
    sec: c.ink,
    out: c.ink,
    ink: c.bg,
    txt: c.ink,
    dng: c.dark ? "#10231B" : "#FFFFFF",
    dngo: c.neg,
    off: c.muted,
  };
  const border = k === "out" ? c.line : k === "dngo" ? withAlpha(c.neg, 0.6) : undefined;
  const h = k === "txt" ? 48 : sm ? 48 : 56;
  return (
    <Pressable
      testID={testID ?? `btn-${tid(label)}`}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ disabled: !!off || !!loading }}
      disabled={off || loading}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          height: h,
          borderRadius: 999,
          backgroundColor: bg[k],
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingHorizontal: sm ? 18 : 20,
          borderWidth: border ? 1.5 : 0,
          borderColor: border,
          opacity: pressed ? 0.85 : off ? 0.75 : 1,
          alignSelf: sm && !flex ? "flex-start" : "stretch",
        },
        flex ? { flex: 1 } : null,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg[k]} /> : icon ? <Icon name={icon} size={22} strokeWidth={2} color={fg[k]} /> : null}
      <Txt
        numberOfLines={1}
        style={{
          fontFamily: k === "txt" ? fonts.bodySemi : fonts.bodyBold,
          fontSize: k === "txt" || sm ? 15 : 17,
          color: fg[k],
          textDecorationLine: k === "txt" ? "underline" : "none",
        }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}

export function Btns({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", gap: 8 }, style]}>{React.Children.map(children, (ch) => (ch ? <View style={{ flex: 1 }}>{ch}</View> : null))}</View>;
}

export function IconBtn({ name, onPress, testID, label, filled, color, size = 48 }: { name: IconName; onPress?: () => void; testID?: string; label: string; filled?: boolean; color?: string; size?: number }) {
  const c = useColors();
  return (
    <Pressable
      testID={testID ?? `icon-${tid(label)}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: filled ? c.surface2 : pressed ? c.surface2 : "transparent" })}
    >
      <Icon name={name} color={color} size={size < 44 ? 18 : 24} />
    </Pressable>
  );
}

// ───────────────────────── surfaces ─────────────────────────

export function Card({ children, tint, dashed, style, p = 16, onPress, testID, a11y }: { children: React.ReactNode; tint?: boolean; dashed?: boolean; style?: StyleProp<ViewStyle>; p?: number; onPress?: () => void; testID?: string; a11y?: string }) {
  const c = useColors();
  const st: StyleProp<ViewStyle> = [
    {
      backgroundColor: dashed ? "transparent" : tint ? c.surface2 : c.surface,
      borderWidth: tint ? 0 : dashed ? 1.5 : 1,
      borderColor: c.line,
      borderStyle: dashed ? "dashed" : "solid",
      borderRadius: 14,
      padding: p,
    },
    style,
  ];
  if (onPress)
    return (
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={({ pressed }) => [st, pressed ? { opacity: 0.9 } : null]}>
        {children}
      </Pressable>
    );
  return (
    <View style={st} testID={testID}>
      {children}
    </View>
  );
}

export function ListItem({
  left,
  title,
  sub,
  right,
  rsub,
  onPress,
  testID,
  last,
  dim,
  highlight,
  align = "center",
}: {
  left?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  rsub?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
  last?: boolean;
  dim?: boolean;
  highlight?: boolean;
  align?: "center" | "flex-start";
}) {
  const c = useColors();
  const body = (
    <View
      style={[
        { flexDirection: "row", alignItems: align, gap: 12, minHeight: 64, paddingVertical: 8, borderBottomWidth: last || highlight ? 0 : 1, borderBottomColor: c.line, opacity: dim ? 0.45 : 1 },
        highlight ? { borderRadius: 14, backgroundColor: mix(c.accent, 0.12, c.surface), borderWidth: 2, borderColor: c.accent, paddingHorizontal: 10, marginHorizontal: -10 } : null,
      ]}
    >
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === "string" ? <Txt v="lt">{title}</Txt> : title}
        {sub ? typeof sub === "string" ? <Txt v="t13" color="muted">{sub}</Txt> : sub : null}
      </View>
      {right !== undefined || rsub ? (
        <View style={{ alignItems: "flex-end" }}>
          {typeof right === "string" ? <Txt v="lt">{right}</Txt> : right}
          {rsub ? typeof rsub === "string" ? <Txt v="t13" color="muted">{rsub}</Txt> : rsub : null}
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {body}
    </Pressable>
  );
}

export function Tile({ icon, kind, size = 40 }: { icon: IconName; kind?: "a" | "p" | "n" | "i"; size?: number }) {
  const c = useColors();
  const bg = kind === "a" ? c.accent : kind === "p" ? mix(c.pos, 0.16, c.surface) : kind === "n" ? mix(c.neg, 0.14, c.surface) : kind === "i" ? mix(c.info, 0.14, c.surface) : c.surface2;
  const fg = kind === "a" ? c.onAccent : kind === "p" ? c.pos : kind === "n" ? c.neg : kind === "i" ? c.info : c.ink;
  return (
    <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={22} color={fg} />
    </View>
  );
}

export function BigIcon({ icon, kind, size = 72 }: { icon: IconName; kind: "p" | "n" | "i" | "a" | "m"; size?: number }) {
  const c = useColors();
  const bg = { p: mix(c.pos, 0.16, c.bg), n: mix(c.neg, 0.14, c.bg), i: mix(c.info, 0.14, c.bg), a: c.accent, m: c.surface2 }[kind];
  const fg = { p: c.pos, n: c.neg, i: c.info, a: c.onAccent, m: c.muted }[kind];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center", alignSelf: "center" }}>
      <Icon name={icon} size={size / 2} strokeWidth={2.2} color={fg} />
    </View>
  );
}

// ───────────────────────── chips / tags ─────────────────────────

export function Chip({
  label,
  on,
  ol,
  sm,
  tone,
  icon,
  onPress,
  testID,
}: {
  label: string;
  on?: boolean;
  ol?: boolean;
  sm?: boolean;
  tone?: "pos" | "neg" | "inf" | "acc";
  icon?: IconName;
  onPress?: () => void;
  testID?: string;
}) {
  const c = useColors();
  let bg = c.surface2;
  let fg = c.ink;
  if (on) {
    bg = c.ink;
    fg = c.bg;
  } else if (tone === "pos") {
    bg = mix(c.pos, 0.15, c.surface);
    fg = c.pos;
  } else if (tone === "neg") {
    bg = mix(c.neg, 0.14, c.surface);
    fg = c.neg;
  } else if (tone === "inf") {
    bg = mix(c.info, 0.14, c.surface);
    fg = c.info;
  } else if (tone === "acc") {
    bg = c.accent;
    fg = c.onAccent;
  }
  if (ol) bg = "transparent";
  const st: ViewStyle = {
    height: sm ? 26 : 36,
    paddingHorizontal: sm ? 10 : 14,
    borderRadius: 999,
    backgroundColor: bg,
    borderWidth: ol ? 1.5 : 0,
    borderColor: c.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  };
  const inner = (
    <>
      {icon ? <Icon name={icon} size={14} strokeWidth={2.2} color={fg} /> : null}
      <Txt numberOfLines={1} style={{ fontFamily: fonts.bodySemi, fontSize: sm ? 12 : 14, color: fg }}>
        {label}
      </Txt>
    </>
  );
  if (!onPress) return <View style={st}>{inner}</View>;
  return (
    <Pressable
      testID={testID ?? `chip-${tid(label)}`}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      accessibilityLabel={label}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [st, pressed ? { opacity: 0.8 } : null]}
    >
      {inner}
    </Pressable>
  );
}

export function DemoTag() {
  const c = useColors();
  return (
    <View style={{ height: 18, paddingHorizontal: 6, borderRadius: 999, backgroundColor: withAlpha(c.info, 0.16), justifyContent: "center", marginLeft: 4 }}>
      <Txt style={{ fontFamily: fonts.monoSemi, fontSize: 9.5, letterSpacing: 0.8, color: c.info }}>DEMO</Txt>
    </View>
  );
}

export function Pill({ children, icon, onPress, testID }: { children: React.ReactNode; icon?: IconName; onPress?: () => void; testID?: string }) {
  const c = useColors();
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.surface2, alignSelf: "center" }}>
      {typeof children === "string" ? <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 12 }}>{children}</Txt> : children}
      {icon ? <Icon name={icon} size={15} strokeWidth={2} /> : null}
    </View>
  );
  return onPress ? (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

// ───────────────────────── people ─────────────────────────

export function Avatar({ initial, color, size = 40, flag, ring }: { initial: string; color: string; size?: number; flag?: string; ring?: boolean }) {
  const c = useColors();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
        ...(ring ? { borderWidth: 2.5, borderColor: c.bg, outlineColor: c.accent, outlineWidth: 2, outlineStyle: "solid" } : null),
      }}
    >
      <Txt style={{ fontFamily: fonts.displayBold, fontSize: size * 0.42, color: "#fff", lineHeight: size * 0.5 }}>{initial}</Txt>
      {flag ? <Txt style={{ position: "absolute", right: -size * 0.1, bottom: -size * 0.12, fontSize: size * 0.38, lineHeight: size * 0.46 }}>{flag}</Txt> : null}
    </View>
  );
}

export function AvatarStack({ people, size = 28 }: { people: { initial: string; color: string }[]; size?: number }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", paddingLeft: 8 }}>
      {people.slice(0, 6).map((p, i) => (
        <View key={i} style={{ marginLeft: -8, borderRadius: 999, borderWidth: 2, borderColor: c.surface }}>
          <Avatar initial={p.initial} color={p.color} size={size} />
        </View>
      ))}
    </View>
  );
}

export function EmojiTile({ emoji, color, size = 48 }: { emoji: string; color: string; size?: number }) {
  const c = useColors();
  return (
    <View style={{ width: size, height: size, borderRadius: 14, backgroundColor: mix(color, 0.24, c.surface), alignItems: "center", justifyContent: "center" }}>
      <Txt style={{ fontSize: size * 0.5, lineHeight: size * 0.62 }}>{emoji}</Txt>
    </View>
  );
}

// ───────────────────────── wristband ─────────────────────────

export function Wristband({ color, text, thin }: { color: string; text?: string; thin?: boolean }) {
  const c = useColors();
  return (
    <View style={{ height: thin ? 8 : 28, backgroundColor: color, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 14, paddingRight: 12, overflow: "hidden" }}>
      <Stripes />
      {!thin ? (
        <>
          <Txt numberOfLines={1} style={{ fontFamily: fonts.monoSemi, fontSize: 10.5, letterSpacing: 1, color: "#10231B", textTransform: "uppercase", flex: 1 }}>
            {text}
          </Txt>
          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.surface, borderWidth: 3.5, borderColor: "rgba(16,35,27,0.28)" }} />
        </>
      ) : null}
    </View>
  );
}

function Stripes() {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: -20, top: -20, right: -20, bottom: -20, flexDirection: "row", transform: [{ rotate: "-35deg" }] }}>
      {Array.from({ length: 60 }, (_, i) => (
        <View key={i} style={{ width: 7, marginRight: 7, backgroundColor: "rgba(255,255,255,0.18)" }} />
      ))}
    </View>
  );
}

export function Band({ color, text, style }: { color: string; text: string; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[{ height: 48, borderRadius: 12, backgroundColor: color, flexDirection: "row", alignItems: "center", gap: 34, paddingHorizontal: 18, overflow: "hidden" }, style]}>
      <Stripes />
      <Txt numberOfLines={1} style={{ fontFamily: fonts.monoSemi, fontSize: 12, letterSpacing: 1.4, color: "#10231B" }}>
        {text}
      </Txt>
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.bg, borderWidth: 5, borderColor: "rgba(16,35,27,0.25)" }} />
      <Txt numberOfLines={1} style={{ fontFamily: fonts.monoSemi, fontSize: 12, letterSpacing: 1.4, color: "#10231B" }}>
        {text}
      </Txt>
    </View>
  );
}

// ───────────────────────── banners, bars ─────────────────────────

export function Banner({ kind, icon, title, text, children, testID }: { kind: "pos" | "neg" | "inf" | "mut" | "acc"; icon: IconName; title: string; text?: React.ReactNode; children?: React.ReactNode; testID?: string }) {
  const c = useColors();
  const k = { pos: c.pos, neg: c.neg, inf: c.info, mut: c.muted, acc: c.accentText }[kind];
  return (
    <View testID={testID} accessibilityRole="alert" style={{ flexDirection: "row", gap: 12, padding: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: mix(k, 0.13, c.surface), alignItems: "flex-start" }}>
      <View style={{ marginTop: 1 }}>
        <Icon name={icon} size={22} strokeWidth={2} color={k} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt style={{ fontFamily: fonts.bodyBold, fontSize: 15 }}>{title}</Txt>
        {text ? typeof text === "string" ? <Txt v="t15" style={{ fontSize: 14, lineHeight: 20 }}>{text}</Txt> : text : null}
        {children}
      </View>
    </View>
  );
}

export function Bar({ pct, color, over, pendingPct = 0 }: { pct: number; color?: string; over?: boolean; pendingPct?: number }) {
  const c = useColors();
  return (
    <View style={{ height: 8, borderRadius: 999, backgroundColor: c.surface2, overflow: "hidden", flexDirection: "row" }}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: over ? c.neg : color ?? c.ink, borderRadius: 999 }} />
      {pendingPct > 0 ? <View style={{ width: `${Math.min(100 - pct, pendingPct)}%`, backgroundColor: withAlpha(c.info, 0.45) }} /> : null}
    </View>
  );
}

export function LiveDot({ color }: { color?: string }) {
  const c = useColors();
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 1, duration: 900, useNativeDriver: true }), Animated.timing(a, { toValue: 0, duration: 900, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [a]);
  const col = color ?? c.pos;
  return (
    <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ position: "absolute", width: 16, height: 16, borderRadius: 8, backgroundColor: withAlpha(col.startsWith("#") ? col : "#1F7A55", 0.25), opacity: a }} />
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} />
    </View>
  );
}

// ───────────────────────── form ─────────────────────────

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  right,
  hint,
  testID,
  keyboardType,
  maxLength,
  onPress,
  autoFocus,
  multiline,
  inputProps,
}: {
  label?: string;
  value?: string;
  onChangeText?: (s: string) => void;
  placeholder?: string;
  right?: React.ReactNode;
  hint?: string;
  testID?: string;
  keyboardType?: TextInputProps["keyboardType"];
  maxLength?: number;
  onPress?: () => void;
  autoFocus?: boolean;
  multiline?: boolean;
  inputProps?: TextInputProps;
}) {
  const c = useColors();
  const [focus, setFocus] = React.useState(false);
  const box: ViewStyle = {
    minHeight: 60,
    borderWidth: 1.5,
    borderColor: focus ? c.ink : c.line,
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: c.surface,
    ...(focus ? { outlineColor: withAlpha(c.accent, 0.45), outlineWidth: 3, outlineStyle: "solid" } : null),
  };
  const content = (
    <View style={box}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {label ? <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 12, color: c.muted }}>{label}</Txt> : null}
        {onChangeText ? (
          <TextInput
            testID={testID ?? (label ? `field-${tid(label)}` : undefined)}
            accessibilityLabel={label ?? placeholder}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={c.muted}
            keyboardType={keyboardType}
            maxLength={maxLength}
            autoFocus={autoFocus}
            multiline={multiline}
            selectionColor={c.accent}
            cursorColor={c.accent}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            style={{ fontFamily: fonts.bodyMedium, fontSize: 17, color: c.ink, padding: 0, margin: 0 }}
            {...inputProps}
          />
        ) : (
          <Txt style={{ fontFamily: fonts.bodyMedium, fontSize: 17 }} color={value ? "ink" : "muted"}>
            {value || placeholder}
          </Txt>
        )}
      </View>
      {right ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{typeof right === "string" ? <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 14, color: c.muted }}>{right}</Txt> : right}</View> : null}
    </View>
  );
  return (
    <View>
      {onPress ? (
        <Pressable testID={testID ?? (label ? `field-${tid(label)}` : undefined)} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
          {content}
        </Pressable>
      ) : (
        content
      )}
      {hint ? (
        <Txt v="t13" color="muted" style={{ marginTop: 4 }}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

export function Toggle({ on, onChange, testID, label }: { on: boolean; onChange: (v: boolean) => void; testID?: string; label: string }) {
  const c = useColors();
  return (
    <Switch
      testID={testID ?? `toggle-${tid(label)}`}
      accessibilityLabel={label}
      value={on}
      onValueChange={onChange}
      trackColor={{ false: c.surface2, true: c.accent }}
      thumbColor={on ? "#10231B" : c.muted}
    />
  );
}

export function Seg<T extends string>({ options, value, onChange, testID }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", backgroundColor: c.surface2, borderRadius: 999, padding: 4, gap: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={`seg-${tid(o.label)}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{ flex: 1, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: on ? c.surface : "transparent", elevation: on ? 1 : 0 }}
          >
            <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 14, color: on ? c.ink : c.muted }}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Radio({ on }: { on: boolean }) {
  const c = useColors();
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? c.ink : c.muted, alignItems: "center", justifyContent: "center" }}>
      {on ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.ink }} /> : null}
    </View>
  );
}

export function Checkbox({ on }: { on: boolean }) {
  const c = useColors();
  return (
    <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: on ? c.ink : c.muted, backgroundColor: on ? c.ink : "transparent", alignItems: "center", justifyContent: "center" }}>
      {on ? <Icon name="check" size={16} strokeWidth={3} color={c.bg} /> : null}
    </View>
  );
}

export function Stepper({ value, onMinus, onPlus, testID }: { value: string; onMinus: () => void; onPlus: () => void; testID?: string }) {
  const c = useColors();
  const b = (t: string, f: () => void, id: string) => (
    <Pressable testID={id} accessibilityRole="button" accessibilityLabel={t === "−" ? "Less" : "More"} onPress={f} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }}>
      <Txt style={{ fontFamily: fonts.bodyBold, fontSize: 18 }}>{t}</Txt>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: c.surface2, borderRadius: 999, padding: 4 }}>
      {b("−", onMinus, `${testID ?? "stepper"}-minus`)}
      <Txt tnum style={{ minWidth: 56, textAlign: "center", fontFamily: fonts.bodyBold }}>
        {value}
      </Txt>
      {b("+", onPlus, `${testID ?? "stepper"}-plus`)}
    </View>
  );
}

// ───────────────────────── misc ─────────────────────────

export function Step({ n, children }: { n: number; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c.ink, alignItems: "center", justifyContent: "center" }}>
        <Txt style={{ fontFamily: fonts.bodyBold, fontSize: 13, color: c.bg }}>{n}</Txt>
      </View>
      <View style={{ flex: 1 }}>{typeof children === "string" ? <Txt v="t15">{children}</Txt> : children}</View>
    </View>
  );
}

export function Tiers({ segs, height = 40, fontSize = 12 }: { segs: { flex: number; label: string; kind: "now" | "one" | "high" }[]; height?: number; fontSize?: number }) {
  const col = { now: "#BFE3CF", one: "#BFD5EA", high: "#F8D892" };
  return (
    <View style={{ flexDirection: "row", height, borderRadius: 12, overflow: "hidden" }}>
      {segs.map((s, i) => (
        <View key={i} style={{ flex: s.flex, backgroundColor: col[s.kind], alignItems: "center", justifyContent: "center" }}>
          <Txt style={{ fontFamily: fonts.bodySemi, fontSize, color: "#10231B" }}>{s.label}</Txt>
        </View>
      ))}
    </View>
  );
}

export function SectionHead({ title, right, onRight, testID, live }: { title: string; right?: string; onRight?: () => void; testID?: string; live?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 20, marginBottom: 6 }}>
      <Row gap={10}>
        {live ? <LiveDot /> : null}
        <Txt v="d17">{title}</Txt>
      </Row>
      {right ? (
        <Pressable testID={testID ?? `link-${tid(right)}`} accessibilityRole="button" onPress={onRight} hitSlop={10}>
          <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 13 }} color="muted">
            {right}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Proof({ hash, testID }: { hash?: string; testID?: string }) {
  const c = useColors();
  if (!hash) return null;
  return (
    <Pressable testID={testID ?? "proof"} accessibilityRole="link" accessibilityLabel="Proof" onPress={() => void Linking.openURL(explorerTxUrl(hash))} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 13, color: c.info, textDecorationLine: "underline" }}>Proof</Txt>
      <Icon name="out" size={14} strokeWidth={2.2} color={c.info} />
    </Pressable>
  );
}

export function SettledIn({ ms }: { ms?: number | null }) {
  const c = useColors();
  if (ms === undefined || ms === null) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }} testID="settled-in">
      <Icon name="zap" size={14} strokeWidth={2.2} color={c.pos} />
      <Txt style={{ fontFamily: fonts.monoSemi, fontSize: 12, color: c.pos }}>Settled in {formatSeconds(ms)}</Txt>
    </View>
  );
}

export function formatSeconds(ms: number): string {
  if (ms < 10_000) return `${(Math.max(ms, 50) / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

export function FingerprintPill({ emoji, label = "Your key", onPress, testID }: { emoji?: string; label?: string; onPress?: () => void; testID?: string }) {
  const c = useColors();
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 44, paddingLeft: 14, paddingRight: 5, borderRadius: 999, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.line, alignSelf: "flex-start" }}>
      <Txt style={{ fontFamily: fonts.monoSemi, fontSize: 10, letterSpacing: 0.9, color: c.muted, textTransform: "uppercase" }}>{label}</Txt>
      <View style={{ backgroundColor: c.surface, borderRadius: 999, paddingVertical: 3, paddingLeft: 13, paddingRight: 8 }}>
        <Txt testID="key-fingerprint" style={{ fontSize: 19, letterSpacing: 5, lineHeight: 26 }}>
          {emoji ?? "· · ·"}
        </Txt>
      </View>
    </View>
  );
  return onPress ? (
    <Pressable testID={testID ?? "key-pill"} accessibilityRole="button" accessibilityLabel="Your key" onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function Skel({ w, h, r = 10, style }: { w: number | `${number}%`; h: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const a = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(a, { toValue: 0.6, duration: 700, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [a]);
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: c.skel, opacity: a }, style]} />;
}

export function Logo({ size = 22 }: { size?: number }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: size * 0.45 }} accessibilityLabel="Plans">
      <View style={{ width: size * 1.2, height: size * 0.55, borderRadius: size * 0.14, overflow: "hidden", flexDirection: "row" }}>
        {Array.from({ length: 4 }, (_, i) => (
          <React.Fragment key={i}>
            <View style={{ width: size * 0.27, backgroundColor: c.accent }} />
            <View style={{ width: size * 0.09, backgroundColor: c.ink }} />
          </React.Fragment>
        ))}
      </View>
      <Txt style={{ fontFamily: fonts.display, fontSize: size, letterSpacing: -0.4, lineHeight: size * 1.1 }}>plans</Txt>
    </View>
  );
}

export function Confetti({ pieces }: { pieces: [number, number, string, number][] }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
      {pieces.map(([x, y, col, r], i) => (
        <View key={i} style={{ position: "absolute", left: x, top: y, width: 10, height: 18, borderRadius: 3, backgroundColor: col, transform: [{ rotate: `${r}deg` }] }} />
      ))}
    </View>
  );
}

export function Hero({ big, small, size = "d34", testID }: { big: string; small?: string; size?: "d34" | "d56" | "d44" | "d28"; testID?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <Txt v={size} testID={testID} tnum>
        {big}
      </Txt>
      {small ? (
        <Txt v="t17" color="muted" weight="medium">
          {small}
        </Txt>
      ) : null}
    </View>
  );
}

export function Overline({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Txt v="ov" color="muted">
        {children}
      </Txt>
    </View>
  );
}
