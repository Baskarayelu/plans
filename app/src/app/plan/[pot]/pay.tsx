/** 20 Pay: who. A friend in the plan, a business (scan or paid before), or someone outside by link. */
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { PayeePolicy } from "../../../lib/chain/eip712";
import { formatUsd, formatUsdShort } from "../../../lib/domain/currency";
import { contactFor } from "../../../lib/domain/groups";
import { rememberCode } from "../../../lib/domain/planOps";
import { categoryOf } from "../../../lib/domain/rules";
import { activeMembers, planRules } from "../../../lib/spend/hooks";
import { paidBefore } from "../../../lib/spend/logic";
import { usePlan, type PlanVM } from "../../../lib/state/data";
import { useColors } from "../../../theme/ThemeProvider";
import { Icon } from "../../../ui/Icon";
import { Banner, Btn, Btns, Card, EmojiTile, Field, ListItem, Overline, Row, Tile } from "../../../ui/kit";
import { Columns } from "../../../ui/desk/plan";
import { Crumbs } from "../../../ui/shell/desk";
import { useLayout } from "../../../ui/shell/responsive";
import { AppBar, Screen } from "../../../ui/layout";
import { PersonAvatar } from "../../../ui/plan/common";
import { BusinessScanner } from "../../../ui/spend/BusinessScanner";
import { PlanGate } from "../../../ui/spend/parts";
import { Txt } from "../../../ui/Text";

export default function PayWho() {
  const { pot, amount } = useLocalSearchParams<{ pot: string; amount?: string }>();
  const q = usePlan(pot);
  return (
    <PlanGate q={q} title="Pay from the pot" testID="screen-pay">
      {(plan) => <PayWhoBody plan={plan} amount={amount && /^\d+$/.test(amount) ? amount : undefined} />}
    </PlanGate>
  );
}

