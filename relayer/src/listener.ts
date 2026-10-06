/**
 * Event listener. Logs are matched by topic (every Plans event signature) rather than by address,
 * so pots created after startup are covered without resubscribing; logs are then kept only if they
 * come from the factory, a pot the factory created, ClaimEscrow or PlansSend.
 *
 * Sources, all deduplicated by (txHash, logIndex) and applied idempotently:
 *  - backfill from a start block in <=100-block eth_getLogs chunks (public RPC limit)
 *  - a websocket `logs` subscription for low latency (when WS_URL is set)
 *  - a polling loop that advances a persisted cursor and fills any gap the websocket missed
 *  - receipts of transactions this relayer sent (instant)
 */
import { formatLog, getAddress, hexToString, parseEventLogs, toEventSelector, type AbiEvent, type Address, type Hex, type Log, type PublicClient } from "viem";
import { claimEscrowAbi, factoryAbi, plansSendAbi, potAbi } from "./abi.js";
import { log, shortErr } from "./log.js";
import type { Contracts } from "./relay.js";
import type { Store } from "./store.js";

export const LISTENER_EVENTS = [
  ...potAbi.filter((x) => x.type === "event"),
  ...factoryAbi.filter((x) => x.type === "event"),
  ...claimEscrowAbi.filter((x) => x.type === "event"),
  ...plansSendAbi.filter((x) => x.type === "event"),
] as AbiEvent[];

const POT_EVENT_NAMES = new Set(potAbi.filter((x) => x.type === "event").map((x) => (x as AbiEvent).name));
const TOPICS = LISTENER_EVENTS.map((e) => toEventSelector(e));

export interface ChainEvent {
  name: string;
  address: Address;
  args: Record<string, any>;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
  /** false while backfilling history: state only, no notifications */
  live: boolean;
}

export type EventHandler = (e: ChainEvent) => void | Promise<void>;

export interface ListenerOptions {
  startBlock?: bigint;
  chunk: number;
  pollMs: number;
}

export function bytes2ToCode(h: Hex | string): string {
  try {
    return hexToString(h as Hex).replace(/\0/g, "");
  } catch {
    return "";
  }
}

export class Listener {
  readonly handlers: EventHandler[] = [];
  #seen = new Map<string, true>();
  #cursor: bigint | null = null;
  #head: bigint | null = null;
  #caughtUp = false;
  #stopped = false;
  #timer: NodeJS.Timeout | null = null;
  #unwatch: (() => void) | null = null;
  #lastPollAt = 0;
  #lastWsAt = 0;
  #queue: Promise<void> = Promise.resolve();
  #errors = 0;

  constructor(
    readonly client: PublicClient,
    readonly ws: PublicClient | undefined,
    readonly store: Store,
    readonly contracts: Contracts,
    readonly opts: ListenerOptions,
  ) {}

  on(h: EventHandler) {
    this.handlers.push(h);
  }

  status() {
    return {
      cursor: this.#cursor?.toString() ?? null,
      head: this.#head?.toString() ?? null,
      caughtUp: this.#caughtUp,
      websocket: !!this.#unwatch,
      lastPollAt: this.#lastPollAt ? new Date(this.#lastPollAt).toISOString() : null,
      lastWsLogAt: this.#lastWsAt ? new Date(this.#lastWsAt).toISOString() : null,
      knownPots: this.store.listPots().length,
      errors: this.#errors,
    };
  }

  get caughtUp() {
    return this.#caughtUp;
  }

  async start() {
    const head = await this.client.getBlockNumber();
    this.#head = head;
    const saved = this.store.getKv("cursor");
    let from: bigint;
    if (saved !== undefined) from = BigInt(saved) + 1n;
    else if (this.opts.startBlock !== undefined) from = this.opts.startBlock;
    else {
      log.warn("START_BLOCK not set and no saved cursor: listening from the current head only");
      from = head;
    }
    if (this.opts.startBlock !== undefined && from < this.opts.startBlock) from = this.opts.startBlock;
    this.#cursor = from - 1n;
    this.#subscribe();
    await this.#catchUp(false);
    this.#caughtUp = true;
    log.info("listener caught up", { cursor: this.#cursor?.toString(), pots: this.store.listPots().length });
    this.#schedule();
  }

  stop() {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#unwatch?.();
    this.#unwatch = null;
  }

  #schedule() {
    if (this.#stopped) return;
    this.#timer = setTimeout(async () => {
      try {
        await this.#catchUp(true);
      } catch (e) {
        this.#errors++;
        log.warn("listener poll failed", { error: shortErr(e) });
      }
      this.#schedule();
    }, this.opts.pollMs);
  }

  /** Fetch [cursor+1, head] in chunks and ingest in order. */
  async #catchUp(live: boolean) {
    const head = await this.client.getBlockNumber();
    this.#head = head;
    this.#lastPollAt = Date.now();
    let from = (this.#cursor ?? head - 1n) + 1n;
    const total = head - from + 1n;
    let done = 0n;
    while (from <= head && !this.#stopped) {
      const to = from + BigInt(this.opts.chunk) - 1n > head ? head : from + BigInt(this.opts.chunk) - 1n;
      const logs = await this.client.request({
        method: "eth_getLogs",
        params: [{ fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [TOPICS] }],
      });
      await this.ingest((logs as unknown as Parameters<typeof formatLog>[0][]).map((l) => formatLog(l)) as Log[], live);
      this.#cursor = to;
      this.store.setKv("cursor", to.toString());
      done += to - from + 1n;
      if (!live && total > 5000n && done % 10_000n < BigInt(this.opts.chunk)) {
        log.info("backfill progress", { block: to.toString(), head: head.toString() });
      }
      from = to + 1n;
    }
  }

