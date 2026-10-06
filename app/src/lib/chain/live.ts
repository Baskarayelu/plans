/**
 * Live feed: a native WebSocket to Monad (wss://rpc.monad.xyz / wss://testnet-rpc.monad.xyz)
 * subscribed to every Plans event topic. It first asks for `monadLogs` (logs from proposed blocks,
 * ~0.4 s sooner) and falls back to `logs`. If the socket can't be used, it polls eth_getLogs.
 * Each decoded event is delivered to listeners, which invalidate queries and drive toasts.
 */
import { decodeEventLog, toEventSelector, type Abi, type Hex, type Log } from "viem";
import { config } from "../../config";
import { createStore } from "../state/observable";
import { claimEscrowAbi, factoryAbi, keyRegistryAbi, plansSendAbi, potAbi } from "./abi";
import { rpc } from "./rpc";

export type LiveEvent = { name: string; address: string; args: Record<string, unknown>; txHash?: string; blockNumber?: bigint; speculative: boolean; at: number };

const ABI = [
  ...potAbi.filter((x) => x.type === "event"),
  ...factoryAbi.filter((x) => x.type === "event"),
  ...keyRegistryAbi.filter((x) => x.type === "event"),
  ...claimEscrowAbi.filter((x) => x.type === "event"),
  ...plansSendAbi.filter((x) => x.type === "event"),
] as unknown as Abi;

const TOPICS: Hex[] = Array.from(new Set(ABI.filter((x) => x.type === "event").map((e) => toEventSelector(e as never))));

export const liveStatus = createStore<{ state: "off" | "connecting" | "live" | "polling" | "offline"; method?: string; lastEventAt?: number }>({ state: "off" });

type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();
export function onLiveEvent(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const seen = new Map<string, number>();
function emit(log: Log, speculative: boolean) {
  const key = `${log.transactionHash}-${log.logIndex}-${String((log.topics as unknown as string[] | undefined)?.[0])}`;
  if (seen.has(key)) return;
  seen.set(key, Date.now());
  if (seen.size > 2000) {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, t] of seen) if (t < cutoff) seen.delete(k);
  }
  try {
    const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    const ev: LiveEvent = {
      name: String(d.eventName),
      address: (log.address ?? "").toLowerCase(),
      args: (d.args ?? {}) as Record<string, unknown>,
      txHash: log.transactionHash ?? undefined,
      blockNumber: log.blockNumber ?? undefined,
      speculative,
      at: Date.now(),
    };
    liveStatus.patch({ lastEventAt: ev.at });
    for (const l of listeners) l(ev);
  } catch {
    /* not ours */
  }
}

let ws: WebSocket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let retry = 0;
let stopped = true;
let lastPolled: bigint | null = null;

function startPolling() {
  if (pollTimer) return;
  liveStatus.patch({ state: "polling", method: "eth_getLogs" });
  pollTimer = setInterval(async () => {
    try {
      const head = await rpc().getBlockNumber();
      const from = lastPolled === null ? head - 5n : lastPolled + 1n;
      if (from > head) return;
      const to = head - from > 99n ? from + 99n : head;
      const logs = await rpc().request({
        method: "eth_getLogs",
        params: [{ fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [TOPICS] }],
      } as never);
      lastPolled = to;
      for (const l of logs as unknown as Log[]) emit({ ...l, blockNumber: l.blockNumber ? BigInt(l.blockNumber) : null } as Log, false);
      if (liveStatus.get().state === "offline") liveStatus.patch({ state: ws ? "live" : "polling" });
    } catch {
      liveStatus.patch({ state: "offline" });
    }
  }, 2000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function connect() {
  if (stopped) return;
  liveStatus.patch({ state: "connecting" });
  let socket: WebSocket;
  try {
    socket = new WebSocket(config.wsUrl);
  } catch {
    startPolling();
    return;
  }
  ws = socket;
  let subId: string | null = null;
  let triedMonad = false;
  const subscribe = (kind: "monadLogs" | "logs") =>
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: kind === "monadLogs" ? 1 : 2, method: "eth_subscribe", params: [kind, { topics: [TOPICS] }] }));
  socket.onopen = () => {
    retry = 0;
    triedMonad = true;
    subscribe("monadLogs");
  };
  socket.onmessage = (m) => {
    let msg: { id?: number; result?: unknown; error?: unknown; method?: string; params?: { subscription: string; result: Log & { commitState?: string } } };
    try {
      msg = JSON.parse(String(m.data));
    } catch {
      return;
    }
    if (msg.id === 1) {
      if (msg.error || typeof msg.result !== "string") subscribe("logs");
      else {
        subId = msg.result;
        liveStatus.patch({ state: "live", method: "monadLogs" });
        stopPolling();
      }
      return;
    }
    if (msg.id === 2) {
      if (typeof msg.result === "string") {
        subId = msg.result;
        liveStatus.patch({ state: "live", method: "logs" });
        stopPolling();
      } else startPolling();
      return;
    }
    if (msg.method === "eth_subscription" && msg.params?.subscription === subId) {
      const r = msg.params.result;
      if ((r as { removed?: boolean }).removed) return;
      emit({ ...r, blockNumber: r.blockNumber ? BigInt(r.blockNumber as unknown as string) : null } as Log, liveStatus.get().method === "monadLogs");
    }
  };
  socket.onerror = () => {
    /* onclose follows */
  };
  socket.onclose = () => {
    ws = null;
    if (stopped) return;
    void triedMonad;
    startPolling();
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 1000 * 2 ** retry);
  };
}

export function startLive(): void {
  if (!stopped) return;
  stopped = false;
  connect();
}

export function stopLive(): void {
  stopped = true;
  stopPolling();
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  ws = null;
  liveStatus.patch({ state: "off" });
}
