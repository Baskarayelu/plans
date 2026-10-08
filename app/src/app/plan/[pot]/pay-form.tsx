/**
 * 21 Spend form, with the live rule preview states 22a (needs OKs), 22b (over budget) and
 * 22c (paused). Params: payee, kind PAY|LINK, name, category (optional preset).
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useLayoutEffect, useState } from "react";
import { View } from "react-native";
import type { Address } from "viem";
import { settledMs } from "../../../lib/api/relayer";
import { SpendKind } from "../../../lib/chain/eip712";
import { fromBase64Url } from "../../../lib/crypto/bytes";
import { formatUsd } from "../../../lib/domain/currency";
import { contactFor } from "../../../lib/domain/groups";
import { proposeSpend } from "../../../lib/domain/planOps";
import { categoryOf } from "../../../lib/domain/rules";
import { clearDraft, patchDraft, startDraft, useDraft } from "../../../lib/spend/draft";
import { activeMembers, planRules, refreshSpend, useRulePreview } from "../../../lib/spend/hooks";
import { eachAmount, joinNames, plainFixed, ruleLine } from "../../../lib/spend/logic";
import { useMe, usePlan, type PlanVM } from "../../../lib/state/data";
import { RatesOutOfDate, useTypedRateGate } from "../../../ui/fx/rates";
import { putReceipt, useAction } from "../../../lib/state/useAction";
import { Banner, Btn, Card, EmojiTile, Field, Overline, Row, Tile } from "../../../ui/kit";
import { AppBar, Screen } from "../../../ui/layout";
import { CategoryChips, PersonAvatar } from "../../../ui/plan/common";
import { DeskAmount, PayBudgets, PayChecks, PaySummary, ShareCards, TierBar } from "../../../ui/desk/pay";
import { Columns, TextLink } from "../../../ui/desk/plan";
import { Crumbs } from "../../../ui/shell/desk";
import { SidePanel } from "../../../ui/shell/panel";
import { useConfirmLabel, useLayout } from "../../../ui/shell/responsive";
import { AmountHero, draftSplit, PhotoRow, RuleBanner, SplitSection, useDraftUnits, verdictOf } from "../../../ui/spend/form";
import { PlanGate } from "../../../ui/spend/parts";
import { Txt } from "../../../ui/Text";
import { showToast } from "../../../ui/Toast";

/** Any nonzero payee works for a pay link preview: LINK payees aren't checked against the policy. */
const LINK_PREVIEW_PAYEE = "0x000000000000000000000000000000000000dead";

export default function PayForm() {
  const p = useLocalSearchParams<{ pot: string; payee?: string; kind?: string; name?: string; category?: string; amount?: string }>();
  const q = usePlan(p.pot);
  return (
    <PlanGate q={q} title="Pay from the pot" testID="screen-pay-form">
      {(plan) => <PayFormBody plan={plan} kind={p.kind === "LINK" ? SpendKind.LINK : SpendKind.PAY} payee={(p.payee ?? "").toLowerCase()} name={p.name ?? ""} category={p.category ? Number(p.category) : undefined} amount={p.amount && /^\d+$/.test(p.amount) ? BigInt(p.amount) : undefined} />}
    </PlanGate>
  );
}

