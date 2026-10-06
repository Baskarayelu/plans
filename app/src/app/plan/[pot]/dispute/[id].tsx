/**
 * 31 Dispute vote and 32 Dispute resolved. Eligible voters are active members other than the
 * spender and the person who asked; voting runs 48 h; a strict majority of votes cast for
 * "covers it" moves the cost to the spender, anything else keeps it. The spender can settle it
 * straight away by covering it or changing the split.
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import type { Address } from "viem";
import * as A from "../../../../lib/chain/actions";
import { settledMs, type RelayResult } from "../../../../lib/api/relayer";
import type { DisputeRow } from "../../../../lib/api/envio";
import { DisputeOutcome } from "../../../../lib/chain/eip712";
import { fromHex } from "../../../../lib/crypto/bytes";
import { decodeMemo } from "../../../../lib/crypto/seal";
import { formatUsd } from "../../../../lib/domain/currency";
import { startDraft, useDraft } from "../../../../lib/spend/draft";
import { activeMembers, memoText, refreshSpend, useSpendDetail, type SpendDetail } from "../../../../lib/spend/hooks";
import { canFinalize, DISPUTE_PERIOD, disputeReasonLabel, disputeTally, durationText, eachAmount, eligibleVoters, fmtWhen, joinNames, likelyOutcome, orderedSplit, shareChanges } from "../../../../lib/spend/logic";
import { usePlan, type PlanVM } from "../../../../lib/state/data";
import { putReceipt, useAction } from "../../../../lib/state/useAction";
import { useColors } from "../../../../theme/ThemeProvider";
import { Banner, Bar, BigIcon, Btn, Btns, Card, Chip, ListItem, Proof, Radio, Row, SettledIn } from "../../../../ui/kit";
import { AppBar, Screen } from "../../../../ui/layout";
import { People, PersonAvatar, useMoney } from "../../../../ui/plan/common";
import { Bubble, ErrorScreen, LoadingScreen, personOf, PlanGate, SpendSummaryCard, usePeopleMoney, VoteBar } from "../../../../ui/spend/parts";
import { Txt } from "../../../../ui/Text";
import { showToast } from "../../../../ui/Toast";

const lc = (s: string) => s.toLowerCase();

export default function DisputeScreen() {
  const { pot, id } = useLocalSearchParams<{ pot: string; id: string }>();
  const q = usePlan(pot);
  return (
    <PlanGate q={q} title="Vote" testID="screen-dispute">
      {(plan) => <Loader plan={plan} id={id} refetchPlan={() => void q.refetch()} />}
    </PlanGate>
  );
}

function Loader({ plan, id, refetchPlan }: { plan: PlanVM; id: string; refetchPlan: () => void }) {
  const row = plan.raw.disputes.find((d) => String(d.disputeId) === String(id));
  const spendId = row ? row.spend_id.split("-").pop() : undefined;
  const s = useSpendDetail(plan.pot, spendId, 10_000);
  if (!row)
    return <ErrorScreen title="Vote" message="We couldn't find this question yet. It may still be arriving." onRetry={refetchPlan} testID="screen-dispute" />;
  if (s.isLoading) return <LoadingScreen title="Vote" testID="screen-dispute" />;
  if (s.isError || !s.data) return <ErrorScreen title="Vote" onRetry={() => void s.refetch()} testID="screen-dispute" />;
  const full = s.data.disputes?.find((d) => String(d.disputeId) === String(id));
  return <Body plan={plan} s={s.data} d={{ ...row, ...(full ?? {}) }} />;
}

function Body({ plan, s, d }: { plan: PlanVM; s: SpendDetail; d: DisputeRow }) {
  const draft = useDraft();
  const [pick, setPick] = useState<"keep" | "covers" | null>(null);
  const [lastTx, setLastTx] = useState<{ hash: string; ms: number } | null>(null);
  const now = Math.floor(Date.now() / 1000);
  const amount = BigInt(s.amount);
  const proposer = personOf(plan, s.proposer_id);
  const opener = personOf(plan, d.openedBy_id);
  const pName = proposer.me ? "you" : proposer.name;
  const PName = proposer.me ? "You" : proposer.name;
  const spendNote = memoText(plan, s.memo);
  const thing = spendNote ? `“${spendNote}”` : "this spend";
  const qMemo = (() => {
    if (!d.memo || d.memo === "0x") return null;
    try {
      return decodeMemo(plan.gk ?? undefined, plan.pot, "dispute", fromHex(d.memo));
    } catch {
      return null;
    }
  })();
  const active = activeMembers(plan);
  const eligible = eligibleVoters(active, s.proposer_id, d.openedBy_id);
  const votes = d.votes ?? [];
  const tally = disputeTally(eligible, votes);
  const deadline = d.openedAt + DISPUTE_PERIOD;
  const open = d.status !== "Resolved" && (!d.outcome || d.outcome === "None");
  const myVote = plan.me ? tally.voted.get(plan.me) : undefined;
  const canVote = open && !!plan.me && eligible.includes(plan.me) && myVote === undefined && now < deadline;
  const iAmSpender = proposer.me && plan.isMember;
  const finalizable = open && canFinalize(d.openedAt, now, eligible.length, tally.allVoted);
  const home = () => router.dismissTo({ pathname: "/plan/[pot]", params: { pot: plan.pot } });

  const done = (r: RelayResult, title: string) => {
    setLastTx({ hash: r.txHash, ms: settledMs(r) });
    putReceipt({ kind: "spend", txHash: r.txHash, settledMs: settledMs(r), at: now, pot: plan.pot, disputeId: d.disputeId });
    refreshSpend(plan.pot, s.spendId);
    showToast({ title, emoji: plan.meta.emoji });
  };
  const vote = useAction((covers: boolean) => A.voteDispute(plan.pot as Address, BigInt(d.disputeId), covers));
  const finalize = useAction(() => A.finalizeDispute(plan.pot as Address, BigInt(d.disputeId)));
  const cover = useAction(() => A.resolveDispute(plan.pot as Address, BigInt(d.disputeId), DisputeOutcome.SpenderCovers, { members: [], weights: [] }));
  const resplit = useAction((members: string[], weights: number[]) => A.resolveDispute(plan.pot as Address, BigInt(d.disputeId), DisputeOutcome.Resplit, { members: members as Address[], weights }));
  const err = vote.error ?? finalize.error ?? cover.error ?? resplit.error;

  // "Change the split" uses the split editor through the shared draft.
  const resplitKey = `resplit:${plan.pot}:${d.disputeId}`;
  const currentMembers = (s.shares?.length ? s.shares.map((x) => lc(x.account_id)) : (s.splitMembers ?? []).map(lc)).filter((a) => active.includes(a));
  const newSplit =
    draft.key === resplitKey && draft.splitDoneAt
      ? draft.splitMode === "everyone"
        ? orderedSplit(active, active)
        : orderedSplit(active, draft.chosen, draft.weights, draft.splitMode === "custom")
      : null;
  const openSplitEditor = () => {
    startDraft(resplitKey, plan.pot, { units: amount, amountText: "", splitMode: "pick", chosen: currentMembers, label: spendNote ?? "Change the split" });
    router.push({ pathname: "/plan/[pot]/split", params: { pot: plan.pot } });
  };

  if (!open) return <Resolved plan={plan} s={s} d={d} eligible={eligible} lastTx={lastTx} onDone={home} />;

  const waitingNames = tally.waiting.map((a) => personOf(plan, a)).map((p) => (p.me ? "You" : p.name));
  const segs: ("y" | "n" | "w")[] = [...Array(tally.cover).fill("y"), ...Array(tally.keep).fill("n"), ...Array(tally.waiting.length).fill("w")];

  let dock: React.ReactNode = null;
  if (canVote)
    dock = (
      <Btn
        label="Confirm vote"
        icon="check"
        disabled={!pick}
        loading={vote.busy}
        onPress={async () => {
          const r = await vote.run(pick === "covers");
          if (r) done(r, "You voted");
        }}
        testID="btn-confirm-vote"
      />
    );
  else if (finalizable)
    dock = (
      <Btn
        label="Close the vote"
        icon="check"
        loading={finalize.busy}
        onPress={async () => {
          const r = await finalize.run();
          if (r) done(r, "Vote closed");
        }}
        testID="btn-close-the-vote"
      />
    );

  return (
    <Screen testID="screen-dispute" dock={dock}>
      <AppBar icon="x" title="Vote" sub={plan.meta.name} />
      <Chip sm tone="inf" icon="clock" label={now < deadline ? `${durationText(deadline - now)} left` : "Voting closed"} testID="chip-time-left" />
      <Txt v="d28" style={{ marginTop: 12 }} testID="dispute-title">
        Should {pName} cover {thing}?
      </Txt>
      <View style={{ marginTop: 12 }}>
        <SpendSummaryCard plan={plan} spend={s} note={spendNote} onPress={() => router.push({ pathname: "/plan/[pot]/spend/[id]", params: { pot: plan.pot, id: s.spendId } })} />
      </View>
      <View style={{ marginTop: 16, gap: 12 }}>
        <Bubble person={opener} me={opener.me} text={qMemo?.text || qMemo?.reason || disputeReasonLabel(d.reason)} sub={`${opener.me ? "You" : opener.name} · ${qMemo?.reason ?? disputeReasonLabel(d.reason)}`} />
      </View>

      {canVote ? (
        <View style={{ marginTop: 20, gap: 12 }}>
          <VoteOption on={pick === "keep"} onPress={() => setPick("keep")} title="Keep it on the plan" sub={`Everyone shares ${formatUsd(amount)} as now`} testID="option-keep" />
          <VoteOption on={pick === "covers"} onPress={() => setPick("covers")} title={`${PName} ${proposer.me ? "cover" : "covers"} it`} sub={`${formatUsd(amount)} moves to ${proposer.me ? "your" : `${proposer.name}'s`} share at settle-up`} testID="option-covers" />
        </View>
      ) : myVote !== undefined ? (
        <View style={{ marginTop: 20 }}>
          <Banner kind="pos" icon="check" title="You voted" text={myVote ? `${PName} ${proposer.me ? "cover" : "covers"} it.` : "Keep it on the plan."} testID="banner-you-voted" />
        </View>
      ) : opener.me ? (
        <View style={{ marginTop: 20 }}>
          <Banner kind="mut" icon="info" title="You asked the group" text={`The others vote. ${proposer.me ? "" : `${proposer.name} can also settle it now.`}`} testID="banner-you-asked" />
        </View>
      ) : null}

      <View style={{ marginTop: 16, gap: 8 }} testID="dispute-tally">
        {eligible.length ? (
          <Row between>
            <VoteBar segs={segs} />
            <Txt v="t13" color="muted" style={{ flexShrink: 1, textAlign: "right" }}>
              {`${tally.cover} cover · ${tally.keep} keep`}
              {waitingNames.length ? ` · ${joinNames(waitingNames)} ${waitingNames.length === 1 && waitingNames[0] !== "You" ? "hasn't" : "haven't"} voted` : ""}
            </Txt>
          </Row>
        ) : (
          <Txt v="t13" color="muted">
            No one else can vote on this. It stays on the plan unless {pName} {proposer.me ? "cover" : "covers"} it.
          </Txt>
        )}
        {votes.length ? (
          <Txt v="t13" color="muted">
            {likelyOutcome(tally.cover, tally.keep) === "SpenderCovers" ? `So far: ${pName} ${proposer.me ? "cover" : "covers"} it.` : "So far: it stays on the plan."}
          </Txt>
        ) : null}
      </View>

      {iAmSpender ? (
        <Card tint style={{ marginTop: 16, gap: 10 }} testID="card-spender">
          <Txt v="lt">It's your spend</Txt>
          <Txt v="t13" color="muted">
            You can settle it now: cover it yourself, or change who shares it. Either ends the vote.
          </Txt>
          {newSplit ? (
            <View style={{ gap: 8 }}>
              <Row gap={8} wrap>
                <People people={newSplit.members.map((a) => personOf(plan, a))} size={24} />
                <Txt v="t13" style={{ flexShrink: 1 }}>
                  {newSplit.members.map((a) => personOf(plan, a).name).join(", ")} ·{" "}
                  {eachAmount(amount, newSplit.weights) !== null ? `${formatUsd(eachAmount(amount, newSplit.weights)!)} each` : "custom shares"}
                </Txt>
              </Row>
              <Btns>
                <Btn label="Edit" kind="sec" sm onPress={openSplitEditor} testID="btn-edit-split" />
                <Btn
                  label="Use this split"
                  sm
                  loading={resplit.busy}
                  disabled={newSplit.members.length === 0}
                  onPress={async () => {
                    const r = await resplit.run(newSplit.members, newSplit.weights);
                    if (r) done(r, "Split changed");
                  }}
                  testID="btn-use-this-split"
                />
              </Btns>
            </View>
          ) : (
            <Btns>
              <Btn label="Change the split" kind="sec" sm onPress={openSplitEditor} testID="btn-change-the-split" />
              <Btn
                label="I'll cover it"
                sm
                loading={cover.busy}
                onPress={async () => {
                  const r = await cover.run();
                  if (r) done(r, "You covered it");
                }}
                testID="btn-ill-cover-it"
              />
            </Btns>
          )}
        </Card>
      ) : null}

      {canVote && finalizable ? (
        <Btn label="Close the vote" kind="txt" loading={finalize.busy} onPress={async () => { const r = await finalize.run(); if (r) done(r, "Vote closed"); }} testID="btn-close-the-vote" style={{ marginTop: 8 }} />
      ) : null}
      {err ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title={err.title} text={err.message} testID="banner-action-error" />
        </View>
      ) : null}
      {!plan.gk && d.memo && d.memo !== "0x" ? (
        <Txt v="t13" color="muted" style={{ marginTop: 12 }}>
          Unlock receipts on this phone to read the note.
        </Txt>
      ) : null}
      <View style={{ height: 8 }} />
    </Screen>
  );
}

function VoteOption({ on, onPress, title, sub, testID }: { on: boolean; onPress: () => void; title: string; sub: string; testID: string }) {
  const c = useColors();
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={title} onPress={onPress}>
      <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 16, borderWidth: on ? 2 : 1, borderColor: on ? c.ink : c.line }}>
        <Row>
          <Radio on={on} />
          <View style={{ flex: 1 }}>
            <Txt v="lt">{title}</Txt>
            <Txt v="t13" color="muted">
              {sub}
            </Txt>
          </View>
        </Row>
      </View>
    </Pressable>
  );
}

function Resolved({ plan, s, d, eligible, lastTx, onDone }: { plan: PlanVM; s: SpendDetail; d: DisputeRow; eligible: string[]; lastTx: { hash: string; ms: number } | null; onDone: () => void }) {
  const c = useColors();
  const m = useMoney();
  const theirs = usePeopleMoney(plan);
  const amount = BigInt(s.amount);
  const proposer = personOf(plan, s.proposer_id);
  const PName = proposer.me ? "You" : proposer.name;
  const spendNote = memoText(plan, s.memo);
  const votes = d.votes ?? [];
  const coverVoters = votes.filter((v) => v.spenderCovers).map((v) => personOf(plan, v.account_id));
  const keepVoters = votes.filter((v) => !v.spenderCovers).map((v) => personOf(plan, v.account_id));
  const total = Math.max(1, coverVoters.length + keepVoters.length);
  const byVote = likelyOutcome(coverVoters.length, keepVoters.length) === "SpenderCovers";
  const outcome = d.outcome ?? "Keep";
  const title =
    outcome === "SpenderCovers"
      ? `${PName} ${proposer.me ? "cover" : "covers"} ${spendNote ?? "it"}`
      : outcome === "Resplit"
        ? `${PName} changed the split`
        : "The group kept it on the plan";
  const sub =
    outcome === "SpenderCovers"
      ? `${byVote ? `${coverVoters.length} of ${coverVoters.length + keepVoters.length} voted for it.` : `${PName} chose to cover it.`} Nothing is charged now. It evens out at settle-up.`
      : outcome === "Resplit"
        ? "Who shares it changed. Nothing is charged now. It evens out at settle-up."
        : "Nothing changes.";
  const changes = shareChanges(d.previousMembers ?? [], d.previousShares ?? [], d.resolvedMembers ?? [], d.resolvedShares ?? []);
  const voteRow = (label: string, people: typeof coverVoters, color: string, testID: string) => (
    <View testID={testID} style={{ gap: 6 }}>
      <Row between>
        <Txt v="lt">{label}</Txt>
        <Row gap={8}>
          {people.length ? <People people={people} size={24} /> : null}
          <Txt v="lt">{people.length}</Txt>
        </Row>
      </Row>
      <Bar pct={(people.length * 100) / total} color={color} />
    </View>
  );
  return (
    <Screen testID="screen-dispute-resolved" dock={<Btn label="Done" onPress={onDone} testID="btn-done" />}>
      <AppBar icon="x" onBack={onDone} />
      <View style={{ alignItems: "center" }}>
        <BigIcon icon="scale" kind="i" />
        <Txt v="d28" center style={{ marginTop: 16 }} testID="dispute-outcome">
          {title}
        </Txt>
        <Txt v="t15" color="muted" center style={{ marginTop: 8, marginHorizontal: 12, marginBottom: 20 }}>
          {sub}
        </Txt>
      </View>
      {votes.length || eligible.length ? (
        <Card style={{ gap: 10 }}>
          {voteRow(`${PName} ${proposer.me ? "cover" : "covers"} it`, coverVoters, c.pos, "votes-cover")}
          {voteRow("Keep it on the plan", keepVoters, c.muted, "votes-keep")}
        </Card>
      ) : null}
      {changes.length ? (
        <Card style={{ marginTop: 12 }} p={16}>
          {changes.map((x, i) => {
            const p = personOf(plan, x.address);
            const local = p.me ? m.local(x.diff < 0n ? -x.diff : x.diff) : theirs(x.diff < 0n ? -x.diff : x.diff, p);
            return (
              <ListItem
                key={x.address}
                testID={`change-row-${i}`}
                left={<PersonAvatar p={p} size={36} />}
                title={p.me ? "Your share" : `${p.name}'s share`}
                sub={x.after === amount ? `Pays the full ${formatUsd(amount)}` : x.after === 0n ? `Was ${formatUsd(x.before)}, now nothing` : `Was ${formatUsd(x.before)}, now ${formatUsd(x.after)}`}
                right={<Txt v="lt" color={x.diff > 0n ? "neg" : "pos"}>{formatUsd(x.diff, { sign: true })}</Txt>}
                rsub={local}
                last={i === changes.length - 1}
              />
            );
          })}
        </Card>
      ) : null}
      <Row between style={{ marginTop: 12 }}>
        <Txt v="t13" color="muted">
          {d.resolvedAt ? `Closed ${fmtWhen(d.resolvedAt)}` : "Closed"}
        </Txt>
        <Row gap={12}>
          {lastTx ? <SettledIn ms={lastTx.ms} /> : null}
          <Proof hash={lastTx?.hash} />
        </Row>
      </Row>
    </Screen>
  );
}