  #subscribe() {
    if (!this.ws) return;
    try {
      const watch = this.ws.watchEvent.bind(this.ws) as (x: unknown) => () => void;
      this.#unwatch = watch({
        events: LISTENER_EVENTS,
        poll: false,
        onLogs: (logs: Log[]) => {
          this.#lastWsAt = Date.now();
          void this.ingest(logs as unknown as Log[], this.#caughtUp);
        },
        onError: (e: unknown) => {
          this.#errors++;
          log.warn("websocket subscription error (polling continues)", { error: shortErr(e) });
        },
      });
    } catch (e) {
      log.warn("websocket subscribe failed; polling only", { error: shortErr(e) });
    }
  }

  /** Decode, filter, dedupe and apply logs in (block, logIndex) order. Serialised. */
  ingest(logs: Log[], live: boolean): Promise<void> {
    const run = async () => {
      const decoded = parseEventLogs({ abi: LISTENER_EVENTS, logs, strict: true })
        .filter((l) => l.blockNumber !== null && l.logIndex !== null && l.transactionHash)
        .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex! - b.logIndex! : a.blockNumber! < b.blockNumber! ? -1 : 1));
      for (const l of decoded) {
        const key = `${l.transactionHash}:${l.logIndex}`;
        if (this.#seen.has(key)) continue;
        const ev: ChainEvent = {
          name: l.eventName,
          address: getAddress(l.address),
          args: l.args as Record<string, any>,
          blockNumber: l.blockNumber!,
          logIndex: l.logIndex!,
          txHash: l.transactionHash!,
          live,
        };
        if (!this.#accept(ev)) continue;
        this.#seen.set(key, true);
        if (this.#seen.size > 50_000) {
          const first = this.#seen.keys().next().value;
          if (first) this.#seen.delete(first);
        }
        try {
          this.apply(ev);
        } catch (e) {
          this.#errors++;
          log.warn("apply event failed", { event: ev.name, error: shortErr(e) });
        }
        for (const h of this.handlers) {
          try {
            await h(ev);
          } catch (e) {
            log.warn("event handler failed", { event: ev.name, error: shortErr(e) });
          }
        }
      }
    };
    this.#queue = this.#queue.then(run, run);
    return this.#queue;
  }

  #accept(ev: ChainEvent): boolean {
    const eq = (x?: Address) => !!x && x.toLowerCase() === ev.address.toLowerCase();
    if (ev.name === "PotCreated") return eq(this.contracts.factory);
    if (ev.name === "ClaimCreated" || ev.name === "Claimed" || ev.name === "ClaimRefunded") return eq(this.contracts.claimEscrow);
    if (ev.name === "Sent") return eq(this.contracts.plansSend);
    if (POT_EVENT_NAMES.has(ev.name)) return this.store.hasPot(ev.address);
    return false;
  }

  /** Update local state from one accepted event. Idempotent. */
  apply(ev: ChainEvent) {
    const s = this.store;
    const a = ev.args;
    const pot = ev.address;
    switch (ev.name) {
      case "PotCreated":
        s.upsertPot({
          address: a.pot,
          creator: a.creator,
          startTime: Number(a.startTime),
          endTime: Number(a.endTime),
          reviewWindow: Number(a.reviewWindow),
          createdBlock: Number(ev.blockNumber),
        });
        break;
      case "MemberJoined":
        s.upsertMember(pot, a.member, bytes2ToCode(a.country), Number(a.memberIndex));
        break;
      case "MemberExited":
        s.setMemberInactive(pot, a.member);
        break;
      case "SpendProposed":
        s.insertProposal({
          pot,
          id: a.id,
          proposer: a.proposer,
          kind: Number(a.kind),
          payee: a.payee,
          amount: a.amount,
          category: Number(a.category),
          splitMembers: a.splitMembers,
          approvalsRequired: Number(a.approvalsRequired),
          expiresAt: Number(a.expiresAt),
          status: "pending",
          createdAt: Math.floor(Date.now() / 1000),
        });
        break;
      case "Voted":
        s.addVote(pot, a.id, a.member, a.approve);
        break;
      case "SpendApproved":
        s.setProposalStatus(pot, a.id, "approved");
        break;
      case "SpendExecuted":
        s.setProposalStatus(pot, a.id, "executed");
        break;
      case "SpendCancelled":
        s.setProposalStatus(pot, a.id, "cancelled");
        break;
      case "Acked":
        s.bumpAckEpoch(pot, Number(a.ackEpoch));
        s.setMemberAck(pot, a.member, Number(a.ackEpoch));
        break;
      case "AcksReset":
        s.bumpAckEpoch(pot, Number(a.newAckEpoch));
        break;
      case "Frozen":
        s.setFrozenUntil(pot, Number(a.until));
        break;
      case "Unfrozen":
        s.setFrozenUntil(pot, 0);
        break;
      case "Settled":
        s.setSettled(pot);
        break;
      case "ClaimCreated":
        s.insertClaim({ id: a.id, source: a.source, claimSigner: a.claimSigner, amount: a.amount, sourceSpendId: a.sourceSpendId });
        break;
    }
  }
}
