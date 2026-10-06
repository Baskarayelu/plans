/**
 * 16 Plan home: pot, your position, everyone's position in their own money, budgets and the live
 * feed. States: 19 live highlight, 34 paused, 58 offline, 60 loading, ended, settled, demo.
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { Address } from "viem";
import * as A from "../../../lib/chain/actions";
import { liveStatus, onLiveEvent } from "../../../lib/chain/live";
import { addr6, dayMonth, hhmm, isOffline, when } from "../../../lib/core/format";
import { formatUsd, formatUsdShort } from "../../../lib/domain/currency";
import { CATEGORIES } from "../../../lib/domain/rules";
import { identity } from "../../../lib/identity/session";
import { personFor, qk, queryClient, useMe, usePlan, type PlanCardVM, type PlanVM } from "../../../lib/state/data";
import { useStore } from "../../../lib/state/observable";
import { useAction } from "../../../lib/state/useAction";
import { useColors } from "../../../theme/ThemeProvider";
import { PlanSkeleton, activePeople, useTheirMoney } from "../../../ui/core/PlanCore";
import { SpendItem, isWaiting } from "../../../ui/core/SpendItem";
import { Icon, type IconName } from "../../../ui/Icon";
import { Banner, Bar, Btn, Btns, Card, ListItem, Row, SectionHead, Tile } from "../../../ui/kit";
import { AppBar, Screen, Sheet } from "../../../ui/layout";
import { PersonAvatar, PlanTop, useMoney } from "../../../ui/plan/common";
import { PositionChip } from "../../../ui/planBits";
import { showToast } from "../../../ui/Toast";
import { Txt } from "../../../ui/Text";

/** Unfreeze votes aren't indexed; remember this phone's own vote per freeze episode. */
const myResumeVotes = new Set<string>();

export default function PlanHome() {
  const { pot: potParam } = useLocalSearchParams<{ pot: string }>();
  const pot = potParam?.toLowerCase();
  const plan = usePlan(pot);
  const me = useMe();
  const live = useStore(liveStatus, (s) => s.state);
  const [slow, setSlow] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);

  useEffect(() => {
    if (plan.data !== undefined) return;
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [plan.data]);

  // 19: a spend for this plan arrives live → highlight it in the feed for ~4 s
  useEffect(() => {
    if (!pot) return;
    return onLiveEvent((e) => {
      if (e.address !== pot) return;
      if (e.name === "SpendExecuted" || e.name === "SpendProposed") setHighlight(String(e.args.id));
    });
  }, [pot]);
  const present = !!highlight && !!plan.data?.raw.recent.some((s) => s.spendId === highlight);
  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), present ? 4000 : 15000);
    return () => clearTimeout(t);
  }, [highlight, present]);

  const cached = useMemo(() => queryClient.getQueryData<PlanCardVM[]>(qk.myPlans(me.address))?.find((p) => p.pot.toLowerCase() === pot), [me.address, pot]);

  if (plan.data === undefined) {
    return (
      <Screen testID="plan-home" scroll={false} dock={<Btns><Btn label="Add money" kind="off" icon="plus" testID="btn-add-money" /><Btn label="Pay" kind="off" icon="out" testID="btn-pay" /></Btns>}>
        {plan.isError ? (
          <>
            <AppBar title={cached ? `${cached.meta.emoji} ${cached.meta.name}` : "Plan"} />
            <Banner kind="mut" icon="wifioff" title={isOffline(plan.error) ? "You're offline" : "Couldn't open this plan"} text="Check your connection and try again." testID="banner-plan-error">
              <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void plan.refetch()} style={{ marginTop: 8, height: 40 }} testID="btn-try-again" />
            </Banner>
          </>
        ) : (
          <PlanSkeleton title={cached ? `${cached.meta.emoji} ${cached.meta.name}` : undefined} color={cached?.meta.color} slow={slow} onRetry={() => void plan.refetch()} />
        )}
      </Screen>
    );
  }
  if (plan.data === null) {
    return (
      <Screen testID="plan-home">
        <AppBar title="Plan" />
        <Banner kind="mut" icon="search" title="We couldn't find this plan" text="It may still be on its way. Try again in a moment.">
          <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void plan.refetch()} style={{ marginTop: 8, height: 40 }} testID="btn-try-again" />
        </Banner>
      </Screen>
    );
  }
  return <PlanBody plan={plan.data} refetch={() => void plan.refetch()} refreshing={plan.isRefetching} offline={live === "offline" || (plan.isError && isOffline(plan.error))} refreshError={plan.isError && !isOffline(plan.error)} updatedAt={plan.dataUpdatedAt} highlight={present ? highlight : null} />;
}

