/**
 * Long-stop: settle pots nobody settled. When now > endTime + reviewWindow + grace (30 days) and the
 * pot is unsettled and canSettle() is true, call settle(). Anyone may; the relayer does it so money
 * never sits in an abandoned plan.
 */
import type { Address, PublicClient } from "viem";
import { potAbi } from "./abi.js";
import { log, shortErr } from "./log.js";
import type { Relayer } from "./relay.js";
import type { PotRow, Store } from "./store.js";

export function longStopDue(p: PotRow, nowSec: number, graceDays: number): boolean {
  return !p.settled && nowSec > p.endTime + p.reviewWindow + graceDays * 86_400;
}

export class LongStop {
  #timer: NodeJS.Timeout | null = null;
  #running = false;
  lastRunAt: number | null = null;
  settledCount = 0;

  constructor(
    readonly store: Store,
    readonly relayer: Relayer,
    readonly client: PublicClient,
    readonly opts: { enabled: boolean; intervalMs: number; graceDays: number },
  ) {}

  start() {
    if (!this.opts.enabled) return;
    const loop = async () => {
      await this.runOnce().catch((e) => log.warn("long-stop run failed", { error: shortErr(e) }));
      this.#timer = setTimeout(loop, this.opts.intervalMs);
    };
    this.#timer = setTimeout(loop, 30_000);
  }

  stop() {
    if (this.#timer) clearTimeout(this.#timer);
  }

  async runOnce(nowSec = Math.floor(Date.now() / 1000)): Promise<Address[]> {
    if (this.#running) return [];
    this.#running = true;
    const done: Address[] = [];
    try {
      for (const p of this.store.listPots({ unsettled: true })) {
        if (!longStopDue(p, nowSec, this.opts.graceDays)) continue;
        try {
          const settled = (await this.client.readContract({ address: p.address, abi: potAbi, functionName: "settled" })) as boolean;
          if (settled) {
            this.store.setSettled(p.address);
            continue;
          }
          const can = (await this.client.readContract({ address: p.address, abi: potAbi, functionName: "canSettle" })) as boolean;
          if (!can) continue;
          const r = await this.relayer.relay({ action: "settle", params: { pot: p.address } }, { source: "longstop" });
          if (r.status === "success") {
            this.store.setSettled(p.address);
            this.settledCount++;
            done.push(p.address);
            log.info("long-stop settled pot", { pot: p.address, txHash: r.txHash });
          }
        } catch (e) {
          log.warn("long-stop settle failed", { pot: p.address, error: shortErr(e) });
        }
      }
    } finally {
      this.#running = false;
      this.lastRunAt = Date.now();
    }
    return done;
  }
}
