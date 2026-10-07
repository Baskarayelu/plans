/**
 * 14 Invite opened · 14b Invite no longer works · 15 Joined.
 * /join?pot=&s=<base64url invite secret>&n=<inviter name>
 * A new person gets exactly one system prompt: the passkey is created here, the profile form
 * follows if needed, and they come back to tap "Join" with no further prompt.
 */
import { router, useLocalSearchParams } from "expo-router";
import { takeInviteSecret } from "../lib/domain/webLinks";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Share, useWindowDimensions, View } from "react-native";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fromBase64Url, toHex } from "../lib/crypto/bytes";
import { countryByCode, formatUsd, formatUsdShort, ONE_DOLLAR, parseAmount } from "../lib/domain/currency";
import { defaultSafetyNet, joinPlan } from "../lib/domain/planOps";
import { rulesInWords } from "../lib/domain/rules";
import { handlePasskeyFailure, passkeyNotice } from "../lib/identity/flows";
import { usePasskeyWait } from "../lib/identity/usePasskeyWait";
import { createOrRestore, identity, unlockStored } from "../lib/identity/session";
import { personFor, useBalance, usePotPreview, type Person } from "../lib/state/data";
import { useStore } from "../lib/state/observable";
import { useAction } from "../lib/state/useAction";
import { useColors } from "../theme/ThemeProvider";
import { WRISTBANDS, WRISTBAND_LIST } from "../theme/tokens";
import { currentRules } from "../ui/core/PlanCore";
import { Icon } from "../ui/Icon";
import { Avatar, Band, Banner, BigIcon, Btn, Card, Chip, Confetti, EmojiTile, Field, ListItem, Row, Skel, Tile, Toggle, Wristband } from "../ui/kit";
import { AppBar } from "../ui/layout";
import { DeskScreen } from "../ui/desk/money";
import { People, PersonAvatar, useMoney } from "../ui/plan/common";
import { dateRange } from "../ui/planBits";
import { Txt } from "../ui/Text";

const MAX_MEMBERS = 50;
type Dead = "off" | "settled" | "ended" | "full" | "left" | "broken";

