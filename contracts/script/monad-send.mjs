#!/usr/bin/env node
// Sends the Plans deployment to Monad with gas limits from Monad's own estimator.
//
// script/Deploy.s.sol says WHAT to deploy. Run it as a dry run (no --broadcast); forge writes the
// transactions to broadcast/Deploy.s.sol/<chainid>/dry-run/run-latest.json. This script reads that
// file and, for each transaction:
//   - skips it when its CREATE2 address already has code (re-runs are safe),
//   - calls eth_estimateGas on the target Monad RPC from the deployer address (no state override),
//   - sets gasLimit = estimate + 10%, rounded up to a multiple of 1,000,
//   - prints it (`check`) or signs and sends it (`send`) with eth_sendRawTransactionSync, falling
//     back to eth_sendRawTransaction + receipt polling.
// The gas limit forge put in the dry-run file (from its local Ethereum-priced simulation) is never
// used. After `send` it checks code at every predicted address and the wiring (factory, PlansSend,
// Pot implementation and FxReference), then writes deployments/<chainid>.json.
//
// FxReference's constructor arguments (owner, CRE simulation forwarder, simulation transmitter, CCIP
// chain selector) are decoded from its initcode and printed by `check`; the forwarder and chain
// selector must be Chainlink's published values for the chain or the plan is refused.
//
//   node script/monad-send.mjs check --chain 10143
//   node script/monad-send.mjs send  --chain 10143 --confirm <fingerprint printed by check>
//
// Options: --rpc <url> (default: the public Monad RPC for the chain), --plan <dry-run json>,
// --from <address> (check only, when no key is available), --tip-gwei <n> (priority fee, default 2).
// The deployer key comes from PLANS_DEPLOYER_KEY, else DEPLOYER in ../secrets/keys.env (outside the
// repo). It is never printed or written anywhere.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS = path.resolve(HERE, '..');
const REPO = path.resolve(CONTRACTS, '..');
const VIEM = path.join(CONTRACTS, 'tools', 'node_modules', 'viem', '_esm');
if (!existsSync(VIEM)) {
  console.error('viem not installed: run `npm --prefix tools install` (from contracts/) first');
  process.exit(1);
}
const V = await import(pathToFileURL(path.join(VIEM, 'index.js')).href);
const { privateKeyToAccount } = await import(pathToFileURL(path.join(VIEM, 'accounts', 'index.js')).href);
const { keccak256, toHex, getAddress, getContractAddress, parseTransaction, encodeFunctionData, decodeFunctionResult, decodeAbiParameters, parseAbi, formatEther, slice, size, zeroAddress } = V;

export const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
export const MONAD_RPC = { 143: 'https://rpc.monad.xyz', 10143: 'https://testnet-rpc.monad.xyz' };
export const MONAD_MIN_BASE_FEE = 100_000_000_000n; // 100 gwei
export const SALTS = {
  fxReference: keccak256(toHex('plans.v1.FxReference')),
  keyRegistry: keccak256(toHex('plans.v1.KeyRegistry')),
  plansFactory: keccak256(toHex('plans.v1.PlansFactory')),
  plansSend: keccak256(toHex('plans.v1.PlansSend')),
};
/** Chainlink CRE on Monad: the simulation forwarder (MockKeystoneForwarder) and the CCIP chain selector. */
export const CRE = {
  143: { simForwarder: '0x9eF6468C5f37b976E57d52054c693269479A784d', chainSelector: 8481857512324358265n },
  10143: { simForwarder: '0xB9F79d863261869B234c481D1f9A7af84AeAd192', chainSelector: 2183018362218727504n },
};
const DEPLOYMENT_FIELDS = ['chainId', 'ausd', 'keyRegistry', 'fxReference', 'plansSend', 'plansFactory', 'claimEscrow', 'potImplementation'];
const ADDRESS_FIELDS = ['keyRegistry', 'fxReference', 'plansSend', 'plansFactory', 'claimEscrow', 'potImplementation'];
const FACTORY_ABI = parseAbi([
  'function ausd() view returns (address)',
  'function keyRegistry() view returns (address)',
  'function claimEscrow() view returns (address)',
  'function potImplementation() view returns (address)',
  'function fxReference() view returns (address)',
]);
const PLANS_SEND_ABI = parseAbi(['function ausd() view returns (address)', 'function fxReference() view returns (address)']);
const POT_ABI = parseAbi(['function ausd() view returns (address)', 'function keyRegistry() view returns (address)', 'function claimEscrow() view returns (address)', 'function fxReference() view returns (address)', 'function factory() view returns (address)']);
const FX_ABI = parseAbi([
  'function owner() view returns (address)',
  'function forwarder() view returns (address)',
  'function SIM_FORWARDER() view returns (address)',
  'function simTransmitter() view returns (address)',
  'function CHAIN_SELECTOR() view returns (uint64)',
]);
const FX_CTOR = [{ type: 'address', name: 'owner' }, { type: 'address', name: 'simForwarder' }, { type: 'address', name: 'simTransmitter' }, { type: 'uint64', name: 'chainSelector' }];

