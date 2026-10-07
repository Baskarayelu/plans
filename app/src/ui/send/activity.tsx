/**
 * Activity pieces (52, and 117 on a laptop): what needs you, and the detail of a picked row shown
 * in the right panel (the request with votes and Approve/Reject; the receipt of a money row; a
 * plan event with a way into the plan).
 */
import { router } from "expo-router";
import React from "react";
import { Pressable, View } from "react-native";
import type { PlanDetail, SpendRow } from "../../lib/api/envio";
import { fromHex } from "../../lib/crypto/bytes";
import { decodeMemo } from "../../lib/crypto/seal";
import { formatUsd, formatUsdShort } from "../../lib/domain/currency";
import { groupKeyFor } from "../../lib/domain/groups";
import { CATEGORIES, categoryOf } from "../../lib/domain/rules";
import { fmtE8, rateLine, sendSides, shortRef, whenText } from "../../lib/send/convert";
import type { MoneyRow, PlanRow } from "../../lib/send/history";
import { planRules } from "../../lib/spend/hooks";
import { budgetInfo, fmtClock, ruleLine, sharesFor } from "../../lib/spend/logic";
import { personFor, type PlanCardVM } from "../../lib/state/data";
import { useColors } from "../../theme/ThemeProvider";
import { fonts } from "../../theme/tokens";
import { Icon } from "../Icon";
import { Avatar, Banner, Bar, Btn, Btns, Card, EmojiTile, Proof, Row } from "../kit";
import { useLocal } from "../money";
import { PanelHead } from "../shell/desk";
import { Stub } from "../Stub";
import { Txt } from "../Text";
import { useMoneyRowView, usePlanRowView } from "./rows";

export type Need =
  | { kind: "spend"; id: string; plan: PlanCardVM; spend: SpendRow; detail: PlanDetail }
  | { kind: "rules"; id: string; plan: PlanCardVM; ruleId: string; proposer?: string; expiresAt: number }
  | { kind: "debt"; id: string; plan: PlanCardVM };

const lc = (s?: string | null) => (s ?? "").toLowerCase();

