/**
 * The laptop layout (design 101): a left rail (Plans, Send, Activity, You, your plans, your
 * account), the main column (the current route), and a right panel (what's live, or the detail you
 * opened). Phones and tablets get the children untouched, so Android and phone browsers show the
 * approved phone screens exactly.
 *
 * Keyboard (design 101): N new spend in a plan (new plan elsewhere), S send, G then P/S/A/Y to go to
 * Plans/Send/Activity/You, Esc closes an open detail panel. Keys are ignored while typing.
 */
import { router, usePathname } from "expo-router";
import React, { useEffect } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { formatUsd } from "../../lib/domain/currency";
import { identity } from "../../lib/identity/session";
import { useBalance, useMyPlans } from "../../lib/state/data";
import { useStore } from "../../lib/state/observable";
import { useColors } from "../../theme/ThemeProvider";
import { fonts } from "../../theme/tokens";
import { Icon, type IconName } from "../Icon";
import { Avatar, EmojiTile, Logo } from "../kit";
import { useLocal } from "../money";
import { Txt } from "../Text";
import { LivePanel } from "./LivePanel";
import { usePanelEntry } from "./panel";
import { PANEL_LAPTOP, PANEL_WIDE, RAIL_ICONS, RAIL_WIDE, useLayout } from "./responsive";

/** Routes drawn without the rail: before you're in, and full-page moments. */
const BARE = [/^\/welcome/, /^\/unlock$/, /^\/unsupported/, /^\/restored/, /^\/error/, /^\/profile/];

type Place = { key: "plans" | "send" | "activity" | "you"; label: string; icon: IconName; href: string };
const PLACES: Place[] = [
  { key: "plans", label: "Plans", icon: "ticket", href: "/" },
  { key: "send", label: "Send", icon: "send", href: "/send" },
  { key: "activity", label: "Activity", icon: "bell", href: "/activity" },
  { key: "you", label: "You", icon: "user", href: "/you" },
];

export function placeFor(path: string): Place["key"] | null {
  if (path === "/" || path.startsWith("/plan") || path.startsWith("/demo")) return "plans";
  if (path.startsWith("/send") || path === "/my-code" || path === "/balance" || path === "/add-balance") return "send";
  if (path.startsWith("/activity") || path === "/notifications") return "activity";
  if (path.startsWith("/you") || path === "/key" || path === "/help" || path.startsWith("/risks") || path === "/test-dollars") return "you";
  return null;
}

function go(href: string) {
  router.navigate(href as never);
}

function NavItem({ p, on, icons, badge }: { p: Place; on: boolean; icons: boolean; badge?: number }) {
  const c = useColors();
  return (
    <Pressable
      testID={`rail-${p.key}`}
      accessibilityRole="link"
      accessibilityLabel={p.label}
      accessibilityState={{ selected: on }}
      onPress={() => go(p.href)}
      style={(st) => { const hovered = (st as { hovered?: boolean }).hovered; return ({
        height: 44,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: icons ? "center" : "flex-start",
        gap: 12,
        paddingHorizontal: icons ? 0 : 14,
        backgroundColor: on ? c.accent : hovered ? c.surface2 : "transparent",
      }); }}
    >
      <View>
        <Icon name={p.icon} size={21} strokeWidth={2} color={on ? c.onAccent : c.ink} />
        {icons && badge ? <View style={{ position: "absolute", top: -2, right: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: c.neg, borderWidth: 2, borderColor: c.surface }} /> : null}
      </View>
      {!icons ? (
        <>
          <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 16, color: on ? c.onAccent : c.ink, flex: 1 }}>{p.label}</Txt>
          {badge ? (
            <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: c.neg, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}>
              <Txt style={{ fontFamily: fonts.bodyBold, fontSize: 12, color: "#fff" }}>{badge}</Txt>
            </View>
          ) : null}
        </>
      ) : null}
    </Pressable>
  );
}

