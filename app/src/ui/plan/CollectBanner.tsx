/**
 * After settle-up: money the pot still owes someone because their payout couldn't be made at that
 * moment (Pot.collect). Shown on a settled plan only. Anyone can trigger it, and it can only ever pay
 * the person it belongs to, so the signed-in person can collect their own and send others theirs.
 */
import React from "react";
import { View } from "react-native";
import type { Address } from "viem";
import { collect } from "../../lib/chain/actions";
import { friendlyError } from "../../lib/api/relayer";
import { formatUsd } from "../../lib/domain/currency";
import { personFor, queryClient, type PlanVM } from "../../lib/state/data";
import { Banner, Btn } from "../kit";
import { useLocal } from "../money";
import { uncollected, type Uncollected } from "../../lib/domain/collect";
import { Txt } from "../Text";

export { uncollected };

export function CollectBanner({ plan }: { plan: PlanVM }) {
  const rows = uncollected(plan.raw.members, plan.me, plan.settled);
  const { fmt } = useLocal();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<Record<string, true>>({});
  const [error, setError] = React.useState<string | null>(null);
  const live = rows.filter((r) => !done[r.address]);
  if (!live.length) return null;

  const run = async (r: Uncollected) => {
    setBusy(r.address);
    setError(null);
    try {
      await collect(plan.pot as Address, r.mine ? undefined : (r.address as Address));
      setDone((d) => ({ ...d, [r.address]: true }));
      void queryClient.invalidateQueries();
    } catch (e) {
      setError(friendlyError(e).message);
    } finally {
      setBusy(null);
    }
  };

  const money = (n: bigint) => {
    const local = fmt(n);
    return local ? `${local} (${formatUsd(n)})` : formatUsd(n);
  };

  return (
    <View style={{ marginTop: 12, gap: 8 }} testID="collect-banner">
      {live.map((r) => {
        const who = plan.people[r.address] ?? personFor(r.address, { me: plan.me });
        return (
          <Banner
            key={r.address}
            kind={r.mine ? "acc" : "inf"}
            icon={r.mine ? "in" : "out"}
            title={r.mine ? `${money(r.net)} is still waiting for you` : `${who.name} is still owed ${formatUsd(r.net)}`}
            text={
              r.mine
                ? "Settle-up couldn't pay you this part at the time. Collect it now. It can only go to you."
                : `Settle-up couldn't pay ${who.name} this part at the time. Anyone can send it on. It can only go to ${who.name}.`
            }
            testID={r.mine ? "banner-collect-mine" : `banner-collect-${r.address.slice(2, 8)}`}
          >
            <Btn
              label={busy === r.address ? "Sending…" : r.mine ? "Collect it" : `Send it to ${who.name}`}
              kind={r.mine ? "pri" : "sec"}
              sm
              disabled={!!busy}
              onPress={() => void run(r)}
              style={{ marginTop: 8, height: 40 }}
              testID={r.mine ? "btn-collect" : `btn-collect-${r.address.slice(2, 8)}`}
            />
          </Banner>
        );
      })}
      {error ? (
        <Txt v="t13" color="neg" testID="collect-error">
          {error}
        </Txt>
      ) : null}
    </View>
  );
}
