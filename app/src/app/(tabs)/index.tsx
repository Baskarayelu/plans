import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { formatUsd, formatUsdShort } from "../../lib/domain/currency";
import { identity } from "../../lib/identity/session";
import { moneyRows, type MoneyRow } from "../../lib/send/history";
import { personFor, useAccountActivity, useBalance, useDemoAccounts, useMe, useMyPlans, type PlanCardVM } from "../../lib/state/data";
import { useStore } from "../../lib/state/observable";
import { storage } from "../../lib/state/storage";
import { useColors } from "../../theme/ThemeProvider";
import { WRISTBANDS } from "../../theme/tokens";
import { Icon } from "../../ui/Icon";
import { Avatar, AvatarStack, Band, Banner, Btn, Card, Chip, EmojiTile, Hero, ListItem, LiveDot, Row, Skel, Tile, Wristband } from "../../ui/kit";
import { Screen } from "../../ui/layout";
import { useLocal } from "../../ui/money";
import { Txt } from "../../ui/Text";
import { ago, dateRange, PositionChip } from "../../ui/planBits";
import { fonts } from "../../theme/tokens";
import { AusdPill } from "../../ui/agora/dollars";
import { DESK_SM, DeskSection } from "../../ui/desk/plan";
import { usePlanIndex } from "../../ui/send/rows";
import { DeskTitle, Grid } from "../../ui/shell/desk";
import { useLayout } from "../../ui/shell/responsive";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function bandText(p: PlanCardVM): string {
  const now = Date.now() / 1000;
  if (p.status === "Settled") return `${p.meta.name} · settled`;
  if (p.ended) return `${p.meta.name} · ended ${dateRange(p.endTime, p.endTime).split("–").pop()}`;
  if (now < p.startTime) return `${p.meta.name} · starts ${dateRange(p.startTime, p.startTime).split("–").pop()}`;
  const day = Math.floor((now - p.startTime) / 86400) + 1;
  const days = Math.max(1, Math.ceil((p.endTime - p.startTime) / 86400));
  return `${p.meta.name} · day ${Math.min(day, days)} of ${days}`;
}

function PlanCard({ p, grid }: { p: PlanCardVM; grid?: boolean }) {
  const c = useColors();
  const local = useLocal();
  const settledDebt = p.status === "Settled" && p.myDebt > 0n;
  return (
    <Pressable
      testID={`plan-card-${p.pot.slice(2, 8)}`}
      accessibilityRole="button"
      accessibilityLabel={`Open ${p.meta.name}`}
      onPress={() => router.push({ pathname: "/plan/[pot]", params: { pot: p.pot } })}
      style={({ pressed }) => ({ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 14, overflow: "hidden", marginTop: grid ? 0 : 12, opacity: pressed ? 0.9 : 1, ...(grid ? { flex: 1 } : null) })}
    >
      <Wristband color={p.meta.color} text={bandText(p)} />
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 }}>
        <Row>
          <EmojiTile emoji={p.meta.emoji} color={p.meta.color} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Row gap={0}>
              <Txt v="d17" numberOfLines={1} style={grid ? { fontSize: 19, lineHeight: 24 } : undefined}>
                {p.meta.name}
              </Txt>
              {p.isDemo ? <DemoMini /> : null}
            </Row>
            <Txt v="t13" color="muted">
              {p.status === "Settled" ? `Settled · ${p.memberCount} people` : `Pot ${formatUsd(p.balance)}${local.fmt(p.balance) ? ` · ${local.fmt(p.balance)}` : ""}`}
            </Txt>
          </View>
          {grid && p.status === "Settled" ? null : <AvatarStack people={grid ? p.people.slice(0, 4) : p.people} size={grid ? 24 : 26} />}
        </Row>
        <Row between style={{ marginTop: grid ? 16 : 12 }}>
          <PositionChip net={p.myNet} debt={p.myDebt} settled={p.status === "Settled"} />
          {settledDebt ? (
            <Row gap={2}>
              <Txt v="t13" weight="bold">
                Pay now
              </Txt>
              <Icon name="chev" size={16} strokeWidth={2.2} />
            </Row>
          ) : p.needsMe > 0 ? (
            <Txt v="t13" color="info" weight="bold">
              {p.needsMe === 1 ? "1 needs your OK" : `${p.needsMe} need your OK`}
            </Txt>
          ) : p.lastSpend && p.status !== "Settled" ? (
            <Row gap={8}>
              <LiveDot />
              <Txt v="t13" color="muted">
                {p.lastSpend.who.name} paid {formatUsdShort(p.lastSpend.amount)} · {ago(p.lastSpend.at)}
              </Txt>
            </Row>
          ) : null}
        </Row>
      </View>
    </Pressable>
  );
}

