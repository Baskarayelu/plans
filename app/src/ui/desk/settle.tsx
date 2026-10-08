/**
 * Laptop layouts of settle-up (designs 112, 113): who gets what in the main column with the arrows
 * that explain it, everyone's check and the one button in the panel; then the stub in the middle and
 * the share card in the panel.
 */
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { config } from "../../config";
import { formatUsd, formatUsdShort } from "../../lib/domain/currency";
import { CATEGORIES } from "../../lib/domain/rules";
import { ackStatus } from "../../lib/ending/planChecks";
import type { settleView } from "../../lib/ending/settleView";
import { settleCard } from "../../lib/share/settleCard";
import type { PlanVM } from "../../lib/state/data";
import { useColors } from "../../theme/ThemeProvider";
import { fonts, WRISTBANDS } from "../../theme/tokens";
import { EdgeArrow, personOf, type usePeopleMoney } from "../ending/common";
import { Icon } from "../Icon";
import { Banner, Bar, BigIcon, Btn, Card, Chip, Confetti, formatSeconds, ListItem, Row, Step } from "../kit";
import { PersonAvatar, PersonName } from "../plan/common";
import { SettleCardView } from "../share/SettleCardView";
import { SettleShareSheet } from "../share/SettleShareSheet";
import { Crumbs, Grid } from "../shell/desk";
import { SidePanel } from "../shell/panel";
import { Stub } from "../Stub";
import { Txt } from "../Text";
import { showToast } from "../Toast";
import { DeskSection } from "./plan";

type VM = ReturnType<typeof settleView>;
type Money = ReturnType<typeof usePeopleMoney>;

function spentTotal(plan: PlanVM): bigint {
  if (plan.raw.totalSpent) return BigInt(plan.raw.totalSpent);
  return plan.raw.spends.filter((s) => s.status === "Executed" && s.kind !== "PERSONAL").reduce((a, s) => a + BigInt(s.amount), 0n);
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Card tint p={12} style={{ flex: 1 }}>
      <Txt v="ov" color="muted">
        {label}
      </Txt>
      <Txt v="d17" style={{ marginTop: 4 }} numberOfLines={1}>
        {value}
      </Txt>
    </Card>
  );
}

/** "Where the $687.60 went": spending by category, biggest first (112). */
function WhereItWent({ plan }: { plan: PlanVM }) {
  const rows = CATEGORIES.map((cat) => {
    const r = plan.raw.categorySpends.find((x) => x.category === cat.id);
    const spent = BigInt(r?.spent ?? "0") - BigInt(r?.refunded ?? "0");
    return { cat, spent };
  })
    .filter((r) => r.spent > 0n)
    .sort((a, b) => (b.spent > a.spent ? 1 : b.spent < a.spent ? -1 : 0));
  const max = rows[0]?.spent ?? 1n;
  return (
    <Card testID="settle-where">
      <Txt v="ov" color="muted">
        Where the {formatUsd(spentTotal(plan))} went
      </Txt>
      {rows.length === 0 ? (
        <Txt v="t13" color="muted" style={{ marginTop: 12 }}>
          Nothing was spent from the pot.
        </Txt>
      ) : (
        rows.map((r) => (
          <View key={r.cat.id} style={{ marginTop: 12 }}>
            <Row between>
              <Txt v="t13" weight="bold">
                {r.cat.emoji} {r.cat.name}
              </Txt>
              <Txt v="t13" color="muted" tnum>
                {formatUsd(r.spent)}
              </Txt>
            </Row>
            <View style={{ marginTop: 4 }}>
              <Bar pct={Number((r.spent * 1000n) / (max > 0n ? max : 1n)) / 10} color={plan.meta.color} />
            </View>
          </View>
        ))
      )}
    </Card>
  );
}

