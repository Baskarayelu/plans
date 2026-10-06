import * as Brightness from "expo-brightness";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Share, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { config } from "../config";
import { countryByCode, currencyFor, formatUsd } from "../lib/domain/currency";
import { codeUrl, displayLink } from "../lib/domain/links";
import { fmtE8, quote } from "../lib/send/convert";
import { placeLine } from "../lib/send/draft";
import { useFx, useMe } from "../lib/state/data";
import { Keypad } from "../ui/Keypad";
import { Avatar, Banner, Btn, Btns, Card, Chip, IconBtn, Row } from "../ui/kit";
import { AppBar, Screen, Sheet } from "../ui/layout";
import { useLocal } from "../ui/money";
import { BigAmount } from "../ui/send/bits";
import { Txt } from "../ui/Text";

/** Keeps the screen bright while a code is shown; restores the app's brightness after. */
function useBrightScreen() {
  useEffect(() => {
    let prev: number | null = null;
    let cancelled = false;
    void (async () => {
      try {
        prev = await Brightness.getBrightnessAsync();
        if (!cancelled) await Brightness.setBrightnessAsync(1);
      } catch {
        /* not allowed on this phone */
      }
    })();
    return () => {
      cancelled = true;
      if (prev !== null) void Brightness.setBrightnessAsync(prev).catch(() => undefined);
    };
  }, []);
}

/** 49 My Plans code: big, scannable, with name and country. "Ask for an amount" adds an amount. */
export default function MyCode() {
  useBrightScreen();
  const { address, profile, currency } = useMe();
  const local = useLocal();
  const fxMy = useFx(currency);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [asked, setAsked] = useState<bigint | null>(null);
  const [copied, setCopied] = useState(false);

  if (!address || !profile) {
    return (
      <Screen testID="screen-my-code">
        <AppBar title="My Plans code" icon="x" />
        <Banner kind="inf" icon="info" title="Finish setting up first" text="Add your name and country, then your code is ready.">
          <Btn label="Set up" kind="sec" sm onPress={() => router.push({ pathname: "/profile", params: { next: "/my-code" } })} style={{ marginTop: 8 }} testID="btn-set-up" />
        </Banner>
      </Screen>
    );
  }

  const url = codeUrl(config.linkHost, address, { name: profile.name, city: profile.city, country: profile.country, currency: profile.currency, amount: asked ? asked.toString() : undefined });
  const initial = (profile.name[0] ?? "?").toUpperCase();
  const q = quote({ text: askText, inDollars: false, myCurrency: currency, theirCurrency: "USD", usdToMy: fxMy.data?.rateE8 });

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* ignore */
    }
  };
  const share = () => {
    const amount = asked ? ` ${formatUsd(asked)}` : "";
    void Share.share({ message: `Send me${amount} on Plans: ${url}` }).catch(() => undefined);
  };

  return (
    <Screen
      testID="screen-my-code"
      dock={
        <Btns>
          <Btn label={copied ? "Copied" : "Copy link"} kind="sec" icon={copied ? "check" : "copy"} onPress={() => void copy()} testID="btn-copy-link" />
          <Btn label="Share" icon="share" onPress={share} testID="btn-share" />
        </Btns>
      }
    >
      <AppBar title="My Plans code" icon="x" right={<IconBtn name="share" label="Share" onPress={share} testID="btn-header-share" />} />
      <Card style={{ alignItems: "center", paddingTop: 24, paddingBottom: 20, marginTop: 8 }}>
        <Avatar initial={initial} color="#D9634B" size={56} flag={countryByCode(profile.country)?.flag} />
        <Txt v="d22" style={{ marginTop: 8 }} testID="my-code-name">
          {profile.name}
        </Txt>
        <Txt v="t13" color="muted">
          {placeLine({ city: profile.city, country: profile.country, currency: profile.currency ?? currency })}
        </Txt>
        <View style={{ padding: 12, borderRadius: 20, backgroundColor: "#FFFFFF", marginTop: 16 }} testID="my-code-qr" accessibilityLabel="Your Plans code">
          <QRCode value={url} size={232} color="#10231B" backgroundColor="#FFFFFF" ecl="M" quietZone={0} />
        </View>
        <Txt v="mono13" style={{ marginTop: 12 }} testID="my-code-link">
          {displayLink(url)}
        </Txt>
        {asked ? (
          <Txt v="t15" weight="bold" style={{ marginTop: 6 }} testID="my-code-amount">
            Asking for {[formatUsd(asked), local.fmt(asked)].filter(Boolean).join(" · ")}
          </Txt>
        ) : null}
      </Card>
      <Row style={{ justifyContent: "center", marginTop: 12 }}>
        {asked ? (
          <Chip label="Remove the amount" ol icon="x" onPress={() => setAsked(null)} testID="btn-remove-amount" />
        ) : (
          <Chip label="Ask for an amount" ol icon="plus" onPress={() => setAskOpen(true)} testID="btn-ask-for-an-amount" />
        )}
      </Row>
      <Txt v="t13" color="muted" center style={{ marginTop: 12, marginHorizontal: 16 }}>
        Anyone can scan this to send you money. It can't be used to take money.
      </Txt>

      <Sheet visible={askOpen} onClose={() => setAskOpen(false)} testID="sheet-ask-amount">
        <Txt v="d22">Ask for an amount</Txt>
        <View style={{ alignItems: "center", marginTop: 12 }}>
          <BigAmount text={askText} currency={currency} testID="ask-amount-display" size={44} />
          {currency !== "USD" && q.valid && q.usdUnits !== null ? (
            <Txt v="t15" color="muted" style={{ marginTop: 4 }}>
              {formatUsd(q.usdUnits)}
            </Txt>
          ) : null}
        </View>
        <View style={{ marginTop: 8 }}>
          <Keypad value={askText} onChange={setAskText} decimals={currencyFor(currency).decimals} />
        </View>
        <Btn
          label={q.valid && q.myE8 !== null ? `Ask for ${fmtE8(q.myE8, currency)}` : "Ask for an amount"}
          disabled={!q.valid || q.usdUnits === null || q.usdUnits <= 0n}
          onPress={() => {
            if (q.usdUnits === null) return;
            setAsked(q.usdUnits);
            setAskOpen(false);
            setAskText("");
          }}
          style={{ marginTop: 8 }}
          testID="btn-ask-confirm"
        />
      </Sheet>
    </Screen>
  );
}
