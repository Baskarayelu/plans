/**
 * Stage A end-to-end run. One command: `npm --prefix e2e/stage-a test` (or `npx tsx run.ts` here).
 *
 *  1. fresh anvil fork of Monad mainnet (chain 143, real AUSD), five contracts deployed with
 *     Deploy.s.sol's CREATE2 salts, actors funded with real AUSD through storage;
 *  2. the relayer from relayer/dist against the fork (demo on, faucet/push/long-stop off), plus a
 *     second "strict" relayer with production rate/body limits for the limit tests;
 *  3. every flow and failure path through the relayer HTTP API, signed like the app;
 *  4. invariants after each group; REPORT.md and results.json written next to this file.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { deployPlans, fundAusd, startAnvil, startFxMock, startRelayer, AUSD, AUSD_TOTAL_SUPPLY_SLOT, type RelayerProc } from "./lib/env";
import { Runner, waitFor, type Env } from "./lib/harness";
import { ABI, Api, makeCtx, USD } from "./lib/plans";
import { writeReport } from "./lib/report";
import { actorsFor, type Actors } from "./scenarios/actors";
import { httpScenarios, strictLimitScenarios } from "./scenarios/http";
import { demoScenarios } from "./scenarios/demo";
import { peripheryScenarios, peripheryAfterExpiry } from "./scenarios/periphery";
import { potAScenarios } from "./scenarios/potA";
import { otherPotScenarios } from "./scenarios/otherPots";
import { timeScenarios } from "./scenarios/time";

const HERE = import.meta.dirname;

/** `tsx run.ts --report`: rebuild REPORT.md from results.json without re-running. */
function reportOnly() {
  const j = JSON.parse(readFileSync(join(HERE, "results.json"), "utf8"));
  writeReport(join(HERE, "REPORT.md"), j.meta, j.results);
  console.log("REPORT.md regenerated from results.json");
}