function PlanBody({
  plan,
  refetch,
  refreshing,
  offline,
  refreshError,
  updatedAt,
  highlight,
}: {
  plan: PlanVM;
  refetch: () => void;
  refreshing: boolean;
  offline: boolean;
  refreshError: boolean;
  updatedAt: number;
  highlight: string | null;
}) {
  const c = useColors();
  const money = useMoney();
  const keysPending = useStore(identity, (s) => s.keysPending);
  const [menu, setMenu] = useState(false);
  const raw = plan.raw;
  const pot = plan.pot;
  const people = activePeople(plan);
  const their = useTheirMoney(people);
  const balance = BigInt(raw.balance);
  const contributors = raw.members.filter((m) => BigInt(m.contributed) > 0n).length;
  const totalIn = raw.totalContributed ? BigInt(raw.totalContributed) : raw.members.reduce((a, m) => a + BigInt(m.contributed), 0n);
  const my = plan.myMember;
  const open = plan.isMember && !plan.settled && !plan.ended;
  const notStarted = plan.now < Number(raw.startTime);
  const go = (pathname: string, params: Record<string, string> = {}) => router.push({ pathname, params: { pot, ...params } });

  // budgets: categories with a budget or spending, pending spends striped
  const pendingBy = new Map<number, bigint>();
  for (const s of raw.spends) if (isWaiting(s) && s.kind !== "PERSONAL") pendingBy.set(s.category, (pendingBy.get(s.category) ?? 0n) + BigInt(s.amount));
  const budgets = CATEGORIES.map((cat) => {
    const row = raw.categorySpends.find((r) => r.category === cat.id);
    const budget = BigInt(row?.budget ?? raw.categoryBudgets?.[cat.id] ?? "0");
    const spent = BigInt(row?.spent ?? "0") - BigInt(row?.refunded ?? "0");
    const pending = pendingBy.get(cat.id) ?? 0n;
    return { cat, budget, spent, pending };
  }).filter((b) => b.budget > 0n || b.spent > 0n);

  const pendingRule = raw.ruleChanges.find((r) => (r.status === "Proposed" && Number(r.expiresAt) > plan.now) || r.status === "Approved");
  const iVotedRule = !!pendingRule?.votes?.some((v) => v.account_id.toLowerCase() === plan.me);

  let dock: React.ReactNode = null;
  if (plan.settled) dock = <Btn label="See the summary" icon="sparkle" onPress={() => go("/plan/[pot]/memory")} testID="btn-see-summary" />;
  else if (plan.ended && plan.isMember) dock = <Btn label="Review & settle up" icon="check" onPress={() => go("/plan/[pot]/review")} testID="btn-review-and-settle" />;
  else if (plan.isMember)
    dock = (
      <Btns>
        <Btn label="Add money" kind={offline ? "off" : "sec"} icon="plus" onPress={() => go("/plan/[pot]/add")} testID="btn-add-money" />
        {offline ? (
          <Btn label="Needs a connection" kind="off" icon="wifioff" testID="btn-pay" />
        ) : plan.frozen ? (
          <Btn label="Paused" kind="off" icon="ban" testID="btn-pay" />
        ) : notStarted ? (
          <Btn label="Not open yet" kind="off" icon="clock" testID="btn-pay" />
        ) : (
          <Btn label="Pay" icon="out" onPress={() => go("/plan/[pot]/pay")} testID="btn-pay" />
        )}
      </Btns>
    );

  return (
    <Screen testID="plan-home" dock={dock} refreshing={refreshing} onRefresh={refetch}>
      <PlanTop plan={plan} onPeople={() => go("/plan/[pot]/members")} onMore={() => setMenu(true)} />

      {offline ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="mut" icon="wifioff" title="You're offline" text={`Showing what we had at ${hhmm(Math.floor(updatedAt / 1000))}. New spends will appear when you're back.`} testID="banner-offline">
            <Btn label="Try again" kind="sec" icon="refresh" sm onPress={refetch} style={{ marginTop: 8, height: 40 }} testID="btn-try-again" />
          </Banner>
        </View>
      ) : refreshError ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title="Couldn't refresh" text={`Showing what we had at ${hhmm(Math.floor(updatedAt / 1000))}.`}>
            <Btn label="Try again" kind="sec" icon="refresh" sm onPress={refetch} style={{ marginTop: 8, height: 40 }} testID="btn-try-again" />
          </Banner>
        </View>
      ) : null}

      {plan.locked || keysPending ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="inf" icon="lock" title="Unlock receipts on this phone" text="One more fingerprint opens the plan's name, notes and photos.">
            <Btn label="Unlock receipts" kind="sec" sm onPress={() => router.push("/unlock-keys")} style={{ marginTop: 8, height: 40 }} testID="btn-unlock-receipts" />
          </Banner>
        </View>
      ) : null}

      {plan.frozen && !plan.settled ? <PausedBanner plan={plan} offline={offline} /> : null}

      {plan.settled ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="pos" icon="check" title="Settled" text={raw.settledAt ? `Everyone was paid on ${dayMonth(raw.settledAt)}.` : "Everyone has been paid."} testID="banner-settled">
            <Btn label="See the summary" kind="sec" sm onPress={() => go("/plan/[pot]/memory")} style={{ marginTop: 8, height: 40 }} testID="btn-banner-summary" />
          </Banner>
        </View>
      ) : plan.ended ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="acc" icon="flag" title="This plan has ended" text="Check the numbers together, then settle up in one go." testID="banner-ended">
            <Btn label="Review" kind="sec" sm onPress={() => go("/plan/[pot]/review")} style={{ marginTop: 8, height: 40 }} testID="btn-banner-review" />
          </Banner>
        </View>
      ) : notStarted ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="inf" icon="cal" title={`Starts ${when(Number(raw.startTime))}`} text="Spending opens then. You can add money now." />
        </View>
      ) : null}

      {my && my.status === "Exited" ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="mut" icon="logout" title="You left this plan" text="You can still see what happened." />
        </View>
      ) : null}

      {pendingRule && plan.isMember && !plan.settled ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="inf" icon="vote" title={iVotedRule ? "A rule change is being voted on" : "A rule change needs your vote"} testID="banner-rule-change">
            <Btn
              label="See the change"
              kind="sec"
              sm
              onPress={() => go("/plan/[pot]/rules-change", { id: pendingRule.ruleChangeId })}
              style={{ marginTop: 8, height: 40 }}
              testID="btn-see-rule-change"
            />
          </Banner>
        </View>
      ) : null}

      <View style={{ opacity: offline ? 0.55 : 1 }}>
        <Card style={{ marginTop: 12 }} testID="pot-card">
          <Row between>
            <Txt v="ov" color="muted">
              In the pot
            </Txt>
            <Txt v="t13" color="muted">
              {contributors} put in {formatUsd(totalIn)}
            </Txt>
          </Row>
          <View style={{ marginTop: 4, flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <Txt v="d34" tnum testID="pot-balance">
              {formatUsd(balance)}
            </Txt>
            {money.local(balance) ? (
              <Txt v="t17" color="muted" weight="medium">
                {money.local(balance)}
              </Txt>
            ) : null}
          </View>
          <Row between style={{ marginTop: 12 }}>
            {my ? <PositionChip net={BigInt(my.net)} debt={BigInt(my.debt)} settled={plan.settled} /> : <View />}
            <Pressable testID="btn-why" accessibilityRole="button" accessibilityLabel="Why: see everyone's position" onPress={() => go("/plan/[pot]/members")} hitSlop={10} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              <Txt v="t13" weight="bold">
                Why
              </Txt>
              <Icon name="chev" size={16} strokeWidth={2.2} />
            </Pressable>
          </Row>
        </Card>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16, marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 4, flexGrow: 1, justifyContent: "space-between" }}>
          {people.map((p) => {
            const m = raw.members.find((x) => x.address.toLowerCase() === p.address);
            const net = BigInt(m?.net ?? "0");
            return (
              <Pressable
                key={p.address}
                testID={`member-${addr6(p.address)}`}
                accessibilityRole="button"
                accessibilityLabel={`${p.me ? "You" : p.name}: ${net === 0n ? "all square" : their(p, net, { sign: true })}`}
                onPress={() => go("/plan/[pot]/members")}
                style={{ width: 68, alignItems: "center" }}
              >
                <PersonAvatar p={p} size={44} ring={p.me} />
                <Txt v="t13" weight="bold" numberOfLines={1} style={{ marginTop: 8 }}>
                  {p.me ? "You" : p.name.split(" ")[0]}
                </Txt>
                <Txt v="t11" weight="bold" color={net > 0n ? "pos" : net < 0n ? "neg" : "muted"} numberOfLines={1}>
                  {net === 0n ? "All square" : their(p, net, { sign: true })}
                </Txt>
              </Pressable>
            );
          })}
          {open ? (
            <Pressable testID="btn-invite-member" accessibilityRole="button" accessibilityLabel="Invite friends" onPress={() => go("/plan/[pot]/invite")} style={{ width: 56, alignItems: "center" }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
                <Icon name="plus" size={20} />
              </View>
              <Txt v="t13" color="muted" style={{ marginTop: 8 }}>
                Invite
              </Txt>
            </Pressable>
          ) : null}
        </ScrollView>

        {budgets.length ? (
          <Card style={{ marginTop: 16 }} testID="budgets-card">
            <Row between>
              <Txt v="d17">Budgets</Txt>
              <Pressable testID="btn-budget-rules" accessibilityRole="button" onPress={() => go("/plan/[pot]/members")} hitSlop={10} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <Txt v="t13" color="muted">
                  Rules
                </Txt>
                <Icon name="chev" size={16} color={c.muted} />
              </Pressable>
            </Row>
            {budgets.map((b) => {
              const pct = b.budget > 0n ? Number((b.spent * 1000n) / b.budget) / 10 : 0;
              const pend = b.budget > 0n ? Number((b.pending * 1000n) / b.budget) / 10 : 0;
              return (
                <View key={b.cat.id} style={{ marginTop: 12 }} testID={`budget-${b.cat.id}`}>
                  <Row between>
                    <Txt v="t13" weight="bold">
                      {b.cat.emoji} {b.cat.name}
                    </Txt>
                    <Txt v="t13" color={b.budget > 0n && b.spent > b.budget ? "neg" : "muted"} tnum>
                      {b.budget > 0n ? `${formatUsdShort(b.spent)} of ${formatUsdShort(b.budget)}` : `${formatUsdShort(b.spent)} · no budget`}
                    </Txt>
                  </Row>
                  {b.budget > 0n ? (
                    <View style={{ marginTop: 4 }}>
                      <Bar pct={pct} color={plan.meta.color} over={b.spent > b.budget} pendingPct={pend} />
                    </View>
                  ) : null}
                  {b.pending > 0n ? (
                    <Txt v="t11" color="info" weight="bold" style={{ marginTop: 4 }}>
                      {formatUsdShort(b.pending)} waiting for an OK
                    </Txt>
                  ) : null}
                </View>
              );
            })}
          </Card>
        ) : null}

        <SectionHead title="Live" live={!offline && !plan.settled} right="All spends" onRight={() => go("/plan/[pot]/spends")} testID="btn-all-spends" />
        {raw.recent.length === 0 ? (
          <Card dashed style={{ marginTop: 4 }} testID="feed-empty">
            <Txt v="t15" color="muted">
              {plan.settled ? "No spends in this plan." : "No spends yet. Tap Pay to spend from the pot, or Add money to chip in."}
            </Txt>
          </Card>
        ) : (
          <View testID="feed">
            {raw.recent.slice(0, 8).map((s, i, arr) => (
              <SpendItem key={s.id} plan={plan} s={s} highlight={highlight === s.spendId} isNew={highlight === s.spendId} last={i === arr.length - 1} />
            ))}
          </View>
        )}
        <View style={{ height: 16 }} />
      </View>

      <Sheet visible={menu} onClose={() => setMenu(false)} testID="sheet-plan-menu">
        <PlanMenu plan={plan} close={() => setMenu(false)} />
      </Sheet>
    </Screen>
  );
}

