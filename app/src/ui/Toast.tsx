import * as Haptics from "expo-haptics";
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createStore, useStore } from "../lib/state/observable";
import { useColors } from "../theme/ThemeProvider";
import { fonts } from "../theme/tokens";
import { Avatar } from "./kit";
import { Txt } from "./Text";

export type ToastItem = { id: number; title: string; sub?: string; avatar?: { initial: string; color: string }; emoji?: string; onPress?: () => void; at: number };

const toasts = createStore<ToastItem[]>([]);
let nextId = 1;

/** Shows the design's live banner (screen 19): one light haptic tick, gone after 4 s. Several at once group. */
export function showToast(t: Omit<ToastItem, "id" | "at">): void {
  const item = { ...t, id: nextId++, at: Date.now() };
  toasts.set((prev) => [...prev.slice(-2), item]);
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  setTimeout(() => toasts.set((prev) => prev.filter((x) => x.id !== item.id)), 4000);
}

export function ToastHost() {
  const items = useStore(toasts);
  const c = useColors();
  const ins = useSafeAreaInsets();
  const y = useRef(new Animated.Value(-120)).current;
  const top = items[items.length - 1];
  useEffect(() => {
    Animated.spring(y, { toValue: top ? 0 : -160, useNativeDriver: true, speed: 16, bounciness: 4 }).start();
  }, [top, y]);
  if (!top) return null;
  const many = items.length > 1;
  return (
    <Animated.View pointerEvents="box-none" style={{ position: "absolute", left: 10, right: 10, top: ins.top + 6, transform: [{ translateY: y }], zIndex: 100 }}>
      <Pressable
        testID="toast"
        accessibilityRole="alert"
        onPress={() => {
          top.onPress?.();
          toasts.set([]);
        }}
        style={{ backgroundColor: c.surface, borderRadius: 20, padding: 12, paddingHorizontal: 14, flexDirection: "row", gap: 12, alignItems: "center", borderWidth: 1, borderColor: c.line, elevation: 8 }}
      >
        {top.avatar ? <Avatar initial={top.avatar.initial} color={top.avatar.color} size={40} /> : top.emoji ? <Txt style={{ fontSize: 28 }}>{top.emoji}</Txt> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="lt" numberOfLines={1}>
            {many ? `${items.length} new updates` : top.title}
          </Txt>
          {top.sub && !many ? (
            <Txt v="t13" color="muted" numberOfLines={1}>
              {top.sub}
            </Txt>
          ) : null}
        </View>
        <Txt style={{ fontFamily: fonts.mono, fontSize: 11, color: c.muted }}>now</Txt>
      </Pressable>
    </Animated.View>
  );
}
