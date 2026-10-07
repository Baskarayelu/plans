/** Shared building blocks for plan screens (header with wristband, people, money lines). */
import React from "react";
import { View } from "react-native";
import { formatUsd } from "../../lib/domain/currency";
import { CATEGORIES } from "../../lib/domain/rules";
import type { Person, PlanVM } from "../../lib/state/data";
import { Avatar, AvatarStack, Chip, DemoTag, IconBtn, Row, Wristband } from "../kit";
import { AppBar, Bleed } from "../layout";
import { useLocal } from "../money";
import { Txt } from "../Text";
import { dateRange } from "../planBits";
import { fonts } from "../../theme/tokens";

export function PersonAvatar({ p, size = 40, flag = true, ring }: { p: Person; size?: number; flag?: boolean; ring?: boolean }) {
  return <Avatar initial={p.initial} color={p.color} size={size} flag={flag ? p.flag : undefined} ring={ring} />;
}

export function People({ people, size = 28 }: { people: Person[]; size?: number }) {
  return <AvatarStack people={people.map((p) => ({ initial: p.initial, color: p.color }))} size={size} />;
}

/** "Maya" / "Maya (you)" with a Demo tag for demo members. */
export function PersonName({ p, you = true, v = "lt" }: { p: Person; you?: boolean; v?: "lt" | "t13" | "t15" | "d17" }) {
  return (
    <Row gap={0}>
      <Txt v={v} numberOfLines={1}>
        {p.name}
        {you && p.me ? " (you)" : ""}
      </Txt>
      {p.demo ? <DemoTag /> : null}
    </Row>
  );
}

export function planBand(plan: PlanVM): string {
  const d = plan.raw;
  const start = Number(d.startTime);
  const end = Number(d.endTime);
  const n = d.activeMemberCount;
  const countries = d.countries.filter(Boolean).length;
  const ppl = `${n} ${n === 1 ? "person" : "people"}${countries > 1 ? ` · ${countries} countries` : ""}`;
  if (plan.settled) return `Settled · ${ppl}`;
  if (plan.ended) return `Ended ${dateRange(end, end).split("–").pop()} · checking`;
  if (plan.now < start) return `Starts ${dateRange(start, start).split("–").pop()} · ${ppl}`;
  const days = Math.max(1, Math.ceil((end - start) / 86400));
  const day = Math.min(days, Math.floor((plan.now - start) / 86400) + 1);
  return `Day ${day} of ${days} · ${ppl}`;
}

/** Plan app bar (emoji + name, people and ⋯ buttons) with the full-bleed wristband under it. */
export function PlanTop({ plan, right, band, onMore, onPeople }: { plan: PlanVM; right?: React.ReactNode; band?: string; onMore?: () => void; onPeople?: () => void }) {
  return (
    <>
      <AppBar
        title={
          <Row gap={0}>
            <Txt numberOfLines={1} style={{ fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 22, flexShrink: 1 }}>
              {plan.meta.emoji} {plan.meta.name}
            </Txt>
            {plan.meta.demo || plan.raw.isDemo ? <DemoTag /> : null}
          </Row>
        }
        right={
          right ?? (
            <>
              {onPeople ? <IconBtn name="users" label="Members and rules" onPress={onPeople} testID="btn-plan-members" /> : null}
              {onMore ? <IconBtn name="more" label="More" onPress={onMore} testID="btn-plan-more" /> : null}
            </>
          )
        }
      />
      <Bleed>
        <Wristband color={plan.meta.color} text={band ?? planBand(plan)} />
      </Bleed>
    </>
  );
}

export function CategoryChips({ value, onChange }: { value: number; onChange: (c: number) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {CATEGORIES.map((c) => (
        <Chip key={c.id} label={`${c.emoji} ${c.name}`} on={c.id === value} onPress={() => onChange(c.id)} testID={`chip-category-${c.id}`} />
      ))}
    </View>
  );
}

/** "$36.00 · £26.72" for the viewer's currency. */
export function useMoney() {
  const local = useLocal();
  return {
    both: (u: bigint, o: { sign?: boolean } = {}) => {
      const l = local.fmt(u, o);
      return l ? `${formatUsd(u, o)} · ${l}` : formatUsd(u, o);
    },
    usd: (u: bigint, o: { sign?: boolean } = {}) => formatUsd(u, o),
    local: (u: bigint, o: { sign?: boolean } = {}) => local.fmt(u, o),
    localOrUsd: (u: bigint, o: { sign?: boolean } = {}) => local.fmt(u, o) ?? formatUsd(u, o),
    currency: local.currency,
    rateE8: local.rateE8,
    fx: local.fx,
  };
}
