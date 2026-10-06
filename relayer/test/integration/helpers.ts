import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

export const CONTRACTS_OUT = resolve(import.meta.dirname, "../../../contracts/out");

export const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
] as const;

const REQUIRED = ["MockAUSD", "KeyRegistry", "PlansFactory", "PlansSend", "Pot", "ClaimEscrow"];

export function artifactsAvailable(): { ok: boolean; missing: string[] } {
  const missing = REQUIRED.filter((n) => !existsSync(join(CONTRACTS_OUT, `${n}.sol`, `${n}.json`)));
  return { ok: missing.length === 0, missing };
}

export function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const j = JSON.parse(readFileSync(join(CONTRACTS_OUT, `${name}.sol`, `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
    s.on("error", rej);
  });
}

export async function startAnvil(): Promise<{ url: string; ws: string; proc: ChildProcess; stop: () => void }> {
  const port = await freePort();
  // Pot's runtime is ~29 KB; Monad allows 128 KB contracts, anvil defaults to 24 KB.
  const proc = spawn("anvil", ["--port", String(port), "--silent", "--code-size-limit", "131072", "--chain-id", "31337"], { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  const client = createPublicClient({ chain: foundry, transport: http(url) });
  for (let i = 0; i < 100; i++) {
    try {
      await client.getChainId();
      return { url, ws: `ws://127.0.0.1:${port}`, proc, stop: () => proc.kill("SIGKILL") };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  proc.kill("SIGKILL");
  throw new Error("anvil did not start");
}

export async function deployAll(url: string) {
  const deployer = privateKeyToAccount(ANVIL_KEYS[0]);
  const wallet = createWalletClient({ chain: foundry, transport: http(url), account: deployer });
  const pub = createPublicClient({ chain: foundry, transport: http(url) });
  const deploy = async (name: string, args: unknown[] = []) => {
    const a = artifact(name);
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args } as never);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (!r.contractAddress || r.status !== "success") throw new Error(`deploy ${name} failed`);
    return r.contractAddress as Address;
  };
  const ausd = await deploy("MockAUSD");
  const keyRegistry = await deploy("KeyRegistry");
  const factory = await deploy("PlansFactory", [ausd, keyRegistry]);
  const plansSend = await deploy("PlansSend", [ausd]);
  const mint = async (to: Address, amount: bigint) => {
    const hash = await wallet.writeContract({ address: ausd, abi: artifact("MockAUSD").abi, functionName: "mint", args: [to, amount] } as never);
    await pub.waitForTransactionReceipt({ hash });
  };
  return { ausd, keyRegistry, factory, plansSend, mint, pub, wallet };
}

export async function waitFor<T>(fn: () => T | Promise<T>, what: string, timeoutMs = 20_000, everyMs = 100): Promise<NonNullable<T>> {
  const t0 = Date.now();
  let last: unknown;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v as NonNullable<T>;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ""}`);
}
