/**
 * App-wide side effects, mounted once in the root layout:
 * - lock after 10 minutes in the background (signing session and keys are wiped);
 * - the live feed: start/stop the WebSocket, invalidate queries on events, show toasts;
 * - register the X25519 key, post group-key wraps for members who have none yet;
 * - register for push notifications with the relayer (Expo on Android; Web Push in the browser,
 *   where only the notifications screen ever asks for permission — webPush.web.ts).
 */
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import type { Address, Hex } from "viem";
import { fetchAccountKeys, fetchPlanDetail } from "../api/envio";
import { registerPush } from "../api/relayer";
import { postKeyWraps, registerKey } from "../chain/actions";
import { onLiveEvent, startLive, stopLive, type LiveEvent } from "../chain/live";
import { toHex, fromHex } from "../crypto/bytes";
import { wrapGroupKey } from "../crypto/seal";
import { formatUsd } from "../domain/currency";
import { groupKeyFor, membersNeedingWrap } from "../domain/groups";
import { currentAccountOrNull, currentKeys, identity, lock, markKeyRegistered } from "../identity/session";
import { personFor, queryClient, qk, type PlanCardVM } from "./data";
import { useStore } from "./observable";
import { usesPush } from "./notify";
import { storage } from "./storage";
import { startWebPush, syncWebPush } from "./webPush";
import { showToast } from "../../ui/Toast";

const LOCK_AFTER_MS = 10 * 60_000;
const lc = (s: unknown) => String(s ?? "").toLowerCase();

function myPots(): Set<string> {
  const me = identity.get().address;
  const plans = queryClient.getQueryData<PlanCardVM[]>(qk.myPlans(me));
  return new Set((plans ?? []).map((p) => p.pot.toLowerCase()));
}

async function rewrapIfNeeded(pot: string): Promise<void> {
  const me = identity.get().address?.toLowerCase();
  if (!me || !currentKeys() || !currentAccountOrNull()) return;
  const d = await fetchPlanDetail(pot);
  if (!d || d.status === "Settled") return;
  const mine = d.members.find((m) => m.address.toLowerCase() === me);
  if (mine?.status !== "Active") return;
  const gk = groupKeyFor(pot, { me, keyWraps: d.keyWraps, inviteKeyWrap: d.inviteKeyWrap });
  if (!gk) return;
  const keys = await fetchAccountKeys(d.members.map((m) => m.address));
  const byAcc: Record<string, string | null | undefined> = {};
  for (const k of keys) byAcc[k.id.toLowerCase()] = k.key;
  const need = membersNeedingWrap(d.members, d.keyWraps, byAcc);
  if (need.length === 0) return;
  const wraps = need.map((n) => ({ member: n.member, wrap: toHex(wrapGroupKey(fromHex(n.pubKey), gk, pot)) as Hex }));
  await postKeyWraps(pot as Address, wraps);
  void queryClient.invalidateQueries({ queryKey: qk.plan(pot) });
}

const rewrapTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleRewrap(pot: string) {
  const p = pot.toLowerCase();
  if (rewrapTimers.has(p)) return;
  // A random delay so not every member posts the same wraps at once; the check repeats after it.
  const t = setTimeout(
    () => {
      rewrapTimers.delete(p);
      void rewrapIfNeeded(p).catch(() => undefined);
    },
    2500 + Math.random() * 5000,
  );
  rewrapTimers.set(p, t);
}