function DemoMini() {
  const c = useColors();
  return (
    <View style={{ height: 18, paddingHorizontal: 6, borderRadius: 999, backgroundColor: c.surface2, justifyContent: "center", marginLeft: 6 }}>
      <Txt style={{ fontFamily: fonts.monoSemi, fontSize: 9.5, letterSpacing: 0.8, color: c.info }}>DEMO</Txt>
    </View>
  );
}

function TryCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Card dashed style={{ marginTop: 12 }} testID="try-settle-up-card">
      <Row align="flex-start">
        <Tile icon="sparkle" kind="a" />
        <View style={{ flex: 1 }}>
          <Txt v="lt">Try a settle-up</Txt>
          <Txt v="t13" color="muted">
            A 2-minute trip with three demo friends. Small amounts only.
          </Txt>
        </View>
        <Pressable testID="btn-dismiss-demo" accessibilityLabel="Dismiss" onPress={onDismiss} hitSlop={10}>
          <Icon name="x" size={20} />
        </Pressable>
      </Row>
      <Btn label="Start demo" kind="sec" sm flex style={{ marginTop: 12, alignSelf: "stretch" }} onPress={() => router.push("/demo")} testID="btn-start-demo" />
    </Card>
  );
}

export default function Home() {
  const { desk } = useLayout();
  return desk ? <DeskHome /> : <PhoneHome />;
}

