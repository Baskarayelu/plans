import Constants from "expo-constants";
import type { Address } from "viem";

export type PlansConfig = {
  network: "testnet" | "mainnet";
  chainId: number;
  rpId: string;
  linkHost: string;
  relayerUrl: string;
  graphqlUrl: string;
  rpcUrl: string;
  wsUrl: string;
  explorerTx: string;
  contracts: {
    ausd: Address;
    keyRegistry: Address;
    plansSend: Address;
    plansFactory: Address;
    claimEscrow: Address;
  };
  deployed: boolean;
};

const fallback: PlansConfig = {
  network: "testnet",
  chainId: 10143,
  rpId: "plans.0xo.in",
  linkHost: "plans.0xo.in",
  relayerUrl: "https://relayer-testnet.plans.0xo.in",
  graphqlUrl: "https://indexer.plans.0xo.in/v1/graphql",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  wsUrl: "wss://testnet-rpc.monad.xyz",
  explorerTx: "https://testnet.monadvision.com/tx/",
  contracts: {
    ausd: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
    keyRegistry: "0x0000000000000000000000000000000000000000",
    plansSend: "0x0000000000000000000000000000000000000000",
    plansFactory: "0x0000000000000000000000000000000000000000",
    claimEscrow: "0x0000000000000000000000000000000000000000",
  },
  deployed: false,
};

const fromManifest = (Constants.expoConfig?.extra as { plans?: PlansConfig } | undefined)?.plans;

/** Build-time config, plus runtime endpoint overrides set from the hidden Diagnostics screen. */
export const config: PlansConfig = { ...fallback, ...(fromManifest ?? {}) };

export const isTestnet = config.network === "testnet";

export function explorerTxUrl(hash: string): string {
  return `${config.explorerTx}${hash}`;
}

export function applyEndpointOverrides(o: Partial<Pick<PlansConfig, "relayerUrl" | "graphqlUrl" | "rpcUrl" | "wsUrl">>): void {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && v.length > 0) (config as Record<string, unknown>)[k] = v.replace(/\/+$/, "");
  }
}

export const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";