export function timeLeft(sec: number): string {
  const d = sec - Date.now() / 1000;
  if (d <= 0) return "ending now";
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))} min left`;
  if (d < 86400 * 2) return `${Math.floor(d / 3600)} h left`;
  return `${Math.floor(d / 86400)} days left`;
}

export function spendWhat(spend: SpendRow, detail: PlanDetail, me?: string): string {
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

/** Who said OK so far, as words. */
function okLine(spend: SpendRow, me?: string): string {
  const okBy = (spend.votes ?? []).filter((v) => v.approve && lc(v.account_id) !== lc(spend.proposer_id)).map((v) => personFor(v.account_id, { me }).name);
  return okBy.length ? `${okBy.join(", ")} said OK` : `${spend.approvals} of ${spend.approvalsRequired} OKs`;
}

/** A "Needs you" card in the laptop grid (117): picked ones get an ink outline. */
export function NeedTile({ n, me, selected, onOpen }: { n: Need; me?: string; selected: boolean; onOpen: () => void }) {
  const c = useColors();
  let left: React.ReactNode;
  let title = "";
  let sub = "";
  let action = "Open in the panel";
  if (n.kind === "spend") {
    const who = personFor(n.spend.proposer_id, { me });
    left = <Avatar initial={who.initial} color={who.color} size={40} flag={who.flag} />;
    title = `${who.name} wants ${formatUsdShort(BigInt(n.spend.amount))} for ${spendWhat(n.spend, n.detail, me)}`;
    sub = [n.plan.meta.name, okLine(n.spend, me), timeLeft(Number(n.spend.expiresAt))].join(" · ");
  } else if (n.kind === "rules") {
    const who = n.proposer ? personFor(n.proposer, { me }) : undefined;
    left = who ? <Avatar initial={who.initial} color={who.color} size={40} flag={who.flag} /> : <EmojiTile emoji={n.plan.meta.emoji} color={n.plan.meta.color} size={40} />;
    title = who ? `${who.name} suggests a rule change` : "A rule change needs your vote";
    sub = [n.plan.meta.name, n.expiresAt ? timeLeft(n.expiresAt) : ""].filter(Boolean).join(" · ");
    action = "Vote";
  } else {
    left = <EmojiTile emoji={n.plan.meta.emoji} color={n.plan.meta.color} size={40} />;
    title = `You owe ${formatUsdShort(n.plan.myDebt)}`;
    sub = `${n.plan.meta.name} is settled · pay to finish`;
    action = "Pay now";
  }
  const testID = n.kind === "spend" ? `need-spend-${n.spend.spendId}` : n.kind === "rules" ? `need-rules-${n.ruleId}` : `need-debt-${n.plan.pot.slice(2, 8)}`;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      testID={testID}
      style={{ flex: 1, backgroundColor: c.surface, borderRadius: 14, borderWidth: selected ? 2 : 1, borderColor: selected ? c.ink : c.line, padding: selected ? 15 : 16, minHeight: 112 }}
    >
      <Row align="flex-start">
        {left}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="lt">{title}</Txt>
          <Txt v="t13" color="muted">
            {sub}
          </Txt>
        </View>
      </Row>
      <View style={{ flex: 1, minHeight: 8 }} />
      <Row gap={4}>
        <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 14, color: n.kind === "spend" ? c.info : c.ink }}>{action}</Txt>
        <Icon name="chev" size={16} strokeWidth={2.2} color={n.kind === "spend" ? c.info : c.ink} />
      </Row>
    </Pressable>
  );
}

function KVs({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <View style={{ gap: 8 }}>
      {rows.map(([k, v]) => (
        <Row key={k} between align="flex-start" gap={12}>
          <Txt v="t13" color="muted">
            {k}
          </Txt>
          {typeof v === "string" ? (
            <Txt v="t13" weight="bold" style={{ flexShrink: 1, textAlign: "right" }}>
              {v}
            </Txt>
          ) : (
            v
          )}
        </Row>
      ))}
    </View>
  );
}

/** 111 in the panel: the request, the rule, the votes, Approve / Reject. */
export function SpendNeedPanel({ n, me, onVote, voting }: { n: Extract<Need, { kind: "spend" }>; me?: string; onVote: (approve: boolean) => void; voting: string | null }) {
  const c = useColors();
  const local = useLocal();
  const s = n.spend;
  const amount = BigInt(s.amount);
  const who = personFor(s.proposer_id, { me });
  const what = spendWhat(s, n.detail, me);
  const members = (s.splitMembers ?? []).map(lc);
  const weights = (s.splitWeights ?? []).map((w) => Number(w));
  const parts = sharesFor(amount, weights);
  const myIdx = me ? members.indexOf(lc(me)) : -1;
  const myShare = myIdx >= 0 ? parts[myIdx] : null;
  const active = n.detail.members.filter((m) => m.status === "Active").map((m) => lc(m.address));
  const everyone = members.length > 0 && members.length === active.length && active.every((a) => members.includes(a));
  const each = weights.length && weights.every((w) => w === weights[0]) ? parts[0] : null;
  const rules = planRules(n.detail);
  const budget = budgetInfo(rules.categoryBudgets[s.category] ?? 0n, n.detail.categorySpends.find((x) => x.category === s.category));
  const cat = categoryOf(s.category);
  const votes = s.votes ?? [];
  const yes = votes.filter((v) => v.approve && lc(v.account_id) !== lc(s.proposer_id));
  const mine = s.approvals + 1;
  const proposedAt = s.proposedAt ?? 0;
  const sub = [local.fmt(amount), myShare !== null ? `your share ${local.fmt(myShare) ?? formatUsd(myShare)}` : null].filter(Boolean).join(" · ");
  const voters = active.length ? active : members;
  const status = (a: string) => {
    if (a === lc(s.proposer_id)) return <Txt v="t13" color="muted">Asked · counts as yes</Txt>;
    const v = votes.find((x) => lc(x.account_id) === a);
    if (!v)
      return (
        <Txt v="t13" color="muted">
          Not yet
        </Txt>
      );
    return v.approve ? (
      <Row gap={4}>
        <Icon name="check" size={15} strokeWidth={2.6} color={c.pos} />
        <Txt v="t13" color="pos" weight="bold">
          {`OK${v.timestamp ? ` · ${fmtClock(v.timestamp)}` : ""}`}
        </Txt>
      </Row>
    ) : (
      <Txt v="t13" color="neg" weight="bold">
        Said no
      </Txt>
    );
  };
  return (
    <View style={{ flex: 1 }} testID={`panel-need-${s.spendId}`}>
      <PanelHead over="Needs your OK" />
      <Row style={{ marginTop: -4 }}>
        <Avatar initial={who.initial} color={who.color} size={44} flag={who.flag} />
        <View style={{ flex: 1 }}>
          <Txt v="lt">
            {who.name} · {n.plan.meta.name}
          </Txt>
          <Txt v="t13" color="muted">
            {[proposedAt ? `Asked at ${fmtClock(proposedAt)}` : null, timeLeft(Number(s.expiresAt))].filter(Boolean).join(" · ")}
          </Txt>
        </View>
      </Row>
      <Txt v="d28" style={{ marginTop: 16 }}>
        {who.name} wants {formatUsdShort(amount)} for {what}
      </Txt>
      {sub ? (
        <Txt v="t17" color="muted" style={{ marginTop: 4 }}>
          {sub}
        </Txt>
      ) : null}
      <View style={{ marginTop: 16, gap: 8 }}>
        <KVs
          rows={[
            ["Category", `${cat.emoji} ${cat.name}`],
            ["Split", everyone ? `Everyone${each !== null ? ` · ${formatUsd(each)} each` : ""}` : `${members.length} people${each !== null ? ` · ${formatUsd(each)} each` : ""}`],
            ...(budget ? ([["Budget after this", `${formatUsdShort(budget.spent + amount)} of ${formatUsdShort(budget.budget)}`]] as [string, string][]) : []),
          ]}
        />
        {budget ? <Bar pct={Number(((budget.spent + amount) * 100n) / (budget.budget || 1n))} over={budget.spent + amount > budget.budget} /> : null}
        <KVs rows={[["Rule", ruleLine(rules, amount, s.approvalsRequired)]]} />
      </View>
      {yes.length ? (
        <View style={{ marginTop: 14 }}>
          <Banner
            kind="pos"
            icon="check"
            title={`${yes.map((v) => personFor(v.account_id, { me }).name).join(", ")} said OK`}
            text={mine >= s.approvalsRequired ? `Yours makes ${mine} of ${s.approvalsRequired}, so it's paid straight away.` : `Yours makes ${mine} of ${s.approvalsRequired}.`}
          />
        </View>
      ) : null}
      <Row between style={{ marginTop: 16, marginBottom: 6 }}>
        <Txt v="ov" color="muted">
          {`Votes · needs ${s.approvalsRequired} of ${voters.length}`}
        </Txt>
        <Row gap={4}>
          {Array.from({ length: Math.max(voters.length, s.approvalsRequired) }, (_, i) => (
            <View key={i} style={{ width: 26, height: 5, borderRadius: 3, backgroundColor: i < s.approvals ? c.pos : c.surface2 }} />
          ))}
        </Row>
      </Row>
      {voters.map((a) => {
        const p = personFor(a, { me });
        return (
          <Row key={a} between style={{ minHeight: 34 }}>
            <Row gap={10}>
              <Avatar initial={p.initial} color={p.color} size={26} />
              <Txt v="t15">{p.me ? "You" : p.name}</Txt>
            </Row>
            {status(a)}
          </Row>
        );
      })}
      <View style={{ flex: 1, minHeight: 16 }} />
      <Btns>
        <Btn label="Reject" kind="dngo" loading={voting === `${n.id}:0`} disabled={!!voting} onPress={() => onVote(false)} testID={`btn-reject-${s.spendId}`} />
        <Btn label="Approve" icon="key" loading={voting === `${n.id}:1`} disabled={!!voting} onPress={() => onVote(true)} testID={`btn-approve-${s.spendId}`} />
      </Btns>
      <Btn
        label="Open the full request"
        kind="txt"
        sm
        onPress={() => router.push({ pathname: "/plan/[pot]/approve/[id]", params: { pot: n.plan.pot, id: s.spendId } })}
        testID={`btn-review-${s.spendId}`}
        style={{ alignSelf: "center", marginTop: 4 }}
      />
    </View>
  );
}