const lc = (s) => String(s).toLowerCase();
const hex = (n) => '0x' + BigInt(n).toString(16);
const mon = (wei) => `${formatEther(wei)} MON`;
const gwei = (wei) => `${Number(wei) / 1e9} gwei`;
const num = (n) => BigInt(n).toLocaleString('en-US');

// ───────────────────────────── gas: Monad's estimator only ─────────────────────────────

/** estimate + 10%, rounded up to a multiple of 1,000. */
export function gasLimitFromEstimate(estimate) {
  const e = BigInt(estimate);
  if (e <= 0n) throw new Error(`invalid Monad gas estimate ${e}`);
  const withMargin = (e * 11_000n + 9_999n) / 10_000n;
  return ((withMargin + 999n) / 1_000n) * 1_000n;
}

const issued = new WeakSet();
const sameTx = (a, b) => lc(a.from) === lc(b.from) && lc(a.to) === lc(b.to) && lc(a.data) === lc(b.data) && BigInt(a.value ?? 0) === BigInt(b.value ?? 0);

/**
 * The only source of a gas limit in this script: eth_estimateGas on the Monad RPC, from the
 * deployer, for exactly this transaction, with no state override. Returns a frozen quote that
 * `signWithMonadGas` checks before signing.
 */
export async function monadGasQuote(rpc, tx) {
  const req = { from: tx.from, to: tx.to, data: tx.data, ...(BigInt(tx.value ?? 0) ? { value: hex(tx.value) } : {}) };
  const estimate = BigInt(await rpc('eth_estimateGas', [req, 'latest']));
  const quote = Object.freeze({ estimate, gasLimit: gasLimitFromEstimate(estimate), tx: Object.freeze({ ...tx, value: BigInt(tx.value ?? 0) }) });
  issued.add(quote);
  return quote;
}

/** Signs `tx` with the quote's gas limit; refuses a quote that monadGasQuote did not issue for this exact tx. */
export async function signWithMonadGas(account, quote, tx, { chainId, nonce, fees }) {
  if (!issued.has(quote)) throw new Error('refusing to sign: gas limit did not come from monadGasQuote (Monad eth_estimateGas)');
  if (!sameTx(quote.tx, { ...tx, from: account.address })) throw new Error('refusing to sign: gas quote was estimated for a different transaction or sender');
  const raw = await account.signTransaction({
    chainId,
    type: 'eip1559',
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value ?? 0),
    nonce,
    gas: quote.gasLimit,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  if (parseTransaction(raw).gas !== quote.gasLimit) throw new Error('signed gas limit differs from the Monad quote');
  return raw;
}

// ───────────────────────────── rpc ─────────────────────────────

let rpcId = 0;
/** JSON-RPC over fetch. Reads retry on transient errors; sends never retry here. */
export function makeRpc(url, { fetchImpl = fetch } = {}) {
  const SEND = new Set(['eth_sendRawTransaction', 'eth_sendRawTransactionSync']);
  return async function rpc(method, params = []) {
    for (let attempt = 0; ; attempt++) {
      let res, text;
      try {
        res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
        text = await res.text();
      } catch (e) {
        if (!SEND.has(method) && attempt < 4) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw e;
      }
      if (!SEND.has(method) && (res.status === 429 || res.status >= 500) && attempt < 6) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        continue;
      }
      let j;
      try {
        j = JSON.parse(text);
      } catch {
        throw new Error(`${method}: bad response ${res.status}: ${text.slice(0, 200)}`);
      }
      if (j.error) {
        const e = new Error(`${method}: ${j.error.message}`);
        e.code = j.error.code;
        e.data = j.error.data;
        throw e;
      }
      return j.result;
    }
  };
}

