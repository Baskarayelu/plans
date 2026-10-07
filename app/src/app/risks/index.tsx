/**
 * 143 What could go wrong: four worries, each with a one-line answer that already says what isn't
 * covered. Reached from You and from a plan's Members & rules (?pot=), where a last row names that
 * plan's rules.
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { usePlan } from "../../lib/state/data";
import { currentRules, presetName } from "../../ui/core/PlanCore";
import { Icon } from "../../ui/Icon";
import { Btn, Card, Row, Tile } from "../../ui/kit";
import { AppBar, Screen } from "../../ui/layout";
import { AboutDollarsSheet } from "../../ui/agora/dollars";
import { RISK_TOPICS, type RiskTopicId } from "../../ui/risks/content";
import { RiskActions, RiskBox } from "../../ui/risks/parts";
import { DeskTitle, Grid } from "../../ui/shell/desk";
import { SidePanel } from "../../ui/shell/panel";
import { useLayout } from "../../ui/shell/responsive";
import { useColors } from "../../theme/ThemeProvider";
import { Txt } from "../../ui/Text";

export default function Risks() {
  const { pot } = useLocalSearchParams<{ pot?: string }>();
  const plan = usePlan(pot);
  const p = plan.data;
  const { desk } = useLayout();
  if (desk) return <DeskRisks pot={pot} planName={p?.meta.name} />;
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

/** 148 on a laptop: all four answers side by side; the picked one in full in the panel. */
function DeskRisks({ pot, planName }: { pot?: string; planName?: string }) {
  const c = useColors();
  const [picked, setPicked] = useState<RiskTopicId>("lost-phone");
  const [about, setAbout] = useState(false);
  const t = RISK_TOPICS.find((x) => x.id === picked) ?? RISK_TOPICS[0];
  return (
    <Screen testID="screen-risks">
      <DeskTitle over="You" title="What could go wrong" />
      <Txt v="t17" color="muted" style={{ marginTop: -8, marginBottom: 16, maxWidth: 700 }}>
        Money only moves by your group's rules. Here's what that protects you from, and what it doesn't.
      </Txt>
      <Grid cols={2} gap={14}>
        {RISK_TOPICS.map((x) => {
          const on = x.id === picked;
          return (
            <Pressable
              key={x.id}
              onPress={() => setPicked(x.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={x.title}
              testID={`risk-row-${x.id}`}
              style={{ flex: 1, backgroundColor: c.surface, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? c.ink : c.line, padding: on ? 15 : 16, gap: 10 }}
            >
              <Row>
                <Tile icon={x.icon} kind={x.kind} />
                <Txt v="d17" style={{ flex: 1 }}>
                  {x.title}
                </Txt>
              </Row>
              <RiskBox yes compact items={x.yes.slice(0, 1)} testID={`risk-protects-${x.id}`} />
              <RiskBox yes={false} compact items={x.no.slice(0, 1)} testID={`risk-doesnt-${x.id}`} />
              <View style={{ flex: 1 }} />
              <Row gap={4}>
                <Txt v="t13" weight="bold">
                  Read the full answer
                </Txt>
                <Icon name="chev" size={14} strokeWidth={2.4} />
              </Row>
            </Pressable>
          );
        })}
      </Grid>
      <View style={{ flex: 1, minHeight: 24 }} />
      <Txt v="t13" color="muted" onPress={() => router.push("/help")} testID="link-risks-help" accessibilityRole="link">
        Something else? You → Help.
      </Txt>
      <SidePanel kind="form">
        <View style={{ flex: 1 }} testID={`panel-risk-${t.id}`}>
          <Txt v="d22">{t.title}</Txt>
          <Txt v="t15" style={{ marginTop: 8, marginBottom: 14 }}>
            {t.summary}
          </Txt>
          <RiskBox yes items={t.yes} testID="risk-protects" />
          <View style={{ height: 8 }} />
          <RiskBox yes={false} items={t.no} testID="risk-doesnt" />
          {t.todo ? (
            <>
              <Txt v="ov" color="muted" style={{ marginTop: 16 }}>
                What to do
              </Txt>
              <Txt v="t15" style={{ marginTop: 4 }}>
                {t.todo}
              </Txt>
            </>
          ) : null}
          <View style={{ flex: 1, minHeight: 20 }} />
          <RiskActions t={t} pot={pot} planName={planName} onAbout={() => setAbout(true)} />
          <Btn label="Read the full answer" kind="sec" onPress={() => router.push({ pathname: "/risks/[topic]", params: pot ? { topic: t.id, pot } : { topic: t.id } })} style={{ marginTop: 8 }} testID="btn-read-full-answer" />
        </View>
      </SidePanel>
      <AboutDollarsSheet visible={about} onClose={() => setAbout(false)} />
    </Screen>
  );
}
