/** Building blocks shared by the spending screens (20–32). Colours only from useColors(). */
import type { UseQueryResult } from "@tanstack/react-query";
import { NO_MOTION } from "../motion";
import React, { useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatLocal, formatUsd } from "../../lib/domain/currency";
import { contactFor } from "../../lib/domain/groups";
import { categoryOf } from "../../lib/domain/rules";
import type { PhotoState } from "../../lib/spend/hooks";
import { fmtWhen } from "../../lib/spend/logic";
import { personFor, useFxMap, type Person, type PlanVM } from "../../lib/state/data";
import { useColors } from "../../theme/ThemeProvider";
import { fonts, mix, withAlpha } from "../../theme/tokens";
import { Icon } from "../Icon";
import { Avatar, Banner, Btn, Card, Col, IconBtn, Row, Skel } from "../kit";
import { AppBar, Screen } from "../layout";
import { PersonAvatar, useMoney } from "../plan/common";
import { useReceiptRates } from "../fx/rates";
import { normCurrency } from "../../lib/fx/receiptRate";
import { Txt } from "../Text";

const lc = (s: string) => s.toLowerCase();

// ─────────────── loading / error gate ───────────────

export function LoadingScreen({ title, testID }: { title?: string; testID?: string }) {
  return (
    <Screen testID={testID}>
      <AppBar title={title} />
      <Col gap={12} style={{ marginTop: 8 }}>
        <Skel w="60%" h={28} />
        <Skel w="40%" h={18} />
        <Skel w="100%" h={120} r={14} />
        <Skel w="100%" h={64} r={14} />
        <Skel w="100%" h={64} r={14} />
      </Col>
    </Screen>
  );
}

export function ErrorScreen({ title, message, onRetry, testID }: { title?: string; message?: string; onRetry?: () => void; testID?: string }) {
  return (
    <Screen testID={testID}>
      <AppBar title={title} />
      <View style={{ marginTop: 8, gap: 12 }}>
        <Banner kind="neg" icon="wifioff" title="Couldn't load this" text={message ?? "Check your connection and try again."} testID="banner-load-error" />
        {onRetry ? <Btn label="Try again" kind="sec" icon="refresh" sm onPress={onRetry} testID="btn-try-again" /> : null}
      </View>
    </Screen>
  );
}

/** Renders loading (Skel), error (Banner + Try again) or missing states for a plan query. */
export function PlanGate({ q, title, testID, children }: { q: UseQueryResult<PlanVM | null>; title?: string; testID?: string; children: (plan: PlanVM) => React.ReactElement }) {
  if (q.isLoading) return <LoadingScreen title={title} testID={testID} />;
  if (q.isError && !q.data) return <ErrorScreen title={title} onRetry={() => void q.refetch()} testID={testID} />;
  if (!q.data)
    return (
      <Screen testID={testID}>
        <AppBar title={title} />
        <Banner kind="mut" icon="info" title="This plan isn't here" text="It may still be starting up. Try again in a moment." />
        <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void q.refetch()} style={{ marginTop: 12 }} />
      </Screen>
    );
  return children(q.data);
}

// ─────────────── money ───────────────

/** Formats an amount in a given person's own currency (undefined for dollars or until rates load). */
export function usePeopleMoney(plan?: PlanVM | null) {
  const currencies = Object.values(plan?.people ?? {}).map((p) => p.currency);
  const fx = useFxMap(currencies);
  return (units: bigint, p?: Person) => (p && p.currency !== "USD" ? formatLocal(units, p.currency, fx[p.currency]) : undefined);
}

/**
 * The viewer's money on a plan receipt: dollars ↔ their currency at the reference round in effect
 * when the money moved (`atSec`), else Plans' quote, else none. `lines` go on the receipt; `local`
 * gives amounts at that same rate (undefined for dollar viewers or when there's no rate).
 */
export function useSpendRate(atSec?: number) {
  const m = useMoney();
  const rr = useReceiptRates({ currencies: [m.currency], atSec });
  return {
    lines: rr.lines([m.currency]),
    rates: [rr.rates[normCurrency(m.currency)]].filter(Boolean),
    local: (u: bigint, o: { sign?: boolean } = {}) => (m.currency === "USD" ? undefined : rr.local(u, m.currency, o)),
    loading: rr.loading,
  };
}

// ─────────────── people / payees ───────────────

export function personOf(plan: PlanVM, address: string): Person {
  return plan.people[lc(address)] ?? personFor(address, { me: plan.me });
}

