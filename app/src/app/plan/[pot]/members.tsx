/** 17 Members & rules: who is in, what each put in, positions in their own money, the rules in plain words. */
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { View } from "react-native";
import { fetchAccountKeys } from "../../../lib/api/envio";
import { addr6, dayMonth } from "../../../lib/core/format";
import { fromHex } from "../../../lib/crypto/bytes";
import { keyFingerprint } from "../../../lib/crypto/fingerprint";
import { countryByCode, formatUsd } from "../../../lib/domain/currency";
import { rulesInWords } from "../../../lib/domain/rules";
import { personFor, usePlan, type Person } from "../../../lib/state/data";
import { useColors } from "../../../theme/ThemeProvider";
import { currentRules, presetName, useTheirMoney } from "../../../ui/core/PlanCore";
import { Icon, type IconName } from "../../../ui/Icon";
import { Banner, Btn, Btns, Card, Chip, IconBtn, ListItem, Overline, Row, Skel } from "../../../ui/kit";
import { AppBar, Screen } from "../../../ui/layout";
import { PersonAvatar, PersonName, useMoney } from "../../../ui/plan/common";
import { Txt } from "../../../ui/Text";

function ruleIcon(line: string): IconName {
  if (/straight away|Every spend needs/.test(line)) return "zap";
  if (/OK/.test(line)) return "users";
  if (/a day|in total/.test(line)) return "cal";
  if (/^Budgets/.test(line)) return "receipt";
  if (/be paid|by link/.test(line)) return "link";
  if (/question/.test(line)) return "scale";
  if (/shared out/.test(line)) return "check";
  if (/Rule changes/.test(line)) return "vote";
  if (/Spending opens/.test(line)) return "lock";
  return "info";
}

