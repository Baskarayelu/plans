#!/usr/bin/env node
// Monad gas measurement for the Plans contracts. Regenerates GAS.md.
//
//   npm --prefix tools run gas          (from contracts/; first time: npm --prefix tools install)
//
// What it does (see GAS.md "Method" for details):
//   1. forge build, and forge test --gas-report → tools/gas-report.txt (appendix).
//   2. Starts an anvil fork of Monad mainnet (code size limit disabled, steps tracing on).
//   3. Deploys KeyRegistry, FxReference, PlansFactory, PlansSend (+ a standalone Pot implementation and
//      ClaimEscrow) and runs the whole Plans lifecycle with real AUSD, recording every transaction.
//      FxReference rounds are delivered through Chainlink's real MockKeystoneForwarder on the fork,
//      exactly as `cre workflow simulate --broadcast` delivers them (the relayer EOA is the
//      configured simulation transmitter).
//   4. Re-prices each recorded transaction's struct-log trace with Monad's MONAD_TEN rules
//      (tools/monad-model.mjs).
//   5. Ground truth: replays every recorded transaction on the LIVE Monad mainnet RPC, read-only,
//      with eth_simulateV1 / eth_estimateGas and state overrides built from the anvil prestate
//      (our contracts' code + storage, AUSD storage), and bisects the exact minimal gas limit.
//   6. Writes GAS.md and tools/gas-results.json.
//
// Never sends a transaction to a live network: live calls are eth_estimateGas, eth_simulateV1,
// eth_getBlockByNumber only. Transactions are sent only to the local anvil.
//
// ONLY=<regex> limits the live replay to matching action labels (for debugging).
//
// Env: FORK_URL, LIVE_RPC (default https://rpc.monad.xyz), ANVIL_URL (use a running anvil instead
// of spawning one), ANVIL_PORT (8547), SKIP_BUILD=1, SKIP_GAS_REPORT=1, SKIP_LIVE=1, GAS_MARGIN (0.10).

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'tools');
const viemPath = path.join(TOOLS, 'node_modules', 'viem', '_esm');
if (!existsSync(viemPath)) {
  console.error('viem not installed: run `npm --prefix tools install` first');
  process.exit(1);
}
const V = await import(pathToFileURL(path.join(viemPath, 'index.js')).href);
const { privateKeyToAccount } = await import(pathToFileURL(path.join(viemPath, 'accounts', 'index.js')).href);
const { reprice, MONAD } = await import(pathToFileURL(path.join(TOOLS, 'monad-model.mjs')).href);
const { encodeFunctionData, decodeFunctionResult, encodeAbiParameters, keccak256, toHex, parseAbi, decodeErrorResult, parseSignature } = V;

const CFG = {
  forkUrl: process.env.FORK_URL ?? 'https://rpc.monad.xyz',
  liveRpc: process.env.LIVE_RPC ?? 'https://rpc.monad.xyz',
  anvilUrl: process.env.ANVIL_URL ?? null,
  anvilPort: Number(process.env.ANVIL_PORT ?? 8547),
  skipBuild: !!process.env.SKIP_BUILD,
  skipGasReport: !!process.env.SKIP_GAS_REPORT,
  skipLive: !!process.env.SKIP_LIVE,
  margin: Number(process.env.GAS_MARGIN ?? 0.1),
};

const AUSD = '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a';
const CHAIN_ID = 143;
/** Chainlink CRE MockKeystoneForwarder on Monad mainnet and the CCIP chain selector. */
const SIM_FORWARDER = '0x9eF6468C5f37b976E57d52054c693269479A784d';
const CHAIN_SELECTOR = 8481857512324358265n;
const FX_CCYS = ['0x474250', '0x455552', '0x494e52', '0x4e474e', '0x4a5059', '0x434846', '0x414544', '0x534744']; // GBP EUR INR NGN JPY CHF AED SGD
const FX_RATES = [132_765_000n, 112_690_000n, 1_037_000n, 75_600n, 632_500n, 120_400_000n, 27_229_000n, 78_300_000n];
const FX_MASKS = [3, 3, 3, 6, 3, 3, 6, 3];
const FORWARDER_ABI = parseAbi(['function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)']);
const USD = 1_000_000n;
const DAY = 86400n;

// ───────────────────────────── utils ─────────────────────────────

const hex = (n) => '0x' + BigInt(n).toString(16);
const pad32 = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
const lc = (s) => s.toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
const log = (...a) => console.error('[monad-gas]', ...a);
const pct = (a, b) => (b ? (((Number(a) - Number(b)) / Number(b)) * 100).toFixed(1) + '%' : '–');
const roundUp = (n, step = 1000n) => ((BigInt(n) + step - 1n) / step) * step;
const signed = (n) => (BigInt(n) >= 0n ? '+' : '−') + fmt(BigInt(n) < 0n ? -BigInt(n) : BigInt(n));

let rpcId = 0;
async function rpcRaw(url, method, params) {
  for (let attempt = 0; ; attempt++) {
    let res, text;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
      text = await res.text();
    } catch (e) {
      if (attempt < 6) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw e;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      await sleep(600 * (attempt + 1));
      continue;
    }
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      if (attempt < 6) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      throw new Error(`${method}: bad response ${res.status}: ${text.slice(0, 200)}`);
    }
    if (j.error) {
      if (/rate|limit|too many/i.test(j.error.message) && attempt < 8) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      const e = new Error(`${method}: ${j.error.message}`);
      e.rpcError = j.error;
      throw e;
    }
    return j.result;
  }
}

let ANVIL;
const anvil = (method, params = []) => rpcRaw(ANVIL, method, params);
let lastLive = 0;
async function live(method, params) {
  const wait = lastLive + 120 - Date.now(); // ≤ ~8 requests/s: well under the public RPC's 25 rps
  if (wait > 0) await sleep(wait);
  lastLive = Date.now();
  return rpcRaw(CFG.liveRpc, method, params);
}

// ───────────────────────────── artifacts ─────────────────────────────

function artifact(name) {
  const j = JSON.parse(readFileSync(path.join(ROOT, 'out', `${name}.sol`, `${name}.json`), 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode.object };
}
let ART;
const AUSD_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function nonces(address) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
]);

function allErrorsAbi() {
  const seen = new Set();
  const out = [];
  for (const a of Object.values(ART)) for (const x of a.abi) if (x.type === 'error' && !seen.has(x.name)) (seen.add(x.name), out.push(x));
  return [...out, ...parseAbi(['error Error(string)'])];
}
function decodeRevert(e) {
  const data = e?.rpcError?.data;
  if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return '';
  try {
    const r = decodeErrorResult({ abi: allErrorsAbi(), data });
    return `${r.errorName}(${(r.args ?? []).join(',')})`;
  } catch {
    return data.slice(0, 10);
  }
}

async function call(to, abi, functionName, args = []) {
  const data = encodeFunctionData({ abi, functionName, args });
  const r = await anvil('eth_call', [{ to, data }, 'latest']);
  return decodeFunctionResult({ abi, functionName, data: r });
}

// ───────────────────────────── anvil ─────────────────────────────

