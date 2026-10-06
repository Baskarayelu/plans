/** 11 Create plan: rules preset, plus "Put in now" and the safety net, then Create plan → 13. */
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { when } from "../../lib/core/format";
import { draft, draftBase, draftRules, planTimes, rememberCreatedInvite, resetDraft } from "../../lib/core/draft";
import { formatUsd, ONE_DOLLAR, parseAmount } from "../../lib/domain/currency";
import { createPlan, defaultSafetyNet } from "../../lib/domain/planOps";
import { PRESETS, presetBlurb, tierStrip, type PresetId } from "../../lib/domain/rules";
import { useBalance } from "../../lib/state/data";
import { useStore } from "../../lib/state/observable";
import { useAction } from "../../lib/state/useAction";
import { useColors } from "../../theme/ThemeProvider";
import { WRISTBANDS } from "../../theme/tokens";
import { Icon } from "../../ui/Icon";
import { Banner, Btn, Card, Chip, Field, ListItem, Radio, Row, Skel, Tile, Tiers, Toggle } from "../../ui/kit";
import { AppBar, Screen } from "../../ui/layout";
import { useMoney } from "../../ui/plan/common";
import { Txt } from "../../ui/Text";

const VISIBLE: Exclude<PresetId, "demo">[] = ["easygoing", "balanced", "strict", "pilot"];

