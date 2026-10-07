/**
 * 12 Customise rules. Two modes:
 * - draft (from 11): Save rules → back to 11 with "Custom" selected;
 * - proposal (`?pot=`, from 16/17): Propose this change → proposeRules → 35 (rules-change?id=).
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import type { Address } from "viem";
import { findEvent } from "../../lib/api/relayer";
import * as A from "../../lib/chain/actions";
import { HighTier, PayeePolicy, type Rules } from "../../lib/chain/eip712";
import { draft, draftRules } from "../../lib/core/draft";
import { formatUsdShort, ONE_DOLLAR } from "../../lib/domain/currency";
import { CATEGORIES, PRESETS, rulesFromIndexer, tierStrip, UINT64_MAX } from "../../lib/domain/rules";
import { queryClient, qk, usePlan } from "../../lib/state/data";
import { useStore } from "../../lib/state/observable";
import { useAction } from "../../lib/state/useAction";
import { useColors } from "../../theme/ThemeProvider";
import { Banner, Btn, Chip, ListItem, Overline, Radio, Row, Seg, Skel, Stepper, Tiers } from "../../ui/kit";
import { AppBar, Screen } from "../../ui/layout";
import { Txt } from "../../ui/Text";
import { DeskColumn } from "../../ui/desk/plan";
import { useLayout } from "../../ui/shell/responsive";

const $ = (d: number) => BigInt(Math.round(d * 100)) * (ONE_DOLLAR / 100n);
/** Dollar ladder the steppers move through. */
const LADDER = [0, 0.25, 0.5, 1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000].map($);

function step(v: bigint, dir: 1 | -1, opts: { noMax?: boolean; min?: bigint } = {}): bigint {
  const ladder = opts.noMax ? [...LADDER, UINT64_MAX] : LADDER;
  const min = opts.min ?? 0n;
  if (dir > 0) {
    const nx = ladder.find((x) => x > v);
    return nx ?? v;
  }
  const prev = [...ladder].reverse().find((x) => x < v);
  return prev === undefined ? v : prev < min ? min : prev;
}

const fmt = (v: bigint, zero = "None") => (v >= UINT64_MAX ? "No max" : v === 0n ? zero : formatUsdShort(v));
const WAITS = [3600, 6 * 3600, 24 * 3600, 48 * 3600];
const waitLabel = (s: number) => (s % 3600 === 0 ? `${s / 3600} h` : `${Math.round(s / 60)} min`);

function sameRules(a: Rules, b: Rules): boolean {
  return (
    a.instantMax === b.instantMax &&
    a.oneApprovalMax === b.oneApprovalMax &&
    a.highTier === b.highTier &&
    a.memberDailyCap === b.memberDailyCap &&
    a.memberTotalCap === b.memberTotalCap &&
    a.payeePolicy === b.payeePolicy &&
    a.minContribution === b.minContribution &&
    a.proposalTtl === b.proposalTtl &&
    a.ruleTimelock === b.ruleTimelock &&
    a.categoryBudgets.every((x, i) => x === b.categoryBudgets[i])
  );
}

