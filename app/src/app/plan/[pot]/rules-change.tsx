/** 35 Change the rules: a proposal's before → after, the vote, and when it applies. */
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef } from "react";
import { View } from "react-native";
import type { Address } from "viem";
import { applyRules, voteRules } from "../../../lib/chain/actions";
import { majority, ruleChangePhase, ruleChangeTitle, ruleDiff, rulesFromRow, timeLeft } from "../../../lib/ending/ruleDiff";
import { queryClient, qk, usePlan, type PlanVM } from "../../../lib/state/data";
import { useAction } from "../../../lib/state/useAction";
import { useColors } from "../../../theme/ThemeProvider";
import { dayMonth, NoticeScreen, personOf, PlanProblem, PlanSkeleton, timeOfDay, useNow } from "../../../ui/ending/common";
import { Icon } from "../../../ui/Icon";
import { Banner, Btn, Btns, Card, Overline, Row } from "../../../ui/kit";
import { AppBar, Screen } from "../../../ui/layout";
import { dateRange, ago } from "../../../ui/planBits";
import { PersonAvatar, PersonName } from "../../../ui/plan/common";
import { Txt } from "../../../ui/Text";
import { showToast } from "../../../ui/Toast";

type RC = PlanVM["raw"]["ruleChanges"][number];

function VoteBar({ yes, total }: { yes: number; total: number }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 4 }} testID="vote-bar">
      {Array.from({ length: Math.max(total, 1) }, (_, i) => (
        <View key={i} style={{ width: 22, height: 8, borderRadius: 4, backgroundColor: i < yes ? c.pos : c.surface2 }} />
      ))}
    </View>
  );
}

function findChange(plan: PlanVM, id?: string): RC | undefined {
  const rcs = plan.raw.ruleChanges;
  if (id) {
    const k = id.toLowerCase();
    return rcs.find((r) => r.ruleChangeId === id || r.id.toLowerCase() === k || r.id.toLowerCase().endsWith(`-r${k}`));
  }
  return rcs.find((r) => r.status !== "Applied" && (r.status === "Approved" || Number(r.expiresAt) > plan.now)) ?? rcs[0];
}

