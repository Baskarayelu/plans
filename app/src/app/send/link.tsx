import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import React, { useState } from "react";
import { Share, View } from "react-native";
import { settledMs } from "../../lib/api/relayer";
import { currencyFor, formatUsd } from "../../lib/domain/currency";
import { createSendLink } from "../../lib/domain/planOps";
import { displayLink } from "../../lib/domain/links";
import { identity } from "../../lib/identity/session";
import { dayText, e8ToText, fmtE8, quote, unitsToE8 } from "../../lib/send/convert";
import { useBalance, useFx, useMe } from "../../lib/state/data";
import { useStore } from "../../lib/state/observable";
import { useAction } from "../../lib/state/useAction";
import { Keypad } from "../../ui/Keypad";
import { Banner, BigIcon, Btn, Btns, Card, Chip, Field, Overline, Proof, Row, SettledIn } from "../../ui/kit";
import { AppBar, Screen } from "../../ui/layout";
import { useLocal } from "../../ui/money";
import { BigAmount } from "../../ui/send/bits";
import { Txt } from "../../ui/Text";

const DURATIONS = [
  { label: "24 hours", sec: 24 * 3600, words: "24 hours" },
  { label: "7 days", sec: 7 * 86400, words: "7 days" },
  { label: "30 days", sec: 30 * 86400, words: "30 days" },
];

type Made = { url: string; tx: string; ms: number; expiry: number; usd: bigint };

