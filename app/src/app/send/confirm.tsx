import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { settledMs } from "../../lib/api/relayer";
import { registeredKey } from "../../lib/chain/rpc";
import { formatUsd } from "../../lib/domain/currency";
import { sendMoney } from "../../lib/domain/planOps";
import { identity } from "../../lib/identity/session";
import { fitNote, fmtE8, noteBudget, quote, rateLine, utf8Len } from "../../lib/send/convert";
import { putSendReceipt, sendDraft } from "../../lib/send/draft";
import { personFor, useBalance, useFx, useMe } from "../../lib/state/data";
import { useStore } from "../../lib/state/observable";
import { useAction } from "../../lib/state/useAction";
import { Icon } from "../../ui/Icon";
import { Avatar, Banner, Btn, Card, Chip, Field, Row, Skel } from "../../ui/kit";
import { AppBar, Screen } from "../../ui/layout";
import { KV, Mono, useFxPair } from "../../ui/send/bits";
import { DeskSend } from "../../ui/send/desk";
import { useConfirmLabel, useLayout } from "../../ui/shell/responsive";
import { Txt } from "../../ui/Text";

/** 46 Check and send. The rate is refreshed when it is over a minute old. */
export default function SendConfirm() {
  const draft = useStore(sendDraft);
  const status = useStore(identity, (s) => s.status);
  const { address, profile, currency: myCurrency } = useMe();
  const bal = useBalance();
  const toCur = draft?.to.currency ?? "USD";
  const fxMy = useFx(myCurrency);
  const fxTheir = useFx(toCur);
  const pair = useFxPair(myCurrency, toCur, { refetchMs: 60_000 });
  const [note, setNote] = useState("");
  const [rateUpdated, setRateUpdated] = useState(false);
  const firstTheir = useRef<bigint | null>(null);
  const theirKey = useQuery({ queryKey: ["registeredKey", draft?.to.address], enabled: !!draft, queryFn: () => registeredKey(draft!.to.address), staleTime: 60_000 });

  // Rates older than a minute are refreshed before sending.
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      if (fxMy.dataUpdatedAt && now - fxMy.dataUpdatedAt > 60_000) void fxMy.refetch();
      if (fxTheir.dataUpdatedAt && now - fxTheir.dataUpdatedAt > 60_000) void fxTheir.refetch();
    };
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, [fxMy.dataUpdatedAt, fxTheir.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = draft ? quote({ text: draft.text, inDollars: draft.inDollars, myCurrency, theirCurrency: toCur, usdToMy: fxMy.data?.rateE8, usdToTheir: fxTheir.data?.rateE8 }) : null;

  useEffect(() => {
    if (!q || q.theirE8 === null) return;
    if (firstTheir.current === null) firstTheir.current = q.theirE8;
    else if (q.theirE8 !== firstTheir.current) setRateUpdated(true);
  }, [q?.theirE8]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useAction(sendMoney, { fatal: true, context: draft ? `You were sending money to ${draft.to.name}.` : undefined });
  const { desk } = useLayout();
  const confirmLabel = useConfirmLabel();

  // 114 on a laptop: the check lives in the Send page's panel.
  if (desk) return <DeskSend to={draft?.to ?? null} text={draft?.text} inDollars={draft?.inDollars} />;

  if (!draft || !q) {
    return (
      <Screen testID="screen-send-confirm">
        <AppBar title="Check and send" />
        <Banner kind="mut" icon="info" title="Nothing to send yet" text="Pick who to send to and type an amount first." />
        <Btn label="Back to Send" kind="sec" onPress={() => router.replace("/(tabs)/send")} style={{ marginTop: 16 }} testID="btn-back-to-send" />
      </Screen>
    );
  }

  const to = draft.to;
  const me = personFor(address ?? "0x0000000000000000000000000000000000000000", { me: address });
  const them = personFor(to.address);
  const balance = bal.data;
  const over = q.usdUnits !== null && balance !== undefined && q.usdUnits > balance;
  const myText = myCurrency === "USD" ? (q.usdUnits !== null ? formatUsd(q.usdUnits) : null) : q.myE8 !== null ? fmtE8(q.myE8, myCurrency) : null;
  const theirText = q.theirE8 !== null ? fmtE8(q.theirE8, to.currency) : null;
  const place = to.city ? ` in ${to.city}` : "";
  const budget = noteBudget(profile?.name ?? "Friend", profile?.city);
  const trimmed = note.trim();
  const fits = fitNote(trimmed, budget);
  const noKey = theirKey.isSuccess && !theirKey.data;
  const noteHint = !trimmed
    ? `Only ${to.name} can read it. Keep it short: about ${budget} letters.`
    : noKey
      ? `${to.name} hasn't opened Plans on a phone yet, so the note can't reach them.`
      : utf8Len(trimmed) > budget
        ? `Too long: ${to.name} will see “${fits}”.`
        : `Only ${to.name} can read it.`;
  const ready = q.usdUnits !== null && q.usdUnits > 0n && theirText !== null && balance !== undefined && !over;

  const confirm = async () => {
    if (!ready || q.usdUnits === null) return;
    if (status === "locked") {
      router.push({ pathname: "/unlock", params: { next: "/send/confirm" } });
      return;
    }
    const r = await send.run({ to: to.address, amount: q.usdUnits, toCountry: to.country, toCurrency: to.currency, note: trimmed || undefined });
    if (!r) return;
    putSendReceipt({
      txHash: r.result.txHash,
      settledMs: settledMs(r.result),
      at: Date.now(),
      to,
      from: { name: profile?.name ?? "You", city: profile?.city, country: profile?.country },
      myCurrency,
      myE8: q.myE8 !== null ? q.myE8.toString() : null,
      usdUnits: q.usdUnits.toString(),
      theirE8: q.theirE8 !== null ? q.theirE8.toString() : null,
      rateE8: r.rateE8.toString(),
      fromCurrency: r.fromCurrency,
      fxTimestamp: r.fxTimestamp,
      source: r.source ?? pair.data?.source,
      note: trimmed ? (noKey ? trimmed : fits) : undefined,
      round: r.round,
    });
    sendDraft.set(null);
    router.replace({ pathname: "/send/sent", params: { tx: r.result.txHash } });
  };

  const rate = to.currency !== myCurrency && pair.data ? rateLine(myCurrency, to.currency, pair.data.rateE8, pair.data.timestamp, pair.data.source) : null;

  return (
    <Screen
      testID="screen-send-confirm"
      dock={
        <>
          {send.error ? <Banner kind="neg" icon="alert" title={send.error.title} text={send.error.message} /> : null}
          <Btn label={confirmLabel} icon={confirmLabel === "Confirm with fingerprint" ? "fp" : "key"} onPress={() => void confirm()} disabled={!ready} loading={send.busy} testID="btn-confirm-with-fingerprint" />
        </>
      }
    >
      <AppBar title="Check and send" />
      <Row style={{ justifyContent: "center", marginTop: 8 }} gap={16}>
        <Avatar initial={me.initial} color="#D9634B" size={56} flag={me.flag} />
        <Icon name="chev" size={28} strokeWidth={2} />
        <Avatar initial={them.initial} color={them.color} size={56} flag={them.flag} />
      </Row>
      <View style={{ alignItems: "center", marginTop: 16 }}>
        {myText ? (
          <Txt v="d44" tnum testID="confirm-amount">
            {myText}
          </Txt>
        ) : (
          <Skel w={160} h={44} />
        )}
        <Txt v="t17" center style={{ marginTop: 8 }} testID="confirm-gets">
          {to.name} gets <Txt v="t17" weight="bold">{theirText ?? "…"}</Txt>
          {place}
        </Txt>
        {rateUpdated ? (
          <View style={{ marginTop: 8 }}>
            <Chip sm tone="inf" icon="refresh" label="Rate updated" />
          </View>
        ) : null}
      </View>
      {over ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="neg" icon="alert" title="That's more than you have" text="Go back and send less, or add money first." />
        </View>
      ) : null}
      <Card style={{ marginTop: 20, gap: 8 }}>
        <KV k="To" v={`${to.name}${to.city ? ` · ${to.city}` : ""}`} />
        <KV k="You send" v={myText ?? "…"} testID="confirm-you-send" />
        <KV k={`${to.name} gets`} v={theirText ?? "…"} testID="confirm-they-get" />
        <KV k="Fee" v="$0.00" />
        {rate ? <Mono testID="rate-line">{rate}</Mono> : null}
      </Card>
      <View style={{ marginTop: 12 }}>
        <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Coffee ☕" maxLength={24} hint={noteHint} testID="field-send-note" />
      </View>
    </Screen>
  );
}
