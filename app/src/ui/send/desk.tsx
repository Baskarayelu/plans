/**
 * Send on a laptop (designs 114, 115): people on the left, the amount in the middle typed with the
 * keyboard (no on-screen keypad), and "Check and send" in the right panel. The phone keeps its
 * steps (43 → 45 → 46 → 47); on a laptop /send, /send/amount and /send/confirm all render this page.
 */
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { settledMs } from "../../lib/api/relayer";
import { registeredKey } from "../../lib/chain/rpc";
import { currencyFor, formatUsd } from "../../lib/domain/currency";
import { parseLink } from "../../lib/domain/links";
import { sendMoney } from "../../lib/domain/planOps";
import { identity } from "../../lib/identity/session";
import { rateLines, shareRateLine } from "../../lib/fx/receiptRate";
import { e8ToText, fitNote, fmtE8, noteBudget, quote, unitsToE8, utf8Len } from "../../lib/send/convert";
import { placeLine, putSendReceipt, type Recipient } from "../../lib/send/draft";
import { recentRecipients } from "../../lib/send/history";
import { hrefForLink } from "../../lib/send/route";
import { personFor, useAccountActivity, useBalance, useFx, useMe, useMyPlans, type Person } from "../../lib/state/data";
import { useStore } from "../../lib/state/observable";
import { useAction } from "../../lib/state/useAction";
import { useColors } from "../../theme/ThemeProvider";
import { fonts } from "../../theme/tokens";
import { AusdPill } from "../agora/dollars";
import { Icon } from "../Icon";
import { Avatar, Banner, Btn, Card, Chip, Field, Hero, Row, Skel } from "../kit";
import { Screen } from "../layout";
import { useLocal } from "../money";
import { DeskTitle, PanelHead } from "../shell/desk";
import { SidePanel } from "../shell/panel";
import { useConfirmLabel } from "../shell/responsive";
import { Txt } from "../Text";
import { CheckRate, RateLines, RatesOutOfDate, useSendPreview } from "../fx/rates";
import { KV, Mono, useFxPair } from "./bits";

export type SendPick = Person & { lastAt: number };

/** People you've sent to, then everyone in your plans (43's Recent list). */
export function useSendPeople() {
  const { address } = useMe();
  const act = useAccountActivity();
  const plans = useMyPlans();
  const people = useMemo(() => {
    const me = address?.toLowerCase();
    const out = new Map<string, SendPick>();
    for (const r of recentRecipients(act.data, me)) {
      const p = personFor(r.address, { country: r.country, me });
      out.set(r.address, { ...p, currency: r.currency || p.currency, lastAt: r.at });
    }
    for (const plan of plans.data ?? []) {
      for (const p of plan.people) {
        if (p.me || p.address === me || out.has(p.address)) continue;
        out.set(p.address, { ...p, lastAt: 0 });
      }
    }
    return [...out.values()].sort((a, b) => b.lastAt - a.lastAt);
  }, [act.data, plans.data, address]);
  return { people, act, plans };
}

export const recipientOf = (p: { address: string; name: string; city?: string; country?: string; currency: string }): Recipient => ({
  address: p.address.toLowerCase() as Recipient["address"],
  name: p.name,
  city: p.city,
  country: p.country,
  currency: p.currency,
});

/** Opens the laptop Send page with this person picked (from the receipt, a Plans code, Send again). */
export function sendTo(p: { address: string; name: string; city?: string; country?: string; currency: string }) {
  router.navigate({ pathname: "/send/amount", params: { to: p.address, n: p.name, c: p.city ?? "", cc: p.country ?? "", cur: p.currency } });
}