/** A rule change or a debt: what it is and the one thing to do. */
export function OtherNeedPanel({ n, me }: { n: Exclude<Need, { kind: "spend" }>; me?: string }) {
  const who = n.kind === "rules" && n.proposer ? personFor(n.proposer, { me }) : undefined;
  return (
    <View style={{ flex: 1 }} testID={`panel-need-${n.kind}`}>
      <PanelHead over={n.kind === "rules" ? "Needs your vote" : "Needs paying"} />
      <Row>
        <EmojiTile emoji={n.plan.meta.emoji} color={n.plan.meta.color} size={44} />
        <Txt v="lt" style={{ flex: 1 }}>
          {n.plan.meta.name}
        </Txt>
      </Row>
      <Txt v="d28" style={{ marginTop: 16 }}>
        {n.kind === "rules" ? (who ? `${who.name} suggests a rule change` : "A rule change needs your vote") : `You owe ${formatUsdShort(n.plan.myDebt)}`}
      </Txt>
      <Txt v="t15" color="muted" style={{ marginTop: 6 }}>
        {n.kind === "rules"
          ? `Rules change only when enough of the plan agree.${n.expiresAt ? ` Voting ends in ${timeLeft(n.expiresAt).replace(" left", "")}.` : ""}`
          : `${n.plan.meta.name} is settled. Pay what you owe to finish it for everyone.`}
      </Txt>
      <View style={{ flex: 1, minHeight: 16 }} />
      {n.kind === "rules" ? (
        <Btn label="Vote" onPress={() => router.push({ pathname: "/plan/[pot]/rules-change", params: { pot: n.plan.pot, id: n.ruleId } })} testID={`btn-vote-rules-${n.ruleId}`} />
      ) : (
        <Btn label="Pay now" onPress={() => router.push({ pathname: "/plan/[pot]/debt", params: { pot: n.plan.pot } })} testID={`btn-pay-debt-${n.plan.pot.slice(2, 8)}`} />
      )}
    </View>
  );
}

