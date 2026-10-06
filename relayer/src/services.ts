/** Wires every component from a Config. Used by the server entrypoint and the integration tests. */
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createApp, type AppServices } from "./app.js";
import { BlobStore } from "./blobs.js";
import { makePublicClient, makeWsClient } from "./chain.js";
import type { Config } from "./config.js";
import { DemoService } from "./demo/demo.js";
import { Faucet } from "./faucet.js";
import { FxService } from "./fx.js";
import { LanePool } from "./lanes.js";
import { Listener } from "./listener.js";
import { log, setLogLevel, shortErr } from "./log.js";
import { LongStop } from "./longstop.js";
import { PushDispatcher } from "./push.js";
import { Relayer } from "./relay.js";
import { Store } from "./store.js";

export interface Services extends AppServices {
  listener?: Listener;
  start(): Promise<void>;
  stop(): Promise<void>;
  app: ReturnType<typeof createApp>;
}

export async function buildServices(cfg: Config, opts: { fetchImpl?: typeof fetch; dbPath?: string; blobDir?: string } = {}): Promise<Services> {
  setLogLevel(cfg.logLevel);
  const client = makePublicClient(cfg);
  const ws = cfg.listener.enabled ? makeWsClient(cfg) : undefined;
  const store = new Store(opts.dbPath ?? join(cfg.dataDir, `relayer-${cfg.chainId}.sqlite`));
  const pool = new LanePool(client, cfg.relayerKeys, {
    chainId: cfg.chainId,
    priorityFeeWei: cfg.gas.priorityFeeWei,
    maxFeeWei: cfg.gas.maxFeeWei,
    minBalanceWei: cfg.gas.laneMinBalanceWei,
  });
  const relayer = new Relayer(client, pool, { ...cfg.contracts }, { marginBps: cfg.gas.marginBps, marginFixed: cfg.gas.marginFixed, caps: cfg.gas.caps }, store);

  const fxSigner = privateKeyToAccount((cfg.fx.signerKey ?? cfg.relayerKeys[0]).reveal());
  const fx = new FxService({ url: cfg.fx.url, cacheMs: cfg.fx.cacheMs }, fxSigner, opts.fetchImpl ?? fetch);

  const faucet = new Faucet(
    {
      enabled: cfg.faucet.enabled,
      isMainnet: cfg.isMainnet,
      address: cfg.faucet.address,
      ausd: cfg.contracts.ausd,
      amount: cfg.faucet.amount,
      perAddressPerDay: cfg.faucet.perAddressPerDay,
      perIpPerDay: cfg.faucet.perIpPerDay,
    },
    client,
    relayer,
    pool,
    store,
  );

  const demo = new DemoService({ cfg: cfg.demo, chainId: cfg.chainId, isTestnet: !cfg.isMainnet, store, relayer, client, faucet });
  const push = new PushDispatcher(store, cfg.push, demo.demoSet, opts.fetchImpl ?? fetch);
  const listener = cfg.listener.enabled
    ? new Listener(client, ws, store, relayer.contracts, { startBlock: cfg.listener.startBlock, chunk: cfg.listener.chunk, pollMs: cfg.listener.pollMs })
    : undefined;
  const longStop = new LongStop(store, relayer, client, cfg.longStop);
  const blobs = new BlobStore({ dir: opts.blobDir ?? cfg.blobs.dir, maxBytes: cfg.blobs.maxBytes, diskCapBytes: cfg.blobs.diskCapBytes });

  if (listener) {
    listener.on(push.handle);
    listener.on(demo.handle);
    // Feed our own receipts straight in: state and notifications without waiting for a poll.
    relayer.onReceipt = (logs) => void listener.ingest(logs, listener.caughtUp);
  }

  const services: Services = {
    cfg,
    client,
    pool,
    relayer,
    store,
    fx,
    push,
    listener,
    faucet,
    demo,
    longStop,
    blobs,
    version: "0.1.0",
    app: undefined as never,
    async start() {
      await pool.init();
      await relayer.init();
      faucet.opts.ausd ??= relayer.contracts.ausd;
      if (listener) {
        listener.start().catch((e) => log.error("listener failed to start", { error: shortErr(e) }));
      }
      demo.start();
      longStop.start();
    },
    async stop() {
      listener?.stop();
      demo.stop();
      longStop.stop();
      await push.flush().catch(() => undefined);
      store.close();
    },
  };
  services.app = createApp(services);
  return services;
}