export default function Join() {
  const { pot: potParam, s: sParam, n } = useLocalSearchParams<{ pot?: string; s?: string; n?: string }>();
  // Web links keep the invite secret out of the URL: it waits in memory (lib/domain/webLinks.ts).
  const s = sParam ?? takeInviteSecret(potParam);
  const pot = potParam?.toLowerCase();
  const inviter = n?.trim() || undefined;
  // A secret that isn't a usable key (wrong length, all zeros, out of range) is an incomplete link, not a crash.
  const [secret, inviteAddr] = useMemo((): [Uint8Array | null, string | null] => {
    try {
      const b = fromBase64Url(s ?? "");
      if (b.length !== 32) return [null, null];
      return [b, privateKeyToAccount(toHex(b)).address.toLowerCase()];
    } catch {
      return [null, null];
    }
  }, [s]);
  const status = useStore(identity, (x) => x.status);
  const myAddr = useStore(identity, (x) => x.address)?.toLowerCase();
  const preview = usePotPreview(pot, secret);
  const [joined, setJoined] = useState<null | { deposit: bigint; safetyNet: bigint }>(null);

  const raw = preview.data?.raw;
  const mine = raw && myAddr ? raw.members.find((m) => m.address.toLowerCase() === myAddr) : undefined;

  // already in → straight to the plan
  useEffect(() => {
    if (!joined && mine?.status === "Active" && pot) router.replace({ pathname: "/plan/[pot]", params: { pot } });
  }, [joined, mine?.status, pot]);

  if (joined && pot && preview.data) return <Joined pot={pot} data={preview.data} deposit={joined.deposit} safetyNet={joined.safetyNet} inviter={inviter} />;

  let dead: Dead | null = null;
  if (!pot || !/^0x[0-9a-f]{40}$/.test(pot) || !secret) dead = "broken";
  else if (raw) {
    const now = Date.now() / 1000;
    if (raw.status === "Settled") dead = "settled";
    else if (Number(raw.endTime) < now) dead = "ended";
    else if (mine && mine.status === "Exited") dead = "left";
    else if (!mine && raw.memberCount >= MAX_MEMBERS) dead = "full";
    else if (raw.inviteSigner && raw.inviteSigner.toLowerCase() !== inviteAddr) dead = "off";
  }
  if (dead) return <DeadInvite cause={dead} inviter={inviter} name={preview.data?.meta?.name} emoji={preview.data?.meta?.emoji} color={preview.data?.meta?.color} />;

  if (!preview.data) {
    return (
      <DeskScreen testID="screen-join">
        <AppBar icon="x" onBack={() => router.replace("/")} />
        {preview.isError || preview.data === null ? (
          <Banner kind="mut" icon={preview.data === null ? "search" : "wifioff"} title={preview.data === null ? "We couldn't find this plan yet" : "Couldn't open the invite"} text={preview.data === null ? "If it was just made, give it a moment." : "Check your connection and try again."}>
            <Btn label="Try again" kind="sec" icon="refresh" sm onPress={() => void preview.refetch()} style={{ marginTop: 8, height: 40 }} testID="btn-try-again" />
          </Banner>
        ) : (
          <View style={{ gap: 12 }} testID="join-loading">
            <Skel w="40%" h={14} />
            <Skel w="100%" h={170} r={14} />
            <Skel w="50%" h={12} style={{ marginTop: 8 }} />
            {[0, 1, 2, 3].map((i) => (
              <Skel key={i} w="90%" h={14} />
            ))}
          </View>
        )}
      </DeskScreen>
    );
  }

  return <InviteOpened pot={pot!} secret={secret!} inviter={inviter} data={preview.data} status={status} refetch={() => preview.refetch()} onJoined={setJoined} joinHref={`/join?pot=${pot}${Platform.OS === "web" ? "" : `&s=${encodeURIComponent(s ?? "")}`}${inviter ? `&n=${encodeURIComponent(inviter)}` : ""}`} />;
}

type PreviewData = NonNullable<ReturnType<typeof usePotPreview>["data"]>;