function PhoneHome() {
  const c = useColors();
  const profile = useStore(identity, (s) => s.profile);
  const keysPending = useStore(identity, (s) => s.keysPending);
  const plans = useMyPlans();
  const bal = useBalance();
  useDemoAccounts();
  const local = useLocal();
  const [hideDemo, setHideDemo] = useState(true);
  useEffect(() => {
    void storage.loadPrefs().then((p) => setHideDemo(!!p.hideDemoCard));
  }, []);
  const dismissDemo = () => {
    setHideDemo(true);
    void storage.loadPrefs().then((p) => storage.savePrefs({ ...p, hideDemoCard: true }));
  };
  const list = plans.data ?? [];
  const empty = plans.isSuccess && list.length === 0;
  const name = profile?.name ?? "";
  const balance = bal.data ?? 0n;

  return (
    <Screen testID="screen-home" refreshing={plans.isRefetching} onRefresh={() => void Promise.all([plans.refetch(), bal.refetch()])} bottomInset={false}>
      <Row between style={{ minHeight: 72 }}>
        <View>
          <Txt v="t13" color="muted">
            {empty ? `Welcome, ${name}` : `${greeting()}, ${name}`}
          </Txt>
          <Txt v="d28">Your plans</Txt>
        </View>
        <Pressable onPress={() => router.push("/(tabs)/you")} accessibilityLabel="You" testID="home-avatar">
          <Avatar initial={(name[0] ?? "?").toUpperCase()} color="#D9634B" size={44} />
        </Pressable>
      </Row>
      {keysPending ? (
        <View style={{ marginBottom: 12 }}>
          <Banner kind="inf" icon="lock" title="Unlock receipts on this phone" text="One more fingerprint opens plan names, notes and photos.">
            <Btn label="Unlock receipts" kind="sec" sm onPress={() => router.push("/unlock-keys")} style={{ marginTop: 8 }} testID="btn-unlock-receipts" />
          </Banner>
        </View>
      ) : null}
      <Card onPress={() => router.push("/balance")} testID="balance-card" a11y="Your Plans account">
        <Row between>
          <Txt v="ov" color="muted">
            Your Plans account
          </Txt>
          <Icon name="chev" size={18} />
        </Row>
        <View style={{ marginTop: 4 }}>
          {bal.isLoading ? <Skel w="55%" h={34} /> : <Hero big={formatUsd(balance)} small={local.fmt(balance)} testID="home-balance" />}
        </View>
        <Row gap={8} style={{ marginTop: 12 }}>
          {balance === 0n ? (
            <>
              <Btn label="Add money" icon="plus" sm flex onPress={() => router.push("/add-balance")} testID="btn-home-add-money" />
              <Btn label="Receive" kind="sec" icon="qr" sm flex onPress={() => router.push("/my-code")} testID="btn-home-receive" />
            </>
          ) : (
            <>
              <Btn label="Send" icon="send" sm flex onPress={() => router.push("/(tabs)/send")} testID="btn-home-send" />
              <Btn label="Add" kind="sec" icon="plus" sm flex onPress={() => router.push("/add-balance")} testID="btn-home-add" />
              <Btn label="Receive" kind="sec" icon="qr" sm flex onPress={() => router.push("/my-code")} testID="btn-home-receive" />
            </>
          )}
        </Row>
      </Card>

      {plans.isLoading ? (
        <View style={{ marginTop: 20, gap: 12 }}>
          <Skel w="30%" h={16} />
          <Skel w="100%" h={130} r={14} />
        </View>
      ) : plans.isError ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="mut" icon="wifioff" title="Couldn't load your plans" text="Check your connection.">
            <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void plans.refetch()} style={{ marginTop: 8 }} testID="btn-home-retry" />
          </Banner>
          {/* Starting or joining a plan doesn't need the plan list. */}
          <Btn label="New plan" icon="plus" onPress={() => router.push("/plan/new")} style={{ marginTop: 16 }} testID="btn-new-plan" />
          <Btn label="Join with a link or code" kind="sec" icon="link" onPress={() => router.push("/join-link")} style={{ marginTop: 8 }} testID="btn-join-link" />
        </View>
      ) : empty ? (
        <>
          <View style={{ height: 150, marginHorizontal: -16, marginTop: 8, overflow: "hidden" }}>
            <Band color={WRISTBANDS.lagoon} text="YOUR FIRST PLAN · YOUR FIRST PLAN" style={{ position: "absolute", width: 600, top: 40, left: -40, transform: [{ rotate: "-6deg" }] }} />
            <Band color={WRISTBANDS.marigold} text="FRIENDS · ANY COUNTRY · ONE POT" style={{ position: "absolute", width: 600, top: 86, left: -120, transform: [{ rotate: "4deg" }] }} />
          </View>
          <Txt v="d22" center>
            No plans yet
          </Txt>
          <Txt v="t15" color="muted" center style={{ marginHorizontal: 8, marginTop: 6, marginBottom: 16 }}>
            Start a pot for a trip, a festival or a dinner. Friends join with one tap, from any country.
          </Txt>
          <Btn label="New plan" icon="plus" onPress={() => router.push("/plan/new")} testID="btn-new-plan" />
          <Btn label="Join with a link or code" kind="sec" icon="link" onPress={() => router.push("/join-link")} style={{ marginTop: 8 }} testID="btn-join-link" />
        </>
      ) : (
        <>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 20, marginBottom: 0 }}>
            <Txt v="d17">Plans</Txt>
            <Row gap={16}>
              <Pressable testID="btn-join" onPress={() => router.push("/join-link")} hitSlop={8}>
                <Txt v="t13" color="muted" weight="semi">
                  Join
                </Txt>
              </Pressable>
              <Pressable testID="btn-new-plan" onPress={() => router.push("/plan/new")} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <Icon name="plus" size={16} strokeWidth={2.4} color={c.ink} />
                <Txt v="t13" weight="semi">
                  New plan
                </Txt>
              </Pressable>
            </Row>
          </View>
          {list.map((p) => (
            <PlanCard key={p.pot} p={p} />
          ))}
        </>
      )}
      {!hideDemo ? <TryCard onDismiss={dismissDemo} /> : null}
      <View style={{ height: 24 }} />
    </Screen>
  );
}

// ─────────────── 108 Home on a laptop ───────────────

function DeskTryCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Card dashed style={{ flex: 1 }} testID="try-settle-up-card">
      <Row align="flex-start">
        <Tile icon="sparkle" kind="a" />
        <View style={{ flex: 1 }}>
          <Txt v="lt">Try a settle-up</Txt>
          <Txt v="t13" color="muted">
            A 2-minute trip with three demo friends. Small amounts only.
          </Txt>
        </View>
        <Pressable testID="btn-dismiss-demo" accessibilityLabel="Dismiss" onPress={onDismiss} hitSlop={10}>
          <Icon name="x" size={20} />
        </Pressable>
      </Row>
      <Btn label="Start demo" kind="sec" sm style={[DESK_SM, { marginTop: 12 }]} onPress={() => router.push("/demo")} testID="btn-start-demo" />
    </Card>
  );
}

