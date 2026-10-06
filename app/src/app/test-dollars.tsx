import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { isTestnet } from "../config";
import { RelayError, requestFaucet } from "../lib/api/relayer";
import { formatUsd, formatUsdShort } from "../lib/domain/currency";
import { queryClient, qk, useBalance, useMe } from "../lib/state/data";
import { storage } from "../lib/state/storage";
import { useAction } from "../lib/state/useAction";
import { Icon } from "../ui/Icon";
import { Banner, BigIcon, Btn, Card, Row, Skel } from "../ui/kit";
import { AppBar, Screen } from "../ui/layout";
import { useLocal } from "../ui/money";
import { KV, TestRibbon } from "../ui/send/bits";
import { Txt } from "../ui/Text";

const DEFAULT_UNITS = 25_000_000n;
const sameUtcDay = (a: number, b: number) => new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

async function faucet(account: string): Promise<{ amount: bigint; limited: boolean }> {
  try {
    const r = await requestFaucet(account);
    const prefs = await storage.loadPrefs();
    await storage.savePrefs({ ...prefs, lastFaucetAt: Date.now() });
    return { amount: r.amount && /^\d+$/.test(r.amount) ? BigInt(r.amount) : DEFAULT_UNITS, limited: false };
  } catch (e) {
    if (e instanceof RelayError && e.code === "FAUCET_LIMIT") return { amount: 0n, limited: true };
    throw e;
  }
}

/** 55 Get test dollars (test version only). */
export default function TestDollars() {
  const { address } = useMe();
  const bal = useBalance();
  const local = useLocal();
  const [limited, setLimited] = useState(false);
  const [got, setGot] = useState<bigint | null>(null);
  const act = useAction(faucet);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  useEffect(() => {
    void storage.loadPrefs().then((p) => {
      if (p.lastFaucetAt && sameUtcDay(p.lastFaucetAt, Date.now())) setLimited(true);
    });
  }, []);

  if (!isTestnet) {
    return (
      <Screen testID="screen-test-dollars">
        <AppBar title="Get test dollars" />
        <Banner kind="mut" icon="info" title="Not available" text="Test dollars are only in the test version of Plans." />
      </Screen>
    );
  }

  const amount = got ?? DEFAULT_UNITS;
  const balance = bal.data;
  const both = (u: bigint) => [formatUsd(u), local.fmt(u)].filter(Boolean).join(" · ");

  const get = async () => {
    if (!address) return;
    const r = await act.run(address);
    if (!r) return;
    if (r.limited) {
      setLimited(true);
      return;
    }
    setGot(r.amount);
    await queryClient.invalidateQueries({ queryKey: qk.balance(address) });
    setTimeout(() => {
      if (!mounted.current) return;
      if (router.canGoBack()) router.back();
      else router.replace("/balance");
    }, 1600);
  };

  return (
    <Screen
      testID="screen-test-dollars"
      dock={
        got ? (
          <Btn label="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace("/balance"))} testID="btn-done" />
        ) : (
          <Btn
            label={limited ? "Next top-up tomorrow" : `Get ${formatUsdShort(amount)} test dollars`}
            icon="gift"
            disabled={limited || !address}
            loading={act.busy}
            onPress={() => void get()}
            testID="btn-get-test-dollars"
          />
        )
      }
    >
      <TestRibbon />
      <AppBar title="Get test dollars" />
      <View style={{ alignItems: "center", marginTop: 8 }}>
        <BigIcon icon={got ? "check" : "gift"} kind={got ? "p" : "a"} />
        <Txt v="d28" center style={{ marginTop: 16 }} testID="test-dollars-title">
          {got ? `${formatUsdShort(got)} added` : `Get ${formatUsdShort(amount)} to try Plans`}
        </Txt>
        <Txt v="t15" color="muted" center style={{ marginTop: 8, marginHorizontal: 12 }}>
          Test dollars work like real ones in this version. They have no value and can't be cashed out.
        </Txt>
      </View>
      <Card style={{ marginTop: 24, gap: 8 }}>
        <KV k="Your Plans account now" v={balance === undefined ? <Skel w={100} h={18} /> : both(balance)} testID="test-dollars-now" />
        {!got ? <KV k="After" v={balance === undefined ? <Skel w={100} h={18} /> : both(balance + amount)} pos testID="test-dollars-after" /> : null}
      </Card>
      <Row gap={6} style={{ marginTop: 12 }}>
        <Icon name="clock" size={16} />
        <Txt v="t13" color="muted">
          One top-up a day for each account.
        </Txt>
      </Row>
      {act.error ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title={act.error.title} text={act.error.message} />
        </View>
      ) : null}
    </Screen>
  );
}