// ───────────────────────────── the plan (from the forge dry run) ─────────────────────────────

export const planPath = (chainId) => path.join(CONTRACTS, 'broadcast', 'Deploy.s.sol', String(chainId), 'dry-run', 'run-latest.json');

/** Parses `(143, 0xabc…, …)` from the dry run's `returns.d.value`. */
function parseDeployment(returns) {
  const v = returns?.d?.value;
  if (typeof v !== 'string') throw new Error('dry run has no `returns.d` (the Deployment struct): re-run Deploy.s.sol');
  const parts = v.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim());
  if (parts.length !== DEPLOYMENT_FIELDS.length) throw new Error(`unexpected Deployment tuple: ${v}`);
  const d = {};
  DEPLOYMENT_FIELDS.forEach((k, i) => (d[k] = k === 'chainId' ? Number(parts[i]) : getAddress(parts[i])));
  return d;
}

/**
 * Validates the dry run and returns { chainId, deployment, txs }. Every transaction must be a call
 * to the CREATE2 deployer whose recomputed address matches forge's prediction. forge's `gas`,
 * `nonce` and `from` fields are ignored.
 */
export function loadPlan(json, chainId) {
  if (Number(json.chain) !== Number(chainId)) throw new Error(`dry run is for chain ${json.chain}, not ${chainId}`);
  const deployment = parseDeployment(json.returns);
  if (deployment.chainId !== Number(chainId)) throw new Error(`dry run Deployment.chainId ${deployment.chainId} != ${chainId}`);
  const txs = (json.transactions ?? []).map((t, i) => {
    const x = t.transaction ?? {};
    if (t.transactionType !== 'CREATE2' || lc(x.to) !== lc(CREATE2_DEPLOYER)) {
      throw new Error(`tx ${i} (${t.contractName}) is not a call to the CREATE2 deployer; refusing`);
    }
    const data = x.input ?? x.data;
    if (!data || size(data) <= 32) throw new Error(`tx ${i} (${t.contractName}) has no initcode`);
    const salt = slice(data, 0, 32);
    const predicted = getContractAddress({ opcode: 'CREATE2', from: CREATE2_DEPLOYER, salt, bytecode: slice(data, 32) });
    if (lc(predicted) !== lc(t.contractAddress)) throw new Error(`tx ${i} (${t.contractName}): CREATE2 address ${predicted} != forge's ${t.contractAddress}`);
    return {
      name: t.contractName,
      to: getAddress(x.to),
      data,
      value: BigInt(x.value ?? 0),
      salt,
      predicted,
      additional: (t.additionalContracts ?? []).map((a) => ({ name: a.contractName, address: getAddress(a.address) })),
    };
  });
  const byName = Object.fromEntries(txs.map((t) => [t.name, t.predicted]));
  for (const [name, field] of [['KeyRegistry', 'keyRegistry'], ['FxReference', 'fxReference'], ['PlansSend', 'plansSend'], ['PlansFactory', 'plansFactory']]) {
    if (byName[name] && lc(byName[name]) !== lc(deployment[field])) throw new Error(`${name}: tx address ${byName[name]} != Deployment.${field} ${deployment[field]}`);
  }
  const fxTx = txs.find((t) => t.name === 'FxReference');
  const fx = fxTx ? fxConfigFromInitcode(slice(fxTx.data, 32), chainId) : null;
  return { chainId: Number(chainId), deployment, txs, fx };
}

