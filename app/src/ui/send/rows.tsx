/** History rows for the balance screen (09) and Activity (52). */
import { router } from "expo-router";
import React, { useMemo } from "react";
import { View } from "react-native";
import { formatUsd, formatUsdShort } from "../../lib/domain/currency";
import { sendSides, fmtE8, rowTime, whenText, daysLeft } from "../../lib/send/convert";
import type { MoneyRow, PlanRow } from "../../lib/send/history";
import { personFor, useMyPlans, type PlanCardVM } from "../../lib/state/data";
import { Avatar, Btn, EmojiTile, ListItem, Tile } from "../kit";
import { useColors } from "../../theme/ThemeProvider";
import { useLocal } from "../money";
import { Txt } from "../Text";

export function usePlanIndex(): Map<string, PlanCardVM> {
  const plans = useMyPlans();
  return useMemo(() => new Map((plans.data ?? []).map((p) => [p.pot.toLowerCase(), p])), [plans.data]);
}

const nameOf = (p: { name: string }) => p.name;

function sendTitles(r: MoneyRow, usdToFrom?: bigint) {
  const s = r.send!;
  const from = s.fromCurrency || "USD";
  const to = s.toCurrency || "USD";
  const sides = sendSides({ usdUnits: r.usd < 0n ? -r.usd : r.usd, from, to, rateE8: BigInt(s.fxRateE8 || "0"), usdToFrom });
  const fromText = sides.fromE8 !== null ? fmtE8(sides.fromE8, from) : formatUsd(r.usd < 0n ? -r.usd : r.usd);
  const toText = sides.toE8 !== null ? fmtE8(sides.toE8, to) : formatUsd(r.usd < 0n ? -r.usd : r.usd);
  return { fromText, toText };
}

/** What a money row says (title, sub, icon, amount, where it opens). Shared by the row and the laptop detail panel. */
export function useMoneyRowView(r: MoneyRow, me: string | undefined, plans: Map<string, PlanCardVM>, variant: "balance" | "activity" = "activity") {
  const local = useLocal();
  const fxFrom = useLocal(r.send?.fromCurrency || "USD");
  const abs = r.usd < 0n ? -r.usd : r.usd;
  const amount = formatUsd(r.usd, { sign: true });
  const loc = local.fmt(r.usd, { sign: true });
  const when = variant === "balance" ? whenText(r.at * 1000).slice(0, -3) : rowTime(r.at);
  const plan = r.pot ? plans.get(r.pot) : undefined;
  const planName = plan ? `${plan.meta.name}` : "your plan";
  const who = r.counterparty ? personFor(r.counterparty, { me }) : undefined;
  const whoName = who ? nameOf(who) : "Someone";
  const pos = r.usd > 0n;
  let title = "";
  let sub = when;
  let left: React.ReactNode = <Tile icon={pos ? "in" : "out"} kind={pos ? "p" : undefined} />;
  let onPress: (() => void) | undefined;
  switch (r.kind) {
    case "sendIn": {
      const t = sendTitles(r, fxFrom.rateE8);
      title = variant === "balance" ? `From ${whoName}${who?.city ? ` · ${who.city}` : ""}` : `${whoName} sent you ${t.fromText}`;
      if (variant === "activity") sub = `You got ${formatUsd(abs)} · ${when}`;
      if (variant === "activity" && who) left = <Avatar initial={who.initial} color={who.color} size={40} flag={who.flag} />;
      onPress = () => router.push({ pathname: "/received", params: { tx: r.tx, from: r.counterparty ?? "", amount: abs.toString() } });
      break;
    }
    case "sendOut": {
      const t = sendTitles(r, fxFrom.rateE8);
      title = variant === "balance" ? `To ${whoName}${who?.city ? ` · ${who.city}` : ""}` : `You sent ${t.fromText} to ${whoName}`;
      if (variant === "activity") sub = `${whoName} got ${t.toText} · ${when}`;
      onPress = () => router.push({ pathname: "/send/sent", params: { tx: r.tx } });
      break;
    }
    case "claimIn": {
      const fromPlan = r.counterparty ? plans.get(r.counterparty) : undefined;
      title = variant === "balance" ? "Added money" : fromPlan ? `Money from ${fromPlan.meta.name}` : who && who.name !== "Friend" ? `Claimed a link from ${whoName}` : "Claimed a link";
      if (variant === "balance") sub = `${when}`;
      break;
    }
    case "linkOut": {
      const c = r.claim!;
      const expired = c.status === "Open" && !!c.expiry && daysLeft(Number(c.expiry)) === 0;
      const status =
        c.status === "Claimed"
          ? c.recipient_id
            ? `claimed by ${nameOf(personFor(c.recipient_id, { me }))}`
            : "claimed"
          : c.status === "Refunded"
            ? "came back to you"
            : expired
              ? "ran out · not claimed"
              : "not claimed yet";
      title = `Link sent · ${status}`;
      left = <Tile icon="link" />;
      break;
    }
    case "linkBack":
      title = "Link money came back";
      left = <Tile icon="link" kind="p" />;
      break;
    case "payout":
      title = variant === "balance" ? `From ${planName} settle-up` : `${planName} paid you at settle-up`;
      if (plan) onPress = () => router.push({ pathname: "/plan/[pot]", params: { pot: plan.pot } });
      break;
    case "contributed":
      title = variant === "balance" ? `To ${planName} pot` : `You added ${formatUsdShort(abs)} to ${planName}`;
      if (plan && variant === "activity") left = <EmojiTile emoji={plan.meta.emoji} color={plan.meta.color} size={40} />;
      if (plan) onPress = () => router.push({ pathname: "/plan/[pot]", params: { pot: plan.pot } });
      break;
    case "debtPaid":
      title = `Paid what you owed · ${planName}`;
      if (plan) onPress = () => router.push({ pathname: "/plan/[pot]", params: { pot: plan.pot } });
      break;
  }
  return { title, sub, left, onPress, amount, loc, pos, who, plan, expired: r.kind === "linkOut" && r.claim!.status === "Open" && !!r.claim!.expiry && daysLeft(Number(r.claim!.expiry)) === 0 };
}