/** 50 Send by link: for someone not on Plans yet. */
export default function SendByLink() {
  const status = useStore(identity, (s) => s.status);
  const { currency: myCurrency } = useMe();
  const bal = useBalance();
  const local = useLocal();
  const fxMy = useFx(myCurrency);
  const [inDollars, setInDollars] = useState(myCurrency === "USD");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [dur, setDur] = useState(DURATIONS[1]);
  const [made, setMade] = useState<Made | null>(null);
  const [copied, setCopied] = useState(false);
  const make = useAction(createSendLink, { fatal: true, context: "You were making a money link." });

  const dollars = inDollars || myCurrency === "USD";
  const typingCur = dollars ? "USD" : myCurrency;
  const q = quote({ text, inDollars: dollars, myCurrency, theirCurrency: "USD", usdToMy: fxMy.data?.rateE8 });
  const balance = bal.data;
  const over = q.valid && q.usdUnits !== null && balance !== undefined && q.usdUnits > balance;
  const ready = q.valid && q.usdUnits !== null && q.usdUnits > 0n && balance !== undefined && !over;
  const usdText = q.usdUnits !== null && q.valid ? formatUsd(q.usdUnits) : "the money";
  const secondary = dollars ? (q.valid && q.usdUnits !== null ? local.fmt(q.usdUnits) : undefined) : q.valid && q.usdUnits !== null ? formatUsd(q.usdUnits) : undefined;

  const shareLink = (url: string, usd: bigint) => {
    void Share.share({ message: `I sent you ${formatUsd(usd)} on Plans. Open this link to claim it: ${url}` }).catch(() => undefined);
  };

  const confirm = async () => {
    if (!ready || q.usdUnits === null) return;
    if (status === "locked") {
      router.push({ pathname: "/unlock", params: { next: "/send/link" } });
      return;
    }
    const usd = q.usdUnits;
    const r = await make.run(usd, dur.sec, note.trim() || undefined);
    if (!r) return;
    const m = { url: r.url, tx: r.result.txHash, ms: settledMs(r.result), expiry: Number(r.expiry), usd };
    setMade(m);
    shareLink(m.url, m.usd);
  };

  const swap = () => {
    if (q.valid) {
      if (dollars && q.myE8 !== null) setText(e8ToText(q.myE8, myCurrency));
      else if (!dollars && q.usdUnits !== null) setText(e8ToText(unitsToE8(q.usdUnits), "USD"));
    }
    setInDollars(!dollars);
  };

  if (made) {
    return (
      <Screen
        testID="screen-send-link-done"
        dock={
          <Btns>
            <Btn label={copied ? "Copied" : "Copy link"} kind="sec" icon={copied ? "check" : "copy"} testID="btn-copy-link" onPress={() => void Clipboard.setStringAsync(made.url).then(() => setCopied(true)).catch(() => undefined)} />
            <Btn label="Share" icon="share" onPress={() => shareLink(made.url, made.usd)} testID="btn-share" />
          </Btns>
        }
      >
        <AppBar title="Send by link" icon="x" onBack={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/send"))} />
        <View style={{ alignItems: "center", marginTop: 16 }}>
          <BigIcon icon="link" kind="p" />
          <Txt v="d28" center style={{ marginTop: 12 }}>
            Your link is ready
          </Txt>
          <Txt v="t15" color="muted" center style={{ marginTop: 6, marginHorizontal: 16 }}>
            {formatUsd(made.usd)} is waiting for whoever opens it first. Send it to one person only.
          </Txt>
        </View>
        <Card style={{ marginTop: 20, gap: 8 }} testID="link-result">
          <Txt v="mono13" testID="link-result-url">
            {displayLink(made.url)}
          </Txt>
          <Row between>
            <Txt v="t13" color="muted" testID="link-status">
              Not claimed yet
            </Txt>
            <Txt v="t13" color="muted">
              Works until {dayText(made.expiry)}
            </Txt>
          </Row>
          <Row between style={{ marginTop: 4 }}>
            <SettledIn ms={made.ms} />
            <Proof hash={made.tx} />
          </Row>
        </Card>
        <Txt v="t13" color="muted" style={{ marginTop: 12 }}>
          If no one claims it by {dayText(made.expiry)}, tap Get it back in Activity and the money returns to you.
        </Txt>
        <Btn label="Done" kind="txt" onPress={() => router.replace("/(tabs)/activity")} style={{ marginTop: 8 }} testID="btn-done" />
      </Screen>
    );
  }

  return (
    <Screen
      testID="screen-send-link"
      dock={
        <>
          {over ? (
            <Btns>
              <Btn label="Add money" kind="sec" icon="plus" onPress={() => router.push("/add-balance")} testID="btn-add-money" />
              <Btn label="Confirm with fingerprint" disabled testID="btn-confirm-with-fingerprint" />
            </Btns>
          ) : (
            <Btn label="Confirm with fingerprint" icon="fp" disabled={!ready} loading={make.busy} onPress={() => void confirm()} testID="btn-confirm-with-fingerprint" />
          )}
        </>
      }
    >
      <AppBar title="Send by link" icon="x" />
      <View style={{ alignItems: "center", marginTop: 4 }}>
        <BigAmount text={text} currency={typingCur} testID="amount-display" />
        {secondary ? (
          <Txt v="t17" color="muted" weight="medium" style={{ marginTop: 4 }}>
            {secondary}
          </Txt>
        ) : null}
        <Txt v="t13" color="muted" center style={{ marginTop: 8, marginHorizontal: 24 }}>
          They see it in their own money when they open the link.
        </Txt>
        {myCurrency !== "USD" ? (
          <View style={{ marginTop: 10 }}>
            <Chip label={dollars ? `Type in ${currencyFor(myCurrency).plural}` : "Type in dollars"} ol sm icon="swap" onPress={swap} testID="btn-type-in-dollars" />
          </View>
        ) : null}
      </View>
      <Keypad value={text} onChange={setText} decimals={currencyFor(typingCur).decimals} />
      {over ? (
        <View style={{ marginTop: 8 }}>
          <Banner kind="neg" icon="alert" title="That's more than you have" text={`You have ${[formatUsd(balance ?? 0n), local.fmt(balance ?? 0n)].filter(Boolean).join(" · ")}. Send less, or add money first.`} />
        </View>
      ) : null}
      <View style={{ marginTop: 12 }}>
        <Field label="Note" value={note} onChangeText={setNote} placeholder="For the train tickets 🚆" maxLength={60} hint="Goes in the link, so only people with the link see it." testID="field-link-note" />
      </View>
      <Overline style={{ marginTop: 20 }}>Link works for</Overline>
      <Row gap={8} style={{ marginTop: 8 }} wrap>
        {DURATIONS.map((d) => (
          <Chip key={d.label} label={d.label} on={d.sec === dur.sec} onPress={() => setDur(d)} />
        ))}
      </Row>
      <View style={{ marginTop: 16 }}>
        <Banner kind="acc" icon="link" title="Anyone with the link can claim it" text={`Send it to one person only. If no one claims it in ${dur.words}, the ${usdText} comes back to you: tap Get it back in Activity.`} />
      </View>
      {q.valid && q.myE8 !== null && !dollars ? (
        <Txt v="t13" color="muted" style={{ marginTop: 8 }}>
          {fmtE8(q.myE8, myCurrency)} is {usdText} today.
        </Txt>
      ) : null}
    </Screen>
  );
}
