import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Share, View } from "react-native";
import { countryByCode, formatUsd } from "../../lib/domain/currency";
import { fmtE8, rateLine, sendSides, shortRef, whenText } from "../../lib/send/convert";
import { getSendReceipt } from "../../lib/send/draft";
import { personFor, useAccountActivity, useFx, useMe } from "../../lib/state/data";
import { Icon } from "../../ui/Icon";
import { Banner, BigIcon, Btn, Btns, Proof, Row, SettledIn, Skel } from "../../ui/kit";
import { AppBar, Screen } from "../../ui/layout";
import { useFxPair } from "../../ui/send/bits";
import { Stub } from "../../ui/Stub";
import { Txt } from "../../ui/Text";

const flag = (cc?: string | null) => countryByCode(cc)?.flag ?? "";

/** 47 Sent receipt: both currencies, the reference rate, the measured time and Proof. */
export default function Sent() {
  const { tx } = useLocalSearchParams<{ tx?: string }>();
  const { address, profile } = useMe();
  const rec = getSendReceipt(tx);
  const act = useAccountActivity();
  const row = !rec && tx ? act.data?.sendsOut.find((s) => s.txHash.toLowerCase() === tx.toLowerCase()) : undefined;
  const fromCur = rec?.fromCurrency ?? row?.fromCurrency ?? "USD";
  const fxFrom = useFx(fromCur);
  const fxTo = useFx(rec?.to.currency ?? row?.toCurrency ?? "USD");
  const pairInfo = useFxPair(fromCur, rec?.to.currency ?? row?.toCurrency ?? "USD");

  const done = () => {
    try {
      router.dismissTo("/(tabs)/send");
    } catch {
      router.replace("/(tabs)/send");
    }
  };

  if (!rec && !row) {
    return (
      <Screen testID="screen-sent">
        <AppBar title="Sent" icon="x" onBack={done} />
        {act.isLoading ? (
          <View style={{ gap: 12 }}>
            <Skel w="60%" h={34} />
            <Skel w="100%" h={240} r={14} />
          </View>
        ) : (
          <Banner kind="mut" icon="info" title="Receipt not found yet" text="It can take a few seconds to show up. Pull down on Activity to check again.">
            <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void act.refetch()} style={{ marginTop: 8 }} testID="btn-receipt-retry" />
          </Banner>
        )}
      </Screen>
    );
  }

  // Normalise both sources into one view.
  const usd = BigInt(rec?.usdUnits ?? row!.amount);
  const toCur = rec?.to.currency ?? row?.toCurrency ?? "USD";
  const rateE8 = BigInt(rec?.rateE8 ?? row?.fxRateE8 ?? "0");
  const sides = sendSides({ usdUnits: usd, from: fromCur, to: toCur, rateE8, usdToFrom: fxFrom.data?.rateE8, usdToTo: fxTo.data?.rateE8 });
  const myE8 = rec?.myE8 ? BigInt(rec.myE8) : sides.fromE8;
  const theirE8 = rec?.theirE8 ? BigInt(rec.theirE8) : sides.toE8;
  const myText = myE8 !== null ? fmtE8(myE8, fromCur) : formatUsd(usd);
  const theirText = theirE8 !== null ? fmtE8(theirE8, toCur) : formatUsd(usd);
  const toAddr = rec?.to.address ?? row!.to_id;
  const them = personFor(toAddr);
  const toName = rec?.to.name ?? them.name;
  const toCity = rec?.to.city ?? them.city ?? countryByCode(row?.toCountry)?.name;
  const toCountry = rec?.to.country ?? row?.toCountry ?? them.country;
  const fromName = rec?.from.name ?? profile?.name ?? "You";
  const fromCity = rec?.from.city ?? profile?.city ?? countryByCode(profile?.country)?.name;
  const fromCountry = rec?.from.country ?? row?.fromCountry ?? profile?.country;
  const fxTs = rec?.fxTimestamp ?? (row ? Number(row.fxTimestamp) : undefined);
  const rate = fromCur !== toCur && rateE8 > 0n ? rateLine(fromCur, toCur, rateE8, fxTs, rec?.source ?? pairInfo.data?.source) : null;
  const atMs = rec?.at ?? (row ? row.timestamp * 1000 : Date.now());
  const hash = tx ?? row?.txHash;
  const lines: [string, React.ReactNode][] = [
    ["From", `${fromName}${fromCity ? ` · ${fromCity}` : ""} ${flag(fromCountry)}`.trim()],
    ["To", `${toName}${toCity ? ` · ${toCity}` : ""} ${flag(toCountry)}`.trim()],
  ];
  if (rate) lines.push(["", rate]);
  lines.push(["Fee", "$0.00"]);
  if (rec?.note) lines.push(["Note", rec.note]);
  lines.push(["When", whenText(atMs)]);

  const share = () => {
    void Share.share({
      message: `Plans · sent ${shortRef(hash)}\n${myText} → ${theirText}\nFrom ${fromName}${fromCity ? `, ${fromCity}` : ""} to ${toName}${toCity ? `, ${toCity}` : ""}\n${rate ? `${rate}\n` : ""}Fee $0.00\n${whenText(atMs)}`,
    }).catch(() => undefined);
  };

  return (
    <Screen
      testID="screen-sent"
      dock={
        <Btns>
          <Btn label="Share" kind="sec" icon="share" onPress={share} testID="btn-share" />
          <Btn label="Done" onPress={done} testID="btn-done" />
        </Btns>
      }
    >
      <View style={{ alignItems: "center", marginTop: 24 }}>
        <BigIcon icon="check" kind="p" />
        <Txt v="d34" style={{ marginTop: 12 }}>
          Sent
        </Txt>
        <Txt v="t15" color="muted" center style={{ marginTop: 6, marginHorizontal: 16, marginBottom: 20 }} testID="sent-summary">
          {toName} got {theirText}
          {toCity ? ` in ${toCity}` : ""}.
        </Txt>
      </View>
      <Stub
        testID="receipt-stub"
        head={
          <>
            <Row between>
              <Txt v="ov" color="muted">
                Plans · sent
              </Txt>
              <Txt v="mono13" color="muted">
                {shortRef(hash)}
              </Txt>
            </Row>
            <Row gap={10} style={{ marginTop: 8 }} wrap>
              <Txt v="d34" tnum testID="sent-from-amount">
                {myText}
              </Txt>
              <Icon name="chev" size={22} strokeWidth={2.4} />
              <Txt v="d34" tnum testID="sent-to-amount">
                {theirText}
              </Txt>
            </Row>
          </>
        }
        lines={lines}
        foot={
          <>
            {rec ? <SettledIn ms={rec.settledMs} /> : <View />}
            <Proof hash={hash} />
          </>
        }
      />
      <View style={{ height: 16 }} />
    </Screen>
  );
}
