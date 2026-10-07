/**
 * Test environment: a fresh anvil fork of Monad mainnet (chain 143, real AUSD), the five Plans
 * contracts deployed exactly as contracts/script/Deploy.s.sol does (canonical CREATE2 deployer,
 * same salts), actors funded with real AUSD through AUSD's ERC-7201 storage, and the relayer
 * (relayer/dist) started against the fork.
 *
 * Safety: every transaction this module (or the harness) sends goes through `sendLocal`, which
 * refuses unless the RPC is 127.0.0.1 and `web3_clientVersion` says anvil. Gas limits for those
 * sends come from anvil's own eth_estimateGas (+10 %), mirroring contracts/script/monad-send.mjs;
 * nothing is hard-coded. The live Monad RPC is only ever used read-only, by anvil, for forking.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import {
  concatHex,
  createPublicClient,
  defineChain,
  encodeAbiParameters,
  encodeDeployData,
  getContractAddress,
  http,
  keccak256,
  pad,
  stringToHex,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const ROOT = resolve(import.meta.dirname, "../../..");
export const CONTRACTS_OUT = join(ROOT, "contracts/out");
export const RELAYER_DIR = join(ROOT, "relayer");

export const CHAIN_ID = 143;
export const AUSD: Address = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a";
export const CREATE2_DEPLOYER: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
/** AUSD ERC-7201 namespace (contracts/test/fork/ForkLifecycle.t.sol). */
export const AUSD_BALANCES_BASE: Hex = "0x455730fed596673e69db1907be2e521374ba893f1a04cc5f5dd931616cd6b700";
export const AUSD_TOTAL_SUPPLY_SLOT: Hex = "0x455730fed596673e69db1907be2e521374ba893f1a04cc5f5dd931616cd6b702";
/** Same salts as Deploy.s.sol. */
export const SALTS = {
  keyRegistry: keccak256(stringToHex("plans.v1.KeyRegistry")),
  plansSend: keccak256(stringToHex("plans.v1.PlansSend")),
  plansFactory: keccak256(stringToHex("plans.v1.PlansFactory")),
};

export const FORK_URL = process.env.FORK_URL ?? "https://rpc.monad.xyz";

export const monadFork = defineChain({
  id: CHAIN_ID,
  name: "Monad (local anvil fork)",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1"] } },
});

