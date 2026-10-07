import { router } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { formatUsd } from "../../lib/domain/currency";
import { parseLink } from "../../lib/domain/links";
import { placeLine } from "../../lib/send/draft";
import { hrefForLink } from "../../lib/send/route";
import { useBalance } from "../../lib/state/data";
import { Icon } from "../../ui/Icon";
import { Avatar, Banner, Btn, Card, Field, Hero, IconBtn, ListItem, Row, SectionHead, Skel } from "../../ui/kit";
import { Screen } from "../../ui/layout";
import { useLocal } from "../../ui/money";
import { Big3 } from "../../ui/send/bits";
import { DeskSend, useSendPeople } from "../../ui/send/desk";
import { useLayout } from "../../ui/shell/responsive";
import { AusdPill } from "../../ui/agora/dollars";
import { Txt } from "../../ui/Text";

/** 43 Send home: balance, three ways to send, then the people you send to. On a laptop, 114. */
export default function SendHome() {
  const { desk } = useLayout();
  return desk ? <DeskSend /> : <PhoneSendHome />;
}

function PhoneSendHome() {
  const bal = useBalance();
  const local = useLocal();
  const { people, act, plans } = useSendPeople();
  const [q, setQ] = useState("");

  const link = q.trim() ? parseLink(q.trim()) : null;
  const shown = q.trim() && !link ? people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())) : people;
  const balance = bal.data;

  const go = (p: { address: string; name: string; city?: string; country?: string; currency: string }) =>
    router.push({ pathname: "/send/amount", params: { to: p.address, n: p.name, c: p.city ?? "", cc: p.country ?? "", cur: p.currency } });

  const openLink = () => {
    if (!link) return;
    router.push(hrefForLink(link) as never);
    setQ("");
  };

  return (
    <Screen testID="screen-send" bottomInset={false} refreshing={act.isRefetching} onRefresh={() => void Promise.all([act.refetch(), bal.refetch(), plans.refetch()])}>
      <Row between style={{ minHeight: 72 }}>
        <Txt v="d28">Send</Txt>
        <IconBtn name="qr" label="My code" onPress={() => router.push("/my-code")} testID="btn-header-my-code" />
      </Row>
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
      <View style={{ marginTop: 12 }}>
        <Big3
          items={[
            { icon: "scan", label: "Scan code", onPress: () => router.push("/send/scan"), testID: "btn-scan-code", hi: true },
            { icon: "link", label: "Send by link", onPress: () => router.push("/send/link"), testID: "btn-send-by-link" },
            { icon: "qr", label: "My code", onPress: () => router.push("/my-code"), testID: "btn-my-code" },
          ]}
        />
      </View>
      <View style={{ marginTop: 12 }}>
        <Field value={q} onChangeText={setQ} placeholder="Name, or paste a Plans code" right={<Icon name="search" size={20} />} testID="field-search-people" />
      </View>
      {link ? (
        <Card style={{ marginTop: 8 }} onPress={openLink} testID="search-link-result" a11y="Open this link">
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

      <SectionHead title="Recent" right={people.length ? "See all" : undefined} onRight={() => router.push({ pathname: "/(tabs)/activity", params: { f: "money" } })} testID="link-recent-see-all" />
      {act.isLoading && plans.isLoading ? (
        <View style={{ gap: 12, marginTop: 6 }}>
          <Skel w="100%" h={52} />
          <Skel w="100%" h={52} />
        </View>
      ) : act.isError && people.length === 0 ? (
        <Banner kind="mut" icon="wifioff" title="Couldn't load the people you send to">
          <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void act.refetch()} style={{ marginTop: 8 }} testID="btn-recent-retry" />
        </Banner>
      ) : people.length === 0 ? (
        <Card dashed onPress={() => router.push("/send/scan")} testID="recent-empty" a11y="Scan a friend's code to start">
          <Row>
            <Icon name="scan" size={24} />
            <Txt v="t15" color="muted" style={{ flex: 1 }}>
              Scan a friend's code to start
            </Txt>
          </Row>
        </Card>
      ) : shown.length === 0 ? (
        <Txt v="t15" color="muted" style={{ paddingVertical: 12 }} testID="recent-no-match">
          No one called “{q.trim()}” yet. Scan their code instead.
        </Txt>
      ) : (
        shown.slice(0, 12).map((p, i) => (
          <ListItem
            key={p.address}
            left={<Avatar initial={p.initial} color={p.color} size={44} flag={p.flag} />}
            title={p.name}
            sub={placeLine(p)}
            right={<Icon name="chev" size={20} />}
            onPress={() => go(p)}
            testID={`recent-${p.address.slice(2, 8)}`}
            last={i === Math.min(shown.length, 12) - 1}
          />
        ))
      )}
      <View style={{ flex: 1, minHeight: 16 }} />
      <Banner kind="pos" icon="zap" title="Free and instant" text="To anyone on Plans, in any country. Usually under a second." />
      <View style={{ height: 16 }} />
    </Screen>
  );
}
