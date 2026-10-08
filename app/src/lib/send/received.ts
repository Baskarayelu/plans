/**
 * Reads a received send from the public record: the PlansSend.send call carries the receipt
 * fields (countries, currencies, reference rate, time) and, in `salt`, the sender's private note
 * (name, city, note) sealed to my key.
 */
import { decodeFunctionData, type Address, type Hex } from "viem";
import { config } from "../../config";
import { fetchJson } from "../api/http";
import { plansSendAbi } from "../chain/abi";
import { bytesToCode } from "../chain/eip712";
import { registeredKey, rpc } from "../chain/rpc";
import { fromHex } from "../crypto/bytes";
import { decodeSendNote, type SendNote } from "../crypto/seal";
import { rememberContact } from "../domain/groups";
import { currentKeys } from "../identity/session";

export type ReceivedSend = {
  tx: Hex;
  from: Address;
  to: Address;
  amount: bigint;
  fromCountry?: string;
  toCountry?: string;
  fromCurrency: string;
  toCurrency: string;
  rateE8: bigint;
  fxTimestamp: number;
  /** the reference round the sender named; 0n = none */
  fxRoundId: bigint;
  /** block time, unix seconds */
  at?: number;
  note: SendNote | null;
};

export async function readReceivedSend(tx: Hex, me?: string): Promise<ReceivedSend> {
  const t = await rpc().getTransaction({ hash: tx });
  const d = decodeFunctionData({ abi: plansSendAbi, data: t.input });
  if (d.functionName !== "send") throw new Error("not a send");
  const [from, meta, auth] = d.args as unknown as [Address, { to: Address; fromCountry: Hex; toCountry: Hex; fromCurrency: Hex; toCurrency: Hex; fxRateE8: bigint; fxTimestamp: bigint; fxRoundId?: bigint; salt: Hex }, { value: bigint }];
  let at: number | undefined;
  if (t.blockNumber !== null && t.blockNumber !== undefined) {
    try {
      at = Number((await rpc().getBlock({ blockNumber: t.blockNumber })).timestamp);
    } catch {
      /* time from elsewhere */
    }
  }
  let note: SendNote | null = null;
  const keys = currentKeys();
  const recipient = (me ?? meta.to).toLowerCase();
  if (keys && recipient === meta.to.toLowerCase()) {
    try {
      const theirKey = await registeredKey(from);
      if (theirKey) note = decodeSendNote(keys.x25519Secret, fromHex(theirKey), from, meta.to, fromHex(meta.salt));
    } catch {
      note = null;
    }
  }
  const fromCountry = bytesToCode(meta.fromCountry);
  const fromCurrency = bytesToCode(meta.fromCurrency) ?? "USD";
  if (note?.name) rememberContact(from, { name: note.name, city: note.city, country: fromCountry, currency: fromCurrency });
  return {
    tx,
    from: from.toLowerCase() as Address,
    to: meta.to.toLowerCase() as Address,
    amount: auth.value,
    fromCountry,
    toCountry: bytesToCode(meta.toCountry),
    fromCurrency,
    toCurrency: bytesToCode(meta.toCurrency) ?? "USD",
    rateE8: meta.fxRateE8,
    fxTimestamp: Number(meta.fxTimestamp),
    fxRoundId: meta.fxRoundId ?? 0n,
    at,
    note,
  };
}

/**
 * The relayer's measured submit → receipt time for a send, when it publishes one. The receiving
 * phone can't measure the sender's side itself; returns null when unavailable.
 */
export async function relayedLatency(tx: string): Promise<number | null> {
  try {
    const r = await fetchJson<{ latencyMs?: number }>(`${config.relayerUrl}/v1/tx/${tx}`, { timeoutMs: 6_000 });
    if (r.status !== 200) return null;
    const ms = r.body?.latencyMs;
    return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? ms : null;
  } catch {
    return null;
  }
}