export function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const p = join(CONTRACTS_OUT, `${name}.sol`, `${name}.json`);
  if (!existsSync(p)) throw new Error(`missing artifact ${p}: run forge build in contracts/`);
  const j = JSON.parse(readFileSync(p, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

export async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
    s.on("error", rej);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───────────── anvil ─────────────

export interface Anvil {
  url: string;
  ws: string;
  port: number;
  proc: ChildProcess;
  pub: PublicClient;
  rpc: <T = unknown>(method: string, params?: unknown[]) => Promise<T>;
  forkBlock: bigint;
  stop(): void;
}

export async function startAnvil(logDir: string): Promise<Anvil> {
  const port = await freePort();
  const args = [
    "--fork-url", FORK_URL,
    "--code-size-limit", "131072", // Pot runtime is ~29 KB (Monad allows 128 KB)
    "--port", String(port),
    "--host", "127.0.0.1",
    "--retries", "20",
    "--fork-retry-backoff", "1000",
    "--timeout", "60000",
  ];
  if (process.env.FORK_BLOCK) args.push("--fork-block-number", process.env.FORK_BLOCK);
  const out = createWriteStream(join(logDir, "anvil.log"));
  const proc = spawn("anvil", args, { stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout!.pipe(out);
  proc.stderr!.pipe(out);
  const url = `http://127.0.0.1:${port}`;
  const pub = createPublicClient({ chain: monadFork, transport: http(url, { timeout: 120_000, retryCount: 0 }), pollingInterval: 100 }) as PublicClient;
  let id = 0;
  const rpc = async <T = unknown>(method: string, params: unknown[] = []): Promise<T> => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    const j = (await r.json()) as { result?: T; error?: { message: string; data?: unknown } };
    if (j.error) {
      const e = new Error(`${method}: ${j.error.message}`) as Error & { data?: unknown };
      e.data = j.error.data;
      throw e;
    }
    return j.result as T;
  };
  for (let i = 0; i < 300; i++) {
    if (proc.exitCode !== null) throw new Error(`anvil exited (${proc.exitCode}); see ${join(logDir, "anvil.log")}`);
    try {
      const v = await rpc<string>("web3_clientVersion");
      if (!/anvil/i.test(v)) throw new Error(`not anvil: ${v}`);
      const chainId = Number(await rpc<string>("eth_chainId"));
      if (chainId !== CHAIN_ID) throw new Error(`fork chain id ${chainId}, expected ${CHAIN_ID}`);
      const forkBlock = BigInt(await rpc<string>("eth_blockNumber"));
      return { url, ws: `ws://127.0.0.1:${port}`, port, proc, pub, rpc, forkBlock, stop: () => proc.kill("SIGKILL") };
    } catch (e) {
      if (String(e).includes("not anvil") || String(e).includes("fork chain id")) {
        proc.kill("SIGKILL");
        throw e;
      }
      await sleep(250);
    }
  }
  proc.kill("SIGKILL");
  throw new Error("anvil did not start");
}

/** Refuses unless the node is a local anvil: the only place this harness ever sends a transaction. */
export async function assertLocalAnvil(a: Anvil) {
  const u = new URL(a.url);
  if (u.hostname !== "127.0.0.1") throw new Error(`refusing to send: ${a.url} is not local`);
  const v = await a.rpc<string>("web3_clientVersion");
  if (!/anvil/i.test(v)) throw new Error(`refusing to send: node is ${v}, not anvil`);
}

/**
 * Signs and sends one transaction on the local anvil fork. The gas limit is anvil's eth_estimateGas
 * for this exact transaction + 10 % (as monad-send.mjs does with Monad's estimator), unless the
 * caller passes `gas` explicitly, which only the gas-griefing scenario does (it plays an attacker
 * who picks the limit, found by scanning eth_call, never a constant).
 */
export async function sendLocal(
  a: Anvil,
  from: PrivateKeyAccount,
  tx: { to: Address; data: Hex; value?: bigint; gas?: bigint },
): Promise<{ hash: Hex; status: "success" | "reverted"; gasUsed: bigint; blockNumber: bigint; gasLimit: bigint }> {
  await assertLocalAnvil(a);
  let gas = tx.gas;
  if (gas === undefined) {
    const est = BigInt(await a.rpc<string>("eth_estimateGas", [{ from: from.address, to: tx.to, data: tx.data, value: toHex(tx.value ?? 0n) }, "latest"]));
    gas = (est * 11n + 9n) / 10n;
  }
  const nonce = await a.pub.getTransactionCount({ address: from.address, blockTag: "pending" });
  const block = await a.pub.getBlock({ blockTag: "latest" });
  const base = block.baseFeePerGas ?? 100_000_000_000n;
  const raw = await from.signTransaction({
    chainId: CHAIN_ID,
    type: "eip1559",
    to: tx.to,
    data: tx.data,
    value: tx.value ?? 0n,
    gas,
    nonce,
    maxFeePerGas: base * 2n + 2_000_000_000n,
    maxPriorityFeePerGas: 2_000_000_000n,
  });
  const hash = await a.rpc<Hex>("eth_sendRawTransaction", [raw]);
  const r = await a.pub.waitForTransactionReceipt({ hash, pollingInterval: 50, timeout: 60_000 });
  return { hash, status: r.status, gasUsed: r.gasUsed, blockNumber: r.blockNumber, gasLimit: gas };
}

export async function setMon(a: Anvil, addr: Address, wei: bigint) {
  await a.rpc("anvil_setBalance", [addr, toHex(wei)]);
}

// ───────────── AUSD funding through storage ─────────────

export function ausdBalanceSlot(addr: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [addr, AUSD_BALANCES_BASE]));
}

/** Adds `amount` to `to`'s real AUSD balance (keeping the frozen flag) and to totalSupply, then checks balanceOf. */
export async function fundAusd(a: Anvil, to: Address, amount: bigint, ausdAbi: Abi) {
  const slot = ausdBalanceSlot(to);
  const raw = BigInt(await a.rpc<Hex>("eth_getStorageAt", [AUSD, slot, "latest"]));
  const before = raw >> 8n;
  await a.rpc("anvil_setStorageAt", [AUSD, slot, pad(toHex(((before + amount) << 8n) | (raw & 0xffn)), { size: 32 })]);
  const ts = BigInt(await a.rpc<Hex>("eth_getStorageAt", [AUSD, AUSD_TOTAL_SUPPLY_SLOT, "latest"]));
  await a.rpc("anvil_setStorageAt", [AUSD, AUSD_TOTAL_SUPPLY_SLOT, pad(toHex(ts + amount), { size: 32 })]);
  const bal = (await a.pub.readContract({ address: AUSD, abi: ausdAbi, functionName: "balanceOf", args: [to] })) as bigint;
  if (bal !== before + amount) throw new Error(`AUSD storage layout changed: balanceOf(${to}) = ${bal}, expected ${before + amount}`);
}

/** Sets or clears AUSD's per-account frozen flag (low byte of the packed balance word). */
export async function setAusdFrozen(a: Anvil, who: Address, frozen: boolean) {
  const slot = ausdBalanceSlot(who);
  const raw = BigInt(await a.rpc<Hex>("eth_getStorageAt", [AUSD, slot, "latest"]));
  const next = (raw & ~0xffn) | (frozen ? 1n : 0n);
  await a.rpc("anvil_setStorageAt", [AUSD, slot, pad(toHex(next), { size: 32 })]);
}

// ───────────── deployment (mirrors Deploy.s.sol) ─────────────

export interface Deployment {
  ausd: Address;
  keyRegistry: Address;
  plansSend: Address;
  plansFactory: Address;
  claimEscrow: Address;
  potImplementation: Address;
  deployBlock: bigint;
  txs: { contract: string; hash: Hex; gasUsed: string; gasLimit: string }[];
}

/**
 * Deploys through the canonical CREATE2 deployer with Deploy.s.sol's salts and initcode, so the
 * addresses are the ones the real deployment will have. Doing it here (instead of
 * `forge script --broadcast`) keeps the run from writing contracts/deployments/143-anvil.json or
 * touching contracts/broadcast/Deploy.s.sol/143, which the mainnet `check`/`send` flow reads.
 */
export async function deployPlans(a: Anvil): Promise<Deployment> {
  const deployer = privateKeyToAccount(generatePrivateKey());
  await setMon(a, deployer.address, 100n * 10n ** 18n);
  const code = await a.pub.getCode({ address: CREATE2_DEPLOYER });
  if (!code || code === "0x") throw new Error("canonical CREATE2 deployer missing on the fork");

  const kr = artifact("KeyRegistry");
  const ps = artifact("PlansSend");
  const pf = artifact("PlansFactory");
  const initKR = kr.bytecode;
  const initPS = encodeDeployData({ abi: ps.abi, bytecode: ps.bytecode, args: [AUSD] });
  const predict = (salt: Hex, init: Hex) => getContractAddress({ opcode: "CREATE2", from: CREATE2_DEPLOYER, salt, bytecode: init });
  const keyRegistry = predict(SALTS.keyRegistry, initKR);
  const initPF = encodeDeployData({ abi: pf.abi, bytecode: pf.bytecode, args: [AUSD, keyRegistry] });
  const plansSend = predict(SALTS.plansSend, initPS);
  const plansFactory = predict(SALTS.plansFactory, initPF);

  const txs: Deployment["txs"] = [];
  for (const [name, salt, init, addr] of [
    ["KeyRegistry", SALTS.keyRegistry, initKR, keyRegistry],
    ["PlansSend", SALTS.plansSend, initPS, plansSend],
    ["PlansFactory", SALTS.plansFactory, initPF, plansFactory],
  ] as const) {
    const existing = await a.pub.getCode({ address: addr });
    if (existing && existing !== "0x") {
      txs.push({ contract: name, hash: "0x" as Hex, gasUsed: "0", gasLimit: "0 (already on Monad mainnet; skipped)" });
      continue;
    }
    const r = await sendLocal(a, deployer, { to: CREATE2_DEPLOYER, data: concatHex([salt, init]) });
    if (r.status !== "success") throw new Error(`deploy ${name} reverted`);
    const c = await a.pub.getCode({ address: addr });
    if (!c || c === "0x") throw new Error(`deploy ${name}: no code at predicted ${addr}`);
    txs.push({ contract: name, hash: r.hash, gasUsed: r.gasUsed.toString(), gasLimit: r.gasLimit.toString() });
  }
  const read = (fn: string) => a.pub.readContract({ address: plansFactory, abi: pf.abi, functionName: fn }) as Promise<Address>;
  const claimEscrow = await read("claimEscrow");
  const potImplementation = await read("potImplementation");
  if (claimEscrow !== getContractAddress({ from: plansFactory, nonce: 1n })) throw new Error("claimEscrow not at factory nonce 1");
  if (potImplementation !== getContractAddress({ from: plansFactory, nonce: 2n })) throw new Error("Pot implementation not at factory nonce 2");
  if ((await read("ausd")).toLowerCase() !== AUSD.toLowerCase()) throw new Error("factory.ausd() mismatch");
  if ((await read("keyRegistry")).toLowerCase() !== keyRegistry.toLowerCase()) throw new Error("factory.keyRegistry() mismatch");
  const deployBlock = await a.pub.getBlockNumber();
  return { ausd: AUSD, keyRegistry, plansSend, plansFactory, claimEscrow, potImplementation, deployBlock, txs };
}

// ───────────── mock FX source (frankfurter.app shape), so /v1/fx is deterministic and offline ─────────────

export const FX_TABLE: Record<string, Record<string, number>> = {
  GBP: { USD: 1.27, EUR: 1.17, INR: 106.5 },
  USD: { GBP: 0.7874, EUR: 0.92, INR: 83.86 },
  EUR: { USD: 1.087, GBP: 0.855 },
};
export const FX_DATE = "2026-10-06";

export async function startFxMock(): Promise<{ url: string; server: Server; hits: number }> {
  const port = await freePort();
  const state = { url: `http://127.0.0.1:${port}/latest`, server: undefined as unknown as Server, hits: 0 };
  state.server = createHttpServer((req, res) => {
    state.hits++;
    const u = new URL(req.url ?? "/", "http://x");
    const from = (u.searchParams.get("from") ?? "").toUpperCase();
    const rates = FX_TABLE[from];
    if (!rates) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "not found" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ amount: 1, base: from, date: FX_DATE, rates }));
  });
  await new Promise<void>((r) => state.server.listen(port, "127.0.0.1", () => r()));
  return state;
}