export default function Customise() {
  const { desk } = useLayout();
  const { pot } = useLocalSearchParams<{ pot?: string }>();
  const proposal = !!pot;
  const plan = usePlan(pot);
  const d = useStore(draft);
  const c = useColors();

  const initial: Rules | null = useMemo(() => {
    if (!proposal) return draftRules(d);
    const raw = plan.data?.raw;
    if (!raw) return null;
    return rulesFromIndexer({
      instantMax: raw.instantMax ?? "0",
      oneApprovalMax: raw.oneApprovalMax ?? "0",
      highTier: raw.highTier ?? "MAJORITY",
      memberDailyCap: raw.memberDailyCap ?? "0",
      memberTotalCap: raw.memberTotalCap ?? "0",
      payeePolicy: raw.payeePolicy ?? "ANYONE",
      minContribution: raw.minContribution ?? "0",
      proposalTtl: raw.proposalTtl ?? "86400",
      ruleTimelock: raw.ruleTimelock ?? "3600",
      categoryBudgets: raw.categoryBudgets,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal, plan.data?.raw]);

  const [rules, setRules] = useState<Rules | null>(initial);
  useEffect(() => {
    if (initial && !rules) setRules(initial);
  }, [initial, rules]);

  const propose = useAction(async (r: Rules) => {
    const res = await A.proposeRules(pot as Address, r);
    void queryClient.invalidateQueries({ queryKey: qk.plan(pot!) });
    const ev = findEvent(res, "RuleChangeProposed");
    return ev ? String(ev.args.id) : "";
  });

  if (!rules || !initial) {
    return (
      <Screen testID="screen-customise">
        <DeskColumn max={680}>
        <AppBar title={proposal ? "Propose a change" : "Customise rules"} />
        {plan.isError ? (
          <Banner kind="mut" icon="wifioff" title="Couldn't load the rules" text="Check your connection.">
            <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void plan.refetch()} style={{ marginTop: 8 }} testID="btn-customise-retry" />
          </Banner>
        ) : (
          <View style={{ gap: 12 }}>
            <Skel w="30%" h={12} />
            <Skel w="100%" h={40} r={12} />
            <Skel w="100%" h={56} r={14} />
            <Skel w="100%" h={56} r={14} />
            <Skel w="100%" h={56} r={14} />
          </View>
        )}
      </DeskColumn>
      </Screen>
    );
  }

  const set = (p: Partial<Rules>) => setRules({ ...rules, ...p });
  const noBig = rules.oneApprovalMax >= UINT64_MAX;
  const order = rules.instantMax <= rules.oneApprovalMax;
  const changed = !sameRules(rules, initial);
  const isMember = !!plan.data?.isMember;

  const reset = () => setRules(proposal ? initial : PRESETS[d.customBase].rules);

  const save = () => {
    draft.patch({ preset: "custom", custom: rules });
    router.back();
  };

  const submit = async () => {
    const id = await propose.run(rules);
    if (id === undefined) return;
    router.replace({ pathname: "/plan/[pot]/rules-change", params: id ? { pot: pot!, id } : { pot: pot! } });
  };

  return (
    <Screen
      testID="screen-customise"
      dock={desk ? undefined : proposal ? (
          <>
            {propose.error ? <Banner kind="neg" icon="alert" title={propose.error.title} text={propose.error.message} /> : null}
            <Btn
              label={!isMember ? "Only members can propose" : changed ? "Propose this change" : "Change something first"}
              icon="vote"
              disabled={!changed || !order || !isMember}
              loading={propose.busy}
              onPress={() => void submit()}
              testID="btn-propose-this-change"
            />
          </>
        ) : (
          <Btn label="Save rules" disabled={!order} onPress={save} testID="btn-save-rules" />
        )}
    >
      <DeskColumn dock={proposal ? (
          <>
            {propose.error ? <Banner kind="neg" icon="alert" title={propose.error.title} text={propose.error.message} /> : null}
            <Btn
              label={!isMember ? "Only members can propose" : changed ? "Propose this change" : "Change something first"}
              icon="vote"
              disabled={!changed || !order || !isMember}
              loading={propose.busy}
              onPress={() => void submit()}
              testID="btn-propose-this-change"
            />
          </>
        ) : (
          <Btn label="Save rules" disabled={!order} onPress={save} testID="btn-save-rules" />
        )} max={680}>
      <AppBar
        title={proposal ? "Propose a change" : "Customise rules"}
        sub={proposal ? plan.data?.meta.name : undefined}
        right={<Btn label="Reset" kind="txt" sm onPress={reset} testID="btn-reset-rules" />}
      />
      {proposal ? (
        <View style={{ marginBottom: 12 }}>
          <Banner
            kind="inf"
            icon="vote"
            title="This becomes a vote"
            text={`A majority has to agree within ${waitLabel(initial.proposalTtl)}. Then it waits ${waitLabel(initial.ruleTimelock)} before it applies.`}
          />
        </View>
      ) : null}

      <Overline>Spend limits</Overline>
      <View style={{ marginTop: 8 }}>
        <Tiers segs={tierStrip(rules)} />
      </View>
      <Row between style={{ marginTop: 4, paddingHorizontal: 2 }}>
        <Txt v="mono11" color="muted">
          $0
        </Txt>
        {rules.instantMax > 0n ? (
          <Txt v="mono11" color="muted">
            {fmt(rules.instantMax)}
          </Txt>
        ) : null}
        {!noBig ? (
          <Txt v="mono11" color="muted">
            {fmt(rules.oneApprovalMax)}
          </Txt>
        ) : null}
        <Txt v="mono11" color="muted">
          no max
        </Txt>
      </Row>
      {!order ? (
        <Txt v="t13" color="neg" style={{ marginTop: 6 }} testID="rules-order-error">
          The "goes through now" limit can't be higher than the one-OK limit.
        </Txt>
      ) : null}

      <ListItem
        title="Goes through now"
        sub="Up to this, no one needs to OK it"
        right={<Stepper value={fmt(rules.instantMax, "$0")} onMinus={() => set({ instantMax: step(rules.instantMax, -1) })} onPlus={() => set({ instantMax: step(rules.instantMax, 1) })} testID="stepper-instant" />}
      />
      <ListItem
        title="Needs one OK"
        sub={noBig ? "Every bigger spend needs one friend's OK" : "Up to this needs one friend's OK"}
        right={
          <Stepper
            value={fmt(rules.oneApprovalMax, "$0")}
            onMinus={() => set({ oneApprovalMax: step(rules.oneApprovalMax, -1, { noMax: true }) })}
            onPlus={() => set({ oneApprovalMax: step(rules.oneApprovalMax, 1, { noMax: true }) })}
            testID="stepper-one-ok"
          />
        }
      />
      {!noBig ? (
        <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.line }}>
          <Txt v="lt">Bigger spends need</Txt>
          <View style={{ marginTop: 8 }}>
            <Seg
              options={[
                { value: "maj", label: "A majority" },
                { value: "all", label: "Everyone" },
              ]}
              value={rules.highTier === HighTier.ALL ? "all" : "maj"}
              onChange={(v) => set({ highTier: v === "all" ? HighTier.ALL : HighTier.MAJORITY })}
              testID="seg-high-tier"
            />
          </View>
        </View>
      ) : null}
      <ListItem
        title="Daily limit per person"
        sub="Most each person can spend from the pot in a day"
        right={<Stepper value={fmt(rules.memberDailyCap)} onMinus={() => set({ memberDailyCap: step(rules.memberDailyCap, -1) })} onPlus={() => set({ memberDailyCap: step(rules.memberDailyCap, 1) })} testID="stepper-daily-cap" />}
      />

      <Overline style={{ marginTop: 20 }}>Budgets by category</Overline>
      <Txt v="t13" color="muted" style={{ marginTop: 4 }}>
        None means no budget for that category.
      </Txt>
      {CATEGORIES.map((cat) => {
        const v = rules.categoryBudgets[cat.id];
        const upd = (nv: bigint) => {
          const b = [...rules.categoryBudgets] as bigint[];
          b[cat.id] = nv;
          set({ categoryBudgets: b as unknown as Rules["categoryBudgets"] });
        };
        return (
          <ListItem
            key={cat.id}
            left={<EmojiSq emoji={cat.emoji} />}
            title={cat.name}
            right={<Stepper value={fmt(v)} onMinus={() => upd(step(v, -1))} onPlus={() => upd(step(v, 1))} testID={`stepper-budget-${cat.id}`} />}
          />
        );
      })}

      <Overline style={{ marginTop: 20 }}>Who can be paid</Overline>
      {(
        [
          [PayeePolicy.ANYONE, "Anyone", "Friends in the plan, businesses and anyone else", "payee-anyone"],
          [PayeePolicy.MEMBERS_ONLY, "People in the plan", "Pay a friend back", "payee-members"],
          [PayeePolicy.MEMBERS_AND_ALLOWLIST, "People in the plan and saved businesses", "Businesses the group has agreed on", "payee-saved"],
        ] as const
      ).map(([v, t, s, id]) => (
        <ListItem key={id} left={<Radio on={rules.payeePolicy === v} />} title={t} sub={s} onPress={() => set({ payeePolicy: v })} testID={id} />
      ))}
      <Txt v="t13" color="muted" style={{ marginTop: 8 }}>
        Pay links always work: anyone can be paid by link, whatever you choose here.
      </Txt>

      <Overline style={{ marginTop: 20 }}>Questioning spends</Overline>
      <Txt v="t15" style={{ marginTop: 6 }}>
        Anyone in a split can question a spend. The group then has 48 hours to vote.
      </Txt>

      <Overline style={{ marginTop: 20 }}>Rule changes wait</Overline>
      <Txt v="t13" color="muted" style={{ marginTop: 4, marginBottom: 8 }}>
        After a majority agrees, a change waits this long before it applies.
      </Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(WAITS.includes(rules.ruleTimelock) ? WAITS : [rules.ruleTimelock, ...WAITS]).map((w) => (
          <Chip key={w} label={waitLabel(w)} on={rules.ruleTimelock === w} onPress={() => set({ ruleTimelock: w })} testID={`chip-wait-${w}`} />
        ))}
      </View>
      <View style={{ height: 24 }} />
    </DeskColumn>
    </Screen>
  );
}

function EmojiSq({ emoji }: { emoji: string }) {
  const c = useColors();
  return (
    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
      <Txt style={{ fontSize: 18, lineHeight: 24 }}>{emoji}</Txt>
    </View>
  );
}