/** Left column of 114/115: what you can send, find someone, recent people, and the other ways to send. */
export function SendLeft({ selected, onPick }: { selected?: string; onPick: (p: SendPick) => void }) {
  const c = useColors();
  const bal = useBalance();
  const local = useLocal();
  const { people, act, plans } = useSendPeople();
  const [q, setQ] = useState("");
  const link = q.trim() ? parseLink(q.trim()) : null;
  const shown = q.trim() && !link ? people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())) : people;
  const balance = bal.data;
  return (
    <View style={{ width: 300, gap: 12 }} testID="send-left">
      <Card testID="send-balance-card">
        <Txt v="ov" color="muted">
          You can send
        </Txt>
        <View style={{ marginTop: 4 }}>
          {balance === undefined ? (
            bal.isError ? (
              <Banner kind="mut" icon="wifioff" title="Couldn't load your balance">
                <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void bal.refetch()} style={{ marginTop: 8 }} testID="btn-balance-retry" />
              </Banner>
            ) : (
              <Skel w="50%" h={34} />
            )
          ) : (
            <Hero big={formatUsd(balance)} small={local.fmt(balance)} testID="send-balance" />
          )}
        </View>
        <View style={{ marginTop: 8 }}>
          <AusdPill align="flex-start" testID="pill-ausd" />
        </View>
      </Card>
      <Field value={q} onChangeText={setQ} placeholder="Name, or paste a Plans code" right={<Icon name="search" size={20} />} testID="field-search-people" />
      {link ? (
        <Card
          onPress={() => {
            router.push(hrefForLink(link) as never);
            setQ("");
          }}
          testID="search-link-result"
          a11y="Open this link"
        >
          <Row>
            <Avatar initial={((link.kind === "code" ? link.name : undefined)?.[0] ?? "P").toUpperCase()} color="#3C78B8" size={40} />
            <View style={{ flex: 1 }}>
              <Txt v="lt">{link.kind === "code" ? `Send to ${link.name ?? "this person"}` : link.kind === "claim" ? "Claim this link" : "Open this invite"}</Txt>
              <Txt v="t13" color="muted">
                {link.kind === "code" ? "From their Plans code" : "Opens in Plans"}
              </Txt>
            </View>
            <Icon name="chev" size={20} />
          </Row>
        </Card>
      ) : null}
      <View>
        <Txt v="ov" color="muted" style={{ marginTop: 4, marginBottom: 4 }}>
          Recent
        </Txt>
        {act.isLoading && plans.isLoading ? (
          <View style={{ gap: 10, marginTop: 6 }}>
            <Skel w="100%" h={48} />
            <Skel w="100%" h={48} />
          </View>
        ) : act.isError && people.length === 0 ? (
          <Banner kind="mut" icon="wifioff" title="Couldn't load the people you send to">
            <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void act.refetch()} style={{ marginTop: 8 }} testID="btn-recent-retry" />
          </Banner>
        ) : people.length === 0 ? (
          <Card dashed testID="recent-empty">
            <Txt v="t15" color="muted">
              People you send to show up here. Paste their Plans code above, or send by link.
            </Txt>
          </Card>
        ) : shown.length === 0 ? (
          <Txt v="t15" color="muted" style={{ paddingVertical: 12 }} testID="recent-no-match">
            No one called “{q.trim()}” yet. Paste their Plans code instead.
          </Txt>
        ) : (
          shown.slice(0, 12).map((p, i) => {
            const on = selected === p.address;
            return (
              <Pressable
                key={p.address}
                onPress={() => onPick(p)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Send to ${p.name}`}
                testID={`recent-${p.address.slice(2, 8)}`}
                style={(st) => {
                  const hovered = (st as { hovered?: boolean }).hovered;
                  return {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    minHeight: 58,
                    paddingHorizontal: 10,
                    marginHorizontal: -10,
                    borderRadius: 12,
                    backgroundColor: on || hovered ? c.surface2 : "transparent",
                  };
                }}
              >
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, alignSelf: "stretch", borderBottomWidth: on || i === Math.min(shown.length, 12) - 1 ? 0 : 1, borderBottomColor: c.line }}>
                  <Avatar initial={p.initial} color={p.color} size={40} flag={p.flag} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt v="lt" numberOfLines={1}>
                      {p.name}
                    </Txt>
                    <Txt v="t13" color="muted" numberOfLines={1}>
                      {placeLine(p)}
                    </Txt>
                  </View>
                </View>
              </Pressable>
            );
          })
        )}
      </View>
      <Row gap={8} wrap>
        <Chip label="Send by link" icon="link" onPress={() => router.push("/send/link")} testID="btn-send-by-link" />
        <Chip label="My code" icon="qr" onPress={() => router.push("/my-code")} testID="btn-my-code" />
        <Chip label="Scan" icon="scan" onPress={() => router.push("/send/scan")} testID="btn-scan-code" />
      </Row>
    </View>
  );
}

/** The Send page frame: big title with the strapline, the left column, and the middle. */
export function SendFrame({ left, children, testID }: { left: React.ReactNode; children: React.ReactNode; testID: string }) {
  return (
    <Screen testID={testID} bottomInset={false}>
      <DeskTitle
        title="Send"
        right={
          <Txt v="t13" color="muted">
            To anyone on Plans, in any country
          </Txt>
        }
      />
      <View style={{ flexDirection: "row", gap: 20, alignItems: "stretch", flex: 1 }}>
        {left}
        <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      </View>
    </Screen>
  );
}

/** Keeps what's typed a valid amount: digits, one point, at most `decimals` places. */
function cleanAmount(raw: string, decimals: number): string {
  let s = raw.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const dot = s.indexOf(".");
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  if (decimals === 0) s = s.replace(/\..*$/, "");
  const [i, f] = s.split(".");
  const int = (i ?? "").replace(/^0+(?=\d)/, "").slice(0, 9);
  if (f === undefined) return int;
  return `${int || "0"}.${f.slice(0, decimals)}`;
}

/** The big amount typed with the keyboard: currency symbol, the digits, an accent caret (focus). */
function AmountInput({ text, currency, onChange, onSubmit }: { text: string; currency: string; onChange: (s: string) => void; onSubmit: () => void }) {
  const c = useColors();
  const cur = currencyFor(currency);
  const shown = `${cur.symbol}${text || "0"}`;
  const fs = shown.length > 11 ? 56 : shown.length > 8 ? 68 : 80;
  const [w, setW] = useState(0);
  const ref = useRef<TextInput>(null);
  const type = { fontFamily: fonts.display, fontSize: fs, lineHeight: fs * 1.1, letterSpacing: -fs * 0.045 } as const;
  return (
    <Pressable onPress={() => ref.current?.focus()} style={{ alignItems: "center", justifyContent: "center", flexDirection: "row" }} accessibilityLabel="Amount">
      <Txt tnum style={[type, { color: text ? c.ink : c.muted }]}>
        {cur.symbol}
      </Txt>
      <View>
        {/* measures the digits so the field is exactly as wide as what's typed */}
        <Txt tnum style={[type, { position: "absolute", opacity: 0 }]} onLayout={(e) => setW(e.nativeEvent.layout.width)} aria-hidden>
          {text || "0"}
        </Txt>
        <TextInput
          ref={ref}
          testID="amount-display"
          accessibilityLabel={`Amount in ${cur.plural}`}
          value={text}
          onChangeText={(s) => onChange(cleanAmount(s, cur.decimals))}
          placeholder="0"
          placeholderTextColor={c.muted}
          inputMode="decimal"
          keyboardType="decimal-pad"
          autoFocus
          onSubmitEditing={onSubmit}
          selectionColor={c.accent}
          style={[type, { color: c.ink, padding: 0, margin: 0, width: Math.max(w, fs * 0.3) + 4, borderWidth: 0, outlineStyle: "none" } as object]}
        />
      </View>
    </Pressable>
  );
}

/** 114: pick a person, type the amount, check it in the panel and confirm with the passkey. */
export function DeskSend({ to: initialTo, text: initialText, inDollars: initialDollars }: { to?: Recipient | null; text?: string; inDollars?: boolean }) {
  const c = useColors();
  const status = useStore(identity, (s) => s.status);
  const { address, profile, currency: myCurrency } = useMe();
  const { people } = useSendPeople();
  const [picked, setPicked] = useState<Recipient | null>(initialTo ?? null);
  const to = picked ?? (people[0] ? recipientOf(people[0]) : null);
  const toCur = to?.currency ?? "USD";
  const bal = useBalance();
  const local = useLocal();
  const fxMy = useFx(myCurrency);
  const fxTheir = useFx(toCur);
  const pair = useFxPair(myCurrency, toCur, { refetchMs: 60_000 });
  const preview = useSendPreview(myCurrency, toCur);
  const [inDollars, setInDollars] = useState(initialDollars ?? myCurrency === "USD");
  const [text, setText] = useState(initialText ?? "");
  const [note, setNote] = useState("");
  const [rateUpdated, setRateUpdated] = useState(false);
  const firstTheir = useRef<bigint | null>(null);
  const confirmLabel = useConfirmLabel();
  const theirKey = useQuery({ queryKey: ["registeredKey", to?.address], enabled: !!to, queryFn: () => registeredKey(to!.address), staleTime: 60_000 });
  const send = useAction(sendMoney, { fatal: true, context: to ? `You were sending money to ${to.name}.` : undefined });

  useEffect(() => {
    if (initialTo) setPicked(initialTo);
  }, [initialTo?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rates older than a minute are refreshed before sending (46).
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

  const dollars = inDollars || myCurrency === "USD";
  const typingCur = dollars ? "USD" : myCurrency;
  const q = quote({ text, inDollars: dollars, myCurrency, theirCurrency: toCur, usdToMy: fxMy.data?.rateE8, usdToTheir: fxTheir.data?.rateE8 });

  // Same typed amount, new rate: say so once (46 "Rate updated").
  useEffect(() => {
    firstTheir.current = null;
    setRateUpdated(false);
  }, [text, to?.address, dollars]);
  useEffect(() => {
    if (q.theirE8 === null || !q.valid) return;
    if (firstTheir.current === null) firstTheir.current = q.theirE8;
    else if (q.theirE8 !== firstTheir.current) setRateUpdated(true);
  }, [q.theirE8]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (p: SendPick) => setPicked(recipientOf(p));
  const left = <SendLeft selected={to?.address} onPick={pick} />;

  if (!to) {
    return (
      <SendFrame left={left} testID="screen-send">
        <Card style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }} testID="send-pick-someone">
          <Icon name="send" size={32} color={c.muted} />
          <Txt v="d22" center style={{ marginTop: 12 }}>
            Who are you sending to?
          </Txt>
          <Txt v="t15" color="muted" center style={{ marginTop: 6, maxWidth: 360 }}>
            Pick someone on the left, paste their Plans code, or send a link anyone can claim.
          </Txt>
        </Card>
      </SendFrame>
    );
  }

  const me = personFor(address ?? "0x0000000000000000000000000000000000000000", { me: address });
  const them = personFor(to.address);
  const balance = bal.data;
  const own = !!address && to.address === address.toLowerCase();
  const over = q.valid && q.usdUnits !== null && balance !== undefined && q.usdUnits > balance;
  const ratesLoading = q.usdUnits === null || q.theirE8 === null;
  const ratesFailed = (fxMy.isError && !fxMy.data) || (fxTheir.isError && !fxTheir.data);
  const myText = myCurrency === "USD" ? (q.usdUnits !== null ? formatUsd(q.usdUnits) : null) : q.myE8 !== null ? fmtE8(q.myE8, myCurrency) : null;
  const theirText = q.theirE8 !== null ? fmtE8(q.theirE8, toCur) : null;
  // The rate the Sent receipt will carry (round named while fresh, else Plans' quote), in its words.
  const rate = toCur !== myCurrency && preview.gate === "ok" ? shareRateLine(preview.rate) : null;
  const blocked = preview.gate === "stale" || preview.gate === "missing";
  const place = to.city ? ` in ${to.city}` : "";
  const budget = noteBudget(profile?.name ?? "Friend", profile?.city);
  const trimmed = note.trim();
  const fits = fitNote(trimmed, budget);
  const noKey = theirKey.isSuccess && !theirKey.data;
  const noteHint = !trimmed
    ? `Only ${to.name} can read it. Keep it short: about ${budget} letters.`
    : noKey
      ? `${to.name} hasn't opened Plans yet, so the note can't reach them.`
      : utf8Len(trimmed) > budget
        ? `Too long: ${to.name} will see “${fits}”.`
        : `Only ${to.name} can read it.`;
  const ready = !own && q.valid && q.usdUnits !== null && q.usdUnits > 0n && theirText !== null && balance !== undefined && !over && preview.gate === "ok";

  const swap = () => {
    if (q.valid) {
      if (dollars && q.myE8 !== null) setText(e8ToText(q.myE8, myCurrency));
      else if (!dollars && q.usdUnits !== null) setText(e8ToText(unitsToE8(q.usdUnits), "USD"));
    }
    setInDollars(!dollars);
  };

  const confirm = async () => {
    if (!ready || q.usdUnits === null) return;
    if (status === "locked") {
      router.push({ pathname: "/unlock", params: { next: "/send" } });
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
    router.replace({ pathname: "/send/sent", params: { tx: r.result.txHash } });
  };

  // The other side of what's typed, unless it's already the "gets" line (they get that currency).
  const secondaryCur = dollars ? myCurrency : "USD";
  const secondary = secondaryCur === toCur ? null : dollars && myCurrency !== "USD" ? (q.myE8 !== null && q.valid ? fmtE8(q.myE8, myCurrency) : null) : !dollars && q.usdUnits !== null && q.valid ? formatUsd(q.usdUnits) : null;
  const fromLine = [profile?.name ?? "You", profile?.city].filter(Boolean).join(", ");

  return (
    <SendFrame left={left} testID="screen-send">
      <Card style={{ flex: 1, padding: 28 }} testID="screen-send-amount">
        <Row>
          <Avatar initial={them.initial} color={them.color} size={44} flag={them.flag} />
          <View style={{ flex: 1 }}>
            <Txt v="lt" testID="send-to-name">
              To {to.name}
            </Txt>
            <Txt v="t13" color="muted">
              {placeLine(to)}
            </Txt>
          </View>
        </Row>
        {own ? (
          <View style={{ marginTop: 24 }}>
            <Banner kind="inf" icon="info" title="That's your own Plans code" text="Friends use it to send you money. Pick someone else on the left." />
          </View>
        ) : null}
        <View style={{ alignItems: "center", marginTop: 40 }}>
          <AmountInput text={text} currency={typingCur} onChange={setText} onSubmit={() => void confirm()} />
          {secondary ? (
            <Txt v="t15" color="muted" style={{ marginTop: 2 }} testID="amount-secondary">
              {secondary}
            </Txt>
          ) : null}
          <View style={{ marginTop: 10, minHeight: 30, justifyContent: "center" }}>
            {ratesFailed ? (
              <Txt v="t15" color="neg" testID="recipient-gets">
                Couldn't get today's rate.
              </Txt>
            ) : ratesLoading ? (
              <Skel w={180} h={22} />
            ) : (
              <Txt style={{ fontSize: 24, lineHeight: 30 }} testID="recipient-gets">
                {to.name} {over ? "would get" : "gets"}{" "}
                <Txt style={{ fontSize: 24, lineHeight: 30 }} weight="bold">
                  {theirText}
                </Txt>
              </Txt>
            )}
          </View>
          {rate ? (
            <View style={{ marginTop: 6 }}>
              <Mono testID="rate-line">{rate}</Mono>
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
        <View style={{ marginTop: 24 }}>
          <Field label="Note" value={note} onChangeText={setNote} placeholder="Coffee ☕" maxLength={24} hint={noteHint} testID="field-send-note" inputProps={{ onSubmitEditing: () => void confirm() }} />
        </View>
        <Row style={{ justifyContent: "center", marginTop: 16 }}>
          <Chip sm tone="pos" icon="zap" label="No fee · arrives in under a second" />
        </Row>
      </Card>

      <SidePanel kind="form">
        <View style={{ flex: 1 }} testID="screen-send-confirm">
          <PanelHead title="Check and send" />
          <Row style={{ justifyContent: "center", marginTop: 4 }} gap={16}>
            <Avatar initial={me.initial} color="#D9634B" size={52} flag={me.flag} />
            <Icon name="chev" size={24} strokeWidth={2} />
            <Avatar initial={them.initial} color={them.color} size={52} flag={them.flag} />
          </Row>
          <View style={{ alignItems: "center", marginTop: 12 }}>
            <Txt v="d34" tnum testID="confirm-amount">
              {q.valid && myText ? myText : `${currencyFor(myCurrency).symbol}0`}
            </Txt>
            <Txt v="t15" center style={{ marginTop: 4 }} testID="confirm-gets">
              {to.name} gets{" "}
              <Txt v="t15" weight="bold">
                {q.valid && theirText ? theirText : "…"}
              </Txt>
              {place}
            </Txt>
            {rateUpdated ? (
              <View style={{ marginTop: 8 }}>
                <Chip sm tone="acc" icon="refresh" label="Rate refreshed" />
              </View>
            ) : null}
          </View>
          {over ? (
            <View style={{ marginTop: 16 }} testID="not-enough">
              <Banner kind="neg" icon="alert" title="That's more than you have" text={`You have ${[formatUsd(balance ?? 0n), local.fmt(balance ?? 0n)].filter(Boolean).join(" · ")}. Send less, or add money first.`}>
                <Btn label="Add money" kind="sec" icon="plus" sm onPress={() => router.push("/add-balance")} style={{ marginTop: 8 }} testID="btn-add-money" />
              </Banner>
            </View>
          ) : null}
          {blocked ? (
            <View style={{ marginTop: 16 }}>
              <RatesOutOfDate gate={preview.gate} onRefresh={preview.refresh} refreshing={preview.refreshing} />
            </View>
          ) : null}
          <Card style={{ marginTop: 16, gap: 8 }}>
            <KV k="You send" v={q.valid && myText ? myText : "…"} testID="confirm-you-send" />
            <KV k={`${to.name} gets`} v={q.valid && theirText ? theirText : "…"} testID="confirm-they-get" />
            <KV k="Fee" v="$0.00" />
            {trimmed ? <KV k="Note" v={noKey ? trimmed : fits} /> : null}
            {preview.gate === "ok" ? <RateLines lines={rateLines(preview.rate)} testID="confirm-rate-lines" /> : null}
          </Card>
          {preview.gate === "ok" ? <CheckRate rates={[preview.rate]} subtitle={`For your payment to ${to.name}.`} style={{ marginTop: 10 }} /> : null}
          {rate ? (
            <Txt v="t13" color="muted" style={{ marginTop: 10 }}>
              The rate is held for 60 seconds. After that we refresh it and tell you.
            </Txt>
          ) : null}
          <Txt v="ov" color="muted" style={{ marginTop: 20, marginBottom: 8 }}>
            {`What ${to.name} will see`}
          </Txt>
          <Card testID="send-preview">
            <Row align="flex-start">
              <Avatar initial={me.initial} color="#D9634B" size={40} flag={me.flag} />
              <View style={{ flex: 1 }}>
                <Txt v="lt" color="pos">
                  +{q.valid && theirText ? theirText : fmtE8(0n, toCur)}
                </Txt>
                <Txt v="t13" color="muted">
                  from {fromLine}
                  {trimmed && !noKey ? ` · “${fits}”` : ""}
                </Txt>
              </View>
              <Txt v="t13" color="muted">
                now
              </Txt>
            </Row>
          </Card>
          <View style={{ flex: 1, minHeight: 24 }} />
          {send.error ? (
            <View style={{ marginBottom: 8 }}>
              <Banner kind="neg" icon="alert" title={send.error.title} text={send.error.message} />
            </View>
          ) : null}
          <Btn label={confirmLabel} icon="key" onPress={() => void confirm()} disabled={!ready} loading={send.busy} testID="btn-confirm-with-fingerprint" />
        </View>
      </SidePanel>
    </SendFrame>
  );
}
