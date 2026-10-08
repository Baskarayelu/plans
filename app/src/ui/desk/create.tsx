/**
 * New plan on a laptop (design 108 exit: "10–11 as a two-step centred form with the live preview
 * card beside it"): the form in a centred column, the preview card in the panel with the step's button.
 */
import React from "react";
import { View } from "react-native";
import { draft, draftBase, draftRules, planTimes } from "../../lib/core/draft";
import { formatUsdShort } from "../../lib/domain/currency";
import { PRESETS, presetBlurb, tierStrip } from "../../lib/domain/rules";
import { budgetTotal, templateOf } from "../../lib/domain/templates";
import { useStore } from "../../lib/state/observable";
import { useColors } from "../../theme/ThemeProvider";
import { WRISTBANDS } from "../../theme/tokens";
import { dayRange } from "../core/DateSheet";
import { EmojiTile, Row, Tiers, Wristband } from "../kit";
import { Crumbs } from "../shell/desk";
import { SidePanel } from "../shell/panel";
import { Txt } from "../Text";

export function CreateHead({ step, title, sub }: { step: 1 | 2; title: string; sub?: string }) {
  return (
    <View style={{ marginBottom: 4 }}>
      <Crumbs items={[{ label: "Plans", href: "/" }, { label: "New plan" }]} right={<Txt v="t13" color="muted">{`Step ${step} of 2`}</Txt>} />
      <Txt v="d34" style={{ marginTop: 8 }}>
        {title}
      </Txt>
      {sub ? (
        <Txt v="t15" color="muted" style={{ marginTop: 6 }}>
          {sub}
        </Txt>
      ) : null}
    </View>
  );
}

/** The live preview card and what's been chosen so far, with the step's button at the bottom. */
export function CreatePanel({ step, children }: { step: 1 | 2; children: React.ReactNode }) {
  const c = useColors();
  const d = useStore(draft);
  const name = d.name.trim();
  const times = planTimes(d);
  const rules = draftRules(d);
  const base = draftBase(d);
  const when = times.fixed ? "48 hours from now" : dayRange(d.startDay, d.endDay);
  return (
    <SidePanel kind="form">
      <View style={{ flex: 1 }} testID="create-panel">
        <Txt v="ov" color="muted">
          Preview
        </Txt>
        <View style={{ marginTop: 8, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line, borderRadius: 14, overflow: "hidden" }} testID="plan-preview">
          <Wristband color={WRISTBANDS[d.color]} text={`${name || "Your plan"} · ${times.fixed ? "48 hours" : when}`} />
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 }}>
            <Row>
              <EmojiTile emoji={d.emoji} color={WRISTBANDS[d.color]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt v="d17" numberOfLines={1}>
                  {name || "Name your plan"}
                </Txt>
                <Txt v="t13" color="muted">
                  Just you so far
                </Txt>
              </View>
            </Row>
          </View>
        </View>
        <View style={{ marginTop: 20, gap: 10 }}>
          <Row between>
            <Txt v="t13" color="muted">
              Dates
            </Txt>
            <Txt v="t13" weight="bold">
              {when}
            </Txt>
          </Row>
          <Row between>
            <Txt v="t13" color="muted">
              Rules
            </Txt>
            <Txt v="t13" weight="bold">
              {step === 1 && !d.template ? "Next step" : d.preset === "custom" ? `Custom, from ${PRESETS[base].title}` : PRESETS[base].title}
            </Txt>
          </Row>
          {rules.categoryBudgets.some((b) => b > 0n) ? (
            <Row between>
              <Txt v="t13" color="muted">
                Budgets
              </Txt>
              <Txt v="t13" weight="bold" testID="panel-budget-total">
                {d.template ? `${formatUsdShort(budgetTotal(rules.categoryBudgets))} · ${d.template.people} people` : formatUsdShort(budgetTotal(rules.categoryBudgets))}
              </Txt>
            </Row>
          ) : null}
          {d.template ? (
            <Row between>
              <Txt v="t13" color="muted">
                Started from
              </Txt>
              <Txt v="t13" weight="bold">
                {templateOf(d.template.id).title}
              </Txt>
            </Row>
          ) : null}
          {step === 2 ? (
            <>
              <Tiers segs={tierStrip(rules)} height={26} fontSize={11} />
              <Txt v="t13" color="muted">
                {presetBlurb(rules)}
              </Txt>
            </>
          ) : null}
        </View>
        <View style={{ flex: 1, minHeight: 24 }} />
        {children}
      </View>
    </SidePanel>
  );
}
