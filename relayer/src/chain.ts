import { createPublicClient, defineChain, fallback, http, webSocket, type Chain, type PublicClient } from "viem";
import type { Config } from "./config.js";

export function chainFor(cfg: Pick<Config, "chainId" | "chainName" | "rpcUrls" | "wsUrl">): Chain {
  return defineChain({
    id: cfg.chainId,
    name: cfg.chainName,
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: cfg.rpcUrls, webSocket: cfg.wsUrl ? [cfg.wsUrl] : undefined } },
  });
}

export function makePublicClient(cfg: Pick<Config, "chainId" | "chainName" | "rpcUrls" | "wsUrl">): PublicClient {
  const chain = chainFor(cfg);
  const transports = cfg.rpcUrls.map((u) => http(u, { timeout: 15_000, retryCount: 1, batch: false }));
  return createPublicClient({
    chain,
    transport: transports.length === 1 ? transports[0] : fallback(transports, { rank: false }),
    pollingInterval: 250,
  }) as PublicClient;
}

export function makeWsClient(cfg: Pick<Config, "chainId" | "chainName" | "rpcUrls" | "wsUrl">): PublicClient | undefined {
  if (!cfg.wsUrl) return undefined;
  return createPublicClient({
    chain: chainFor(cfg),
    transport: webSocket(cfg.wsUrl, { reconnect: { attempts: 1_000_000, delay: 2_000 }, keepAlive: { interval: 20_000 } }),
  }) as PublicClient;
}
