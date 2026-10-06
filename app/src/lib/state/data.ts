/**
 * Data hooks (TanStack Query). Envio is the source for plans, balances, budgets and the settle-up
 * graph; RPC for the person's own balance; the relayer for FX and demo accounts. The live
 * WebSocket feed invalidates these queries within a second of an event (see LiveBridge).
 */
import { QueryClient, useQueries, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { config } from "../../config";
import { fetchAccountActivity, fetchMyPlans, fetchPlanDetail, fetchPotPreview, type PlanDetail } from "../api/envio";
import { getDemoAccounts, getFx, type DemoAccounts } from "../api/relayer";
import { ausdAllowance, ausdBalance } from "../chain/rpc";
import { contactFor, groupKeyFor, planMeta, profilesFrom, rememberContact } from "../domain/groups";
import type { PlanMeta, Profile } from "../crypto/seal";
import { identity } from "../identity/session";
import { useStore } from "./observable";
import { AVATAR_COLORS, WRISTBAND_LIST } from "../../theme/tokens";
import { countryByCode, currencyFor } from "../domain/currency";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false, gcTime: 30 * 60_000 },
  },
});

export const qk = {
  myPlans: (a?: string) => ["myPlans", a?.toLowerCase()] as const,
  plan: (p: string) => ["plan", p.toLowerCase()] as const,
  potPreview: (p: string) => ["potPreview", p.toLowerCase()] as const,
  balance: (a?: string) => ["balance", a?.toLowerCase()] as const,
  allowance: (a: string, s: string) => ["allowance", a.toLowerCase(), s.toLowerCase()] as const,
  fx: (to: string) => ["fx", to] as const,
  demo: ["demoAccounts"] as const,
  activity: (a?: string) => ["activity", a?.toLowerCase()] as const,
};

export function useMe(): { address?: Address; profile?: Profile; currency: string; country?: string } {
  const address = useStore(identity, (s) => s.address);
  const profile = useStore(identity, (s) => s.profile);
  return { address: address as Address | undefined, profile, currency: profile?.currency ?? "USD", country: profile?.country };
}

// ─────────────── people ───────────────

export type Person = { address: string; name: string; initial: string; color: string; city?: string; country?: string; flag?: string; currency: string; demo: boolean; me: boolean };