export default function Members() {
  const { pot: potParam } = useLocalSearchParams<{ pot: string }>();
  const pot = (potParam ?? "").toLowerCase();
  const c = useColors();
  const plan = usePlan(pot);
  const money = useMoney();
  const p = plan.data;
  const people: Person[] = p ? p.raw.members.map((m) => p.people[m.address.toLowerCase()] ?? personFor(m.address, { me: p.me })) : [];
  const their = useTheirMoney(people);
  const keys = useQuery({
    queryKey: ["accountKeys", pot, p?.raw.members.length ?? 0],
    enabled: !!p,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const rows = await fetchAccountKeys(p!.raw.members.map((m) => m.address));
      const out: Record<string, string> = {};
      for (const r of rows) {
        if (!r.key) continue;
        try {
          out[r.id.toLowerCase()] = keyFingerprint(fromHex(r.key));
        } catch {
          /* not a 32-byte key */
        }
      }
      return out;
    },
  });

  if (!p) {
    return (
      <Screen testID="screen-members">
        <AppBar title="Members & rules" />
        {plan.isError || p === null ? (
          <Banner kind="mut" icon="wifioff" title="Couldn't load the members" text="Check your connection.">
            <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void plan.refetch()} style={{ marginTop: 8, height: 40 }} testID="btn-try-again" />
          </Banner>
        ) : (
          <View style={{ gap: 16 }}>
            <Skel w="40%" h={12} />
            {[0, 1, 2, 3].map((i) => (
              <Row key={i}>
                <Skel w={40} h={40} r={999} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skel w="50%" h={14} />
                  <Skel w="70%" h={10} />
                </View>
              </Row>
            ))}
          </View>
        )}
      </Screen>
    );
  }

  const raw = p.raw;
  const rules = currentRules(raw);
  const words = rulesInWords(rules, { reviewWindowSec: raw.reviewWindow !== undefined ? Number(raw.reviewWindow) : undefined });
  const applied = raw.ruleChanges.find((r) => r.status === "Applied");
  const agreed = applied?.eta ? Number(applied.eta) : (raw.createdAt ?? Number(raw.startTime));
  const pending = raw.ruleChanges.find((r) => (r.status === "Proposed" && Number(r.expiresAt) > p.now) || r.status === "Approved");
  const active = raw.members.filter((m) => m.status === "Active");
  const countries = raw.countries.filter(Boolean).length;
  const canAct = p.isMember && !p.settled;
  const safety = p.myMember ? BigInt(p.myMember.safetyNet) : 0n;
  const sorted = [...raw.members].sort((a, b) => (a.status === b.status ? 0 : a.status === "Active" ? -1 : 1));

  return (
    <Screen
      testID="screen-members"
      refreshing={plan.isRefetching}
      onRefresh={() => void plan.refetch()}
      dock={
        canAct ? (
          <Btns>
            <Btn label={p.frozen ? "Paused" : "Pause spending"} kind={p.frozen ? "off" : "dngo"} icon="pause" onPress={() => router.push({ pathname: "/plan/[pot]/pause", params: { pot } })} testID="btn-pause-spending" />
            <Btn label="Propose a change" kind="sec" icon="edit" onPress={() => router.push({ pathname: "/plan/customise", params: { pot } })} testID="btn-propose-a-change" />
          </Btns>
        ) : undefined
      }
    >
      <AppBar
        title="Members & rules"
        sub={`${p.meta.emoji} ${p.meta.name}`}
        right={canAct && !p.ended ? <IconBtn name="plus" label="Invite friends" onPress={() => router.push({ pathname: "/plan/[pot]/invite", params: { pot } })} testID="btn-members-invite" /> : undefined}
      />
      <Overline>
        {active.length} {active.length === 1 ? "person" : "people"}
        {countries > 1 ? ` · ${countries} countries` : ""}
      </Overline>
      {sorted.map((m, i) => {
        const person = p.people[m.address.toLowerCase()] ?? personFor(m.address, { me: p.me });
        const net = BigInt(m.net);
        const left = m.status === "Exited";
        const where = person.city ?? countryByCode(person.country)?.name;
        const viewerExtra = !person.me && person.currency !== money.currency && net !== 0n ? money.local(net < 0n ? -net : net) : undefined;
        const fp = keys.data?.[m.address.toLowerCase()];
        return (
          <ListItem
            key={m.address}
            testID={`member-row-${addr6(m.address)}`}
            last={i === sorted.length - 1}
            dim={left}
            left={<PersonAvatar p={person} size={40} />}
            title={
              <Row gap={6}>
                <PersonName p={person} />
                {left ? <Chip sm label="Left" /> : null}
              </Row>
            }
            sub={
              <View>
                <Txt v="t13" color="muted" numberOfLines={1}>
                  {where ? `${where} · ` : ""}put in {formatUsd(BigInt(m.contributed))}
                </Txt>
                {fp ? (
                  <Txt v="t11" color="muted" accessibilityLabel={`Key ${fp}`}>
                    Key {fp}
                  </Txt>
                ) : null}
              </View>
            }
            right={
              <Txt v="lt" color={net > 0n ? "pos" : net < 0n ? "neg" : "ink"} tnum>
                {net === 0n ? their(person, 0n) : their(person, net, { sign: true })}
              </Txt>
            }
            rsub={net > 0n ? (person.me ? "owed to you" : `is owed${viewerExtra ? ` · ${viewerExtra}` : ""}`) : net < 0n ? `owes${viewerExtra ? ` · ${viewerExtra}` : ""}` : "all square"}
          />
        );
      })}

      {pending ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="inf" icon="vote" title={pending.status === "Approved" ? "A rule change was agreed" : "A rule change is being voted on"} testID="banner-pending-rule-change">
            <Btn label="See the change" kind="sec" sm onPress={() => router.push({ pathname: "/plan/[pot]/rules-change", params: { pot, id: pending.ruleChangeId } })} style={{ marginTop: 8, height: 40 }} testID="btn-see-rule-change" />
          </Banner>
        </View>
      ) : null}

      <Row between style={{ marginTop: 20 }}>
        <Overline>Rules · {presetName(rules)}</Overline>
        <Txt v="t13" color="muted">
          Agreed {dayMonth(agreed)}
        </Txt>
      </Row>
      <Card style={{ marginTop: 8, gap: 12 }} testID="rules-card">
        {words.map((w, i) => (
          <Row key={i} align="flex-start" gap={12}>
            <Icon name={ruleIcon(w)} size={20} color={c.muted} />
            <Txt v="t15" style={{ flex: 1 }}>
              {w}
            </Txt>
          </Row>
        ))}
        {safety > 0n ? (
          <Row align="flex-start" gap={12}>
            <Icon name="shield" size={20} color={c.muted} />
            <Txt v="t15" style={{ flex: 1 }}>
              Your safety net: up to {money.both(safety)} if you owe at the end.
            </Txt>
          </Row>
        ) : null}
      </Card>
      <Txt v="t13" color="muted" style={{ marginTop: 12 }}>
        Anyone can propose a change or pause spending. No one has extra powers, including whoever started the plan.
      </Txt>
      <View style={{ height: 16 }} />
    </Screen>
  );
}
