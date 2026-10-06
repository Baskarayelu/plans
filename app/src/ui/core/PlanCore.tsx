/** Building blocks shared by the plan-core screens (16, 17, 60). */
import React from "react";
import { View } from "react-native";
import type { PlanDetail } from "../../lib/api/envio";
import type { Rules } from "../../lib/chain/eip712";
import { formatLocal, formatUsd } from "../../lib/domain/currency";
import { PRESETS, rulesFromIndexer, type PresetId } from "../../lib/domain/rules";
import { useFxMap, type Person, type PlanVM } from "../../lib/state/data";
import { Btn, Card, IconBtn, Row, Skel, Wristband } from "../kit";
import { AppBar, Bleed } from "../layout";
import { Txt } from "../Text";
import { useColors } from "../../theme/ThemeProvider";

/** The plan's current rules from the indexer row. */
export function currentRules(raw: Pick<PlanDetail, "instantMax" | "oneApprovalMax" | "highTier" | "memberDailyCap" | "memberTotalCap" | "payeePolicy" | "minContribution" | "proposalTtl" | "ruleTimelock" | "categoryBudgets">): Rules {
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
}

/** Name of the preset these rules match, if any ("Balanced"), else "Custom". */
export function presetName(r: Rules): string {
  for (const id of ["easygoing", "balanced", "strict", "pilot", "demo"] as PresetId[]) {
    const p = PRESETS[id].rules;
    if (
      p.instantMax === r.instantMax &&
      p.oneApprovalMax === r.oneApprovalMax &&
      p.highTier === r.highTier &&
      p.memberDailyCap === r.memberDailyCap &&
      p.payeePolicy === r.payeePolicy &&
      p.categoryBudgets.every((x, i) => x === r.categoryBudgets[i])
    )
      return PRESETS[id].title;
  }
  return "Custom";
}

/** Formats amounts in each member's own currency (falls back to dollars until the rate loads). */
export function useTheirMoney(people: Person[]) {
  const fx = useFxMap(people.map((p) => p.currency));
  return (p: Person, units: bigint, opts: { sign?: boolean } = {}) => formatLocal(units, p.currency, fx[p.currency], opts) ?? formatUsd(units, opts);
}

export function activePeople(plan: PlanVM): Person[] {
  return plan.raw.members.filter((m) => m.status === "Active").map((m) => plan.people[m.address.toLowerCase()]).filter((p): p is Person => !!p);
}

/** 60 Loading: skeletons in the exact shape of plan home; the title shows when it is known. */
export function PlanSkeleton({ title, color, slow, onRetry }: { title?: string; color?: string; slow?: boolean; onRetry?: () => void }) {
  const c = useColors();
  return (
    <View testID="plan-loading">
      <AppBar
        title={title ?? undefined}
        right={
          <>
            <IconBtn name="users" label="Members and rules" />
            <IconBtn name="more" label="More" />
          </>
        }
      />
      {!title ? <Skel w="50%" h={18} style={{ position: "absolute", left: 56, top: 23 }} /> : null}
      <Bleed>
        <Wristband color={color ?? c.skel} text=" " />
      </Bleed>
      {slow ? (
        <View style={{ marginTop: 12 }}>
          <Txt v="t13" color="muted">
            Taking a while…
          </Txt>
          {onRetry ? <Btn label="Try again" kind="sec" icon="refresh" sm onPress={onRetry} style={{ marginTop: 6, height: 40 }} testID="btn-plan-loading-retry" /> : null}
        </View>
      ) : null}
      <Card style={{ marginTop: 12 }}>
        <Skel w="30%" h={10} />
        <Skel w="55%" h={34} style={{ marginTop: 10 }} />
        <Skel w="40%" h={24} r={999} style={{ marginTop: 14 }} />
      </Card>
      <Row between style={{ marginTop: 16 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={{ alignItems: "center" }}>
            <Skel w={44} h={44} r={999} />
            <Skel w={44} h={10} r={6} style={{ marginTop: 8 }} />
          </View>
        ))}
      </Row>
      <Card style={{ marginTop: 16 }}>
        <Skel w="35%" h={16} />
        {[0, 1, 2, 3].map((i) => (
          <Skel key={i} w="100%" h={8} r={999} style={{ marginTop: 20 }} />
        ))}
      </Card>
      <Skel w="25%" h={16} style={{ marginTop: 24 }} />
      {[0, 1, 2].map((i) => (
        <Row key={i} style={{ marginTop: 16 }}>
          <Skel w={36} h={36} r={999} />
          <View style={{ flex: 1 }}>
            <Skel w="80%" h={12} />
            <Skel w="50%" h={10} r={6} style={{ marginTop: 8 }} />
          </View>
        </Row>
      ))}
    </View>
  );
}
