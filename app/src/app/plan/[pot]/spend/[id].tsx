/**
 * 29 Spend detail: the receipt photo (opened with the group key), the note, who shares it (each
 * in their own money), rule and rate, Proof, and "Question this spend" while questions are open.
 */
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Share, View } from "react-native";
import { explorerTxUrl } from "../../../../config";
import { formatUsd } from "../../../../lib/domain/currency";
import { categoryOf } from "../../../../lib/domain/rules";
import { memoText, useReceiptPhoto, useSpendDetail, type SpendDetail } from "../../../../lib/spend/hooks";
import { fmtDay, fmtWhen, oks, ruleLine, sharesFor } from "../../../../lib/spend/logic";
import { planRules } from "../../../../lib/spend/hooks";
import { useStore } from "../../../../lib/state/observable";
import { usePlan, type PlanVM } from "../../../../lib/state/data";
import { receipts } from "../../../../lib/state/useAction";
import { useColors } from "../../../../theme/ThemeProvider";
import { fonts } from "../../../../theme/tokens";
import { Icon } from "../../../../ui/Icon";
import { Avatar, Banner, Btn, Card, Chip, IconBtn, ListItem, Overline, Proof, Row, SettledIn } from "../../../../ui/kit";
import { AppBar, Screen } from "../../../../ui/layout";
import { PersonAvatar, PersonName, useMoney } from "../../../../ui/plan/common";
import { ErrorScreen, LoadingScreen, MonoLine, payeeName, personOf, PlanGate, QuoteCard, ReceiptPhotoView, spendTitle, usePeopleMoney, useRateLine } from "../../../../ui/spend/parts";
import { Txt } from "../../../../ui/Text";

export default function SpendDetailScreen() {
  const { pot, id } = useLocalSearchParams<{ pot: string; id: string }>();
  const q = usePlan(pot);
  return (
    <PlanGate q={q} testID="screen-spend">
      {(plan) => <Loader plan={plan} id={id} />}
    </PlanGate>
  );
}

function Loader({ plan, id }: { plan: PlanVM; id: string }) {
  const s = useSpendDetail(plan.pot, id, 15_000);
  if (s.isLoading) return <LoadingScreen testID="screen-spend" />;
  if (s.isError && !s.data) return <ErrorScreen onRetry={() => void s.refetch()} testID="screen-spend" />;
  if (!s.data) return <ErrorScreen title="Spend" message="We couldn't find this spend yet. It may still be arriving." onRetry={() => void s.refetch()} testID="screen-spend" />;
  return <Body plan={plan} s={s.data} />;
}

