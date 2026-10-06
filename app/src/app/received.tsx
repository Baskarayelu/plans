import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef } from "react";
import { View } from "react-native";
import type { Hex } from "viem";
import { countryByCode, formatUsd } from "../lib/domain/currency";
import { identity } from "../lib/identity/session";
import { fmtE8, hms, rateLine, sendSides, shortRef, whenText, zoneLabel } from "../lib/send/convert";
import { readReceivedSend, relayedLatency } from "../lib/send/received";
import { personFor, queryClient, qk, useAccountActivity, useBalance, useFx, useMe } from "../lib/state/data";
import { useStore } from "../lib/state/observable";
import { Avatar, Banner, Btn, Btns, Card, Proof, Row, SettledIn, Skel } from "../ui/kit";
import { AppBar, Screen } from "../ui/layout";
import { useLocal } from "../ui/money";
import { useFxPair } from "../ui/send/bits";
import { Stub } from "../ui/Stub";
import { Txt } from "../ui/Text";

const flag = (cc?: string | null) => countryByCode(cc)?.flag ?? "";

/** 48 Received: who, where from, how much in my money, and what they sent in theirs. */
export default function Received() {
  const p = useLocalSearchParams<{ tx?: string; from?: string; amount?: string; live?: string }>();
  const { address, profile } = useMe();
  const keysReady = useStore(identity, (s) => s.status === "unlocked" && !s.keysPending);
  const bal = useBalance();
  const local = useLocal();
  const act = useAccountActivity();
  const buzzed = useRef(false);
  const tx = p.tx && /^0x[0-9a-fA-F]{64}$/.test(p.tx) ? (p.tx as Hex) : undefined;

  const send = useQuery({
    queryKey: ["receivedSend", tx, address?.toLowerCase(), keysReady],
    enabled: !!tx,
    queryFn: () => readReceivedSend(tx!, address),
    staleTime: Infinity,
    retry: 3,
    retryDelay: 800,
  });
  const latency = useQuery({ queryKey: ["txLatency", tx], enabled: !!tx, queryFn: () => relayedLatency(tx!), staleTime: Infinity, retry: 0 });
  const row = tx ? act.data?.sendsIn.find((s) => s.txHash.toLowerCase() === tx.toLowerCase()) : undefined;

  const d = send.data;
  const fromCur = d?.fromCurrency ?? row?.fromCurrency ?? "USD";
  const toCur = d?.toCurrency ?? row?.toCurrency ?? "USD";
  const fxFrom = useFx(fromCur);
  // Only for the rate source name (the recorded rate itself comes from the receipt).
  const pairInfo = useFxPair(fromCur, toCur);

  useEffect(() => {
    if (p.live && !buzzed.current) {
      buzzed.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: qk.balance(address) });
    }
  }, [p.live, address]);

  const done = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)"));

  if (!tx) {
    return (
      <Screen testID="screen-received">
        <AppBar title="Money in" icon="x" onBack={done} />
        <Banner kind="mut" icon="info" title="Nothing to show" text="This receipt link is incomplete." />
      </Screen>
    );
  }

  const amountStr = d?.amount?.toString() ?? row?.amount ?? p.amount;
  const usd = amountStr && /^\d+$/.test(amountStr) ? BigInt(amountStr) : undefined;
  const fromAddr = (d?.from ?? row?.from_id ?? p.from ?? "").toLowerCase();
  const sender = fromAddr ? personFor(fromAddr) : undefined;
  const fromCountry = d?.fromCountry ?? row?.fromCountry ?? sender?.country;
  const name = d?.note?.name ?? (sender && sender.name !== "Friend" ? sender.name : undefined);
  const city = d?.note?.city ?? sender?.city;
  const place = city ?? countryByCode(fromCountry)?.name;
  const rateE8 = d?.rateE8 ?? (row ? BigInt(row.fxRateE8) : 0n);
  const fxTs = d?.fxTimestamp ?? (row ? Number(row.fxTimestamp) : undefined);
  const sides = usd !== undefined ? sendSides({ usdUnits: usd, from: fromCur, to: toCur, rateE8, usdToFrom: fxFrom.data?.rateE8 }) : null;
  const theirText = sides?.fromE8 !== null && sides?.fromE8 !== undefined ? fmtE8(sides.fromE8, fromCur) : undefined;
  const atMs = d?.at ? d.at * 1000 : row ? row.timestamp * 1000 : p.live ? Number(p.live) : undefined;
  const arrivedMs = p.live && /^\d+$/.test(p.live) ? Number(p.live) : atMs;
  const rate = fromCur !== toCur && rateE8 > 0n ? rateLine(fromCur, toCur, rateE8, fxTs, pairInfo.data?.source) : null;
  const who = name ?? "Someone";
  const myPlace = profile?.city ?? countryByCode(profile?.country)?.name;
  const loading = send.isLoading && !row && usd === undefined;

  const lines: [string, React.ReactNode][] = [
    ["From", [`${who}${place ? ` · ${place}` : ""} ${flag(fromCountry)}`.trim(), theirText].filter(Boolean).join(" · ")],
    ["To", ["You", myPlace, usd !== undefined ? formatUsd(usd) : undefined].filter(Boolean).join(" · ")],
  ];
  if (rate) lines.push(["", rate]);
  if (atMs) lines.push(["When", `${whenText(atMs)} ${zoneLabel(atMs)}`]);

  const sendBack = () => {
    if (!fromAddr) return;
    router.push({
      pathname: "/send/amount",
      params: { to: fromAddr, n: name ?? "", c: city ?? "", cc: fromCountry ?? "", cur: fromCur },
    });
  };

  return (
    <Screen
      testID="screen-received"
      dock={
        <Btns>
          <Btn label="Send back" kind="sec" icon="send" onPress={sendBack} disabled={!fromAddr} testID="btn-send-back" />
          <Btn label="Done" onPress={done} testID="btn-done" />
        </Btns>
      }
    >
      <AppBar icon="x" onBack={done} />
      <View style={{ alignItems: "center", marginTop: 8 }}>
        {sender ? <Avatar initial={(who[0] ?? "?").toUpperCase()} color={sender.color} size={80} flag={flag(fromCountry) || undefined} /> : <Skel w={80} h={80} r={40} />}
        {usd === undefined ? (
          <Skel w={180} h={56} style={{ marginTop: 20 }} />
        ) : (
          <Txt v="d56" color="pos" tnum style={{ marginTop: 20 }} testID="received-amount">
            {formatUsd(usd, { sign: true })}
          </Txt>
        )}
        {usd !== undefined && local.fmt(usd) && local.currency !== "USD" ? (
          <Txt v="t15" color="muted" testID="received-local">
            {local.fmt(usd, { sign: true })}
          </Txt>
        ) : null}
        {loading ? (
          <Skel w={160} h={20} style={{ marginTop: 8 }} />
        ) : (
          <Txt v="t17" center style={{ marginTop: 8 }} testID="received-from">
            from <Txt v="t17" weight="bold">{place ? `${who}, ${place}` : who}</Txt>
          </Txt>
        )}
        {theirText && fromCur !== "USD" ? (
          <Txt v="t13" color="muted" center style={{ marginTop: 4 }} testID="received-their-amount">
            {who} sent {theirText}
            {d?.note?.note ? ` · “${d.note.note}”` : ""}
          </Txt>
        ) : d?.note?.note ? (
          <Txt v="t13" color="muted" center style={{ marginTop: 4 }}>
            “{d.note.note}”
          </Txt>
        ) : null}
      </View>
      {send.isError && !row ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="mut" icon="wifioff" title="Couldn't load all the details" text="The money is in your account. The rest of the receipt will show when we can reach the network.">
            <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void send.refetch()} style={{ marginTop: 8 }} testID="btn-received-retry" />
          </Banner>
        </View>
      ) : null}
      <View style={{ marginTop: 24 }}>
        <Stub
          testID="receipt-stub"
          head={
            <Row between>
              <Txt v="ov" color="muted">
                Plans · received
              </Txt>
              <Txt v="mono13" color="muted">
                {shortRef(tx)}
              </Txt>
            </Row>
          }
          lines={lines}
          foot={
            <>
              {latency.data != null ? (
                <SettledIn ms={latency.data} />
              ) : arrivedMs ? (
                <Txt v="mono11" color="muted" testID="arrived-at">
                  Arrived at {hms(arrivedMs)}
                </Txt>
              ) : (
                <View />
              )}
              <Proof hash={tx} />
            </>
          }
        />
      </View>
      <Card tint style={{ marginTop: 12 }} p={14}>
        <Row between>
          <Txt v="t13" color="muted">
            Your Plans account
          </Txt>
          {bal.data === undefined ? (
            <Skel w={90} h={18} />
          ) : (
            <Txt v="t15" weight="bold" testID="received-balance">
              {[formatUsd(bal.data), local.fmt(bal.data)].filter(Boolean).join(" · ")}
            </Txt>
          )}
        </Row>
      </Card>
      <View style={{ height: 16 }} />
    </Screen>
  );
}