export function leftoverLine(plan: PlanVM, vm: VM | null, money: Money): string | null {
  if (!vm || vm.leftover.length === 0) return null;
  const total = formatUsd(vm.leftoverTotal);
  if (vm.equalShare !== undefined) return `Then the ${total} left in the pot is shared ${vm.leftover.length} ways, ${formatUsd(vm.equalShare)} each.`;
  const nameOf = (a: string) => {
    const p = personOf(plan, a);
    return p?.me ? "you" : (p?.name ?? "Friend");
  };
  if (vm.leftover.length === 1) return `Then the ${total} left in the pot goes to ${nameOf(vm.leftover[0].to)}.`;
  const names = vm.leftover.map((l) => `${nameOf(l.to)} ${money.local(l.amount, personOf(plan, l.to))}`);
  return `Then the ${total} left in the pot goes to ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}.`;
}

/** 112 Settle-up preview on a laptop. `settling` replaces the panel with the 39 progress list. */
export function DeskSettlePreview({
  plan,
  vm,
  can,
  checking,
  busy,
  onSettle,
  failed,
  onRetry,
  rates,
  money,
  settling,
}: {
  plan: PlanVM;
  vm: VM | null;
  can: boolean;
  checking: boolean;
  busy: boolean;
  onSettle: () => void;
  failed: boolean;
  onRetry: () => void;
  rates: string | null;
  money: Money;
  settling?: React.ReactNode;
}) {
  const c = useColors();
  const rows = vm ? [...vm.rows].sort((a, b) => (a.address === plan.me ? -1 : b.address === plan.me ? 1 : 0)) : [];
  const leftover = leftoverLine(plan, vm, money);
  const acks = ackStatus(plan.raw);
  const okCount = acks.filter((a) => a.acked).length;
  const pulls = vm ? vm.rows.filter((r) => r.pulled > 0n) : [];
  const square = !!vm && vm.rows.every((r) => r.payout === 0n && r.pulled === 0n && r.debt === 0n);

  return (
    <>
      <Crumbs items={[{ label: "Plans", href: "/" }, { label: plan.meta.name, href: { pathname: "/plan/[pot]", params: { pot: plan.pot } } }, { label: "Settle up" }]} />
      <Txt v="d44" style={{ marginTop: 6 }}>
        Here's who gets what
      </Txt>
      <Txt v="t17" color="muted" style={{ marginTop: 8, marginBottom: 16 }}>
        Everyone is paid at once, in their own money.
      </Txt>
      {!can && !checking ? (
        <View style={{ marginBottom: 12 }}>
          <Banner kind="inf" icon="clock" title="Settle-up isn't open yet" text="It opens when everyone has said the numbers look right and nothing is still waiting for a vote, or when the review time is over." testID="settle-not-open" />
        </View>
      ) : null}
      {failed ? (
        <View style={{ marginBottom: 12 }}>
          <Banner kind="neg" icon="wifioff" title="Couldn't check everyone's safety net" text="The amounts below may change. Check your connection.">
            <Btn label="Try again" kind="sec" sm icon="refresh" onPress={onRetry} style={{ marginTop: 8, height: 40 }} testID="btn-try-again" />
          </Banner>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-start" }}>
        <View style={{ flex: 1.1, minWidth: 0 }}>
        <Card style={{ paddingVertical: 4 }} testID="settle-payouts">
          {!vm
            ? [0, 1, 2].map((i) => <ListItem key={i} title=" " left={<View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.skel }} />} last={i === 2} />)
            : rows.map((r, i) => {
                const p = personOf(plan, r.address);
                if (!p) return null;
                let right: React.ReactNode;
                let rsub: string | undefined;
                if (r.payout > 0n) {
                  right = <Txt v="d22">{money.local(r.payout, p)}</Txt>;
                  rsub = r.unpaid > 0n ? `${money.second(r.payout, p)} · ${formatUsd(r.unpaid)} still owed` : money.second(r.payout, p);
                } else if (r.pulled > 0n || r.debt > 0n) {
                  right = (
                    <Txt v="d22" color="neg">
                      {money.local(-(r.pulled + r.debt), p)}
                    </Txt>
                  );
                  rsub = r.debt > 0n ? (r.pulled > 0n ? `${formatUsd(r.pulled)} from safety net · ${formatUsd(r.debt)} owed` : `${formatUsd(r.debt)} carried as debt`) : "from safety net";
                } else {
                  right = (
                    <Txt v="t15" color="muted">
                      All square
                    </Txt>
                  );
                }
                return (
                  <ListItem
                    key={r.address}
                    last={i === rows.length - 1}
                    left={<PersonAvatar p={p} size={44} />}
                    title={<PersonName p={p} />}
                    sub={[p.city, p.flag].filter(Boolean).join(" ")}
                    right={right}
                    rsub={rsub}
                    testID={`payout-${r.address.slice(2, 8)}`}
                  />
                );
              })}
        </Card>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
        <Card testID="settle-edges">
          <Txt v="ov" color="muted" style={{ marginBottom: 6 }}>
            How we got there
          </Txt>
          {vm && vm.edges.length
            ? vm.edges.map((e, i) => {
                const from = personOf(plan, e.from);
                const to = personOf(plan, e.to);
                if (!from || !to) return null;
                const a = money.local(e.amount, from);
                const b = money.local(e.amount, to);
                const label = a === b ? a : `${a} · ${b}`;
                const note = e.covered === "full" ? "from safety net" : e.covered === "part" ? "part from safety net, rest owed" : "owed after settle-up";
                return <EdgeArrow key={`${e.from}-${e.to}`} from={from} to={to} label={label} note={note} testID={`edge-${i}`} />;
              })
            : null}
          {leftover ? (
            <Txt v="t13" color="muted" style={{ marginTop: 10 }} testID="settle-leftover">
              {leftover}
            </Txt>
          ) : square ? (
            <Txt v="t15" color="muted">
              Everyone is square. Settling up closes the plan.
            </Txt>
          ) : null}
        </Card>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-start", marginTop: 16 }}>
        <View style={{ flex: 1.1, minWidth: 0 }}>
          <WhereItWent plan={plan} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
        <Card>
          <Txt v="ov" color="muted">
            When you press Settle up
          </Txt>
          <View style={{ gap: 10, marginTop: 12 }}>
            <Step n={1}>Everyone is paid at once, in their own money.</Step>
            <Step n={2}>The plan becomes read-only. Nobody can spend from it again.</Step>
            <Step n={3}>Everyone gets the same receipt, with Proof.</Step>
          </View>
        </Card>
        </View>
      </View>
      {vm?.shortfall ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="acc" icon="info" title="The pot can't cover everyone in full" text="Each person owed gets the same share of what they're owed now. The rest stays owed to them and is paid as soon as it comes in." />
        </View>
      ) : null}
      {vm?.anyDebt ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="mut" icon="info" title="Some of it is carried as a debt" text="When someone owes more than their safety net covers, the rest stays owed. They can pay it later from the plan." />
        </View>
      ) : null}
      {rates ? (
        <Txt v="mono11" color="muted" style={{ marginTop: 12 }} testID="settle-rates">
          {rates} · locked when you press
        </Txt>
      ) : null}
      <View style={{ height: 24 }} />

      <SidePanel kind="form">
        {settling ?? (
          <View style={{ flex: 1 }} testID="settle-panel">
            <Txt v="d22">Ready to settle</Txt>
            <Row gap={8} style={{ marginTop: 12 }}>
              <MiniStat label="Spent" value={formatUsd(spentTotal(plan))} />
              <MiniStat label="Left" value={formatUsd(BigInt(plan.raw.balance))} />
              <MiniStat label="Spends" value={String(plan.raw.spendCount ?? plan.raw.spends.filter((s) => s.status === "Executed").length)} />
            </Row>
            <Txt v="ov" color="muted" style={{ marginTop: 20 }}>
              {`Everyone checked · ${okCount} of ${acks.length}`}
            </Txt>
            {acks.map((a, i) => {
              const p = personOf(plan, a.address);
              if (!p) return null;
              return (
                <ListItem
                  key={a.address}
                  testID={`ack-${a.address.slice(2, 8)}`}
                  left={<PersonAvatar p={p} size={32} />}
                  title={p.me ? `${p.name} (you)` : p.name}
                  right={
                    a.acked ? (
                      <Row gap={4}>
                        <Icon name="check" size={16} strokeWidth={2.4} color={c.pos} />
                        <Txt v="t15" color="pos" weight="semi">
                          Looks right
                        </Txt>
                      </Row>
                    ) : (
                      <Txt v="t15" color="muted">
                        Not yet
                      </Txt>
                    )
                  }
                  last={i === acks.length - 1}
                />
              );
            })}
            <View style={{ marginTop: 12 }}>
              {pulls.length ? (
                <Banner kind="acc" icon="shield" title={`${pulls.length === 1 ? "One safety net is" : `${pulls.length} safety nets are`} used`} text={pulls.map((r) => `${personOf(plan, r.address)?.name ?? "Friend"} ${formatUsd(r.pulled)}`).join(" · ")} />
              ) : vm ? (
                <Banner kind="inf" icon="shield" title="Nobody needs their safety net" text="The pot covers every payout." />
              ) : null}
            </View>
            <View style={{ flex: 1, minHeight: 24 }} />
            {!can && !checking ? (
              <Btn label="Check the numbers first" kind="sec" onPress={() => router.push({ pathname: "/plan/[pot]/review", params: { pot: plan.pot } })} style={{ marginBottom: 8 }} testID="btn-check-the-numbers" />
            ) : null}
            <Btn label="Settle up · one tap" icon="key" disabled={!can || !vm} loading={busy || checking} onPress={onSettle} testID="btn-settle-up" />
            <Txt v="t13" color="muted" center style={{ marginTop: 8 }}>
              Anyone in the plan can press it. It only runs once.
            </Txt>
          </View>
        )}
      </SidePanel>
    </>
  );
}