function PausedBanner({ plan, offline }: { plan: PlanVM; offline: boolean }) {
  const raw = plan.raw;
  const f = raw.freezes.find((x) => !x.liftedAt) ?? raw.freezes[0];
  const by = f ? (plan.people[f.by_id.toLowerCase()] ?? personFor(f.by_id, { me: plan.me })) : undefined;
  const active = raw.activeMemberCount;
  const need = Math.floor(active / 2) + 1;
  const key = `${plan.pot}:${f?.timestamp ?? plan.frozenUntil}`;
  const [voted, setVoted] = useState(myResumeVotes.has(key));
  const [keep, setKeep] = useState(false);
  const vote = useAction(async () => {
    const r = await A.voteUnfreeze(plan.pot as Address);
    void queryClient.invalidateQueries({ queryKey: qk.plan(plan.pot) });
    return r;
  });
  const onVote = async () => {
    const r = await vote.run();
    if (!r) return;
    myResumeVotes.add(key);
    setVoted(true);
    const lifted = r.events?.some((e) => e.name === "Unfrozen");
    showToast({ title: lifted ? "Spending is back on" : "You voted to resume", sub: lifted ? plan.meta.name : `Needs ${need} of ${active} to agree`, emoji: lifted ? "▶️" : "🗳️" });
  };
  const who = by ? (by.me ? "You" : by.name) : "Someone";
  return (
    <View style={{ marginTop: 12 }}>
      <Banner
        kind="neg"
        icon="pause"
        title="Spending is paused"
        text={`${who} paused it ${f ? `at ${hhmm(f.timestamp)}` : ""}. It resumes by itself ${when(plan.frozenUntil)}, or sooner if ${need} of ${active} agree.`}
        testID="banner-paused"
      >
        {plan.isMember ? (
          voted ? (
            <Txt v="t13" weight="semi" style={{ marginTop: 8 }} testID="text-voted-resume">
              You voted to resume. Waiting for others.
            </Txt>
          ) : keep ? (
            <Txt v="t13" weight="semi" style={{ marginTop: 8 }}>
              Staying paused. You can still vote to resume later.
            </Txt>
          ) : (
            <>
              {vote.error ? (
                <Txt v="t13" color="neg" style={{ marginTop: 6 }}>
                  {vote.error.message}
                </Txt>
              ) : null}
              <Row gap={8} style={{ marginTop: 12 }}>
                <Btn label="Keep paused" kind="sec" sm flex onPress={() => setKeep(true)} testID="btn-keep-paused" />
                <Btn label="Vote to resume" sm flex disabled={offline} loading={vote.busy} onPress={() => void onVote()} testID="btn-vote-to-resume" />
              </Row>
            </>
          )
        ) : null}
      </Banner>
    </View>
  );
}