/**
 * Decodes FxReference's constructor arguments (the last 4 words of its initcode) and checks them:
 * the simulation forwarder and the chain selector must be Chainlink's values for this chain, and the
 * owner and transmitter must be set. Returns { owner, simForwarder, simTransmitter, chainSelector }.
 */
export function fxConfigFromInitcode(initcode, chainId) {
  if (size(initcode) < 128) throw new Error('FxReference initcode has no constructor arguments');
  const [owner, simForwarder, simTransmitter, chainSelector] = decodeAbiParameters(FX_CTOR, slice(initcode, size(initcode) - 128));
  const want = CRE[Number(chainId)];
  if (!want) throw new Error(`no Chainlink CRE values for chain ${chainId}`);
  if (lc(simForwarder) !== lc(want.simForwarder)) throw new Error(`FxReference simForwarder ${simForwarder} is not Chainlink's MockKeystoneForwarder ${want.simForwarder} on chain ${chainId}`);
  if (chainSelector !== want.chainSelector) throw new Error(`FxReference chainSelector ${chainSelector} != ${want.chainSelector} for chain ${chainId}`);
  if (lc(owner) === lc(zeroAddress) || lc(simTransmitter) === lc(zeroAddress)) throw new Error('FxReference owner and simTransmitter must be set (FX_OWNER / FX_SIM_TRANSMITTER)');
  return { owner: getAddress(owner), simForwarder: getAddress(simForwarder), simTransmitter: getAddress(simTransmitter), chainSelector };
}

/** Identifies (chain, deployer, transactions). `send` must be given the value `check` printed. */
export function fingerprint(plan, from) {
  const body = JSON.stringify({ chainId: plan.chainId, from: lc(from), txs: plan.txs.map((t) => [lc(t.to), keccak256(t.data), t.value.toString()]) });
  return keccak256(toHex(body)).slice(0, 10);
}

// ───────────────────────────── key ─────────────────────────────

