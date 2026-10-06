/** Read-only calls to Monad over HTTP (viem). Writes always go through the relayer. */
import { createPublicClient, defineChain, http, type Address, type Hex, type PublicClient } from "viem";
import { config } from "../../config";
import { ausdAbi, keyRegistryAbi, potAbi } from "./abi";
import { SpendKind } from "./eip712";

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