/** A money row's receipt in the panel (47/49 content). */
export function MoneyPanel({ r, me, plans }: { r: MoneyRow; me?: string; plans: Map<string, PlanCardVM> }) {
  const v = useMoneyRowView(r, me, plans);
  const fxFrom = useLocal(r.send?.fromCurrency || "USD");
  const fxTo = useLocal(r.send?.toCurrency || "USD");
  const abs = r.usd < 0n ? -r.usd : r.usd;
  const lines: [string, React.ReactNode][] = [];
  let big = formatUsd(r.usd, { sign: true });
  let over = "Plans · money";
  if (r.send) {
    const from = r.send.fromCurrency || "USD";
    const to = r.send.toCurrency || "USD";
    const rate = BigInt(r.send.fxRateE8 || "0");
    const sides = sendSides({ usdUnits: abs, from, to, rateE8: rate, usdToFrom: fxFrom.rateE8, usdToTo: fxTo.rateE8 });
    const a = sides.fromE8 !== null ? fmtE8(sides.fromE8, from) : formatUsd(abs);
    const b = sides.toE8 !== null ? fmtE8(sides.toE8, to) : formatUsd(abs);
    big = a === b ? a : `${a} › ${b}`;
    over = r.kind === "sendOut" ? "Plans · sent" : "Plans · received";
    const fromP = personFor(r.send.from_id, { me });
    const toP = personFor(r.send.to_id, { me });
    lines.push(["From", `${fromP.me ? "You" : fromP.name}${fromP.city ? ` · ${fromP.city}` : ""} ${fromP.flag ?? ""}`.trim()]);
    lines.push(["To", `${toP.me ? "You" : toP.name}${toP.city ? ` · ${toP.city}` : ""} ${toP.flag ?? ""}`.trim()]);
    if (from !== to && rate > 0n) lines.push(["", rateLine(from, to, rate, Number(r.send.fxTimestamp) || undefined)]);
    lines.push(["Fee", "$0.00"]);
  } else if (v.loc) {
    lines.push(["In your money", v.loc]);
  }
  lines.push(["When", whenText(r.at * 1000)]);
  const open =
    r.kind === "sendOut"
      ? { label: "Open the receipt", go: () => router.push({ pathname: "/send/sent", params: { tx: r.tx } }) }
      : r.kind === "sendIn"
        ? { label: "Open", go: () => router.push({ pathname: "/received", params: { tx: r.tx, from: r.counterparty ?? "", amount: abs.toString() } }) }
        : v.onPress
          ? { label: v.plan ? `Open ${v.plan.meta.name}` : "Open", go: v.onPress }
          : null;
  return (
    <View style={{ flex: 1 }} testID={`panel-money-${r.tx.slice(2, 8)}`}>
      <PanelHead over={r.usd > 0n ? "Money in" : "Money out"} />
      <Txt v="d22" style={{ marginBottom: 14 }}>
        {v.title}
      </Txt>
      <Stub
        testID="panel-receipt"
        head={
          <>
            <Row between>
              <Txt v="ov" color="muted">
                {over}
              </Txt>
              <Txt v="mono13" color="muted">
                {shortRef(r.tx)}
              </Txt>
            </Row>
            <Txt v="d34" tnum style={{ marginTop: 8 }} color={r.usd > 0n ? "pos" : "ink"}>
              {big}
            </Txt>
          </>
        }
        lines={lines}
        foot={
          <>
            <View />
            <Proof hash={r.tx} />
          </>
        }
      />
      <View style={{ flex: 1, minHeight: 16 }} />
      {open ? <Btn label={open.label} kind="sec" onPress={open.go} testID="btn-panel-open" /> : null}
    </View>
  );
}

