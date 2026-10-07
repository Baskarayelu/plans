/**
 * 143 What could go wrong: four worries, each with a one-line answer that already says what isn't
 * covered. Reached from You and from a plan's Members & rules (?pot=), where a last row names that
 * plan's rules.
 */
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { View } from "react-native";
import { usePlan } from "../../lib/state/data";
import { currentRules, presetName } from "../../ui/core/PlanCore";
import { Icon } from "../../ui/Icon";
import { Card, Row, Tile } from "../../ui/kit";
import { AppBar, Screen } from "../../ui/layout";
import { RISK_TOPICS } from "../../ui/risks/content";
import { Txt } from "../../ui/Text";

export default function Risks() {
  const { pot } = useLocalSearchParams<{ pot?: string }>();
  const plan = usePlan(pot);
  const p = plan.data;
  return (
    <Screen testID="screen-risks">
      <AppBar title="What could go wrong" />
      <Txt v="d28">The uncomfortable parts, in plain words</Txt>
      <Txt v="t15" color="muted" style={{ marginTop: 8, marginBottom: 8 }}>
        Plans is built so money only moves by your group's rules. Here's what that protects you from, and what it doesn't.
      </Txt>
      {RISK_TOPICS.map((t) => (
        <Card
          key={t.id}
          style={{ marginTop: 8 }}
          onPress={() => router.push({ pathname: "/risks/[topic]", params: pot ? { topic: t.id, pot } : { topic: t.id } })}
          testID={`risk-row-${t.id}`}
          a11y={t.title}
        >
          <Row align="flex-start">
            <Tile icon={t.icon} kind={t.kind} />
            <View style={{ flex: 1 }}>
              <Txt v="lt">{t.title}</Txt>
              <Txt v="t13" color="muted">
                {t.line}
              </Txt>
            </View>
            <Icon name="chev" size={20} />
          </Row>
        </Card>
      ))}
      {p ? (
        <Card tint style={{ marginTop: 16 }} onPress={() => router.push({ pathname: "/plan/[pot]/members", params: { pot: p.pot } })} testID="risk-row-plan-rules" a11y="Your plan's rules">
          <Row>
            <Tile icon="note" />
            <View style={{ flex: 1 }}>
              <Txt v="lt">Your plan's rules</Txt>
              <Txt v="t13" color="muted" numberOfLines={1}>
                {`${p.meta.name} · ${presetName(currentRules(p.raw))}`}
              </Txt>
            </View>
            <Icon name="chev" size={20} />
          </Row>
        </Card>
      ) : null}
      <View style={{ flex: 1, minHeight: 24 }} />
      <Txt v="t13" color="muted" center onPress={() => router.push("/help")} testID="link-risks-help" accessibilityRole="link">
        Something else? You → Help.
      </Txt>
    </Screen>
  );
}
