/** All spends in a plan, newest first, with All / Waiting / Paid filters. */
import { useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { usePlan } from "../../../lib/state/data";
import { isWaiting, SpendItem } from "../../../ui/core/SpendItem";
import { Banner, Btn, Card, Chip, Row, Skel } from "../../../ui/kit";
import { AppBar, Screen } from "../../../ui/layout";
import { Txt } from "../../../ui/Text";

type Filter = "all" | "waiting" | "paid";

export default function Spends() {
  const { pot: potParam, filter: f0 } = useLocalSearchParams<{ pot: string; filter?: Filter }>();
  const pot = (potParam ?? "").toLowerCase();
  const plan = usePlan(pot);
  const [filter, setFilter] = useState<Filter>(f0 === "waiting" || f0 === "paid" ? f0 : "all");
  const p = plan.data;
  const all = p?.raw.recent ?? [];
  const list = all.filter((s) => (filter === "all" ? true : filter === "waiting" ? isWaiting(s) : s.status === "Executed"));
  const waiting = all.filter(isWaiting).length;

  return (
    <Screen testID="screen-spends" refreshing={plan.isRefetching} onRefresh={() => void plan.refetch()}>
      <AppBar title="All spends" sub={p ? `${p.meta.emoji} ${p.meta.name}` : undefined} />
      <Row gap={8}>
        <Chip label="All" on={filter === "all"} onPress={() => setFilter("all")} testID="chip-filter-all" />
        <Chip label={waiting ? `Waiting · ${waiting}` : "Waiting"} on={filter === "waiting"} onPress={() => setFilter("waiting")} testID="chip-filter-waiting" />
        <Chip label="Paid" on={filter === "paid"} onPress={() => setFilter("paid")} testID="chip-filter-paid" />
      </Row>
      <View style={{ marginTop: 8 }}>
        {p ? (
          list.length ? (
            list.map((s, i) => <SpendItem key={s.id} plan={p} s={s} last={i === list.length - 1} />)
          ) : (
            <Card dashed style={{ marginTop: 8 }} testID="spends-empty">
              <Txt v="t15" color="muted">
                {filter === "waiting" ? "Nothing is waiting for an OK." : filter === "paid" ? "Nothing has been paid yet." : "No spends yet."}
              </Txt>
            </Card>
          )
        ) : plan.isError || p === null ? (
          <Banner kind="mut" icon="wifioff" title="Couldn't load the spends" text="Check your connection.">
            <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void plan.refetch()} style={{ marginTop: 8, height: 40 }} testID="btn-try-again" />
          </Banner>
        ) : (
          [0, 1, 2, 3, 4].map((i) => (
            <Row key={i} style={{ marginTop: 16 }}>
              <Skel w={36} h={36} r={999} />
              <View style={{ flex: 1 }}>
                <Skel w="80%" h={12} />
                <Skel w="50%" h={10} r={6} style={{ marginTop: 8 }} />
              </View>
            </Row>
          ))
        )}
      </View>
      {p && all.length >= 40 ? (
        <Txt v="t13" color="muted" center style={{ marginTop: 16 }}>
          Showing the latest 40 spends.
        </Txt>
      ) : null}
    </Screen>
  );
}
