/**
 * 10 Create plan: basics — name, emoji, wristband colour and dates, with a live preview card.
 * "Start from" a trip template fills all of it plus the rules preset and budgets (Group 2).
 */
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { addDays, dayOf, draft, EMOJIS, MAX_PLAN_SEC, planTimes, resetDraft, type WristbandName } from "../../lib/core/draft";
import { PRESETS } from "../../lib/domain/rules";
import { followTemplate } from "../../lib/domain/templates";
import { useStore } from "../../lib/state/observable";
import { useColors } from "../../theme/ThemeProvider";
import { WRISTBANDS } from "../../theme/tokens";
import { DateSheet, dayLabel, dayRange } from "../../ui/core/DateSheet";
import { Icon } from "../../ui/Icon";
import { Btn, EmojiTile, Field, Overline, Row, Wristband } from "../../ui/kit";
import { AppBar, Screen } from "../../ui/layout";
import { Txt } from "../../ui/Text";
import { CreateHead, CreatePanel } from "../../ui/desk/create";
import { Narrow } from "../../ui/desk/plan";
import { TemplateBudgets, TemplatePicker } from "../../ui/plan/templates";
import { useLayout } from "../../ui/shell/responsive";

const MAX_DAYS = Math.floor(MAX_PLAN_SEC / 86400);