export default function RulesPreset() {
  const d = useStore(draft);
  const money = useMoney();
  const bal = useBalance();
  const balance = bal.data ?? 0n;
  const rules = draftRules(d);
  const base = draftBase(d);
  const small = rules.oneApprovalMax <= 5n * ONE_DOLLAR;
  const chips = small ? [1n, 2n, 5n] : [20n, 50n, 100n];

  const [deposit, setDeposit] = useState<bigint>(0n);
  const [other, setOther] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [netOn, setNetOn] = useState(true);
  const safetyNet = defaultSafetyNet(rules);

  const depositUnits = other ? (parseAmount(otherText, 6) ?? 0n) : deposit;
  const tooMuch = depositUnits > balance;

  const create = useAction(async () => {
    const { startTime, endTime } = planTimes(draft.get());
    const dd = draft.get();
    const r = await createPlan({
      meta: { name: dd.name.trim(), emoji: dd.emoji, color: WRISTBANDS[dd.color] },
      rules: draftRules(dd),
      startTime,
      endTime,
      reviewWindowSec: PRESETS[draftBase(dd)].reviewWindowSec,
      deposit: depositUnits,
      safetyNet: netOn ? safetyNet : 0n,
    });
    return r;
  });

  const onCreate = async () => {
    const r = await create.run();
    if (!r) return;
    rememberCreatedInvite(r.pot, r.inviteUrl);
    resetDraft();
    router.dismissAll();
    router.push({ pathname: "/plan/[pot]/invite", params: { pot: r.pot.toLowerCase(), fresh: "1" } });
  };

  const choose = (p: PresetId | "custom") => {
    if (p === "custom") draft.patch({ preset: "custom" });
    else draft.patch({ preset: p, customBase: p === "demo" ? "balanced" : p });
  };

  const times = useMemo(() => planTimes(d), [d]);

  return (
    <Screen
      testID="screen-plan-rules"
      dock={
        <Btn
          label="Create plan"
          onPress={() => void onCreate()}
          loading={create.busy}
          disabled={!d.name.trim() || tooMuch || (other && depositUnits === 0n && otherText !== "")}
          testID="btn-create-plan"
        />
      }
    >
      <AppBar title="New plan" right={<Txt v="t13" color="muted" style={{ marginRight: 12 }}>2 of 2</Txt>} />
      <Txt v="d28">How careful should the pot be?</Txt>
      <Txt v="t15" color="muted" style={{ marginTop: 8, marginBottom: 4 }}>
        Pick a starting point. The group can change it later with a vote.
      </Txt>

      {VISIBLE.map((id) => {
        const p = PRESETS[id];
        return <PresetCard key={id} id={id} title={p.title} tag={p.tag} blurb={presetBlurb(p.rules)} segs={tierStrip(p.rules)} on={d.preset === id} onPress={() => choose(id)} />;
      })}
      {d.custom ? (
        <PresetCard id="custom" title="Custom" tag={`From ${PRESETS[d.customBase].title}`} blurb={presetBlurb(d.custom)} segs={tierStrip(d.custom)} on={d.preset === "custom"} onPress={() => choose("custom")} />
      ) : null}
      {base === "pilot" ? (
        <Txt v="t13" color="muted" style={{ marginTop: 8 }}>
          Pilot runs for 48 hours from when you create it, and what's left is shared out straight after.
        </Txt>
      ) : null}

      <ListItem
        left={<Tile icon="sliders" />}
        title="Customise rules"
        sub="Budgets, daily limits, who can be paid"
        right={<Icon name="chev" size={20} />}
        onPress={() => router.push("/plan/customise")}
        testID="btn-customise-rules"
        last
      />

      <Card style={{ marginTop: 12 }} testID="card-put-in-now">
        <Row between>
          <View style={{ flex: 1 }}>
            <Txt v="lt">Put in now</Txt>
            <Txt v="t13" color="muted">
              {bal.isLoading ? "Checking your balance…" : `Optional · you have ${money.both(balance)}`}
            </Txt>
          </View>
        </Row>
        {bal.isLoading ? (
          <Skel w="70%" h={36} r={999} style={{ marginTop: 12 }} />
        ) : balance === 0n ? (
          <Row between style={{ marginTop: 10 }}>
            <Txt v="t13" color="muted" style={{ flex: 1 }}>
              Add money first. You can put money in any time after.
            </Txt>
            <Btn label="Add money" kind="sec" sm onPress={() => router.push("/add-balance")} testID="btn-rules-add-balance" />
          </Row>
        ) : (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <Chip label="Not now" on={!other && deposit === 0n} onPress={() => (setOther(false), setDeposit(0n))} testID="chip-deposit-0" />
              {chips
                .filter((x) => x * ONE_DOLLAR <= balance)
                .map((x) => (
                  <Chip key={String(x)} label={formatUsd(x * ONE_DOLLAR).replace(".00", "")} on={!other && deposit === x * ONE_DOLLAR} onPress={() => (setOther(false), setDeposit(x * ONE_DOLLAR))} testID={`chip-deposit-${x}`} />
                ))}
              <Chip label="Other" ol={!other} on={other} onPress={() => setOther(true)} testID="chip-deposit-other" />
            </View>
            {other ? (
              <View style={{ marginTop: 8 }}>
                <Field label="Amount in dollars" value={otherText} onChangeText={setOtherText} keyboardType="decimal-pad" placeholder="0.00" right="$" testID="field-deposit-other" />
              </View>
            ) : null}
            {depositUnits > 0n ? (
              <Txt v="t13" color={tooMuch ? "neg" : "muted"} style={{ marginTop: 8 }}>
                {tooMuch ? "That's more than you have." : `${money.both(depositUnits)} goes into the pot when you create it.`}
              </Txt>
            ) : null}
          </>
        )}
      </Card>

      <View style={{ marginTop: 12 }}>
        <Banner kind="inf" icon="shield" title="Safety net" testID="banner-safety-net">
          <Row between align="flex-start">
            <Txt v="t15" style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>
              {netOn
                ? `Up to ${money.both(safetyNet)} can be collected from your Plans balance if you owe at the end. Never more, and we tell you first.`
                : "Off. If you owe at the end, you pay it yourself."}
            </Txt>
            <Toggle on={netOn} onChange={setNetOn} label="Safety net" testID="toggle-safety-net" />
          </Row>
        </Banner>
      </View>

      {!times.fixed ? null : (
        <Txt v="t13" color="muted" style={{ marginTop: 8 }}>
          If you create it now, it ends {when(times.endTime)}.
        </Txt>
      )}

      {create.error ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title={create.error.title} text={create.error.message} testID="banner-create-error" />
        </View>
      ) : null}
      <View style={{ height: 16 }} />
    </Screen>
  );
}

function PresetCard({
  id,
  title,
  tag,
  blurb,
  segs,
  on,
  onPress,
}: {
  id: string;
  title: string;
  tag?: string;
  blurb: string;
  segs: ReturnType<typeof tierStrip>;
  on: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={`preset-${id}`}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${title}. ${blurb}`}
      onPress={onPress}
      style={({ pressed }) => ({
        marginTop: 12,
        backgroundColor: c.surface,
        borderRadius: 14,
        borderWidth: on ? 2 : 1,
        borderColor: on ? c.ink : c.line,
        padding: on ? 15 : 16,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Row>
        <Radio on={on} />
        <Txt v="d17" style={{ flex: 1 }}>
          {title}
        </Txt>
        {tag ? <Chip sm tone="acc" label={tag} /> : null}
      </Row>
      <Txt v="t13" color="muted" style={{ marginTop: 8, marginBottom: 10, marginLeft: 34 }}>
        {blurb}
      </Txt>
      <View style={{ marginLeft: 34 }}>
        <Tiers segs={segs} height={26} fontSize={11} />
      </View>
    </Pressable>
  );
}
