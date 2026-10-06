/**
 * 57 Demo plan running. The relayer's demo friends act on their own; a step bar follows the run
 * (GET /v1/demo/try-settle-up/:pot), the feed is the plan's real activity, and "End plan & settle
 * up" says it looks right, waits for everyone to agree, then opens the one-tap settle-up.
 */
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { Address } from "viem";
import { getTrySettleUp, RelayError, type DemoRunStatus } from "../../lib/api/relayer";
import { ack } from "../../lib/chain/actions";
import { canSettle } from "../../lib/chain/rpc";
import { formatUsd } from "../../lib/domain/currency";
import { clock, demoProgress } from "../../lib/ending/demo";
import { hasAcked } from "../../lib/ending/planChecks";
import { queryClient, qk, usePlan, type Person, type PlanVM } from "../../lib/state/data";
import { useAction } from "../../lib/state/useAction";
import { useColors } from "../../theme/ThemeProvider";
import { personOf, PlanProblem, PlanSkeleton, spendLabel, useNow } from "../../ui/ending/common";
import { Banner, Bar, Btn, Card, Chip, DemoTag, Hero, ListItem, Overline, Row, SectionHead, Tile } from "../../ui/kit";
import { Screen } from "../../ui/layout";
import { ago } from "../../ui/planBits";
import { PersonAvatar, PlanTop, useMoney } from "../../ui/plan/common";
import { Txt } from "../../ui/Text";