/** The deployer account from PLANS_DEPLOYER_KEY or DEPLOYER in ../secrets/keys.env. Never printed. */
export function loadDeployer({ env = process.env, keysFile = path.resolve(REPO, '..', 'secrets', 'keys.env') } = {}) {
  let key = env.PLANS_DEPLOYER_KEY?.trim();
  let source = 'PLANS_DEPLOYER_KEY';
  if (!key && existsSync(keysFile)) {
    for (const line of readFileSync(keysFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?DEPLOYER\s*=\s*(.*?)\s*$/);
      if (m) key = m[1].replace(/^["']|["']$/g, '');
    }
    source = keysFile + ' (DEPLOYER)';
  }
  if (!key) return null;
  if (!key.startsWith('0x')) key = '0x' + key;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`deployer key from ${source} is not a 32-byte hex key (value hidden)`);
  try {
    return { account: privateKeyToAccount(key), source };
  } catch {
    throw new Error(`deployer key from ${source} is invalid (value hidden)`);
  }
}

// ───────────────────────────── chain state ─────────────────────────────

async function fees(rpc, tipWei) {
  const b = await rpc('eth_getBlockByNumber', ['latest', false]);
  const reported = b?.baseFeePerGas ? BigInt(b.baseFeePerGas) : 0n;
  const base = reported > MONAD_MIN_BASE_FEE ? reported : MONAD_MIN_BASE_FEE;
  return { baseFee: base, maxFeePerGas: base + base / 4n + tipWei, maxPriorityFeePerGas: tipWei };
}

const hasCode = async (rpc, a) => {
  const c = await rpc('eth_getCode', [a, 'latest']);
  return typeof c === 'string' && c !== '0x' && c !== '0x0';
};

/** Refuses anything that is not a Monad chain served by a Monad node. */
async function assertMonadRpc(rpc, chainId) {
  if (!MONAD_RPC[chainId]) throw new Error(`chain ${chainId} is not Monad (143 or 10143)`);
  const live = Number(BigInt(await rpc('eth_chainId', [])));
  if (live !== Number(chainId)) throw new Error(`RPC is chain ${live}, expected ${chainId}`);
  let client = '';
  try {
    client = String(await rpc('web3_clientVersion', []));
  } catch {
    /* optional */
  }
  if (/anvil|hardhat|ganache|tenderly/i.test(client)) throw new Error(`RPC is ${client}, not a Monad node: its eth_estimateGas is not Monad's`);
}

/** Estimates every pending transaction on Monad and collects what `check` prints. */
export async function buildReport({ rpc, rpcUrl, plan, from, tipWei }) {
  await assertMonadRpc(rpc, plan.chainId);
  if (!(await hasCode(rpc, CREATE2_DEPLOYER))) throw new Error(`no CREATE2 deployer at ${CREATE2_DEPLOYER} on chain ${plan.chainId}`);
  if (!(await hasCode(rpc, plan.deployment.ausd))) throw new Error(`no AUSD at ${plan.deployment.ausd} on chain ${plan.chainId}`);
  const [balance, nonce, f] = await Promise.all([
    rpc('eth_getBalance', [from, 'latest']).then(BigInt),
    rpc('eth_getTransactionCount', [from, 'pending']).then((n) => Number(BigInt(n))),
    fees(rpc, tipWei),
  ]);
  const rows = [];
  for (const t of plan.txs) {
    const row = { ...t, deployed: await hasCode(rpc, t.predicted) };
    if (!row.deployed) {
      try {
        row.quote = await monadGasQuote(rpc, { from, to: t.to, data: t.data, value: t.value });
        row.maxCost = row.quote.gasLimit * f.maxFeePerGas;
        row.cost = row.quote.gasLimit * (f.baseFee + f.maxPriorityFeePerGas);
      } catch (e) {
        row.error = e.message;
      }
    }
    rows.push(row);
  }
  const pending = rows.filter((r) => !r.deployed);
  const totalLimit = pending.reduce((s, r) => s + (r.quote?.gasLimit ?? 0n), 0n);
  const totalMax = pending.reduce((s, r) => s + (r.maxCost ?? 0n), 0n);
  const totalCost = pending.reduce((s, r) => s + (r.cost ?? 0n), 0n);
  return { chainId: plan.chainId, rpcUrl, from, balance, nonce, fees: f, rows, pending, totalLimit, totalMax, totalCost, fingerprint: fingerprint(plan, from), errors: rows.filter((r) => r.error), fx: plan.fx };
}

export function printReport(r, out = console.log) {
  out('Plans deployment: CHECK (nothing is sent)');
  out('');
  out(`  chain id        ${r.chainId}`);
  out(`  rpc             ${r.rpcUrl}`);
  out(`  deployer        ${r.from}`);
  out(`  balance         ${mon(r.balance)}`);
  out(`  nonce (pending) ${r.nonce}`);
  out(`  fees            base ${gwei(r.fees.baseFee)}, tip ${gwei(r.fees.maxPriorityFeePerGas)}, maxFee ${gwei(r.fees.maxFeePerGas)}`);
  out('  gas limits      Monad eth_estimateGas from the deployer + 10%, rounded up to 1,000 (forge\'s dry-run gas is ignored)');
  out('');
  r.rows.forEach((t, i) => {
    out(`  [${i + 1}] ${t.name}`);
    out(`      to              ${t.to} (CREATE2 deployer)`);
    out(`      selector        ${t.data.slice(0, 10)} (calldata = salt ++ initcode; salt ${t.salt})`);
    out(`      value           ${mon(t.value)}`);
    out(`      predicted addr  ${t.predicted}${t.additional.length ? `  (+ ${t.additional.map((a) => `${a.name} ${a.address}`).join(', ')})` : ''}`);
    if (t.deployed) {
      out('      status          already deployed: SKIPPED');
    } else if (t.error) {
      out(`      status          ESTIMATE FAILED: ${t.error}`);
    } else {
      out(`      Monad estimate  ${num(t.quote.estimate)}`);
      out(`      gas limit       ${num(t.quote.gasLimit)}`);
      out(`      max cost        ${mon(t.maxCost)}  (gas limit x maxFee; Monad charges the full limit, ~${mon(t.cost)} at the current base fee)`);
    }
    if (t.name === 'FxReference' && r.fx) {
      out(`      fx owner        ${r.fx.owner}  (can switch simulation/production mode and the move limit; never touches funds)`);
      out(`      fx forwarder    ${r.fx.simForwarder}  (Chainlink CRE MockKeystoneForwarder: simulation mode)`);
      out(`      fx transmitter  ${r.fx.simTransmitter}  (the only tx.origin allowed to deliver rounds in simulation mode)`);
      out(`      fx chain sel.   ${r.fx.chainSelector}`);
    }
  });
  out('');
  out(`  to send         ${r.pending.length} of ${r.rows.length} transactions`);
  out(`  total gas limit ${num(r.totalLimit)}`);
  out(`  total max cost  ${mon(r.totalMax)}  (~${mon(r.totalCost)} at the current base fee)`);
  out(`  balance after   ${r.balance >= r.totalMax ? `>= ${mon(r.balance - r.totalMax)}` : `INSUFFICIENT: short by ${mon(r.totalMax - r.balance)}`}`);
  out(`  fingerprint     ${r.fingerprint}`);
  out('');
  if (r.errors.length) {
    out('  Not ready: fix the failed estimates above before sending.');
  } else if (r.balance < r.totalMax) {
    out(`  Not ready: fund ${r.from} with at least ${mon(r.totalMax - r.balance)} more (send refuses until balance >= total max cost), re-run check, then:`);
  } else if (!r.pending.length) {
    out('  Everything is already deployed. `send` will only verify and write deployments/' + r.chainId + '.json:');
  } else {
    out('  Verify the above, then send with:');
  }
  out('');
  out(`  node script/monad-send.mjs send --chain ${r.chainId} --rpc ${r.rpcUrl} --confirm ${r.fingerprint}`);
}

// ───────────────────────────── send ─────────────────────────────

const isMethodMissing = (e) => e?.code === -32601 || /method not found|not supported|does not exist|unknown method|not available/i.test(e?.message ?? '');

async function waitReceipt(rpc, hash, timeoutMs = 60_000, sleepMs = 500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await rpc('eth_getTransactionReceipt', [hash]);
    if (r) return r;
    await new Promise((res) => setTimeout(res, sleepMs));
  }
  throw new Error(`no receipt for ${hash} after ${timeoutMs / 1000}s`);
}

