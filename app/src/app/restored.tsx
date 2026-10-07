import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { fetchMyPlans } from "../lib/api/envio";
import { countryByCode, formatUsd } from "../lib/domain/currency";
import { groupKeyFor, profilesFrom } from "../lib/domain/groups";
import { identity, saveProfile } from "../lib/identity/session";
import { useBalance, useMyPlans } from "../lib/state/data";
import { useStore } from "../lib/state/observable";
import { Banner, BigIcon, Btn, Card, Chip, EmojiTile, FingerprintPill, ListItem, Row, Skel, Tile } from "../ui/kit";
import { EntrySplit } from "../ui/desk/entry";
import { AppBar, Screen } from "../ui/layout";
import { useLayout } from "../ui/shell/responsive";
import { useLocal } from "../ui/money";
import { Txt } from "../ui/Text";

/** 05 Restore success: the account came back; plans, names and receipts are rebuilt from the passkey. */
export default function Restored() {
  const { next, via } = useLocalSearchParams<{ next?: string; via?: string }>();
  const st = useStore(identity, (s) => s);
  const [rebuilding, setRebuilding] = useState(!st.profile);
  const plans = useMyPlans();
  const bal = useBalance();
  const local = useLocal();
  const { desk } = useLayout();

  // Rebuild the profile from this person's own encrypted profile entry in any plan.
  useEffect(() => {
    if (st.profile || !st.address) return;
    void (async () => {
      try {
        const r = await fetchMyPlans(st.address!);
        const me = st.address!.toLowerCase();
        for (const m of r.Member) {
          const gk = groupKeyFor(m.pot.id, { me, keyWraps: m.pot.keyWraps, inviteKeyWrap: m.pot.inviteKeyWrap });
          const p = profilesFrom(m.pot.id, m.pot.keyWraps, gk)[me];
          if (p) {
            const country = p.country ?? r.Account[0]?.country ?? "US";
            await saveProfile({ name: p.name, city: p.city, country, currency: p.currency ?? countryByCode(country)?.currency ?? "USD" });
            break;
          }
        }
      } catch {
        /* offline: the profile form will ask */
      } finally {
        setRebuilding(false);
      }
    })();
  }, [st.address, st.profile]);

  const go = () => {
    if (!identity.get().profile) router.replace({ pathname: "/profile", params: next ? { next } : {} });
    else router.replace((next as never) ?? "/(tabs)");
  };

  const name = st.profile?.name;
  const list = plans.data ?? [];
  // 167: signed in with the phone's passkey through the browser's QR. Every later visit would ask for
  // the phone again, so offer linking this browser once (it gets its own passkey).
  const linkOffer =
    via === "phone" ? (
      <View style={{ marginTop: 12 }}>
        <Banner kind="inf" icon="link" title="Next time, skip the phone" text="Link this browser once and it gets its own passkey. Takes a minute." testID="restored-link-offer">
          <Btn label="Link this browser" kind="txt" sm onPress={() => router.push("/link")} testID="btn-link-this-browser" style={{ height: 36, minHeight: 36, paddingHorizontal: 0 }} />
        </Banner>
      </View>
    ) : null;
  const rows = (
    <>
      {plans.isLoading || rebuilding ? (
        [0, 1].map((i) => (
          <Row key={i} style={{ minHeight: 64 }}>
            <Skel w={44} h={44} r={14} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skel w="70%" h={12} />
              <Skel w="40%" h={10} />
            </View>
          </Row>
        ))
      ) : plans.isError ? (
        <ListItem left={<Tile icon="refresh" />} title="Couldn't load your plans" sub="Tap to try again" onPress={() => void plans.refetch()} testID="restored-retry" />
      ) : (
        list.slice(0, 4).map((p) => (
          <ListItem
            key={p.pot}
            left={<EmojiTile emoji={p.meta.emoji} color={p.meta.color} size={44} />}
            title={p.meta.name}
            sub={`${p.status === "Settled" ? "Ended" : "Active"} · ${p.memberCount} people`}
            right={
              p.myNet === 0n ? (
                <Txt v="lt" color="muted">
                  All square
                </Txt>
              ) : (
                <Txt v="lt" color={p.myNet > 0n ? "pos" : "neg"}>
                  {local.fmt(p.myNet, { sign: true }) ?? formatUsd(p.myNet, { sign: true })}
                </Txt>
              )
            }
            rsub={p.myNet === 0n ? undefined : p.myNet > 0n ? "owed to you" : "you owe"}
          />
        ))
      )}
      <ListItem left={<Tile icon="ticket" />} title="Your Plans account" sub="Balance" right={bal.data !== undefined ? formatUsd(bal.data) : "…"} rsub={bal.data !== undefined ? local.fmt(bal.data) : undefined} last />
    </>
  );

  if (desk) {
    // 107 on a laptop: the welcome bands on the left, the rebuilt account in a card on the right.
    return (
      <Screen testID="screen-restored" pad={false} scroll={false} bottomInset={false}>
        <EntrySplit center>
          <Card style={{ width: 560, maxWidth: "100%", padding: 32 }} testID="restored-card">
            <View style={{ alignSelf: "flex-start" }}>
              <BigIcon icon="check" kind="p" />
            </View>
            <Txt v="d34" style={{ marginTop: 16 }} accessibilityRole="header">
              {name ? `Welcome back, ${name}` : "Welcome back"}
            </Txt>
            <Txt v="t17" color="muted" style={{ marginTop: 8, marginBottom: 12 }}>
              We found your Plans account and rebuilt everything in this browser.
            </Txt>
            {rows}
            <Card tint style={{ marginTop: 16 }} p={12}>
              <Row>
                <FingerprintPill emoji={st.fingerprint} />
                <Txt v="t13" color="muted" style={{ flex: 1 }}>
                  {st.fingerprint ? "Same key as your phone, so receipts and notes open here too." : "Your receipts unlock the first time you open one."}
                </Txt>
              </Row>
            </Card>
            {linkOffer}
            <View style={{ width: 240, marginTop: 20 }}>
              <Btn label={name ? "Go to my plans" : "Continue"} onPress={go} disabled={rebuilding} testID="btn-go-to-my-plans" />
            </View>
          </Card>
        </EntrySplit>
      </Screen>
    );
  }

  return (
    <Screen testID="screen-restored" dock={<Btn label={name ? "Go to my plans" : "Continue"} onPress={go} disabled={rebuilding} testID="btn-go-to-my-plans" />}>
      <AppBar noBack />
      <View style={{ marginTop: 8 }}>
        <BigIcon icon="check" kind="p" />
      </View>
      <Txt v="d28" center style={{ marginTop: 16 }}>
        {name ? `Welcome back, ${name}` : "Welcome back"}
      </Txt>
      <Txt v="t15" color="muted" center style={{ marginTop: 8, marginHorizontal: 12 }}>
        We found your Plans account and rebuilt everything.
      </Txt>
      <Card style={{ marginTop: 24 }}>
        <Txt v="ov" color="muted">
          Back on this phone
        </Txt>
        {rows}
      </Card>
      <Card tint style={{ marginTop: 12 }}>
        <FingerprintPill emoji={st.fingerprint} />
        <Txt v="t13" color="muted" style={{ marginTop: 10 }}>
          {st.fingerprint ? "Same key as your other phone, so your receipts and notes open as normal." : "Your receipts unlock the first time you open one."}
        </Txt>
      </Card>
      {linkOffer}
      {plans.data && plans.data.length === 0 && !rebuilding ? (
        <View style={{ marginTop: 12 }}>
          <Chip label="No plans yet" sm />
        </View>
      ) : null}
    </Screen>
  );
}
