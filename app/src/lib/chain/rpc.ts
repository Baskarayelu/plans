/** Read-only calls to Monad over HTTP (viem). Writes always go through the relayer. */
import { createPublicClient, defineChain, http, type Address, type Hex, type PublicClient } from "viem";
import { config } from "../../config";
import { ausdAbi, factoryAbi, fxReferenceAbi, keyRegistryAbi, plansSendAbi, potAbi } from "./abi";
import { bytesToCode, SpendKind, type SendMeta } from "./eip712";

let client: PublicClient | null = null;
let clientUrl = "";

export function chain() {
  return defineChain({
    id: config.chainId,
    name: config.network === "mainnet" ? "Monad" : "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl], webSocket: [config.wsUrl] } },
  });
}

export function rpc(): PublicClient {
  if (!client || clientUrl !== config.rpcUrl) {
    client = createPublicClient({ chain: chain(), transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 1 }) }) as PublicClient;
    clientUrl = config.rpcUrl;
  }
  return client;
}

export async function ausdBalance(account: Address): Promise<bigint> {
  return (await rpc().readContract({ address: config.contracts.ausd, abi: ausdAbi, functionName: "balanceOf", args: [account] })) as bigint;
}

export async function ausdAllowance(owner: Address, spender: Address): Promise<bigint> {
  return (await rpc().readContract({ address: config.contracts.ausd, abi: ausdAbi, functionName: "allowance", args: [owner, spender] })) as bigint;
}

export async function ausdPermitNonce(owner: Address): Promise<bigint> {
  return (await rpc().readContract({ address: config.contracts.ausd, abi: ausdAbi, functionName: "nonces", args: [owner] })) as bigint;
}

export async function registeredKey(account: Address): Promise<Hex | null> {
  if (/^0x0+$/.test(config.contracts.keyRegistry)) return null;
  const k = (await rpc().readContract({ address: config.contracts.keyRegistry, abi: keyRegistryAbi, functionName: "keyOf", args: [account] })) as Hex;
  return /^0x0+$/.test(k) ? null : k;
}

export type Preview = { approvalsRequired: number; ok: boolean; reason: number };

/** Pot.previewSpend via eth_call: what would happen if `proposer` proposed this now. */
export async function previewSpend(pot: Address, proposer: Address, kind: SpendKind, payee: Address, amount: bigint, category: number): Promise<Preview> {
  const [approvalsRequired, ok, reason] = (await rpc().readContract({
    address: pot,
    abi: potAbi,
    functionName: "previewSpend",
    args: [proposer, kind, payee, amount, category],
  })) as [number, boolean, number];
  return { approvalsRequired: Number(approvalsRequired), ok, reason: Number(reason) };
}

export async function isMember(pot: Address, account: Address): Promise<boolean> {
  return (await rpc().readContract({ address: pot, abi: potAbi, functionName: "isMember", args: [account] })) as boolean;
}

export async function canSettle(pot: Address): Promise<boolean> {
  return (await rpc().readContract({ address: pot, abi: potAbi, functionName: "canSettle" })) as boolean;
}

export async function netOf(pot: Address, member: Address): Promise<bigint> {
  return (await rpc().readContract({ address: pot, abi: potAbi, functionName: "netOf", args: [member] })) as bigint;
}

export async function latestBlockTime(): Promise<number> {
  const b = await rpc().getBlock({ blockTag: "latest" });
  return Number(b.timestamp);
}

// ─────────────── FxReference (Chainlink CRE reference rates; read-only) ───────────────

/** A round may be quoted (PlansSend) or labelled (Pot settlement) for 6 h after its scheduled time. */
export const MAX_FX_AGE_SEC = 6 * 3600;

let fxRefCache: { factory: string; address: Address | null } | null = null;

/** The FxReference the contracts use (`PlansFactory.fxReference()`), or null when none is deployed. */
export async function fxReferenceAddress(): Promise<Address | null> {
  const factory = config.contracts.plansFactory;
  if (fxRefCache?.factory === factory) return fxRefCache.address;
  if (/^0x0+$/.test(factory)) return null;
  const a = (await rpc().readContract({ address: factory, abi: factoryAbi, functionName: "fxReference" })) as Address;
  const address = /^0x0+$/.test(a) ? null : a;
  fxRefCache = { factory, address };
  return address;
}

export type FxRound = {
  roundId: bigint;
  scheduledTime: number;
  writtenAt: number;
  /** yyyymmdd */
  rateDate: number;
  sourceMask: number;
  /** USD per 1 unit, 8 decimals, by ISO code; only currencies present in the round. USD is implied (1e8). */
  usdPerUnitE8: Record<string, bigint>;
  sourceMasks: Record<string, number>;
};

type RawRound = {
  roundId: bigint;
  scheduledTime: bigint;
  writtenAt: bigint;
  rateDate: number;
  sourceMask: number;
  currencies: readonly Hex[];
  usdPerUnitE8: readonly bigint[];
  sourceMasks: readonly number[];
};

export function toFxRound(r: RawRound): FxRound | null {
  if (r.roundId === 0n) return null;
  const usdPerUnitE8: Record<string, bigint> = {};
  const sourceMasks: Record<string, number> = {};
  r.currencies.forEach((c, i) => {
    const code = bytesToCode(c);
    const rate = r.usdPerUnitE8[i] ?? 0n;
    if (!code || rate === 0n) return;
    usdPerUnitE8[code] = rate;
    sourceMasks[code] = Number(r.sourceMasks[i] ?? 0);
  });
  return {
    roundId: r.roundId,
    scheduledTime: Number(r.scheduledTime),
    writtenAt: Number(r.writtenAt),
    rateDate: Number(r.rateDate),
    sourceMask: Number(r.sourceMask),
    usdPerUnitE8,
    sourceMasks,
  };
}

/** The latest FxReference round, or null when there is no FxReference or no round yet. */
export async function latestFxRound(fx?: Address): Promise<FxRound | null> {
  const address = fx ?? (await fxReferenceAddress());
  if (!address) return null;
  return toFxRound((await rpc().readContract({ address, abi: fxReferenceAbi, functionName: "latestRound" })) as RawRound);
}

/** True while a round can still be quoted on a send (at most MAX_FX_AGE_SEC after its scheduled time). */
export const isFxRoundFresh = (r: Pick<FxRound, "scheduledTime"> | null, nowSec = Math.floor(Date.now() / 1000)) =>
  !!r && r.scheduledTime > 0 && nowSec <= r.scheduledTime + MAX_FX_AGE_SEC;

/**
 * Reference rate toCurrency per 1 fromCurrency (8 decimals, floored) from a round, computed like
 * PlansSend: usdPer(from) * 1e8 / usdPer(to), with USD = 1e8. null when either side is missing.
 */
export function fxReferenceRateE8(r: FxRound, from: string, to: string): bigint | null {
  const usd = (c: string) => (c === "USD" || c === "AUSD" ? 100_000_000n : r.usdPerUnitE8[c]);
  const f = usd(from);
  const t = usd(to);
  if (!f || !t) return null;
  const v = (f * 100_000_000n) / t;
  return v === 0n ? null : v;
}

/** PlansSend.previewReference: what a send with `meta` would record (reverts like send for a bad round). */
export async function previewSendReference(meta: SendMeta): Promise<{ refRateE8: bigint; diffBps: bigint }> {
  const [refRateE8, diffBps] = (await rpc().readContract({
    address: config.contracts.plansSend,
    abi: plansSendAbi,
    functionName: "previewReference",
    args: [meta as never],
  })) as readonly [bigint, bigint];
  return { refRateE8, diffBps };
}