function Rail({ icons, path }: { icons: boolean; path: string }) {
  const c = useColors();
  const plans = useMyPlans();
  const bal = useBalance();
  const local = useLocal();
  const profile = useStore(identity, (s) => s.profile);
  const fingerprint = useStore(identity, (s) => s.fingerprint);
  const place = placeFor(path);
  const list = (plans.data ?? []).filter((p) => p.myStatus === "Active" || p.myDebt > 0n);
  const needs = list.reduce((n, p) => n + p.needsMe + (p.myDebt > 0n ? 1 : 0), 0);
  const activePot = /^\/plan\/(0x[0-9a-fA-F]{40})/.exec(path)?.[1]?.toLowerCase();
  const name = profile?.name ?? "";
  const balance = bal.data ?? 0n;
  const width = icons ? RAIL_ICONS : RAIL_WIDE;

  return (
    <View testID="rail" style={{ width, backgroundColor: c.surface, borderRightWidth: 1, borderRightColor: c.line }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: icons ? 12 : 12, paddingTop: 24, paddingBottom: 16 }}>
        <Pressable onPress={() => go("/")} accessibilityRole="link" accessibilityLabel="Plans home" style={{ paddingHorizontal: icons ? 0 : 12, alignItems: icons ? "center" : "flex-start", marginBottom: 20 }} testID="rail-logo">
          {icons ? <Logo size={18} /> : <Logo size={22} />}
        </Pressable>
        <View style={{ gap: 4 }}>
          {PLACES.map((p) => (
            <NavItem key={p.key} p={p} on={place === p.key && !(p.key === "plans" && activePot)} icons={icons} badge={p.key === "activity" ? needs : undefined} />
          ))}
        </View>
        {!icons ? (
          <>
            <Txt v="ov" color="muted" style={{ marginTop: 28, marginBottom: 8, paddingHorizontal: 12 }}>
              Your plans
            </Txt>
            {list.map((p) => {
              const on = activePot === p.pot.toLowerCase();
              const pos = p.myNet > 0n;
              const neg = p.myNet < 0n || p.myDebt > 0n;
              const fmt = local.fmt(p.myNet < 0n ? -p.myNet : p.myNet);
              return (
                <Pressable
                  key={p.pot}
                  testID={`rail-plan-${p.pot.slice(2, 8)}`}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${p.meta.name}`}
                  onPress={() => router.navigate({ pathname: "/plan/[pot]", params: { pot: p.pot } })}
                  style={(st) => { const hovered = (st as { hovered?: boolean }).hovered; return ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    borderRadius: 12,
                    backgroundColor: on ? c.surface2 : hovered ? c.surface2 : "transparent",
                    borderLeftWidth: 3,
                    borderLeftColor: on ? p.meta.color : "transparent",
                  }); }}
                >
                  <EmojiTile emoji={p.meta.emoji} color={p.meta.color} size={30} />
                  {/* Two lines before an ellipsis, so names like "Lisbon, 12–16 Oct" are never cut. */}
                  <Txt numberOfLines={2} style={{ flex: 1, minWidth: 0, fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 18 }}>
                    {p.meta.name}
                  </Txt>
                  {p.myNet !== 0n || p.myDebt > 0n ? (
                    <Txt style={{ fontFamily: fonts.mono, fontSize: 11, color: pos ? c.pos : neg ? c.neg : c.muted, flexShrink: 0 }}>
                      {pos ? "+" : "−"}
                      {p.myDebt > 0n ? local.fmt(p.myDebt) ?? formatUsd(p.myDebt) : fmt ?? formatUsd(p.myNet < 0n ? -p.myNet : p.myNet)}
                    </Txt>
                  ) : null}
                </Pressable>
              );
            })}
            {[
              { icon: "plus" as IconName, label: "New plan", href: "/plan/new", id: "rail-new-plan" },
              { icon: "link" as IconName, label: "Join with a link", href: "/join-link", id: "rail-join" },
            ].map((x) => (
              <Pressable key={x.id} testID={x.id} accessibilityRole="link" onPress={() => go(x.href)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 14 }}>
                <Icon name={x.icon} size={18} color={c.muted} />
                <Txt v="t15" color="muted" weight="medium">
                  {x.label}
                </Txt>
              </Pressable>
            ))}
          </>
        ) : null}
        <View style={{ flex: 1, minHeight: 24 }} />
        {!icons ? (
          <Pressable onPress={() => go("/balance")} testID="rail-balance" accessibilityRole="link" accessibilityLabel="Your Plans account" style={{ backgroundColor: c.surface2, borderRadius: 14, padding: 14 }}>
            <Txt v="ov" color="muted">
              Your Plans account
            </Txt>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 4 }}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 24, letterSpacing: -0.5 }}>{formatUsd(balance)}</Txt>
              {local.fmt(balance) ? (
                <Txt v="t13" color="muted">
                  {local.fmt(balance)}
                </Txt>
              ) : null}
            </View>
          </Pressable>
        ) : null}
        <Pressable onPress={() => go("/you")} testID="rail-me" accessibilityRole="link" accessibilityLabel="You" style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, paddingHorizontal: icons ? 0 : 4, justifyContent: icons ? "center" : "flex-start" }}>
          <Avatar initial={(name[0] ?? "?").toUpperCase()} color="#D9634B" size={36} />
          {!icons ? (
            <>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt v="t15" weight="semi" numberOfLines={1}>
                  {name}
                </Txt>
                <Txt v="t13" color="muted" numberOfLines={1} style={{ fontSize: 12 }}>
                  {[profile?.city, profile?.currency].filter(Boolean).join(" · ")}
                </Txt>
              </View>
              {fingerprint ? (
                <View style={{ backgroundColor: c.surface2, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Txt style={{ fontSize: 13, letterSpacing: 2 }}>{fingerprint}</Txt>
                </View>
              ) : null}
            </>
          ) : null}
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Panel({ overlay }: { overlay: boolean }) {
  const c = useColors();
  const entry = usePanelEntry();
  const { mode } = useLayout();
  // At laptop width the live panel is hidden; form panels stay as a column; details cover the right side.
  if (!entry && overlay) return null;
  if (entry?.kind === "live" && overlay) return null;
  const floating = overlay && entry?.kind === "detail";
  const width = mode === "wide" ? PANEL_WIDE : PANEL_LAPTOP;
  return (
    <View
      testID="panel"
      style={[
        { width, backgroundColor: c.surface, borderLeftWidth: 1, borderLeftColor: c.line },
        floating ? { position: "absolute", right: 0, top: 0, bottom: 0, zIndex: 20, borderLeftColor: c.ink, borderLeftWidth: 1.5 } : null,
      ]}
    >
      {entry?.onClose && entry.kind === "detail" ? (
        <Pressable onPress={entry.onClose} accessibilityLabel="Close" testID="panel-close" style={{ position: "absolute", right: 14, top: 14, zIndex: 2, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" }}>
          <Icon name="x" size={20} />
        </Pressable>
      ) : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, padding: entry && !entry.pad ? 0 : 24 }}>
        {entry ? entry.node : <LivePanel />}
      </ScrollView>
    </View>
  );
}

function useShortcuts(enabled: boolean, path: string) {
  const entry = usePanelEntry();
  useEffect(() => {
    if (!enabled || Platform.OS !== "web" || typeof window === "undefined") return;
    let g = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (entry?.onClose) entry.onClose();
        return;
      }
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (g) {
        g = false;
        const to = { p: "/", s: "/send", a: "/activity", y: "/you" }[k];
        if (to) {
          e.preventDefault();
          go(to);
        }
        return;
      }
      if (k === "g") {
        g = true;
        if (gTimer) clearTimeout(gTimer);
        gTimer = setTimeout(() => (g = false), 1200);
        return;
      }
      if (k === "n") {
        e.preventDefault();
        const pot = /^\/plan\/(0x[0-9a-fA-F]{40})/.exec(path)?.[1];
        if (pot) router.push({ pathname: "/plan/[pot]/pay-form", params: { pot } });
        else router.push("/plan/new");
      } else if (k === "s") {
        e.preventDefault();
        go("/send");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (gTimer) clearTimeout(gTimer);
    };
  }, [enabled, path, entry]);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const { mode, desk } = useLayout();
  const path = usePathname();
  const status = useStore(identity, (s) => s.status);
  const hasProfile = useStore(identity, (s) => !!s.profile);
  const on = desk && status === "unlocked" && hasProfile && !BARE.some((r) => r.test(path));
  useShortcuts(on, path);
  if (!on) return <>{children}</>;
  const icons = mode === "laptop";
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: c.bg }} testID="app-shell">
      <Rail icons={icons} path={path} />
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      <Panel overlay={icons} />
    </View>
  );
}

/** True inside the rail/main/panel shell (used by Screen and the tab bar). */
export function useInShell(): boolean {
  const { desk } = useLayout();
  const path = usePathname();
  const status = useStore(identity, (s) => s.status);
  const hasProfile = useStore(identity, (s) => !!s.profile);
  return desk && status === "unlocked" && hasProfile && !BARE.some((r) => r.test(path));
}
