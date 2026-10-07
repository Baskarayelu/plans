import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useMemo } from "react";
import { View } from "react-native";
import { fetchMyPlans } from "../lib/api/envio";
import { formatUsd } from "../lib/domain/currency";
import { pluralCap } from "../lib/send/convert";
import { moneyRows } from "../lib/send/history";
import { useAccountActivity, useBalance, useMe } from "../lib/state/data";
import { Banner, Btn, Btns, Card, EmojiTile, ListItem, Overline, SectionHead, Skel, Tile } from "../ui/kit";
import { AppBar, Screen } from "../ui/layout";
import { useLocal } from "../ui/money";
import { AusdPill, BackingCard } from "../ui/agora/dollars";
import { MoneyRowItem, usePlanIndex } from "../ui/send/rows";
import { DeskTitle, Grid, PanelHead } from "../ui/shell/desk";
import { SidePanel } from "../ui/shell/panel";
import { useLayout } from "../ui/shell/responsive";
import { Txt } from "../ui/Text";

/** 09/140 Your Plans account: balance, what backs it, safety-net holds and recent money. */
export default function Balance() {
  const { address, currency } = useMe();
  const bal = useBalance();
  const local = useLocal();
  const act = useAccountActivity();
  const plans = usePlanIndex();
  // Safety nets are on the member row; the plan list view model doesn't carry them.
  const nets = useQuery({
    queryKey: ["safetyNets", address?.toLowerCase()],
    enabled: !!address,
    queryFn: async () => {
      const r = await fetchMyPlans(address!);
      return r.Member.filter((m) => m.status === "Active" && m.pot.status === "Active" && BigInt(m.safetyNet || "0") > 0n).map((m) => ({ pot: m.pot.id.toLowerCase(), amount: BigInt(m.safetyNet) }));
    },
    staleTime: 60_000,
  });
  const rows = useMemo(() => moneyRows(act.data, address).slice(0, 6), [act.data, address]);
  const balance = bal.data;
  const refresh = () => void Promise.all([bal.refetch(), act.refetch(), nets.refetch()]);
  const { desk } = useLayout();

  const netRows = (nets.data ?? []).map((n, i) => {
    const plan = plans.get(n.pot);
    return (
      <ListItem
        key={n.pot}
        left={plan ? <EmojiTile emoji={plan.meta.emoji} color={plan.meta.color} size={40} /> : <Tile icon="shield" />}
        title={`${plan?.meta.name ?? "Plan"} safety net`}
        sub="Only used if you owe at the end"
        right={<Txt v="lt">up to {formatUsd(n.amount)}</Txt>}
        rsub={local.fmt(n.amount)}
        onPress={plan ? () => router.push({ pathname: "/plan/[pot]", params: { pot: plan.pot } }) : undefined}
        testID={`safety-net-${n.pot.slice(2, 8)}`}
        last={i === nets.data!.length - 1}
      />
    );
  });
  const history = act.isLoading ? (
    <View style={{ gap: 12, marginTop: 6 }}>
      <Skel w="100%" h={52} />
      <Skel w="100%" h={52} />
    </View>
  ) : act.isError ? (
    <Banner kind="mut" icon="wifioff" title="Couldn't load your history" text="Check your connection.">
      <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void act.refetch()} style={{ marginTop: 8 }} testID="btn-history-retry" />
    </Banner>
  ) : rows.length === 0 ? (
    <Txt v="t15" color="muted" style={{ paddingVertical: 12 }} testID="balance-history-empty">
      Money in and out shows up here.
    </Txt>
  ) : (
    rows.map((r, i) => <MoneyRowItem key={r.id} r={r} me={address} plans={plans} variant="balance" last={i === rows.length - 1} />)
  );
  const balanceBig =
    balance === undefined ? (
      bal.isError ? (
        <Banner kind="mut" icon="wifioff" title="Couldn't load your balance" text="Check your connection.">
          <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void bal.refetch()} style={{ marginTop: 8 }} testID="btn-balance-retry" />
        </Banner>
      ) : (
        <Skel w={180} h={56} style={{ marginTop: 8 }} />
      )
    ) : (
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 8 }}>
        <Txt v="d56" tnum testID="balance-amount">
          {formatUsd(balance)}
        </Txt>
        {local.fmt(balance) && currency !== "USD" ? (
          <Txt v="t17" color="muted" weight="medium" testID="balance-local">
            {local.fmt(balance)}
          </Txt>
        ) : null}
      </View>
    );

  if (desk) {
    // 142: the balance and what's held on the left, what backs it in the panel.
    return (
      <Screen testID="screen-balance" bottomInset={false}>
        <DeskTitle
          over="You"
          title="Your Plans account"
          right={
            <>
              <Btn label="Add" icon="plus" sm onPress={() => router.push("/add-balance")} testID="btn-add" style={{ height: 42, minHeight: 42, paddingHorizontal: 14 }} />
              <Btn label="Receive" kind="sec" icon="qr" sm onPress={() => router.push("/my-code")} testID="btn-receive" style={{ height: 42, minHeight: 42, paddingHorizontal: 14 }} />
              <Btn label="Send" kind="sec" icon="send" sm onPress={() => router.push("/(tabs)/send")} testID="btn-send" style={{ height: 42, minHeight: 42, paddingHorizontal: 14 }} />
            </>
          }
        />
        <Grid cols={2} gap={16}>
          <Card style={{ padding: 24, flex: 1 }}>
            <Overline>Balance</Overline>
            {balanceBig}
            <View style={{ marginTop: 12 }}>
              <AusdPill align="flex-start" testID="pill-ausd" />
            </View>
            <Txt v="t13" color="muted" style={{ marginTop: 10 }}>
              1 digital dollar is always meant to be worth 1 US dollar.{currency !== "USD" ? ` ${pluralCap(currency)} use today's rate.` : ""}
            </Txt>
          </Card>
          <Card style={{ flex: 1, paddingBottom: 4 }} testID="held-for-plans">
            <Overline>Held for your plans</Overline>
            {netRows.length ? (
              netRows
            ) : (
              <Txt v="t15" color="muted" style={{ marginTop: 10 }}>
                Nothing is held right now. A plan's safety net shows up here when you join with one.
              </Txt>
            )}
          </Card>
        </Grid>
        <SectionHead title="Recent" right="See all" onRight={() => router.push({ pathname: "/(tabs)/activity", params: { f: "money" } })} testID="link-see-all" />
        <Card style={{ paddingVertical: 2 }}>{history}</Card>
        <View style={{ height: 24 }} />
        <SidePanel kind="live">
          <PanelHead title="What backs it" />
          <View style={{ marginTop: -16 }}>
            <BackingCard />
          </View>
          <Card tint style={{ marginTop: 12 }}>
            <Txt v="lt">Can anything go wrong?</Txt>
            <Txt v="t13" color="muted" style={{ marginTop: 4 }}>
              Agora can freeze an account or pause transfers, and Plans can't override that. Read what that means for your plans.
            </Txt>
            <Btn label="What could go wrong" kind="sec" icon="shield" sm onPress={() => router.push("/risks")} style={{ marginTop: 12 }} testID="btn-balance-what-could-go-wrong" />
          </Card>
        </SidePanel>
      </Screen>
    );
  }

  return (
    <Screen testID="screen-balance" refreshing={bal.isRefetching || act.isRefetching} onRefresh={refresh}>
      <AppBar title="Your Plans account" />
      <View style={{ alignItems: "center", marginTop: 8 }}>
        <Overline>Balance</Overline>
        {balance === undefined ? (
          bal.isError ? (
            <View style={{ marginTop: 12, alignSelf: "stretch" }}>
              <Banner kind="mut" icon="wifioff" title="Couldn't load your balance" text="Check your connection.">
                <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void bal.refetch()} style={{ marginTop: 8 }} testID="btn-balance-retry" />
              </Banner>
            </View>
          ) : (
            <Skel w={180} h={56} style={{ marginTop: 8 }} />
          )
        ) : (
          <>
            <Txt v="d56" tnum style={{ marginTop: 8 }} testID="balance-amount">
              {formatUsd(balance)}
            </Txt>
            {local.fmt(balance) && currency !== "USD" ? (
              <Txt v="t17" color="muted" weight="medium" style={{ marginTop: 4 }} testID="balance-local">
                {local.fmt(balance)}
              </Txt>
            ) : null}
          </>
        )}
        <View style={{ marginTop: 12 }}>
          <AusdPill testID="pill-ausd" />
        </View>
      </View>
      <Txt v="t13" color="muted" center style={{ marginTop: 10, marginHorizontal: 24 }}>
        1 digital dollar is always meant to be worth 1 US dollar.{currency !== "USD" ? ` ${pluralCap(currency)} use today's rate.` : ""}
      </Txt>
      <Btns style={{ marginTop: 20 }}>
        <Btn label="Add" icon="plus" sm flex onPress={() => router.push("/add-balance")} testID="btn-add" />
        <Btn label="Receive" kind="sec" icon="qr" sm flex onPress={() => router.push("/my-code")} testID="btn-receive" />
        <Btn label="Send" kind="sec" icon="send" sm flex onPress={() => router.push("/(tabs)/send")} testID="btn-send" />
      </Btns>

      <BackingCard />

      {nets.data && nets.data.length > 0 ? (
        <Card style={{ marginTop: 20, paddingBottom: 4 }} testID="held-for-plans">
          <Overline>Held for your plans</Overline>
          {netRows}
        </Card>
      ) : null}

      <SectionHead title="Recent" right="See all" onRight={() => router.push({ pathname: "/(tabs)/activity", params: { f: "money" } })} testID="link-see-all" />
      {history}
      <View style={{ height: 16 }} />
    </Screen>
  );
}
