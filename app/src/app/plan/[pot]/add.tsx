/** 18 Add money to the pot: type in your own currency, see exactly what the pot gets in dollars. */
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import type { Address } from "viem";
import * as A from "../../../lib/chain/actions";
import { hhmmUtc } from "../../../lib/core/format";
import { currencyFor, formatFixed, formatRate, formatUsd, invertRateE8, localE8ToUsd, parseAmount } from "../../../lib/domain/currency";
import { qk, queryClient, useBalance, useMe, usePlan } from "../../../lib/state/data";
import { useAction } from "../../../lib/state/useAction";
import { useColors } from "../../../theme/ThemeProvider";
import { Banner, Btn, Card, Chip, ListItem, Radio, Row, Skel, Tile } from "../../../ui/kit";
import { Keypad } from "../../../ui/Keypad";
import { AppBar, Screen } from "../../../ui/layout";
import { useMoney } from "../../../ui/plan/common";
import { showToast } from "../../../ui/Toast";
import { Txt } from "../../../ui/Text";

export default function AddMoney() {
  const { pot: potParam } = useLocalSearchParams<{ pot: string }>();
  const pot = (potParam ?? "").toLowerCase();
  const c = useColors();
  const plan = usePlan(pot);
  const me = useMe();
  const bal = useBalance();
  const money = useMoney();
  const cur = money.currency;
  const hasLocal = cur !== "USD";
  const [inDollars, setInDollars] = useState(!hasLocal);
  const [text, setText] = useState("");
  const rate = money.rateE8;
  const ccy = currencyFor(inDollars ? "USD" : cur);

  // amount in AUSD units
  let units = 0n;
  if (inDollars) units = parseAmount(text || "0", 6) ?? 0n;
  else if (rate) units = localE8ToUsd(parseAmount(text || "0", 8) ?? 0n, rate);
  const balance = bal.data ?? 0n;
  const short = units > balance;
  const typed = text === "" ? "0" : text;
  const shown = `${ccy.symbol}${typed}`;
  const shownFull = formatFixed(parseAmount(typed, ccy.decimals === 0 ? 0 : 2) ?? 0n, ccy.decimals === 0 ? 0 : 2, ccy.code);

  const add = useAction(async (u: bigint) => {
    const r = await A.contribute(pot as Address, u);
    void queryClient.invalidateQueries({ queryKey: qk.plan(pot) });
    void queryClient.invalidateQueries({ queryKey: qk.balance(me.address) });
    void queryClient.invalidateQueries({ queryKey: qk.myPlans(me.address) });
    return r;
  });

  const confirm = async () => {
    const r = await add.run(units);
    if (!r) return;
    showToast({ title: `You added ${formatUsd(units)}`, sub: plan.data?.meta.name ?? "To the pot", emoji: "💸" });
    router.canGoBack() ? router.back() : router.replace({ pathname: "/plan/[pot]", params: { pot } });
  };

  const swap = () => {
    setInDollars(!inDollars);
    setText("");
  };

  const rateLine = hasLocal && rate && money.fx ? `Rate ${formatRate(cur, "USD", invertRateE8(rate))}${money.fx.source ? ` · ${money.fx.source}` : ""} ${hhmmUtc(money.fx.timestamp)}` : undefined;
  const canAdd = units > 0n && !short && !!plan.data?.isMember && !plan.data?.settled;

  return (
    <Screen testID="screen-add-money" scroll>
      <AppBar icon="x" title={plan.data ? `Add to ${plan.data.meta.name} pot` : "Add to the pot"} />
      <View style={{ alignItems: "center", marginTop: 16 }}>
        <Row gap={2}>
          <Txt v="d56" tnum testID="add-amount" accessibilityLabel={`${shownFull} typed`}>
            {shown}
          </Txt>
          <View style={{ width: 3, height: 48, backgroundColor: c.accent, marginLeft: 2 }} />
        </Row>
        <Txt v="t17" style={{ marginTop: 8 }} testID="add-pot-gets">
          {inDollars ? (hasLocal && money.local(units) ? `That's about ${money.local(units)}` : "The pot gets this in dollars") : rate ? `The pot gets ${formatUsd(units)}` : "Getting today's rate…"}
        </Txt>
        {rateLine ? (
          <Txt v="mono11" color="muted" style={{ marginTop: 8 }}>
            {rateLine}
          </Txt>
        ) : null}
        {hasLocal ? (
          <View style={{ marginTop: 10 }}>
            <Chip sm icon="swap" label={inDollars ? `Type in ${currencyFor(cur).plural}` : "Type in dollars"} onPress={swap} testID="swap-currency" />
          </View>
        ) : null}
      </View>

      <Card style={{ marginTop: 20, paddingVertical: 4 }}>
        <Txt v="ov" color="muted" style={{ paddingTop: 12 }}>
          Pay with
        </Txt>
        {bal.isLoading ? (
          <View style={{ paddingVertical: 14 }}>
            <Skel w="70%" h={16} />
          </View>
        ) : (
          <ListItem
            last
            dim={short}
            left={<Tile icon="ticket" />}
            title="Your Plans account"
            sub={`${money.both(balance)}${short ? " · not enough" : ""}`}
            right={<Radio on={!short} />}
            testID="pay-with-account"
          />
        )}
      </Card>
      {short && !bal.isLoading ? (
        <View style={{ marginTop: 8 }}>
          <Btn label="Add to your balance" kind="sec" icon="plus" sm onPress={() => router.push("/add-balance")} testID="btn-add-to-balance" />
        </View>
      ) : null}
      {add.error ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title={add.error.title} text={add.error.message} testID="banner-add-error" />
        </View>
      ) : null}
      {plan.data && !plan.data.isMember ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="mut" icon="info" title="Only people in the plan can add money" />
        </View>
      ) : null}

      <View style={{ flex: 1, minHeight: 12 }} />
      <Keypad value={text} onChange={setText} decimals={inDollars ? 2 : ccy.decimals} max={7} />
      <Btn label={units > 0n ? `Add ${shownFull}` : "Add"} disabled={!canAdd} loading={add.busy} onPress={() => void confirm()} style={{ marginTop: 8 }} />
    </Screen>
  );
}