export default function RuleChangeScreen() {
  const { pot, id } = useLocalSearchParams<{ pot: string; id?: string }>();
  const q = usePlan(pot);
  const c = useColors();
  const nowMs = useNow(1000);
  const now = Math.floor(nowMs / 1000);
  const autoApplied = useRef(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.plan(pot) });
  const vote = useAction(async (rcId: string, approve: boolean) => {
    const r = await voteRules(pot as Address, BigInt(rcId), approve);
    await refresh();
    return r;
  });
  const apply = useAction(async (rcId: string) => {
    const r = await applyRules(pot as Address, BigInt(rcId));
    await refresh();
    return r;
  });

  const plan = q.data ?? undefined;
  const rc = plan ? findChange(plan, id) : undefined;
  const phase = rc ? ruleChangePhase(rc, now) : undefined;

  // Anyone may apply once the wait is over: do it once for the group if this screen is open.
  useEffect(() => {
    if (!rc || phase !== "ready" || autoApplied.current || plan?.settled || !plan?.isMember) return;
    autoApplied.current = true;
    void apply.run(rc.ruleChangeId).then((r) => {
      if (r) showToast({ title: "The new rules are in force", sub: plan.meta.name, emoji: "✅" });
    });
  }, [rc, phase, plan, apply]);

  if (q.isLoading) return <PlanSkeleton title="Rule change" />;
  if (q.isError || !plan) return <PlanProblem title="Rule change" missing={!q.isError} onRetry={() => void q.refetch()} />;
  const sub = `${plan.meta.name}, ${dateRange(Number(plan.raw.startTime), Number(plan.raw.endTime))}`;
  if (!rc || !phase) return <NoticeScreen title="Rule change" heading="No rule change is open" text="When someone suggests new rules, the vote shows up here." testID="screen-rules-change" />;

  const current = rulesFromRow(plan.raw, plan.raw);
  const proposed = rulesFromRow(rc, plan.raw);
  const rows = ruleDiff(current, proposed);
  const proposer = personOf(plan, rc.proposer_id);
  const active = plan.raw.members.filter((m) => m.status === "Active");
  const need = Math.min(majority(active.length), Math.max(active.length, 1));
  const votes = rc.votes ?? [];
  const myVote = votes.find((v) => v.account_id.toLowerCase() === plan.me);
  const iAmProposer = !!plan.me && rc.proposer_id?.toLowerCase() === plan.me;
  const canVote = phase === "voting" && plan.isMember && !iAmProposer && !myVote && !plan.settled;

  const voterRows = active
    .map((m) => m.address.toLowerCase())
    .sort((a, b) => (a === rc.proposer_id?.toLowerCase() ? -1 : b === rc.proposer_id?.toLowerCase() ? 1 : a === plan.me ? 1 : b === plan.me ? -1 : 0))
    .map((a) => {
      const v = votes.find((x) => x.account_id.toLowerCase() === a);
      const state: "y" | "n" | "w" = a === rc.proposer_id?.toLowerCase() || v?.approve ? "y" : v ? "n" : "w";
      return { a, state };
    });

  const when = rc.proposedAt ? `${ago(rc.proposedAt) === "now" ? "Just now" : `${ago(rc.proposedAt)} ago`}` : "";
  const status =
    phase === "voting"
      ? `closes in ${timeLeft(Number(rc.expiresAt), now)}`
      : phase === "closed"
        ? "closed"
        : phase === "waiting"
          ? "agreed"
          : phase === "ready"
            ? "agreed"
            : "applied";

  let dock: React.ReactNode = null;
  if (canVote)
    dock = (
      <Btns>
        <Btn label="Disagree" kind="sec" loading={vote.busy} onPress={() => void vote.run(rc.ruleChangeId, false)} testID="btn-disagree" />
        <Btn label="Agree" icon="fp" loading={vote.busy} onPress={() => void vote.run(rc.ruleChangeId, true)} testID="btn-agree" />
      </Btns>
    );
  else if (phase === "ready" && !plan.settled)
    dock = <Btn label="Apply now" icon="check" loading={apply.busy} onPress={() => void apply.run(rc.ruleChangeId)} testID="btn-apply-now" />;
  else dock = <Btn label="Done" kind="sec" onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: "/plan/[pot]", params: { pot: plan.pot } }))} testID="btn-done" />;

  return (
    <Screen dock={dock} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} testID="screen-rules-change">
      <AppBar title="Rule change" sub={sub} icon="x" />
      {proposer ? (
        <Row>
          <PersonAvatar p={proposer} size={40} />
          <View style={{ flex: 1 }}>
            <Row gap={0} wrap>
              {proposer.me ? (
                <Txt v="lt">You suggest a change</Txt>
              ) : (
                <>
                  <PersonName p={proposer} you={false} />
                  <Txt v="lt"> suggests a change</Txt>
                </>
              )}
            </Row>
            <Txt v="t13" color="muted">
              {[when, status].filter(Boolean).join(" · ")}
            </Txt>
          </View>
        </Row>
      ) : null}
      <Txt v="d28" style={{ marginTop: 16 }} testID="rule-change-title">
        {ruleChangeTitle(rows)}
      </Txt>
      <Card style={{ marginTop: 12, paddingVertical: 4 }} testID="rule-diff">
        {rows.length === 0 ? (
          <Txt v="t15" color="muted" style={{ paddingVertical: 12 }}>
            This proposal keeps every rule as it is.
          </Txt>
        ) : (
          rows.map((r, i) => (
            <View key={r.key} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 56, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: c.line }} testID={`diff-${r.key}`}>
              <Txt v="lt" style={{ flex: 1 }}>
                {r.label}
              </Txt>
              <Txt v="t15" color="muted" style={{ textDecorationLine: "line-through" }}>
                {r.before}
              </Txt>
              <Icon name="chev" size={16} color={c.muted} />
              <Txt v="d17" color="pos">
                {r.after}
              </Txt>
            </View>
          ))
        )}
      </Card>
      <Txt v="t13" color="muted" style={{ marginTop: 8, marginHorizontal: 2 }}>
        Nothing else changes. Spends already waiting for an OK keep the rules they started with.
      </Txt>

      {phase === "waiting" && rc.eta ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="inf" icon="clock" title={`Applies at ${timeOfDay(Number(rc.eta))}${dayMonth(Number(rc.eta)) !== dayMonth(now) ? ` on ${dayMonth(Number(rc.eta))}` : ""}`} text={`The group agreed. It starts in ${timeLeft(Number(rc.eta), now)}.`} testID="rules-waiting" />
        </View>
      ) : null}
      {phase === "ready" ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="inf" icon="clock" title="Ready to apply" text={apply.busy ? "Applying the new rules…" : "The wait is over. Anyone in the plan can switch the new rules on."} testID="rules-ready" />
        </View>
      ) : null}
      {phase === "applied" ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="pos" icon="check" title="The new rules are in force" testID="rules-applied" />
        </View>
      ) : null}
      {phase === "closed" ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="mut" icon="info" title="Closed. Nothing changed." text="Not enough people agreed in time." testID="rules-closed" />
        </View>
      ) : null}
      {vote.error ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title={vote.error.title} text={vote.error.message} />
        </View>
      ) : null}
      {apply.error && phase === "ready" ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title={apply.error.title} text={apply.error.message} />
        </View>
      ) : null}

      <Row between style={{ marginTop: 20 }}>
        <Overline>{`Votes · needs ${need} of ${active.length}`}</Overline>
        <VoteBar yes={Math.min(rc.approvals, active.length)} total={active.length} />
      </Row>
      <View style={{ marginTop: 8 }}>
        {voterRows.map(({ a, state }) => {
          const p = personOf(plan, a);
          if (!p) return null;
          return (
            <Row key={a} between style={{ minHeight: 44 }}>
              <Row gap={10}>
                <PersonAvatar p={p} size={28} flag={false} />
                <PersonName p={p} />
              </Row>
              {state === "y" ? (
                <Row gap={4}>
                  <Icon name="check" size={16} strokeWidth={2.4} color={c.pos} />
                  <Txt v="t15" color="pos" weight="bold">
                    Agreed
                  </Txt>
                </Row>
              ) : state === "n" ? (
                <Txt v="t15" color="neg" weight="semi">
                  Disagreed
                </Txt>
              ) : (
                <Txt v="t15" color="muted">
                  Not yet
                </Txt>
              )}
            </Row>
          );
        })}
      </View>
      {iAmProposer && phase === "voting" ? (
        <Txt v="t13" color="muted" style={{ marginTop: 8 }}>
          Your vote counts automatically because you suggested it.
        </Txt>
      ) : null}
    </Screen>
  );
}
