/**
 * Laptop pieces of the spend form (design 110): the amount typed on the keyboard with the other
 * currency beside it, the "Who shares it" cards, and the "What will happen" panel (tiers bar,
 * each check spelled out, budget bars, the summary and the confirm button).
 */
import React, { useEffect } from "react";
import { Platform, TextInput, View } from "react-native";
import { HighTier, type Rules } from "../../lib/chain/eip712";
import { currencyFor, formatUsd, formatUsdShort, usdToLocalE8 } from "../../lib/domain/currency";
import { categoryOf, UINT64_MAX } from "../../lib/domain/rules";
import { patchDraft, type SpendDraft } from "../../lib/spend/draft";
import { amountDecimals, budgetInfo, plainFixed, sanitizeAmountText, sharesFor } from "../../lib/spend/logic";
import type { PlanVM } from "../../lib/state/data";
import { useColors } from "../../theme/ThemeProvider";
import { fonts } from "../../theme/tokens";
import { Icon } from "../Icon";
import { Bar, Card, Chip, Row } from "../kit";
import { useLocal } from "../money";
import { PersonAvatar, useMoney } from "../plan/common";
import { Txt } from "../Text";
import type { Verdict } from "../spend/form";
import { draftSplit } from "../spend/form";
import { Columns } from "./plan";

/** Big amount on the left, the other currency and "Type in pounds" beside it (110). */
export function DeskAmount({ d, units, autoFocus }: { d: SpendDraft; units: bigint; autoFocus?: boolean }) {
  const c = useColors();
  useEffect(() => {
    // The big amount shows its caret like the design; the page-wide focus ring is for buttons and fields.
    if (Platform.OS !== "web" || typeof document === "undefined" || document.getElementById("plans-amount-css")) return;
    const st = document.createElement("style");
    st.id = "plans-amount-css";
    st.textContent = 'input[data-testid="amount-display"]:focus-visible{outline:none !important}';
    document.head.appendChild(st);
  }, []);
  const local = useLocal();
  const m = useMoney();
  const cur = currencyFor(local.currency);
  const canSwap = local.currency !== "USD" && !!local.rateE8;
  const inLocal = d.inLocal && local.currency !== "USD";
  const symbol = inLocal ? cur.symbol.trim() : "$";
  const other = inLocal ? (units > 0n ? formatUsd(units) : "$0.00") : local.currency !== "USD" ? m.local(units) : undefined;
  const swap = () => {
    if (!local.rateE8) return;
    if (inLocal) patchDraft({ inLocal: false, amountText: plainFixed(units, 6, 2) });
    else patchDraft({ inLocal: true, amountText: plainFixed(usdToLocalE8(units, local.rateE8), 8, cur.decimals) });
  };
  return (
    <View style={{ marginTop: 20 }}>
      <Txt v="ov" color="muted">
        Amount
      </Txt>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 20, marginTop: 4 }}>
        <Row gap={2}>
          <Txt v="d56" color={d.amountText ? "ink" : "muted"}>
            {symbol}
          </Txt>
          <TextInput
            testID="amount-display"
            accessibilityLabel="Amount"
            value={d.amountText}
            placeholder="0"
            placeholderTextColor={c.muted}
            onChangeText={(t) => patchDraft({ amountText: sanitizeAmountText(t, amountDecimals(inLocal, local.currency)) })}
            inputMode="decimal"
            autoFocus={autoFocus}
            selectionColor={c.accent}
            maxLength={14}
            style={{ fontFamily: fonts.display, fontSize: 56, letterSpacing: -2.5, color: c.ink, padding: 0, margin: 0, width: Math.max(60, (d.amountText.length || 1) * 34 + 8), outlineStyle: "none" } as never}
          />
        </Row>
        <View style={{ paddingBottom: 8, gap: 4 }}>
          {other ? (
            <Txt v="t17" color="muted" weight="medium" testID="amount-other">
              {other}
            </Txt>
          ) : null}
          {canSwap ? <Chip sm ol icon="swap" label={inLocal ? "Type in dollars" : `Type in ${cur.plural}`} onPress={swap} testID="btn-swap-currency" /> : null}
        </View>
      </View>
    </View>
  );
}

/** A typed amount for laptops (no on-screen keypad): the currency symbol and a big input (18 Add money). */
export function DeskAmountInput({ value, onChange, symbol, decimals, testID, autoFocus = true }: { value: string; onChange: (v: string) => void; symbol: string; decimals: number; testID: string; autoFocus?: boolean }) {
  const c = useColors();
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const id = `plans-amount-css-${testID}`;
    if (document.getElementById(id)) return;
    const st = document.createElement("style");
    st.id = id;
    st.textContent = `input[data-testid="${testID}"]:focus-visible{outline:none !important}`;
    document.head.appendChild(st);
  }, [testID]);
  return (
    <Row gap={2} style={{ justifyContent: "center" }}>
      <Txt v="d56" color={value ? "ink" : "muted"}>
        {symbol}
      </Txt>
      <TextInput
        testID={testID}
        accessibilityLabel="Amount"
        value={value}
        placeholder="0"
        placeholderTextColor={c.muted}
        onChangeText={(t) => onChange(sanitizeAmountText(t, decimals).replace(/^(\d{7})\d+/, "$1"))}
        inputMode="decimal"
        autoFocus={autoFocus}
        selectionColor={c.accent}
        maxLength={12}
        style={{ fontFamily: fonts.display, fontSize: 56, letterSpacing: -2.5, color: c.ink, padding: 0, margin: 0, width: Math.max(44, (value.length || 1) * 34 + 8), outlineStyle: "none" } as never}
      />
    </Row>
  );
}

