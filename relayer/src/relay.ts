/**
 * The relay pipeline: validate → allowlist → simulate (eth_call) → estimate → tight gas limit →
 * send on a key lane (eth_sendRawTransactionSync) → decoded receipt.
 */
import type { Address, Hex, Log, PublicClient, TransactionReceipt } from "viem";
import { factoryAbi } from "./abi.js";
import { prepareAction, type PreparedAction } from "./actions.js";
import { decodeRevert, extractRevertData, RelayError } from "./errors.js";
import { decodeReceiptLogs, type DecodedEvent } from "./events.js";
import { gasLimitFor, type GasPolicy } from "./gas.js";
import type { Lane, LanePool } from "./lanes.js";
import { log, shortErr } from "./log.js";
import type { Store } from "./store.js";

export interface Contracts {
  factory?: Address;
  keyRegistry?: Address;
  claimEscrow?: Address;
  plansSend?: Address;
  ausd?: Address;
}

export interface RelayResult {
  action: string;
  txHash: Hex;
  blockNumber: string;
  status: "success" | "reverted";
  gasUsed: string;
  gasLimit: string;
  latencyMs: number;
  totalMs: number;
  lane: number;
  sync: boolean;
  events: DecodedEvent[];
  error?: { code: string; message: string };
}

export interface RelayContext {
  ip?: string;
  /** set for relayer-originated calls (demo, long-stop); skips HTTP rate limits only */
  source?: "http" | "demo" | "longstop" | "faucet" | "test";
}

export class Relayer {
  #isPotCache = new Map<Address, { ok: boolean; at: number }>();
  onReceipt?: (logs: Log[], receipt: TransactionReceipt) => void;

  constructor(
    readonly client: PublicClient,
    readonly pool: LanePool,
    readonly contracts: Contracts,
    readonly gas: GasPolicy,
    readonly store?: Store,
  ) {}

  /** Fill in KeyRegistry / ClaimEscrow / AUSD from the factory when not configured. */
  async init() {
    const f = this.contracts.factory;
    if (!f) {
      log.warn("FACTORY_ADDRESS not set: pot and createPot actions are disabled");
      return;
    }
    const read = async (fn: "keyRegistry" | "claimEscrow" | "ausd") => {
      try {
        return (await this.client.readContract({ address: f, abi: factoryAbi, functionName: fn })) as Address;
      } catch (e) {
        log.warn(`factory.${fn}() unavailable`, { error: shortErr(e) });
        return undefined;
      }
    };
    this.contracts.keyRegistry ??= await read("keyRegistry");
    this.contracts.claimEscrow ??= await read("claimEscrow");
    this.contracts.ausd ??= await read("ausd");
  }

  async isPot(pot: Address): Promise<boolean> {
    if (this.store?.hasPot(pot)) return true;
    const c = this.#isPotCache.get(pot);
    if (c && (c.ok || Date.now() - c.at < 15_000)) return c.ok;
    const f = this.contracts.factory;
    if (!f) return false;
    let ok = false;
    try {
      ok = (await this.client.readContract({ address: f, abi: factoryAbi, functionName: "isPot", args: [pot] })) as boolean;
    } catch (e) {
      throw new RelayError(503, "RPC_UNAVAILABLE", "Couldn't reach the network to check this plan. Please try again.", { detail: shortErr(e) });
    }
    this.#isPotCache.set(pot, { ok, at: Date.now() });
    return ok;
  }

  /** The allowlist: only Plans contracts and factory-registered pots. */
  async resolveTarget(prep: PreparedAction): Promise<Address> {
    const need = (a: Address | undefined, name: string) => {
      if (!a) throw new RelayError(503, "NOT_CONFIGURED", `${name} address is not configured on this relayer.`);
      return a;
    };
    switch (prep.target) {
      case "factory":
        return need(this.contracts.factory, "PlansFactory");
      case "keyRegistry":
        return need(this.contracts.keyRegistry, "KeyRegistry");
      case "claimEscrow":
        return need(this.contracts.claimEscrow, "ClaimEscrow");
      case "plansSend":
        return need(this.contracts.plansSend, "PlansSend");
      case "pot": {
        need(this.contracts.factory, "PlansFactory");
        if (!prep.pot || !(await this.isPot(prep.pot))) {
          throw new RelayError(403, "TARGET_NOT_ALLOWED", "That address isn't a Plans pot.", { pot: prep.pot });
        }
        return prep.pot;
      }
    }
  }

