/**
 * Relayer keyed slots (relayer/README.md "Keyed slots"): PUT/GET /v1/slots/<64 hex>.
 * The relayer only ever sees ciphertext and ids derived from secrets it doesn't know.
 *
 * Every slot has a revision `rev` (1 on create, +1 per write). A PUT with `ifRev` is a
 * compare-and-set: the relayer refuses it with 409 SLOT_CONFLICT ("conflict", `currentRev`) when the
 * slot changed since it was read (an absent slot is rev 0). Read-modify-write goes through
 * updateSlot() (cas.ts). A relayer from before revisions returns no rev: `rev` is then undefined.
 */
import { config } from "../../config";
import { fetchJson, jsonStringify, NetworkError } from "../api/http";
import { fromBase64Url, toBase64Url } from "../crypto/bytes";

export type SlotErrorKind = "offline" | "taken" | "conflict" | "rate-limited" | "too-large" | "full" | "unavailable" | "failed";

const MESSAGES: Record<SlotErrorKind, string> = {
  offline: "Couldn't reach Plans. Check your connection and try again.",
  taken: "This link was already used.",
  conflict: "This changed on another device at the same moment. Please try again.",
  "rate-limited": "Too many tries from this network. Please wait a little and try again.",
  "too-large": "That was too large to send.",
  full: "Plans can't store this right now. Please try again later.",
  unavailable: "Linking isn't available on this server yet.",
  failed: "Something went wrong. Please try again.",
};

export class SlotError extends Error {
  constructor(
    public kind: SlotErrorKind,
    public status: number,
    public code = "",
    /** "conflict": the slot's current rev, from the relayer. */
    public currentRev?: number,
  ) {
    super(MESSAGES[kind]);
    this.name = "SlotError";
  }
  /** Plain words for the screen. */
  get friendly(): string {
    return MESSAGES[this.kind];
  }
}

type ErrBody = { error?: { code?: string; message?: string; currentRev?: number } };

function slotUrl(id: string): string {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("slot id must be 64 lowercase hex");
  return `${config.relayerUrl}/v1/slots/${id}`;
}

function classify(status: number, code: string, body?: ErrBody): SlotError {
  if (code === "SLOT_CONFLICT") {
    const cur = body?.error?.currentRev;
    return new SlotError("conflict", status, code, typeof cur === "number" && Number.isSafeInteger(cur) ? cur : undefined);
  }
  if (status === 409 || code === "SLOT_TAKEN") return new SlotError("taken", status, code);
  if (status === 429) return new SlotError("rate-limited", status, code);
  if (status === 413) return new SlotError("too-large", status, code);
  if (status === 507) return new SlotError("full", status, code);
  if (code === "SLOTS_DISABLED" || (status === 404 && code !== "NOT_FOUND")) return new SlotError("unavailable", status, code);
  if (status >= 500) return new SlotError("offline", status, code);
  return new SlotError("failed", status, code);
}

async function call<T>(url: string, init: RequestInit & { timeoutMs?: number }) {
  try {
    return await fetchJson<T & ErrBody>(url, init);
  } catch (e) {
    if (e instanceof NetworkError) throw new SlotError("offline", 0, "NETWORK");
    throw e;
  }
}

const revOf = (x: unknown): number | undefined => (typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : undefined);

export type PutSlotOptions = { ttl?: number; auth?: string; ifRev?: number };

/**
 * Writes `bytes` to slot `id`. `ttl` (60–600 s) makes it temporary; without it the slot is
 * permanent. A slot is write-once unless it was created with `auth` (64 hex) and the same `auth`
 * is sent again. `ifRev` makes it a compare-and-set (0 = only if absent). Throws SlotError
 * ("taken" on 409 SLOT_TAKEN, "conflict" on 409 SLOT_CONFLICT). `rev` is the new revision.
 */
export async function putSlot(id: string, bytes: Uint8Array, opts: PutSlotOptions = {}): Promise<{ created: boolean; expiresAt: number | null; rev?: number }> {
  const r = await call<{ created?: boolean; expiresAt?: number | null; rev?: number }>(slotUrl(id), {
    method: "PUT",
    body: jsonStringify({ data: toBase64Url(bytes), ttl: opts.ttl, auth: opts.auth, ifRev: opts.ifRev }),
    timeoutMs: 20_000,
  });
  if (r.status !== 200 && r.status !== 201) throw classify(r.status, r.body?.error?.code ?? "", r.body);
  return { created: r.status === 201, expiresAt: r.body?.expiresAt ?? null, rev: revOf(r.body?.rev) };
}

/** Reads slot `id` with its revision: null when it doesn't exist or expired (404). Throws SlotError otherwise. */
export async function getSlotRev(id: string): Promise<{ data: Uint8Array; rev?: number } | null> {
  const r = await call<{ data?: string; rev?: number }>(slotUrl(id), { method: "GET", timeoutMs: 15_000, cache: "no-store" });
  if (r.status === 404 && (r.body?.error?.code ?? "NOT_FOUND") === "NOT_FOUND") return null;
  if (r.status !== 200) throw classify(r.status, r.body?.error?.code ?? "", r.body);
  if (typeof r.body?.data !== "string") throw new SlotError("failed", r.status, "BAD_RESPONSE");
  try {
    return { data: fromBase64Url(r.body.data), rev: revOf(r.body.rev) };
  } catch {
    throw new SlotError("failed", r.status, "BAD_RESPONSE");
  }
}

/** Reads slot `id`: the bytes, or null when it doesn't exist or expired (404). Throws SlotError otherwise. */
export async function getSlot(id: string): Promise<Uint8Array | null> {
  return (await getSlotRev(id))?.data ?? null;
}