/** eth_sendRawTransactionSync, falling back to eth_sendRawTransaction + receipt polling. */
export async function sendRaw(rpc, raw, state = { sync: true }, waitOpts = {}) {
  const hash = keccak256(raw);
  if (state.sync) {
    try {
      return { receipt: await rpc('eth_sendRawTransactionSync', [raw]), hash, sync: true };
    } catch (e) {
      if (e.code === 4) return { receipt: await waitReceipt(rpc, typeof e.data === 'string' && e.data.length === 66 ? e.data : hash, waitOpts.timeoutMs, waitOpts.sleepMs), hash, sync: false };
      if (!isMethodMissing(e)) throw e;
      state.sync = false;
    }
  }
  try {
    await rpc('eth_sendRawTransaction', [raw]);
  } catch (e) {
    if (!/already known|known transaction|already imported/i.test(e.message)) throw e;
  }
  return { receipt: await waitReceipt(rpc, hash, waitOpts.timeoutMs, waitOpts.sleepMs), hash, sync: false };
}

async function read(rpc, to, abi, fn) {
  const r = await rpc('eth_call', [{ to, data: encodeFunctionData({ abi, functionName: fn }) }, 'latest']);
  return decodeFunctionResult({ abi, functionName: fn, data: r });
}

/**
 * Code at every address, and the wiring: the factory, PlansSend and the Pot implementation all point
 * at the same AUSD, KeyRegistry, ClaimEscrow and FxReference, and FxReference has the constructor
 * arguments `check` printed. Throws on any mismatch.
 */
