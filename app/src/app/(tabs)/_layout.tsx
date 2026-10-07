import { Redirect } from "expo-router";
import Tabs from "expo-router/js-tabs";
import React from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { identity } from "../../lib/identity/session";
import { useMyPlans } from "../../lib/state/data";
import { useStore } from "../../lib/state/observable";
import { useColors } from "../../theme/ThemeProvider";
import { fonts } from "../../theme/tokens";
import { Icon, type IconName } from "../../ui/Icon";
import { useInShell } from "../../ui/shell/AppShell";
import { Txt } from "../../ui/Text";

const TABS: { name: string; icon: IconName; label: string }[] = [
  { name: "index", icon: "ticket", label: "Plans" },
  { name: "send", icon: "send", label: "Send" },
  { name: "activity", icon: "bell", label: "Activity" },
  { name: "you", icon: "user", label: "You" },
];

function TabBar({ state, navigation }: { state: { index: number; routes: { key: string; name: string }[] }; navigation: { navigate: (n: string) => void } }) {
  const c = useColors();
  const ins = useSafeAreaInsets();
  const plans = useMyPlans();
  const shell = useInShell();
  const needsYou = (plans.data ?? []).some((p) => p.needsMe > 0 || p.myDebt > 0n);
  // On a laptop the left rail replaces the tab bar.
  if (shell) return null;
  return (
    <View style={{ flexDirection: "row", backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10, paddingBottom: 10 + ins.bottom, height: 80 + ins.bottom }}>
      {state.routes.map((r, i) => {
        const t = TABS.find((x) => x.name === r.name);
        if (!t) return null;
        const on = state.index === i;
        return (
          <Pressable
            key={r.key}
            testID={`tab-${t.label.toLowerCase()}`}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
            onPress={() => navigation.navigate(r.name)}
            style={{ flex: 1, alignItems: "center", gap: 4 }}
          >
            <View style={{ width: 60, height: 32, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: on ? c.accent : "transparent" }}>
              <Icon name={t.icon} size={22} strokeWidth={2} color={on ? c.onAccent : c.muted} />
              {t.name === "activity" && needsYou && !on ? (
                <View testID="activity-dot" style={{ position: "absolute", top: 3, right: 16, width: 8, height: 8, borderRadius: 4, backgroundColor: c.neg, borderWidth: 2, borderColor: c.surface }} />
              ) : null}
            </View>
            <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 12, color: on ? c.ink : c.muted }}>{t.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const status = useStore(identity, (s) => s.status);
  if (status === "none") return <Redirect href="/welcome" />;
  if (status === "locked") return <Redirect href="/unlock" />;
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(p: unknown) => <TabBar {...(p as Parameters<typeof TabBar>[0])} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="send" />
      <Tabs.Screen name="activity" />
      <Tabs.Screen name="you" />
    </Tabs>
  );
}