/** Who a spend paid: a member, a remembered business, a pay link, or the proposer themself. */
export function payeeName(plan: PlanVM, kind: string, payee: string, proposer?: string): string {
  if (kind === "LINK") return "Pay link";
  if (kind === "PERSONAL") {
    if (!proposer) return "Paid themselves";
    const p = personOf(plan, proposer);
    return p.me ? "You (paid yourself)" : `${p.name} (paid themselves)`;
  }
  const m = plan.people[lc(payee)];
  if (m) return m.me ? "You" : m.name;
  return contactFor(payee)?.name ?? "A business";
}

export function spendTitle(plan: PlanVM, s: { kind: string; payee: string; proposer_id: string; category: number }, note: string | null): string {
  if (note) return note;
  if (s.kind === "PAY") return payeeName(plan, s.kind, s.payee);
  if (s.kind === "LINK") return "Pay link";
  return categoryOf(s.category).name;
}

// ─────────────── cards ───────────────

export function QuoteCard({ text, testID }: { text: string; testID?: string }) {
  return (
    <Card tint testID={testID}>
      <Txt v="t15">“{text}”</Txt>
    </Card>
  );
}

/** Spend summary used on 30 and 31 (avatar · title · who/when/split · amount). */
export function SpendSummaryCard({ plan, spend, note, onPress }: { plan: PlanVM; spend: { proposer_id: string; amount: string; executedAt?: number | null; proposedAt?: number; splitMembers?: string[]; kind: string; payee: string; category: number }; note: string | null; onPress?: () => void }) {
  const m = useMoney();
  const who = personOf(plan, spend.proposer_id);
  const at = spend.executedAt ?? spend.proposedAt;
  const amount = BigInt(spend.amount);
  const n = spend.splitMembers?.length ?? 0;
  return (
    <Card onPress={onPress} testID="spend-summary" a11y="Spend">
      <Row>
        <PersonAvatar p={who} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="lt" numberOfLines={1}>
            {spendTitle(plan, { ...spend }, note)}
          </Txt>
          <Txt v="t13" color="muted" numberOfLines={1}>
            {[who.me ? "You" : who.name, at ? fmtWhen(at).replace(" · ", ", ") : null, n ? `split ${n}` : null].filter(Boolean).join(" · ")}
          </Txt>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Txt v="lt" tnum>
            {formatUsd(amount)}
          </Txt>
          {m.local(amount) ? (
            <Txt v="t13" color="muted">
              {m.local(amount)}
            </Txt>
          ) : null}
        </View>
      </Row>
    </Card>
  );
}

// ─────────────── receipt photo ───────────────

export function LockChip({ text = "Only the plan can see this" }: { text?: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 28, borderRadius: 999, backgroundColor: withAlpha(c.surface, 0.92), alignSelf: "flex-start" }}>
      <Icon name="lock" size={14} strokeWidth={2.2} />
      <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 12 }}>{text}</Txt>
    </View>
  );
}

