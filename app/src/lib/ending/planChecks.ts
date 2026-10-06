/**
 * Plan-state checks for the ending screens: who has checked the numbers (37), what is still open
 * (37, 36), and the leave summary (36). Pure functions over the indexer's PlanDetail.
 */
import type { PlanDetail } from "../api/envio";

const lc = (s?: string | null) => (s ?? "").toLowerCase();

type AckPlan = Pick<PlanDetail, "members" | "ackEpoch">;

/** Active members and whether each acked in the current epoch. */
export function ackStatus(p: AckPlan): { address: string; acked: boolean }[] {
  const epoch = p.ackEpoch ?? "0";
  return p.members.filter((m) => m.status === "Active").map((m) => ({ address: lc(m.address), acked: m.lastAckEpoch !== null && m.lastAckEpoch !== undefined && String(m.lastAckEpoch) === String(epoch) }));
}

export function hasAcked(p: AckPlan, me?: string): boolean {
  if (!me) return false;
  return ackStatus(p).some((a) => a.address === lc(me) && a.acked);
}

export type OpenItem = { kind: "spend" | "dispute"; spendId: string; spendEntityId: string; proposer?: string; openedBy?: string; amount?: bigint; category?: number; memo?: string };

/** Pending/Approved spends and open disputes: settle() waits for all of them. */
export function openItems(p: Pick<PlanDetail, "spends" | "disputes" | "recent">): OpenItem[] {
  const out: OpenItem[] = [];
  for (const s of p.spends) {
    if (s.status && s.status !== "Pending" && s.status !== "Approved") continue;
    out.push({ kind: "spend", spendId: s.spendId, spendEntityId: s.id, proposer: lc(s.proposer_id), amount: BigInt(s.amount), category: s.category, memo: s.memo });
  }
  for (const d of p.disputes) {
    if (d.status && d.status !== "Open") continue;
    if (!d.status && d.resolvedAt) continue;
    const s = p.recent.find((r) => lc(r.id) === lc(d.spend_id));
    const spendId = s?.spendId ?? d.spend_id.split("-").pop() ?? "";
    out.push({ kind: "dispute", spendId, spendEntityId: d.spend_id, proposer: s ? lc(s.proposer_id) : undefined, openedBy: lc(d.openedBy_id), amount: s ? BigInt(s.amount) : undefined, category: s?.category, memo: s?.memo });
  }
  return out;
}

/** exit() is blocked while I proposed an open spend or opened / am the subject of an open dispute. */
export function leaveBlockers(p: Pick<PlanDetail, "spends" | "disputes" | "recent">, me?: string): OpenItem[] {
  if (!me) return [];
  const m = lc(me);
  return openItems(p).filter((i) => (i.kind === "spend" ? i.proposer === m : i.openedBy === m || i.proposer === m));
}

export type LeaveSummary = { contributed: bigint; personalPaid: bigint; share: bigint; withdrawn: bigint; net: bigint };

export function leaveSummary(m: { contributed: string; personalPaid: string; share: string; withdrawn: string; net: string }): LeaveSummary {
  return { contributed: BigInt(m.contributed), personalPaid: BigInt(m.personalPaid), share: BigInt(m.share), withdrawn: BigInt(m.withdrawn), net: BigInt(m.net) };
}
