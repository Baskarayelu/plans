import { useQueries } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import type { Address } from "viem";
import { fetchPlanActivity, fetchPlanDetail, type PlanDetail, type SpendRow } from "../../lib/api/envio";
import { claimRefund, vote } from "../../lib/chain/actions";
import { fromHex } from "../../lib/crypto/bytes";
import { decodeMemo } from "../../lib/crypto/seal";
import { formatUsdShort } from "../../lib/domain/currency";
import { groupKeyFor } from "../../lib/domain/groups";
import { CATEGORIES } from "../../lib/domain/rules";
import { isToday } from "../../lib/send/convert";
import { moneyRows, planRows, type MoneyRow, type PlanRow } from "../../lib/send/history";
import { personFor, queryClient, qk, useAccountActivity, useMe, useMyPlans, type PlanCardVM } from "../../lib/state/data";
import { useAction } from "../../lib/state/useAction";
import { Avatar, Banner, Btn, Btns, Card, Chip, EmojiTile, Overline, Row, Skel } from "../../ui/kit";
import { Screen } from "../../ui/layout";
import { useLocal } from "../../ui/money";
import { MoneyRowItem, PlanRowItem, usePlanIndex } from "../../ui/send/rows";
import { Txt } from "../../ui/Text";

type Filter = "all" | "needs" | "money" | "plans";
const MAX_PLANS = 8;
const lc = (s?: string | null) => (s ?? "").toLowerCase();

type Need =
  | { kind: "spend"; id: string; plan: PlanCardVM; spend: SpendRow; detail: PlanDetail }
  | { kind: "rules"; id: string; plan: PlanCardVM; ruleId: string; proposer?: string; expiresAt: number }
  | { kind: "debt"; id: string; plan: PlanCardVM };