function hashIndex(s: string, n: number): number {
  let h = 0;
  for (let i = 2; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}

let demoCache: DemoAccounts | null = null;
export function demoAccountFor(address: string) {
  return demoCache?.accounts.find((a) => a.address.toLowerCase() === address.toLowerCase());
}

export function personFor(address: string, opts: { profile?: Profile; country?: string | null; me?: string } = {}): Person {
  const a = address.toLowerCase();
  const isMe = !!opts.me && opts.me.toLowerCase() === a;
  const demo = demoAccountFor(a);
  const contact = contactFor(a);
  const myProfile = isMe ? identity.get().profile : undefined;
  const name = myProfile?.name ?? opts.profile?.name ?? demo?.name ?? contact?.name ?? "Friend";
  const country = (opts.profile?.country ?? myProfile?.country ?? demo?.country ?? contact?.country ?? opts.country ?? undefined) || undefined;
  const city = myProfile?.city ?? opts.profile?.city ?? demo?.city ?? contact?.city;
  const currency = opts.profile?.currency ?? myProfile?.currency ?? contact?.currency ?? countryByCode(country)?.currency ?? "USD";
  return {
    address: a,
    name,
    initial: (name[0] ?? "?").toUpperCase(),
    color: AVATAR_COLORS[hashIndex(a, AVATAR_COLORS.length)],
    city,
    country,
    flag: countryByCode(country)?.flag,
    currency,
    demo: !!demo,
    me: isMe,
  };
}

export function useDemoAccounts() {
  return useQuery({
    queryKey: qk.demo,
    queryFn: async () => {
      const d = await getDemoAccounts();
      demoCache = d;
      return d;
    },
    staleTime: 10 * 60_000,
  });
}

// ─────────────── money ───────────────

export function useBalance() {
  const { address } = useMe();
  return useQuery({
    queryKey: qk.balance(address),
    queryFn: () => ausdBalance(address!),
    enabled: !!address,
    refetchInterval: 20_000,
  });
}

export function useAllowance(spender?: string) {
  const { address } = useMe();
  return useQuery({
    queryKey: qk.allowance(address ?? "", spender ?? ""),
    queryFn: () => ausdAllowance(address!, spender as Address),
    enabled: !!address && !!spender,
  });
}

/** Reference rate USD → `to` (1e8 fixed point). USD → 1e8. */
export function useFx(to: string) {
  return useQuery({
    queryKey: qk.fx(to),
    queryFn: async () => {
      if (to === "USD") return { rateE8: 100_000_000n, timestamp: Math.floor(Date.now() / 1000), source: "", date: "" };
      const q = await getFx("USD", to);
      return { rateE8: BigInt(q.rateE8), timestamp: q.timestamp, source: q.source, date: q.date };
    },
    staleTime: 10 * 60_000,
    retry: 2,
  });
}

/** Rates USD → each currency (1e8). Missing entries mean "not loaded yet". */
export function useFxMap(currencies: string[]): Record<string, bigint> {
  const uniq = Array.from(new Set(currencies.filter((c) => c && c !== "USD")));
  const results = useQueries({
    queries: uniq.map((to) => ({
      queryKey: qk.fx(to),
      queryFn: async () => {
        const q = await getFx("USD", to);
        return { rateE8: BigInt(q.rateE8), timestamp: q.timestamp, source: q.source, date: q.date };
      },
      staleTime: 10 * 60_000,
    })),
  });
  const out: Record<string, bigint> = { USD: 100_000_000n };
  uniq.forEach((c, i) => {
    const r = results[i]?.data?.rateE8;
    if (r) out[c] = r;
  });
  return out;
}

// ─────────────── plans ───────────────

export type PlanCardVM = {
  pot: string;
  meta: PlanMeta;
  locked: boolean;
  status: "Active" | "Settled";
  ended: boolean;
  balance: bigint;
  memberCount: number;
  activeMemberCount: number;
  countries: string[];
  myNet: bigint;
  myDebt: bigint;
  myStatus: "Active" | "Exited";
  pending: number;
  needsMe: number;
  startTime: number;
  endTime: number;
  frozen: boolean;
  isDemo: boolean;
  people: Person[];
  lastSpend?: { who: Person; amount: bigint; at: number };
};

export function fallbackMeta(pot: string): PlanMeta {
  return { name: "Locked plan", emoji: "🔒", color: WRISTBAND_LIST[hashIndex(pot, WRISTBAND_LIST.length)] };
}

export function useMyPlans() {
  const { address } = useMe();
  const keysPending = useStore(identity, (s) => s.keysPending);
  return useQuery({
    queryKey: qk.myPlans(address),
    enabled: !!address,
    queryFn: async (): Promise<PlanCardVM[]> => {
      const r = await fetchMyPlans(address!);
      const me = address!.toLowerCase();
      const now = Date.now() / 1000;
      return r.Member.map((m) => {
        const p = m.pot;
        const gk = groupKeyFor(p.id, { me, keyWraps: p.keyWraps, inviteKeyWrap: p.inviteKeyWrap });
        const meta = planMeta(p.id, p.meta, gk);
        const profiles = profilesFrom(p.id, p.keyWraps, gk);
        for (const [addr, pr] of Object.entries(profiles)) rememberContact(addr, { name: pr.name, city: pr.city, country: pr.country, currency: pr.currency });
        const people = p.members.filter((x) => x.status === "Active").map((x) => personFor(x.address, { profile: profiles[x.address.toLowerCase()], country: x.country, me }));
        const needsMe = p.spends.filter((s) => s.proposer_id.toLowerCase() !== me && !(s.votes ?? []).some((v) => v.account_id.toLowerCase() === me)).length;
        const last = p.recent?.[0];
        return {
          pot: p.id,
          meta: meta ?? fallbackMeta(p.id),
          locked: !meta,
          status: p.status,
          ended: Number(p.endTime) < now,
          balance: BigInt(p.balance),
          memberCount: p.memberCount,
          activeMemberCount: p.activeMemberCount,
          countries: p.countries,
          myNet: BigInt(m.net),
          myDebt: BigInt(m.debt),
          myStatus: m.status,
          pending: p.spends.length,
          needsMe,
          startTime: Number(p.startTime),
          endTime: Number(p.endTime),
          frozen: Number(p.frozenUntil) > now,
          isDemo: !!p.isDemo || !!meta?.demo,
          people,
          lastSpend: last ? { who: personFor(last.proposer_id, { profile: profiles[last.proposer_id.toLowerCase()], me }), amount: BigInt(last.amount), at: last.executedAt ?? 0 } : undefined,
        } satisfies PlanCardVM;
      });
    },
    meta: { keysPending },
  });
}

export type PlanVM = {
  raw: PlanDetail;
  pot: string;
  meta: PlanMeta;
  locked: boolean;
  gk: Uint8Array | null;
  people: Record<string, Person>;
  profiles: Record<string, Profile>;
  me?: string;
  myMember?: PlanDetail["members"][number];
  isMember: boolean;
  frozen: boolean;
  frozenUntil: number;
  ended: boolean;
  settled: boolean;
  now: number;
};

export function usePlan(pot?: string) {
  const { address } = useMe();
  return useQuery({
    queryKey: qk.plan(pot ?? ""),
    enabled: !!pot,
    refetchInterval: 30_000,
    queryFn: async (): Promise<PlanVM | null> => {
      const d = await fetchPlanDetail(pot!);
      if (!d) return null;
      const me = address?.toLowerCase();
      const gk = groupKeyFor(d.id, { me, keyWraps: d.keyWraps, inviteKeyWrap: d.inviteKeyWrap });
      const meta = planMeta(d.id, d.meta, gk);
      const profiles = profilesFrom(d.id, d.keyWraps, gk);
      for (const [addr, pr] of Object.entries(profiles)) rememberContact(addr, { name: pr.name, city: pr.city, country: pr.country, currency: pr.currency });
      const people: Record<string, Person> = {};
      for (const m of d.members) people[m.address.toLowerCase()] = personFor(m.address, { profile: profiles[m.address.toLowerCase()], country: m.country, me });
      const now = Math.floor(Date.now() / 1000);
      const myMember = me ? d.members.find((m) => m.address.toLowerCase() === me) : undefined;
      return {
        raw: d,
        pot: d.id,
        meta: meta ?? fallbackMeta(d.id),
        locked: !meta,
        gk,
        people,
        profiles,
        me,
        myMember,
        isMember: myMember?.status === "Active",
        frozen: Number(d.frozenUntil) > now,
        frozenUntil: Number(d.frozenUntil),
        ended: Number(d.endTime) <= now,
        settled: d.status === "Settled",
        now,
      };
    },
  });
}

export function usePotPreview(pot?: string, inviteSecret?: Uint8Array | null) {
  return useQuery({
    queryKey: [...qk.potPreview(pot ?? ""), inviteSecret ? "s" : "-"],
    enabled: !!pot,
    queryFn: async () => {
      const d = await fetchPotPreview(pot!);
      if (!d) return null;
      const gk = groupKeyFor(d.id, { keyWraps: d.keyWraps, inviteKeyWrap: d.inviteKeyWrap, inviteSecret });
      const meta = planMeta(d.id, d.meta, gk);
      const profiles = profilesFrom(d.id, d.keyWraps, gk);
      const people = d.members.filter((m) => m.status === "Active").map((m) => personFor(m.address, { profile: profiles[m.address.toLowerCase()], country: m.country }));
      return { raw: d, meta, gk, people, profiles };
    },
  });
}

export function useAccountActivity() {
  const { address } = useMe();
  return useQuery({ queryKey: qk.activity(address), enabled: !!address, queryFn: () => fetchAccountActivity(address!), refetchInterval: 60_000 });
}

export function personCurrency(p: Person): string {
  return currencyFor(p.currency).code;
}

export { config };