/** A plan event in the panel: what happened and a way into the plan. */
export function PlanEventPanel({ r, me, plans }: { r: PlanRow; me?: string; plans: Map<string, PlanCardVM> }) {
  const v = usePlanRowView(r, me, plans);
  return (
    <View style={{ flex: 1 }} testID={`panel-plan-${r.id.slice(-6)}`}>
      <PanelHead over="In your plan" />
      <Row>
        {v.plan ? <EmojiTile emoji={v.plan.meta.emoji} color={v.plan.meta.color} size={44} /> : v.left}
        <Txt v="lt" style={{ flex: 1 }}>
          {v.planName}
        </Txt>
      </Row>
      <Txt v="d28" style={{ marginTop: 16 }}>
        {v.title}
      </Txt>
      <Card tint style={{ marginTop: 16 }}>
        <KVs
          rows={[
            ...(r.usd !== undefined ? ([["Amount", [formatUsd(r.usd), v.loc].filter(Boolean).join(" · ")]] as [string, string][]) : []),
            ["When", whenText(r.at * 1000)],
            ["Proof", <Proof key="p" hash={r.tx} />],
          ]}
        />
      </Card>
      <View style={{ flex: 1, minHeight: 16 }} />
      <Btn label={r.kind === "DebtRecorded" ? "Pay now" : `Open ${v.planName}`} kind={r.kind === "DebtRecorded" ? "pri" : "sec"} onPress={v.onPress} testID="btn-panel-open" />
    </View>
  );
}
