/** 37 Plan ended: review. Everyone checks the numbers ("Looks right" = Pot.ack) before settle-up. */
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Pressable, View } from "react-native";
import type { Address } from "viem";
import { RelayError } from "../../../lib/api/relayer";
import { ack } from "../../../lib/chain/actions";
import { formatUsd } from "../../../lib/domain/currency";
import { ackStatus, hasAcked, openItems } from "../../../lib/ending/planChecks";
import { queryClient, qk, usePlan } from "../../../lib/state/data";
import { useAction } from "../../../lib/state/useAction";
import { useColors } from "../../../theme/ThemeProvider";
import { dayMonth, personOf, PlanProblem, PlanSkeleton, spendLabel, timeOfDay, useCanSettle } from "../../../ui/ending/common";
import { Icon } from "../../../ui/Icon";
import { Banner, Btn, Btns, Card, Hr, ListItem, Overline, Row } from "../../../ui/kit";
import { Screen } from "../../../ui/layout";
import { PositionChip } from "../../../ui/planBits";
import { PersonAvatar, PersonName, PlanTop } from "../../../ui/plan/common";
import { Txt } from "../../../ui/Text";

export default function ReviewPlan() {
  const { pot } = useLocalSearchParams<{ pot: string }>();
  const q = usePlan(pot);
  const c = useColors();
  const plan = q.data ?? undefined;
  const settleQ = useCanSettle(pot, !!plan && !plan.settled);
  const act = useAction(async () => {
    try {
      await ack(pot as Address);
    } catch (e) {
      if (!(e instanceof RelayError && e.code === "ALREADY_ACKED")) throw e;
    }
    await queryClient.invalidateQueries({ queryKey: qk.plan(pot) });
    void settleQ.refetch();
    return true;
  });

  if (q.isLoading) return <PlanSkeleton title="Check the numbers" />;
  if (q.isError || !plan) return <PlanProblem title="Check the numbers" missing={!q.isError} onRetry={() => void q.refetch()} />;
  const d = plan.raw;
  const acks = ackStatus(d);
  const okCount = acks.filter((a) => a.acked).length;
  const iAcked = hasAcked(d, plan.me);
  const items = openItems(d);
  const can = settleQ.data === true;
  const end = Number(d.endTime);
  const opensAt = end + Number(d.reviewWindow ?? 0);
  const net = plan.myMember ? BigInt(plan.myMember.net) : 0n;
  const goSettle = () => router.push({ pathname: "/plan/[pot]/settle", params: { pot: plan.pot } });
  const goSpends = () => router.push({ pathname: "/plan/[pot]/spends", params: { pot: plan.pot } });

  const band = plan.settled ? undefined : plan.ended ? `Ended ${dayMonth(end)} · checking` : `Ends ${dayMonth(end)} · checking early`;
  const title = plan.ended || plan.settled ? `${plan.meta.name} has ended. Does it look right?` : `End ${plan.meta.name} early?`;
  const intro = plan.settled
    ? "This plan is settled. Everyone has been paid."
    : plan.ended
      ? opensAt > plan.now
        ? `Check the spends before anyone is paid. Settle-up opens when everyone agrees, or at ${timeOfDay(opensAt)} on ${dayMonth(opensAt)}.`
        : "Check the spends before anyone is paid. Settle-up is open now, and opens straight away once everyone agrees."
      : `If everyone says it looks right, you can settle up now instead of waiting for ${dayMonth(end)}. A new spend resets the checks.`;

  let dock: React.ReactNode;
  if (plan.settled) dock = <Btn label="See the settle-up" icon="check" onPress={goSettle} testID="btn-see-the-settle-up" />;
  else if (can && (iAcked || !plan.isMember || plan.ended))
    dock = (
      <>
        <Btn label="See the settle-up" icon="check" onPress={goSettle} testID="btn-see-the-settle-up" />
        {plan.isMember && !iAcked ? <Btn label="Looks right" kind="txt" loading={act.busy} onPress={() => void act.run()} testID="btn-looks-right" /> : null}
      </>
    );
  else if (!plan.isMember) dock = <Btn label="Only members check the numbers" kind="off" disabled testID="btn-not-a-member" />;
  else if (iAcked) dock = <Btn label="You said it looks right" kind="off" icon="check" disabled testID="btn-acked" />;
  else
    dock = (
      <Btns>
        <Btn label="Something's wrong" kind="sec" onPress={goSpends} testID="btn-something-s-wrong" />
        <Btn label="Looks right" icon="check" loading={act.busy} onPress={() => void act.run()} testID="btn-looks-right" />
      </Btns>
    );

  return (
    <Screen dock={dock} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} testID="screen-review">
      <PlanTop plan={plan} band={band} right={<View />} />
      <Txt v="d28" style={{ marginTop: 16 }}>
        {title}
      </Txt>
      <Txt v="t15" color="muted" style={{ marginTop: 8, marginBottom: 16 }}>
        {intro}
      </Txt>

      <Card testID="review-stats">
        <Row between align="flex-start">
          <View>
            <Overline>Spent</Overline>
            <Txt v="d22" style={{ marginTop: 4 }} tnum>
              {formatUsd(BigInt(d.totalSpent ?? "0"))}
            </Txt>
          </View>
          <View>
            <Overline>Left</Overline>
            <Txt v="d22" style={{ marginTop: 4 }} tnum>
              {formatUsd(BigInt(d.balance))}
            </Txt>
          </View>
          <View>
            <Overline>Spends</Overline>
            <Txt v="d22" style={{ marginTop: 4 }} tnum>
              {String(d.spendCount ?? 0)}
            </Txt>
          </View>
        </Row>
        <Hr />
        <Row between>
          {plan.myMember ? <PositionChip net={net} debt={BigInt(plan.myMember.debt)} settled={plan.settled} /> : <View />}
          <Pressable onPress={goSpends} testID="link-see-all-spends" accessibilityRole="button" hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Txt v="t13" weight="bold">
              See all spends
            </Txt>
            <Icon name="chev" size={16} strokeWidth={2.2} />
          </Pressable>
        </Row>
      </Card>

      {items.length > 0 && !plan.settled ? (
        <View style={{ marginTop: 16 }}>
          <Banner
            kind="inf"
            icon="clock"
            title={items.length === 1 ? "1 thing must finish first" : `${items.length} things must finish first`}
            text="Settle-up waits for open requests and questions."
            testID="review-open-items"
          >
            <View style={{ marginTop: 4 }}>
              {items.map((i) => (
                <Pressable
                  key={`${i.kind}-${i.spendId}`}
                  onPress={() => router.push({ pathname: "/plan/[pot]/spend/[id]", params: { pot: plan.pot, id: i.spendId } })}
                  testID={`open-item-${i.kind}-${i.spendId}`}
                  accessibilityRole="button"
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 }}
                >
                  <Txt v="t13" weight="semi" style={{ flex: 1 }} numberOfLines={1}>
                    {i.kind === "spend" ? `${spendLabel(plan, i)} · waiting for an OK` : `${spendLabel(plan, i)} · being questioned`}
                  </Txt>
                  <Icon name="chev" size={16} color={c.muted} />
                </Pressable>
              ))}
            </View>
          </Banner>
        </View>
      ) : null}

      <View style={{ marginTop: 20 }}>
        <Overline>{`Who's checked · ${okCount} of ${acks.length}`}</Overline>
      </View>
      <View testID="review-acks">
        {acks
          .slice()
          .sort((a, b) => (a.address === plan.me ? 1 : b.address === plan.me ? -1 : Number(b.acked) - Number(a.acked)))
          .map((a, i, arr) => {
            const p = personOf(plan, a.address);
            if (!p) return null;
            return (
              <ListItem
                key={a.address}
                last={i === arr.length - 1}
                left={<PersonAvatar p={p} size={36} />}
                title={<PersonName p={p} />}
                sub={p.city}
                right={
                  a.acked ? (
                    <Row gap={4}>
                      <Icon name="check" size={16} strokeWidth={2.4} color={c.pos} />
                      <Txt v="t15" color="pos" weight="bold">
                        Looks right
                      </Txt>
                    </Row>
                  ) : (
                    <Txt v="t15" color="muted">
                      Not yet
                    </Txt>
                  )
                }
                testID={`ack-${a.address.slice(2, 8)}`}
              />
            );
          })}
      </View>

      {act.error ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title={act.error.title} text={act.error.message} testID="review-error" />
        </View>
      ) : null}
      {iAcked && !can && !plan.settled && items.length === 0 ? (
        <Txt v="t13" color="muted" style={{ marginTop: 12 }}>
          {plan.ended && opensAt > plan.now
            ? `Settle-up opens when everyone has checked, or at ${timeOfDay(opensAt)} on ${dayMonth(opensAt)}.`
            : "Settle-up opens when everyone has checked."}
        </Txt>
      ) : null}
    </Screen>
  );
}
