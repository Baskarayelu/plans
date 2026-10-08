/**
 * Shared bits for the safety, ending and demo screens (33–42, 56–57): per-person money, the
 * rates line, loading/error states, the settle-up arrow and the settling ring.
 */
import { useQuery } from "@tanstack/react-query";
import { NO_MOTION } from "../motion";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { Address } from "viem";
import { canSettle } from "../../lib/chain/rpc";
import { fromHex } from "../../lib/crypto/bytes";
import { decodeMemo } from "../../lib/crypto/seal";
import { formatLocal, formatUsd } from "../../lib/domain/currency";
import { categoryOf } from "../../lib/domain/rules";
import { useFxMap, type Person, type PlanVM } from "../../lib/state/data";
import { useColors } from "../../theme/ThemeProvider";
import { fonts } from "../../theme/tokens";
import { Banner, Btn, Card, Skel } from "../kit";
import { AppBar, Screen } from "../layout";
import { PersonAvatar } from "../plan/common";
import { Txt } from "../Text";

// ─────────────── money per person ───────────────

/** Formats amounts in each person's own currency (dollars until their rate arrives). */
export function usePeopleMoney(people: Person[]) {
  const fx = useFxMap(people.map((p) => p.currency));
  const local = (units: bigint, p: Person | undefined, o: { sign?: boolean } = {}) =>
    (p ? formatLocal(units, p.currency, fx[p.currency], o) : undefined) ?? formatUsd(units, o);
  /** The small second line: dollars, or "dollars" when they already get dollars. */
  const second = (units: bigint, p: Person | undefined) => (!p || p.currency === "USD" ? "dollars" : formatUsd(units));
  return { local, second, fx };
}


// ─────────────── reads ───────────────

/** Pot.canSettle() over RPC, refreshed every few seconds while the screen is open. */
export function useCanSettle(pot: string | undefined, enabled = true, intervalMs = 5_000) {
  return useQuery({
    queryKey: ["canSettle", (pot ?? "").toLowerCase()],
    queryFn: () => canSettle(pot as Address),
    enabled: !!pot && enabled,
    refetchInterval: intervalMs,
    staleTime: 0,
  });
}

/** Ticks every `ms` so countdowns and timers re-render. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** A spend's note, decrypted when the group key is known. */
export function spendNote(plan: PlanVM, s: { memo?: string }): string | undefined {
  if (!s.memo || s.memo === "0x") return undefined;
  try {
    return decodeMemo(plan.gk ?? undefined, plan.pot, "memo", fromHex(s.memo))?.text || undefined;
  } catch {
    return undefined;
  }
}

/** A spend's note, else its category. */
export function spendLabel(plan: PlanVM, s: { memo?: string; category?: number }): string {
  const note = spendNote(plan, s);
  if (note) return note;
  const c = categoryOf(s.category ?? 7);
  return `${c.emoji} ${c.name}`;
}

export function personOf(plan: PlanVM, address?: string | null): Person | undefined {
  return address ? plan.people[address.toLowerCase()] : undefined;
}

// ─────────────── states ───────────────

/** Loading skeleton for a plan screen. */
export function PlanSkeleton({ title }: { title?: string }) {
  return (
    <Screen>
      <AppBar title={title} />
      <View style={{ gap: 12 }} testID="plan-loading">
        <Skel w="70%" h={30} />
        <Skel w="90%" h={18} />
        <Skel w="100%" h={120} r={14} />
        <Skel w="100%" h={64} r={14} />
        <Skel w="100%" h={64} r={14} />
      </View>
    </Screen>
  );
}

