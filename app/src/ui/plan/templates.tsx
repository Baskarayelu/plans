/**
 * Trip templates on the new-plan screens (Group 2): the "Start from" row and the suggested budgets
 * on screen 10, and the budgets card on screen 11. Built from the approved create-plan parts
 * (preset cards, emoji tiles, steppers, list rows); everything stays editable before Create plan.
 */
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { dayOf, draft, type Draft } from "../../lib/core/draft";
import { formatUsdShort } from "../../lib/domain/currency";
import { CATEGORIES } from "../../lib/domain/rules";
import { applyTemplate, budgetTotal, clampPeople, clearTemplate, followTemplate, MAX_PEOPLE, MIN_PEOPLE, spanDays, templateOf, templateSub, TEMPLATES, type TemplateId } from "../../lib/domain/templates";
import { useColors } from "../../theme/ThemeProvider";
import { WRISTBANDS } from "../../theme/tokens";
import { Icon } from "../Icon";
import { Btn, Card, EmojiTile, Overline, Row, Stepper } from "../kit";
import { useLayout } from "../shell/responsive";
import { Txt } from "../Text";

/** "Start from": the templates and a blank plan, side by side (scrolls sideways on a phone). */
export function TemplatePicker({ d, top = 16, bottom = 0 }: { d: Draft; top?: number; bottom?: number }) {
  const { desk } = useLayout();
  const on = d.template?.id;
  const pick = (id: TemplateId | null) => {
    if (id === null) draft.patch(clearTemplate(d));
    else if (id !== on) draft.patch(applyTemplate(templateOf(id), dayOf(Date.now()), d.template?.people));
  };
  const cards = [
    <TemplateCard key="blank" id="blank" title="Blank" sub="Fill it in yourself" on={!on} onPress={() => pick(null)} wide={desk} />,
    ...TEMPLATES.map((t) => <TemplateCard key={t.id} id={t.id} title={t.title} sub={templateSub(t)} emoji={t.emoji} color={WRISTBANDS[t.color]} on={on === t.id} onPress={() => pick(t.id)} wide={desk} />),
  ];
  return (
    <View style={{ marginTop: top, marginBottom: bottom }} testID="template-picker">
      <Overline>Start from</Overline>
      {desk ? (
        // a laptop has room for all of them: one row
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>{cards}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, marginHorizontal: -4 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 4, paddingVertical: 2 }}>
          {cards}
        </ScrollView>
      )}
    </View>
  );
}

function TemplateCard({ id, title, sub, emoji, color, on, onPress, wide }: { id: string; title: string; sub: string; emoji?: string; color?: string; on: boolean; onPress: () => void; wide?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      testID={`template-${id}`}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${title}. ${sub}`}
      onPress={onPress}
      style={({ pressed }) => ({
        ...(wide ? { flex: 1, minWidth: 0 } : { width: 140 }),
        backgroundColor: c.surface,
        borderRadius: 14,
        borderWidth: on ? 2 : 1,
        borderColor: on ? c.ink : c.line,
        padding: on ? 11 : 12,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      {emoji && color ? (
        <EmojiTile emoji={emoji} color={color} size={36} />
      ) : (
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
          <Icon name="plus" size={18} />
        </View>
      )}
      <Txt v="lt" numberOfLines={1} style={{ marginTop: 10 }}>
        {title}
      </Txt>
      <Txt v="t13" color="muted" numberOfLines={wide ? 2 : 1}>
        {sub}
      </Txt>
    </Pressable>
  );
}

function BudgetLines({ budgets }: { budgets: readonly bigint[] }) {
  const c = useColors();
  return (
    <View style={{ marginTop: 8 }}>
      {CATEGORIES.filter((cat) => budgets[cat.id] > 0n).map((cat) => (
        <Row key={cat.id} between style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: c.line }}>
          <Row gap={10} style={{ flex: 1 }}>
            <Txt style={{ fontSize: 16, lineHeight: 22, width: 22, textAlign: "center" }}>{cat.emoji}</Txt>
            <Txt v="t15" numberOfLines={1} style={{ flex: 1 }}>
              {cat.name}
            </Txt>
          </Row>
          <Txt v="t15" tnum weight="bold">
            {formatUsdShort(budgets[cat.id])}
          </Txt>
        </Row>
      ))}
    </View>
  );
}

/** Screen 10 with a template: how many people are going, and the budgets that follows from it. */
export function TemplateBudgets({ d }: { d: Draft }) {
  const c = useColors();
  if (!d.template || !d.budgets) return null;
  const t = templateOf(d.template.id);
  const people = d.template.people;
  const days = spanDays(d.startDay, d.endDay);
  const total = budgetTotal(d.budgets);
  const setPeople = (n: number) => draft.patch(followTemplate(d, { template: { ...d.template!, people: clampPeople(n) } }));
  return (
    <Card style={{ marginTop: 20 }} testID="card-template-budgets">
      <Row between>
        <View style={{ flex: 1 }}>
          <Txt v="lt">People going</Txt>
          <Txt v="t13" color="muted">
            Sets the budgets below
          </Txt>
        </View>
        <Stepper value={String(people)} onMinus={() => setPeople(Math.max(MIN_PEOPLE, people - 1))} onPlus={() => setPeople(Math.min(MAX_PEOPLE, people + 1))} testID="stepper-people" />
      </Row>
      <View style={{ height: 1, backgroundColor: c.line, marginTop: 14 }} />
      <Row between style={{ marginTop: 14 }}>
        <Overline>Suggested budgets</Overline>
        <Txt v="t13" color="muted">
          {d.template.edited ? "Changed by you" : `${people} people · ${days} ${days === 1 ? "day" : "days"}`}
        </Txt>
      </Row>
      <BudgetLines budgets={d.budgets} />
      <Row between style={{ marginTop: 10 }}>
        <Txt v="lt">Total</Txt>
        <Txt v="d17" tnum testID="template-budget-total">
          {formatUsdShort(total)}
        </Txt>
      </Row>
      <Txt v="t13" color="muted" style={{ marginTop: 6 }}>
        {`About ${formatUsdShort(total / BigInt(people))} each, from a typical ${t.title.toLowerCase()}. The pot won't spend over a category's budget. Change any of it on the next step.`}
      </Txt>
    </Card>
  );
}

/** Screen 11: the budgets this plan will start with, with a way to change them. */
export function BudgetsCard({ d, budgets }: { d: Draft; budgets: readonly bigint[] }) {
  if (!budgets.some((b) => b > 0n)) return null;
  const t = d.template ? templateOf(d.template.id) : null;
  return (
    <Card style={{ marginTop: 12 }} testID="card-budgets">
      <Row between>
        <View style={{ flex: 1 }}>
          <Txt v="lt">Budgets</Txt>
          <Txt v="t13" color="muted">
            {t && !d.template!.edited ? `From ${t.title} · ${d.template!.people} people` : "Set by you"}
          </Txt>
        </View>
        <Txt v="d17" tnum>
          {formatUsdShort(budgetTotal(budgets))}
        </Txt>
      </Row>
      <BudgetLines budgets={budgets} />
      <View style={{ marginTop: 10, flexDirection: "row" }}>
        <Btn label="Change budgets" kind="sec" sm icon="sliders" onPress={() => router.push("/plan/customise")} testID="btn-change-budgets" />
      </View>
    </Card>
  );
}
