/**
 * Laptop building blocks for the Plans screens (designs 108–113). Used only when
 * `useLayout().desk` is true, so the approved phone screens are untouched.
 */
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { fetchPlanActivity, type ActivityRow, type SpendRow } from "../../lib/api/envio";
import { formatUsd } from "../../lib/domain/currency";
import { useSpendDetail } from "../../lib/spend/hooks";
import { personFor, type PlanVM } from "../../lib/state/data";
import { useColors } from "../../theme/ThemeProvider";
import { fonts } from "../../theme/tokens";
import { SpendItem, needsMyOk } from "../core/SpendItem";
import { Icon, type IconName } from "../Icon";
import { Banner, Btn, Col, ListItem, LiveDot, Row, Skel } from "../kit";
import { PersonAvatar, useMoney } from "../plan/common";
import { ago } from "../planBits";
import { Outlined, useFreshIds } from "../shell/LivePanel";
import { useLayout } from "../shell/responsive";
import { Txt } from "../Text";
import { SpendDetailBody } from "./spend";

/** Small buttons in laptop headers are 40 px tall (design .btn.sm on 108–113). */
export const DESK_SM = { height: 40, minHeight: 40, paddingHorizontal: 16 } as const;

/** Prose column: caps line length in the 792 px main column (design: no line longer than ~680 px). */
export function Narrow({ children, max = 680, center, style }: { children: React.ReactNode; max?: number; center?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: "100%", maxWidth: max }, center ? { alignSelf: "center" } : null, style]}>{children}</View>;
}

/**
 * A centred column for single-task screens on a laptop (forms, receipts, the demo): the content
 * capped at `max`, with the screen's dock buttons under it instead of the bottom bar. On phones it
 * renders its children untouched — pass the dock to Screen there as usual.
 */
export function DeskColumn({ children, dock, max = 640 }: { children: React.ReactNode; dock?: React.ReactNode; max?: number }) {
  const { desk } = useLayout();
  if (!desk) return <>{children}</>;
  return (
    <Narrow max={max} center>
      {children}
      {dock ? <View style={{ marginTop: 24, gap: 8 }}>{dock}</View> : null}
    </Narrow>
  );
}

/** Section heading inside the main column: d22 title, muted link on the right ("Plans · 2 plans", "Recent money · See all"). */
export function DeskSection({ title, right, onRight, testID, size = "d22", style }: { title: string; right?: string; onRight?: () => void; testID?: string; size?: "d22" | "d17"; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 24, marginBottom: 10 }, style]}>
      <Txt v={size}>{title}</Txt>
      {right ? (
        onRight ? (
          <Pressable testID={testID} accessibilityRole="button" onPress={onRight} hitSlop={8}>
            <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 13 }} color="muted">
              {right}
            </Txt>
          </Pressable>
        ) : (
          <Txt v="t13" color="muted">
            {right}
          </Txt>
        )
      ) : null}
    </View>
  );
}

/** Small text link with an optional icon ("Members & rules", "Rules ›"). */
export function TextLink({ label, icon, chev, onPress, testID, muted }: { label: string; icon?: IconName; chev?: boolean; onPress: () => void; testID?: string; muted?: boolean }) {
  const c = useColors();
  const col = muted ? c.muted : c.ink;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {icon ? <Icon name={icon} size={16} strokeWidth={2} color={col} /> : null}
      <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 13, color: col }}>{label}</Txt>
      {chev ? <Icon name="chev" size={16} strokeWidth={2} color={col} /> : null}
    </Pressable>
  );
}

