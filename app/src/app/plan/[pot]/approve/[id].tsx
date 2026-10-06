/**
 * 27 Approval request and 27b Reject with a reason. Everything needed to decide, then two
 * buttons; or the result when it's already decided, ran out, or is mine (withdraw).
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { Address } from "viem";
import * as A from "../../../../lib/chain/actions";
import { findEvent, settledMs } from "../../../../lib/api/relayer";
import { formatUsd, formatUsdShort } from "../../../../lib/domain/currency";
import { categoryOf } from "../../../../lib/domain/rules";
import { activeMembers, memoText, planRules, refreshSpend, useReceiptPhoto, useSpendDetail, type SpendDetail } from "../../../../lib/spend/hooks";
import { budgetInfo, eachAmount, fmtClock, inText, joinNames, ruleLine, sharesFor } from "../../../../lib/spend/logic";
import { REJECT_REASONS, rejectReasonFor, saveRejectReason } from "../../../../lib/spend/rejects";
import { usePlan, type PlanVM } from "../../../../lib/state/data";
import { putReceipt, useAction } from "../../../../lib/state/useAction";
import { Banner, Bar, Btn, Btns, Card, Chip, Field, Row } from "../../../../ui/kit";
import { AppBar, Screen, Sheet } from "../../../../ui/layout";
import { PersonAvatar, useMoney } from "../../../../ui/plan/common";
import { ErrorScreen, KV, LoadingScreen, payeeName, personOf, PlanGate, QuoteCard, ReceiptThumbRow } from "../../../../ui/spend/parts";
import { Txt } from "../../../../ui/Text";
import { showToast } from "../../../../ui/Toast";

export default function ApproveRequest() {
  const { pot, id } = useLocalSearchParams<{ pot: string; id: string }>();
  const q = usePlan(pot);
  return (
    <PlanGate q={q} testID="screen-approve">
      {(plan) => <Loader plan={plan} id={id} />}
    </PlanGate>
  );
}

function Loader({ plan, id }: { plan: PlanVM; id: string }) {
  const s = useSpendDetail(plan.pot, id);
  if (s.isLoading) return <LoadingScreen testID="screen-approve" />;
  if (s.isError && !s.data) return <ErrorScreen onRetry={() => void s.refetch()} testID="screen-approve" />;
  if (!s.data)
    return <ErrorScreen title="Request" message="We couldn't find this request yet. It may still be arriving." onRetry={() => void s.refetch()} testID="screen-approve" />;
  return <ApproveBody plan={plan} s={s.data} />;
}

function ApproveBody({ plan, s }: { plan: PlanVM; s: SpendDetail }) {
  const m = useMoney();
  const rules = planRules(plan.raw);
  const now = Math.floor(Date.now() / 1000);
  const amount = BigInt(s.amount);
  const who = personOf(plan, s.proposer_id);
  const whoName = who.me ? "You" : who.name;
  const mine = who.me;
  const note = memoText(plan, s.memo);
  const photo = useReceiptPhoto(plan, s.receiptHash);
  const cat = categoryOf(s.category);
  const members = (s.splitMembers ?? []).map((a) => a.toLowerCase());
  const weights = (s.splitWeights ?? []).map((w) => Number(w));
  const parts = sharesFor(amount, weights);
  const myIdx = plan.me ? members.indexOf(plan.me) : -1;
  const myShare = myIdx >= 0 ? parts[myIdx] : null;
  const each = eachAmount(amount, weights);
  const active = activeMembers(plan);
  const everyone = members.length === active.length && active.every((a) => members.includes(a));
  const votes = s.votes ?? [];
  const myVote = votes.find((v) => v.account_id.toLowerCase() === plan.me);
  const yes = votes.filter((v) => v.approve && v.account_id.toLowerCase() !== s.proposer_id.toLowerCase());
  const no = votes.filter((v) => !v.approve);
  const needed = Math.max(1, s.approvalsRequired - 1);
  const have = Math.max(0, s.approvals - 1);
  const pending = s.status === "Pending";
  const ranOut = (pending || s.status === "Approved") && Number(s.expiresAt) < now;
  const budget = budgetInfo(rules.categoryBudgets[s.category] ?? 0n, plan.raw.categorySpends.find((x) => x.category === s.category));
  const payee = payeeName(plan, s.kind, s.payee, s.proposer_id);
  const nameOf = (a: string) => {
    const p = personOf(plan, a);
    return p.me ? "You" : p.name;
  };
  const [sheet, setSheet] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [rnote, setRnote] = useState("");
  const savedReject = useMemo(() => rejectReasonFor(plan.pot, s.spendId), [plan.pot, s.spendId, s.votes]);

  const approve = useAction(() => A.vote(plan.pot as Address, BigInt(s.spendId), true));
  const reject = useAction(() => A.vote(plan.pot as Address, BigInt(s.spendId), false));
  const withdraw = useAction(() => A.cancelSpend(plan.pot as Address, BigInt(s.spendId)));
  const exec = useAction(() => A.execute(plan.pot as Address, BigInt(s.spendId)));
  const err = approve.error ?? reject.error ?? withdraw.error ?? exec.error;

  const toPaid = (r: Awaited<ReturnType<typeof A.vote>>, kind: "approve" | "spend") => {
    putReceipt({
      kind,
      txHash: r.txHash,
      settledMs: settledMs(r),
      at: Math.floor(Date.now() / 1000),
      pot: plan.pot,
      spendId: s.spendId,
      amount: s.amount,
      payeeName: payee,
      category: s.category,
      splitMembers: members,
      each: each !== null ? each.toString() : "",
      note: note ?? "",
    });
    refreshSpend(plan.pot, s.spendId);
    router.replace({ pathname: "/plan/[pot]/approved", params: { pot: plan.pot, id: s.spendId, tx: r.txHash } });
  };

  const onApprove = async () => {
    const r = await approve.run();
    if (!r) return;
    if (findEvent(r, "SpendExecuted")) return toPaid(r, "approve");
    refreshSpend(plan.pot, s.spendId);
    showToast({ title: "You said OK", sub: findEvent(r, "SpendApproved") ? "Approved. It's paid once the pot can cover it." : `Waiting for ${needed - have - 1} more`, emoji: plan.meta.emoji });
  };
  const onReject = async () => {
    if (!reason) return;
    const r = await reject.run();
    if (!r) return;
    saveRejectReason(plan.pot, s.spendId, reason, rnote);
    setSheet(false);
    refreshSpend(plan.pot, s.spendId);
    showToast({ title: "You said no", sub: `${whoName} sees that you said no`, emoji: plan.meta.emoji });
  };

  const title =
    s.kind === "PERSONAL"
      ? `${whoName} paid ${formatUsdShort(amount)}${note ? ` for ${note}` : ""} and ${mine ? "want" : "wants"} it on the plan`
      : s.kind === "LINK"
        ? `${whoName} ${mine ? "want" : "wants"} to send a ${formatUsdShort(amount)} pay link${note ? ` for ${note}` : ""}`
        : note
          ? `${whoName} ${mine ? "want" : "wants"} ${formatUsdShort(amount)} for ${note}`
          : `${whoName} ${mine ? "want" : "wants"} to pay ${payee} ${formatUsdShort(amount)}`;
  const subParts = [m.local(amount), myShare !== null ? `your share ${m.localOrUsd(myShare)}` : null].filter(Boolean);

  // ── result / state banner and dock ──
  let state: React.ReactNode = null;
  let dock: React.ReactNode = null;
  const seeSpend = <Btn label="See the spend" kind="sec" onPress={() => router.replace({ pathname: "/plan/[pot]/spend/[id]", params: { pot: plan.pot, id: s.spendId } })} testID="btn-see-the-spend" />;
  if (s.status === "Executed") {
    state = <Banner kind="pos" icon="check" title="Approved and paid" text={`${s.kind === "PERSONAL" ? "It's on the plan" : `${payee} got ${formatUsd(amount)}`}${s.executedAt ? ` at ${fmtClock(s.executedAt)}` : ""}.`} testID="banner-result" />;
    dock = seeSpend;
  } else if (s.status === "Cancelled") {
    const t = s.cancelReason === 0 ? `${whoName} withdrew this request.` : s.cancelReason === 1 ? "The group said no. Nothing left the pot." : `This request ran out. ${whoName} can ask again.`;
    state = <Banner kind={s.cancelReason === 1 ? "neg" : "mut"} icon={s.cancelReason === 2 ? "clock" : "x"} title={s.cancelReason === 1 ? "Not approved" : s.cancelReason === 2 ? "Ran out" : "Withdrawn"} text={t} testID="banner-result" />;
  } else if (ranOut) {
    state = <Banner kind="mut" icon="clock" title="Ran out" text={`This request ran out. ${mine ? "You" : whoName} can ask again.`} testID="banner-result" />;
  } else if (s.status === "Approved") {
    const short = BigInt(plan.raw.balance) < amount;
    state = (
      <Banner
        kind="inf"
        icon="clock"
        title={plan.frozen ? "Approved — waiting for the plan to resume" : "Approved — waiting for money in the pot"}
        text={plan.frozen ? "Spending is paused. It's paid once the group resumes it." : short ? `The pot has ${formatUsd(BigInt(plan.raw.balance))}. It's paid once there's enough.` : "Everyone needed said OK. Try paying it now."}
        testID="banner-result"
      />
    );
    dock = plan.isMember ? (
      <Btn
        label="Try paying now"
        loading={exec.busy}
        disabled={plan.frozen}
        onPress={async () => {
          const r = await exec.run();
          if (!r) return;
          if (findEvent(r, "SpendExecuted")) toPaid(r, "spend");
          else refreshSpend(plan.pot, s.spendId);
        }}
        testID="btn-try-paying-now"
      />
    ) : null;
  } else if (mine) {
    const left = needed - have;
    state = (
      <Banner kind="inf" icon="users" title={`Waiting for ${left} more OK${left === 1 ? "" : "s"}`} text={`${yes.length ? `${joinNames(yes.map((v) => nameOf(v.account_id)))} said OK. ` : ""}${no.length ? `${joinNames(no.map((v) => nameOf(v.account_id)))} said no. ` : ""}Runs out in ${inText(Number(s.expiresAt) - now)}.`} testID="banner-result" />
    );
    dock = (
      <Btn
        label="Withdraw request"
        kind="dngo"
        loading={withdraw.busy}
        onPress={async () => {
          const r = await withdraw.run();
          if (!r) return;
          refreshSpend(plan.pot, s.spendId);
          showToast({ title: "Request withdrawn", sub: "Nothing left the pot", emoji: plan.meta.emoji });
        }}
        testID="btn-withdraw-request"
      />
    );
  } else if (myVote) {
    state = myVote.approve ? (
      <Banner kind="pos" icon="check" title="You said OK" text={`Waiting for ${needed - have} more.`} testID="banner-result" />
    ) : (
      <Banner kind="mut" icon="x" title="You said no" text={savedReject ? `Your reason: ${savedReject.reason}${savedReject.note ? ` · “${savedReject.note}”` : ""}` : `${whoName} sees that you said no.`} testID="banner-result" />
    );
  } else if (!plan.isMember) {
    state = <Banner kind="mut" icon="info" title="Only people in the plan can approve" testID="banner-result" />;
  } else {
    const mineMakes = have + 1;
    state = (
      <Banner
        kind={yes.length ? "pos" : "inf"}
        icon={yes.length ? "check" : "users"}
        title={yes.length ? `${joinNames(yes.map((v) => nameOf(v.account_id)))} said OK` : `Needs ${needed - have} more OK${needed - have === 1 ? "" : "s"}`}
        text={`Yours makes ${mineMakes} of ${needed}${mineMakes >= needed ? `, so it's ${s.kind === "PERSONAL" ? "added" : "paid"} straight away.` : "."}${no.length ? ` ${joinNames(no.map((v) => nameOf(v.account_id)))} said no.` : ""}`}
        testID="banner-votes"
      />
    );
    dock = (
      <Btns>
        <Btn label="Reject" kind="dngo" onPress={() => setSheet(true)} testID="btn-reject" />
        <Btn label="Approve" kind="pri" icon="fp" onPress={() => void onApprove()} loading={approve.busy} testID="btn-approve" />
      </Btns>
    );
  }

  return (
    <Screen testID="screen-approve" dock={dock}>
      <AppBar icon="x" />
      <Row>
        <PersonAvatar p={who} size={48} />
        <View style={{ flex: 1 }}>
          <Txt v="lt" numberOfLines={1}>
            {whoName} · {plan.meta.name}
          </Txt>
          <Txt v="t13" color="muted">
            {s.proposedAt ? `Asked at ${fmtClock(s.proposedAt)}` : "Asked"}
            {pending && !ranOut ? ` · expires in ${inText(Number(s.expiresAt) - now)}` : ""}
          </Txt>
        </View>
      </Row>
      <Txt v="d28" style={{ marginTop: 16 }} testID="approve-title">
        {title}
      </Txt>
      {subParts.length ? (
        <Txt v="t17" color="muted" weight="medium" style={{ marginTop: 4 }}>
          {subParts.join(" · ")}
        </Txt>
      ) : null}
      {note ? (
        <View style={{ marginTop: 16 }}>
          <QuoteCard text={note} testID="approve-note" />
        </View>
      ) : null}
      <View style={{ marginTop: 8 }}>
        <ReceiptThumbRow state={photo} title="Receipt photo" />
      </View>
      <Card style={{ marginTop: 8, gap: 8 }}>
        <KV k={s.kind === "PERSONAL" ? "Paid by" : "Pay to"} v={s.kind === "PERSONAL" ? whoName : payee} />
        <KV k="Category" v={`${cat.emoji} ${cat.name}`} />
        <KV
          k="Split"
          v={`${everyone ? "Everyone" : `${members.length} ${members.length === 1 ? "person" : "people"}`} · ${each !== null ? `${formatUsd(each)} each` : "custom shares"}`}
        />
        {budget ? (
          <View>
            <KV k={`${cat.name} after this`} v={`${formatUsdShort(budget.spent + (s.status === "Executed" ? 0n : amount))} of ${formatUsdShort(budget.budget)}`} />
            <View style={{ marginTop: 4 }}>
              <Bar pct={Number(((budget.spent + (s.status === "Executed" ? 0n : amount)) * 100n) / budget.budget)} over={budget.spent + amount > budget.budget && s.status !== "Executed"} />
            </View>
          </View>
        ) : null}
        <KV k="Rule" v={ruleLine(rules, amount, s.approvalsRequired)} />
      </Card>
      <View style={{ marginTop: 12, gap: 8 }}>
        {state}
        {err ? <Banner kind="neg" icon="alert" title={err.title} text={err.message} testID="banner-action-error" /> : null}
      </View>

      <Sheet visible={sheet} onClose={() => setSheet(false)} testID="sheet-reject">
        <Txt v="d22">Why not?</Txt>
        <Txt v="t13" color="muted" style={{ marginTop: 6, marginBottom: 14 }}>
          {whoName} sees that you said no. Your reason stays on your phone, so tell them too if it helps.
        </Txt>
        <Row gap={8} wrap>
          {REJECT_REASONS.map((r) => (
            <Chip key={r} label={r} on={reason === r} onPress={() => setReason(r)} testID={`chip-reason-${r.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`} />
          ))}
        </Row>
        <View style={{ marginTop: 16 }}>
          <Field label="Note (optional)" value={rnote} onChangeText={setRnote} maxLength={140} testID="field-reject-note" />
        </View>
        {reject.error ? (
          <View style={{ marginTop: 12 }}>
            <Banner kind="neg" icon="alert" title={reject.error.title} text={reject.error.message} />
          </View>
        ) : null}
        <Btns style={{ marginTop: 16 }}>
          <Btn label="Cancel" kind="sec" onPress={() => setSheet(false)} testID="btn-cancel-reject" />
          <Btn label="Reject" kind="dng" disabled={!reason} loading={reject.busy} onPress={() => void onReject()} testID="btn-confirm-reject" />
        </Btns>
      </Sheet>
    </Screen>
  );
}