/** "Who shares it": one card per person with their share in their own money (110). */
export function ShareCards({ plan, d, units }: { plan: PlanVM; d: SpendDraft; units: bigint }) {
  const m = useMoney();
  const split = draftSplit(plan, d);
  const parts = sharesFor(units, split.weights);
  const people = split.members.map((a, i) => ({ p: plan.people[a], amount: parts[i] ?? 0n })).filter((x) => !!x.p);
  if (!people.length) return null;
  return (
    <View style={{ marginTop: 20 }}>
      <Txt v="ov" color="muted">
        Who shares it
      </Txt>
      <Columns
        items={people}
        cols={3}
        gap={12}
        style={{ marginTop: 8 }}
        render={({ p, amount }) => (
          <Card p={12} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <PersonAvatar p={p} size={32} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt v="lt" numberOfLines={1}>
                {p.name}
                {p.me ? " (you)" : ""}
              </Txt>
              <Txt v="t13" color="muted" numberOfLines={1}>
                {units > 0n ? (p.me && m.local(amount) ? `${formatUsd(amount)} · ${m.local(amount)}` : formatUsd(amount)) : "—"}
              </Txt>
            </View>
          </Card>
        )}
      />
    </View>
  );
}

/** Now / 1 OK / 3 of 4 with a marker at the amount (110). */
export function TierBar({ plan, rules, units }: { plan: PlanVM; rules: Rules; units: bigint }) {
  const c = useColors();
  const n = Math.max(1, plan.raw.activeMemberCount);
  const high = rules.highTier === HighTier.ALL ? n : Math.floor(n / 2) + 1;
  const hasMid = rules.oneApprovalMax > rules.instantMax && rules.oneApprovalMax < UINT64_MAX;
  const hasNow = rules.instantMax > 0n;
  // Scale: the instant tier, the one-OK tier, and the high tier drawn at fixed proportions (design 1 : 2.2 : 1.4).
  const segs: { flex: number; label: string; bg: string; from: bigint }[] = [];
  if (hasNow) segs.push({ flex: 1, label: "Now", bg: "#BFE3CF", from: 0n });
  segs.push({ flex: 2.2, label: hasMid || rules.oneApprovalMax >= UINT64_MAX ? "1 OK" : `${high} of ${n}`, bg: "#BFD5EA", from: rules.instantMax });
  if (hasMid) segs.push({ flex: 1.4, label: `${high} of ${n}`, bg: "#F8D892", from: rules.oneApprovalMax });
  const total = segs.reduce((a, s) => a + s.flex, 0);
  // marker position
  let pos = 0;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const to = segs[i + 1]?.from;
    if (to === undefined || units <= to) {
      const span = to !== undefined ? Number(to - s.from) : Number(s.from > 0n ? s.from : 1_000_000n);
      const frac = span > 0 ? Math.min(1, Math.max(0, Number(units - s.from) / span)) : 0;
      pos = (acc + frac * s.flex) / total;
      break;
    }
    acc += s.flex;
  }
  const pct = `${Math.round(pos * 1000) / 10}%` as const;
  return (
    <View style={{ marginTop: 28 }} testID="tier-bar">
      <View>
        <View style={{ flexDirection: "row", height: 34, borderRadius: 10, overflow: "hidden" }}>
          {segs.map((s) => (
            <View key={s.label + s.flex} style={{ flex: s.flex, backgroundColor: s.bg, alignItems: "center", justifyContent: "center" }}>
              <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 12, color: "#10231B" }}>{s.label}</Txt>
            </View>
          ))}
        </View>
        {units > 0n ? (
          <>
            <View style={{ position: "absolute", left: pct, top: -6, width: 3, height: 46, marginLeft: -1, borderRadius: 2, backgroundColor: c.ink }} />
            <Txt style={{ position: "absolute", left: pct, top: -24, marginLeft: -14, fontFamily: fonts.monoSemi, fontSize: 11, color: c.ink }}>{formatUsdShort(units)}</Txt>
          </>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", marginTop: 4 }}>
        {segs.map((s) => (
          <View key={s.label + s.flex} style={{ flex: s.flex }}>
            <Txt style={{ fontFamily: fonts.mono, fontSize: 11, color: c.muted }}>{formatUsdShort(s.from)}</Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <View style={{ marginTop: 1 }}>
        <Icon name={ok ? "check" : "x"} size={18} strokeWidth={2.4} color={ok ? c.pos : c.neg} />
      </View>
      <Txt v="t15" style={{ flex: 1 }}>
        {children}
      </Txt>
    </View>
  );
}

const B = ({ children }: { children: React.ReactNode }) => <Txt style={{ fontFamily: fonts.bodyBold }}>{children}</Txt>;

/** Every rule the spend is checked against, spelled out (110). */
export function PayChecks({ plan, rules, units, category, business, verdict }: { plan: PlanVM; rules: Rules; units: bigint; category: number; business: boolean; verdict: Verdict }) {
  const m = useMoney();
  const cat = categoryOf(category);
  const budget = budgetInfo(rules.categoryBudgets[category] ?? 0n, plan.raw.categorySpends.find((x) => x.category === category));
  const balance = BigInt(plan.raw.balance);
  const midnight = Math.floor(Date.now() / 1000 / 86400) * 86400;
  const myToday = plan.raw.spends
    .filter((s) => s.status === "Executed" && s.kind !== "PERSONAL" && s.proposer_id.toLowerCase() === plan.me && (s.executedAt ?? 0) >= midnight)
    .reduce((a, s) => a + BigInt(s.amount), 0n);
  if (units <= 0n || verdict.kind === "idle") return null;
  const left = budget ? budget.remaining - units : null;
  const todayLeft = rules.memberDailyCap > 0n ? rules.memberDailyCap - myToday - units : null;
  const keeps = balance - units;
  return (
    <View style={{ gap: 8, marginTop: 16 }} testID="pay-checks">
      {budget && left !== null ? (
        <Check ok={left >= 0n}>
          {left >= 0n ? (
            <>
              {cat.name} has <B>{formatUsdShort(left)}</B> left after this
            </>
          ) : (
            <>
              {cat.name} is over its budget by <B>{formatUsdShort(-left)}</B>
            </>
          )}
        </Check>
      ) : null}
      {todayLeft !== null ? (
        <Check ok={todayLeft >= 0n}>
          {todayLeft >= 0n ? (
            <>
              You can spend <B>{formatUsdShort(todayLeft)}</B> more today
            </>
          ) : (
            <>Over your {formatUsdShort(rules.memberDailyCap)} a day</>
          )}
        </Check>
      ) : null}
      <Check ok={keeps >= 0n}>
        {keeps >= 0n ? (
          <>
            The pot keeps <B>{formatUsd(keeps)}</B>
            {m.local(keeps) ? ` · ${m.local(keeps)}` : ""}
          </>
        ) : (
          <>The pot has only {formatUsd(balance)}</>
        )}
      </Check>
      {business ? <Check ok={verdict.reason !== 5}>{verdict.reason === 5 ? "Only people in the plan can be paid" : "Businesses can be paid in this plan"}</Check> : null}
    </View>
  );
}

/** "Getting around after this" and "Your spending today" bars (110). */
export function PayBudgets({ plan, rules, units, category }: { plan: PlanVM; rules: Rules; units: bigint; category: number }) {
  const cat = categoryOf(category);
  const budget = budgetInfo(rules.categoryBudgets[category] ?? 0n, plan.raw.categorySpends.find((x) => x.category === category));
  const midnight = Math.floor(Date.now() / 1000 / 86400) * 86400;
  const myToday = plan.raw.spends
    .filter((s) => s.status === "Executed" && s.kind !== "PERSONAL" && s.proposer_id.toLowerCase() === plan.me && (s.executedAt ?? 0) >= midnight)
    .reduce((a, s) => a + BigInt(s.amount), 0n);
  const rows: { label: string; used: bigint; of: bigint }[] = [];
  if (budget) rows.push({ label: `${cat.emoji} ${cat.name} after this`, used: budget.spent + units, of: budget.budget });
  if (rules.memberDailyCap > 0n) rows.push({ label: "👤 Your spending today", used: myToday + units, of: rules.memberDailyCap });
  if (!rows.length) return null;
  return (
    <View style={{ gap: 12, marginTop: 20 }}>
      {rows.map((r) => (
        <View key={r.label}>
          <Row between>
            <Txt v="t13" weight="bold">
              {r.label}
            </Txt>
            <Txt v="t13" color={r.used > r.of ? "neg" : "muted"} tnum>
              {formatUsdShort(r.used)} of {formatUsdShort(r.of)}
            </Txt>
          </Row>
          <View style={{ marginTop: 6 }}>
            <Bar pct={Number((r.used * 1000n) / (r.of > 0n ? r.of : 1n)) / 10} color={plan.meta.color} over={r.used > r.of} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** "You pay $18.00 · £13.36 / From Lisbon pot" (110). */
export function PaySummary({ plan, units, label = "You pay", from }: { plan: PlanVM; units: bigint; label?: string; from?: string }) {
  const m = useMoney();
  return (
    <Card tint p={14} testID="pay-summary">
      <Row between>
        <Txt v="t15" color="muted">
          {label}
        </Txt>
        <Txt v="t15" weight="bold" tnum>
          {m.both(units)}
        </Txt>
      </Row>
      <Row between style={{ marginTop: 4 }}>
        <Txt v="t13" color="muted">
          From
        </Txt>
        <Txt v="t13">{from ?? `${plan.meta.name} pot`}</Txt>
      </Row>
    </Card>
  );
}
