/**
 * 25 Record something I paid myself (PERSONAL spend). No money moves now: the amount is added to
 * what I'm owed and evens out at settle-up. Counts against budgets and caps like any spend.
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useLayoutEffect, useState } from "react";
import { View } from "react-native";
import type { Address } from "viem";
import { settledMs } from "../../../lib/api/relayer";
import { SpendKind } from "../../../lib/chain/eip712";
import { fromBase64Url } from "../../../lib/crypto/bytes";
import { currencyFor, formatUsd, usdToLocalE8 } from "../../../lib/domain/currency";
import { proposeSpend } from "../../../lib/domain/planOps";
import { clearDraft, patchDraft, startDraft, useDraft } from "../../../lib/spend/draft";
import { activeMembers, planRules, refreshSpend, useRulePreview } from "../../../lib/spend/hooks";
import { amountDecimals, eachAmount, fmtClock, joinNames, plainFixed, ruleLine, sanitizeAmountText } from "../../../lib/spend/logic";
import { useMe, usePlan, type PlanVM } from "../../../lib/state/data";
import { putReceipt, useAction } from "../../../lib/state/useAction";
import { useColors } from "../../../theme/ThemeProvider";
import { fonts } from "../../../theme/tokens";
import { Icon } from "../../../ui/Icon";
import { Banner, Btn, Chip, Field, Overline } from "../../../ui/kit";
import { AppBar, Screen } from "../../../ui/layout";
import { useLocal } from "../../../ui/money";
import { CategoryChips, useMoney } from "../../../ui/plan/common";
import { draftSplit, PhotoRow, RuleBanner, SplitSection, useDraftUnits, verdictOf } from "../../../ui/spend/form";
import { PlanGate } from "../../../ui/spend/parts";
import { Txt } from "../../../ui/Text";
import { showToast } from "../../../ui/Toast";
import { DeskColumn } from "../../../ui/desk/plan";
import { RatesOutOfDate, useTypedRateGate } from "../../../ui/fx/rates";
import { useLayout } from "../../../ui/shell/responsive";

export default function RecordPersonal() {
  const { pot } = useLocalSearchParams<{ pot: string }>();
  const q = usePlan(pot);
  return (
    <PlanGate q={q} title="I paid for something" testID="screen-personal">
      {(plan) => <PersonalBody plan={plan} />}
    </PlanGate>
  );
}

function PersonalBody({ plan }: { plan: PlanVM }) {
  const { desk } = useLayout();
  const c = useColors();
  const me = useMe();
  const local = useLocal();
  const m = useMoney();
  const cur = currencyFor(local.currency);
  const key = `personal|${plan.pot}`;
  useLayoutEffect(() => {
    startDraft(key, plan.pot, { inLocal: local.currency !== "USD", label: "Paid by me" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const d = useDraft();
  const units = useDraftUnits(d);
  const rules = planRules(plan.raw);
  const split = draftSplit(plan, d);
  const inLocal = d.inLocal && local.currency !== "USD";
  const typed = useTypedRateGate(local.currency, d.inLocal);
  const pv = useRulePreview({ pot: plan.pot, me: me.address, kind: SpendKind.PERSONAL, payee: me.address?.toLowerCase(), amount: units, category: d.category, enabled: d.key === key });
  const verdict = verdictOf(pv, units, split.members.length);
  const others = activeMembers(plan)
    .filter((a) => a !== plan.me)
    .map((a) => plan.people[a]?.name ?? "Friend");

  const swap = () => {
    if (!local.rateE8) return;
    if (inLocal) patchDraft({ inLocal: false, amountText: plainFixed(units, 6, 2) });
    else patchDraft({ inLocal: true, amountText: plainFixed(usdToLocalE8(units, local.rateE8), 8, cur.decimals) });
  };

  const action = useAction(async () =>
    proposeSpend({
      pot: plan.pot as Address,
      kind: SpendKind.PERSONAL,
      amount: units,
      category: d.category,
      split: { members: split.members as Address[], weights: split.weights },
      note: d.note.trim() || undefined,
      photoJpeg: d.photo ? fromBase64Url(d.photo.base64) : undefined,
    }),
  );

  const record = async () => {
    const out = await action.run();
    if (!out) return;
    const each = eachAmount(units, split.weights);
    putReceipt({
      kind: "personal",
      txHash: out.result.txHash,
      settledMs: settledMs(out.result),
      at: Math.floor(Date.now() / 1000),
      pot: plan.pot,
      spendId: out.spendId !== undefined ? String(out.spendId) : "",
      executed: out.executed,
      amount: units.toString(),
      payeeName: "You",
      category: d.category,
      splitMembers: split.members,
      splitWeights: split.weights,
      each: each !== null ? each.toString() : "",
      note: d.note.trim(),
      approvalsRequired: out.approvalsRequired,
      rule: ruleLine(rules, units, out.approvalsRequired),
    });
    refreshSpend(plan.pot, out.spendId);
    clearDraft();
    if (out.executed) router.replace({ pathname: "/plan/[pot]/done", params: { pot: plan.pot, tx: out.result.txHash } });
    else {
      showToast({ title: "Request sent", sub: others.length ? `We asked ${joinNames(others)}` : undefined, emoji: plan.meta.emoji });
      router.dismissTo({ pathname: "/plan/[pot]", params: { pot: plan.pot } });
    }
  };

  if (d.key !== key) return null;

  let dock: React.ReactNode;
  if (verdict.kind === "blocked") dock = <Btn label="Can't record this now" kind="off" icon="ban" disabled testID="btn-cant-record" />;
  else if (verdict.kind === "ask") {
    const n = verdict.approvals - 1;
    dock = <Btn label={n === 1 ? "Ask for an OK" : `Ask for ${n} OKs`} icon="send" onPress={() => void record()} loading={action.busy} disabled={typed.gate !== "ok"} testID="btn-ask-for-an-ok" />;
  } else dock = <Btn label="Record it" onPress={() => void record()} loading={action.busy} disabled={verdict.kind !== "now" || !d.note.trim() || typed.gate !== "ok"} testID="btn-record-it" />;

  return (
    <Screen testID="screen-personal" dock={desk ? undefined : dock}>
      <DeskColumn dock={dock}>
      <AppBar icon="x" title="I paid for something" sub={plan.meta.name} />
      <Banner kind="inf" icon="info" title="No money moves now" text="This adds to what you're owed. It evens out when you settle up." />
      <View style={{ gap: 12, marginTop: 16 }}>
        <Field label="What was it?" value={d.note} onChangeText={(t) => patchDraft({ note: t })} placeholder="Groceries, a taxi, tickets…" maxLength={140} testID="field-what-was-it" />
        <Field
          label={inLocal ? `Amount in ${cur.plural}` : "Amount in dollars"}
          value={d.amountText}
          onChangeText={(t) => patchDraft({ amountText: sanitizeAmountText(t, amountDecimals(inLocal, local.currency)) })}
          placeholder={inLocal ? `${cur.symbol.trim()}0` : "$0"}
          keyboardType="decimal-pad"
          testID="field-amount"
          right={
            units > 0n ? (
              <Txt style={{ fontFamily: fonts.mono, fontSize: 14, color: c.ink }} testID="amount-other">
                {inLocal ? formatUsd(units) : (m.local(units) ?? "")}
              </Txt>
            ) : undefined
          }
        />
        {local.currency !== "USD" && local.rateE8 ? <Chip sm ol icon="swap" label={inLocal ? "Type in dollars" : `Type in ${cur.plural}`} onPress={swap} testID="btn-swap-currency" /> : null}
        {typed.blocked ? <RatesOutOfDate gate={typed.gate} onRefresh={typed.refresh} refreshing={typed.refreshing} /> : null}
      </View>
      <Overline style={{ marginTop: 20 }}>Category</Overline>
      <View style={{ marginTop: 8 }}>
        <CategoryChips value={d.category} onChange={(cat) => patchDraft({ category: cat })} />
      </View>
      <SplitSection plan={plan} d={d} units={units} personal />
      <PhotoRow photo={d.photo} hint="Helps if anyone asks later" />
      <View style={{ marginTop: 12 }}>
        <Field label="When" value={`Today, ${fmtClock(now)}`} right={<Icon name="cal" size={20} />} hint="Saved with the time you record it." testID="field-when" />
      </View>
      <View style={{ flex: 1, minHeight: 12 }} />
      <View style={{ marginTop: 12, gap: 8 }}>
        <RuleBanner plan={plan} rules={rules} kind={SpendKind.PERSONAL} units={units} category={d.category} verdict={verdict} onRetry={pv.retry} />
        {action.error ? <Banner kind="neg" icon="alert" title={action.error.title} text={action.error.message} testID="banner-action-error" /> : null}
      </View>
    </DeskColumn>
    </Screen>
  );
}