function PayFormBody({ plan, kind, payee, name, category, amount }: { plan: PlanVM; kind: SpendKind; payee: string; name: string; category?: number; amount?: bigint }) {
  const me = useMe();
  const isLink = kind === SpendKind.LINK;
  const member = payee ? plan.people[payee] : undefined;
  const payeeLabel = isLink ? "Pay link" : member ? member.name : name || contactFor(payee)?.name || "a business";
  const key = `pay|${plan.pot}|${kind}|${payee}`;
  useLayoutEffect(() => {
    startDraft(key, plan.pot, {
      category: category !== undefined && category >= 0 && category <= 7 ? category : 7,
      label: isLink ? "Pay link" : payeeLabel,
      ...(amount && amount > 0n ? { amountText: plainFixed(amount, 6, 2), inLocal: false } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const d = useDraft();
  const units = useDraftUnits(d);
  const typed = useTypedRateGate(me.currency, d.inLocal);
  const rules = planRules(plan.raw);
  const split = draftSplit(plan, d);
  const [cover, setCover] = useState<{ part: bigint; over: bigint } | null>(null);
  const pv = useRulePreview({
    pot: plan.pot,
    me: me.address,
    kind,
    payee: isLink ? LINK_PREVIEW_PAYEE : payee,
    amount: units,
    category: d.category,
    enabled: d.key === key && (isLink || !!payee),
  });
  const verdict = verdictOf(pv, units, split.members.length);
  const others = activeMembers(plan)
    .filter((a) => a !== plan.me)
    .map((a) => plan.people[a]?.name ?? "Friend");

  const action = useAction(async () => {
    const photoJpeg = d.photo ? fromBase64Url(d.photo.base64) : undefined;
    return proposeSpend({
      pot: plan.pot as Address,
      kind,
      payee: isLink ? undefined : (payee as Address),
      amount: units,
      category: d.category,
      split: { members: split.members as Address[], weights: split.weights },
      note: d.note.trim() || undefined,
      photoJpeg,
    });
  });

  const confirm = async () => {
    const out = await action.run();
    if (!out) return;
    const tx = out.result.txHash;
    const each = eachAmount(units, split.weights);
    putReceipt({
      kind: isLink ? "link" : "spend",
      txHash: tx,
      settledMs: settledMs(out.result),
      at: Math.floor(Date.now() / 1000),
      pot: plan.pot,
      spendId: out.spendId !== undefined ? String(out.spendId) : "",
      executed: out.executed,
      amount: units.toString(),
      payeeName: payeeLabel,
      category: d.category,
      splitMembers: split.members,
      splitWeights: split.weights,
      each: each !== null ? each.toString() : "",
      note: d.note.trim(),
      approvalsRequired: out.approvalsRequired,
      rule: ruleLine(rules, units, out.approvalsRequired),
      claimLink: out.claimLink ?? "",
    });
    refreshSpend(plan.pot, out.spendId);
    clearDraft();
    if (isLink && out.spendId !== undefined) {
      router.replace({ pathname: "/plan/[pot]/link", params: { pot: plan.pot, id: String(out.spendId), tx } });
    } else if (out.executed) {
      router.replace({ pathname: "/plan/[pot]/done", params: { pot: plan.pot, tx } });
    } else {
      showToast({ title: "Request sent", sub: others.length ? `We asked ${joinNames(others)}` : undefined, emoji: plan.meta.emoji });
      router.dismissTo({ pathname: "/plan/[pot]", params: { pot: plan.pot } });
    }
  };

  const confirmLabel = useConfirmLabel();
  const { desk } = useLayout();
  if (d.key !== key) return null;

  let dock: React.ReactNode;
  if (verdict.kind === "blocked" && verdict.reason === 3) {
    dock = <Btn label="Vote to resume" kind="pri" icon="play" onPress={() => router.dismissTo({ pathname: "/plan/[pot]", params: { pot: plan.pot } })} testID="btn-vote-to-resume" />;
  } else if (verdict.kind === "blocked") {
    dock = <Btn label="Can't pay this from the pot" kind="off" icon="ban" disabled testID="btn-cant-pay" />;
  } else if (verdict.kind === "ask") {
    const n = verdict.approvals - 1;
    dock = <Btn label={n === 1 ? "Ask for an OK" : `Ask for ${n} OKs`} kind="pri" icon="send" onPress={() => void confirm()} loading={action.busy} disabled={typed.gate !== "ok"} testID="btn-ask-for-an-ok" />;
  } else {
    dock = <Btn label={confirmLabel} kind="pri" icon={desk ? "key" : "fp"} onPress={() => void confirm()} loading={action.busy} disabled={verdict.kind !== "now" || typed.gate !== "ok"} testID="btn-confirm-with-fingerprint" />;
  }

  const coverNote =
    cover && cover.over > 0n && units === cover.part ? (
      <Txt v="t13" color="muted" testID="cover-note">
        You'll pay the other {formatUsd(cover.over)} yourself. It stays off the plan, so the {categoryOf(d.category).name} budget isn't passed.
      </Txt>
    ) : null;
  const rateBanner = typed.blocked ? <RatesOutOfDate gate={typed.gate} onRefresh={typed.refresh} refreshing={typed.refreshing} /> : null;
  const ruleBanner = (
    <RuleBanner
      plan={plan}
      rules={rules}
      kind={kind}
      units={units}
      category={d.category}
      verdict={verdict}
      onRetry={pv.retry}
      onPayPart={(part) => {
        setCover({ part, over: units - part });
        patchDraft({ inLocal: false, amountText: plainFixed(part, 6, 2) });
      }}
    />
  );

  if (desk) {
    const cat = categoryOf(d.category);
    const change = () => (router.canGoBack() ? router.back() : router.replace({ pathname: "/plan/[pot]/pay", params: { pot: plan.pot } }));
    const payeeLeft = isLink ? <Tile icon="link" size={48} /> : member ? <PersonAvatar p={member} size={48} /> : <EmojiTile emoji={cat.emoji} color={plan.meta.color} size={48} />;
    const payeeSub = isLink ? "Pay link · they claim it in their own money" : member ? `Someone in the plan${member.city ? ` · ${member.city}` : ""}` : payee ? `Business · ${cat.name}` : "Choose who you're paying";
    return (
      <Screen testID="screen-pay-form">
        <Crumbs items={[{ label: "Plans", href: "/" }, { label: plan.meta.name, href: { pathname: "/plan/[pot]", params: { pot: plan.pot } } }, { label: "Pay" }]} />
        <Txt v="d34" style={{ marginTop: 8 }}>
          {isLink ? "Send a pay link" : "Pay from the pot"}
        </Txt>
        <Txt v="t15" color="muted" style={{ marginTop: 4 }}>
          {plan.meta.name} · {formatUsd(BigInt(plan.raw.balance))} left
        </Txt>
        <Card style={{ marginTop: 16 }} testID="payee-card">
          <Row>
            {payeeLeft}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt v="lt" numberOfLines={1}>
                {isLink ? "Someone outside the plan" : payeeLabel.charAt(0).toUpperCase() + payeeLabel.slice(1)}
              </Txt>
              <Txt v="t13" color="muted" numberOfLines={1}>
                {payeeSub}
              </Txt>
            </View>
            <TextLink label={payee || isLink ? "Change" : "Choose"} muted onPress={change} testID="btn-change-payee" />
          </Row>
        </Card>
        <DeskAmount d={d} units={units} autoFocus={!d.amountText} />
        <Overline style={{ marginTop: 20 }}>Category</Overline>
        <View style={{ marginTop: 8 }}>
          <CategoryChips value={d.category} onChange={(c) => patchDraft({ category: c })} />
        </View>
        <SplitSection plan={plan} d={d} units={units} />
        <Columns
          items={[0, 1]}
          style={{ marginTop: 20 }}
          render={(i) =>
            i === 0 ? (
              <Field label="Note" value={d.note} onChangeText={(t) => patchDraft({ note: t })} placeholder={isLink ? "What's it for?" : "What was it?"} maxLength={140} testID="field-note" />
            ) : (
              <Card p={0} style={{ paddingHorizontal: 12, paddingVertical: 5 }}>
                <View style={{ marginTop: -16 }}>
                  <PhotoRow photo={d.photo} hint="Only the plan can see it" />
                </View>
              </Card>
            )
          }
        />
        <ShareCards plan={plan} d={d} units={units} />
        <View style={{ height: 24 }} />
        <SidePanel kind="form">
          <View style={{ flex: 1 }} testID="pay-panel">
            <Txt v="ov" color="muted">
              What will happen
            </Txt>
            <View style={{ marginTop: 8 }}>{ruleBanner}</View>
            {units > 0n && (verdict.kind === "now" || verdict.kind === "ask" || verdict.kind === "checking") ? <TierBar plan={plan} rules={rules} units={units} /> : null}
            <PayChecks plan={plan} rules={rules} units={units} category={d.category} business={!isLink && !member && !!payee} verdict={verdict} />
            {units > 0n ? <PayBudgets plan={plan} rules={rules} units={units} category={d.category} /> : null}
            {coverNote ? <View style={{ marginTop: 12 }}>{coverNote}</View> : null}
            <View style={{ flex: 1, minHeight: 24 }} />
            {rateBanner ? <View style={{ marginBottom: 12 }}>{rateBanner}</View> : null}
            {action.error ? (
              <View style={{ marginBottom: 12 }}>
                <Banner kind="neg" icon="alert" title={action.error.title} text={action.error.message} testID="banner-action-error" />
              </View>
            ) : null}
            <PaySummary plan={plan} units={units} label={isLink ? "The link holds" : "You pay"} />
            <View style={{ marginTop: 12 }}>{dock}</View>
            {verdict.kind === "now" || verdict.kind === "ask" ? (
              <Txt v="t13" color="muted" center style={{ marginTop: 8 }}>
                Your browser asks for your fingerprint, face or screen lock.
              </Txt>
            ) : null}
          </View>
        </SidePanel>
      </Screen>
    );
  }

  return (
    <Screen testID="screen-pay-form" dock={dock}>
      <AppBar title={isLink ? "Send a pay link" : `Pay ${payeeLabel}`} sub={isLink ? `From ${plan.meta.name} pot · they claim it in their own money` : `From ${plan.meta.name} pot`} />
      <AmountHero d={d} units={units} autoFocus={!d.amountText} />
      <Overline style={{ marginTop: 20 }}>Category</Overline>
      <View style={{ marginTop: 8 }}>
        <CategoryChips value={d.category} onChange={(c) => patchDraft({ category: c })} />
      </View>
      <SplitSection plan={plan} d={d} units={units} />
      <PhotoRow photo={d.photo} />
      <View style={{ marginTop: 12 }}>
        <Field label="Note" value={d.note} onChangeText={(t) => patchDraft({ note: t })} placeholder={isLink ? "What's it for?" : "What was it?"} maxLength={140} testID="field-note" />
      </View>
      <View style={{ flex: 1, minHeight: 12 }} />
      <View style={{ marginTop: 12, gap: 8 }}>
        {rateBanner}
        {ruleBanner}
        {coverNote}
        {action.error ? <Banner kind="neg" icon="alert" title={action.error.title} text={action.error.message} testID="banner-action-error" /> : null}
      </View>
    </Screen>
  );
}