const FINAL = new Set(["done", "failed", "abandoned"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Name({ p, rest, color }: { p?: Person; rest: string; color?: string }) {
  return (
    <Row gap={0} wrap>
      <Txt v="lt" color={color}>
        {p ? (p.me ? "You" : p.name) : "Someone"}
      </Txt>
      {p?.demo ? <DemoTag /> : null}
      <Txt v="lt" color={color}>
        {rest}
      </Txt>
    </Row>
  );
}

type FeedItem = { key: string; at: number; node: React.ReactNode };

function feedOf(plan: PlanVM | undefined): FeedItem[] {
  if (!plan) return [];
  const items: FeedItem[] = [];
  for (const s of plan.raw.recent) {
    const who = personOf(plan, s.proposer_id);
    const amt = formatUsd(BigInt(s.amount));
    const label = spendLabel(plan, s);
    const split = s.splitMembers?.length ? ` · split ${s.splitMembers.length}` : "";
    const at = s.executedAt ?? s.proposedAt ?? 0;
    const approver = (s.votes ?? []).map((v) => (v.approve ? personOf(plan, v.account_id) : undefined)).find((p) => p && p.address !== who?.address);
    if (s.status === "Executed") {
      items.push({
        key: `s${s.id}`,
        at,
        node: (
          <ListItem
            left={who ? <PersonAvatar p={who} size={36} /> : undefined}
            title={<Name p={who} rest={` paid ${amt} · ${label}`} />}
            sub={
              approver ? (
                <Row gap={0} wrap>
                  <Txt v="t13" color="pos" weight="bold">
                    {approver.me ? "You" : approver.name}
                  </Txt>
                  {approver.demo ? <DemoTag /> : null}
                  <Txt v="t13" color="pos" weight="bold">
                    {" said OK · paid"}
                  </Txt>
                </Row>
              ) : (
                `${s.kind === "PERSONAL" ? "Paid themselves" : "From the pot"}${split}`
              )
            }
            rsub={ago(at)}
            right={approver ? <Chip sm tone="pos" label="Approved" /> : undefined}
            testID={`feed-spend-${s.spendId}`}
          />
        ),
      });
    } else if (s.status === "Pending" || s.status === "Approved") {
      const left = Math.max(0, s.approvalsRequired - s.approvals);
      items.push({
        key: `s${s.id}`,
        at,
        node: (
          <ListItem
            highlight
            left={who ? <PersonAvatar p={who} size={36} /> : undefined}
            title={<Name p={who} rest={` ${who?.me ? "want" : "wants"} ${amt} · ${label}`} />}
            sub={<Txt v="t13" color="info" weight="bold">{left > 0 ? `Needs ${left} more OK` : "Approved · paying"}</Txt>}
            right={<Chip sm tone="inf" label="Waiting" />}
            testID={`feed-spend-${s.spendId}`}
          />
        ),
      });
    } else if (s.status === "Cancelled") {
      items.push({ key: `s${s.id}`, at, node: <ListItem dim left={who ? <PersonAvatar p={who} size={36} /> : undefined} title={<Name p={who} rest={` asked for ${amt} · didn't go ahead`} />} rsub={ago(at)} testID={`feed-spend-${s.spendId}`} /> });
    }
  }
  for (const m of plan.raw.members) {
    if (!m.joinedAt) continue;
    const p = personOf(plan, m.address);
    const put = BigInt(m.contributed);
    items.push({
      key: `j${m.address}`,
      at: m.joinedAt,
      node: (
        <ListItem
          left={p?.me ? <Tile icon="in" kind="p" size={36} /> : p ? <PersonAvatar p={p} size={36} /> : undefined}
          title={<Name p={p} rest=" joined" />}
          sub={put > 0n ? `Put in ${formatUsd(put)}` : "Nothing put in yet"}
          rsub={ago(m.joinedAt)}
          testID={`feed-join-${m.address.slice(2, 8)}`}
        />
      ),
    });
  }
  return items.sort((a, b) => b.at - a.at).slice(0, 12);
}

export default function DemoRunning() {
  const { pot } = useLocalSearchParams<{ pot: string }>();
  const q = usePlan(pot);
  const c = useColors();
  const money = useMoney();
  const plan = q.data ?? undefined;
  const settled = !!plan?.settled;
  const run = useQuery({
    queryKey: ["demoRun", (pot ?? "").toLowerCase()],
    queryFn: () => getTrySettleUp(pot!),
    enabled: !!pot,
    refetchInterval: (query) => {
      const d = query.state.data as DemoRunStatus | null | undefined;
      return d && FINAL.has(d.stage) ? false : 2_000;
    },
  });
  const nowMs = useNow(1000);
  const feed = feedOf(plan);
  const [phase, setPhase] = useState<"idle" | "waiting-friends" | "acking" | "waiting-acks" | "slow">("idle");
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  // A brand-new demo plan can take a moment to show up.
  const missing = q.data === null;
  useEffect(() => {
    if (!missing) return;
    const t = setInterval(() => void q.refetch(), 2_000);
    return () => clearInterval(t);
  }, [missing, q]);

  // The demo moves fast: refresh the plan every few seconds until it's settled.
  useEffect(() => {
    if (!pot || settled) return;
    const t = setInterval(() => void queryClient.invalidateQueries({ queryKey: qk.plan(pot) }), 2_500);
    return () => clearInterval(t);
  }, [pot, settled]);

  const end = useAction(async () => {
    const potA = pot as Address;
    // 1. let the demo friends finish their script (acks reset on every spend)
    setPhase("waiting-friends");
    for (let i = 0; i < 120 && alive.current; i++) {
      const s = (await run.refetch()).data;
      if (!s || s.stage === "ready" || s.stage === "done") break;
      if (s.stage === "failed" || s.stage === "abandoned") throw new Error("The demo friends got stuck. Start a new demo to try again.");
      await sleep(1_500);
    }
    // 2. say it looks right (once per epoch)
    const fresh = (await q.refetch()).data;
    if (fresh?.settled) return "settled" as const;
    if (!fresh || !hasAcked(fresh.raw, fresh.me)) {
      setPhase("acking");
      try {
        await ack(potA);
      } catch (e) {
        if (!(e instanceof RelayError && e.code === "ALREADY_ACKED")) throw e;
      }
    }
    // 3. demo friends agree within seconds after a person does
    setPhase("waiting-acks");
    const started = Date.now();
    while (alive.current) {
      if (await canSettle(potA).catch(() => false)) return "ready" as const;
      const p = (await q.refetch()).data;
      if (p?.settled) return "settled" as const;
      if (Date.now() - started > 15_000) setPhase("slow");
      if (Date.now() - started > 120_000) return "timeout" as const;
      await sleep(1_500);
    }
    return undefined;
  });

  const endAndSettle = async () => {
    const r = await end.run();
    setPhase("idle");
    if (r === "ready") queryClient.setQueryData(["canSettle", (pot ?? "").toLowerCase()], true);
    if (r === "ready" || r === "settled") router.push({ pathname: "/plan/[pot]/settle", params: { pot: pot! } });
    else if (r === "timeout") router.push({ pathname: "/plan/[pot]/review", params: { pot: pot! } });
  };

  if (q.isLoading) return <PlanSkeleton title="Demo" />;
  if (missing) return <PlanSkeleton title="Setting up your demo…" />;
  if (q.isError || !plan) return <PlanProblem title="Demo" missing={!q.isError} onRetry={() => void q.refetch()} />;

  const prog = demoProgress(run.data, settled);
  const n = plan.raw.activeMemberCount;
  const start = Number(plan.raw.startTime || plan.raw.createdAt || 0);
  const elapsed = start ? nowMs / 1000 - start : 0;
  const balance = BigInt(plan.raw.balance);
  const band = `Demo · step ${prog.step} of 3 · ${n} ${n === 1 ? "person" : "people"}`;
  const stuck = prog.state === "failed" || prog.state === "abandoned";
  const goSettle = () => router.push({ pathname: "/plan/[pot]/settle", params: { pot: plan.pot } });

  const waitingText =
    phase === "waiting-friends"
      ? "Waiting for the demo friends to finish…"
      : phase === "acking"
        ? "Saying it looks right…"
        : phase === "waiting-acks"
          ? "Waiting for everyone to agree…"
          : phase === "slow"
            ? "Taking longer than usual. The demo friends usually agree within seconds."
            : null;

  let dock: React.ReactNode;
  if (settled || prog.state === "done") dock = <Btn label="See the settle-up" icon="check" onPress={goSettle} testID="btn-see-the-settle-up" />;
  else if (stuck) dock = <Btn label="Start a new demo" icon="play" onPress={() => router.replace("/demo")} testID="btn-start-a-new-demo" />;
  else if (!plan.isMember) dock = <Btn label="Adding you to the plan…" kind="off" disabled loading testID="btn-end-plan-and-settle-up" />;
  else
    dock = (
      <>
        {waitingText ? (
          <Txt v="t13" color="muted" center testID="demo-waiting">
            {waitingText}
          </Txt>
        ) : null}
        <Btn label="End plan & settle up" icon="check" loading={end.busy} onPress={() => void endAndSettle()} testID="btn-end-plan-and-settle-up" />
      </>
    );

  const next =
    settled || prog.state === "done"
      ? { t: "Settled", s: "Everyone was paid at once, in their own money." }
      : prog.step === 3
        ? { t: "Next: end the plan", s: "Everyone is paid at once, in their own money." }
        : prog.step === 2
          ? { t: "Next: you end the plan", s: "Once they've checked, you settle up in one tap." }
          : { t: "Next: they check the numbers", s: "Then you end the plan and settle up in one tap." };

  return (
    <Screen dock={dock} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} testID="screen-demo-running">
      <PlanTop plan={plan} band={band} right={<View />} />

      <Card style={{ marginTop: 12 }} testID="demo-step">
        <Row between>
          <Txt v="t13" weight="bold" style={{ flex: 1 }} numberOfLines={2}>
            {`Step ${prog.step} of 3 · ${prog.label}`}
          </Txt>
          <Txt v="t13" color="muted" tnum testID="demo-elapsed">
            {clock(elapsed)}
          </Txt>
        </Row>
        <View style={{ marginTop: 8 }}>
          <Bar pct={prog.pct} color={c.accent} />
        </View>
      </Card>

      {stuck ? (
        <View style={{ marginTop: 12 }}>
          <Banner
            kind="neg"
            icon="alert"
            title={prog.state === "failed" ? "The demo friends got stuck" : "This demo ran out of time"}
            text="Nothing is lost: whatever is in the pot is shared out when the plan settles. You can start a new demo."
            testID="demo-stuck"
          />
        </View>
      ) : null}
      {run.isError ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="mut" icon="wifioff" title="Can't see the demo friends' progress" text="The plan below is still live." />
        </View>
      ) : null}
      {end.error ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title={end.error.title} text={end.error.message} testID="demo-error" />
        </View>
      ) : null}

      <Card style={{ marginTop: 12 }} testID="demo-pot">
        <Overline>In the pot</Overline>
        <View style={{ marginTop: 4 }}>
          <Hero big={formatUsd(balance)} small={money.local(balance)} testID="demo-pot-amount" />
        </View>
      </Card>

      <SectionHead title="Live" live />
      <View testID="demo-feed">
        {feed.length === 0 ? (
          <Txt v="t15" color="muted" style={{ paddingVertical: 12 }}>
            The demo friends are on their way…
          </Txt>
        ) : (
          feed.map((f) => <React.Fragment key={f.key}>{f.node}</React.Fragment>)
        )}
      </View>

      {!settled && !stuck && plan.isMember ? (
        <Card tint style={{ marginTop: 12 }} testID="demo-try-spend">
          <Txt v="lt">Want to see an approval?</Txt>
          <Txt v="t13" color="muted">
            Spends over $0.25 need one OK. Try one and a demo friend approves it within seconds.
          </Txt>
          <View style={{ marginTop: 10 }}>
            <Btn label="Try a $0.40 spend" kind="sec" sm icon="out" onPress={() => router.push({ pathname: "/plan/[pot]/pay", params: { pot: plan.pot, amount: "400000" } })} testID="btn-try-a-spend" />
          </View>
        </Card>
      ) : null}

      <Card tint style={{ marginTop: 12 }} testID="demo-next">
        <Txt v="lt">{next.t}</Txt>
        <Txt v="t13" color="muted">
          {next.s}
        </Txt>
      </Card>
    </Screen>
  );
}
