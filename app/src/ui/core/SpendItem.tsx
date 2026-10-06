/** A spend in a plan's feed (16 "Live" and the All spends list). */
import { router } from "expo-router";
import React from "react";
import { View } from "react-native";
import type { SpendRow } from "../../lib/api/envio";
import { fromHex } from "../../lib/crypto/bytes";
import { decodeMemo } from "../../lib/crypto/seal";
import { formatUsd } from "../../lib/domain/currency";
import { categoryOf } from "../../lib/domain/rules";
import { splitParts } from "../../lib/domain/settlement";
import { personFor, type PlanVM } from "../../lib/state/data";
import { Btn, Chip, ListItem, Row } from "../kit";
import { PersonAvatar, useMoney } from "../plan/common";
import { ago } from "../planBits";
import { Txt } from "../Text";

export function spendNote(plan: PlanVM, s: SpendRow): string | undefined {
  if (!s.memo || s.memo === "0x") return undefined;
  try {
    return decodeMemo(plan.gk ?? undefined, plan.pot, "memo", fromHex(s.memo))?.text || undefined;
  } catch {
    return undefined;
  }
}

export function myShare(plan: PlanVM, s: SpendRow): bigint | undefined {
  const me = plan.me;
  const members = (s.splitMembers ?? []).map((m) => m.toLowerCase());
  if (!me || !members.length) return undefined;
  const i = members.indexOf(me);
  if (i < 0) return undefined;
  const weights = (s.splitWeights ?? []).map((w) => Number(w));
  if (weights.length !== members.length || weights.some((w) => !(w > 0))) return undefined;
  return splitParts(BigInt(s.amount), weights)[i];
}

export function isWaiting(s: SpendRow): boolean {
  return s.status === "Pending" || s.status === "Approved";
}

/** True when this person still has to OK the spend. */
export function needsMyOk(plan: PlanVM, s: SpendRow): boolean {
  const me = plan.me;
  if (!me || !plan.isMember || !isWaiting(s) || s.status === "Approved") return false;
  if (s.proposer_id.toLowerCase() === me) return false;
  return !(s.votes ?? []).some((v) => v.account_id.toLowerCase() === me);
}

export function SpendItem({ plan, s, highlight, last, isNew }: { plan: PlanVM; s: SpendRow; highlight?: boolean; last?: boolean; isNew?: boolean }) {
  const money = useMoney();
  const who = plan.people[s.proposer_id.toLowerCase()] ?? personFor(s.proposer_id, { me: plan.me });
  const amount = BigInt(s.amount);
  const note = spendNote(plan, s);
  const name = who.me ? "You" : who.name;
  const cat = categoryOf(s.category);
  const split = s.splitMembers?.length ?? 0;
  const share = myShare(plan, s);
  const waiting = isWaiting(s);
  const cancelled = s.status === "Cancelled";
  const disputed = !!s.hasOpenDispute;
  const verb = waiting ? (who.me ? "want" : "wants") : "paid";
  let title = `${name} ${verb} ${formatUsd(amount)}`;
  if (s.kind === "PERSONAL") title += " (recorded)";
  if (s.kind === "LINK") title += " by pay link";
  if (note) title += ` · ${note}`;

  let sub: React.ReactNode;
  if (cancelled) sub = "Didn't go ahead";
  else if (waiting) {
    const more = Math.max(0, s.approvalsRequired - s.approvals);
    sub = (
      <Txt v="t13" color="info" weight="bold">
        {s.status === "Approved" ? "Agreed · waiting to pay" : more === 1 ? "Needs 1 more OK" : `Needs ${more} more OKs`}
      </Txt>
    );
  } else {
    const parts = [`${cat.emoji} ${cat.name}`];
    if (split > 0) parts.push(`split ${split}`);
    if (share !== undefined && share > 0n) parts.push(`your share ${money.localOrUsd(share)}`);
    sub = (
      <Row gap={6}>
        <Txt v="t13" color="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
          {parts.join(" · ")}
        </Txt>
        {disputed ? <Chip sm tone="neg" label="Questioned" /> : null}
      </Row>
    );
  }

  const at = s.executedAt ?? s.proposedAt ?? 0;
  const showReview = needsMyOk(plan, s);
  const open = () => router.push({ pathname: "/plan/[pot]/spend/[id]", params: { pot: plan.pot, id: s.spendId } });

  return (
    <ListItem
      testID={`feed-item-${s.spendId}`}
      highlight={highlight}
      last={last}
      dim={cancelled}
      align="flex-start"
      left={<PersonAvatar p={who} size={36} flag={false} />}
      title={
        <Row gap={6} wrap>
          <Txt v="lt" style={{ flexShrink: 1 }}>
            {title}
          </Txt>
          {isNew ? <Chip sm tone="acc" label="New" /> : null}
        </Row>
      }
      sub={sub}
      right={
        showReview ? (
          <Btn
            label="Review"
            kind="sec"
            sm
            style={{ height: 40 }}
            onPress={() => router.push({ pathname: "/plan/[pot]/approve/[id]", params: { pot: plan.pot, id: s.spendId } })}
            testID={`btn-review-${s.spendId}`}
          />
        ) : (
          <View>
            <Txt v="t13" color="muted">
              {at ? ago(at) : ""}
            </Txt>
          </View>
        )
      }
      onPress={open}
    />
  );
}