function PlanMenu({ plan, close }: { plan: PlanVM; close: () => void }) {
  const go = (pathname: string, params: Record<string, string> = {}) => {
    close();
    router.push({ pathname, params: { pot: plan.pot, ...params } });
  };
  const active = plan.isMember && !plan.settled;
  const items: { icon: IconName; title: string; sub?: string; on: () => void; id: string; kind?: "n" | "i" }[] = [];
  if (active && !plan.ended) items.push({ icon: "users", title: "Invite friends", on: () => go("/plan/[pot]/invite"), id: "menu-invite" });
  if (active && !plan.ended) items.push({ icon: "receipt", title: "I paid for something", sub: "Record it so the pot pays you back", on: () => go("/plan/[pot]/personal"), id: "menu-personal" });
  if (active && !plan.ended) items.push({ icon: "pause", title: plan.frozen ? "Spending is paused" : "Pause spending", sub: "An emergency brake anyone can pull", on: () => go("/plan/[pot]/pause"), id: "menu-pause" });
  if (active) items.push({ icon: "sliders", title: "Propose a rule change", on: () => go("/plan/customise"), id: "menu-rules" });
  items.push({ icon: "note", title: "All spends", on: () => go("/plan/[pot]/spends"), id: "menu-spends" });
  if (active) items.push({ icon: "flag", title: "End plan & check", sub: "Agree the numbers, then settle up", on: () => go("/plan/[pot]/review"), id: "menu-end" });
  if (active) items.push({ icon: "logout", title: "Leave plan", on: () => go("/plan/[pot]/leave"), id: "menu-leave", kind: "n" });
  return (
    <View>
      <Txt v="d22" style={{ marginBottom: 4 }}>
        {plan.meta.emoji} {plan.meta.name}
      </Txt>
      {items.map((it, i) => (
        <ListItem key={it.id} left={<Tile icon={it.icon} kind={it.kind} />} title={it.title} sub={it.sub} onPress={it.on} testID={it.id} last={i === items.length - 1} />
      ))}
    </View>
  );
}
