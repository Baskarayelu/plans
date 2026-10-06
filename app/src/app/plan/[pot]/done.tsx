/**
 * 24 Spend done (and the "Recorded" receipt for 25). The receipt as a ticket stub; numbers come
 * from the relayer result the form handed over (putReceipt), settled time is measured.
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { Share, View } from "react-native";
import { explorerTxUrl } from "../../../config";
import { formatUsd } from "../../../lib/domain/currency";
import { categoryOf } from "../../../lib/domain/rules";
import { fmtWhen, joinNames } from "../../../lib/spend/logic";
import { useStore } from "../../../lib/state/observable";
import { usePlan, type PlanVM } from "../../../lib/state/data";
import { receipts, type ReceiptData } from "../../../lib/state/useAction";
import { useColors } from "../../../theme/ThemeProvider";
import { BigIcon, Banner, Btn, Btns, Proof, Row, SettledIn } from "../../../ui/kit";
import { Screen } from "../../../ui/layout";
import { useMoney } from "../../../ui/plan/common";
import { PlanGate, useRateLine } from "../../../ui/spend/parts";
import { Stub } from "../../../ui/Stub";
import { Txt } from "../../../ui/Text";
import { ActivityIndicator } from "react-native";

export default function SpendDone() {
  const { pot, tx } = useLocalSearchParams<{ pot: string; tx?: string }>();
  const q = usePlan(pot);
  return (
    <PlanGate q={q} testID="screen-spend-done">
      {(plan) => <DoneBody plan={plan} tx={tx} />}
    </PlanGate>
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function DoneBody({ plan, tx }: { plan: PlanVM; tx?: string }) {
  const c = useColors();
  const r = useStore(receipts, (s) => (tx ? s[tx] : undefined));
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (r) return;
    const t = setTimeout(() => setLate(true), 5000);
    return () => clearTimeout(t);
  }, [r]);
  const home = () => router.dismissTo({ pathname: "/plan/[pot]", params: { pot: plan.pot } });

  if (!r)
    return (
      <Screen testID="screen-spend-done" dock={late ? <Btn label="Back to the plan" kind="sec" onPress={home} testID="btn-back-to-plan" /> : undefined}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
          <ActivityIndicator color={c.ink} size="large" />
          <Txt v="d22" center>
            {late ? "Still confirming…" : "Confirming…"}
          </Txt>
          {late ? (
            <Banner kind="mut" icon="clock" title="Taking longer than usual" text="You can leave this screen. The spend shows up in the plan as soon as it lands." testID="banner-still-confirming" />
          ) : null}
        </View>
      </Screen>
    );
  return <Receipt plan={plan} r={r} onDone={home} />;
}

function Receipt({ plan, r, onDone }: { plan: PlanVM; r: ReceiptData; onDone: () => void }) {
  const m = useMoney();
  const rate = useRateLine();
  const personal = r.kind === "personal";
  const amount = BigInt(str(r.amount) || "0");
  const cat = categoryOf(Number(r.category ?? 7));
  const members = (Array.isArray(r.splitMembers) ? (r.splitMembers as string[]) : []).map((a) => a.toLowerCase());
  const others = members.filter((a) => a !== plan.me).map((a) => plan.people[a]?.name ?? "Friend");
  const each = str(r.each) ? BigInt(str(r.each)) : null;
  const note = str(r.note);
  const payeeRaw = str(r.payeeName) || "the business";
  const payee = payeeRaw.charAt(0).toUpperCase() + payeeRaw.slice(1);
  const seeIt = others.length ? `${joinNames(others)} can see it now.` : "Everyone in the plan can see it now.";
  const lines: [string, React.ReactNode][] = personal
    ? [
        ["Paid by", "You"],
        ["Category", `${cat.emoji} ${cat.name}`],
        ["Split", members.length ? `${members.length} ${members.length === 1 ? "person" : "people"}${each !== null ? ` · ${formatUsd(each)} each` : " · custom shares"}` : "—"],
        ["Rule", "Recorded · nothing moved"],
      ]
    : [
        ["To", payee],
        ["Category", `${cat.emoji} ${cat.name}`],
        ["Split", members.length ? `${members.length} ${members.length === 1 ? "person" : "people"}${each !== null ? ` · ${formatUsd(each)} each` : " · custom shares"}` : "—"],
        ["Rule", `${str(r.rule) || "Rules checked"} · went through now`],
      ];
  if (rate) lines.push(["", rate]);
  lines.push(["When", fmtWhen(r.at)]);

  const share = () => {
    const local = m.local(amount);
    const head = personal ? `I paid ${formatUsd(amount)}${local ? ` (${local})` : ""} for ${plan.meta.name}` : `${payee} got ${formatUsd(amount)}${local ? ` (${local})` : ""} from the ${plan.meta.name} pot`;
    void Share.share({ message: `${head}${note ? ` · ${note}` : ""}\nProof: ${explorerTxUrl(r.txHash)}` }).catch(() => undefined);
  };

  return (
    <Screen
      testID="screen-spend-done"
      dock={
        <Btns>
          <Btn label="Share" kind="sec" icon="share" onPress={share} testID="btn-share" />
          <Btn label="Done" onPress={onDone} testID="btn-done" />
        </Btns>
      }
    >
      <View style={{ alignItems: "center", marginTop: 16 }}>
        <BigIcon icon="check" kind="p" />
        <Txt v="d28" center style={{ marginTop: 12 }} testID="done-title">
          {personal ? "Recorded" : "Paid"}
        </Txt>
        <Txt v="t15" color="muted" center style={{ marginTop: 6, marginHorizontal: 16, marginBottom: 20 }}>
          {personal ? `You paid ${formatUsd(amount)} yourself. No money moved. ${seeIt}` : `${payee} got ${formatUsd(amount)}. ${seeIt}`}
        </Txt>
      </View>
      <Stub
        head={
          <>
            <Row between>
              <Txt v="ov" color="muted">
                {plan.meta.name} pot · receipt
              </Txt>
              <Txt>{plan.meta.emoji}</Txt>
            </Row>
            <Row gap={10} align="baseline" style={{ marginTop: 8 }} wrap>
              <Txt v="d34" tnum testID="receipt-amount">
                {formatUsd(amount)}
              </Txt>
              {m.local(amount) ? (
                <Txt v="t17" color="muted" weight="medium">
                  {m.local(amount)}
                </Txt>
              ) : null}
            </Row>
            {note ? (
              <Txt v="t15" weight="bold" style={{ marginTop: 4 }}>
                {note}
              </Txt>
            ) : null}
          </>
        }
        lines={lines}
        foot={
          <>
            <SettledIn ms={r.settledMs} />
            <Proof hash={r.txHash} />
          </>
        }
      />
    </Screen>
  );
}