export async function verifyDeployment(rpc, d, fx) {
  for (const k of ADDRESS_FIELDS) {
    if (!(await hasCode(rpc, d[k]))) throw new Error(`verify: no code at ${k} ${d[k]}`);
  }
  const expect = async (label, to, abi, fn, want) => {
    const got = await read(rpc, to, abi, fn);
    if (typeof want === 'bigint' ? got !== want : lc(got) !== lc(want)) throw new Error(`verify: ${label}.${fn}() = ${got}, expected ${want}`);
  };
  for (const fn of ['ausd', 'keyRegistry', 'claimEscrow', 'potImplementation', 'fxReference']) await expect('factory', d.plansFactory, FACTORY_ABI, fn, d[fn]);
  await expect('plansSend', d.plansSend, PLANS_SEND_ABI, 'ausd', d.ausd);
  await expect('plansSend', d.plansSend, PLANS_SEND_ABI, 'fxReference', d.fxReference);
  for (const fn of ['ausd', 'keyRegistry', 'claimEscrow', 'fxReference']) await expect('potImplementation', d.potImplementation, POT_ABI, fn, d[fn]);
  await expect('potImplementation', d.potImplementation, POT_ABI, 'factory', d.plansFactory);
  if (fx) {
    await expect('fxReference', d.fxReference, FX_ABI, 'SIM_FORWARDER', fx.simForwarder);
    await expect('fxReference', d.fxReference, FX_ABI, 'CHAIN_SELECTOR', fx.chainSelector);
    // owner / forwarder / transmitter may have been changed by the owner since a first deployment;
    // report rather than fail on those.
  }
}

export function writeDeployments(dir, d, sent, deployer, fx) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${d.chainId}.json`);
  let previous = [];
  try {
    previous = JSON.parse(readFileSync(file, 'utf8')).transactions ?? [];
  } catch {
    /* new file */
  }
  const json = {
    ausd: d.ausd,
    chainId: d.chainId,
    claimEscrow: d.claimEscrow,
    create2Deployer: CREATE2_DEPLOYER,
    fxReference: d.fxReference,
    ...(fx ? { fxConfig: { owner: fx.owner, simForwarder: fx.simForwarder, simTransmitter: fx.simTransmitter, chainSelector: fx.chainSelector.toString() } } : {}),
    keyRegistry: d.keyRegistry,
    plansFactory: d.plansFactory,
    plansSend: d.plansSend,
    potImplementation: d.potImplementation,
    salts: SALTS,
    deployer,
    transactions: [...previous, ...sent],
  };
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  return file;
}

export async function runSend({ rpc, rpcUrl, plan, account, tipWei, confirm, deploymentsDir, out = console.log, waitOpts }) {
  const report = await buildReport({ rpc, rpcUrl, plan, from: account.address, tipWei });
  if (confirm !== report.fingerprint) {
    throw new Error(`--confirm ${confirm ?? '(missing)'} does not match this plan's fingerprint ${report.fingerprint}: run \`check\` and verify it first`);
  }
  if (report.errors.length) throw new Error(`Monad eth_estimateGas failed for: ${report.errors.map((r) => r.name).join(', ')}`);
  if (report.balance < report.totalMax) throw new Error(`deployer balance ${mon(report.balance)} < total max cost ${mon(report.totalMax)}`);
  out(`Sending ${report.pending.length} transaction(s) on chain ${plan.chainId} from ${account.address}`);
  const sent = [];
  const state = { sync: true };
  for (const t of plan.txs) {
    if (await hasCode(rpc, t.predicted)) {
      out(`  ${t.name}: already deployed at ${t.predicted}, skipped`);
      continue;
    }
    const tx = { from: account.address, to: t.to, data: t.data, value: t.value };
    // Fresh Monad estimate right before signing (earlier transactions in this run have landed).
    const quote = await monadGasQuote(rpc, tx);
    const nonce = Number(BigInt(await rpc('eth_getTransactionCount', [account.address, 'pending'])));
    const f = await fees(rpc, tipWei);
    const raw = await signWithMonadGas(account, quote, tx, { chainId: plan.chainId, nonce, fees: f });
    out(`  ${t.name}: Monad estimate ${num(quote.estimate)}, gas limit ${num(quote.gasLimit)}, nonce ${nonce}`);
    const { receipt, hash, sync } = await sendRaw(rpc, raw, state, waitOpts);
    if (receipt.status !== '0x1') throw new Error(`${t.name}: transaction ${hash} reverted`);
    if (!(await hasCode(rpc, t.predicted))) throw new Error(`${t.name}: no code at ${t.predicted} after ${hash}`);
    out(`  ${t.name}: deployed at ${t.predicted} in ${hash} (block ${BigInt(receipt.blockNumber)}, gas used ${num(receipt.gasUsed)}${sync ? ', sync' : ''})`);
    sent.push({ contract: t.name, address: t.predicted, hash, blockNumber: Number(BigInt(receipt.blockNumber)), estimate: quote.estimate.toString(), gasLimit: quote.gasLimit.toString(), gasUsed: BigInt(receipt.gasUsed).toString() });
  }
  await verifyDeployment(rpc, plan.deployment, plan.fx);
  out('  verified: code at all 6 addresses; factory, PlansSend, Pot implementation and FxReference wiring matches');
  const file = writeDeployments(deploymentsDir, plan.deployment, sent, account.address, plan.fx);
  out(`  wrote ${path.relative(process.cwd(), file) || file}`);
  return { sent, file };
}

