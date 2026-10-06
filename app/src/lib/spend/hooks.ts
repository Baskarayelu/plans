/**
 * Data hooks for the spending screens: one spend's full detail (shares, votes, disputes, claims),
 * the plan's rules, decrypted notes and receipt photos, and the live rule preview.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { fetchSpendDetail, type PotRow } from "../api/envio";
import { getBlob } from "../api/relayer";
import type { Rules, SpendKind } from "../chain/eip712";
import { previewSpend, type Preview } from "../chain/rpc";
import { fromBase64Url, fromHex, toHex } from "../crypto/bytes";
import { decodeMemo, groupDecrypt, type Memo } from "../crypto/seal";
import { rulesFromIndexer } from "../domain/rules";
import { blobRead, blobWrite } from "../state/cache";
import { queryClient, qk, type PlanVM } from "../state/data";
import { toBase64, ZERO_HASH } from "./logic";

const lc = (s: string) => s.toLowerCase();

export const spendKey = (pot: string, id: string) => ["spendDetail", lc(pot), String(id)] as const;

export type SpendDetail = NonNullable<Awaited<ReturnType<typeof fetchSpendDetail>>>;

/** One spend with shares, votes, disputes and claims (Envio). */
export function useSpendDetail(pot?: string, id?: string, refetchMs = 10_000) {
  return useQuery({
    queryKey: spendKey(pot ?? "", id ?? ""),
    enabled: !!pot && !!id,
    queryFn: () => fetchSpendDetail(`${lc(pot!)}-${id}`),
    refetchInterval: refetchMs,
  });
}

export function refreshSpend(pot: string, id?: string | bigint): void {
  void queryClient.invalidateQueries({ queryKey: qk.plan(pot) });
  if (id !== undefined) void queryClient.invalidateQueries({ queryKey: spendKey(pot, String(id)) });
}

/** The plan's current rules (indexer strings → typed). */
export function planRules(raw: PotRow): Rules {
  return rulesFromIndexer({
    instantMax: raw.instantMax ?? "0",
    oneApprovalMax: raw.oneApprovalMax ?? "0",
    highTier: raw.highTier ?? "MAJORITY",
    memberDailyCap: raw.memberDailyCap ?? "0",
    memberTotalCap: raw.memberTotalCap ?? "0",
    payeePolicy: raw.payeePolicy ?? "ANYONE",
    minContribution: raw.minContribution ?? "0",
    proposalTtl: raw.proposalTtl ?? "0",
    ruleTimelock: raw.ruleTimelock ?? "0",
    categoryBudgets: raw.categoryBudgets,
  });
}

/** Active members in plan order (lowercase). */
export function activeMembers(plan: PlanVM): string[] {
  return plan.raw.members.filter((m) => m.status === "Active").map((m) => lc(m.address));
}

/** Decrypts a spend note or dispute note (null when empty or unreadable). */
export function useMemoText(plan: PlanVM | null | undefined, memoHex: string | undefined, kind: "memo" | "dispute"): Memo | null {
  return useMemo(() => {
    if (!plan || !memoHex || memoHex === "0x") return null;
    try {
      return decodeMemo(plan.gk ?? undefined, plan.pot, kind, fromHex(memoHex));
    } catch {
      return null;
    }
  }, [plan, memoHex, kind]);
}

export function memoText(plan: PlanVM, memoHex: string | undefined, kind: "memo" | "dispute" = "memo"): string | null {
  if (!memoHex || memoHex === "0x") return null;
  try {
    return decodeMemo(plan.gk ?? undefined, plan.pot, kind, fromHex(memoHex))?.text || null;
  } catch {
    return null;
  }
}

export type PhotoState = { status: "none" | "loading" | "ready" | "missing" | "locked"; dataUri?: string };

/**
 * Receipt photo: the ciphertext comes from this phone's blob store or the relayer, must hash to
 * the receiptHash committed onchain, and is opened with the group key.
 */
export function useReceiptPhoto(plan: PlanVM | null | undefined, receiptHash?: string | null): PhotoState {
  const has = !!receiptHash && !ZERO_HASH.test(receiptHash);
  const q = useQuery({
    queryKey: ["receiptPhoto", plan?.pot ?? "", lc(receiptHash ?? "")],
    enabled: !!plan && has && !!plan.gk,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: 1,
    queryFn: async (): Promise<string | null> => {
      const h = lc(receiptHash!);
      let ct = blobRead(h);
      if (!ct) {
        const b = await getBlob(h);
        if (b) {
          ct = fromBase64Url(b);
          if (lc(toHex(sha256(ct))) !== h) return null;
          try {
            blobWrite(h, ct);
          } catch {
            /* cache only */
          }
        }
      }
      if (!ct) return null;
      const jpeg = groupDecrypt(plan!.gk!, "receipt", plan!.pot, ct);
      return `data:image/jpeg;base64,${toBase64(jpeg)}`;
    },
  });
  if (!has) return { status: "none" };
  if (!plan?.gk) return { status: "locked" };
  if (q.isLoading) return { status: "loading" };
  if (q.data) return { status: "ready", dataUri: q.data };
  return { status: "missing" };
}

export type PreviewState = { status: "idle" | "loading" | "ok" | "error"; preview?: Preview; key: string; fresh: boolean; retry: () => void };

/** Live rule preview (Pot.previewSpend), debounced ~300 ms; stale answers are dropped. */
export function useRulePreview(input: { pot?: string; me?: string; kind: SpendKind; payee?: string; amount: bigint; category: number; enabled: boolean }): PreviewState {
  const key = `${input.pot}|${input.me}|${input.kind}|${input.payee}|${input.amount}|${input.category}`;
  const [state, setState] = useState<{ status: PreviewState["status"]; preview?: Preview; key: string }>({ status: "idle", key: "" });
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (!input.enabled || !input.pot || !input.me || !input.payee || input.amount <= 0n) {
      setState({ status: "idle", key });
      return;
    }
    const mine = ++seq.current;
    setState((s) => ({ ...s, status: "loading" }));
    const t = setTimeout(() => {
      previewSpend(input.pot as Address, input.me as Address, input.kind, input.payee as Address, input.amount, input.category)
        .then((p) => {
          if (seq.current === mine) setState({ status: "ok", preview: p, key });
        })
        .catch(() => {
          if (seq.current === mine) setState({ status: "error", key });
        });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, input.enabled, nonce]);
  return { ...state, fresh: state.key === key && state.status === "ok", retry: () => setNonce((n) => n + 1) };
}