export default function NewPlan() {
  const c = useColors();
  const { desk } = useLayout();
  const d = useStore(draft);
  const [pick, setPick] = useState<"start" | "end" | null>(null);
  const [customEmoji, setCustomEmoji] = useState(false);
  const [emojiText, setEmojiText] = useState("");
  const today = dayOf(Date.now());
  const fixed = !!PRESETS[d.preset === "custom" ? d.customBase : d.preset === "demo" ? "balanced" : d.preset].durationSec;

  useEffect(() => {
    // a draft left from an earlier day: move the start to today
    if (d.startDay < today) draft.patch(followTemplate(d, { startDay: today, endDay: Math.max(d.endDay, addDays(today, 1)) }));
  }, [d.startDay, d.endDay, today]);

  const name = d.name.trim();
  const valid = name.length >= 1 && name.length <= 40;
  const isCustomEmoji = !EMOJIS.includes(d.emoji as (typeof EMOJIS)[number]);
  const { endTime } = planTimes(d);
  const endsOn = new Date(endTime * 1000);
  const band = `${name || "Your plan"} · ${fixed ? "48 hours" : dayRange(d.startDay, d.endDay)}`;

  const close = () => {
    resetDraft();
    router.canGoBack() ? router.back() : router.replace("/(tabs)");
  };

  const nextBtn = <Btn label="Next: set the rules" disabled={!valid} onPress={() => router.push("/plan/rules")} testID="btn-next-set-the-rules" />;
  const form = (
    <>
      <View style={{ marginTop: 20 }}>
        <Field label="Plan name" value={d.name} onChangeText={(t) => draft.patch({ name: t })} maxLength={40} placeholder="Lisbon, 12–16 Oct" testID="field-plan-name" autoFocus />
      </View>

      <Overline style={{ marginTop: 20 }}>Emoji</Overline>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {EMOJIS.map((e, i) => (
          <EmojiChoice key={e} emoji={e} on={d.emoji === e} onPress={() => draft.patch({ emoji: e })} testID={`chip-emoji-${i}`} />
        ))}
        <EmojiChoice
          emoji={isCustomEmoji ? d.emoji : undefined}
          on={isCustomEmoji || customEmoji}
          onPress={() => setCustomEmoji(true)}
          testID="chip-emoji-custom"
          label="Choose another emoji"
        />
      </View>
      {customEmoji ? (
        <View style={{ marginTop: 8 }}>
          <Field
            label="Your emoji"
            value={emojiText}
            onChangeText={(t) => {
              setEmojiText(t);
              const first = firstGrapheme(t);
              if (first) draft.patch({ emoji: first });
            }}
            placeholder="Type or pick from your keyboard"
            testID="field-custom-emoji"
            autoFocus
          />
        </View>
      ) : null}

      <Overline style={{ marginTop: 20 }}>Wristband colour</Overline>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
        {(Object.keys(WRISTBANDS) as WristbandName[]).map((k) => {
          const on = d.color === k;
          return (
            <Pressable
              key={k}
              testID={`swatch-${k}`}
              accessibilityRole="button"
              accessibilityLabel={`${k} wristband`}
              accessibilityState={{ selected: on }}
              onPress={() => draft.patch({ color: k })}
              style={{ width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", borderWidth: on ? 2 : 0, borderColor: c.ink }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: WRISTBANDS[k], alignItems: "center", justifyContent: "center" }}>
                {on ? <Icon name="check" size={20} strokeWidth={2.6} color="#10231B" /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={{ marginTop: 20, gap: 8 }}>
        {fixed ? (
          <Field label="Dates" value="Starts now · lasts 48 hours" right={<Icon name="clock" size={20} />} hint="Pilot plans run for 48 hours from when you create them." testID="field-dates" />
        ) : (
          <>
            <Row gap={8}>
              <View style={{ flex: 1 }}>
                <Field label="Starts" value={d.startDay <= today ? "Today" : dayLabel(d.startDay)} onPress={() => setPick("start")} right={<Icon name="cal" size={20} />} testID="field-start-date" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Ends" value={dayLabel(d.endDay)} onPress={() => setPick("end")} right={<Icon name="cal" size={20} />} testID="field-end-date" />
              </View>
            </Row>
            <Txt v="t13" color="muted">
              The plan ends by itself at midnight on {endsOn.getDate()} {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][endsOn.getMonth()]}. You can end it sooner. Plans last up to a year.
            </Txt>
          </>
        )}
      </View>

      <TemplateBudgets d={d} />
    </>
  );
  const sheets = (
    <>
      <DateSheet
        visible={pick === "start"}
        onClose={() => setPick(null)}
        title="When does it start?"
        value={d.startDay}
        min={today}
        max={addDays(today, 365)}
        testID="sheet-start-date"
        onPick={(v) => {
          const span = Math.round((d.endDay - d.startDay) / 86_400_000);
          draft.patch(followTemplate(d, { startDay: v, endDay: addDays(v, Math.max(1, Math.min(span, MAX_DAYS - 1))) }));
          setPick(null);
        }}
      />
      <DateSheet
        visible={pick === "end"}
        onClose={() => setPick(null)}
        title="When does it end?"
        value={d.endDay}
        rangeFrom={d.startDay}
        min={d.startDay}
        max={addDays(d.startDay, MAX_DAYS - 1)}
        testID="sheet-end-date"
        onPick={(v) => {
          draft.patch(followTemplate(d, { endDay: v }));
          setPick(null);
        }}
      />
    </>
  );

  if (desk)
    return (
      <Screen testID="screen-plan-new">
        <Narrow max={640} center>
          <CreateHead step={1} title="Name your plan" sub="A trip, a festival, a house share. You set the rules next, then invite friends." />
          <TemplatePicker d={d} />
          {form}
        </Narrow>
        <View style={{ height: 24 }} />
        <CreatePanel step={1}>
          {nextBtn}
          <Btn label="Cancel" kind="txt" onPress={close} style={{ marginTop: 4 }} testID="btn-cancel-new-plan" />
        </CreatePanel>
        {sheets}
      </Screen>
    );

  return (
    <Screen testID="screen-plan-new" dock={nextBtn}>
      <AppBar icon="x" title="New plan" onBack={close} right={<Txt v="t13" color="muted" style={{ marginRight: 12 }}>1 of 2</Txt>} />
      <TemplatePicker d={d} top={0} bottom={16} />

      <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 14, overflow: "hidden" }} testID="plan-preview">
        <Wristband color={WRISTBANDS[d.color]} text={band} />
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

      {form}
      <View style={{ height: 16 }} />

      {sheets}
    </Screen>
  );
}

function EmojiChoice({ emoji, on, onPress, testID, label }: { emoji?: string; on: boolean; onPress: () => void; testID: string; label?: string }) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label ?? emoji}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? c.surface : c.surface2,
        borderWidth: on ? 2 : 0,
        borderColor: c.ink,
      }}
    >
      {emoji ? <Txt style={{ fontSize: 22, lineHeight: 28 }}>{emoji}</Txt> : <Icon name="plus" size={20} />}
    </Pressable>
  );
}

/** First user-perceived character (good enough for emoji incl. ZWJ sequences and flags). */
function firstGrapheme(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) {
    for (const x of new Seg(undefined, { granularity: "grapheme" }).segment(t)) return x.segment;
  }
  const m = /^(?:\p{RI}\p{RI}|\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*|.)/u.exec(t);
  return m ? m[0] : null;
}