function handleEvent(e: LiveEvent) {
  const me = identity.get().address?.toLowerCase();
  if (!me) return;
  const pots = myPots();
  const a = e.args;
  const isPot = pots.has(e.address);
  if (isPot) {
    void queryClient.invalidateQueries({ queryKey: qk.plan(e.address) });
    void queryClient.invalidateQueries({ queryKey: qk.myPlans(me) });
    if (["Contributed", "Payout", "Pulled", "DebtPaid", "MemberExited", "Settled"].includes(e.name)) void queryClient.invalidateQueries({ queryKey: qk.balance(me) });
    const plan = queryClient.getQueryData<PlanCardVM[]>(qk.myPlans(me))?.find((p) => p.pot.toLowerCase() === e.address);
    const planName = plan?.meta.name ?? "Your plan";
    const goPlan = () => router.push({ pathname: "/plan/[pot]", params: { pot: e.address } });
    if (e.name === "SpendExecuted") {
      const members = (a.members as string[] | undefined) ?? [];
      const shares = (a.shares as bigint[] | undefined) ?? [];
      const i = members.findIndex((m) => lc(m) === me);
      showToast({
        title: `${planName}: ${formatUsd(BigInt(String(a.amount ?? 0)))} spent`,
        sub: i >= 0 ? `Your share ${formatUsd(BigInt(String(shares[i] ?? 0)))}` : planName,
        emoji: plan?.meta.emoji ?? "🎟️",
        onPress: goPlan,
      });
    } else if (e.name === "SpendProposed" && lc(a.proposer) !== me && Number(a.approvalsRequired ?? 1) > 1) {
      const who = personFor(String(a.proposer));
      showToast({
        title: `${who.name} wants ${formatUsd(BigInt(String(a.amount ?? 0)))}`,
        sub: `${planName} · needs an OK`,
        avatar: { initial: who.initial, color: who.color },
        onPress: () => router.push({ pathname: "/plan/[pot]/approve/[id]", params: { pot: e.address, id: String(a.id) } }),
      });
    } else if (e.name === "MemberJoined" && lc(a.member) !== me) {
      showToast({ title: `Someone joined ${planName}`, sub: "Their wristband is on", emoji: "🎉", onPress: goPlan });
      scheduleRewrap(e.address);
    } else if (e.name === "Frozen" && lc(a.by) !== me) {
      showToast({ title: `Spending paused in ${planName}`, sub: "Open the plan to vote", emoji: "⏸️", onPress: goPlan });
    } else if (e.name === "Settled") {
      showToast({ title: `${planName} is settled`, sub: "Everyone has been paid", emoji: "✅", onPress: goPlan });
    }
  }
  if (e.name === "KeyRegistered") {
    for (const p of pots) {
      const plan = queryClient.getQueryData<PlanCardVM[]>(qk.myPlans(me))?.find((x) => x.pot.toLowerCase() === p);
      if (plan?.people.some((x) => x.address === lc(a.account))) scheduleRewrap(p);
    }
  }
  if (e.name === "Sent" && (lc(a.to) === me || lc(a.from) === me)) {
    void queryClient.invalidateQueries({ queryKey: qk.balance(me) });
    void queryClient.invalidateQueries({ queryKey: qk.activity(me) });
    if (lc(a.to) === me && e.txHash) {
      router.push({ pathname: "/received", params: { tx: e.txHash, from: String(a.from), amount: String(a.amount), live: String(e.at) } });
    }
  }
  if ((e.name === "Claimed" || e.name === "ClaimCreated" || e.name === "ClaimRefunded") && (lc(a.recipient) === me || lc(a.source) === me || lc(a.to) === me)) {
    void queryClient.invalidateQueries({ queryKey: qk.balance(me) });
    void queryClient.invalidateQueries({ queryKey: qk.activity(me) });
  }
  if (e.name === "PotCreated" && lc(a.creator) === me) void queryClient.invalidateQueries({ queryKey: qk.myPlans(me) });
}

async function ensureKeyRegistered() {
  const st = identity.get();
  const k = currentKeys();
  if (!k || st.keyRegistered || !currentAccountOrNull()) return;
  try {
    await registerKey(toHex(k.x25519Public) as Hex);
    await markKeyRegistered();
  } catch {
    /* retried next unlock */
  }
}

async function ensurePush() {
  const acct = currentAccountOrNull();
  if (!acct || !usesPush) return;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return; // Expo push tokens need an EAS project id (see README)
  try {
    const prefs = await storage.loadPrefs();
    if (prefs.pushRegisteredAt && Date.now() - prefs.pushRegisteredAt < 12 * 3600_000) return;
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const message = `Plans push notifications\nAddress: ${acct.address}\nToken: ${token}\nDeadline: ${deadline}`;
    const signature = await acct.signMessage({ message });
    await registerPush({ address: acct.address, expoPushToken: token, deadline, signature });
    await storage.savePrefs({ ...prefs, pushRegisteredAt: Date.now() });
  } catch {
    /* best effort */
  }
}

export function AppEffects() {
  const status = useStore(identity, (s) => s.status);
  const bgAt = useRef<number | null>(null);

  useEffect(() => {
    // Web: the notifications service worker (no prompt). No-op on Android.
    startWebPush();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") {
        bgAt.current = Date.now();
        // A hidden browser tab keeps its live feed, so it can still show notifications and the title count.
        if (Platform.OS !== "web") stopLive();
      } else if (s === "active") {
        const away = bgAt.current ? Date.now() - bgAt.current : 0;
        bgAt.current = null;
        if (away > LOCK_AFTER_MS && identity.get().status === "unlocked") {
          lock();
          router.replace("/unlock");
          return;
        }
        if (identity.get().status === "unlocked") {
          startLive();
          void queryClient.invalidateQueries();
        }
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (status !== "unlocked") return;
    startLive();
    const off = onLiveEvent(handleEvent);
    void ensureKeyRegistered();
    void ensurePush();
    const acct = currentAccountOrNull();
    if (acct) void syncWebPush(acct);
    return () => {
      off();
      stopLive();
    };
  }, [status]);

  return null;
}
