/**
 * 23 Split editor: who shares this spend. Everyone (locked), pick people, or custom shares
 * (×1..×9). Amounts are the contract's exact shares (the first person takes any remainder),
 * each shown in that person's own money. Writes back to the form draft on Done.
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { formatUsd } from "../../../lib/domain/currency";
import { patchDraft, useDraft } from "../../../lib/spend/draft";
import { activeMembers } from "../../../lib/spend/hooks";
import { orderedSplit, sharesFor, type SplitMode } from "../../../lib/spend/logic";
import { usePlan, type PlanVM } from "../../../lib/state/data";
import { useColors } from "../../../theme/ThemeProvider";
import { Icon } from "../../../ui/Icon";
import { Btn, Card, Checkbox, Chip, Row, Seg, Stepper } from "../../../ui/kit";
import { AppBar, Screen } from "../../../ui/layout";
import { PersonAvatar, PersonName } from "../../../ui/plan/common";
import { PlanGate, usePeopleMoney } from "../../../ui/spend/parts";
import { Txt } from "../../../ui/Text";
import { DeskColumn } from "../../../ui/desk/plan";
import { useLayout } from "../../../ui/shell/responsive";

export default function SplitEditor() {
  const { pot } = useLocalSearchParams<{ pot: string }>();
  const q = usePlan(pot);
  return (
    <PlanGate q={q} title="Split" testID="screen-split">
      {(plan) => <SplitBody plan={plan} />}
    </PlanGate>
  );
}

function SplitBody({ plan }: { plan: PlanVM }) {
  const { desk } = useLayout();
  const c = useColors();
  const d = useDraft();
  const theirs = usePeopleMoney(plan);
  const active = activeMembers(plan);
  const [mode, setMode] = useState<SplitMode>(d.splitMode);
  const [chosen, setChosen] = useState<string[]>(d.splitMode === "everyone" || d.chosen.length === 0 ? active : d.chosen.filter((a) => active.includes(a)));
  const [weights, setWeights] = useState<Record<string, number>>(d.weights);
  const units = d.units;
  const sel = mode === "everyone" ? active : chosen;
  const split = orderedSplit(active, sel, weights, mode === "custom");
  const parts = sharesFor(units, split.weights);
  const total = parts.reduce((a, b) => a + b, 0n);
  const adds = units > 0n && total === units;

  const toggle = (a: string) => {
    if (mode === "everyone") return;
    setChosen((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  };
  const setW = (a: string, delta: number) => setWeights((w) => ({ ...w, [a]: Math.min(9, Math.max(1, (w[a] ?? 1) + delta)) }));

  const done = () => {
    patchDraft({ splitMode: mode, chosen: mode === "everyone" ? [] : split.members, weights: mode === "custom" ? weights : {}, splitDoneAt: Date.now() });
    router.back();
  };

  return (
    <Screen
      testID="screen-split"
      dock={desk ? undefined : <>
          <Row between>
            <Txt v="t15" color="muted">
              Total
            </Txt>
            {split.members.length === 0 ? (
              <Txt v="t15" color="neg" weight="bold" testID="split-total">
                Pick at least one person
              </Txt>
            ) : units <= 0n ? (
              <Txt v="t15" color="muted" testID="split-total">
                {split.members.length} {split.members.length === 1 ? "person" : "people"}
              </Txt>
            ) : (
              <Row gap={6}>
                <Icon name="check" size={18} strokeWidth={2.4} color={adds ? c.pos : c.neg} />
                <Txt v="t15" weight="bold" color={adds ? "pos" : "neg"} testID="split-total">
                  {formatUsd(total)} {adds ? "adds up" : "doesn't add up"}
                </Txt>
              </Row>
            )}
          </Row>
          <Btn label="Done" onPress={done} disabled={split.members.length === 0 || (units > 0n && !adds)} testID="btn-done" />
        </>}
    >
      <DeskColumn dock={<>
          <Row between>
            <Txt v="t15" color="muted">
              Total
            </Txt>
            {split.members.length === 0 ? (
              <Txt v="t15" color="neg" weight="bold" testID="split-total">
                Pick at least one person
              </Txt>
            ) : units <= 0n ? (
              <Txt v="t15" color="muted" testID="split-total">
                {split.members.length} {split.members.length === 1 ? "person" : "people"}
              </Txt>
            ) : (
              <Row gap={6}>
                <Icon name="check" size={18} strokeWidth={2.4} color={adds ? c.pos : c.neg} />
                <Txt v="t15" weight="bold" color={adds ? "pos" : "neg"} testID="split-total">
                  {formatUsd(total)} {adds ? "adds up" : "doesn't add up"}
                </Txt>
              </Row>
            )}
          </Row>
          <Btn label="Done" onPress={done} disabled={split.members.length === 0 || (units > 0n && !adds)} testID="btn-done" />
        </>}>
      <AppBar icon="x" title={units > 0n ? `Split ${formatUsd(units)}` : "Who shares this"} sub={d.label || d.note || undefined} />
      <Seg
        testID="seg-split"
        value={mode}
        onChange={(m) => {
          if (m !== "everyone" && mode === "everyone") setChosen(active);
          setMode(m);
        }}
        options={[
          { value: "everyone", label: "Everyone" },
          { value: "pick", label: "Pick people" },
          { value: "custom", label: "Custom" },
        ]}
      />
      <View style={{ marginTop: 8 }}>
        {active.map((a, i) => {
          const p = plan.people[a];
          if (!p) return null;
          const on = sel.includes(a);
          const idx = split.members.indexOf(a);
          const part = idx >= 0 ? parts[idx] : 0n;
          const local = on && units > 0n ? theirs(part, p) : undefined;
          return (
            <View key={a} style={{ borderBottomWidth: i === active.length - 1 ? 0 : 1, borderBottomColor: c.line }}>
              <Pressable
                testID={`split-row-${i}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: mode === "everyone" }}
                accessibilityLabel={p.name}
                onPress={() => toggle(a)}
                disabled={mode === "everyone"}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingVertical: 8 }}
              >
                <View style={{ opacity: mode === "everyone" ? 0.5 : 1 }}>
                  <Checkbox on={on} />
                </View>
                <PersonAvatar p={p} size={36} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <PersonName p={p} />
                  {p.city || p.country ? (
                    <Txt v="t13" color="muted" numberOfLines={1}>
                      {p.city ?? p.country}
                    </Txt>
                  ) : null}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  {on ? (
                    <Txt v="lt" tnum testID={`split-amount-${i}`}>
                      {units > 0n ? formatUsd(part) : "—"}
                    </Txt>
                  ) : (
                    <Txt v="t15" color="muted">
                      Not in this
                    </Txt>
                  )}
                  {local ? (
                    <Txt v="t13" color="muted">
                      {local}
                    </Txt>
                  ) : null}
                </View>
              </Pressable>
              {mode === "custom" && on ? (
                <Row between style={{ paddingLeft: 34, paddingBottom: 10 }}>
                  <Txt v="t13" color="muted">
                    Share
                  </Txt>
                  <Stepper value={`×${weights[a] ?? 1}`} onMinus={() => setW(a, -1)} onPlus={() => setW(a, 1)} testID={`stepper-${i}`} />
                </Row>
              ) : null}
            </View>
          );
        })}
      </View>
      {mode === "pick" ? (
        <Card tint style={{ marginTop: 16 }}>
          <Row between>
            <Txt v="lt">Custom shares</Txt>
            <Chip sm ol label="Try it" onPress={() => setMode("custom")} testID="chip-try-custom" />
          </Row>
          <Txt v="t13" color="muted" style={{ marginTop: 6 }}>
            Give someone a bigger share, like ×2 for a couple.
          </Txt>
        </Card>
      ) : null}
      {mode === "custom" ? (
        <Txt v="t13" color="muted" style={{ marginTop: 12 }}>
          Shares are worked out exactly: a ×2 person pays twice what a ×1 person pays. Any leftover cent goes to the first person.
        </Txt>
      ) : null}
    </DeskColumn>
    </Screen>
  );
}