const CONFETTI_WIDE: [number, number, string, number][] = [
  [60, 40, WRISTBANDS.lagoon, 20],
  [160, 120, WRISTBANDS.marigold, -30],
  [640, 50, WRISTBANDS.orchid, 45],
  [690, 140, WRISTBANDS.lime, -15],
  [420, 24, WRISTBANDS.coral, 30],
  [90, 300, WRISTBANDS.iris, 60],
  [680, 330, WRISTBANDS.marigold, 10],
];

/** 113 Settled on a laptop: the stub in the middle, the share card in the panel. */
export function DeskSettled({
  plan,
  head,
  lines,
  paidOut,
  ms,
  txHash,
  myLine,
  oweBanner,
  foot,
  afterStub,
  rateLine,
}: {
  plan: PlanVM;
  head: React.ReactNode;
  lines: [string, React.ReactNode][];
  paidOut: bigint;
  ms?: number;
  txHash?: string;
  myLine?: string | null;
  oweBanner?: React.ReactNode;
  foot: React.ReactNode;
  /** under the receipt (the "Check this rate" link) */
  afterStub?: React.ReactNode;
  /** the share card's rate line */
  rateLine?: string;
}) {
  const c = useColors();
  const [sharing, setSharing] = useState(false);
  const raw = plan.raw;
  const card = useMemo(() => {
    const totalIn = raw.totalContributed !== undefined && raw.totalContributed !== null ? BigInt(raw.totalContributed) : raw.members.reduce((a, m) => a + BigInt(m.contributed ?? "0"), 0n);
    const settledAt = Number(raw.settledAt ?? raw.settlements[0]?.timestamp ?? 0) || undefined;
    return settleCard({
      pot: plan.pot,
      members: raw.members.map((m) => ({ country: m.country })),
      totalIn,
      paidOut,
      settleMs: ms,
      spendCount: raw.spendCount !== undefined && raw.spendCount !== null ? Number(raw.spendCount) : undefined,
      settledAt,
      planName: plan.meta.name,
      showName: false,
      host: config.linkHost,
      rateLine,
    });
  }, [raw, plan.pot, plan.meta.name, paidOut, ms, rateLine]);
  const executed = raw.spends.filter((s) => s.status === "Executed" && s.kind !== "PERSONAL");
  const biggest = executed.reduce<(typeof executed)[number] | undefined>((m, s) => (!m || BigInt(s.amount) > BigInt(m.amount) ? s : m), undefined);
  const biggestCat = biggest ? CATEGORIES.find((x) => x.id === biggest.category) : undefined;
  const stats: [string, string][] = [
    [formatUsd(spentTotal(plan)), "spent together"],
    [String(raw.spendCount ?? executed.length), (raw.spendCount ?? executed.length) === 1 ? "spend" : "spends"],
    ...(biggest ? ([[formatUsdShort(BigInt(biggest.amount)), `biggest: ${biggestCat?.name.toLowerCase() ?? "spend"}`]] as [string, string][]) : []),
    [String(card.countries), card.countries === 1 ? "country" : "countries"],
  ];
  const copy = async () => {
    await Clipboard.setStringAsync(card.url);
    showToast({ title: "Link copied" });
  };
  return (
    <>
      <Confetti pieces={CONFETTI_WIDE} />
      <View style={{ alignItems: "center", marginTop: 8 }}>
        <BigIcon icon="check" kind="p" size={72} />
        <Txt v="d44" center style={{ marginTop: 12 }} testID="settled-title">
          All settled
        </Txt>
        {ms !== undefined ? (
          <View style={{ marginTop: 8 }}>
            <Chip sm tone="pos" icon="zap" label={`Settled in ${formatSeconds(ms)}`} />
          </View>
        ) : null}
        {myLine ? (
          <Txt v="t15" color="muted" center style={{ marginTop: 8 }}>
            {myLine}
          </Txt>
        ) : null}
      </View>
      <View style={{ width: 480, maxWidth: "100%", alignSelf: "center", marginTop: 20 }}>
        <Stub testID="settled-stub" head={head} lines={lines} foot={foot} />
        {afterStub}
      </View>
      <View style={{ width: 640, maxWidth: "100%", alignSelf: "center", marginTop: 20 }}>
        <Grid cols={stats.length} gap={12}>
          {stats.map(([v, l]) => (
            <Card key={l} p={14} style={{ flex: 1 }}>
              <Txt v="d22" numberOfLines={1}>
                {v}
              </Txt>
              <Txt v="t13" color="muted" numberOfLines={1}>
                {l}
              </Txt>
            </Card>
          ))}
        </Grid>
      </View>
      {oweBanner ? <View style={{ width: 640, maxWidth: "100%", alignSelf: "center", marginTop: 16 }}>{oweBanner}</View> : null}
      <View style={{ height: 24 }} />
      <SidePanel kind="form">
        <View style={{ flex: 1 }} testID="settled-panel">
          <Txt v="d22">Share how it went</Txt>
          <Txt v="t13" color="muted" style={{ marginTop: 4, marginBottom: 12 }}>
            A card and a public page with counts, countries and amounts. No names, no photos.
          </Txt>
          <Row align="flex-start" gap={14}>
            <View style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: c.line }} testID="share-card-mini">
              <SettleCardView card={card} shape="story" width={136} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt v="lt">Story · 4:5</Txt>
              <Txt v="t13" color="muted" style={{ marginTop: 4 }}>
                Also as a wide link preview. The link opens a public proof page.
              </Txt>
              <Txt style={{ fontFamily: fonts.mono, fontSize: 11, marginTop: 8, color: c.ink }} numberOfLines={1}>
                {card.displayUrl}
              </Txt>
            </View>
          </Row>
          <Row gap={8} style={{ marginTop: 16 }}>
            <Btn label="Copy link" kind="sec" icon="copy" sm flex onPress={() => void copy()} testID="btn-copy-share-link" />
            <Btn label="Share options" kind="sec" icon="share" sm flex onPress={() => setSharing(true)} testID="btn-share" />
          </Row>
          <View style={{ flex: 1, minHeight: 24 }} />
          <Btn label="Done" onPress={() => router.replace({ pathname: "/plan/[pot]/memory", params: { pot: plan.pot } })} testID="btn-done" />
        </View>
      </SidePanel>
      <SettleShareSheet visible={sharing} onClose={() => setSharing(false)} plan={plan} paidOut={paidOut} settleMs={ms} rateLine={rateLine} />
    </>
  );
}
