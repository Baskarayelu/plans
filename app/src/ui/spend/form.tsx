/**
 * Spend form pieces shared by 21 (pay from the pot) and 25 (record something I paid): the big
 * amount with currency swap, split chips + names line, receipt photo, and the live rule preview.
 */
import { router } from "expo-router";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, TextInput, View } from "react-native";
import { SpendKind, type Rules } from "../../lib/chain/eip712";
import { currencyFor, formatUsd, formatUsdShort, usdToLocalE8 } from "../../lib/domain/currency";
import { BLOCK_REASONS, categoryOf } from "../../lib/domain/rules";
import { patchDraft, type SpendDraft, type SpendPhoto } from "../../lib/spend/draft";
import { activeMembers, type PreviewState } from "../../lib/spend/hooks";
import { amountDecimals, amountUnits, budgetInfo, eachAmount, fmtClock, joinNames, orderedSplit, plainFixed, ruleLine, sanitizeAmountText, sharesFor, tierSentence } from "../../lib/spend/logic";
import type { PlanVM } from "../../lib/state/data";
import { useColors } from "../../theme/ThemeProvider";
import { fonts } from "../../theme/tokens";
import { Icon } from "../Icon";
import { Banner, Btn, Chip, IconBtn, Overline, Row } from "../kit";
import { Sheet } from "../layout";
import { useLocal } from "../money";
import { People, useMoney } from "../plan/common";
import { Txt } from "../Text";

const lc = (s: string) => s.toLowerCase();

// ─────────────── amount ───────────────

/** Keeps draft.units in step with the typed text and the reference rate. */
export function useDraftUnits(d: SpendDraft): bigint {
  const local = useLocal();
  const units = amountUnits(d.amountText, d.inLocal, local.currency, local.rateE8) ?? 0n;
  useEffect(() => {
    if (units !== d.units) patchDraft({ units });
  }, [units, d.units]);
  return units;
}

/** Big amount (design .d56) typed with the number keyboard, with "Type in pounds" swap. */
export function AmountHero({ d, units, autoFocus }: { d: SpendDraft; units: bigint; autoFocus?: boolean }) {
  const c = useColors();
  const local = useLocal();
  const m = useMoney();
  const cur = currencyFor(local.currency);
  const canSwap = local.currency !== "USD" && !!local.rateE8;
  const inLocal = d.inLocal && local.currency !== "USD";
  const symbol = inLocal ? cur.symbol.trim() : "$";
  const other = inLocal ? (units > 0n ? formatUsd(units) : "$0.00") : units > 0n ? m.local(units) : local.currency !== "USD" ? m.local(0n) : undefined;
  const swap = () => {
    if (!local.rateE8) return;
    if (inLocal) patchDraft({ inLocal: false, amountText: plainFixed(units, 6, 2) });
    else patchDraft({ inLocal: true, amountText: plainFixed(usdToLocalE8(units, local.rateE8), 8, cur.decimals) });
  };
  return (
    <View style={{ alignItems: "center", marginTop: 4 }}>
      <Row gap={2} style={{ justifyContent: "center" }}>
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
          keyboardType="decimal-pad"
          autoFocus={autoFocus}
          selectionColor={c.accent}
          cursorColor={c.accent}
          maxLength={14}
          style={[
            { fontFamily: fonts.display, fontSize: 56, letterSpacing: -2.5, color: c.ink, padding: 0, margin: 0, minWidth: 40, textAlign: "left", includeFontPadding: false },
            // Browsers size an <input> to ~20 characters, which pushes the centred amount off screen: size it to the text.
            Platform.OS === "web" ? { width: Math.max(40, (d.amountText.length || 1) * 34 + 8) } : null,
          ]}
        />
      </Row>
      {other ? (
        <Txt v="t17" color="muted" weight="medium" style={{ marginTop: 4 }} testID="amount-other">
          {other}
        </Txt>
      ) : null}
      {canSwap ? (
        <View style={{ marginTop: 8 }}>
          <Chip sm ol icon="swap" label={inLocal ? "Type in dollars" : `Type in ${cur.plural}`} onPress={swap} testID="btn-swap-currency" />
        </View>
      ) : null}
    </View>
  );
}

// ─────────────── split ───────────────

export function draftSplit(plan: PlanVM, d: SpendDraft): { members: string[]; weights: number[] } {
  const active = activeMembers(plan);
  if (d.splitMode === "everyone") return orderedSplit(active, active);
  const chosen = d.chosen.filter((a) => active.includes(lc(a)));
  return orderedSplit(active, chosen, d.weights, d.splitMode === "custom");
}