async function main() {
  if (process.argv.includes("--report")) return reportOnly();
  const started = new Date();
  const runDir = join(HERE, ".runs", started.toISOString().replace(/[:.]/g, "-"));
  mkdirSync(runDir, { recursive: true });
  console.log(`Stage A run, logs in ${runDir}`);

  const procs: { stop: () => unknown }[] = [];
  const cleanup = async () => {
    for (const p of procs.reverse()) await p.stop();
  };
  process.on("SIGINT", () => void cleanup().then(() => process.exit(130)));

  try {
    // 1. chain
    const anvil = await startAnvil(runDir);
    procs.push(anvil);
    console.log(`anvil fork of Monad mainnet at block ${anvil.forkBlock} on ${anvil.url}`);
    const dep = await deployPlans(anvil);
    console.log(`deployed: factory ${dep.plansFactory}, escrow ${dep.claimEscrow}, keys ${dep.keyRegistry}, send ${dep.plansSend}`);
    const ctx = makeCtx(anvil.pub, dep);

    // actors (fresh throwaway keys each run; never printed)
    const demoKeys = { ben: generatePrivateKey(), asha: generatePrivateKey(), maya: generatePrivateKey() };
    const A: Actors = actorsFor(Object.fromEntries(Object.entries(demoKeys).map(([k, v]) => [k, privateKeyToAccount(v)])) as Actors["demo"]);

    const env: Env = {
      anvil,
      dep,
      ctx,
      api: undefined as never,
      strict: undefined as never,
      pots: new Map(),
      tracked: new Map(),
      demoPots: new Set(),
      fundedTotal: 0n,
      supplyAfterFunding: 0n,
    };
    const track = (a: Address, label: string) => env.tracked.set(a.toLowerCase(), label);
    for (const [label, acct] of Object.entries(A.funded)) {
      await fundAusd(anvil, acct.address, A.funding[label] ?? USD(1000), ABI.ausd as never);
      env.fundedTotal += A.funding[label] ?? USD(1000);
      track(acct.address, label);
    }
    for (const [k, acct] of Object.entries(A.demo)) {
      await fundAusd(anvil, acct.address, USD(2), ABI.ausd as never);
      env.fundedTotal += USD(2);
      track(acct.address, `demo:${k}`);
    }
    for (const [label, acct] of Object.entries(A.unfunded)) track(acct.address, label);
    for (const [label, addr] of Object.entries(A.payees)) track(addr, label);
    track(dep.claimEscrow, "ClaimEscrow");
    track(dep.plansSend, "PlansSend");
    env.supplyAfterFunding = BigInt(await anvil.rpc<string>("eth_getStorageAt", [AUSD, AUSD_TOTAL_SUPPLY_SLOT, "latest"]));

    // 2. relayers
    const fx = await startFxMock();
    procs.push({ stop: () => fx.server.close() });
    const main: RelayerProc = await startRelayer({
      name: "main",
      anvil,
      dep,
      runDir,
      fxUrl: fx.url,
      env: {
        DEMO_ENABLED: "true",
        DEMO_KEY_BEN: demoKeys.ben,
        DEMO_KEY_ASHA: demoKeys.asha,
        DEMO_KEY_MAYA: demoKeys.maya,
        DEMO_VOTE_DELAY_MIN_MS: "200",
        DEMO_VOTE_DELAY_MAX_MS: "400",
        DEMO_STEP_DELAY_MS: "250",
        DEMO_TICK_MS: "300",
        // limits off for the main run; the strict relayer below keeps the production defaults
        RATE_LIMIT_IP_PER_MIN: "1000000",
        RATE_LIMIT_ADDRESS_PER_MIN: "1000000",
        CREATE_POT_PER_IP_PER_DAY: "1000000",
        TRUST_PROXY: "true",
      },
    });
    procs.push(main);
    const strict: RelayerProc = await startRelayer({
      name: "strict",
      anvil,
      dep,
      runDir,
      fxUrl: fx.url,
      lanes: 1,
      env: { LISTENER_ENABLED: "false", DEMO_ENABLED: "false", TRUST_PROXY: "true" },
    });
    procs.push(strict);
    env.api = new Api(main.url);
    env.strict = new Api(strict.url);
    await waitFor(async () => (await env.api.get("/v1/health")).body?.listener?.caughtUp === true, "main relayer healthy", 90_000);
    await waitFor(async () => (await env.strict.get("/v1/health")).status === 200, "strict relayer healthy", 90_000);
    console.log(`relayers up: main ${main.url}, strict ${strict.url}`);

    // 3-4. scenarios, in chain-time order (the fork's clock only moves forward)
    const R = new Runner(env);
    const t = { R, env, A, main, strict, fx };
    await httpScenarios(t);
    await strictLimitScenarios(t);
    await demoScenarios(t);
    const later = await peripheryScenarios(t);
    const potA = await potAScenarios(t);
    const others = await otherPotScenarios(t);
    await timeScenarios(t, potA, others, later);
    await peripheryAfterExpiry(t, later);
    await R.invariants("final state");

    const finished = new Date();
    const meta = {
      started: started.toISOString(),
      finished: finished.toISOString(),
      forkBlock: anvil.forkBlock.toString(),
      forkUrl: process.env.FORK_URL ?? "https://rpc.monad.xyz",
      deployment: dep,
      relayerSync: (await env.api.get("/v1/health")).body?.sendRawTransactionSync,
    };
    writeFileSync(join(HERE, "results.json"), JSON.stringify({ meta, results: R.results }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    writeReport(join(HERE, "REPORT.md"), meta, R.results);
    const pass = R.results.filter((r) => r.status === "PASS").length;
    const fail = R.results.length - pass;
    console.log(`\n${pass} passed, ${fail} failed, ${R.results.length} total. Report: e2e/stage-a/REPORT.md`);
    await cleanup();
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error("fatal:", (e as Error).stack ?? e);
    await cleanup();
    process.exit(2);
  }
}

void main();