function PayWhoBody({ plan, amount }: { plan: PlanVM; amount?: string }) {
  const c = useColors();
  const { desk } = useLayout();
  const [q, setQ] = useState("");
  const [scan, setScan] = useState(false);
  const rules = planRules(plan.raw);
  const active = activeMembers(plan);
  const friends = active.filter((a) => a !== plan.me).map((a) => plan.people[a]);
  const businessesAllowed = rules.payeePolicy !== PayeePolicy.MEMBERS_ONLY;
  const before = useMemo(() => paidBefore(plan.raw.recent, plan.raw.members.map((m) => m.address)), [plan.raw.recent, plan.raw.members]);
  const needle = q.trim().toLowerCase();
  const shownFriends = friends.filter((p) => !needle || p.name.toLowerCase().includes(needle));
  const shownBefore = before
    .map((b) => ({ ...b, name: contactFor(b.payee)?.name }))
    .filter((b) => !needle || (b.name ?? "paid before").toLowerCase().includes(needle) || categoryOf(b.category).name.toLowerCase().includes(needle));
  const balance = BigInt(plan.raw.balance);
  const closed = plan.settled || plan.ended || !plan.isMember;

  const goForm = (params: { payee?: string; kind: "PAY" | "LINK"; name?: string; category?: number; amount?: string }) =>
    router.push({
      pathname: "/plan/[pot]/pay-form",
      params: {
        pot: plan.pot,
        kind: params.kind,
        payee: params.payee ?? "",
        name: params.name ?? "",
        category: params.category !== undefined ? String(params.category) : "",
        amount: params.amount ?? amount ?? "",
      },
    });

  return (
    <Screen testID="screen-pay">
      {desk ? (
        <View style={{ marginBottom: 16 }}>
          <Crumbs items={[{ label: "Plans", href: "/" }, { label: plan.meta.name, href: { pathname: "/plan/[pot]", params: { pot: plan.pot } } }, { label: "Pay" }]} />
          <Txt v="d34" style={{ marginTop: 8 }}>
            Pay from the pot
          </Txt>
          <Txt v="t15" color="muted" style={{ marginTop: 4 }}>
            {plan.meta.name} · {formatUsd(balance)} left · who are you paying?
          </Txt>
        </View>
      ) : (
        <AppBar icon="x" title="Pay from the pot" sub={`${plan.meta.name} · ${formatUsd(balance)} left`} />
      )}
      {closed ? (
        <Banner
          kind="mut"
          icon="info"
          title={!plan.isMember ? "You're not in this plan anymore" : "Spending is closed"}
          text={plan.settled ? "This plan is settled." : plan.ended ? "The plan has ended. Everyone is checking the numbers." : "Only people in the plan can pay from the pot."}
          testID="banner-closed"
        />
      ) : null}
      {plan.frozen && !closed ? (
        <Banner kind="mut" icon="pause" title="The plan is paused" text="Nothing can leave the pot until the group votes to resume." testID="banner-paused">
          <View style={{ marginTop: 8 }}>
            <Btns>
              <Btn label="Vote to resume" kind="pri" sm flex onPress={() => router.dismissTo({ pathname: "/plan/[pot]", params: { pot: plan.pot } })} />
            </Btns>
          </View>
        </Banner>
      ) : null}
      {!closed ? (
        <>
          <View style={{ marginTop: plan.frozen ? 12 : 0, maxWidth: desk ? 480 : undefined }}>
            <Field
              value={q}
              onChangeText={setQ}
              placeholder="Search people or businesses"
              testID="field-search"
              right={<Icon name="search" size={20} color={c.muted} />}
            />
          </View>

          {shownFriends.length ? (
            <>
              <Overline style={{ marginTop: 20 }}>Someone in the plan</Overline>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 20, marginTop: 12 }}>
                {shownFriends.map((p) => (
                  <Pressable
                    key={p.address}
                    testID={`payee-member-${active.indexOf(p.address)}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Pay ${p.name}`}
                    onPress={() => goForm({ payee: p.address, kind: "PAY", name: p.name })}
                    style={{ alignItems: "center", width: 64 }}
                  >
                    <PersonAvatar p={p} size={48} />
                    <Txt v="t13" weight="bold" numberOfLines={1} style={{ marginTop: 8 }}>
                      {p.name}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {businessesAllowed ? (
            <>
              <Overline style={{ marginTop: 24 }}>A business</Overline>
              {!needle && !desk ? (
                <ListItem
                  testID="btn-scan-business"
                  left={<Tile icon="scan" kind="a" />}
                  title="Scan a business's Plans code"
                  sub="Cafés, tours and hostels that take Plans"
                  right={<Icon name="chev" size={20} />}
                  onPress={() => setScan(true)}
                />
              ) : null}
              {desk ? (
                <Columns
                  items={[...(!needle ? ["scan" as const] : []), ...shownBefore.map((b, i) => ({ b, i }))]}
                  gap={12}
                  style={{ marginTop: 8 }}
                  render={(x) =>
                    x === "scan" ? (
                      <Card p={12} onPress={() => setScan(true)} testID="btn-scan-business" a11y="Scan a business's Plans code" style={{ flex: 1 }}>
                        <Row>
                          <Tile icon="scan" kind="a" />
                          <View style={{ flex: 1 }}>
                            <Txt v="lt">Scan a business's Plans code</Txt>
                            <Txt v="t13" color="muted">
                              Or upload a photo of it
                            </Txt>
                          </View>
                        </Row>
                      </Card>
                    ) : (
                      <Card p={12} onPress={() => goForm({ payee: x.b.payee, kind: "PAY", name: x.b.name ?? "", category: x.b.category })} testID={`payee-before-${x.i}`} a11y={x.b.name ?? "Paid before"} style={{ flex: 1 }}>
                        <Row>
                          <EmojiTile emoji={categoryOf(x.b.category).emoji} color={plan.meta.color} size={40} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Txt v="lt" numberOfLines={1}>
                              {x.b.name ?? "Paid before"}
                            </Txt>
                            <Txt v="t13" color="muted" numberOfLines={1}>
                              {`${x.b.name ? "Paid before · " : ""}${categoryOf(x.b.category).name} · last ${formatUsdShort(x.b.amount)}`}
                            </Txt>
                          </View>
                        </Row>
                      </Card>
                    )
                  }
                />
              ) : null}
              {(desk ? [] : shownBefore).map((b, i) => {
                const cat = categoryOf(b.category);
                return (
                  <ListItem
                    key={b.payee}
                    testID={`payee-before-${i}`}
                    left={<EmojiTile emoji={cat.emoji} color={plan.meta.color} size={40} />}
                    title={b.name ?? "Paid before"}
                    sub={`${b.name ? "Paid before · " : ""}${cat.name} · last ${formatUsdShort(b.amount)}`}
                    right={<Icon name="chev" size={20} />}
                    onPress={() => goForm({ payee: b.payee, kind: "PAY", name: b.name ?? "", category: b.category })}
                    last={i === shownBefore.length - 1}
                  />
                );
              })}
            </>
          ) : null}

          {!needle || "pay link someone outside".includes(needle) ? (
            <>
              <Overline style={{ marginTop: 24 }}>Someone outside the plan</Overline>
              <ListItem
                testID="btn-send-a-pay-link"
                left={<Tile icon="link" />}
                title="Send a pay link"
                sub="They claim it in their own money. No app needed to start."
                right={<Icon name="chev" size={20} />}
                onPress={() => goForm({ kind: "LINK" })}
                last
              />
            </>
          ) : null}

          {needle && !shownFriends.length && !shownBefore.length ? (
            <Txt v="t15" color="muted" style={{ marginTop: 16 }} testID="search-empty">
              No one matches “{q.trim()}”.
            </Txt>
          ) : null}

          <View style={{ flex: 1, minHeight: 24 }} />
          <View style={desk ? { maxWidth: 680 } : undefined}>
          <Banner
            kind="inf"
            icon="info"
            testID="banner-instant"
            title={rules.instantMax > 0n ? `Under ${formatUsdShort(rules.instantMax)} goes through now` : "Every spend needs a friend's OK"}
            text={rules.instantMax > 0n ? "Bigger spends wait for a friend's OK." : "The money stays in the pot until someone says yes."}
          />
          </View>
        </>
      ) : null}

      <BusinessScanner
        visible={scan}
        onClose={() => setScan(false)}
        onCode={(code) => {
          setScan(false);
          rememberCode(code.address, { name: code.name, city: code.city, country: code.country, currency: code.currency });
          goForm({ payee: code.address, kind: "PAY", name: code.name ?? "", amount: code.amount && /^\d+$/.test(code.amount) ? code.amount : undefined });
        }}
      />
    </Screen>
  );
}
