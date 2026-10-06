/**
 * 56 Try a settle-up: intro. The relayer's demo friends (always labelled Demo) make a short plan;
 * the app then joins the person to it with their own key, and the run starts.
 */
import { router } from "expo-router";
import React from "react";
import { View } from "react-native";
import { isTestnet } from "../../config";
import { RelayError, startTrySettleUp } from "../../lib/api/relayer";
import { ausdBalance } from "../../lib/chain/rpc";
import { fromHex } from "../../lib/crypto/bytes";
import { countryByCode, currencyFor, formatUsd } from "../../lib/domain/currency";
import { joinPlan } from "../../lib/domain/planOps";
import { DEMO_SAFETY_NET, DEMO_STEPS, demoDeposit, pendingRun, usablePendingRun } from "../../lib/ending/demo";
import { currentAccount } from "../../lib/identity/session";
import { personFor, queryClient, qk, useBalance, useDemoAccounts, useMe, useMyPlans } from "../../lib/state/data";
import { useAction } from "../../lib/state/useAction";
import { WRISTBANDS } from "../../theme/tokens";
import { Band, Banner, Btn, Card, ListItem, Skel, Step } from "../../ui/kit";
import { AppBar, Bleed, Screen } from "../../ui/layout";
import { PersonAvatar, PersonName, useMoney } from "../../ui/plan/common";
import { Txt } from "../../ui/Text";

const ERR: Record<string, { title: string; text: string }> = {
  DEMO_LIMIT: { title: "That's enough demos for today", text: "You can start 3 a day. Try again tomorrow, or carry on with one you started." },
  DEMO_DISABLED: { title: "The demo isn't available right now", text: "The demo friends are switched off on this server. Try again later." },
  DEMO_NOT_CONFIGURED: { title: "The demo friends are taking a break", text: "Try again later." },
};

export default function TrySettleUp() {
  const me = useMe();
  const money = useMoney();
  const demo = useDemoAccounts();
  const bal = useBalance();
  const plans = useMyPlans();
  const resumable = plans.data?.find((p) => p.isDemo && p.status === "Active" && p.myStatus === "Active" && !p.ended);
  const deposit = demoDeposit(bal.data);

  const act = useAction(async () => {
    const acct = currentAccount(); // locked → the unlock screen, before any run is created
    const nowSec = Math.floor(Date.now() / 1000);
    let run = usablePendingRun(acct.address, nowSec);
    if (!run) {
      const res = await startTrySettleUp({ member: acct.address });
      run = { member: acct.address, pot: res.pot, inviteSecret: res.inviteSecret, createdAt: nowSec, endTime: res.endTime };
      pendingRun.set(run);
    }
    const balance = await ausdBalance(acct.address).catch(() => 0n);
    try {
      await joinPlan({ pot: run.pot, inviteSecret: fromHex(run.inviteSecret), inviteKeyWrap: "0x", deposit: demoDeposit(balance), safetyNet: DEMO_SAFETY_NET });
    } catch (e) {
      if (!(e instanceof RelayError && e.code === "ALREADY_MEMBER")) throw e;
    }
    pendingRun.set(null);
    void queryClient.invalidateQueries({ queryKey: qk.myPlans(acct.address) });
    return run.pot;
  });

  const start = async () => {
    const pot = await act.run();
    if (pot) router.replace({ pathname: "/demo/[pot]", params: { pot } });
  };

  const disabled = demo.data?.enabled === false || act.error?.code === "DEMO_DISABLED";
  const err = act.error ? (ERR[act.error.code] ?? { title: act.error.title, text: act.error.message }) : null;
  const accounts = demo.data?.accounts ?? [];

  return (
    <Screen
      testID="screen-demo-intro"
      dock={
        disabled ? (
          <Btn label="Back home" kind="sec" onPress={() => router.replace("/")} testID="btn-back-home" />
        ) : (
          <>
            {resumable ? (
              <Btn label={`Carry on with ${resumable.meta.name}`} kind="sec" onPress={() => router.replace({ pathname: "/demo/[pot]", params: { pot: resumable.pot } })} testID="btn-resume-demo" />
            ) : null}
            <Btn label="Start the demo" icon="play" loading={act.busy} disabled={demo.isLoading || !me.address} onPress={() => void start()} testID="btn-start-the-demo" />
          </>
        )
      }
    >
      <AppBar icon="x" onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      <Bleed style={{ overflow: "hidden", paddingVertical: 10 }}>
        <Band color={WRISTBANDS.coral} text="DEMO · TRY A SETTLE-UP · 2 MIN" style={{ marginHorizontal: -40, transform: [{ rotate: "-3deg" }], justifyContent: "center" }} />
      </Bleed>
      <Txt v="d34" style={{ marginTop: 20 }}>
        Try a settle-up in 2 minutes
      </Txt>
      <Txt v="t15" color="muted" style={{ marginTop: 8, marginBottom: 16 }}>
        We'll make a plan with three demo friends. They're run by Plans, not real people. Watch them spend, check the numbers together, then settle up in one tap.
      </Txt>

      {disabled ? (
        <Banner kind="mut" icon="info" title="The demo isn't available right now" text="The demo friends are switched off at the moment. Everything else in Plans works as usual." testID="demo-disabled" />
      ) : (
        <Card style={{ paddingVertical: 4 }} testID="demo-friends">
          {demo.isLoading
            ? [0, 1, 2].map((i) => (
                <View key={i} style={{ flexDirection: "row", gap: 12, alignItems: "center", minHeight: 64 }}>
                  <Skel w={40} h={40} r={20} />
                  <Skel w="55%" h={16} />
                </View>
              ))
            : accounts.map((a, i) => {
                const p = { ...personFor(a.address, { country: a.country }), demo: true };
                const cur = currencyFor(countryByCode(a.country)?.currency);
                return (
                  <ListItem
                    key={a.address}
                    last={i === accounts.length - 1}
                    left={<PersonAvatar p={p} size={40} />}
                    title={<PersonName p={{ ...p, name: a.name }} you={false} />}
                    sub={`${a.city} · gets ${cur.plural}`}
                    testID={`demo-friend-${a.name.toLowerCase()}`}
                  />
                );
              })}
          {demo.isError ? <Banner kind="neg" icon="wifioff" title="Couldn't reach the demo friends" text="Check your connection and try again." /> : null}
        </Card>
      )}

      <View style={{ marginTop: 16, gap: 12 }}>
        {DEMO_STEPS.map((s, i) => (
          <Step key={i} n={i + 1}>
            {s}
          </Step>
        ))}
      </View>

      {!disabled ? (
        <View style={{ marginTop: 16 }}>
          {isTestnet ? (
            <Banner
              kind="acc"
              icon="gift"
              title="Uses test dollars"
              text={`Nothing real moves. The demo friends put in $0.10 each${deposit > 0n ? `, and you put in ${formatUsd(deposit)}${money.local(deposit) ? ` (${money.local(deposit)})` : ""}` : ""}.`}
            />
          ) : (
            <Banner
              kind="acc"
              icon="gift"
              title="Uses a few cents of real dollars"
              text={`The demo friends put in $0.10 each.${deposit > 0n ? ` You put in ${formatUsd(deposit)} from your Plans account and get your share back at settle-up.` : " You can join without putting anything in."}`}
            />
          )}
        </View>
      ) : null}
      {err ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title={err.title} text={err.text} testID="demo-error" />
        </View>
      ) : null}
    </Screen>
  );
}
