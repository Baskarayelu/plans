// Small pure helpers shared by all handlers.

export const DAY_SECONDS = 86_400;

export const CATEGORY_NAMES = [
  "Stay",
  "Travel",
  "Getting around",
  "Food & drink",
  "Tickets & activities",
  "Groceries",
  "Shopping",
  "Other",
] as const;

export const HIGH_TIERS = ["MAJORITY", "ALL"] as const;
export const PAYEE_POLICIES = ["ANYONE", "MEMBERS_ONLY", "MEMBERS_AND_ALLOWLIST"] as const;
export const SPEND_KINDS = ["PAY", "LINK", "PERSONAL"] as const;
export const DISPUTE_OUTCOMES = ["None", "Keep", "Resplit", "SpenderCovers"] as const;

/** Maximum members per pot (protocol MAX_MEMBERS); histogram arrays have MAX_MEMBERS + 1 slots. */
export const MAX_MEMBERS = 50;

/** Lower bounds (seconds) of the time-to-first-funded-action histogram buckets. */
export const TTFFA_BUCKETS = [0, 10, 30, 60, 120, 300, 900, 3_600, 21_600, 86_400, 259_200, 604_800];

export type Meta = {
  ts: number;
  block: number;
  logIndex: number;
  tx: string;
  chainId: number;
  /** unique per event: "<block>-<logIndex>" */
  eventId: string;
  day: number;
};

export function metaOf(event: {
  block: { number: number; timestamp: number };
  transaction: { hash: string };
  logIndex: number;
  chainId: number;
}): Meta {
  const ts = Number(event.block.timestamp);
  return {
    ts,
    block: event.block.number,
    logIndex: event.logIndex,
    tx: event.transaction.hash,
    chainId: event.chainId,
    eventId: `${event.block.number}-${event.logIndex}`,
    day: dayOf(ts),
  };
}

export const lc = (a: string): string => a.toLowerCase();
export const dayOf = (ts: number): number => Math.floor(ts / DAY_SECONDS);
export const dateOf = (day: number): string => new Date(day * DAY_SECONDS * 1000).toISOString().slice(0, 10);

export const memberId = (pot: string, member: string): string => `${lc(pot)}-${lc(member)}`;
export const spendEntityId = (pot: string, spendId: bigint): string => `${lc(pot)}-${spendId.toString()}`;
export const disputeEntityId = (pot: string, id: bigint): string => `${lc(pot)}-d${id.toString()}`;
export const ruleChangeEntityId = (pot: string, id: bigint): string => `${lc(pot)}-r${id.toString()}`;
export const rulesVersionId = (pot: string, v: bigint): string => `${lc(pot)}-v${v.toString()}`;
export const categoryId = (pot: string, c: number): string => `${lc(pot)}-c${c}`;
export const claimEntityId = (escrow: string, id: bigint): string => `${lc(escrow)}-${id.toString()}`;

/**
 * Decodes a fixed-size ASCII code (bytes2 country, bytes3 currency) from its hex form.
 * Returns undefined for all-zero (absent) values; non-printable values are returned as hex.
 */
export function decodeCode(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length === 0 || /^0*$/.test(h)) return undefined;
  let out = "";
  for (let i = 0; i < h.length; i += 2) {
    const c = parseInt(h.slice(i, i + 2), 16);
    if (c === 0) continue;
    if (c < 0x20 || c > 0x7e) return `0x${h}`;
    out += String.fromCharCode(c);
  }
  return out.length ? out.toUpperCase() : undefined;
}

export const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);
export const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);
export const sumBig = (xs: readonly bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);

export function netOf(m: { contributed: bigint; personalPaid: bigint; share: bigint; withdrawn: bigint }): bigint {
  return m.contributed + m.personalPaid - m.share - m.withdrawn;
}

/** Median of a value histogram (index = value). Even counts average the two middle values. */
export function medianFromHistogram(hist: readonly number[]): number {
  const n = hist.reduce((a, b) => a + b, 0);
  if (n <= 0) return 0;
  const valueAt = (k: number): number => {
    let seen = 0;
    for (let v = 0; v < hist.length; v++) {
      seen += hist[v] ?? 0;
      if (seen > k) return v;
    }
    return hist.length - 1;
  };
  if (n % 2 === 1) return valueAt((n - 1) / 2);
  return (valueAt(n / 2 - 1) + valueAt(n / 2)) / 2;
}

/** Lower-median bucket index of a bucket histogram. */
export function medianBucket(hist: readonly number[]): number {
  const n = hist.reduce((a, b) => a + b, 0);
  if (n <= 0) return -1;
  const k = Math.floor((n - 1) / 2);
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i] ?? 0;
    if (seen > k) return i;
  }
  return hist.length - 1;
}

export function ttffaBucketOf(seconds: number): number {
  let b = 0;
  for (let i = 0; i < TTFFA_BUCKETS.length; i++) if (seconds >= (TTFFA_BUCKETS[i] ?? 0)) b = i;
  return b;
}

export const clampIndex = (i: number, max: number): number => Math.max(0, Math.min(max, i));