  /** eth_call then estimateGas, both from the sending lane. Throws a decoded RelayError on revert. */
  async simulate(to: Address, data: Hex, from: Address): Promise<bigint> {
    const fail = (e: unknown): never => {
      const revert = extractRevertData(e);
      const msg = shortErr(e);
      if (!revert && /(fetch failed|timed? ?out|ECONN|socket|network|429|503|502)/i.test(msg)) {
        throw new RelayError(503, "RPC_UNAVAILABLE", "Couldn't reach the network. Please try again.", { detail: msg });
      }
      const d = decodeRevert(revert);
      throw new RelayError(422, d.code, d.message, {
        error: d.error,
        ...(d.reason !== undefined ? { reason: d.reason } : {}),
        ...(d.args ? { args: d.args.map((x) => (typeof x === "bigint" ? x.toString() : x)) } : {}),
        ...(d.data ? { revertData: d.data } : {}),
        ...(d.error === "Unknown" && !revert ? { detail: msg } : {}),
      });
    };
    try {
      await this.client.call({ account: from, to, data });
    } catch (e) {
      fail(e);
    }
    try {
      return await this.client.estimateGas({ account: from, to, data });
    } catch (e) {
      return fail(e);
    }
  }

  /** Validate and relay an {action, params} body. */
  async relay(body: unknown, _ctx: RelayContext = {}): Promise<RelayResult> {
    const prep = prepareAction(body);
    return this.relayPrepared(prep);
  }

  async relayPrepared(prep: PreparedAction): Promise<RelayResult> {
    const t0 = performance.now();
    if (prep.deadline !== undefined && prep.deadline !== 0n && prep.deadline < BigInt(Math.floor(Date.now() / 1000))) {
      throw new RelayError(422, "EXPIRED", "This request has expired. Please try again.");
    }
    const to = await this.resolveTarget(prep);
    return this.#send(prep.action, to, prep.data, t0);
  }

  /** Relayer-originated call to an internal target (AUSD transfer, faucet). Not reachable over HTTP. */
  async sendInternal(action: string, to: Address, data: Hex, lane?: Lane): Promise<RelayResult> {
    return this.#send(action, to, data, performance.now(), lane);
  }

  async #send(action: string, to: Address, data: Hex, t0: number, fixedLane?: Lane): Promise<RelayResult> {
    const lane = fixedLane ?? this.pool.pick();
    const estimate = await this.simulate(to, data, lane.address);
    const gas = gasLimitFor(action, estimate, this.gas);
    const res = await this.pool.submit(lane, { to, data, gas });
    const { receipt } = res;
    try {
      this.onReceipt?.(receipt.logs as Log[], receipt);
    } catch (e) {
      log.warn("receipt hook failed", { error: shortErr(e) });
    }
    const out: RelayResult = {
      action,
      txHash: res.txHash,
      blockNumber: receipt.blockNumber.toString(),
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      gasLimit: gas.toString(),
      latencyMs: res.latencyMs,
      totalMs: Math.round(performance.now() - t0),
      lane: res.lane,
      sync: res.sync,
      events: decodeReceiptLogs(receipt.logs as Log[]),
    };
    if (receipt.status !== "success") {
      out.error = { code: "REVERTED_ONCHAIN", message: "The transaction was included but failed: the plan changed since it was checked." };
    }
    log.info("relayed", { action, txHash: res.txHash, status: receipt.status, gasUsed: out.gasUsed, gasLimit: out.gasLimit, latencyMs: res.latencyMs, lane: res.lane });
    return out;
  }
}