/** Split chips (Everyone / Pick people / Custom) and the names line under them. */
export function SplitSection({ plan, d, units, personal }: { plan: PlanVM; d: SpendDraft; units: bigint; personal?: boolean }) {
  const m = useMoney();
  const active = activeMembers(plan);
  const split = draftSplit(plan, d);
  const people = split.members.map((a) => plan.people[a]).filter(Boolean);
  const each = eachAmount(units, split.weights);
  const parts = sharesFor(units, split.weights);
  const myIdx = plan.me ? split.members.indexOf(plan.me) : -1;
  const openEditor = (mode: "pick" | "custom") => {
    const chosen = d.splitMode === "everyone" || d.chosen.length === 0 ? active : d.chosen;
    patchDraft({ splitMode: mode, chosen });
    router.push({ pathname: "/plan/[pot]/split", params: { pot: plan.pot } });
  };
  const names = people.map((p) => (p.me ? (p.name || "You") : p.name) + (d.splitMode === "custom" && split.weights[split.members.indexOf(p.address)] > 1 ? ` ×${split.weights[split.members.indexOf(p.address)]}` : ""));
  let money: React.ReactNode = null;
  if (units > 0n && people.length) {
    if (personal) {
      const mine = myIdx >= 0 ? parts[myIdx] : 0n;
      money = (
        <>
          {each !== null ? <Txt v="t13" weight="bold">{formatUsd(each)} each</Txt> : <Txt v="t13">custom shares</Txt>}
          <Txt v="t13" color="muted">
            {" · you're owed "}
          </Txt>
          <Txt v="t13" color="pos" weight="bold">
            {formatUsd(units - mine)}
          </Txt>
          <Txt v="t13" color="muted">
            {" more"}
          </Txt>
        </>
      );
    } else {
      const shown = each ?? (myIdx >= 0 ? parts[myIdx] : null);
      money = (
        <>
          {shown !== null ? (
            <Txt v="t13" weight="bold">
              {formatUsd(shown)} {each !== null ? "each" : "your share"}
            </Txt>
          ) : (
            <Txt v="t13">custom shares</Txt>
          )}
          {shown !== null && m.local(shown) ? (
            <Txt v="t13" color="muted">
              {` · ${m.local(shown)}`}
            </Txt>
          ) : null}
        </>
      );
    }
  }
  return (
    <View>
      <Overline style={{ marginTop: 20 }}>Split</Overline>
      <Row gap={8} wrap style={{ marginTop: 8 }}>
        <Chip label={`Everyone (${active.length})`} on={d.splitMode === "everyone"} onPress={() => patchDraft({ splitMode: "everyone" })} testID="chip-split-everyone" />
        <Chip label={d.splitMode === "pick" ? `${split.members.length} ${split.members.length === 1 ? "person" : "people"}` : "Pick people"} on={d.splitMode === "pick"} onPress={() => openEditor("pick")} testID="chip-split-pick" />
        <Chip label="Custom" on={d.splitMode === "custom"} onPress={() => openEditor("custom")} testID="chip-split-custom" />
      </Row>
      <Pressable testID="split-names" accessibilityRole="button" accessibilityLabel="Change who shares this" onPress={() => openEditor(d.splitMode === "custom" ? "custom" : "pick")} style={{ marginTop: 8 }}>
        {people.length === 0 ? (
          <Txt v="t13" color="neg">
            Pick at least one person to share this.
          </Txt>
        ) : (
          <Row gap={8} align="center" wrap>
            <People people={people} size={24} />
            <Txt v="t13" color="muted" style={{ flexShrink: 1 }}>
              {d.splitMode === "everyone" ? "Everyone" : names.join(", ")}
              {money ? " · " : ""}
              {money}
            </Txt>
          </Row>
        )}
      </Pressable>
    </View>
  );
}

// ─────────────── receipt photo ───────────────

