import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useRef } from "react";
import { Platform, Share, View } from "react-native";
import { countryByCode, formatUsd } from "../../lib/domain/currency";
import { pickReceiptRate, rateLines, shareRateLine } from "../../lib/fx/receiptRate";
import { fmtE8, sendSides, shortRef, whenText } from "../../lib/send/convert";
import { getSendReceipt } from "../../lib/send/draft";
import { moneyRows } from "../../lib/send/history";
import { captureCard, shareCard } from "../../lib/share/shareImage";
import { personFor, useAccountActivity, useFx, useMe } from "../../lib/state/data";
import { useColors } from "../../theme/ThemeProvider";
import { Icon } from "../../ui/Icon";
import { Avatar, Banner, BigIcon, Btn, Btns, Card, ListItem, Proof, Row, SettledIn, Skel } from "../../ui/kit";
import { AppBar, Screen } from "../../ui/layout";
import { CheckRate, useFxRoundById } from "../../ui/fx/rates";
import { useFxPair } from "../../ui/send/bits";
import { SendFrame, SendLeft, sendTo } from "../../ui/send/desk";
import { MoneyRowItem, usePlanIndex } from "../../ui/send/rows";
import { PanelHead } from "../../ui/shell/desk";
import { SidePanel } from "../../ui/shell/panel";
import { useLayout } from "../../ui/shell/responsive";
import { showToast } from "../../ui/Toast";
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
  const roundId = rec ? (rec.round?.fxRoundId ?? "0") : (row?.fxRoundId ?? "0");
  const roundQ = useFxRoundById(roundId);
  const { desk, mode } = useLayout();
  const c = useColors();
  const stubRef = useRef<View>(null);
  const plans = usePlanIndex();
  const recent = useMemo(() => moneyRows(act.data, address?.toLowerCase()).filter((r) => r.kind !== "contributed" && (!tx || r.tx.toLowerCase() !== tx.toLowerCase())).slice(0, 8), [act.data, address, tx]);

  const done = () => {
    try {
      router.dismissTo("/(tabs)/send");
    } catch {
      router.replace("/(tabs)/send");
    }
  };

  if (!rec && !row) {
    if (desk) {
      return (
        <SendFrame left={<SendLeft onPick={sendTo} />} testID="screen-sent">
          {act.isLoading ? (
            <View style={{ gap: 12 }}>
              <Skel w="60%" h={34} />
              <Skel w="100%" h={240} r={14} />
            </View>
          ) : (
            <Banner kind="mut" icon="info" title="Receipt not found yet" text="It can take a few seconds to show up.">
              <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void act.refetch()} style={{ marginTop: 8 }} testID="btn-receipt-retry" />
            </Banner>
          )}
        </SendFrame>
      );
    }
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
  // 150: the applied rate, the reference round it was checked against (or the quote it came from), and the difference.
  const fx = pickReceiptRate({
    from: fromCur,
    to: toCur,
    recorded: {
      roundId,
      refRateE8: rec ? rec.round?.refRateE8 : row?.refRateE8,
      diffBps: rec ? rec.round?.fxDiffBps : row?.fxDiffBps,
      appliedE8: rateE8,
      appliedAt: fxTs,
      appliedSource: rec?.source ?? pairInfo.data?.source,
    },
    round: roundQ.data ?? (rec?.round ? { roundId: rec.round.fxRoundId, scheduledTime: rec.round.roundTime, usdPerUnitE8: {} } : null),
  });
  const rate = shareRateLine(fx);
  const atMs = rec?.at ?? (row ? row.timestamp * 1000 : Date.now());
  const hash = tx ?? row?.txHash;
  const lines: [string, React.ReactNode][] = [
    ["From", `${fromName}${fromCity ? ` · ${fromCity}` : ""} ${flag(fromCountry)}`.trim()],
    ["To", `${toName}${toCity ? ` · ${toCity}` : ""} ${flag(toCountry)}`.trim()],
  ];
  lines.push(...rateLines(fx));
  lines.push(["Fee", "$0.00"]);
  if (rec?.note) lines.push(["Note", rec.note]);
  lines.push(["When", whenText(atMs)]);

  const share = () => {
    void Share.share({
      message: `Plans · sent ${shortRef(hash)}\n${myText} → ${theirText}\nFrom ${fromName}${fromCity ? `, ${fromCity}` : ""} to ${toName}${toCity ? `, ${toCity}` : ""}\n${rate}\nFee $0.00\n${whenText(atMs)}`,
    }).catch(() => undefined);
  };

  if (desk) {
    // 115: the stub in the middle, recent sends in the panel with this one outlined.
    const meP = personFor(address ?? "0x0000000000000000000000000000000000000000", { me: address });
    const shareDesk = async () => {
      const text = `Plans · sent ${shortRef(hash)}\n${myText} → ${theirText}\nFrom ${fromName} to ${toName}\n${rate}\nFee $0.00\n${whenText(atMs)}`;
      try {
        const uri = await captureCard(stubRef, "wide");
        const canShare = Platform.OS === "web" && typeof (globalThis.navigator as Navigator | undefined)?.share === "function";
        await shareCard(uri, text, "Plans receipt");
        if (!canShare) showToast({ title: "Image saved", sub: "In your downloads" });
      } catch {
        share();
      }
    };
    return (
      <SendFrame left={<SendLeft onPick={sendTo} />} testID="screen-sent">
        <View style={{ alignItems: "center", marginTop: 8 }}>
          <BigIcon icon="check" kind="p" />
          <Txt v="d34" style={{ marginTop: 12 }}>
            Sent
          </Txt>
          <Txt v="t15" color="muted" center style={{ marginTop: 4, marginBottom: 16 }} testID="sent-summary">
            {toName} got {theirText}
            {toCity ? ` in ${toCity}` : ""}.
          </Txt>
        </View>
        <View ref={stubRef} collapsable={false} style={{ backgroundColor: c.bg }}>
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
        </View>
        <CheckRate rates={[fx]} usedAt={Math.floor(atMs / 1000)} subtitle={`For your payment to ${toName}.`} style={{ marginTop: 12 }} />
        <Card tint style={{ marginTop: 12 }} testID="sent-told">
          <Row>
            <Avatar initial={them.initial} color={them.color} size={36} flag={them.flag} />
            <View style={{ flex: 1 }}>
              <Txt v="t13" weight="bold">
                {toName} was told straight away
              </Txt>
              <Txt v="t13" color="muted">
                “+{theirText} from {[fromName, fromCity].filter(Boolean).join(", ")}”
              </Txt>
            </View>
          </Row>
        </Card>
        <SidePanel kind="form">
          <View style={{ flex: 1 }} testID="sent-panel">
            <PanelHead title="Recent sends" />
            <ListItem
              highlight
              left={<Avatar initial={them.initial} color={them.color} size={40} flag={them.flag} />}
              title={`To ${toName}${rec?.note ? ` · ${rec.note}` : ""}`}
              sub={`${toName} got ${theirText} · now`}
              right={<Txt v="lt" tnum>{`−${myText}`}</Txt>}
              testID="sent-this-one"
            />
            {recent.map((r, i) => (
              <MoneyRowItem key={r.id} r={r} me={address} plans={plans} variant="balance" last={i === recent.length - 1} />
            ))}
            <View style={{ flex: 1, minHeight: 24 }} />
            <Btns>
              <Btn label="Share" kind="sec" icon={mode === "wide" ? "share" : undefined} onPress={() => void shareDesk()} testID="btn-share" />
              <Btn label="Send again" icon={mode === "wide" ? "send" : undefined} onPress={() => sendTo({ address: toAddr, name: toName, city: toCity, country: toCountry ?? undefined, currency: toCur })} testID="btn-send-again" />
            </Btns>
            <Btn label="Done" kind="txt" sm onPress={done} style={{ alignSelf: "center", marginTop: 4 }} testID="btn-done" />
          </View>
        </SidePanel>
      </SendFrame>
    );
  }

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
      <CheckRate rates={[fx]} usedAt={Math.floor(atMs / 1000)} subtitle={`For your payment to ${toName}.`} style={{ marginTop: 12 }} />
      <View style={{ height: 16 }} />
    </Screen>
  );
}
