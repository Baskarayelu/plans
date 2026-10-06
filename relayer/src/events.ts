import { parseEventLogs, type Log } from "viem";
import { allEventsAbi } from "./abi.js";

/** Convert bigints (and nested arrays/objects) to JSON-safe values. */
export function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = jsonSafe(x);
    return out;
  }
  return v;
}

export interface DecodedEvent {
  address: string;
  name: string;
  logIndex: number | null;
  args: Record<string, unknown>;
}

/** Decode every log we know (Plans contracts + AUSD) from a receipt into JSON-safe events. */
export function decodeReceiptLogs(logs: readonly Log[]): DecodedEvent[] {
  const parsed = parseEventLogs({ abi: allEventsAbi, logs: logs as Log[], strict: false });
  return parsed.map((l) => ({
    address: l.address,
    name: l.eventName,
    logIndex: l.logIndex,
    args: jsonSafe(l.args) as Record<string, unknown>,
  }));
}
