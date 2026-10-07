/**
 * Static guard: on Monad every gas limit must come from Monad's estimator (eth_estimateGas /
 * eth_simulateV1 on a Monad RPC), never from a constant, a third-party quote or forge's local
 * Ethereum-priced simulation (see ../../../contracts/GAS-LIMITS.md).
 *
 * This scans every source file in relayer/src, contracts/script, contracts/tools and the CRE workflow
 * (cre/fx-workflow/fx-rates, cre/fx-workflow/scripts) for
 *   1. a `gas:` / `gasLimit:` / `gas_limit:` key (object literal, call option, type annotation), and
 *   2. a transaction-sending primitive (signTransaction, sendTransaction, writeContract,
 *      deployContract, eth_send*, forge's startBroadcast/broadcast, --gas-limit flags),
 * and fails on any occurrence that is not in the reviewed allowlist below. Each allowlist entry is
 * the exact (trimmed) source line plus why it is safe. A new send path or a new hard-coded limit
 * therefore fails CI until it is routed through the estimator helper and reviewed here. Stale
 * entries fail too, so the list stays exact.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../../..");
const ROOTS = ["relayer/src", "contracts/script", "contracts/tools", "cre/fx-workflow/fx-rates", "cre/fx-workflow/scripts"];
const EXT = /\.(ts|mts|js|mjs|cjs|sol)$/;

const GAS_KEY = /(^|[^A-Za-z0-9_$\-])["']?(gas|gasLimit|gas_limit)["']?\s*:(?!:)/;
const SEND = /\b(signTransaction|sendTransaction|sendRawTransaction|writeContract|deployContract|eth_sendTransaction|eth_sendRawTransaction|eth_sendRawTransactionSync|startBroadcast|broadcast)\b|--gas-limit|--gas-estimate-multiplier/;

type Allowed = { file: string; line: string; why: string };

const ALLOWED: Allowed[] = [
  // ── relayer/src: the one send path ──
  { file: "relayer/src/lanes.ts", line: "async submit(lane: Lane, tx: { to: Address; data: Hex; gas: MonadGasLimit; value?: bigint }): Promise<SubmitResult> {", why: "the only signer: accepts nothing but a MonadGasLimit and assertMonadGas() checks it before signing" },
  { file: "relayer/src/lanes.ts", line: "const raw = await lane.account.signTransaction({", why: "signs with gasLimit = tx.gas.value after assertMonadGas()" },
  { file: "relayer/src/lanes.ts", line: "gas: gasLimit,", why: "gasLimit = tx.gas.value, a MonadGasLimit verified for this lane/to/data/value on this RPC" },
  { file: "relayer/src/lanes.ts", line: '{ method: "eth_sendRawTransactionSync" as never, params: [raw] as never },', why: "broadcasts the raw tx signed above" },
  { file: "relayer/src/lanes.ts", line: 'log.warn("eth_sendRawTransactionSync unsupported by RPC; falling back", { error: info.message.slice(0, 200) });', why: "log text" },
  { file: "relayer/src/lanes.ts", line: 'await this.client.request({ method: "eth_sendRawTransaction", params: [raw] }, { retryCount: 0 });', why: "fallback broadcast of the same raw tx" },
  // ── relayer/src: not transaction gas limits ──
  { file: "relayer/src/relay.ts", line: "gasLimit: string;", why: "RelayResult field (reporting the limit that was sent)" },
  { file: "relayer/src/relay.ts", line: "readonly gas: GasPolicy,", why: "margin/cap policy handed to MonadGasEstimator; not a limit" },
  { file: "relayer/src/relay.ts", line: "gasLimit: gas.value.toString(),", why: "reports the MonadGasLimit that was sent" },
  { file: "relayer/src/relay.ts", line: 'log.info("relayed", { action, txHash: res.txHash, status: receipt.status, gasUsed: out.gasUsed, gasLimit: out.gasLimit, latencyMs: res.latencyMs, lane: res.lane });', why: "log field" },
  { file: "relayer/src/config.ts", line: "gas: {", why: "config group: margins, estimate caps and fees; no limit" },
  { file: "relayer/src/gas.ts", line: "export function assertMonadGas(gas: unknown, rpc: GasRpc, tx: GasRequest): asserts gas is MonadGasLimit {", why: "the guard itself" },
  { file: "relayer/src/gas.ts", line: "export function maxCost(gasLimit: bigint, maxFeePerGas: bigint) {", why: "cost arithmetic on a limit; produces no limit" },
  // ── contracts/script/monad-send.mjs: the deploy sender ──
  { file: "contracts/script/monad-send.mjs", line: "const quote = Object.freeze({ estimate, gasLimit: gasLimitFromEstimate(estimate), tx: Object.freeze({ ...tx, value: BigInt(tx.value ?? 0) }) });", why: "monadGasQuote(): the limit is Monad eth_estimateGas + 10%" },
  { file: "contracts/script/monad-send.mjs", line: "const raw = await account.signTransaction({", why: "signWithMonadGas(): refuses quotes not issued by monadGasQuote for this exact tx" },
  { file: "contracts/script/monad-send.mjs", line: "gas: quote.gasLimit,", why: "the Monad quote's limit, checked against the issued set" },
  { file: "contracts/script/monad-send.mjs", line: "const SEND = new Set(['eth_sendRawTransaction', 'eth_sendRawTransactionSync']);", why: "marks send methods as never-retried" },
  { file: "contracts/script/monad-send.mjs", line: "export const planPath = (chainId) => path.join(CONTRACTS, 'broadcast', 'Deploy.s.sol', String(chainId), 'dry-run', 'run-latest.json');", why: "path of forge's dry-run output (the word 'broadcast')" },
  { file: "contracts/script/monad-send.mjs", line: "return { receipt: await rpc('eth_sendRawTransactionSync', [raw]), hash, sync: true };", why: "broadcasts the raw tx signed by signWithMonadGas" },
  { file: "contracts/script/monad-send.mjs", line: "await rpc('eth_sendRawTransaction', [raw]);", why: "fallback broadcast of the same raw tx" },
  { file: "contracts/script/monad-send.mjs", line: "sent.push({ contract: t.name, address: t.predicted, hash, blockNumber: Number(BigInt(receipt.blockNumber)), estimate: quote.estimate.toString(), gasLimit: quote.gasLimit.toString(), gasUsed: BigInt(receipt.gasUsed).toString() });", why: "record written to deployments/<chainid>.json" },
  { file: "contracts/script/monad-send.mjs", line: "if (!existsSync(file)) throw new Error(`no dry run at ${file}: run Deploy.s.sol without --broadcast first`);", why: "error text" },
  // ── contracts/script/Deploy.s.sol: dry run only ──
  { file: "contracts/script/Deploy.s.sol", line: "vm.startBroadcast();", why: "declares the deployment transactions for the dry run; run() reverts BroadcastNotAllowed on --broadcast unless the RPC is a local anvil, and monad-send.mjs re-estimates each tx on Monad (forge's gas field is ignored)" },
  // ── contracts/script/monad-gas.mjs: measurement on a LOCAL anvil fork; live calls are read-only ──
  { file: "contracts/script/monad-gas.mjs", line: "const hash = await anvil('eth_sendTransaction', [{ ...req, gas: hex(gas) }]);", why: "LOCAL anvil only (assertLocalAnvil), to record Ethereum traces for the model; never a Monad tx" },
  { file: "contracts/script/monad-gas.mjs", line: "const rec = { label, group, table, note, hash, from: RELAYER.address, to, data, gasLimit: gas, ethEstimate, gasUsed: BigInt(receipt.gasUsed), receipt };", why: "measurement record of the anvil tx" },
  { file: "contracts/script/monad-gas.mjs", line: "const block = { stateOverrides: ov, calls: gases.map((g) => ({ ...base, gas: hex(g) })) };", why: "eth_simulateV1 search probe on Monad (read-only): this IS the Monad simulation that finds the minimal limit" },
  { file: "contracts/tools/live-check.mjs", line: "console.log(`model min gas == live min gas: ${match.length} / ${checked.length}`);", why: "log text" },
  // ── cre/fx-workflow: the CRE writeReport limit comes only from scripts/gas-limit.mjs (Monad eth_estimateGas + eth_simulateV1 search) ──
  { file: "cre/fx-workflow/fx-rates/main.ts", line: "gasConfig: { gasLimit: cfg.gasLimit },", why: "the writeReport limit: config.gasLimit, which parseConfig refuses unless set, and which only scripts/gas-limit.mjs writes (Monad estimator)" },
  { file: "cre/fx-workflow/fx-rates/src/config.ts", line: "gasLimit: string", why: "type of the config field" },
  { file: "cre/fx-workflow/fx-rates/src/config.ts", line: "gasLimit: c.gasLimit,", why: "passes the validated config value through; no default" },
  { file: "cre/fx-workflow/scripts/gas-limit.mjs", line: "const calls = gases.map((g) => ({ from: transmitter, to: forwarder, data: txData(), gas: hex(g), maxFeePerGas: hex(10n ** 12n), maxPriorityFeePerGas: '0x0' }))", why: "eth_simulateV1 search probes on Monad (read-only): finds the smallest gas whose logs include RoundWritten" },
  { file: "cre/fx-workflow/scripts/gas-limit.mjs", line: "const r = await rpc('eth_simulateV1', [{ blockStateCalls: [{ stateOverrides: ov, calls: [{ from: transmitter, to: receiver, data, gas: hex(CRE_MAX_TX_GAS) }] }] }, 'latest'])", why: "read-only diagnostic simulation that decodes onReport's revert; no limit is taken from it" },
  { file: "cre/fx-workflow/scripts/gas-limit.mjs", line: "gasLimit: gasLimit.toString(),", why: "prints the Monad-derived limit" },
  { file: "cre/fx-workflow/scripts/gas-limit.mjs", line: "if (balance < fee) log(`WARNING: transmitter balance ${mon(balance)} is below one write's fee (${mon(fee)}); fund it before --broadcast.`)", why: "log text (the word 'broadcast')" },
  { file: "cre/fx-workflow/scripts/gas-limit.mjs", line: "const next = { ...config, gasLimit: gasLimit.toString() }", why: "--write: stores the Monad-derived limit in the workflow config" },
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.test(name) && !/\.test\.|\.t\.sol$/.test(name)) yield p;
  }
}

function scan() {
  const hits: { file: string; n: number; line: string }[] = [];
  for (const root of ROOTS) {
    for (const abs of walk(join(REPO, root))) {
      const file = relative(REPO, abs);
      readFileSync(abs, "utf8")
        .split("\n")
        .forEach((raw, i) => {
          const line = raw.trim();
          if (/^(\/\/|\*|\/\*)/.test(line)) return; // comments
          if (GAS_KEY.test(line) || SEND.test(line)) hits.push({ file, n: i + 1, line });
        });
    }
  }
  return hits;
}

describe("static: no gas limit or send path outside the Monad-estimator helpers", () => {
  const hits = scan();

  it("scans the expected trees", () => {
    const files = new Set(hits.map((h) => h.file));
    for (const f of ["relayer/src/lanes.ts", "contracts/script/monad-send.mjs", "contracts/script/Deploy.s.sol"]) expect(files.has(f), f).toBe(true);
  });

  it("every gas key and send primitive is a reviewed, estimator-derived use", () => {
    const unexpected = hits.filter((h) => !ALLOWED.some((a) => a.file === h.file && a.line === h.line));
    expect(unexpected.map((h) => `${h.file}:${h.n}: ${h.line}`), "route the limit through MonadGasEstimator.limitFor() / monadGasQuote() and review it here").toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    const stale = ALLOWED.filter((a) => !hits.some((h) => h.file === a.file && h.line === a.line));
    expect(stale.map((a) => `${a.file}: ${a.line}`)).toEqual([]);
  });

  it("the patterns catch literal limits and new send paths", () => {
    for (const bad of ["gas: 300_000n,", "{ gasLimit: 500000 }", "await wallet.writeContract({ address, abi })", "client.sendTransaction({ to })", "\"gas\": \"0x7a120\"", "forge script --broadcast --gas-estimate-multiplier 110", "{gas: 100000}"]) {
      expect(GAS_KEY.test(bad) || SEND.test(bad), bad).toBe(true);
    }
    for (const ok of ["startGas: BigInt(x)", "txGas: 1n", "plans-gas:label", "maxFeePerGas: 1n"]) expect(GAS_KEY.test(ok) || SEND.test(ok), ok).toBe(false);
  });
});
