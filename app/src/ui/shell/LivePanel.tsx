/**
 * The default right panel on a laptop (design 108): what needs you above what's new, across all
 * plans. New rows appear without motion; the newest is outlined for 4 seconds.
 */
import { useQueries } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { fetchPlanActivity } from "../../lib/api/envio";
import { formatUsdShort } from "../../lib/domain/currency";
import { moneyRows, planRows, type MoneyRow, type PlanRow } from "../../lib/send/history";
import { useAccountActivity, useMe, useMyPlans } from "../../lib/state/data";
import { useColors } from "../../theme/ThemeProvider";
import { Btn, Card, EmojiTile, LiveDot, Row, Skel } from "../kit";
import { MoneyRowItem, PlanRowItem, usePlanIndex } from "../send/rows";
import { Txt } from "../Text";

type Item = { t: "m"; r: MoneyRow } | { t: "p"; r: PlanRow };

/** Ids that appeared after the panel first loaded stay "new" for 4 s. */
export function useFreshIds(ids: string[], ms = 4000): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (ids.length === 0) return;
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((i) => !seen.current!.has(i));
    if (added.length === 0) return;
    added.forEach((i) => seen.current!.add(i));
    setFresh((f) => new Set([...f, ...added]));
    const t = setTimeout(() => setFresh((f) => new Set([...f].filter((x) => !added.includes(x)))), ms);
    return () => clearTimeout(t);
  }, [ids.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return fresh;
}

export function Outlined({ on, children }: { on: boolean; children: React.ReactNode }) {
  const c = useColors();
  return <View style={{ borderRadius: 12, borderWidth: 2, borderColor: on ? c.ink : "transparent", marginHorizontal: -8, paddingHorizontal: 6 }}>{children}</View>;
}

export function LivePanel() {
  const { address } = useMe();
  const me = address?.toLowerCase();
  const plans = useMyPlans();
  const act = useAccountActivity();
  const planIndex = usePlanIndex();
  const watched = useMemo(() => (plans.data ?? []).filter((p) => p.myStatus === "Active").slice(0, 8), [plans.data]);
  const feeds = useQueries({
    queries: watched.map((p) => ({
      queryKey: ["planActivity", p.pot.toLowerCase()],
      queryFn: async () => ({ pot: p.pot.toLowerCase(), rows: (await fetchPlanActivity(p.pot, 15)).Activity }),
      staleTime: 15_000,
    })),
  });
  const items: Item[] = useMemo(() => {
    const m = moneyRows(act.data, me).map((r) => ({ t: "m" as const, r }));
    const p = planRows(feeds.flatMap((f) => (f.data ? f.data.rows.map((r) => ({ ...r, pot_id: f.data!.pot })) : [])), me).map((r) => ({ t: "p" as const, r }));
    return [...m, ...p].sort((a, b) => b.r.at - a.r.at).slice(0, 12);
  }, [act.data, feeds, me]);
  const fresh = useFreshIds(items.map((i) => i.r.id));
  const needs = (plans.data ?? []).filter((p) => p.needsMe > 0 || p.myDebt > 0n);

  return (
    <View testID="panel-live">
      <Txt v="d22">Needs you</Txt>
      {needs.length === 0 ? (
        <Txt v="t13" color="muted" style={{ marginTop: 6 }}>
          Nothing right now. Approvals, votes and anything you owe show up here.
        </Txt>
      ) : (
        needs.map((p) => (
          <Card key={p.pot} style={{ marginTop: 10 }} testID={`panel-need-${p.pot.slice(2, 8)}`}>
            <Row>
              <EmojiTile emoji={p.meta.emoji} color={p.meta.color} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt v="lt" numberOfLines={2}>
                  {p.myDebt > 0n ? `You owe ${formatUsdShort(p.myDebt)}` : p.needsMe === 1 ? "1 spend needs your OK" : `${p.needsMe} spends need your OK`}
                </Txt>
                <Txt v="t13" color="muted" numberOfLines={1}>
                  {p.meta.name}
                </Txt>
              </View>
            </Row>
            <Btn
              label={p.myDebt > 0n ? "Pay now" : "Review"}
              sm
              style={{ marginTop: 10 }}
              onPress={() =>
                p.myDebt > 0n ? router.push({ pathname: "/plan/[pot]/debt", params: { pot: p.pot } }) : router.push({ pathname: "/activity", params: { f: "needs" } })
              }
              testID={`panel-btn-${p.pot.slice(2, 8)}`}
            />
          </Card>
        ))
      )}
      <Row gap={8} style={{ marginTop: 24, marginBottom: 4 }}>
        <LiveDot />
        <Txt v="d17">Live across your plans</Txt>
      </Row>
      {act.isLoading || plans.isLoading ? (
        <View style={{ gap: 10, marginTop: 8 }}>
          <Skel w="100%" h={48} />
          <Skel w="100%" h={48} />
        </View>
      ) : items.length === 0 ? (
        <Txt v="t13" color="muted" style={{ marginTop: 6 }}>
          Spends, money in and settle-ups show up here as they happen.
        </Txt>
      ) : (
        items.map((i, k) => (
          <Outlined key={i.r.id} on={fresh.has(i.r.id)}>
            {i.t === "m" ? <MoneyRowItem r={i.r} me={me} plans={planIndex} last={k === items.length - 1} /> : <PlanRowItem r={i.r} me={me} plans={planIndex} last={k === items.length - 1} />}
          </Outlined>
        ))
      )}
    </View>
  );
}