/** The ink outline of the row open in the laptop panel (117). */
function Picked({ on, children }: { on: boolean; children: React.ReactNode }) {
  const c = useColors();
  return <View style={on ? { borderWidth: 1.5, borderColor: c.ink, borderRadius: 12, marginHorizontal: -10, paddingHorizontal: 10 } : null}>{children}</View>;
}

/** One money row. `variant` "balance" uses the short labels of screen 09. On a laptop `onSelect` opens it in the panel instead. */
export function MoneyRowItem({ r, me, plans, variant = "activity", onRefund, refunding, last, onSelect, selected }: { r: MoneyRow; me?: string; plans: Map<string, PlanCardVM>; variant?: "balance" | "activity"; onRefund?: (r: MoneyRow) => void; refunding?: boolean; last?: boolean; onSelect?: () => void; selected?: boolean }) {
  const { title, sub, left, onPress, amount, loc, pos, expired } = useMoneyRowView(r, me, plans, variant);
  const extra =
    expired && onRefund ? <Btn label="Get it back" kind="sec" sm onPress={() => onRefund(r)} loading={refunding} testID={`btn-get-it-back-${r.claim!.claimId}`} style={{ marginTop: 6 }} /> : null;
  return (
    <Picked on={!!selected}>
      <ListItem
        left={left}
        title={title}
        sub={sub}
        right={
          <Txt v="lt" color={pos ? "pos" : "ink"} tnum>
            {amount}
          </Txt>
        }
        rsub={loc && loc !== amount ? loc : undefined}
        onPress={onSelect ?? onPress}
        testID={`row-${r.kind}-${r.tx.slice(2, 8)}`}
        last={(last && !extra) || selected}
      />
      {extra ? <View style={{ alignItems: "flex-end", marginTop: -6, marginBottom: 8 }}>{extra}</View> : null}
    </Picked>
  );
}

/** What a plan event row says. Shared by the row and the laptop detail panel. */
export function usePlanRowView(r: PlanRow, me: string | undefined, plans: Map<string, PlanCardVM>) {
  const local = useLocal();
  const plan = plans.get(r.pot);
  const planName = plan?.meta.name ?? "A plan";
  const who = r.who ? personFor(r.who, { me }) : undefined;
  const whoName = who ? (who.me ? "You" : who.name) : "Someone";
  const amt = r.usd !== undefined ? formatUsdShort(r.usd) : "";
  const loc = r.usd !== undefined ? local.fmt(r.usd) : undefined;
  let title = "";
  let sub = `${plan ? `${plan.meta.emoji} ${planName}` : planName}`;
  let left: React.ReactNode = who ? <Avatar initial={who.initial} color={who.color} size={40} /> : plan ? <EmojiTile emoji={plan.meta.emoji} color={plan.meta.color} size={40} /> : <Tile icon="ticket" />;
  let onPress = () => router.push({ pathname: "/plan/[pot]", params: { pot: r.pot } });
  let negSub = false;
  switch (r.kind) {
    case "SpendExecuted":
      title = `${whoName} paid ${amt} · ${planName}`;
      sub = loc ? `${loc}` : sub;
      break;
    case "Contributed":
      title = `${whoName} added ${amt} to ${planName}`;
      sub = loc ? `${loc}` : sub;
      break;
    case "MemberJoined":
      title = `${whoName} joined ${planName}`;
      break;
    case "Settled":
      title = `${planName} is settled`;
      left = plan ? <EmojiTile emoji={plan.meta.emoji} color={plan.meta.color} size={40} /> : <Tile icon="check" kind="p" />;
      sub = "Everyone has been paid";
      break;
    case "DebtRecorded":
      title = `${planName} is settled`;
      sub = `You owe ${loc ?? amt} · Pay now`;
      negSub = true;
      left = plan ? <EmojiTile emoji={plan.meta.emoji} color={plan.meta.color} size={40} /> : <Tile icon="alert" kind="n" />;
      onPress = () => router.push({ pathname: "/plan/[pot]/debt", params: { pot: r.pot } });
      break;
  }
  return { title, sub, left, onPress, negSub, plan, planName, who, amt, loc };
}

/** One plan event row (Activity). On a laptop `onSelect` opens it in the panel instead. */
export function PlanRowItem({ r, me, plans, last, onSelect, selected }: { r: PlanRow; me?: string; plans: Map<string, PlanCardVM>; last?: boolean; onSelect?: () => void; selected?: boolean }) {
  const { title, sub, left, onPress, negSub } = usePlanRowView(r, me, plans);
  return (
    <Picked on={!!selected}>
      <ListItem
        left={left}
        title={title}
        sub={
          <Txt v="t13" color={negSub ? "neg" : "muted"} weight={negSub ? "bold" : undefined}>
            {sub}
          </Txt>
        }
        right={
          <Txt v="t13" color="muted">
            {rowTime(r.at)}
          </Txt>
        }
        onPress={onSelect ?? onPress}
        testID={`row-${r.kind.toLowerCase()}-${r.id.slice(-6)}`}
        last={last || selected}
      />
    </Picked>
  );
}
