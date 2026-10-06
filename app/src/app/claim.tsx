import { useQuery } from "@tanstack/react-query";
import { getLocales } from "expo-localization";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { settledMs, type RelayResult } from "../lib/api/relayer";
import { fromBase64Url } from "../lib/crypto/bytes";
import { countryByCode, CURRENCIES, formatLocal, formatUsdShort } from "../lib/domain/currency";
import { claimLink, lookupClaim } from "../lib/domain/planOps";
import { handlePasskeyFailure } from "../lib/identity/flows";
import { createOrRestore, identity, restoreWithPasskey, unlockStored } from "../lib/identity/session";
import { dayText, daysLeft } from "../lib/send/convert";
import { personFor, queryClient, qk, useFx, useMe } from "../lib/state/data";
import { useStore } from "../lib/state/observable";
import { useAction } from "../lib/state/useAction";
import { Avatar, Banner, BigIcon, Btn, Logo, Proof, Row, SettledIn, Skel, Step } from "../ui/kit";
import { Screen } from "../ui/layout";
import { Stub } from "../ui/Stub";
import { Txt } from "../ui/Text";

function viewerCurrency(profileCurrency?: string): string {
  if (profileCurrency) return profileCurrency;
  try {
    const c = getLocales()[0]?.currencyCode;
    if (c && CURRENCIES[c]) return c;
  } catch {
    /* default below */
  }
  return "USD";
}