/** Splits a list into n columns of equal width, filling rows left to right (lists of cards and rows). */
export function Columns<T>({ items, cols = 2, gap = 16, rowGap, render, style }: { items: T[]; cols?: number; gap?: number; rowGap?: number; render: (item: T, i: number) => React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return (
    <View style={[{ gap: rowGap ?? gap }, style]}>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", gap }}>
          {r.map((it, j) => (
            <View key={j} style={{ flex: 1, minWidth: 0 }}>
              {render(it, i * cols + j)}
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

// ─────────────── 109 plan feed (right panel) ───────────────

type FeedItem = { t: "spend"; id: string; at: number; s: SpendRow } | { t: "join" | "add"; id: string; at: number; who: string; usd?: bigint; extra?: bigint };

const lc = (x?: string | null) => (x ?? "").toLowerCase();

/** The plan's recent activity (joins and money in), shared with the shell's live panel cache. */
function usePlanActivityRows(pot: string) {
  return useQuery({
    queryKey: ["planActivity", lc(pot)],
    queryFn: async () => ({ pot: lc(pot), rows: (await fetchPlanActivity(pot, 15)).Activity as ActivityRow[] }),
    staleTime: 15_000,
  });
}

function feedItems(plan: PlanVM, rows: ActivityRow[] | undefined): FeedItem[] {
  const spends: FeedItem[] = plan.raw.recent.map((s) => ({ t: "spend", id: `s${s.spendId}`, at: s.executedAt ?? s.proposedAt ?? 0, s }));
  const acts = (rows ?? []).filter((r) => (r.kind === "MemberJoined" || r.kind === "Contributed") && r.account_id);
  const joins = acts.filter((r) => r.kind === "MemberJoined");
  const used = new Set<string>();
  const out: FeedItem[] = [];
  for (const j of joins) {
    // "Asha joined · added $200.00": fold the first top-up made with the join into one row.
    const add = acts.find((r) => r.kind === "Contributed" && lc(r.account_id) === lc(j.account_id) && Math.abs(r.timestamp - j.timestamp) < 300 && !used.has(r.id));
    if (add) used.add(add.id);
    out.push({ t: "join", id: j.id, at: j.timestamp, who: lc(j.account_id), extra: add?.amount ? BigInt(add.amount) : undefined });
  }
  for (const r of acts) if (r.kind === "Contributed" && !used.has(r.id)) out.push({ t: "add", id: r.id, at: r.timestamp, who: lc(r.account_id), usd: BigInt(r.amount ?? "0") });
  return [...spends, ...out].sort((a, b) => b.at - a.at).slice(0, 20);
}

function ActivityItem({ plan, it, last }: { plan: PlanVM; it: Extract<FeedItem, { t: "join" | "add" }>; last?: boolean }) {
  const m = useMoney();
  const p = plan.people[it.who] ?? personFor(it.who, { me: plan.me });
  const name = p.me ? "You" : p.name;
  const creator = lc(plan.raw.creator_id) === it.who;
  let title: string;
  let sub: string;
  if (it.t === "join") {
    title = creator ? `${name} started the plan` : `${name} joined`;
    const place = [p.city, p.flag].filter(Boolean).join(" ");
    sub = [creator ? null : place || null, it.extra ? `added ${formatUsd(it.extra)}` : null].filter(Boolean).join(" · ") || plan.meta.name;
  } else {
    title = `${name} added ${formatUsd(it.usd ?? 0n)}`;
    sub = m.local(it.usd ?? 0n) ? `To the pot · ${m.local(it.usd ?? 0n)}` : "To the pot";
  }
  return (
    <ListItem
      testID={`feed-${it.t}-${it.id.slice(-6)}`}
      left={<PersonAvatar p={p} size={36} />}
      title={title}
      sub={sub}
      right={
        <Txt v="t13" color="muted">
          {ago(it.at)}
        </Txt>
      }
      align="flex-start"
      last={last}
    />
  );
}

/** Feed / Needs you / Photos tabs at the top of the plan's live panel. */
function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; testID: string }[] }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", backgroundColor: c.surface2, borderRadius: 999, padding: 4, marginTop: 12 }} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={o.testID}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{ flex: 1, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: on ? (c.dark ? c.bg : c.surface) : "transparent" }}
          >
            <Txt style={{ fontFamily: on ? fonts.bodySemi : fonts.bodyMedium, fontSize: 14, color: on ? c.ink : c.muted }}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * 109 right panel: "Live" with the plan's feed, what needs you, and photos. New rows appear
 * without motion and are outlined for 4 seconds. Rows open in the detail panel via `onOpen`.
 */
export function PlanFeed({ plan, onOpen, header = true, offline }: { plan: PlanVM; onOpen: (id: string) => void; header?: boolean; offline?: boolean }) {
  const [tab, setTab] = useState<"feed" | "needs" | "photos">("feed");
  const act = usePlanActivityRows(plan.pot);
  const items = useMemo(() => feedItems(plan, act.data?.rows), [plan, act.data]);
  const fresh = useFreshIds(items.map((i) => i.id));
  const needs = plan.raw.spends.filter((s) => needsMyOk(plan, s));
  const photos = plan.raw.recent.filter((s) => s.receiptHash && !/^0x0*$/.test(s.receiptHash));
  const live = !offline && !plan.settled;
  const list: FeedItem[] =
    tab === "needs"
      ? needs.map((s) => ({ t: "spend" as const, id: `s${s.spendId}`, at: s.proposedAt ?? 0, s }))
      : tab === "photos"
        ? photos.map((s) => ({ t: "spend" as const, id: `s${s.spendId}`, at: s.executedAt ?? s.proposedAt ?? 0, s }))
        : items;
  const empty =
    tab === "needs"
      ? "Nothing needs your OK in this plan."
      : tab === "photos"
        ? "Receipt photos people add show up here. Only the plan can see them."
        : plan.settled
          ? "No spends in this plan."
          : "No spends yet. Pay from the pot, or add money to chip in.";
  return (
    <View style={{ flex: 1 }} testID="plan-feed-panel">
      {header ? (
        <Row between>
          <Row gap={10}>
            {live ? <LiveDot /> : null}
            <Txt v="d22">Live</Txt>
          </Row>
          <TextLink label="All spends" muted onPress={() => router.push({ pathname: "/plan/[pot]/spends", params: { pot: plan.pot } })} testID="btn-all-spends" />
        </Row>
      ) : null}
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "feed", label: "Feed", testID: "tab-feed" },
          { value: "needs", label: needs.length ? `Needs you · ${needs.length}` : "Needs you", testID: "tab-needs" },
          { value: "photos", label: "Photos", testID: "tab-photos" },
        ]}
      />
      <View style={{ marginTop: 8 }} testID="feed">
        {act.isLoading && tab === "feed" && items.length === 0 ? (
          <Col gap={12} style={{ marginTop: 8 }}>
            <Skel w="100%" h={48} />
            <Skel w="100%" h={48} />
          </Col>
        ) : list.length === 0 ? (
          <Txt v="t13" color="muted" style={{ marginTop: 8 }} testID="feed-empty">
            {empty}
          </Txt>
        ) : (
          list.map((it, i) => (
            <Outlined key={it.id} on={fresh.has(it.id)}>
              {it.t === "spend" ? <SpendItem plan={plan} s={it.s} last={i === list.length - 1} onOpen={onOpen} /> : <ActivityItem plan={plan} it={it} last={i === list.length - 1} />}
            </Outlined>
          ))
        )}
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      <Txt v="t13" color="muted">
        New spends appear here as they happen. Nothing moves or animates; the newest row is outlined for 4 seconds.
      </Txt>
    </View>
  );
}

/** A spend opened from the feed, shown in the detail panel (109 → 29 content). */
export function SpendPanel({ plan, id }: { plan: PlanVM; id: string }) {
  const s = useSpendDetail(plan.pot, id, 15_000);
  if (s.isLoading)
    return (
      <Col gap={12} style={{ paddingRight: 40 }}>
        <Skel w="40%" h={12} />
        <Skel w="80%" h={26} />
        <Skel w="100%" h={180} r={14} />
        <Skel w="60%" h={34} />
        <Skel w="100%" h={64} r={14} />
      </Col>
    );
  if (!s.data)
    return (
      <View style={{ paddingRight: 40 }}>
        <Banner kind="mut" icon="wifioff" title="Couldn't load this spend" text={s.isError ? "Check your connection and try again." : "It may still be arriving."} testID="banner-load-error">
          <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void s.refetch()} style={{ marginTop: 8, height: 40 }} testID="btn-try-again" />
        </Banner>
      </View>
    );
  return <SpendDetailBody plan={plan} s={s.data} panel />;
}
