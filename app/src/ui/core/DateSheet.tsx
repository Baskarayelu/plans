/** Month calendar in a bottom sheet (no native date picker dependency). Picks one local day. */
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { addDays, dayOf, dayRange } from "../../lib/core/draft";
import { useColors } from "../../theme/ThemeProvider";
import { fonts } from "../../theme/tokens";
import { Btn, IconBtn, Row } from "../kit";
import { Sheet } from "../layout";
import { Txt } from "../Text";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Mon 12 Oct" */
export function dayLabel(dayMs: number): string {
  const d = new Date(dayMs);
  return `${DOW[(d.getDay() + 6) % 7]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

export { dayRange };

export function DateSheet({
  visible,
  onClose,
  title,
  value,
  min,
  max,
  onPick,
  rangeFrom,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  value: number;
  min: number;
  max: number;
  onPick: (dayMs: number) => void;
  /** Highlights the days between this and the hovered value (end-date picking). */
  rangeFrom?: number;
  testID?: string;
}) {
  const c = useColors();
  const [month, setMonth] = useState(() => {
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  useEffect(() => {
    if (!visible) return;
    const d = new Date(value);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
  }, [visible, value]);

  const m = new Date(month);
  const lead = (m.getDay() + 6) % 7; // Monday first
  const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(new Date(m.getFullYear(), m.getMonth(), d).getTime());
  while (cells.length % 7) cells.push(null);

  const prevOk = new Date(m.getFullYear(), m.getMonth(), 0).getTime() >= dayOf(min);
  const nextOk = new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime() <= max;
  const today = dayOf(Date.now());

  return (
    <Sheet visible={visible} onClose={onClose} testID={testID}>
      <Txt v="d22">{title}</Txt>
      <Row between style={{ marginTop: 8 }}>
        <IconBtn name="back" label="Previous month" testID="cal-prev" onPress={() => prevOk && setMonth(new Date(m.getFullYear(), m.getMonth() - 1, 1).getTime())} color={prevOk ? c.ink : c.line} />
        <Txt v="d17">
          {MONTHS[m.getMonth()]} {m.getFullYear()}
        </Txt>
        <IconBtn name="chev" label="Next month" testID="cal-next" onPress={() => nextOk && setMonth(new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime())} color={nextOk ? c.ink : c.line} />
      </Row>
      <View style={{ flexDirection: "row", marginTop: 4 }}>
        {DOW.map((d) => (
          <Txt key={d} v="t11" color="muted" center style={{ flex: 1, fontFamily: fonts.bodySemi }}>
            {d.slice(0, 2)}
          </Txt>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
        {cells.map((d, i) => {
          if (d === null) return <View key={`e${i}`} style={{ width: "14.2857%", height: 44 }} />;
          const off = d < dayOf(min) || d > max;
          const on = d === value;
          const inRange = rangeFrom !== undefined && d >= rangeFrom && d <= value;
          const isStart = rangeFrom !== undefined && d === rangeFrom;
          return (
            <Pressable
              key={d}
              testID={`cal-day-${new Date(d).getDate()}`}
              accessibilityRole="button"
              accessibilityLabel={dayLabel(d)}
              accessibilityState={{ disabled: off, selected: on }}
              disabled={off}
              onPress={() => onPick(d)}
              style={{ width: "14.2857%", height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: on || isStart ? c.ink : inRange ? c.surface2 : "transparent",
                  borderWidth: d === today && !on ? 1.5 : 0,
                  borderColor: c.line,
                }}
              >
                <Txt style={{ fontFamily: on ? fonts.bodyBold : fonts.bodyMedium, fontSize: 15, color: on || isStart ? c.bg : off ? c.line : c.ink }}>{new Date(d).getDate()}</Txt>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Btn label="Done" kind="sec" onPress={onClose} style={{ marginTop: 12 }} testID="btn-cal-done" />
    </Sheet>
  );
}

export { addDays };