function Body({ plan, s }: { plan: PlanVM; s: SpendDetail }) {
  const c = useColors();
  const m = useMoney();
  const theirs = usePeopleMoney(plan);
  const rate = useRateLine();
  const rules = planRules(plan.raw);
  const amount = BigInt(s.amount);
  const who = personOf(plan, s.proposer_id);
  const whoName = who.me ? "You" : who.name;
  const note = memoText(plan, s.memo);
  const photo = useReceiptPhoto(plan, s.receiptHash);
  const cat = categoryOf(s.category);
  const title = spendTitle(plan, s, note);
  const executed = s.status === "Executed";
  const settledMsVal = useStore(receipts, (x) => (s.txHash ? x[s.txHash]?.settledMs : undefined));

  // shares: executed → indexer shares (current, after disputes/refunds); otherwise the proposed split
  const rows: { address: string; amount: bigint }[] =
    executed && s.shares?.length
      ? s.shares.map((x) => ({ address: x.account_id.toLowerCase(), amount: BigInt(x.amount) }))
      : (() => {
          const members = (s.splitMembers ?? []).map((a) => a.toLowerCase());
          const parts = sharesFor(amount, (s.splitWeights ?? []).map(Number));
          return members.map((a, i) => ({ address: a, amount: parts[i] ?? 0n }));
        })();
  const allSame = rows.length > 0 && rows.every((r) => r.amount === rows[rows.length - 1].amount);
  const inSplit = !!plan.me && (rows.some((r) => r.address === plan.me) || (s.splitMembers ?? []).some((a) => a.toLowerCase() === plan.me));
  const open = s.disputes?.find((d) => d.status === "Open");
  const resolved = (s.disputes ?? []).filter((d) => d.status === "Resolved").sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
  const refunded = BigInt(s.refunded ?? "0") > 0n;
  const canQuestion = executed && amount > 0n && !refunded && inSplit && plan.isMember && !plan.settled && !open;
  const settledAt = plan.raw.settledAt ?? undefined;

  const verb = s.kind === "PERSONAL" ? "recorded" : s.kind === "LINK" ? "sent a pay link" : "paid";
  const ruleText = s.approvalsRequired <= 1 ? `${ruleLine(rules, amount, 1)} · went through` : `Needed ${oks(s.approvalsRequired - 1)} · ${executed ? "approved" : s.status === "Cancelled" ? "didn't go through" : "waiting"}`;

  const share = () => {
    const local = m.local(amount);
    void Share.share({
      message: `${title} · ${formatUsd(amount)}${local ? ` (${local})` : ""} · ${plan.meta.name}${s.txHash ? `\nProof: ${explorerTxUrl(s.txHash)}` : ""}`,
    }).catch(() => undefined);
  };

  const outcomeLine = (d: (typeof resolved)[number]) => {
    const name = whoName;
    if (d.outcome === "SpenderCovers") return `${name} ${who.me ? "cover" : "covers"} it now, after a question.`;
    if (d.outcome === "Resplit") return `${name} changed the split after a question.`;
    return "The group kept it on the plan after a question.";
  };

  return (
    <Screen testID="screen-spend">
      <AppBar title={title} sub={`${plan.meta.name} · ${s.kind === "LINK" ? "pay link from" : `${verb} by`} ${who.me ? "you" : who.name}`} right={<IconBtn name="share" label="Share" onPress={share} testID="btn-share-spend" />} />
      <ReceiptPhotoView state={photo} ownerName={who.me ? undefined : who.name} />
      <Row between style={{ marginTop: 16 }} align="flex-end">
        <Row gap={10} align="baseline" wrap style={{ flexShrink: 1 }}>
          <Txt v="d34" tnum testID="spend-amount">
            {formatUsd(amount)}
          </Txt>
          {m.local(amount) ? (
            <Txt v="t17" color="muted" weight="medium">
              {m.local(amount)}
            </Txt>
          ) : null}
        </Row>
        <Chip sm label={`${cat.emoji} ${cat.name}`} />
      </Row>
      <Row gap={8} style={{ marginTop: 8 }}>
        <Avatar initial={who.initial} color={who.color} size={24} />
        <Txt v="t13" color="muted" style={{ flexShrink: 1 }}>
          {whoName} {verb}
          {s.kind === "PAY" && payeeName(plan, s.kind, s.payee) !== title ? ` ${payeeName(plan, s.kind, s.payee)}` : ""} · {fmtWhen(s.executedAt ?? s.proposedAt ?? 0).replace(" · ", ", ")}
        </Txt>
      </Row>
      {note ? (
        <View style={{ marginTop: 12 }}>
          <QuoteCard text={note} testID="spend-note" />
        </View>
      ) : null}

      {!executed ? (
        <View style={{ marginTop: 12 }}>
          {s.status === "Cancelled" ? (
            <Banner kind="mut" icon="x" title="This didn't go through" text="Nothing left the pot." />
          ) : (
            <Banner kind="inf" icon="users" title={s.status === "Approved" ? "Approved, waiting to be paid" : "Waiting for OKs"} text={`${Math.max(0, s.approvals - 1)} of ${s.approvalsRequired - 1} so far.`}>
              <View style={{ marginTop: 8 }}>
                <Btn label="See the request" kind="sec" sm onPress={() => router.push({ pathname: "/plan/[pot]/approve/[id]", params: { pot: plan.pot, id: s.spendId } })} testID="btn-see-the-request" />
              </View>
            </Banner>
          )}
        </View>
      ) : null}
      {executed && s.kind === "LINK" ? (
        <View style={{ marginTop: 12 }}>
          <Btn label={refunded ? "Pay link · back in the pot" : "See the pay link"} kind="sec" sm icon="link" onPress={() => router.push({ pathname: "/plan/[pot]/link", params: { pot: plan.pot, id: s.spendId } })} testID="btn-see-pay-link" />
        </View>
      ) : null}

      <Overline style={{ marginTop: 16 }}>
        {`Split ${rows.length} ${rows.length === 1 ? "way" : "ways"}${allSame && rows.length ? ` · ${formatUsd(rows[rows.length - 1].amount)} each` : ""}`}
      </Overline>
      {rows.map((r, i) => {
        const p = personOf(plan, r.address);
        const local = p.me ? m.local(r.amount) : theirs(r.amount, p);
        return (
          <ListItem
            key={r.address}
            testID={`share-row-${i}`}
            left={<PersonAvatar p={p} size={32} />}
            title={<PersonName p={p} />}
            sub={p.city ?? p.country}
            right={formatUsd(r.amount)}
            rsub={local}
            last={i === rows.length - 1}
          />
        );
      })}

      <Card style={{ marginTop: 8 }}>
        <Row between>
          <MonoLine>Rule</MonoLine>
          <Txt style={{ fontFamily: fonts.mono, fontSize: 13, color: c.ink, flexShrink: 1, textAlign: "right" }}>{ruleText}</Txt>
        </Row>
        {rate ? <MonoLine>{rate}</MonoLine> : null}
        {refunded ? <MonoLine>{`Back in the pot · ${formatUsd(BigInt(s.refunded))}`}</MonoLine> : null}
        <Row between style={{ marginTop: 4 }}>
          {settledMsVal !== undefined ? <SettledIn ms={settledMsVal} /> : <View />}
          <Proof hash={s.txHash} />
        </Row>
      </Card>

      {resolved.map((d) => (
        <View key={d.id} style={{ marginTop: 12 }}>
          <Banner kind="mut" icon="scale" title="Questioned" text={outcomeLine(d)}>
            <View style={{ marginTop: 6 }}>
              <Btn label="See the vote" kind="txt" sm onPress={() => router.push({ pathname: "/plan/[pot]/dispute/[id]", params: { pot: plan.pot, id: d.disputeId } })} testID={`btn-see-vote-${d.disputeId}`} />
            </View>
          </Banner>
        </View>
      ))}

      <View style={{ flex: 1, minHeight: 16 }} />
      {open ? (
        <Banner kind="inf" icon="scale" title="Someone questioned this" text="The group is voting on it now." testID="banner-open-question">
          <View style={{ marginTop: 8 }}>
            <Btn label="See the vote" kind="sec" sm onPress={() => router.push({ pathname: "/plan/[pot]/dispute/[id]", params: { pot: plan.pot, id: open.disputeId } })} testID="btn-see-the-vote" />
          </View>
        </Banner>
      ) : canQuestion ? (
        <Row between style={{ marginTop: 16 }}>
          <Row gap={6} style={{ flexShrink: 1 }}>
            <Icon name="clock" size={16} color={c.muted} />
            <Txt v="t13" color="muted" style={{ flexShrink: 1 }}>
              Questions open until settle-up
            </Txt>
          </Row>
          <Btn label="Question this spend" kind="dngo" icon="flag" sm onPress={() => router.push({ pathname: "/plan/[pot]/question/[id]", params: { pot: plan.pot, id: s.spendId } })} testID="btn-question-this-spend" />
        </Row>
      ) : plan.settled && executed ? (
        <Row gap={6} style={{ marginTop: 16 }}>
          <Icon name="lock" size={16} color={c.muted} />
          <Txt v="t13" color="muted">
            {settledAt ? `Questions closed ${fmtDay(settledAt)}` : "Questions closed"}
          </Txt>
        </Row>
      ) : null}
    </Screen>
  );
}