// ───────────── relayer process ─────────────

export interface RelayerProc {
  url: string;
  proc: ChildProcess;
  lanes: PrivateKeyAccount[];
  dataDir: string;
  stop(): Promise<void>;
}

export async function startRelayer(opts: {
  name: string;
  anvil: Anvil;
  dep: Deployment;
  runDir: string;
  fxUrl: string;
  env: Record<string, string>;
  lanes?: number;
}): Promise<RelayerProc> {
  const port = await freePort();
  const dataDir = join(opts.runDir, `relayer-${opts.name}-data`);
  mkdirSync(dataDir, { recursive: true });
  // Throwaway lane keys for this run only. They live in this process and the relayer's env; never printed.
  const laneKeys = Array.from({ length: opts.lanes ?? 3 }, () => generatePrivateKey());
  const lanes = laneKeys.map((k) => privateKeyToAccount(k));
  for (const l of lanes) await setMon(opts.anvil, l.address, 1_000n * 10n ** 18n);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NODE_ENV: "production",
    PORT: String(port),
    HOST: "127.0.0.1",
    LOG_LEVEL: "info",
    CHAIN_ID: String(CHAIN_ID),
    RPC_URL: opts.anvil.url,
    WS_URL: opts.anvil.ws,
    FACTORY_ADDRESS: opts.dep.plansFactory,
    PLANS_SEND_ADDRESS: opts.dep.plansSend,
    KEY_REGISTRY_ADDRESS: opts.dep.keyRegistry,
    CLAIM_ESCROW_ADDRESS: opts.dep.claimEscrow,
    AUSD_ADDRESS: opts.dep.ausd,
    RELAYER_KEYS: laneKeys.join(","),
    DATA_DIR: dataDir,
    START_BLOCK: opts.dep.deployBlock.toString(),
    POLL_INTERVAL_MS: "500",
    PUSH_ENABLED: "false",
    FAUCET_ENABLED: "false",
    LONGSTOP_ENABLED: "false",
    FX_URL: opts.fxUrl,
    CORS_ORIGINS: "http://localhost",
    ...opts.env,
  };
  const out = createWriteStream(join(opts.runDir, `relayer-${opts.name}.log`));
  const proc = spawn(process.execPath, ["dist/index.js"], { cwd: RELAYER_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout!.pipe(out);
  proc.stderr!.pipe(out);
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    proc,
    lanes,
    dataDir,
    async stop() {
      if (proc.exitCode === null) {
        proc.kill("SIGTERM");
        for (let i = 0; i < 40 && proc.exitCode === null; i++) await sleep(50);
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }
    },
  };
}