async function startAnvil() {
  if (CFG.anvilUrl) {
    ANVIL = CFG.anvilUrl;
    return () => {};
  }
  ANVIL = `http://127.0.0.1:${CFG.anvilPort}`;
  const args = ['--fork-url', CFG.forkUrl, '--disable-code-size-limit', '--steps-tracing', '--hardfork', 'prague', '--port', String(CFG.anvilPort), '--silent'];
  log('starting anvil', args.join(' '));
  const p = spawn('anvil', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  const stop = () => {
    try {
      p.kill('SIGTERM');
    } catch {}
  };
  process.on('exit', stop);
  for (let i = 0; i < 120; i++) {
    try {
      await rpcRaw(ANVIL, 'eth_chainId', []);
      return stop;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('anvil did not start');
}

// ───────────────────────────── accounts & signing ─────────────────────────────

const keyOf = (label) => keccak256(toHex(`plans-gas:${label}`));
const mkAccount = (label) => {
  const pk = keyOf(label);
  const a = privateKeyToAccount(pk);
  return { pk, address: a.address, account: a, label };
};
const RELAYER = mkAccount('relayer');
const U = Array.from({ length: 16 }, (_, i) => mkAccount(`user${i}`));
const INVITE = mkAccount('invite');
const INVITE2 = mkAccount('invite2');
const MERCHANT = mkAccount('merchant');
const CLAIM_KEYS = Array.from({ length: 4 }, (_, i) => mkAccount(`claimkey${i}`));
const RECIPIENT = mkAccount('claim-recipient'); // fresh address: no AUSD balance slot yet

let ctr = 0n;
const randWord = (tag = 'w') => keccak256(toHex(`plans-gas:${tag}:${++ctr}`));
const randNonce = () => BigInt(randWord('nonce'));
const randBytes = (len) => {
  let out = '';
  while (out.length < len * 2) out += randWord('bytes').slice(2);
  return '0x' + out.slice(0, len * 2);
};

const TYPES = {
  Invite: [{ name: 'member', type: 'address' }],
  Join: [
    { name: 'member', type: 'address' },
    { name: 'country', type: 'bytes2' },
    { name: 'safetyNet', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  Propose: [
    { name: 'proposer', type: 'address' },
    { name: 'kind', type: 'uint8' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'category', type: 'uint8' },
    { name: 'splitHash', type: 'bytes32' },
    { name: 'receiptHash', type: 'bytes32' },
    { name: 'memoHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  Vote: [
    { name: 'member', type: 'address' },
    { name: 'id', type: 'uint256' },
    { name: 'approve', type: 'bool' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  CancelSpend: [
    { name: 'member', type: 'address' },
    { name: 'id', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  OpenDispute: [
    { name: 'member', type: 'address' },
    { name: 'spendId', type: 'uint256' },
    { name: 'reason', type: 'uint8' },
    { name: 'memoHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  ResolveDispute: [
    { name: 'member', type: 'address' },
    { name: 'disputeId', type: 'uint256' },
    { name: 'outcome', type: 'uint8' },
    { name: 'splitHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  DisputeVote: [
    { name: 'member', type: 'address' },
    { name: 'disputeId', type: 'uint256' },
    { name: 'spenderCovers', type: 'bool' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  ProposeRules: [
    { name: 'member', type: 'address' },
    { name: 'rulesHash', type: 'bytes32' },
    { name: 'allowlistHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  VoteRules: [
    { name: 'member', type: 'address' },
    { name: 'id', type: 'uint256' },
    { name: 'approve', type: 'bool' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  RotateInvite: [
    { name: 'member', type: 'address' },
    { name: 'newSigner', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  PostKeyWraps: [
    { name: 'member', type: 'address' },
    { name: 'wrapsHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  CreatePot: [
    { name: 'creator', type: 'address' },
    { name: 'paramsHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  RegisterKey: [
    { name: 'account', type: 'address' },
    { name: 'pubKey', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
  Claim: [
    { name: 'id', type: 'uint256' },
    { name: 'recipient', type: 'address' },
    { name: 'toCountry', type: 'bytes2' },
  ],
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};
for (const t of ['Freeze', 'UnfreezeVote', 'Exit', 'Ack'])
  TYPES[t] = [
    { name: 'member', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ];

const domain = (name, verifyingContract) => ({ name, version: '1', chainId: CHAIN_ID, verifyingContract });
const sign = (who, dom, primaryType, message) => who.account.signTypedData({ domain: dom, types: { [primaryType]: TYPES[primaryType] }, primaryType, message });

// ───────────────────────────── deployment state ─────────────────────────────

const C = {}; // addresses
let DEADLINE; // shared deadline for every signature (T0 + 60 days)
let T0;
let BAL_BASE; // AUSD balance mapping base slot
let TUPLES; // ABI tuple components from the Pot artifact
const records = [];

async function nowTs() {
  return BigInt((await anvil('eth_getBlockByNumber', ['latest', false])).timestamp);
}
async function warp(seconds, why) {
  log(`warp +${seconds}s (${why})`);
  await anvil('evm_increaseTime', [Number(seconds)]);
  await anvil('evm_mine', []);
}

let anvilChecked = false;
/**
 * The only transactions this script sends go to a LOCAL anvil fork (to record Ethereum traces for
 * the Monad model). Their gas limit (2x anvil's estimate) never reaches Monad. Refuse anything that
 * is not anvil, so ANVIL_URL can never point the sends at a live network.
 */
async function assertLocalAnvil() {
  if (anvilChecked) return;
  const v = String(await anvil('web3_clientVersion', []));
  if (!/anvil/i.test(v)) throw new Error(`ANVIL_URL ${ANVIL} is not an anvil node (${v}); refusing to send`);
  anvilChecked = true;
}

/** Sends one transaction from the relayer to the local anvil and records it. */
async function send({ label, to = null, data, table = true, group = 'Pot', note = '' }) {
  await assertLocalAnvil();
  const req = { from: RELAYER.address, data, ...(to ? { to } : {}) };
  let ethEstimate;
  try {
    ethEstimate = BigInt(await anvil('eth_estimateGas', [req]));
  } catch (e) {
    throw new Error(`${label}: anvil eth_estimateGas failed: ${e.message} ${decodeRevert(e)}`);
  }
  let gas = ethEstimate * 2n;
  if (gas > 29_000_000n) gas = 29_000_000n;
  const hash = await anvil('eth_sendTransaction', [{ ...req, gas: hex(gas) }]);
  let receipt;
  for (let i = 0; i < 200 && !receipt; i++) {
    receipt = await anvil('eth_getTransactionReceipt', [hash]);
    if (!receipt) await sleep(50);
  }
  if (!receipt) throw new Error(`${label}: no receipt`);
  if (receipt.status !== '0x1') throw new Error(`${label}: transaction reverted on anvil (${hash})`);
  const rec = { label, group, table, note, hash, from: RELAYER.address, to, data, gasLimit: gas, ethEstimate, gasUsed: BigInt(receipt.gasUsed), receipt };
  records.push(rec);
  log(`${table ? '●' : '·'} ${label}: ${fmt(rec.gasUsed)} gas`);
  return rec;
}

// ───────────────────────────── AUSD helpers ─────────────────────────────

async function findAusdBalanceBase() {
  const probe = '0x1111111111111111111111111111111111111111';
  const data = encodeFunctionData({ abi: AUSD_ABI, functionName: 'balanceOf', args: [probe] });
  const t = await anvil('debug_traceCall', [{ to: AUSD, data }, 'latest', { enableMemory: true, disableStorage: true }]);
  const L = t.structLogs;
  for (let i = L.length - 1; i >= 0; i--) {
    if (L[i].op !== 'SLOAD') continue;
    const key = BigInt(L[i].stack[L[i].stack.length - 1]);
    for (let j = i - 1; j >= 0; j--) {
      if (L[j].op !== 'KECCAK256' && L[j].op !== 'SHA3') continue;
      const st = L[j].stack;
      const off = Number(BigInt(st[st.length - 1]));
      const len = Number(BigInt(st[st.length - 2]));
      if (len !== 64) break;
      const mem = L[j].memory.join('');
      const pre = '0x' + mem.slice(off * 2, (off + len) * 2);
      if (BigInt(keccak256(pre)) === key && BigInt('0x' + pre.slice(2, 66)) === BigInt(probe)) return '0x' + pre.slice(66);
      break;
    }
  }
  throw new Error('could not find the AUSD balance slot');
}

/** Sets AUSD's per-account frozen flag (the low bits under the shifted balance). */
async function setFrozen(addr, frozen) {
  const slot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [addr, BAL_BASE]));
  const raw = BigInt(await anvil('eth_getStorageAt', [AUSD, slot, 'latest']));
  await anvil('anvil_setStorageAt', [AUSD, slot, pad32((raw & ~0xffn) | (frozen ? 1n : 0n))]);
}

let BAL_SHIFT = null; // AUSD packs the balance above some low flag bits; found on first use
async function fundAusd(addr, amount) {
  const slot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [addr, BAL_BASE]));
  if (BAL_SHIFT == null) {
    await anvil('anvil_setStorageAt', [AUSD, slot, pad32(1n << 128n)]);
    const r = await call(AUSD, AUSD_ABI, 'balanceOf', [addr]);
    for (let k = 0n; k <= 128n; k++) if (r === 1n << (128n - k)) BAL_SHIFT = k;
    if (BAL_SHIFT == null) throw new Error(`cannot decode the AUSD balance encoding (${r})`);
    log('AUSD balance is stored shifted left by', BAL_SHIFT.toString(), 'bits');
  }
  await anvil('anvil_setStorageAt', [AUSD, slot, pad32(amount << BAL_SHIFT)]);
  const bal = await call(AUSD, AUSD_ABI, 'balanceOf', [addr]);
  if (bal !== amount) throw new Error(`AUSD funding failed for ${addr}: ${bal}`);
}

async function auth3009(who, to, value, nonce = randWord('3009')) {
  const message = { from: who.address, to, value, validAfter: 0n, validBefore: DEADLINE, nonce };
  const signature = await sign(who, domain('Agora Dollar', AUSD), 'ReceiveWithAuthorization', message);
  return { value, validAfter: 0n, validBefore: DEADLINE, nonce, signature };
}
async function permit2612(who, spender, value) {
  const nonce = await call(AUSD, AUSD_ABI, 'nonces', [who.address]);
  const sig = await sign(who, domain('Agora Dollar', AUSD), 'Permit', { owner: who.address, spender, value, nonce, deadline: DEADLINE });
  const { r, s, v } = parseSignature(sig);
  return { value, deadline: DEADLINE, v: Number(v), r, s };
}
const NO_AUTH = { value: 0n, validAfter: 0n, validBefore: 0n, nonce: pad32(0), signature: '0x' };
const NO_PERMIT = { value: 0n, deadline: 0n, v: 0, r: pad32(0), s: pad32(0) };
const NO_KEY = { pubKey: pad32(0), deadline: 0n, signature: '0x' };
async function keyReg(who) {
  const pubKey = randWord('x25519');
  const signature = await sign(who, domain('Plans Keys', C.keyRegistry), 'RegisterKey', { account: who.address, pubKey, deadline: DEADLINE });
  return { pubKey, deadline: DEADLINE, signature };
}

// ───────────────────────────── Plans actions ─────────────────────────────

const enc = (abi, fn, args) => encodeFunctionData({ abi, functionName: fn, args });
const potCall = (fn, args) => enc(ART.Pot.abi, fn, args);
const splitHash = (members, weights) => keccak256(encodeAbiParameters([{ type: 'address[]' }, { type: 'uint32[]' }], [members, weights]));
const COUNTRY = { GB: '0x4742', FR: '0x4652', US: '0x5553', IN: '0x494e' };

function rules({ instantMax = 25n * USD, oneApprovalMax = 200n * USD, highTier = 0, dailyCap = 150n * USD, totalCap = 0n, payeePolicy = 0, minContribution = 0n, ttl = 86400, timelock = 3600 } = {}) {
  return { instantMax, oneApprovalMax, highTier, memberDailyCap: dailyCap, memberTotalCap: totalCap, payeePolicy, minContribution, proposalTtl: ttl, ruleTimelock: timelock, categoryBudgets: Array(8).fill(0n) };
}
const BALANCED = () => rules();
const SETTLE_RULES = () => rules({ instantMax: 100n * USD, oneApprovalMax: 200n * USD, dailyCap: 0n });

async function createPot(creator, { rules: r, safetyNet = 0n, deposit = 0n, key = false, label, table = true, endIn = 30n * DAY, review = DAY }) {
  const now = await nowTs();
  const params = {
    rules: r,
    // Signed a minute before inclusion, as an app would: initialize() then takes the
    // `startTime < block.timestamp` branch on anvil and in the live replay alike.
    startTime: now - 60n,
    endTime: now + endIn,
    reviewWindow: Number(review),
    inviteSigner: INVITE.address,
    creatorCountry: COUNTRY.GB,
    creatorSafetyNet: safetyNet,
    meta: randBytes(120),
    creatorKeyWrap: randBytes(104),
    inviteKeyWrap: randBytes(104),
    salt: randWord('salt'),
  };
  const paramsHash = keccak256(encodeAbiParameters([TUPLES.params], [params]));
  const nonce = randNonce();
  const sig = await sign(creator, domain('Plans Factory', C.factory), 'CreatePot', { creator: creator.address, paramsHash, nonce, deadline: DEADLINE });
  const [pot] = [await call(C.factory, ART.PlansFactory.abi, 'predictPot', [creator.address, params.salt])];
  const dep = deposit ? await auth3009(creator, pot, deposit) : NO_AUTH;
  const pm = safetyNet ? await permit2612(creator, pot, safetyNet) : NO_PERMIT;
  const kr = key ? await keyReg(creator) : NO_KEY;
  await send({ label, table, group: 'Factory', to: C.factory, data: enc(ART.PlansFactory.abi, 'createPot', [creator.address, params, nonce, DEADLINE, sig, dep, pm, kr]) });
  return { address: pot, invite: INVITE, members: [creator] };
}

async function join(pot, who, { deposit = 0n, safetyNet = 0n, key = false, label, table = false } = {}) {
  const nonce = randNonce();
  const country = COUNTRY.FR;
  const memberSig = await sign(who, domain('Plans Pot', pot.address), 'Join', { member: who.address, country, safetyNet, nonce, deadline: DEADLINE });
  const inviteSig = await sign(pot.invite, domain('Plans Pot', pot.address), 'Invite', { member: who.address });
  const dep = deposit ? await auth3009(who, pot.address, deposit) : NO_AUTH;
  const pm = safetyNet ? await permit2612(who, pot.address, safetyNet) : NO_PERMIT;
  const kr = key ? await keyReg(who) : NO_KEY;
  pot.members.push(who);
  return send({ label: label ?? `join ${who.label}`, table, to: pot.address, data: potCall('join', [who.address, country, nonce, DEADLINE, memberSig, inviteSig, dep, pm, kr]) });
}

async function contribute(pot, who, amount, opts = {}) {
  const auth = await auth3009(who, pot.address, amount);
  return send({ label: opts.label ?? `contribute ${who.label}`, table: !!opts.table, to: pot.address, data: potCall('contribute', [who.address, auth]) });
}

const potSign = (pot, who, type, msg) => sign(who, domain('Plans Pot', pot.address), type, msg);

async function propose(pot, who, { kind = 0, payee, amount, category = 7, members, weights, memoLen = 64, label, table = false, nonce = randNonce() }) {
  members = members ?? pot.members.map((m) => m.address);
  weights = weights ?? members.map(() => 1);
  payee = payee ?? MERCHANT.address;
  const memo = randBytes(memoLen);
  const receiptHash = randWord('receipt');
  const msg = { proposer: who.address, kind, payee, amount, category, splitHash: splitHash(members, weights), receiptHash, memoHash: keccak256(memo), nonce, deadline: DEADLINE };
  const sig = await potSign(pot, who, 'Propose', msg);
  const before = await call(pot.address, ART.Pot.abi, 'spendCount');
  await send({ label: label ?? `propose ${who.label}`, table, to: pot.address, data: potCall('propose', [who.address, kind, payee, amount, category, { members, weights }, receiptHash, memo, nonce, DEADLINE, sig]) });
  return Number(before) + 1;
}

async function memberAction(pot, who, fn, type, extraMsg, args, opts) {
  const nonce = opts.nonce ?? randNonce();
  const sig = await potSign(pot, who, type, { member: who.address, ...extraMsg, nonce, deadline: DEADLINE });
  return send({ label: opts.label ?? `${fn} ${who.label}`, table: !!opts.table, to: pot.address, data: potCall(fn, [who.address, ...args(nonce, sig)]) });
}
const vote = (pot, who, id, approve, o = {}) => memberAction(pot, who, 'vote', 'Vote', { id: BigInt(id), approve }, (n, s) => [BigInt(id), approve, n, DEADLINE, s], o);
const cancelSpend = (pot, who, id, o = {}) => memberAction(pot, who, 'cancelSpend', 'CancelSpend', { id: BigInt(id) }, (n, s) => [BigInt(id), n, DEADLINE, s], o);
const voteDispute = (pot, who, id, covers, o = {}) => memberAction(pot, who, 'voteDispute', 'DisputeVote', { disputeId: BigInt(id), spenderCovers: covers }, (n, s) => [BigInt(id), covers, n, DEADLINE, s], o);
const freeze = (pot, who, o = {}) => memberAction(pot, who, 'freeze', 'Freeze', {}, (n, s) => [n, DEADLINE, s], o);
const voteUnfreeze = (pot, who, o = {}) => memberAction(pot, who, 'voteUnfreeze', 'UnfreezeVote', {}, (n, s) => [n, DEADLINE, s], o);
const exit = (pot, who, o = {}) => memberAction(pot, who, 'exit', 'Exit', {}, (n, s) => [n, DEADLINE, s], o);
const ack = (pot, who, o = {}) => memberAction(pot, who, 'ack', 'Ack', {}, (n, s) => [n, DEADLINE, s], o);
const voteRules = (pot, who, id, approve, o = {}) => memberAction(pot, who, 'voteRules', 'VoteRules', { id: BigInt(id), approve }, (n, s) => [BigInt(id), approve, n, DEADLINE, s], o);
const rotateInvite = (pot, who, signer, o = {}) => memberAction(pot, who, 'rotateInvite', 'RotateInvite', { newSigner: signer.address }, (n, s) => [signer.address, n, DEADLINE, s], o);

async function openDispute(pot, who, spendId, reason, o = {}) {
  const memo = randBytes(48);
  const before = await call(pot.address, ART.Pot.abi, 'disputeCount');
  await memberAction(pot, who, 'openDispute', 'OpenDispute', { spendId: BigInt(spendId), reason, memoHash: keccak256(memo) }, (n, s) => [BigInt(spendId), reason, memo, n, DEADLINE, s], o);
  return Number(before) + 1;
}
async function resolveDispute(pot, who, id, outcome, members, weights, o = {}) {
  return memberAction(pot, who, 'resolveDispute', 'ResolveDispute', { disputeId: BigInt(id), outcome, splitHash: splitHash(members, weights) }, (n, s) => [BigInt(id), outcome, { members, weights }, n, DEADLINE, s], o);
}
async function proposeRules(pot, who, r, add, remove, o = {}) {
  const rulesHash = keccak256(encodeAbiParameters([TUPLES.rules], [r]));
  const allowlistHash = keccak256(encodeAbiParameters([{ type: 'address[]' }, { type: 'address[]' }], [add, remove]));
  const before = await call(pot.address, ART.Pot.abi, 'ruleChangeCount');
  await memberAction(pot, who, 'proposeRules', 'ProposeRules', { rulesHash, allowlistHash }, (n, s) => [r, add, remove, n, DEADLINE, s], o);
  return Number(before) + 1;
}
async function postKeyWraps(pot, who, targets, o = {}) {
  const wraps = targets.map((t) => ({ member: t.address, wrap: randBytes(104) }));
  const wrapsHash = keccak256(encodeAbiParameters([TUPLES.wraps], [wraps]));
  return memberAction(pot, who, 'postKeyWraps', 'PostKeyWraps', { wrapsHash }, (n, s) => [wraps, n, DEADLINE, s], o);
}
const anyone = (pot, fn, args, o) => send({ label: o.label, table: !!o.table, to: pot.address, data: potCall(fn, args) });

async function claim(id, claimKey, recipient, o = {}) {
  const sig = await sign(claimKey, domain('Plans Claims', C.escrow), 'Claim', { id: BigInt(id), recipient: recipient.address, toCountry: COUNTRY.IN });
  return send({ label: o.label ?? 'claim', table: !!o.table, group: 'Escrow', to: C.escrow, data: enc(ART.ClaimEscrow.abi, 'claim', [BigInt(id), recipient.address, COUNTRY.IN, sig]) });
}

// ───────────────────────────── scenario ─────────────────────────────

async function deploy() {
  const ctorData = (art, types, args) => art.bytecode + encodeAbiParameters(types, args).slice(2);
  const addr = (r) => r.receipt.contractAddress;
  const A = [{ type: 'address' }];
  C.keyRegistry = addr(await send({ label: 'deploy KeyRegistry', group: 'Deploy', data: ART.KeyRegistry.bytecode }));
  // FxReference in simulation mode on the real mock forwarder; the relayer EOA is the transmitter.
  C.fx = addr(await send({ label: 'deploy FxReference', group: 'Deploy', data: ctorData(ART.FxReference, [...A, ...A, ...A, { type: 'uint64' }], [RELAYER.address, SIM_FORWARDER, RELAYER.address, CHAIN_SELECTOR]) }));
  C.factory = addr(await send({ label: 'deploy PlansFactory (deploys ClaimEscrow + Pot impl)', group: 'Deploy', data: ctorData(ART.PlansFactory, [...A, ...A, ...A], [AUSD, C.keyRegistry, C.fx]) }));
  C.send = addr(await send({ label: 'deploy PlansSend', group: 'Deploy', data: ctorData(ART.PlansSend, [...A, ...A], [AUSD, C.fx]) }));
  C.escrow = await call(C.factory, ART.PlansFactory.abi, 'claimEscrow');
  C.potImpl = await call(C.factory, ART.PlansFactory.abi, 'potImplementation');
  await send({ label: 'deploy Pot implementation (standalone)', group: 'Deploy', data: ctorData(ART.Pot, [...A, ...A, ...A, ...A], [AUSD, C.keyRegistry, C.escrow, C.fx]) });
  await send({ label: 'deploy ClaimEscrow (standalone)', group: 'Deploy', data: ctorData(ART.ClaimEscrow, A, [AUSD]) });
}

/**
 * One FxReference round, delivered the way `cre workflow simulate --broadcast` does it: the
 * transmitter calls MockKeystoneForwarder.report(receiver, rawReport, "", []), and the mock calls
 * FxReference.onReport(metadata, payload). rawReport = version | executionId | timestamp | donId |
 * donConfigVersion | workflowCid | workflowName | workflowOwner | reportId | payload.
 */
async function writeFxRound({ scheduledTime, rates = FX_RATES, label, table = true }) {
  const payload = encodeAbiParameters(
    [{ type: 'uint64' }, { type: 'uint64' }, { type: 'uint32' }, { type: 'bytes3[]' }, { type: 'uint64[]' }, { type: 'uint8[]' }],
    [CHAIN_SELECTOR, scheduledTime, 20261006, FX_CCYS, rates, FX_MASKS],
  );
  const raw =
    '0x01' +
    randWord('exec').slice(2) +
    '00000064' +
    '00000001' +
    '00000001' +
    '11'.repeat(32) +
    Buffer.from('5bf1e3a0b2').toString('hex').padEnd(20, '0') +
    'aa'.repeat(20) +
    '0001' +
    payload.slice(2);
  const before = await call(C.fx, ART.FxReference.abi, 'latestRoundId');
  const rec = await send({ label, table, group: 'FxReference', to: SIM_FORWARDER, data: enc(FORWARDER_ABI, 'report', [C.fx, raw, '0x', []]) });
  const after = await call(C.fx, ART.FxReference.abi, 'latestRoundId');
  if (after !== before + 1n) throw new Error(`${label}: the mock forwarder did not deliver the round (FxReference reverted)`);
  return after;
}

async function scenario() {
  await deploy();
  const [u0, u1, u2, u3, u4, u5, u6] = U;

  // ── FxReference: first round (fresh slots everywhere), then a steady-state round ──
  const t0 = await nowTs();
  await writeFxRound({ scheduledTime: t0 - 120n, label: 'FxReference round (first; CRE sim forwarder report, 8 currencies)' });
  const fxRound = await writeFxRound({ scheduledTime: t0 - 60n, rates: FX_RATES.map((r) => r + r / 200n), label: 'FxReference round (next; CRE sim forwarder report, 8 currencies)' });

  // ── Pot A: the main lifecycle, Balanced preset, 4 members ──
  const A = await createPot(u0, { rules: BALANCED(), label: 'createPot (no deposit / permit / key)' });
  await createPot(u4, { rules: BALANCED(), deposit: 100n * USD, safetyNet: 200n * USD, key: true, label: 'createPot (+ 3009 deposit + permit + keyReg)' });
  {
    const pubKey = randWord('x25519');
    const sig = await sign(u5, domain('Plans Keys', C.keyRegistry), 'RegisterKey', { account: u5.address, pubKey, deadline: DEADLINE });
    await send({ label: 'KeyRegistry.register', group: 'Periphery', to: C.keyRegistry, data: enc(ART.KeyRegistry.abi, 'register', [u5.address, pubKey, DEADLINE, sig]) });
  }
  await join(A, u1, { label: 'join (bare)', table: true });
  await join(A, u2, { deposit: 100n * USD, safetyNet: 300n * USD, key: true, label: 'join (+ 3009 deposit + permit + keyReg)', table: true });
  await join(A, u3, { deposit: 50n * USD, label: 'join (+ 3009 deposit only)', table: true });
  await contribute(A, u0, 100n * USD, { label: 'contribute (3009)', table: true });
  await contribute(A, u1, 100n * USD);

  const s1 = await propose(A, u0, { kind: 0, amount: 20n * USD, label: 'propose PAY, instant (executes; 4-way split)', table: true });
  const s2 = await propose(A, u1, { kind: 0, amount: 60n * USD, label: 'propose PAY, needs approval (→ Pending)', table: true });
  await vote(A, u2, s2, true, { label: 'vote approve (reaches threshold → executes PAY)', table: true });
  const s3 = await propose(A, u3, { kind: 2, amount: 15n * USD, label: 'propose PERSONAL, instant', table: true });
  const s4 = await propose(A, u0, { kind: 1, payee: CLAIM_KEYS[0].address, amount: 10n * USD, label: 'propose LINK, instant (→ ClaimEscrow.createFromPot)', table: true });
  const claim1 = await call(C.escrow, ART.ClaimEscrow.abi, 'claimCount');
  await claim(claim1, CLAIM_KEYS[0], RECIPIENT, { label: 'ClaimEscrow.claim (fresh recipient)', table: true });
  await propose(A, u1, { kind: 1, payee: CLAIM_KEYS[1].address, amount: 5n * USD });
  const claimRefund = await call(C.escrow, ART.ClaimEscrow.abi, 'claimCount');
  const s6 = await propose(A, u3, { kind: 0, amount: 50n * USD, label: 'propose PAY (→ Pending), to be cancelled' });
  await cancelSpend(A, u3, s6, { label: 'cancelSpend', table: true });

  // Periphery
  {
    const meta = { to: u6.address, fromCountry: COUNTRY.GB, toCountry: COUNTRY.IN, fromCurrency: '0x474250', toCurrency: '0x494e52', fxRateE8: 11_250_000_000n, fxTimestamp: await nowTs(), fxRoundId: 0n, memoHash: randWord('memo'), salt: randWord('salt') };
    const nonce = keccak256(encodeAbiParameters([TUPLES.sendMeta], [meta]));
    const auth = await auth3009(u5, C.send, 25n * USD, nonce);
    await send({ label: 'PlansSend.send', group: 'Periphery', to: C.send, data: enc(ART.PlansSend.abi, 'send', [u5.address, meta, auth]) });
    const metaFx = { ...meta, to: u3.address, fxRateE8: 12_750_000_000n, fxRoundId: fxRound, salt: randWord('salt') };
    const authFx = await auth3009(u5, C.send, 25n * USD, keccak256(encodeAbiParameters([TUPLES.sendMeta], [metaFx])));
    await send({ label: 'PlansSend.send (with an FX round: reference rate + difference)', group: 'Periphery', to: C.send, data: enc(ART.PlansSend.abi, 'send', [u5.address, metaFx, authFx]) });
    const expiry = (await nowTs()) + 7n * DAY;
    const salt = randWord('salt');
    const n2 = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint64' }, { type: 'bytes2' }, { type: 'bytes32' }], [CLAIM_KEYS[2].address, expiry, COUNTRY.GB, salt]));
    const auth2 = await auth3009(u5, C.escrow, 10n * USD, n2);
    await send({ label: 'ClaimEscrow.createWithAuthorization (send-by-link)', group: 'Escrow', to: C.escrow, data: enc(ART.ClaimEscrow.abi, 'createWithAuthorization', [u5.address, CLAIM_KEYS[2].address, expiry, COUNTRY.GB, salt, auth2]) });
  }

  await postKeyWraps(A, u0, [u1, u2, u3], { label: 'postKeyWraps (3 wraps)', table: true });

  // Disputes
  const d1 = await openDispute(A, u1, s1, 1, { label: 'openDispute', table: true });
  await voteDispute(A, u2, d1, true, { label: 'voteDispute', table: true });
  await voteDispute(A, u3, d1, false);
  await anyone(A, 'finalizeDispute', [BigInt(d1)], { label: 'finalizeDispute (every eligible voter voted; Keep)', table: true });
  const d2 = await openDispute(A, u2, s2, 2);
  await resolveDispute(A, u1, d2, 3, [], [], { label: 'resolveDispute (SpenderCovers)', table: true });
  const d3 = await openDispute(A, u1, s3, 0); // finalized after 48 h below

  // Safety controls
  await freeze(A, u3, { label: 'freeze', table: true });
  await voteUnfreeze(A, u0, { label: 'voteUnfreeze', table: true });
  await voteUnfreeze(A, u1);
  await voteUnfreeze(A, u2, { label: 'voteUnfreeze (majority → lifts freeze)', table: true });

  // Rule change (MAJORITY of 4 = 3 approvals incl. proposer)
  const newRules = rules({ instantMax: 30n * USD, payeePolicy: 2 });
  const rc = await proposeRules(A, u0, newRules, [MERCHANT.address], [], { label: 'proposeRules (+1 allowlist add)', table: true });
  const seqNonce = (BigInt(randWord('seq')) >> 8n) << 8n; // a fresh nonce word, low byte 0
  await voteRules(A, u1, rc, true, { label: 'voteRules', table: true, nonce: seqNonce });
  await voteRules(A, u2, rc, true, { label: 'voteRules (approves → timelock)', table: true });

  await rotateInvite(A, u0, INVITE2, { label: 'rotateInvite', table: true });
  A.invite = INVITE2;

  await exit(A, u2, { label: 'exit (positive net → payout)', table: true });
  await ack(A, u0, { label: 'ack', table: true });
  await ack(A, u1, { label: 'ack (nonce shares a used bitmap word)', table: true, nonce: seqNonce + 1n });

  // ── Settle pots: 3 / 6 / 12 members ──
  // Creator deposits $50 and pays a $30 PAY + a $40 PERSONAL split across everyone (and, for n ≥ 6, member 2
  // pays $20 split across the first half). Odd members deposit nothing but grant a $100 permit safety net
  // (debtors pulled at settle); even members deposit $50 (creditors); the last member joins bare (no
  // deposit, no allowance) so settle leaves a recorded debt.
  const settlePots = {};
  for (const n of [3, 6, 12]) {
    const P = await createPot(U[0], { rules: SETTLE_RULES(), deposit: 50n * USD, label: `createPot settle-${n}`, table: false });
    for (let i = 1; i < n; i++) {
      if (i === n - 1) await join(P, U[i]);
      else if (i % 2 === 1) await join(P, U[i], { safetyNet: 100n * USD });
      else await join(P, U[i], { deposit: 50n * USD });
    }
    await propose(P, U[0], { kind: 0, amount: 30n * USD });
    await propose(P, U[0], { kind: 2, amount: 40n * USD });
    if (n >= 6) await propose(P, U[2], { kind: 0, amount: 20n * USD, members: P.members.slice(0, n / 2).map((m) => m.address) });
    for (const m of P.members) await ack(P, m, n === 12 && m === P.members[11] ? { label: 'ack (12th member of 12: longer member scan)', table: true } : {});
    await anyone(P, 'settle', [], { label: `settle (${n} members)`, table: true });
    settlePots[n] = P;
  }
  // ── collect: a creditor frozen by AUSD at settlement, collected after unfreezing ──
  {
    const P = await createPot(U[0], { rules: SETTLE_RULES(), deposit: 40n * USD, label: 'createPot collect', table: false });
    await join(P, U[1], { deposit: 30n * USD });
    await join(P, U[2], { deposit: 20n * USD });
    for (const m of P.members) await ack(P, m);
    await setFrozen(U[1].address, true);
    await anyone(P, 'settle', [], { label: 'settle (3 members, one creditor frozen: payout skipped)' });
    if ((await call(P.address, ART.Pot.abi, 'netOf', [U[1].address])) !== 30n * USD) throw new Error('expected the frozen creditor to keep a 30 claim');
    await setFrozen(U[1].address, false);
    await anyone(P, 'collect', [U[1].address], { label: 'collect (skipped payout, after AUSD unfreezes)', table: true });
  }
  {
    const P = settlePots[6];
    const debtor = U[5];
    const net = await call(P.address, ART.Pot.abi, 'netOf', [debtor.address]);
    if (net >= 0n) throw new Error('expected a debt in the 6-member pot');
    const auth = await auth3009(debtor, P.address, -net);
    await send({ label: 'payDebt (after settle; 6-member pot)', table: true, to: P.address, data: potCall('payDebt', [debtor.address, auth]) });
  }

  // ── Time-warped steps on Pot A ──
  await warp(3601n, 'rule timelock');
  await anyone(A, 'applyRules', [BigInt(rc)], { label: 'applyRules (after timelock)', table: true });
  await warp(48n * 3600n, 'dispute period');
  await anyone(A, 'finalizeDispute', [BigInt(d3)], { label: 'finalizeDispute (after 48 h; no votes → Keep)', table: true });
  await warp(6n * DAY, 'LINK claim expiry');
  await send({ label: 'ClaimEscrow.refund (pot LINK → Pot.onEscrowRefund)', group: 'Escrow', to: C.escrow, data: enc(ART.ClaimEscrow.abi, 'refund', [claimRefund]) });
}

// ───────────────────────────── modelling ─────────────────────────────

async function analyse(rec) {
  const tx = await anvil('eth_getTransactionByHash', [rec.hash]);
  const block = await anvil('eth_getBlockByNumber', [rec.receipt.blockNumber, false]);
  const parent = hex(BigInt(rec.receipt.blockNumber) - 1n);
  const trace = await anvil('debug_traceTransaction', [rec.hash, { disableStorage: true, enableMemory: false, disableStack: false, enableReturnData: false }]);
  const prestate = await anvil('debug_traceTransaction', [rec.hash, { tracer: 'prestateTracer' }]);
  const pre = {};
  for (const [a, v] of Object.entries(prestate)) pre[lc(a)] = v;
  const original = async (a, slot) => {
    const s = pre[lc(a)]?.storage;
    const k = pad32(slot);
    if (s) for (const [kk, vv] of Object.entries(s)) if (BigInt(kk) === slot) return BigInt(vv);
    return BigInt(await anvil('eth_getStorageAt', [a, k, parent]));
  };
  const m = await reprice({
    logs: trace.structLogs,
    txGas: BigInt(tx.gas),
    from: tx.from,
    to: tx.to,
    created: rec.receipt.contractAddress,
    status: rec.receipt.status === '0x1',
    coinbase: block.miner,
    calldata: tx.input,
    original,
  });
  rec.blockTime = BigInt(block.timestamp);
  rec.prestate = pre;
  rec.model = m;
  rec.steps = trace.structLogs.length;
  if (m.ethGasUsedModel !== rec.gasUsed) log(`WARN ${rec.label}: Ethereum self-check ${m.ethGasUsedModel} ≠ receipt ${rec.gasUsed}`);
  const bad = Object.entries(m.diag).filter(([, v]) => v);
  if (bad.length) log(`WARN ${rec.label}: diagnostics ${JSON.stringify(m.diag)}`);
}

// ───────────────────────────── live ground truth ─────────────────────────────

function overridesFor(rec) {
  const ov = {};
  for (const [a, v] of Object.entries(rec.prestate)) {
    if (a === lc(rec.from)) continue;
    const code = v.code && v.code !== '0x' ? v.code : null;
    const storage = v.storage && Object.keys(v.storage).length ? v.storage : null;
    if (!code && !storage) continue;
    ov[a] = {};
    if (code) ov[a].code = code;
    if (storage) ov[a].stateDiff = storage;
  }
  ov[lc(rec.from)] = { balance: hex(10n ** 24n) };
  return ov;
}

// A creation's own events (e.g. FxReference's constructor) come from the created address, which
// depends on the sender's nonce and so differs between anvil and the live replay: `created` maps
// the anvil address to "whatever this simulation created".
const sameLogs = (a, b, created) =>
  a.length === b.length &&
  a.every((x, i) => (lc(x.address) === lc(b[i].address) || (created && lc(b[i].address) === lc(created))) && x.topics.length === b[i].topics.length && x.topics.every((t, j) => lc(t) === lc(b[i].topics[j])));

async function liveCheck(rec, liveHead) {
  const ov = overridesFor(rec);
  const base = { from: rec.from, data: rec.data, ...(rec.to ? { to: rec.to } : {}), maxFeePerGas: hex(10n ** 12n), maxPriorityFeePerGas: '0x0' };
  const timeOverride = rec.blockTime > liveHead.time ? { time: hex(rec.blockTime) } : null;
  const out = { timeOverride: !!timeOverride };
  if (!timeOverride) {
    try {
      out.estimate = BigInt(await live('eth_estimateGas', [{ from: rec.from, data: rec.data, ...(rec.to ? { to: rec.to } : {}) }, 'latest', ov]));
    } catch (e) {
      out.estimateError = e.message;
    }
  }
  const anvilLogs = rec.receipt.logs;
  let dataMismatch = false;
  const simulate = async (gases) => {
    const block = { stateOverrides: ov, calls: gases.map((g) => ({ ...base, gas: hex(g) })) };
    if (timeOverride) block.blockOverrides = timeOverride;
    const r = await live('eth_simulateV1', [{ blockStateCalls: [block] }, 'latest']);
    return r[0].calls.map((c) => {
      const ok = c.status === '0x1' && sameLogs(c.logs ?? [], anvilLogs, rec.to ? null : rec.receipt.contractAddress);
      if (ok && !(c.logs ?? []).every((l, i) => lc(l.data) === lc(anvilLogs[i].data))) dataMismatch = true;
      return { ok, status: c.status, error: c.error?.message };
    });
  };
  // bracket
  let hi = out.estimate ?? (rec.model.monadMinLimit * 12n) / 10n;
  let lo = 21000n;
  let r = await simulate([hi]);
  while (!r[0].ok) {
    if (hi >= 29_000_000n) {
      out.error = `fails at ${hi}: ${r[0].error ?? r[0].status}`;
      return out;
    }
    lo = hi;
    hi = hi * 2n > 29_000_000n ? 29_000_000n : hi * 2n;
    r = await simulate([hi]);
  }
  const guess = rec.model.monadMinLimit;
  if (guess > lo && guess < hi) {
    // probe just around the model first (cheap when the model is right)
    const r2 = await simulate([guess - 1n]);
    if (r2[0].ok) hi = guess - 1n;
    else {
      lo = guess - 1n;
      const r3 = await simulate([guess]);
      if (r3[0].ok) hi = guess;
      else lo = guess;
    }
  }
  // k-ary search: calls in one block run in order; failed calls leave contract state unchanged, so
  // everything up to and including the first success is a valid probe.
  while (hi - lo > 1n) {
    const k = hi - lo - 1n < 8n ? hi - lo - 1n : 8n;
    const pts = [];
    for (let j = 1n; j <= k; j++) pts.push(lo + ((hi - lo) * j) / (k + 1n));
    const res = await simulate(pts);
    const first = res.findIndex((x) => x.ok);
    if (first === -1) lo = pts[pts.length - 1];
    else {
      hi = pts[first];
      if (first > 0) lo = pts[first - 1];
    }
  }
  out.minLimit = hi;
  out.logDataMismatch = dataMismatch; // only timestamps differ when the block time is not overridden
  return out;
}

// ───────────────────────────── forge gas report ─────────────────────────────

function runForge() {
  if (!CFG.skipBuild) {
    log('forge build');
    const b = spawnSync('forge', ['build'], { cwd: ROOT, encoding: 'utf8' });
    if (b.status !== 0) {
      console.error(b.stdout, b.stderr);
      throw new Error('forge build failed');
    }
  }
  if (!CFG.skipGasReport) {
    log('forge test --gas-report (unit + periphery tests) → tools/gas-report.txt');
    // The fork / invariant suites deploy the same contracts through other paths, which drops the
    // src/ contracts from the combined report, so the report covers the deterministic unit suites.
    const g = spawnSync('forge', ['test', '--gas-report', '--no-match-path', 'test/{fork,invariant}/*'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
    writeFileSync(path.join(TOOLS, 'gas-report.txt'), (g.stdout ?? '') + (g.stderr ?? ''));
    if (g.status !== 0) log('WARN forge test --gas-report exited non-zero (failing tests); the report is still used');
  }
}

function parseGasReport() {
  const file = path.join(TOOLS, 'gas-report.txt');
  if (!existsSync(file)) return null;
  const want = { 'src/Pot.sol:Pot': 'Pot', 'src/PlansFactory.sol:PlansFactory': 'PlansFactory', 'src/ClaimEscrow.sol:ClaimEscrow': 'ClaimEscrow', 'src/KeyRegistry.sol:KeyRegistry': 'KeyRegistry', 'src/PlansSend.sol:PlansSend': 'PlansSend', 'src/FxReference.sol:FxReference': 'FxReference' };
  const out = {};
  let curName = null;
  let inFns = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\|\s*(\S+:\w+) Contract/);
    if (m) {
      curName = want[m[1]] ?? null;
      inFns = false;
      if (curName) out[curName] = { deploy: null, fns: [] };
      continue;
    }
    if (!curName) continue;
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    if (cells[0] === 'Function Name') {
      inFns = true;
      continue;
    }
    if (!inFns && /^\d+$/.test(cells[0] ?? '') && out[curName].deploy == null) out[curName].deploy = { cost: Number(cells[0]), size: Number(cells[1]) };
    if (inFns && cells.length >= 6 && /^\d+$/.test(cells[3])) out[curName].fns.push({ name: cells[0], min: +cells[1], avg: +cells[2], median: +cells[3], max: +cells[4], calls: +cells[5] });
    if (line.startsWith('╰')) curName = null;
  }
  return out;
}

// ───────────────────────────── GAS.md ─────────────────────────────

function suggested(rec) {
  const base = rec.live?.minLimit ?? rec.model.monadMinLimit;
  return roundUp((base * BigInt(Math.round((1 + CFG.margin) * 1000))) / 1000n);
}

function writeReport(meta, gasReport) {
  const rows = records.filter((r) => r.table);
  const L = [];
  const p = (s = '') => L.push(s);
  p('# Plans on Monad: gas');
  p();
  p(`Generated by \`script/monad-gas.mjs\` on ${meta.date}. Re-run end to end with:`);
  p();
  p('```sh');
  p('npm --prefix tools install   # once');
  p('npm --prefix tools run gas   # forge build + gas report, anvil fork, lifecycle, re-pricing, live check → GAS.md');
  p('```');
  p();
  p(`Fork: Monad mainnet (chain ${CHAIN_ID}) block ${meta.forkBlock}, real AUSD \`${AUSD}\`. Live checks: \`${CFG.liveRpc}\` at block ${meta.liveBlock ?? '–'}. Anvil: ${meta.anvilVersion}, hardfork Prague.`);
  p();
  p('## Summary');
  p();
  p('- Monad charges the **gas limit**, not gas used, and has **no refunds**. The number that matters is the limit the relayer or wallet sets, so the table below gives the smallest limit that works (measured on the live chain) and a suggested limit with a ' + Math.round(CFG.margin * 100) + '% margin.');
  {
    const acts = rows.filter((r) => r.group !== 'Deploy').map((r) => ({ r, x: Number(r.model.monadExec) / Number(r.gasUsed) }));
    acts.sort((a, b) => a.x - b.x);
    const med = acts[Math.floor(acts.length / 2)].x;
    p(`- Monad gas / Ethereum gas for the ${acts.length} non-deploy actions: median ${med.toFixed(2)}×, from ${acts[0].x.toFixed(2)}× (${acts[0].r.label}) to ${acts[acts.length - 1].x.toFixed(2)}× (${acts[acts.length - 1].r.label}). Deployments cost about the same as on Ethereum (code deposit and initcode are priced identically; memory is cheaper).`);
  }
  p('- The extra on Monad comes from cold account access (10,100 instead of 2,600 for AUSD, its implementation, KeyRegistry, ClaimEscrow and the Pot implementation behind each clone), ecrecover (6,000 instead of 3,000), and fresh storage (17,000 state growth per new slot: a new nonce bitmap word, a new spend, a fresh AUSD balance or ERC-3009 authorization slot) plus the missing refunds. Reads and writes of the pot\'s own hot state are cheaper than on Ethereum because they all sit on storage page 0: one 8,100 page load, then 100 per access.');
  if (meta.liveSummary) p(`- Ground truth: ${meta.liveSummary}`);
  p();
  p('## Main table');
  p();
  p('Ethereum gas = `gasUsed` of the transaction on the anvil fork (Prague rules, after EIP-3529 refunds). Monad gas (model) = the same transaction re-priced with MONAD_TEN rules and no refunds. Min limit = the smallest gas limit with which the transaction succeeds on Monad (model: 63/64 rule replayed; live: bisected with `eth_simulateV1` on mainnet). Suggested limit = live min limit (model if no live value) + ' + Math.round(CFG.margin * 100) + '%, rounded up to 1,000.');
  p();
  p('| # | Action | Ethereum gas | Monad gas (model) | Monad / Eth | Min limit (model) | Min limit (live) | Suggested gas limit |');
  p('|---|---|---:|---:|---:|---:|---:|---:|');
  rows.forEach((r, i) => {
    p(`| ${i + 1} | ${r.label} | ${fmt(r.gasUsed)} | ${fmt(r.model.monadExec)} | ${(Number(r.model.monadExec) / Number(r.gasUsed)).toFixed(2)}× | ${fmt(r.model.monadMinLimit)} | ${r.live?.minLimit != null ? fmt(r.live.minLimit) : r.live?.error ? 'error' : '–'} | **${fmt(suggested(r))}** |`);
  });
  p();
  p('### Where the Monad difference comes from');
  p();
  p('Per transaction: Monad − Ethereum, split by repriced item. *Refund* is the Ethereum EIP-3529 refund that Monad does not give. Counts: cold accounts (10,100 each on Monad), cold storage pages (8,000/8,100), first writes per page (2,800), new slots (17,000), ecrecover calls (6,000).');
  p();
  p('| Action | Δ storage | Δ cold accounts | Δ precompiles | Δ memory | + Eth refund | cold accts | cold pages | page writes | new slots | ecrecover |');
  p('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    const a = r.model.acc;
    const refund = r.model.ethPreRefund - (r.gasUsed > r.model.floor7623 ? r.gasUsed : r.model.ethPreRefund);
    p(`| ${r.label} | ${signed(a.deltaStorage)} | ${signed(a.deltaAccounts)} | ${signed(a.deltaPrecompiles)} | ${signed(a.deltaMemory)} | ${signed(refund)} | ${a.coldAccounts} | ${a.pageLoads} | ${a.pageWrites} | ${a.stateGrowth} | ${a.ecrecover} |`);
  }
  p();
  p('## Ground truth: model vs live Monad mainnet');
  p();
  p('Each recorded transaction was replayed read-only on the live Monad mainnet RPC with state overrides built from the anvil prestate (`prestateTracer`): the code and touched storage of every contract involved (our contracts are not deployed on mainnet; AUSD\'s touched slots are overridden too) and a balance for the sender. `eth_simulateV1` (k-ary search over the gas limit, success = status 1 **and** the same event topics as on anvil, so a try/catch that swallows an out-of-gas cannot pass) gives the exact minimal limit; `eth_estimateGas` is what a wallet would see (Monad\'s estimator stops within ~1.5% above the minimum). Transactions after a time warp are replayed with a block-time override (`eth_estimateGas` has no block override, so no estimate for those). The deploy rows answer "what does a contract creation cost on Monad" directly.');
  p();
  p('| Action | Ethereum gasUsed | anvil eth_estimateGas (Eth) | Model min limit | Live min limit | Model − live | Live eth_estimateGas | Estimate − live min |');
  p('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    const lv = r.live;
    if (!lv) {
      p(`| ${r.label} | ${fmt(r.gasUsed)} | ${fmt(r.ethEstimate)} | ${fmt(r.model.monadMinLimit)} | – | – | – | – |`);
      continue;
    }
    const diff = lv.minLimit != null ? r.model.monadMinLimit - lv.minLimit : null;
    p(`| ${r.label}${lv.timeOverride ? ' ⏱' : ''} | ${fmt(r.gasUsed)} | ${fmt(r.ethEstimate)} | ${fmt(r.model.monadMinLimit)} | ${lv.minLimit != null ? fmt(lv.minLimit) : 'error: ' + lv.error} | ${diff == null ? '–' : diff === 0n ? '0' : signed(diff)} | ${lv.estimate != null ? fmt(lv.estimate) : '–'} | ${lv.estimate != null && lv.minLimit != null ? signed(lv.estimate - lv.minLimit) + ' (' + pct(lv.estimate, lv.minLimit) + ')' : '–'} |`);
  }
  p();
  p('⏱ = replayed with a block-time override (after `evm_increaseTime` on anvil).');
  p();
  p('**Calibration notes.** (1) Per-frame gas was also compared with live `debug_traceCall` (`callTracer` gives each sub-call\'s `gasUsed` on Monad) and matched the model frame by frame. (2) One early mismatch (162 gas on `createPot` variants) was not a pricing difference: `Pot.initialize` takes a different branch for `startTime < block.timestamp`, and the live replay runs at the live block time (later than anvil\'s). The script now signs `startTime` a minute before inclusion, as an app would, so both take the same branch. Any time-dependent branch (day buckets, expiries) can shift a replay by a few hundred gas; warped transactions get a block-time override for that reason.');
  p();
  p('## Method');
  p();
  p('1. **Lifecycle on an anvil fork.** `anvil --fork-url https://rpc.monad.xyz --disable-code-size-limit --steps-tracing --hardfork prague` (the Pot runtime is ~30 KB, over EIP-170). The script deploys KeyRegistry, FxReference, PlansFactory (whose constructor deploys ClaimEscrow and the Pot implementation) and PlansSend from `out/`, plus a standalone Pot implementation and ClaimEscrow for their creation cost, and runs every action against **real AUSD** (accounts funded by writing AUSD\'s balance mapping, whose base slot the script finds by tracing `balanceOf`). Signatures are built exactly as in `test/utils/PlansSigs.sol` (EIP-712; AUSD ERC-3009 `receiveWithAuthorization` bytes-signature variant and ERC-2612 `permit`, domain `{name: "Agora Dollar", version: "1"}`). Nonces are random 256-bit values, as `docs/protocol.md` tells apps to use. Memos and key wraps use realistic ciphertext sizes (48–120 bytes). Every transaction is sent by one relayer EOA. FxReference rounds go through Chainlink\'s real MockKeystoneForwarder on the fork (`report(receiver, rawReport, "", [])`, the path a CRE CLI simulation takes when it delivers onchain), with the relayer EOA as the configured simulation transmitter; the settles read the fresh round, and the collect row is a creditor frozen through AUSD\'s own flag at settlement and unfrozen before collecting.');
  p('2. **Re-pricing** (`tools/monad-model.mjs`). For each transaction the script fetches `debug_traceTransaction` struct logs (stack on, memory off) and the `prestateTracer` prestate (original slot values), then walks the opcodes keeping a frame stack: storage context per frame (CALL/STATICCALL → callee, DELEGATECALL/CALLCODE → caller; the pot clone DELEGATECALLs into the implementation, so the clone\'s storage is charged against the clone address), EIP-2929 warm accounts (`tx.origin`, `tx.to`/created address, precompiles 0x01–0x11 and 0x100, coinbase; created addresses), Ethereum warm slots, Monad warm `(account, page)` and written pages, per-page state-growth high-water marks, current slot values, and the EIP-3529 refund counter. All of it is journaled and rolled back when a frame reverts (e.g. the try/catch around `permit` and the pulls in `settle`), matching MIP-8 ("if a call reverts, the counters … and sets … must revert"). Frame success is read from the CALL/CREATE result the caller sees.');
  p('   - `ethExec = intrinsic + Σ frame gas consumed` (from the trace, plus the 200 gas/byte code deposit for creations). Self-check: `ethExec − min(refund, ethExec/5)` equals the receipt\'s `gasUsed` for every transaction, and the model\'s own Ethereum SLOAD/SSTORE/account-access/memory costs match each step\'s `gasCost`.');
  p('   - `monadExec = ethExec + Σ (Monad − Ethereum)` over: SLOAD (8,100 first touch of the page, else 100 vs 2,100/100 per slot); SSTORE (100 + 8,000 page load if the page is cold + 2,800 on the first value-changing write to the page + 17,000 when the page\'s net new-slot count reaches a new high, vs EIP-2200/2929 costs); cold account access +7,500 (BALANCE, EXTCODE*, CALL*, DELEGATECALL, STATICCALL, SELFDESTRUCT); precompiles (ecRecover 3,000 → 6,000; ecAdd, ecMul, pairing, point evaluation per the table below); memory expansion (Ethereum `3w + w²/512` → Monad `floor(w/2)` per frame). **Ethereum refunds are not subtracted** (Monad has none).');
  p('   - `monadMinLimit = max(EIP-7623 floor, intrinsic + need(top))`, where `need(frame) = max(Monad gas the frame uses, for each CALL/CREATE: gas used before it + its own cost + A_min(need(child)), for each SSTORE: gas used before it + 2,301)` and `A_min(n)` is the smallest `A` with `A − ⌊A/64⌋ ≥ n` (EIP-150). This is what `eth_estimateGas` searches for.');
  p('3. **Ground truth** on live Monad mainnet: see above. Read-only (`eth_simulateV1`, `eth_estimateGas`).');
  p(`4. **Suggested gas limit** = live min limit (or model) × ${(1 + CFG.margin).toFixed(2)}, rounded up to 1,000. The margin covers state-dependent variation: a fresh nonce bitmap word vs a used one (−17,000 to −28,000), recipients without an AUSD balance slot (+17,000 + 2,800), pot size (member scans and split loops are ~100 gas per member, settle is ~linear in members), first vs repeat page touches. For exact limits per call, a relayer can run \`eth_estimateGas\` (it already lands ≤1.5% above the minimum) and add a small fixed buffer.`);
  p();
  p('### Monad pricing facts used (MONAD_TEN, active on mainnet since 2026-09-02 14:30 UTC)');
  p();
  p('| Item | Ethereum | Monad | Source |');
  p('|---|---|---|---|');
  p('| Cold account access (BALANCE, EXTCODE*, CALL*, DELEGATECALL, STATICCALL, SELFDESTRUCT) | 2,600 | 10,100 | [opcode pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing#cold-access-cost) |');
  p('| Warm account / storage access | 100 | 100 | same |');
  p('| SLOAD | 2,100 cold slot / 100 | 8,100 first access to the 128-slot page (`page = slot >> 7`, warm per (account, page) per tx) / 100 | [storage pages](https://docs.monad.xyz/developer-essentials/opcode-pricing#storage-pages), [MIP-8](https://mips.monad.xyz/MIPs/MIP-8) |');
  p('| SSTORE | 20,000 new slot / 2,900 modify (+2,100 cold), refunds | 100 + 8,000 page load (first access) + 2,800 page write (first value-changing write to the page) + 17,000 state growth (per new slot, high-water mark per page) | same; `category/vm/runtime/storage.cpp`, `state3/page_tracker.hpp` in [category-labs/monad](https://github.com/category-labs/monad) |');
  p('| Gas refunds (SSTORE clears, EIP-3529) | up to gasUsed/5 | **none**: `compute_gas_refund` returns 0 since MONAD_ONE, and the MIP-8 SSTORE path adds no refund | `category/execution/monad/monad_transaction_gas.cpp`, `category/vm/runtime/storage.cpp` |');
  p('| Gas charged | gas used | **gas limit** (`gas_paid = gas_limit × price_per_gas`) | [gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing#gas-limit-not-gas-used), [differences](https://docs.monad.xyz/developer-essentials/differences) |');
  p('| ecRecover / ecAdd / ecMul / ecPairing / blake2f / point eval | 3,000 / 150 / 6,000 / 45,000+34,000k / rounds / 50,000 | 6,000 / 300 / 30,000 / 225,000+170,000k / 2×rounds / 200,000 | [precompiles](https://docs.monad.xyz/developer-essentials/opcode-pricing#precompiles) |');
  p('| Memory expansion | 3w + w²/512 | w/2 (`memory_cost = words // 2`), 8 MB cap per tx | [memory](https://docs.monad.xyz/developer-essentials/opcode-pricing#memory-expansion), [MIP-3](https://github.com/monad-crypto/MIPs/blob/main/MIPs/MIP-3.md) (MONAD_NINE) |');
  p('| Intrinsic gas, calldata (4/16), EIP-7623 floor (10/40), access lists, CREATE 32,000, initcode 2/word, code deposit 200/byte | same | same | `transaction_gas.cpp`, `execute_message.cpp` (`deploy_contract_code`: 200 × size) |');
  p('| Max code size / initcode | 24,576 / 49,152 | 128 KB / 256 KB | [differences](https://docs.monad.xyz/developer-essentials/differences) |');
  p('| Per-tx gas limit | – | 30M | [gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing) |');
  p('| MONAD_TEN activation (mainnet) | – | timestamp 1788359400 (2026-09-02 14:30 UTC) | [releases v0.16.1](https://docs.monad.xyz/developer-essentials/changelog/releases), [changelog](https://docs.monad.xyz/developer-essentials/changelog) |');
  p();
  p('All other opcode costs are as on Ethereum. The live `eth_call` probe in development confirmed the page rule exactly (two SLOADs in one page: 21,000 + 8,210; two fresh SSTOREs in one page: 21,000 + 27,900 + 17,100 + 12).');
  p();
  p('## Why the Pot is cheap where it is (from the NatSpec in `src/Pot.sol` and `src/libraries/AuthLib.sol`)');
  p();
  p(`- **Page 0 holds all hot state.** Schedule, flags, counters, member bitmaps (\`_activeMask\`, \`_metMinMask\`, \`_ackedMask\`, \`_unfreezeMask\`), \`inviteSigner\`, the Rules, \`_categorySpent\`, \`_members[50]\` (address + int96 net in one slot), \`_memberStates[50]\` and \`_lastFreezeAt\` are declared before any mapping and occupy slots 1–${meta.lastHotSlot ?? 118} (slot 0 is the \`_nonces\` mapping root). One cold page load (8,100) covers the whole pot; every further read is 100, and writes cost 100 each after the page\'s first value-changing write (2,800), plus 17,000 only for a slot that becomes non-zero for the first time (e.g. a new member\'s entry). On Ethereum the same state costs 2,100 per distinct slot touched.`);
  p('- **Members are found by scanning** `_members` on page 0 (≤ 50 warm reads at ~100 gas each) instead of an address-keyed mapping, which would cost a cold page (8,100) per lookup.');
  p('- **Hashed state is one page per entry.** A spend (`_spends[id]`: packed header, payee, 9 split words), a dispute or a rule change lives under one mapping key, so its fields share a page (unless its 11 slots straddle a page boundary: ~8% of spend ids). A new spend therefore pays one cold page + one page write + one state growth per new slot.');
  p('- **Nonces are a bitmap**: `words[account][nonce >> 8]`, 256 nonces per slot. With random 256-bit nonces (what apps use) every signed action creates a new word in a new page: 8,000 + 2,800 + 17,000 ≈ 27,900 gas of the action\'s cost on Monad. Nonces that share the upper 248 bits with an already used one cost a cold page read/write only (compare "ack" with "ack (nonce shares a used bitmap word)").');
  p('- **ecrecover first**: `AuthLib.isValidSignatureNowCalldata` tries `ecrecover` (6,000 on Monad) before the ERC-1271 path, skipping the up-front EXTCODESIZE (a 10,100 cold account access) that Solady\'s checker does for every signer.');
  p('- **What still costs**: every external contract touched for the first time in a transaction is a 10,100 cold account access (AUSD proxy + implementation, KeyRegistry, ClaimEscrow, the factory, the Pot implementation behind each clone), and fresh AUSD balance slots / allowance slots / ERC-3009 authorization-state slots are new pages with state growth.');
  p();
  p('## Caveats');
  p();
  p('- The model and the live replay use the same transactions and state, so they agree on what a given call does; actual cost depends on state (fresh vs existing nonce words and balance slots, number of members, number of debtors/creditors at settle). The suggested limits include a margin for that, not for arbitrary pot sizes: settle grows with members (see the 3/6/12 rows).');
  p('- Ethereum gas in this file is Prague rules on the anvil fork with real AUSD; the forge gas report in the appendix uses `MockAUSD` and isolated test calls, so its numbers differ.');
  p('- Out-of-gas inside a frame consumes all of that frame\'s gas; the model assumes no frame runs out of gas (true for every recorded transaction).');
  p('- Monad\'s `eth_estimateGas` result is not exact (binary search stops within ~1.5%); the live min-limit column is exact.');
  p();
  if (gasReport) {
    p('## Appendix: `forge test --gas-report` medians (Ethereum gas, MockAUSD)');
    p();
    p('Raw report: `tools/gas-report.txt` (unit and periphery suites). Median gas per external function, as reported by forge; Pot functions are called through clones.');
    p();
    for (const [name, c] of Object.entries(gasReport)) {
      p(`**${name}**${c.deploy?.cost ? ` (deployment ${fmt(c.deploy.cost)} gas, ${fmt(c.deploy.size)} bytes)` : ''}`);
      p();
      p('| Function | Median | Min | Max | Calls |');
      p('|---|---:|---:|---:|---:|');
      for (const f of c.fns) p(`| ${f.name} | ${fmt(f.median)} | ${fmt(f.min)} | ${fmt(f.max)} | ${f.calls} |`);
      p();
    }
  }
  writeFileSync(path.join(ROOT, 'GAS.md'), L.join('\n'));
}

// ───────────────────────────── main ─────────────────────────────

async function main() {
  runForge();
  ART = { Pot: artifact('Pot'), PlansFactory: artifact('PlansFactory'), ClaimEscrow: artifact('ClaimEscrow'), KeyRegistry: artifact('KeyRegistry'), PlansSend: artifact('PlansSend'), FxReference: artifact('FxReference') };
  const initP = ART.Pot.abi.find((x) => x.type === 'function' && x.name === 'initialize').inputs[1];
  const wrapsP = ART.Pot.abi.find((x) => x.type === 'function' && x.name === 'postKeyWraps').inputs[1];
  const sendP = ART.PlansSend.abi.find((x) => x.type === 'function' && x.name === 'send').inputs[1];
  TUPLES = { params: initP, rules: initP.components.find((c) => c.name === 'rules'), wraps: wrapsP, sendMeta: sendP };

  const stop = await startAnvil();
  try {
    const chain = Number(await anvil('eth_chainId'));
    if (chain !== CHAIN_ID) throw new Error(`anvil chain id ${chain}, expected ${CHAIN_ID}`);
    const forkBlock = BigInt(await anvil('eth_blockNumber'));
    T0 = await nowTs();
    DEADLINE = T0 + 60n * DAY;
    await anvil('anvil_setBalance', [RELAYER.address, hex(10n ** 24n)]);
    await anvil('anvil_impersonateAccount', [RELAYER.address]);
    const ds = await call(AUSD, AUSD_ABI, 'DOMAIN_SEPARATOR');
    const mine = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }], [keccak256(toHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')), keccak256(toHex('Agora Dollar')), keccak256(toHex('1')), BigInt(CHAIN_ID), AUSD]));
    if (ds !== mine) throw new Error('AUSD domain separator mismatch');
    BAL_BASE = await findAusdBalanceBase();
    log('AUSD balance mapping base', BAL_BASE);
    for (const u of [...U, MERCHANT]) await fundAusd(u.address, 10_000n * USD);

    await scenario();

    log(`re-pricing ${records.filter((r) => r.table).length} transactions`);
    for (const r of records.filter((x) => x.table)) await analyse(r);

    const meta = { date: new Date().toISOString().slice(0, 10), forkBlock: forkBlock.toString(), anvilVersion: spawnSync('anvil', ['--version'], { encoding: 'utf8' }).stdout.split('\n')[0] };
    try {
      // last slot used by the Pot's non-mapping (page-0) state, for the "why" section
      const layout = JSON.parse(spawnSync('forge', ['inspect', 'Pot', 'storageLayout', '--json'], { cwd: ROOT, encoding: 'utf8' }).stdout);
      meta.lastHotSlot = Math.max(...layout.storage.filter((v) => !v.type.startsWith('t_mapping')).map((v) => Number(v.slot) + Math.ceil(Number(layout.types[v.type].numberOfBytes) / 32) - 1));
    } catch {}
    if (!CFG.skipLive) {
      const head = await live('eth_getBlockByNumber', ['latest', false]);
      meta.liveBlock = BigInt(head.number).toString();
      const liveHead = { time: BigInt(head.timestamp) };
      log('live ground truth on', CFG.liveRpc);
      for (const r of records.filter((x) => x.table && (!process.env.ONLY || new RegExp(process.env.ONLY).test(x.label)))) {
        try {
          r.live = await liveCheck(r, liveHead);
        } catch (e) {
          r.live = { error: e.message.slice(0, 120) };
        }
        log(`  ${r.label}: model ${r.model.monadMinLimit} live ${r.live.minLimit ?? r.live.error} est ${r.live.estimate ?? '–'}`);
      }
      const ok = records.filter((r) => r.table && r.live?.minLimit != null);
      const exact = ok.filter((r) => r.model.monadMinLimit === r.live.minLimit).length;
      const maxDev = ok.reduce((m, r) => Math.max(m, Math.abs(Number(r.model.monadMinLimit - r.live.minLimit))), 0);
      meta.liveSummary = `${ok.length} transactions replayed on live Monad mainnet; the model's minimum gas limit matches the live minimum exactly for ${exact} of them${exact < ok.length ? ` (largest deviation ${fmt(maxDev)} gas)` : ''}.`;
    }
    const gasReport = parseGasReport();
    writeReport(meta, gasReport);
    const json = records.map((r) => ({ label: r.label, table: r.table, hash: r.hash, to: r.to, ethGasUsed: r.gasUsed, ethEstimate: r.ethEstimate, model: r.model && { ...r.model, acc: { ...r.model.acc, coldAccountList: undefined } }, live: r.live }));
    writeFileSync(path.join(TOOLS, 'gas-results.json'), JSON.stringify({ meta, contracts: C, records: json }, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
    log('wrote GAS.md and tools/gas-results.json');
  } finally {
    stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