function InviteOpened({
  pot,
  secret,
  inviter,
  data,
  status,
  refetch,
  onJoined,
  joinHref,
}: {
  pot: string;
  secret: Uint8Array;
  inviter?: string;
  data: PreviewData;
  status: string;
  refetch: () => Promise<{ data?: PreviewData | null }>;
  onJoined: (j: { deposit: bigint; safetyNet: bigint }) => void;
  joinHref: string;
}) {
  const c = useColors();
  const money = useMoney();
  const bal = useBalance();
  const raw = data.raw;
  const rules = currentRules(raw);
  const words = rulesInWords(rules, { reviewWindowSec: raw.reviewWindow !== undefined ? Number(raw.reviewWindow) : undefined });
  const [allRules, setAllRules] = useState(false);
  const small = rules.oneApprovalMax <= 5n * ONE_DOLLAR;
  const chips = (small ? [1n, 2n, 5n] : [20n, 50n, 100n]).map((x) => x * ONE_DOLLAR);
  const balance = bal.data ?? 0n;
  const signedIn = status === "unlocked" || status === "locked";
  const [addOn, setAddOn] = useState(false);
  const [amount, setAmount] = useState<bigint>(chips[0]);
  const [other, setOther] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [inline, setInline] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const wait = usePasskeyWait();
  const safetyNet = defaultSafetyNet(rules);

  // turn "Add now" on by default once we know there's enough
  const [autoSet, setAutoSet] = useState(false);
  useEffect(() => {
    if (autoSet || !bal.isSuccess) return;
    setAutoSet(true);
    if (balance >= chips[0]) setAddOn(true);
  }, [autoSet, bal.isSuccess, balance, chips]);

  const deposit = addOn ? (other ? (parseAmount(otherText, 6) ?? 0n) : amount) : 0n;
  const tooMuch = deposit > balance;

  const join = useAction(async (dep: bigint) =>
    joinPlan({ pot: pot as Address, inviteSecret: secret, inviteKeyWrap: raw.inviteKeyWrap, deposit: dep, safetyNet }),
  );

  const name = data.meta?.name ?? (inviter ? `${inviter}'s plan` : "A plan");
  const emoji = data.meta?.emoji ?? "🎟️";
  const color = data.meta?.color ?? WRISTBANDS.lagoon;
  const start = Number(raw.startTime);
  const end = Number(raw.endTime);
  const days = Math.max(1, Math.ceil((end - start) / 86400));
  const balancePot = BigInt(raw.balance);
  const people = data.people;
  const from = people.find((p) => inviter && p.name === inviter);

  const onJoin = async () => {
    if (authBusy && wait.phase !== "stuck") return;
    setInline(null);
    setInfo(null);
    const st = identity.get().status;
    if (st === "none" || st === "locked") {
      setAuthBusy(true);
      wait.start(st === "none" ? "join" : "unlock");
      try {
        if (st === "none") {
          const r = await createOrRestore("Plans");
          wait.finish("ok");
          if (!identity.get().profile) {
            router.replace({ pathname: "/profile", params: { next: joinHref } });
            return;
          }
          if (r.restored) {
            // an existing account answered: let them check "Add now" before joining (no more prompts)
            setInfo(`Welcome back${identity.get().profile?.name ? `, ${identity.get().profile?.name}` : ""}. Check the details and tap Join.`);
            await refetch();
            return;
          }
        } else {
          await unlockStored();
          wait.finish("ok");
        }
      } catch (e) {
        wait.finish(e instanceof Error ? e.message : "failed");
        const r = handlePasskeyFailure(e, st === "none" ? "create" : "unlock");
        if (r.inline) setInline(r.inline);
        return;
      } finally {
        setAuthBusy(false);
      }
    }
    const me = identity.get().address?.toLowerCase();
    const fresh = (await refetch()).data;
    const m = fresh?.raw.members.find((x) => x.address.toLowerCase() === me);
    if (m?.status === "Active") {
      router.replace({ pathname: "/plan/[pot]", params: { pot } });
      return;
    }
    if (m) {
      setInline("You left this plan before, so you can't join it again.");
      return;
    }
    const dep = deposit > balance ? 0n : deposit;
    const r = await join.run(dep);
    if (!r) return;
    void refetch();
    onJoined({ deposit: dep, safetyNet });
  };

  // B5: "Opening passkey…" only when the system sheet takes over a second; 129 after 15 s.
  const waiting = authBusy && wait.phase === "waiting";
  const stuck = authBusy && wait.phase === "stuck" ? passkeyNotice("stuck", "create") : null;
  const label = waiting ? "Opening passkey…" : stuck ? "Try again" : status === "unlocked" ? "Join" : "Join with fingerprint";
  const shownRules = allRules ? words : words.slice(0, 5);

  return (
    <DeskScreen
      testID="screen-join"
      dock={
        <>
          {inline ? <Banner kind="neg" icon="alert" title={inline} testID="banner-join-inline" /> : null}
          {stuck ? <Banner kind="neg" icon={stuck.icon} title={stuck.title} text={stuck.text} testID="banner-join-stuck" /> : null}
          {join.error ? <Banner kind="neg" icon="alert" title={join.error.title} text={join.error.message} testID="banner-join-error" /> : null}
          <Btn label={label} icon={status === "unlocked" ? "check" : "fp"} loading={waiting || join.busy} disabled={signedIn && addOn && (tooMuch || deposit === 0n)} onPress={() => void onJoin()} testID="btn-join-with-fingerprint" />
        </>
      }
    >
      <AppBar icon="x" onBack={() => router.replace("/")} />
      <Row gap={8}>
        {from ? <PersonAvatar p={from} size={24} flag={false} /> : <Avatar initial={(inviter?.[0] ?? "?").toUpperCase()} color={WRISTBAND_LIST[0]} size={24} />}
        <Txt v="t13" color="muted">
          {inviter ? `${inviter} invited you` : "You're invited"}
        </Txt>
      </Row>

      <View style={{ marginTop: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 14, overflow: "hidden" }} testID="join-plan-card">
        <Wristband color={color} text={`${name} · ${dateRange(start, end)} · ${days} ${days === 1 ? "day" : "days"}`} />
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 }}>
          <Row>
            <EmojiTile emoji={emoji} color={color} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt v="d22" numberOfLines={2}>
                {name}
              </Txt>
              <Txt v="t13" color="muted">
                Pot so far {money.both(balancePot)}
              </Txt>
            </View>
          </Row>
          <Row gap={14} style={{ marginTop: 12 }} wrap>
            {people.slice(0, 4).map((p) => (
              <View key={p.address} style={{ width: 70, alignItems: "center" }}>
                <PersonAvatar p={p} size={40} />
                <Txt v="t13" weight="bold" numberOfLines={1} style={{ marginTop: 4 }}>
                  {p.name}
                </Txt>
                <Txt v="t11" color="muted" numberOfLines={1}>
                  {p.city ?? countryByCode(p.country)?.name ?? ""}
                </Txt>
              </View>
            ))}
            {people.length > 4 ? (
              <Txt v="t13" color="muted">
                +{people.length - 4} more
              </Txt>
            ) : null}
          </Row>
        </View>
      </View>

      <Txt v="ov" color="muted" style={{ marginTop: 20 }}>
        The rules, in plain words
      </Txt>
      <View style={{ gap: 8, marginTop: 8 }} testID="join-rules">
        {shownRules.map((w, i) => (
          <Row key={i} align="flex-start" gap={10}>
            <View style={{ marginTop: 1 }}>
              <Icon name="check" size={18} strokeWidth={2.4} color={c.pos} />
            </View>
            <Txt v="t15" style={{ flex: 1 }}>
              {w}
            </Txt>
          </Row>
        ))}
        {words.length > 5 && !allRules ? <Btn label="See all" kind="txt" sm onPress={() => setAllRules(true)} testID="btn-see-all-rules" /> : null}
      </View>

      {signedIn ? (
        <Card style={{ marginTop: 16 }} testID="card-add-now">
          {bal.isLoading ? (
            <Skel w="60%" h={18} />
          ) : balance === 0n ? (
            <Row between>
              <View style={{ flex: 1 }}>
                <Txt v="lt">Add money first</Txt>
                <Txt v="t13" color="muted">
                  Your Plans account is empty. You can join now and add money any time.
                </Txt>
              </View>
              <Btn label="Add money" kind="sec" sm onPress={() => router.push("/add-balance")} testID="btn-join-add-balance" />
            </Row>
          ) : (
            <>
              <Row between>
                <View style={{ flex: 1 }}>
                  <Txt v="lt">{deposit > 0n ? `Add ${formatUsdShort(deposit)} now` : "Add money now"}</Txt>
                  <Txt v="t13" color={tooMuch ? "neg" : "muted"}>
                    {tooMuch ? `You have ${money.both(balance)}` : deposit > 0n ? `${money.localOrUsd(deposit)} from your Plans account` : "Optional. You can add money any time."}
                  </Txt>
                </View>
                <Toggle on={addOn} onChange={setAddOn} label="Add money now" testID="toggle-add-now" />
              </Row>
              {addOn ? (
                <>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                    {chips
                      .filter((x) => x <= balance)
                      .map((x) => (
                        <Chip key={String(x)} label={formatUsdShort(x)} on={!other && amount === x} onPress={() => (setOther(false), setAmount(x))} testID={`chip-add-${x / ONE_DOLLAR}`} />
                      ))}
                    <Chip label="Other" ol={!other} on={other} onPress={() => setOther(true)} testID="chip-add-other" />
                  </View>
                  {other ? (
                    <View style={{ marginTop: 8 }}>
                      <Field label="Amount in dollars" value={otherText} onChangeText={setOtherText} keyboardType="decimal-pad" placeholder="0.00" right="$" testID="field-add-other" />
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </Card>
      ) : (
        <Card tint style={{ marginTop: 16 }}>
          <Txt v="t13" color="muted">
            You'll make a Plans account with your fingerprint. No password. You can put money in once you're in.
          </Txt>
        </Card>
      )}

      <View style={{ marginTop: 12 }}>
        <Banner
          kind="inf"
          icon="shield"
          title="Safety net"
          text={`Up to ${money.both(safetyNet)} can be collected from your Plans balance if you owe at the end. Never more, and we tell you first.`}
          testID="banner-safety-net"
        />
      </View>
      {info ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="pos" icon="check" title={info} />
        </View>
      ) : null}
      <View style={{ height: 16 }} />
    </DeskScreen>
  );
}

function DeadInvite({ cause, inviter, name, emoji, color }: { cause: Dead; inviter?: string; name?: string; emoji?: string; color?: string }) {
  const who = inviter ?? "your friend";
  const copy: Record<Dead, string> = {
    off: `${inviter ?? "Someone in the plan"} turned off the link or made a new one. Nothing was charged.`,
    settled: "This plan has already been settled, so no one new can join. Nothing was charged.",
    ended: "This plan has already ended. Nothing was charged.",
    full: "This plan is full: it already has 50 people. Nothing was charged.",
    left: "You left this plan before, so you can't join it again.",
    broken: "This link is incomplete. It may have been cut off when it was copied. Nothing was charged.",
  };
  const canAsk = cause === "off" || cause === "broken" || cause === "full";
  const ask = async () => {
    const msg = `Hi${inviter ? ` ${inviter}` : ""}, the Plans invite${name ? ` for ${name}` : ""} stopped working. Could you send me a new link?`;
    await Share.share({ message: msg }).catch(() => undefined);
  };
  return (
    <DeskScreen
      testID="screen-join-dead"
      dock={
        <>
          {canAsk ? <Btn label={`Ask ${who} for a new link`} icon="share" onPress={() => void ask()} testID="btn-ask-for-new-link" /> : null}
          <Btn label="Go to my plans" kind={canAsk ? "sec" : "pri"} onPress={() => router.replace("/")} testID="btn-go-to-my-plans" />
        </>
      }
    >
      <AppBar icon="x" onBack={() => router.replace("/")} />
      <View style={{ flex: 1, justifyContent: "center", minHeight: 120 }}>
        <BigIcon icon={cause === "left" ? "logout" : "link"} kind="m" />
        <Txt v="d28" center style={{ marginTop: 16 }}>
          {cause === "left" ? "You've left this plan" : "This invite has stopped working"}
        </Txt>
        <Txt v="t15" color="muted" center style={{ marginTop: 8, marginHorizontal: 12, marginBottom: 20 }} testID="dead-invite-reason">
          {copy[cause]}
        </Txt>
        {name || inviter ? (
          <Card>
            <Row>
              <EmojiTile emoji={emoji ?? "🎟️"} color={color ?? WRISTBANDS.lagoon} />
              <View style={{ flex: 1 }}>
                <Txt v="lt">{name ?? "A plan"}</Txt>
                {inviter ? (
                  <Txt v="t13" color="muted">
                    Invite from {inviter}
                  </Txt>
                ) : null}
              </View>
            </Row>
          </Card>
        ) : null}
      </View>
    </DeskScreen>
  );
}

function Joined({ pot, data, deposit, safetyNet, inviter }: { pot: string; data: PreviewData; deposit: bigint; safetyNet: bigint; inviter?: string }) {
  const { width } = useWindowDimensions();
  const money = useMoney();
  const me = identity.get();
  const myAddr = me.address?.toLowerCase();
  const raw = data.raw;
  const name = data.meta?.name ?? (inviter ? `${inviter}'s plan` : "the plan");
  const color = data.meta?.color ?? WRISTBANDS.lagoon;
  const others = data.people.filter((p) => p.address !== myAddr);
  const mePerson: Person = personFor(myAddr ?? "0x0000000000000000000000000000000000000000", { me: myAddr, profile: me.profile });
  const everyone = [...others, mePerson];
  const countries = new Set([...raw.countries.filter(Boolean), ...(me.profile?.country ? [me.profile.country] : [])]);
  const k = width / 390;
  const W = WRISTBANDS;
  const pieces: [number, number, string, number][] = [
    [30, 40, W.lagoon, 20],
    [80, 110, W.marigold, -30],
    [150, 30, W.orchid, 45],
    [220, 90, W.lime, -15],
    [300, 50, W.coral, 30],
    [340, 130, W.lagoon, -40],
    [40, 170, W.iris, 60],
    [260, 160, W.marigold, 10],
    [190, 140, W.coral, -60],
    [120, 200, W.lime, 35],
    [330, 220, W.orchid, -20],
    [352, 300, W.marigold, 70],
  ].map(([x, y, col, r]) => [Number(x) * k, Number(y), String(col), Number(r)]);
  const names = others.map((p) => p.name);
  const who = names.length === 0 ? "Everyone in the plan" : names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const band = `${me.profile?.name ?? "You"} · ${name} · ${dateRange(Number(raw.startTime), Number(raw.endTime))}`.toUpperCase();

  return (
    <DeskScreen
      testID="screen-joined"
      dock={
        <>
          <Btn label="Open the plan" onPress={() => router.replace({ pathname: "/plan/[pot]", params: { pot } })} testID="btn-open-the-plan" />
          <Btn label="Invite someone else" kind="txt" onPress={() => router.replace({ pathname: "/plan/[pot]/invite", params: { pot } })} testID="btn-invite-someone-else" />
        </>
      }
    >
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 360 }}>
        <Confetti pieces={pieces} />
      </View>
      <View style={{ height: 120 }} />
      <View style={{ marginHorizontal: -30, transform: [{ rotate: "-4deg" }] }}>
        <Band color={color} text={band} style={{ justifyContent: "center" }} />
      </View>
      <Txt v="d44" center style={{ marginTop: 32 }}>
        You're in!
      </Txt>
      <Txt v="t17" color="muted" center style={{ marginTop: 10, marginHorizontal: 12, marginBottom: 20 }}>
        Welcome to {name}. {who} can see you've joined.
      </Txt>
      <Card>
        {deposit > 0n ? (
          <ListItem left={<Tile icon="check" kind="p" />} title={`You added ${formatUsd(deposit)}`} sub={`${money.localOrUsd(deposit)} from your Plans account`} testID="joined-added" />
        ) : (
          <ListItem left={<Tile icon="plus" />} title="Add money any time" sub="From the plan, tap Add money" testID="joined-add-later" />
        )}
        <ListItem
          last
          left={<Tile icon="shield" kind="i" />}
          title={safetyNet > 0n ? "Safety net is on" : "Safety net is off"}
          sub={safetyNet > 0n ? `Up to ${money.both(safetyNet)}, only if you owe at the end` : "If you owe at the end, you pay it yourself"}
          testID="joined-safety-net"
        />
      </Card>
      <Row style={{ marginTop: 16, justifyContent: "center" }}>
        <People people={everyone} size={30} />
        <Txt v="t13" color="muted">
          {everyone.length} {everyone.length === 1 ? "person" : "people"}
          {countries.size > 1 ? ` · ${countries.size} countries` : ""}
        </Txt>
      </Row>
    </DeskScreen>
  );
}