async function pickPhoto(source: "camera" | "library"): Promise<SpendPhoto | "denied" | null> {
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return "denied";
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.5, allowsEditing: false };
  const r = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const long = Math.max(a.width ?? 0, a.height ?? 0);
  const actions: ImageManipulator.Action[] = long > 1200 ? [{ resize: (a.width ?? 0) >= (a.height ?? 0) ? { width: 1200 } : { height: 1200 } }] : [];
  const out = await ImageManipulator.manipulateAsync(a.uri, actions, { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  if (!out.base64) return null;
  return { uri: out.uri, base64: out.base64, width: out.width, height: out.height };
}

export function PhotoRow({ photo, hint = "Optional" }: { photo?: SpendPhoto; hint?: string }) {
  const c = useColors();
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (source: "camera" | "library") => {
    setSheet(false);
    setErr(null);
    setBusy(true);
    try {
      const p = await pickPhoto(source);
      if (p === "denied") setErr("Camera access is off. You can turn it on in Settings, or choose a photo instead.");
      else if (p) patchDraft({ photo: p });
    } catch {
      setErr("That photo didn't work. Try another one.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ marginTop: 16 }}>
      {photo ? (
        <Row>
          <Image source={{ uri: photo.uri }} style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: c.surface2 }} />
          <View style={{ flex: 1 }}>
            <Txt v="lt">Receipt photo</Txt>
            <Txt v="t13" color="muted">
              Only the plan can see it
            </Txt>
          </View>
          <IconBtn name="x" label="Remove photo" onPress={() => patchDraft({ photo: undefined })} testID="btn-remove-photo" />
        </Row>
      ) : (
        <Pressable testID="btn-add-photo" accessibilityRole="button" accessibilityLabel="Add receipt photo" onPress={() => setSheet(true)} disabled={busy}>
          <Row>
            <View style={{ width: 48, height: 48, borderRadius: 10, borderWidth: 1.5, borderStyle: "dashed", borderColor: c.line, alignItems: "center", justifyContent: "center" }}>
              {busy ? <ActivityIndicator color={c.muted} /> : <Icon name="camera" size={22} />}
            </View>
            <View style={{ flex: 1 }}>
              <Txt v="lt">Add receipt photo</Txt>
              <Txt v="t13" color="muted">
                {hint}
              </Txt>
            </View>
          </Row>
        </Pressable>
      )}
      {err ? (
        <Txt v="t13" color="neg" style={{ marginTop: 6 }}>
          {err}
        </Txt>
      ) : null}
      <Sheet visible={sheet} onClose={() => setSheet(false)} testID="sheet-photo">
        <Txt v="d22">Receipt photo</Txt>
        <Txt v="t13" color="muted" style={{ marginTop: 6, marginBottom: 14 }}>
          It's locked so only people in the plan can see it.
        </Txt>
        <View style={{ gap: 8 }}>
          <Btn label="Take a photo" kind="sec" icon="camera" onPress={() => void go("camera")} testID="btn-take-a-photo" />
          <Btn label="Choose from photos" kind="sec" icon="image" onPress={() => void go("library")} testID="btn-choose-from-photos" />
        </View>
      </Sheet>
    </View>
  );
}

// ─────────────── rule preview ───────────────

export type Verdict = { kind: "idle" | "checking" | "error" | "now" | "ask" | "blocked"; approvals: number; reason: number };

export function verdictOf(pv: PreviewState, units: bigint, splitCount: number): Verdict {
  if (units <= 0n) return { kind: "idle", approvals: 0, reason: 0 };
  if (splitCount === 0) return { kind: "blocked", approvals: 0, reason: 10 };
  if (pv.status === "error") return { kind: "error", approvals: 0, reason: 0 };
  if (!pv.fresh || !pv.preview) return { kind: "checking", approvals: pv.preview?.approvalsRequired ?? 0, reason: 0 };
  if (!pv.preview.ok) return { kind: "blocked", approvals: 0, reason: pv.preview.reason };
  return { kind: pv.preview.approvalsRequired > 1 ? "ask" : "now", approvals: pv.preview.approvalsRequired, reason: 0 };
}

/** The banner at the bottom of the form that says what will happen (21, 22a, 22b, 22c, 25). */
export function RuleBanner({
  plan,
  rules,
  kind,
  units,
  category,
  verdict,
  onRetry,
  onPayPart,
}: {
  plan: PlanVM;
  rules: Rules;
  kind: SpendKind;
  units: bigint;
  category: number;
  verdict: Verdict;
  onRetry: () => void;
  onPayPart?: (part: bigint) => void;
}) {
  const cat = categoryOf(category);
  const budget = budgetInfo(rules.categoryBudgets[category] ?? 0n, plan.raw.categorySpends.find((x) => x.category === category));
  const personal = kind === SpendKind.PERSONAL;
  const others = activeMembers(plan)
    .filter((a) => a !== plan.me)
    .map((a) => plan.people[a]?.name ?? "Friend");
  const link = (label: string, onPress: () => void, testID: string) => (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 }}>
      <Icon name="chev" size={16} strokeWidth={2.4} />
      <Txt v="t13" weight="bold" style={{ flexShrink: 1 }}>
        {label}
      </Txt>
    </Pressable>
  );
  const v = verdict;
  if (v.kind === "idle")
    return (
      <Banner
        testID="rule-preview"
        kind="mut"
        icon="info"
        title={rules.instantMax > 0n ? `Under ${formatUsdShort(rules.instantMax)} goes through now` : "Every spend needs a friend's OK"}
        text="Type an amount and we'll check it against the plan's rules."
      />
    );
  if (v.kind === "checking") return <Banner testID="rule-preview" kind="mut" icon="clock" title="Checking the rules…" text="This takes a moment." />;
  if (v.kind === "error")
    return (
      <Banner testID="rule-preview" kind="mut" icon="wifioff" title="Couldn't check the rules" text="Nothing has been sent.">
        {link("Try again", onRetry, "btn-retry-preview")}
      </Banner>
    );
  if (v.kind === "now") {
    const left = budget ? budget.remaining - units : null;
    const head = ruleLine(rules, units, 1);
    const tail = budget && left !== null && left >= 0n ? `, and ${cat.name} has ${formatUsd(left)} left after this.` : ".";
    return <Banner testID="rule-preview" kind="pos" icon="zap" title={personal ? "Goes on the plan now" : "Goes through now"} text={`${head}${tail}`} />;
  }
  if (v.kind === "ask") {
    const n = v.approvals - 1;
    const asks = joinNames(others);
    return (
      <Banner
        testID="rule-preview"
        kind="inf"
        icon="users"
        title={`Needs ${n} more approval${n === 1 ? "" : "s"}`}
        text={`${tierSentence(rules, units, v.approvals)} We'll ask ${asks || "the group"}. It's ${personal ? "recorded" : "paid"} the moment ${n === 1 ? "one says yes" : `${n} say yes`}.`}
      />
    );
  }
  // blocked
  switch (v.reason) {
    case 3: {
      const f = plan.raw.freezes?.[0];
      const who = f ? plan.people[lc(f.by_id)] : undefined;
      const by = who ? (who.me ? "You" : who.name) : "Someone";
      return (
        <Banner
          testID="rule-preview"
          kind="mut"
          icon="pause"
          title="The plan is paused"
          text={`${by} paused spending${f ? ` at ${fmtClock(f.timestamp)}` : ""}. Nothing can be paid or recorded until the group votes to resume.`}
        />
      );
    }
    case 6: {
      const remaining = budget?.remaining ?? 0n;
      const over = units - remaining;
      return (
        <Banner testID="rule-preview" kind="neg" icon="ban" title={`Over the ${cat.name} budget by ${formatUsd(over > 0n ? over : 0n)}`} text={budget ? `Only ${formatUsd(remaining)} left of ${formatUsd(budget.budget)}.` : BLOCK_REASONS[6]}>
          <View style={{ marginTop: 6 }}>
            {onPayPart && remaining > 0n && kind === SpendKind.PAY ? link(`Pay ${formatUsd(remaining)} from the pot, cover ${formatUsd(over)} myself`, () => onPayPart(remaining), "btn-pay-part") : null}
            {link("Ask the group to raise the budget", () => router.push({ pathname: "/plan/customise", params: { pot: plan.pot } }), "btn-ask-to-raise-budget")}
          </View>
        </Banner>
      );
    }
    case 7:
      return (
        <Banner
          testID="rule-preview"
          kind="neg"
          icon="ban"
          title={`Over today's ${formatUsdShort(rules.memberDailyCap)} limit`}
          text={`Each person can spend up to ${formatUsdShort(rules.memberDailyCap)} a day from the pot. Resets at midnight UTC.`}
        />
      );
    case 8:
      return <Banner testID="rule-preview" kind="neg" icon="ban" title="Over your total limit" text={`Each person can spend up to ${formatUsdShort(rules.memberTotalCap)} from this plan in total.`} />;
    case 9:
      return (
        <Banner testID="rule-preview" kind="neg" icon="ban" title="Not enough in the pot" text={`The pot has ${formatUsd(BigInt(plan.raw.balance))}.`}>
          <View style={{ marginTop: 6 }}>{link("Add money", () => router.push({ pathname: "/plan/[pot]/add", params: { pot: plan.pot } }), "btn-add-money-link")}</View>
        </Banner>
      );
    case 2:
      return <Banner testID="rule-preview" kind="mut" icon="clock" title="Spending is closed" text={plan.ended ? "The plan has ended. Spending is closed while everyone checks the numbers." : BLOCK_REASONS[2]} />;
    case 4:
      return <Banner testID="rule-preview" kind="neg" icon="ban" title="Not open yet" text={`Spending opens once everyone has put in ${formatUsdShort(rules.minContribution)}.`} />;
    case 10:
      return <Banner testID="rule-preview" kind="neg" icon="ban" title="Pick who shares this" text="Choose at least one person in the plan." />;
    default:
      return <Banner testID="rule-preview" kind="neg" icon="ban" title="This can't go through" text={BLOCK_REASONS[v.reason] ?? "Check the details and try again."} />;
  }
}