/** Large receipt photo (29). Blurred placeholder while it opens; plain states otherwise. */
export function ReceiptPhotoView({ state, ownerName, height = 220 }: { state: PhotoState; ownerName?: string; height?: number }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  if (state.status === "none")
    return (
      <Card tint testID="receipt-none">
        <Row gap={10}>
          <Icon name="receipt" size={20} color={c.muted} />
          <Txt v="t15" color="muted">
            No receipt added
          </Txt>
        </Row>
      </Card>
    );
  const msg =
    state.status === "locked"
      ? "Unlock receipts on this phone to see the photo."
      : state.status === "missing"
        ? `The photo hasn't reached this phone yet${ownerName ? `. It's safe on ${ownerName}'s phone` : ""}.`
        : null;
  return (
    <>
      <Pressable
        testID="receipt-photo"
        accessibilityRole="imagebutton"
        accessibilityLabel="Receipt photo"
        disabled={state.status !== "ready"}
        onPress={() => setOpen(true)}
        style={{ height, borderRadius: 14, overflow: "hidden", backgroundColor: c.surface2, justifyContent: "flex-end" }}
      >
        {state.status === "ready" && state.dataUri ? (
          <Image source={{ uri: state.dataUri }} resizeMode="cover" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
        ) : (
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 8, padding: 24, backgroundColor: mix(c.ink, 0.06, c.surface2) }}>
            {state.status === "loading" ? <ActivityIndicator color={c.muted} /> : <Icon name="image" size={28} color={c.muted} />}
            {msg ? (
              <Txt v="t13" color="muted" center>
                {msg}
              </Txt>
            ) : null}
          </View>
        )}
        <View style={{ padding: 10 }}>
          <LockChip />
        </View>
      </Pressable>
      {state.dataUri ? <PhotoViewer uri={state.dataUri} visible={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Thumbnail row for 27: photo + title, opens full screen. */
export function ReceiptThumbRow({ state, title }: { state: PhotoState; title: string }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  if (state.status === "none") return null;
  return (
    <>
      <Pressable testID="receipt-thumb" accessibilityRole="button" onPress={() => setOpen(true)} disabled={state.status !== "ready"} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingVertical: 8 }}>
        <View style={{ width: 48, height: 48, borderRadius: 10, overflow: "hidden", backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
          {state.status === "ready" && state.dataUri ? <Image source={{ uri: state.dataUri }} style={{ width: 48, height: 48 }} /> : state.status === "loading" ? <ActivityIndicator color={c.muted} /> : <Icon name="image" size={20} color={c.muted} />}
        </View>
        <View style={{ flex: 1 }}>
          <Txt v="lt">{title}</Txt>
          <Txt v="t13" color="muted">
            {state.status === "locked" ? "Unlock receipts to see it" : state.status === "missing" ? "Not on this phone yet" : "Photo · only the plan can see it"}
          </Txt>
        </View>
        {state.status === "ready" ? <Icon name="chev" size={20} /> : null}
      </Pressable>
      {state.dataUri ? <PhotoViewer uri={state.dataUri} visible={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function PhotoViewer({ uri, visible, onClose }: { uri: string; visible: boolean; onClose: () => void }) {
  const ins = useSafeAreaInsets();
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType={NO_MOTION ? "none" : "fade"} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000" }} testID="photo-viewer">
        <Image source={{ uri }} resizeMode="contain" style={{ flex: 1 }} />
        <View style={{ position: "absolute", top: ins.top + 8, left: 8 }}>
          <IconBtn name="x" label="Close" onPress={onClose} color="#FFFFFF" testID="btn-close-photo" />
        </View>
      </View>
    </Modal>
  );
}

// ─────────────── timeline, votes, chat ───────────────

export type TimelineItem = { title: string; sub?: string; state: "done" | "now" | "next" };

export function Timeline({ items }: { items: TimelineItem[] }) {
  const c = useColors();
  return (
    <View testID="timeline" style={{ paddingLeft: 4 }}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        const dot = it.state === "now" ? c.pos : it.state === "done" ? c.ink : "transparent";
        return (
          <View key={i} style={{ flexDirection: "row", gap: 14 }}>
            <View style={{ alignItems: "center", width: 16 }}>
              <View style={{ width: 14, height: 14, borderRadius: 7, marginTop: 4, backgroundColor: dot, borderWidth: 2, borderColor: it.state === "next" ? c.muted : dot }} />
              {!last ? <View style={{ flex: 1, width: 2, backgroundColor: c.line, marginVertical: 2 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : 16 }}>
              <Txt v="lt" color={it.state === "next" ? "muted" : "ink"}>
                {it.title}
              </Txt>
              {it.sub ? <Txt style={{ fontFamily: fonts.mono, fontSize: 12, color: c.muted }}>{it.sub}</Txt> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Segmented tally: y = for, n = against, w = waiting. */
export function VoteBar({ segs, testID }: { segs: ("y" | "n" | "w")[]; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", gap: 4, width: Math.max(60, segs.length * 22) }}>
      {segs.map((s, i) => (
        <View key={i} style={{ flex: 1, height: 8, borderRadius: 999, backgroundColor: s === "y" ? c.pos : s === "n" ? c.neg : c.surface2 }} />
      ))}
    </View>
  );
}

export function Bubble({ person, text, me, sub }: { person: Person; text: string; me?: boolean; sub?: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: me ? "row-reverse" : "row", alignItems: "flex-end", gap: 8 }}>
      <Avatar initial={person.initial} color={person.color} size={28} />
      <View style={{ maxWidth: 260, gap: 2, alignItems: me ? "flex-end" : "flex-start" }}>
        <View style={{ backgroundColor: me ? mix(c.accent, 0.22, c.surface) : c.surface2, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 16 }}>
          <Txt v="t15">{text}</Txt>
        </View>
        {sub ? (
          <Txt v="t11" color="muted">
            {sub}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

/** Two-column detail line used in cards ("Category … 🍽️ Food & drink"). */
export function KV({ k, v, testID }: { k: string; v: React.ReactNode; testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <Txt v="t13" color="muted">
        {k}
      </Txt>
      {typeof v === "string" ? (
        <Txt v="t13" weight="bold" style={{ flexShrink: 1, textAlign: "right" }}>
          {v}
        </Txt>
      ) : (
        v
      )}
    </View>
  );
}

export function MonoLine({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <Txt style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 22, color: c.muted }}>{children}</Txt>;
}
