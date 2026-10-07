/**
 * Relayer keyed slots (relayer/README.md "Keyed slots"): PUT/GET /v1/slots/<64 hex>.
 * The relayer only ever sees ciphertext and ids derived from secrets it doesn't know.
 */
import { config } from "../../config";
import { fetchJson, jsonStringify, NetworkError } from "../api/http";
import { fromBase64Url, toBase64Url } from "../crypto/bytes";

export type SlotErrorKind = "offline" | "taken" | "rate-limited" | "too-large" | "full" | "unavailable" | "failed";

const MESSAGES: Record<SlotErrorKind, string> = {
  offline: "Couldn't reach Plans. Check your connection and try again.",
  taken: "This link was already used.",
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
  ) {
    super(MESSAGES[kind]);
    this.name = "SlotError";
  }
  /** Plain words for the screen. */
  get friendly(): string {
    return MESSAGES[this.kind];
  }
}

type ErrBody = { error?: { code?: string; message?: string } };

function slotUrl(id: string): string {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("slot id must be 64 lowercase hex");
  return `${config.relayerUrl}/v1/slots/${id}`;
}

function classify(status: number, code: string): SlotError {
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

/**
 * Writes `bytes` to slot `id`. `ttl` (60–600 s) makes it temporary; without it the slot is
 * permanent. A slot is write-once unless it was created with `auth` (64 hex) and the same `auth`
 * is sent again. Throws SlotError ("taken" on 409).
 */
export async function putSlot(id: string, bytes: Uint8Array, opts: { ttl?: number; auth?: string } = {}): Promise<{ created: boolean; expiresAt: number | null }> {
  const r = await call<{ created?: boolean; expiresAt?: number | null }>(slotUrl(id), {
    method: "PUT",
    body: jsonStringify({ data: toBase64Url(bytes), ttl: opts.ttl, auth: opts.auth }),
    timeoutMs: 20_000,
  });
  if (r.status !== 200 && r.status !== 201) throw classify(r.status, r.body?.error?.code ?? "");
  return { created: r.status === 201, expiresAt: r.body?.expiresAt ?? null };
}

/** Reads slot `id`: the bytes, or null when it doesn't exist or expired (404). Throws SlotError otherwise. */
export async function getSlot(id: string): Promise<Uint8Array | null> {
  const r = await call<{ data?: string }>(slotUrl(id), { method: "GET", timeoutMs: 15_000, cache: "no-store" });
  if (r.status === 404 && (r.body?.error?.code ?? "NOT_FOUND") === "NOT_FOUND") return null;
  if (r.status !== 200) throw classify(r.status, r.body?.error?.code ?? "");
  if (typeof r.body?.data !== "string") throw new SlotError("failed", r.status, "BAD_RESPONSE");
  try {
    return fromBase64Url(r.body.data);
  } catch {
    throw new SlotError("failed", r.status, "BAD_RESPONSE");
  }
}