/** Error or missing plan, with Try again. */
export function PlanProblem({ title, onRetry, missing }: { title?: string; onRetry: () => void; missing?: boolean }) {
  return (
    <Screen>
      <AppBar title={title} />
      <Banner
        kind={missing ? "mut" : "neg"}
        icon={missing ? "info" : "wifioff"}
        title={missing ? "We can't find this plan" : "Couldn't load this plan"}
        text={missing ? "It may still be on its way. Try again in a moment." : "Check your connection and try again."}
        testID="plan-error"
      >
        <View style={{ marginTop: 8 }}>
          <Btn label="Try again" kind="sec" sm icon="refresh" onPress={onRetry} testID="btn-try-again" />
        </View>
      </Banner>
    </Screen>
  );
}

/** A full-screen calm message with one way out. */
export function NoticeScreen({ title, heading, text, action, actionLabel = "Back to the plan", testID }: { title?: string; heading: string; text: string; action?: () => void; actionLabel?: string; testID?: string }) {
  return (
    <Screen dock={<Btn label={actionLabel} kind="sec" onPress={action ?? (() => (router.canGoBack() ? router.back() : router.replace("/")))} />} testID={testID}>
      <AppBar title={title} />
      <Txt v="d28" style={{ marginTop: 8 }}>
        {heading}
      </Txt>
      <Txt v="t15" color="muted" style={{ marginTop: 8 }}>
        {text}
      </Txt>
    </Screen>
  );
}

// ─────────────── settle-up arrow (38) ───────────────

export function EdgeArrow({ from, to, label, note, testID }: { from: Person; to: Person; label: string; note?: string; testID?: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: 64 }} testID={testID}>
      <PersonAvatar p={from} size={36} />
      <Txt v="t13" weight="bold" numberOfLines={1} style={{ width: 52, marginLeft: 8 }}>
        {from.name}
      </Txt>
      <View style={{ flex: 1, height: 44, justifyContent: "center", marginHorizontal: 4 }}>
        <Txt numberOfLines={1} style={{ position: "absolute", top: 0, left: 0, right: 10, textAlign: "center", fontFamily: fonts.monoSemi, fontSize: 12, color: c.ink }}>
          {label}
        </Txt>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1, height: 2, backgroundColor: c.ink, borderRadius: 1 }} />
          <View style={{ width: 0, height: 0, borderTopWidth: 6, borderBottomWidth: 6, borderLeftWidth: 9, borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: c.ink }} />
        </View>
        {note ? (
          <Txt numberOfLines={1} style={{ position: "absolute", bottom: -2, left: 0, right: 10, textAlign: "center", fontFamily: fonts.bodySemi, fontSize: 11, color: c.info }}>
            {note}
          </Txt>
        ) : null}
      </View>
      <PersonAvatar p={to} size={36} />
      <Txt v="t13" weight="bold" numberOfLines={1} style={{ marginLeft: 8, maxWidth: 64 }}>
        {to.name}
      </Txt>
    </View>
  );
}

// ─────────────── settling ring (39) ───────────────

export function SpinnerRing({ label, size = 120 }: { label: string; size?: number }) {
  const c = useColors();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (NO_MOTION) return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const r = size / 2 - 8;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <View style={{ width: size, height: size, alignSelf: "center" }} testID="settling-ring">
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c.surface2} strokeWidth={10} />
      </Svg>
      <Animated.View style={{ position: "absolute", left: 0, top: 0, width: size, height: size, transform: [{ rotate }] }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c.accent} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${r * 4} ${r * 8}`} />
        </Svg>
      </Animated.View>
      <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
        <Txt style={{ fontFamily: fonts.monoSemi, fontSize: 20 }} testID="settling-elapsed">
          {label}
        </Txt>
      </View>
    </View>
  );
}

/** Small stat tile (41). */
export function Stat({ value, label, testID }: { value: string; label: string; testID?: string }) {
  return (
    <Card p={14} style={{ flex: 1 }} testID={testID}>
      <Txt v="d22" numberOfLines={1}>
        {value}
      </Txt>
      <Txt v="t13" color="muted" numberOfLines={2}>
        {label}
      </Txt>
    </Card>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayMonth(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export function timeOfDay(sec: number): string {
  const d = new Date(sec * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
