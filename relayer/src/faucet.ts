/**
 * Testnet faucet: keeps lane 0 topped up from the public testnet AUSD faucet (10,000 AUSD per call,
 * once per 60 s) and forwards a small amount to the caller. Hard-disabled on mainnet.
 */
import { encodeFunctionData, type Address, type PublicClient } from "viem";
import { ausdAbi, faucetAbi } from "./abi.js";
import { RelayError } from "./errors.js";
import type { LanePool } from "./lanes.js";
import { log, shortErr } from "./log.js";
import type { Relayer } from "./relay.js";
import type { Store } from "./store.js";

export interface FaucetOptions {
  enabled: boolean;
  isMainnet: boolean;
  address?: Address; // the public faucet contract
  ausd?: Address;
  amount: bigint;
  perAddressPerDay: number;
  perIpPerDay: number;
  /** All drips across everyone per UTC day: protects the lanes' AUSD if the per-network limit is beaten. */
  totalPerDay: number;
}

export class Faucet {
  #lastRefill = 0;
  #busy: Promise<unknown> = Promise.resolve();

  constructor(
    readonly opts: FaucetOptions,
    readonly client: PublicClient,
    readonly relayer: Relayer,
    readonly pool: LanePool,
    readonly store: Store,
  ) {}

  get enabled() {
    return this.opts.enabled && !this.opts.isMainnet && !!this.opts.ausd;
  }

  async balanceOf(a: Address): Promise<bigint> {
    return (await this.client.readContract({ address: this.opts.ausd!, abi: ausdAbi, functionName: "balanceOf", args: [a] })) as bigint;
  }

  /** Ask the public faucet to fund `to` (rate-limited by the faucet to once per 60 s per caller). */
  async requestFromFaucet(to: Address) {
    if (!this.opts.address) throw new RelayError(503, "FAUCET_NOT_CONFIGURED", "No faucet contract configured.");
    const data = encodeFunctionData({ abi: faucetAbi, functionName: "requestFunds", args: [to] });
    return this.relayer.sendInternal("faucetRequest", this.opts.address, data, this.pool.lanes[0]);
  }

  async drip(address: Address, ip: string) {
    if (!this.enabled) throw new RelayError(404, "FAUCET_DISABLED", "The faucet is only available on testnet.");
    const addrKey = `faucet:addr:${address.toLowerCase()}`;
    const ipKey = `faucet:ip:${ip}`;
    const totalKey = "faucet:total";
    if (!this.store.takeDaily(addrKey, this.opts.perAddressPerDay)) {
      throw new RelayError(429, "FAUCET_LIMIT", "This address already got test dollars today. Try again tomorrow.");
    }
    // A venue's Wi-Fi puts a whole group behind one address, so the per-network limit is generous and
    // has its own code: the app must never tell a brand-new account "come back tomorrow" because of it.
    if (!this.store.takeDaily(ipKey, this.opts.perIpPerDay)) {
      this.store.refundDaily(addrKey);
      throw new RelayError(429, "FAUCET_NETWORK_LIMIT", "Many people on this network got test dollars today.");
    }
    if (!this.store.takeDaily(totalKey, this.opts.totalPerDay)) {
      this.store.refundDaily(addrKey);
      this.store.refundDaily(ipKey);
      throw new RelayError(429, "FAUCET_DAILY_CAP", "Today's test dollars have all been given out.");
    }
    // Serialise drips: they all spend from lane 0's AUSD.
    const run = async () => {
      const lane0 = this.pool.lanes[0].address;
      let refillTxHash: string | undefined;
      let bal = await this.balanceOf(lane0);
      if (bal < this.opts.amount * 2n && this.opts.address && Date.now() - this.#lastRefill > 61_000) {
        this.#lastRefill = Date.now();
        try {
          refillTxHash = (await this.requestFromFaucet(lane0)).txHash;
          bal = await this.balanceOf(lane0);
        } catch (e) {
          log.warn("faucet refill failed", { error: shortErr(e) });
        }
      }
      if (bal < this.opts.amount) throw new RelayError(503, "FAUCET_EMPTY", "The faucet is refilling. Please try again in a minute.");
      const data = encodeFunctionData({ abi: ausdAbi, functionName: "transfer", args: [address, this.opts.amount] });
      const res = await this.relayer.sendInternal("ausdTransfer", this.opts.ausd!, data, this.pool.lanes[0]);
      return { ...res, amount: this.opts.amount.toString(), to: address, refillTxHash };
    };
    const p = this.#busy.then(run, run);
    this.#busy = p.catch(() => undefined);
    try {
      return await p;
    } catch (e) {
      this.store.refundDaily(addrKey);
      this.store.refundDaily(ipKey);
      this.store.refundDaily(totalKey);
      throw e;
    }
  }
}
