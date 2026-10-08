import { Redirect, router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { currencyFor, formatUsd } from "../../lib/domain/currency";
import { identity } from "../../lib/identity/session";
import { shareRateLine } from "../../lib/fx/receiptRate";
import { e8ToText, fmtE8, quote, unitsToE8 } from "../../lib/send/convert";
import { placeLine, recipientFrom, sendDraft } from "../../lib/send/draft";
import { personFor, useBalance, useFx, useMe } from "../../lib/state/data";
import { useStore } from "../../lib/state/observable";
import { Keypad } from "../../ui/Keypad";
import { Avatar, Banner, Btn, Btns, Card, Chip, Row, Skel } from "../../ui/kit";
import { AppBar, Screen } from "../../ui/layout";
import { useLocal } from "../../ui/money";
import { useSendPreview } from "../../ui/fx/rates";
import { BigAmount, Mono, useFxPair } from "../../ui/send/bits";
import { AusdPill } from "../../ui/agora/dollars";
import { DeskSend } from "../../ui/send/desk";
import { useLayout } from "../../ui/shell/responsive";
import { Txt } from "../../ui/Text";

/** 45 / 45b Amount: type in your own money, see what they get in theirs. */
export default function SendAmount() {
  const params = useLocalSearchParams<{ to?: string; n?: string; c?: string; cc?: string; cur?: string; a?: string }>();
  const status = useStore(identity, (s) => s.status);
  const { address, currency: myCurrency } = useMe();
  const to = useMemo(() => recipientFrom(params), [params.to, params.n, params.c, params.cc, params.cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const bal = useBalance();
  const local = useLocal();
  const fxMy = useFx(myCurrency);
  const fxTheir = useFx(to?.currency ?? "USD");
  const pair = useFxPair(myCurrency, to?.currency ?? myCurrency);
  const preview = useSendPreview(myCurrency, to?.currency ?? myCurrency);
  const [inDollars, setInDollars] = useState(myCurrency === "USD");
  const [text, setText] = useState("");
  const { desk } = useLayout();

  // An amount asked for in the code (AUSD units): typed in dollars.
  useEffect(() => {
    if (!params.a || !/^\d+$/.test(params.a)) return;
    setInDollars(true);
    setText(e8ToText(unitsToE8(BigInt(params.a)), "USD"));
  }, [params.a]);

  if (status === "none" || status === "locked") {
    // A Plans code opened before signing in: come back here (to send to that person) afterwards.
    const q = Object.entries(params)
      .filter(([, v]) => typeof v === "string" && v)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return <Redirect href={{ pathname: status === "none" ? "/welcome" : "/unlock", params: { next: `/send/amount?${q}` } }} />;
  }

  // 114 on a laptop: one page with the person, the amount and the check.
  if (desk) {
    const asked = params.a && /^\d+$/.test(params.a) ? e8ToText(unitsToE8(BigInt(params.a)), "USD") : undefined;
    return <DeskSend key={`${to?.address ?? ""}:${params.a ?? ""}`} to={to} text={asked} inDollars={asked ? true : undefined} />;
  }

  if (!to) {
    return (
      <Screen testID="screen-send-amount">
        <AppBar title="Send" />
        <Banner kind="neg" icon="alert" title="That code didn't work" text="Ask your friend to show their Plans code again, then scan it." />
        <Btn label="Scan a code" icon="scan" onPress={() => router.replace("/send/scan")} style={{ marginTop: 16 }} testID="btn-scan-again" />
      </Screen>
    );
  }
  if (address && to.address === address.toLowerCase()) {
    return (
      <Screen testID="screen-send-amount">
        <AppBar title="Send" />
        <Banner kind="inf" icon="info" title="That's your own Plans code" text="Friends scan it to send you money. To send, scan their code." />
        <Btn label="Scan a friend's code" icon="scan" onPress={() => router.replace("/send/scan")} style={{ marginTop: 16 }} testID="btn-scan-again" />
      </Screen>
    );
  }

  const person = personFor(to.address);
  const q = quote({ text, inDollars, myCurrency, theirCurrency: to.currency, usdToMy: fxMy.data?.rateE8, usdToTheir: fxTheir.data?.rateE8 });
  const balance = bal.data;
  const over = q.valid && q.usdUnits !== null && balance !== undefined && q.usdUnits > balance;
  const dollars = inDollars || myCurrency === "USD";
  const typingCur = dollars ? "USD" : myCurrency;
  const canGo = q.valid && q.usdUnits !== null && q.usdUnits > 0n && balance !== undefined && !over;
  const ratesLoading = q.usdUnits === null || q.theirE8 === null;
  const ratesFailed = (fxMy.isError && !fxMy.data) || (fxTheir.isError && !fxTheir.data);
  const theirText = q.theirE8 !== null ? fmtE8(q.theirE8, to.currency) : null;

  const swap = () => {
    // Keep the same amount when switching what the keypad types in.
    if (q.valid) {
      if (dollars && q.myE8 !== null) setText(e8ToText(q.myE8, myCurrency));
      else if (!dollars && q.usdUnits !== null) setText(e8ToText(unitsToE8(q.usdUnits), "USD"));
    }
    setInDollars(!dollars);
  };

  const next = () => {
    if (!canGo) return;
    sendDraft.set({ to, text, inDollars: dollars, myCurrency });
    router.push("/send/confirm");
  };

  // The rate the receipt will carry, in its words (the same choice of round or quote as Check and send).
  const pairLine = to.currency !== myCurrency && preview.gate === "ok" ? shareRateLine(preview.rate) : null;
  const secondary = dollars && myCurrency !== "USD" ? (q.myE8 !== null && q.valid ? `${fmtE8(q.myE8, myCurrency)}` : null) : !dollars && q.usdUnits !== null && q.valid ? formatUsd(q.usdUnits) : null;

  return (
    <Screen testID="screen-send-amount" scroll={false}>
      <AppBar title={`Send to ${to.name}`} sub={placeLine(to)} right={<View style={{ marginRight: 8 }}><Avatar initial={person.initial} color={person.color} size={36} flag={person.flag} /></View>} />
      <View style={{ alignItems: "center", marginTop: 8 }}>
        <BigAmount text={text} currency={typingCur} testID="amount-display" />
        {secondary ? (
          <Txt v="t15" color="muted" style={{ marginTop: 2 }} testID="amount-secondary">
            {secondary}
          </Txt>
        ) : null}
        <View style={{ marginTop: 8, minHeight: 26, justifyContent: "center" }}>
          {ratesFailed ? (
            <Txt v="t15" color="neg" testID="recipient-gets">
              Couldn't get today's rate.
            </Txt>
          ) : ratesLoading ? (
            <Skel w={180} h={20} />
          ) : (
            <Txt style={{ fontSize: 21, lineHeight: 26 }} testID="recipient-gets">
              {to.name} {over ? "would get" : "gets"} <Txt style={{ fontSize: 21, lineHeight: 26 }} weight="bold">{theirText}</Txt>
            </Txt>
          )}
        </View>
        {pairLine ? (
          <View style={{ marginTop: 6 }}>
            <Mono testID="rate-line">{pairLine}</Mono>
          </View>
        ) : null}
        {ratesFailed ? (
          <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void Promise.all([fxMy.refetch(), fxTheir.refetch(), pair.refetch()])} style={{ marginTop: 8, alignSelf: "center" }} testID="btn-rate-retry" />
        ) : null}
        {myCurrency !== "USD" ? (
          <View style={{ marginTop: 12 }}>
            <Chip label={dollars ? `Type in ${currencyFor(myCurrency).plural}` : "Type in dollars"} ol sm icon="swap" onPress={swap} testID="btn-type-in-dollars" />
          </View>
        ) : null}
      </View>

      {over ? (
        <View style={{ marginTop: 16 }} testID="not-enough">
          <Banner kind="neg" icon="alert" title="That's more than you have" text={`You have ${[formatUsd(balance ?? 0n), local.fmt(balance ?? 0n)].filter(Boolean).join(" · ")}. Send less, or add money first.`} />
        </View>
      ) : (
        <>
          <Card tint style={{ marginTop: 16 }} p={14}>
            <Row between>
              <View>
                <Txt v="t13" color="muted">
                  You have
                </Txt>
                {balance === undefined ? <Skel w={110} h={18} /> : <Txt v="t15" weight="bold" testID="amount-balance">{[formatUsd(balance), local.fmt(balance)].filter(Boolean).join(" · ")}</Txt>}
              </View>
              <AusdPill align="flex-end" testID="pill-ausd" />
            </Row>
          </Card>
          <Row style={{ justifyContent: "center", marginTop: 8 }}>
            <Chip sm tone="pos" icon="zap" label="No fee · arrives in under a second" />
          </Row>
        </>
      )}
      <View style={{ flex: 1, minHeight: 8 }} />
      <Keypad value={text} onChange={setText} decimals={currencyFor(typingCur).decimals} />
      {over || (balance === 0n && !q.valid) ? (
        <Btns style={{ marginTop: 8 }}>
          <Btn label="Add money" kind="sec" icon="plus" onPress={() => router.push("/add-balance")} testID="btn-add-money" />
          <Btn label="Continue" disabled onPress={next} testID="btn-continue" />
        </Btns>
      ) : (
        <Btn label="Continue" disabled={!canGo} onPress={next} style={{ marginTop: 8 }} testID="btn-continue" />
      )}
    </Screen>
  );
}