// ───────────────────────────── cli ─────────────────────────────

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const o = { mode };
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`);
    o[k.slice(2)] = rest[++i];
  }
  return o;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.mode !== 'check' && a.mode !== 'send') {
    console.error('usage: node script/monad-send.mjs check|send --chain 143|10143 [--rpc url] [--plan file] [--from addr] [--confirm fp] [--tip-gwei n]');
    process.exit(2);
  }
  const chainId = Number(a.chain);
  if (!MONAD_RPC[chainId]) throw new Error('--chain must be 143 (mainnet) or 10143 (testnet)');
  const rpcUrl = a.rpc ?? MONAD_RPC[chainId];
  const file = a.plan ?? planPath(chainId);
  if (!existsSync(file)) throw new Error(`no dry run at ${file}: run Deploy.s.sol without --broadcast first`);
  const plan = loadPlan(JSON.parse(readFileSync(file, 'utf8')), chainId);
  const tipWei = BigInt(Math.round(Number(a['tip-gwei'] ?? 2) * 1e9));
  const rpc = makeRpc(rpcUrl);
  const deployer = loadDeployer();
  if (a.mode === 'check') {
    const from = deployer?.account.address ?? (a.from ? getAddress(a.from) : null);
    if (!from) throw new Error('no deployer key (PLANS_DEPLOYER_KEY or ../secrets/keys.env DEPLOYER) and no --from');
    if (deployer && a.from && lc(a.from) !== lc(from)) throw new Error(`--from ${a.from} is not the deployer key's address ${from}`);
    const r = await buildReport({ rpc, rpcUrl, plan, from, tipWei });
    printReport(r);
    if (r.errors.length) process.exit(1);
    return;
  }
  if (!deployer) throw new Error('send needs the deployer key: PLANS_DEPLOYER_KEY or DEPLOYER in ../secrets/keys.env');
  await runSend({ rpc, rpcUrl, plan, account: deployer.account, tipWei, confirm: a.confirm, deploymentsDir: path.join(CONTRACTS, 'deployments') });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`monad-send: ${e.message}`);
    process.exit(1);
  });
}