function BigChoice({ icon, kind, title, text, onPress, testID, dashed }: { icon: "plus" | "link"; kind?: "a"; title: string; text: string; onPress: () => void; testID: string; dashed?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: dashed ? 150 : 200,
        borderRadius: 14,
        borderWidth: 1.5,
        borderStyle: dashed ? "dashed" : "solid",
        borderColor: c.line,
        backgroundColor: dashed ? "transparent" : c.surface,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 20,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: kind === "a" ? c.accent : c.surface2, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={22} color={kind === "a" ? c.onAccent : c.ink} />
      </View>
      <Txt v={dashed ? "lt" : "d22"} center>
        {title}
      </Txt>
      <Txt v="t13" color="muted" center>
        {text}
      </Txt>
    </Pressable>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One cell of the "Recent money" strip: short title, the day, the signed amount (108). */
function RecentMoney({ r, me, plans }: { r: MoneyRow; me?: string; plans: Map<string, PlanCardVM> }) {
  const plan = r.pot ? plans.get(r.pot) : undefined;
  const who = r.counterparty ? personFor(r.counterparty, { me }) : undefined;
  const name = who && who.name !== "Friend" ? who.name : undefined;
  const pos = r.usd > 0n;
  const titles: Record<MoneyRow["kind"], string> = {
    sendIn: name ? `From ${name}` : "Money in",
    sendOut: name ? `To ${name}` : "Sent",
    claimIn: "Added",
    linkOut: "Link sent",
    linkBack: "Link came back",
    payout: plan ? `From ${plan.meta.name}` : "Settle-up",
    contributed: plan ? `To ${plan.meta.name}` : "To a plan",
    debtPaid: plan ? `Paid ${plan.meta.name}` : "Paid what you owed",
  };
  const d = new Date(r.at * 1000);
  return (
    <ListItem
      testID={`recent-${r.id.slice(-6)}`}
      left={<Tile icon={pos ? "in" : "out"} kind={pos ? "p" : undefined} />}
      title={
        <Txt v="lt" numberOfLines={1}>
          {titles[r.kind]}
        </Txt>
      }
      sub={`${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`}
      right={
        <Txt v="lt" color={pos ? "pos" : "ink"} tnum>
          {formatUsd(r.usd, { sign: true })}
        </Txt>
      }
      last
    />
  );
}

function DeskHome() {
  const profile = useStore(identity, (s) => s.profile);
  const keysPending = useStore(identity, (s) => s.keysPending);
  const plans = useMyPlans();
  const bal = useBalance();
  const act = useAccountActivity();
  const me = useMe().address?.toLowerCase();
  const planIndex = usePlanIndex();
  useDemoAccounts();
  const local = useLocal();
  const { width } = useLayout();
  const [hideDemo, setHideDemo] = useState(true);
  useEffect(() => {
    void storage.loadPrefs().then((p) => setHideDemo(!!p.hideDemoCard));
  }, []);
  const dismissDemo = () => {
    setHideDemo(true);
    void storage.loadPrefs().then((p) => storage.savePrefs({ ...p, hideDemoCard: true }));
  };
  const list = plans.data ?? [];
  const empty = plans.isSuccess && list.length === 0;
  const name = profile?.name ?? "";
  const balance = bal.data ?? 0n;
  const activeCount = list.filter((p) => p.status !== "Settled" && !p.ended).length;
  const recent = moneyRows(act.data, me).slice(0, 3);
  const cols = width >= 1680 && list.length >= 6 ? 3 : 2;

  const cards: React.ReactNode[] = [
    ...list.map((p) => <PlanCard key={p.pot} p={p} grid />),
    ...(!hideDemo ? [<DeskTryCard key="try" onDismiss={dismissDemo} />] : []),
    <BigChoice key="new" dashed icon="plus" title="New plan" text="Trip, festival, house share" onPress={() => router.push("/plan/new")} testID="card-new-plan" />,
  ];

  return (
    <Screen testID="screen-home" refreshing={plans.isRefetching} onRefresh={() => void Promise.all([plans.refetch(), bal.refetch()])} bottomInset={false}>
      <DeskTitle
        over={empty ? `Welcome, ${name}` : `${greeting()}, ${name}`}
        title="Your plans"
        right={
          <>
            <Btn label="Join with a link" kind="sec" icon="link" sm style={DESK_SM} onPress={() => router.push("/join-link")} testID="btn-join-link" />
            <Btn label="New plan" icon="plus" sm style={DESK_SM} onPress={() => router.push("/plan/new")} testID="btn-new-plan" />
          </>
        }
      />
      {keysPending ? (
        <View style={{ marginBottom: 12 }}>
          <Banner kind="inf" icon="lock" title="Unlock receipts on this computer" text="One more passkey check opens plan names, notes and photos.">
            <Btn label="Unlock receipts" kind="sec" sm onPress={() => router.push("/unlock-keys")} style={{ marginTop: 8 }} testID="btn-unlock-receipts" />
          </Banner>
        </View>
      ) : null}
      <Card testID="balance-card" style={{ paddingVertical: 18 }}>
        <Row gap={24}>
          <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => router.push("/balance")} accessibilityRole="button" accessibilityLabel="Your Plans account" testID="btn-home-balance">
            <Row gap={10}>
              <Txt v="ov" color="muted">
                Your Plans account
              </Txt>
              <AusdPill align="flex-start" testID="pill-ausd-home" />
            </Row>
            <View style={{ marginTop: 6 }}>{bal.isLoading ? <Skel w="45%" h={44} /> : <Hero big={formatUsd(balance)} small={local.fmt(balance)} size="d44" testID="home-balance" />}</View>
          </Pressable>
          <Row gap={8}>
            {balance === 0n ? (
              <>
                <Btn label="Add money" icon="plus" sm style={DESK_SM} onPress={() => router.push("/add-balance")} testID="btn-home-add-money" />
                <Btn label="Receive" kind="sec" icon="qr" sm style={DESK_SM} onPress={() => router.push("/my-code")} testID="btn-home-receive" />
              </>
            ) : (
              <>
                <Btn label="Send" icon="send" sm style={DESK_SM} onPress={() => router.push("/(tabs)/send")} testID="btn-home-send" />
                <Btn label="Add" kind="sec" icon="plus" sm style={DESK_SM} onPress={() => router.push("/add-balance")} testID="btn-home-add" />
                <Btn label="Receive" kind="sec" icon="qr" sm style={DESK_SM} onPress={() => router.push("/my-code")} testID="btn-home-receive" />
              </>
            )}
          </Row>
        </Row>
      </Card>

      {plans.isLoading ? (
        <>
          <DeskSection title="Plans" />
          <Grid cols={2}>
            <Skel w="100%" h={150} r={14} />
            <Skel w="100%" h={150} r={14} />
          </Grid>
        </>
      ) : plans.isError ? (
        <View style={{ marginTop: 20 }}>
          <Banner kind="mut" icon="wifioff" title="Couldn't load your plans" text="Check your connection.">
            <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void plans.refetch()} style={{ marginTop: 8 }} testID="btn-home-retry" />
          </Banner>
        </View>
      ) : empty ? (
        <>
          <View style={{ height: 120, marginTop: 16, overflow: "hidden", borderRadius: 14 }}>
            <Band color={WRISTBANDS.lagoon} text="YOUR FIRST PLAN · YOUR FIRST PLAN · YOUR FIRST PLAN" style={{ position: "absolute", width: 1100, top: 22, left: -60, transform: [{ rotate: "-3deg" }] }} />
            <Band color={WRISTBANDS.marigold} text="FRIENDS · ANY COUNTRY · ONE POT · FRIENDS · ANY COUNTRY" style={{ position: "absolute", width: 1100, top: 64, left: -160, transform: [{ rotate: "2deg" }] }} />
          </View>
          <Txt v="d28" center style={{ marginTop: 16 }}>
            No plans yet
          </Txt>
          <Txt v="t15" color="muted" center style={{ marginTop: 6, marginBottom: 20 }}>
            Start a pot for a trip, a festival or a dinner. Friends join with one click, from any country.
          </Txt>
          <Grid cols={2}>
            <BigChoice kind="a" icon="plus" title="New plan" text="Name it, pick the rules, invite friends" onPress={() => router.push("/plan/new")} testID="card-new-plan" />
            <BigChoice icon="link" title="Join with a link or code" text="Open a link a friend sent you" onPress={() => router.push("/join-link")} testID="card-join" />
          </Grid>
          {!hideDemo ? (
            <View style={{ marginTop: 16 }}>
              <DeskTryCard onDismiss={dismissDemo} />
            </View>
          ) : null}
        </>
      ) : (
        <>
          <DeskSection title="Plans" right={`${list.length} ${list.length === 1 ? "plan" : "plans"} · ${activeCount} active`} />
          <Grid cols={cols}>{cards}</Grid>
        </>
      )}

      {recent.length ? (
        <>
          <DeskSection title="Recent money" right="See all" onRight={() => router.push("/balance")} testID="btn-recent-see-all" />
          <Card p={0} style={{ paddingHorizontal: 16, paddingVertical: 2 }} testID="recent-money">
            <Row gap={20}>
              {recent.map((r) => (
                <View key={r.id} style={{ flex: 1, minWidth: 0 }}>
                  <RecentMoney r={r} me={me} plans={planIndex} />
                </View>
              ))}
              {Array.from({ length: 3 - recent.length }, (_, k) => (
                <View key={`pad${k}`} style={{ flex: 1 }} />
              ))}
            </Row>
          </Card>
        </>
      ) : null}
      <View style={{ height: 24 }} />
    </Screen>
  );
}