function timeLeft(sec: number): string {
  const d = sec - Date.now() / 1000;
  if (d <= 0) return "ending now";
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))} min left`;
  if (d < 86400 * 2) return `${Math.floor(d / 3600)} h left`;
  return `${Math.floor(d / 86400)} days left`;
}

function spendWhat(spend: SpendRow, detail: PlanDetail, me?: string): string {
  const gk = groupKeyFor(detail.id, { me, keyWraps: detail.keyWraps, inviteKeyWrap: detail.inviteKeyWrap });
  try {
    if (spend.memo && spend.memo !== "0x") {
      const m = decodeMemo(gk ?? undefined, detail.id, "memo", fromHex(spend.memo));
      if (m?.text) return m.text;
    }
  } catch {
    /* locked note */
  }
  return CATEGORIES.find((c) => c.id === spend.category)?.name.toLowerCase() ?? "a spend";
}

function SpendCard({ n, me, onVote, voting }: { n: Extract<Need, { kind: "spend" }>; me?: string; onVote: (n: Extract<Need, { kind: "spend" }>, approve: boolean) => void; voting: string | null }) {
  const local = useLocal();
  const who = personFor(n.spend.proposer_id, { me });
  const amount = BigInt(n.spend.amount);
  const okBy = (n.spend.votes ?? []).filter((v) => v.approve && lc(v.account_id) !== lc(n.spend.proposer_id)).map((v) => personFor(v.account_id, { me }).name);
  const progress = okBy.length ? `${okBy.join(", ")} said OK` : `${n.spend.approvals} of ${n.spend.approvalsRequired} OKs`;
  const loc = local.fmt(amount);
  return (
    <Card style={{ marginTop: 8 }} testID={`need-spend-${n.spend.spendId}`}>
      <Row align="flex-start">
        <Avatar initial={who.initial} color={who.color} size={40} />
        <View style={{ flex: 1 }}>
          <Txt v="lt">
            {who.name} wants {formatUsdShort(amount)} for {spendWhat(n.spend, n.detail, me)}
          </Txt>
          <Txt v="t13" color="muted">
            {[n.plan.meta.name, loc, progress, timeLeft(Number(n.spend.expiresAt))].filter(Boolean).join(" · ")}
          </Txt>
        </View>
      </Row>
      <Btns style={{ marginTop: 12 }}>
        <Btn label="Reject" kind="out" sm flex loading={voting === `${n.id}:0`} disabled={!!voting} onPress={() => onVote(n, false)} testID={`btn-reject-${n.spend.spendId}`} />
        <Btn label="Approve" sm flex loading={voting === `${n.id}:1`} disabled={!!voting} onPress={() => onVote(n, true)} testID={`btn-approve-${n.spend.spendId}`} />
      </Btns>
      <Btn label="Review" kind="txt" sm onPress={() => router.push({ pathname: "/plan/[pot]/approve/[id]", params: { pot: n.plan.pot, id: n.spend.spendId } })} testID={`btn-review-${n.spend.spendId}`} style={{ alignSelf: "center" }} />
    </Card>
  );
}

/** 52 Activity: what needs you on top, then everything that happened. */
export default function Activity() {
  const params = useLocalSearchParams<{ f?: string }>();
  const { address } = useMe();
  const me = address?.toLowerCase();
  const [filter, setFilter] = useState<Filter>(params.f === "money" || params.f === "plans" || params.f === "needs" ? params.f : "all");
  useEffect(() => {
    if (params.f === "money" || params.f === "plans" || params.f === "needs" || params.f === "all") setFilter(params.f);
  }, [params.f]);
  const plans = useMyPlans();
  const planIndex = usePlanIndex();
  const act = useAccountActivity();
  const watched = useMemo(() => (plans.data ?? []).filter((p) => p.myStatus === "Active").slice(0, MAX_PLANS), [plans.data]);
  const details = useQueries({
    queries: watched
      .filter((p) => p.status === "Active")
      .map((p) => ({ queryKey: ["activityPlanDetail", p.pot.toLowerCase()], queryFn: () => fetchPlanDetail(p.pot), staleTime: 15_000, refetchInterval: 30_000 })),
  });
  const feeds = useQueries({
    queries: watched.map((p) => ({ queryKey: ["planActivity", p.pot.toLowerCase()], queryFn: async () => ({ pot: p.pot.toLowerCase(), rows: (await fetchPlanActivity(p.pot, 15)).Activity }), staleTime: 15_000 })),
  });
  const [voting, setVoting] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<string | null>(null);
  const voteA = useAction(vote);
  const refundA = useAction(claimRefund, { fatal: true, context: "You were getting link money back." });

  const needs = useMemo<Need[]>(() => {
    const out: Need[] = [];
    const byPot = new Map(watched.map((p) => [p.pot.toLowerCase(), p]));
    for (const q of details) {
      const d = q.data;
      if (!d) continue;
      const plan = byPot.get(lc(d.id));
      if (!plan) continue;
      for (const s of d.spends) {
        if (s.status && s.status !== "Pending") continue;
        if (lc(s.proposer_id) === me) continue;
        if ((s.votes ?? []).some((v) => lc(v.account_id) === me)) continue;
        if (Number(s.expiresAt) && Number(s.expiresAt) < Date.now() / 1000) continue;
        out.push({ kind: "spend", id: `s:${d.id}:${s.spendId}`, plan, spend: s, detail: d });
      }
      for (const r of d.ruleChanges ?? []) {
        if (r.status !== "Proposed") continue;
        if (lc(r.proposer_id) === me) continue;
        if ((r.votes ?? []).some((v) => lc(v.account_id) === me)) continue;
        if (Number(r.expiresAt) && Number(r.expiresAt) < Date.now() / 1000) continue;
        out.push({ kind: "rules", id: `r:${d.id}:${r.ruleChangeId}`, plan, ruleId: r.ruleChangeId, proposer: r.proposer_id, expiresAt: Number(r.expiresAt) });
      }
    }
    for (const p of plans.data ?? []) if (p.myDebt > 0n) out.push({ kind: "debt", id: `d:${p.pot}`, plan: p });
    return out;
  }, [details, watched, plans.data, me]);

  const money = useMemo(() => moneyRows(act.data, me), [act.data, me]);
  const planEvents = useMemo(() => {
    const rows = feeds.flatMap((f) => (f.data ? f.data.rows.map((r) => ({ ...r, pot_id: f.data!.pot })) : []));
    return planRows(rows, me);
  }, [feeds, me]);

  type Item = { t: "m"; r: MoneyRow } | { t: "p"; r: PlanRow };
  const items: Item[] = useMemo(() => {
    const m: Item[] = filter === "plans" ? [] : money.map((r) => ({ t: "m" as const, r }));
    const p: Item[] = filter === "money" ? [] : planEvents.map((r) => ({ t: "p" as const, r }));
    return [...m, ...p].sort((a, b) => b.r.at - a.r.at).slice(0, 80);
  }, [money, planEvents, filter]);

  const onVote = async (n: Extract<Need, { kind: "spend" }>, approve: boolean) => {
    setVoting(`${n.id}:${approve ? 1 : 0}`);
    const r = await voteA.run(n.plan.pot as Address, BigInt(n.spend.spendId), approve);
    setVoting(null);
    if (r) {
      void queryClient.invalidateQueries({ queryKey: ["activityPlanDetail", n.plan.pot.toLowerCase()] });
      void queryClient.invalidateQueries({ queryKey: qk.plan(n.plan.pot) });
      void queryClient.invalidateQueries({ queryKey: qk.myPlans(me) });
    }
  };

  const onRefund = async (r: MoneyRow) => {
    if (!r.claim) return;
    setRefunding(r.id);
    const res = await refundA.run(BigInt(r.claim.claimId));
    setRefunding(null);
    if (res) {
      void queryClient.invalidateQueries({ queryKey: qk.activity(me) });
      void queryClient.invalidateQueries({ queryKey: qk.balance(me) });
    }
  };

  const refresh = () =>
    void Promise.all([plans.refetch(), act.refetch(), ...details.map((d) => d.refetch()), ...feeds.map((f) => f.refetch())]);

  const loading = act.isLoading || plans.isLoading;
  const failed = act.isError && plans.isError;
  const showNeeds = filter === "all" || filter === "needs";
  const today = items.filter((i) => isToday(i.r.at));
  const earlier = items.filter((i) => !isToday(i.r.at));
  const nothing = !loading && !failed && (filter === "needs" ? needs.length === 0 : items.length === 0 && (filter !== "all" || needs.length === 0));

  const renderItem = (i: Item, last: boolean) =>
    i.t === "m" ? (
      <MoneyRowItem key={i.r.id} r={i.r} me={me} plans={planIndex} onRefund={(r) => void onRefund(r)} refunding={refunding === i.r.id} last={last} />
    ) : (
      <PlanRowItem key={i.r.id} r={i.r} me={me} plans={planIndex} last={last} />
    );

  return (
    <Screen testID="screen-activity" bottomInset={false} refreshing={act.isRefetching || plans.isRefetching} onRefresh={refresh}>
      <Row between style={{ minHeight: 72 }}>
        <Txt v="d28">Activity</Txt>
      </Row>
      <Row gap={8} wrap>
        <Chip label="All" on={filter === "all"} onPress={() => setFilter("all")} testID="chip-all" />
        <Chip label={needs.length ? `Needs you · ${needs.length}` : "Needs you"} on={filter === "needs"} onPress={() => setFilter("needs")} testID="chip-needs-you" />
        <Chip label="Money" on={filter === "money"} onPress={() => setFilter("money")} testID="chip-money" />
        <Chip label="Plans" on={filter === "plans"} onPress={() => setFilter("plans")} testID="chip-plans" />
      </Row>

      {voteA.error ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title={voteA.error.title} text={voteA.error.message} />
        </View>
      ) : null}

      {showNeeds && needs.length > 0 ? (
        <View testID="needs-you">
          <Overline style={{ marginTop: 20 }}>Needs you</Overline>
          {needs.map((n) =>
            n.kind === "spend" ? (
              <SpendCard key={n.id} n={n} me={me} onVote={(x, a) => void onVote(x, a)} voting={voting} />
            ) : n.kind === "rules" ? (
              <Card key={n.id} style={{ marginTop: 8 }} testID={`need-rules-${n.ruleId}`}>
                <Row>
                  {n.proposer ? <Avatar initial={personFor(n.proposer, { me }).initial} color={personFor(n.proposer, { me }).color} size={40} /> : <EmojiTile emoji={n.plan.meta.emoji} color={n.plan.meta.color} size={40} />}
                  <View style={{ flex: 1 }}>
                    <Txt v="lt">{n.proposer ? `${personFor(n.proposer, { me }).name} suggests a rule change` : "A rule change needs your vote"}</Txt>
                    <Txt v="t13" color="muted">
                      {n.plan.meta.name}
                      {n.expiresAt ? ` · ${timeLeft(n.expiresAt)}` : ""}
                    </Txt>
                  </View>
                  <Btn label="Vote" kind="sec" sm onPress={() => router.push({ pathname: "/plan/[pot]/rules-change", params: { pot: n.plan.pot, id: n.ruleId } })} testID={`btn-vote-rules-${n.ruleId}`} />
                </Row>
              </Card>
            ) : (
              <Card key={n.id} style={{ marginTop: 8 }} testID={`need-debt-${n.plan.pot.slice(2, 8)}`}>
                <Row>
                  <EmojiTile emoji={n.plan.meta.emoji} color={n.plan.meta.color} size={40} />
                  <View style={{ flex: 1 }}>
                    <Txt v="lt">You owe {formatUsdShort(n.plan.myDebt)}</Txt>
                    <Txt v="t13" color="muted">
                      {n.plan.meta.name} is settled · pay to finish
                    </Txt>
                  </View>
                  <Btn label="Pay now" sm onPress={() => router.push({ pathname: "/plan/[pot]/debt", params: { pot: n.plan.pot } })} testID={`btn-pay-debt-${n.plan.pot.slice(2, 8)}`} />
                </Row>
              </Card>
            ),
          )}
        </View>
      ) : null}

      {loading ? (
        <View style={{ gap: 12, marginTop: 20 }}>
          <Skel w="25%" h={14} />
          <Skel w="100%" h={56} />
          <Skel w="100%" h={56} />
          <Skel w="100%" h={56} />
        </View>
      ) : failed ? (
        <View style={{ marginTop: 20 }}>
          <Banner kind="mut" icon="wifioff" title="Couldn't load your activity" text="Check your connection.">
            <Btn label="Try again" kind="sec" icon="refresh" sm onPress={refresh} style={{ marginTop: 8 }} testID="btn-activity-retry" />
          </Banner>
        </View>
      ) : nothing ? (
        <View style={{ marginTop: 48, alignItems: "center", paddingHorizontal: 24 }} testID="activity-empty">
          <Txt v="d22" center>
            {filter === "needs" ? "Nothing needs you" : "All quiet"}
          </Txt>
          <Txt v="t15" color="muted" center style={{ marginTop: 6 }}>
            {filter === "needs"
              ? "Approvals, votes and anything you owe show up here."
              : filter === "money"
                ? "Money you send, get and claim shows up here."
                : filter === "plans"
                  ? "Spends, money in and settle-ups from your plans show up here."
                  : "Spends, money in and settle-ups show up here."}
          </Txt>
        </View>
      ) : filter !== "needs" ? (
        <>
          {today.length > 0 ? (
            <>
              <Overline style={{ marginTop: 20 }}>Today</Overline>
              {today.map((i, k) => renderItem(i, k === today.length - 1))}
            </>
          ) : null}
          {earlier.length > 0 ? (
            <>
              <Overline style={{ marginTop: 16 }}>Earlier</Overline>
              {earlier.map((i, k) => renderItem(i, k === earlier.length - 1))}
            </>
          ) : null}
        </>
      ) : null}
      <View style={{ height: 24 }} />
    </Screen>
  );
}