/** 51 Claim a link: who sent it, how much in my money, and one button. */
export default function Claim() {
  const p = useLocalSearchParams<{ k?: string; n?: string; m?: string; a?: string; go?: string }>();
  const st = useStore(identity, (s) => s);
  const { address } = useMe();
  const key = useMemo(() => {
    try {
      const k = p.k ? fromBase64Url(p.k) : null;
      return k && k.length === 32 ? k : null;
    } catch {
      return null;
    }
  }, [p.k]);
  const cur = viewerCurrency(st.profile?.currency);
  const fx = useFx(cur);
  const [busy, setBusy] = useState<"create" | "restore" | "unlock" | null>(null);
  const [msg, setMsg] = useState<string | undefined>();
  const [done, setDone] = useState<RelayResult | null>(null);
  const auto = useRef(false);

  const claim = useQuery({
    queryKey: ["claimLink", p.k],
    enabled: !!key,
    queryFn: () => lookupClaim(key!),
    refetchInterval: (q) => (q.state.data ? false : 3000),
    retry: 2,
  });
  const run = useAction(claimLink, { context: "You were claiming a money link." });

  const c = claim.data;
  const sender = p.n || (c?.sourceAccount_id ? personFor(c.sourceAccount_id).name : undefined) || "Someone";
  const senderP = c?.source ? personFor(c.source) : undefined;
  const amountUnits = c ? BigInt(c.amount) : p.a && /^\d+$/.test(p.a) ? BigInt(p.a) : undefined;
  const expiry = c?.expiry ? Number(c.expiry) : undefined;
  const left = expiry ? daysLeft(expiry) : undefined;
  const expired = c?.status === "Open" && left === 0;
  const mine = !!c && c.status === "Claimed" && !!address && c.recipient_id?.toLowerCase() === address.toLowerCase();
  const open = c?.status === "Open" && !expired;
  const usdText = amountUnits !== undefined ? formatUsdShort(amountUnits) : "";
  const localText = amountUnits !== undefined && cur !== "USD" ? formatLocal(amountUnits, cur, fx.data?.rateE8) : undefined;
  const thisPath = `/claim?${Object.entries({ k: p.k, n: p.n, m: p.m, a: p.a, go: "1" })
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&")}`;

  const doClaim = async () => {
    if (!key) return;
    const r = await run.run(key);
    if (r) {
      setDone(r);
      void queryClient.invalidateQueries({ queryKey: qk.activity(identity.get().address) });
      void claim.refetch();
    }
  };

  // Back from sign-up (or unlocked already with go=1): claim straight away.
  useEffect(() => {
    if (p.go === "1" && !auto.current && st.status === "unlocked" && st.profile && open && !done) {
      auto.current = true;
      void doClaim();
    }
  }, [p.go, st.status, !!st.profile, open, done]); // eslint-disable-line react-hooks/exhaustive-deps

  const afterIdentity = async () => {
    if (!identity.get().profile) {
      router.replace({ pathname: "/profile", params: { next: thisPath } });
      return;
    }
    await doClaim();
  };

  const create = async () => {
    setMsg(undefined);
    setBusy("create");
    try {
      await createOrRestore("Plans");
      await afterIdentity();
    } catch (e) {
      setMsg(handlePasskeyFailure(e).inline);
    } finally {
      setBusy(null);
    }
  };
  const restore = async () => {
    setMsg(undefined);
    setBusy("restore");
    try {
      await restoreWithPasskey();
      await afterIdentity();
    } catch (e) {
      setMsg(handlePasskeyFailure(e).inline);
    } finally {
      setBusy(null);
    }
  };
  const unlockAndClaim = async () => {
    setMsg(undefined);
    setBusy("unlock");
    try {
      await unlockStored();
      await afterIdentity();
    } catch (e) {
      setMsg(handlePasskeyFailure(e).inline);
    } finally {
      setBusy(null);
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const header = (
    <Row between style={{ height: 56 }}>
      <Logo size={20} />
      <Btn label="Close" kind="txt" sm onPress={close} testID="btn-close" />
    </Row>
  );

  if (!key) {
    return (
      <Screen testID="screen-claim">
        {header}
        <Banner kind="neg" icon="alert" title="This link isn't complete" text="Ask the person who sent it to share it again." testID="claim-status" />
      </Screen>
    );
  }

  if (done || mine) {
    return (
      <Screen testID="screen-claim" dock={<Btn label="Done" onPress={() => router.replace("/balance")} testID="btn-done" />}>
        {header}
        <View style={{ alignItems: "center", marginTop: 32 }}>
          <BigIcon icon="check" kind="p" />
          <Txt v="d28" center style={{ marginTop: 16 }} testID="claim-status">
            {usdText ? `${usdText} is in your Plans account` : "It's in your Plans account"}
          </Txt>
          {localText ? (
            <Txt v="t17" color="muted" style={{ marginTop: 4 }}>
              {localText}
            </Txt>
          ) : null}
          <Row gap={16} style={{ marginTop: 16 }}>
            {done ? <SettledIn ms={settledMs(done)} /> : null}
            <Proof hash={done?.txHash} />
          </Row>
        </View>
      </Screen>
    );
  }

  const statusBlock = !c ? (
    <View style={{ marginTop: 16, gap: 10 }}>
      {claim.isLoading ? (
        <Skel w="100%" h={180} r={14} />
      ) : (
        <Banner kind="mut" icon="clock" title="Getting the link ready…" text="A new link can take a few seconds to show up." testID="claim-status">
          <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void claim.refetch()} loading={claim.isFetching} style={{ marginTop: 8 }} testID="btn-claim-retry" />
        </Banner>
      )}
    </View>
  ) : c.status === "Claimed" ? (
    <View style={{ marginTop: 24 }}>
      <Banner kind="mut" icon="info" title="Someone already claimed this." text="Each link can be claimed once. Ask the sender if you think it was meant for you." testID="claim-status" />
    </View>
  ) : c.status === "Refunded" || expired ? (
    <View style={{ marginTop: 24 }}>
      <Banner kind="mut" icon="clock" title={`This link ran out. The money ${c.status === "Refunded" ? "went" : "goes"} back to ${sender}.`} text="Ask them to send a new one." testID="claim-status" />
    </View>
  ) : null;

  const showStub = !c || open;
  const label = usdText ? `Claim ${usdText}` : "Claim";

  return (
    <Screen
      testID="screen-claim"
      dock={
        open ? (
          <>
            {msg ? (
              <Txt v="t13" color="neg" center testID="claim-message">
                {msg}
              </Txt>
            ) : null}
            {run.error ? <Banner kind="neg" icon="alert" title={run.error.title} text={run.error.message} /> : null}
            {st.status === "none" ? (
              <>
                <Btn label="Create account & claim" icon="fp" onPress={() => void create()} loading={busy === "create"} disabled={!!busy} testID="btn-create-account-and-claim" />
                <Btn label="I already use Plans" kind="sec" onPress={() => void restore()} loading={busy === "restore"} disabled={!!busy} testID="btn-i-already-use-plans" />
              </>
            ) : st.status === "locked" ? (
              <Btn label={label} icon="fp" onPress={() => void unlockAndClaim()} loading={busy === "unlock" || run.busy} testID="btn-claim" />
            ) : (
              <Btn label={label} icon="fp" onPress={() => void (st.profile ? doClaim() : afterIdentity())} loading={run.busy} testID="btn-claim" />
            )}
          </>
        ) : undefined
      }
    >
      {header}
      {showStub ? (
        <Stub
          testID="claim-stub"
          head={
            <>
              <Row>
                <Avatar initial={(sender[0] ?? "?").toUpperCase()} color={senderP?.color ?? "#D9634B"} size={44} />
                <View>
                  <Txt v="lt">{sender} sent you</Txt>
                  {c?.fromCountry ? (
                    <Txt v="t13" color="muted">
                      {countryByCode(c.fromCountry)?.name ?? c.fromCountry} {countryByCode(c.fromCountry)?.flag ?? ""}
                    </Txt>
                  ) : null}
                </View>
              </Row>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                {amountUnits !== undefined ? (
                  <Txt v="d56" tnum testID="claim-amount">
                    {usdText}
                  </Txt>
                ) : (
                  <Skel w={120} h={56} />
                )}
                {localText ? (
                  <Txt v="d22" color="muted">
                    (≈ {localText})
                  </Txt>
                ) : null}
              </View>
              {p.m ? (
                <Txt v="t15" style={{ marginTop: 10 }}>
                  “{p.m}”
                </Txt>
              ) : null}
            </>
          }
          lines={[
            ["Expires", expiry ? `${dayText(expiry)} · ${left === 1 ? "1 day left" : `${left} days left`}` : "…"],
            ["Fee", "None"],
          ]}
        />
      ) : null}
      {statusBlock}
      {open ? (
        <>
          <Txt v="d22" style={{ marginTop: 24 }}>
            {st.status === "none" ? "Claim it in a minute" : "Claim it now"}
          </Txt>
          <View style={{ gap: 12, marginTop: 12 }}>
            {st.status === "none" ? <Step n={1}>Create your Plans account with your fingerprint.</Step> : <Step n={1}>Confirm it's you with your fingerprint.</Step>}
            <Step n={2}>The money lands straight away.</Step>
            <Step n={3}>Keep it as dollars, or send it on to anyone.</Step>
          </View>
          <Txt v="t13" color="muted" style={{ marginTop: 12 }}>
            No bank details needed.
          </Txt>
        </>
      ) : null}
    </Screen>
  );
}
