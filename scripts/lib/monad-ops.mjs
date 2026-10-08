// Shared plumbing for the mainnet operations scripts (fund-demo, claim-links, judges-plan,
// return-funds). Same rules as contracts/script/monad-send.mjs:
//
//   - Every gas limit comes from eth_estimateGas on the RPC this run is connected to, for exactly the
//     transaction being signed, from its sender, with no state override: Monad estimate + 10 %,
//     rounded up to 1,000 (gasLimitFromEstimate). A quote is a frozen object that only this module
//     issues; signing refuses anything else.
//   - A run connects either to a Monad node (kind "monad": chain 143 or 10143, not anvil/hardhat/
//     ganache/tenderly) or, only with --fork, to a LOCAL anvil fork (kind "anvil-fork": 127.0.0.1 or
//     localhost, web3_clientVersion says anvil). An anvil estimate is anvil's, not Monad's: it is
//     accepted only for fork tests. Signing for chain 143 refuses a quote whose source is not
//     "monad" unless the connection is a verified local anvil fork, and a quote can only be sent on
//     the connection that issued it.
//   - Two steps: `check` sends nothing and prints a fingerprint; `send --confirm <fingerprint>`
//     rebuilds the plan, refuses if the fingerprint differs, then sends.
//   - Keys are read from an env-format file (default ../secrets/keys.env, outside the repo) and are
//     never printed or written.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const SECRETS = path.resolve(REPO, '..', 'secrets');
export const CONTRACTS = path.join(REPO, 'contracts');
const VIEM = path.join(CONTRACTS, 'tools', 'node_modules', 'viem', '_esm');
if (!existsSync(VIEM)) {
  console.error('viem not installed: run `npm --prefix contracts/tools install` (from the repo root) first');
  process.exit(1);
}
export const V = await import(pathToFileURL(path.join(VIEM, 'index.js')).href);
export const VA = await import(pathToFileURL(path.join(VIEM, 'accounts', 'index.js')).href);
const MS = await import(pathToFileURL(path.join(CONTRACTS, 'script', 'monad-send.mjs')).href);
export const { gasLimitFromEstimate, makeRpc, sendRaw, MONAD_RPC, MONAD_MIN_BASE_FEE } = MS;
const { keccak256, toHex, getAddress, parseTransaction, encodeFunctionData, decodeFunctionResult, parseAbi, formatEther, formatUnits } = V;

export const AUSD = { 143: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a', 10143: '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC' };
export const RESERVE_BLOCKS = 3; // Monad reserve-balance window k
export const lc = (s) => String(s).toLowerCase();
export const hex = (n) => '0x' + BigInt(n).toString(16);
export const mon = (wei) => `${formatEther(wei)} MON`;
export const usd = (units) => {
  const [i, f = ''] = formatUnits(units, 6).split('.');
  return `$${i}.${f.padEnd(2, '0')}`;
};
export const num = (n) => BigInt(n).toLocaleString('en-US');
export const gwei = (wei) => `${Number(wei) / 1e9} gwei`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const AUSD_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)',
  'function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)',
]);

// ───────────────────────────── connection ─────────────────────────────

/**
 * Connects and classifies the RPC. Without `fork` it must be a Monad node for `chainId` (143/10143);
 * with `fork` it must be a local anvil (whose chain id must still be `chainId`, as a fork of it).
 */
export async function connect({ chainId, rpcUrl, fork = false, rpc: injected }) {
  chainId = Number(chainId);
  if (!MONAD_RPC[chainId]) throw new Error(`chain ${chainId} is not Monad (143 or 10143)`);
  const url = rpcUrl ?? MONAD_RPC[chainId];
  const rpc = injected ?? makeRpc(url);
  const live = Number(BigInt(await rpc('eth_chainId', [])));
  if (live !== chainId) throw new Error(`RPC ${url} is chain ${live}, expected ${chainId}`);
  let client = '';
  try {
    client = String(await rpc('web3_clientVersion', []));
  } catch {
    /* optional on some providers */
  }
  const isAnvil = /anvil/i.test(client);
  const isOtherSim = /hardhat|ganache|tenderly/i.test(client);
  let kind;
  if (fork) {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      /* not a URL */
    }
    if (!isAnvil || !['127.0.0.1', 'localhost'].includes(host)) throw new Error(`--fork needs a LOCAL anvil fork (got ${client || 'unknown client'} at ${url})`);
    kind = 'anvil-fork';
  } else {
    if (isAnvil || isOtherSim) throw new Error(`RPC is ${client}, not a Monad node: its eth_estimateGas is not Monad's (use --fork only for local fork tests)`);
    kind = 'monad';
  }
  return Object.freeze({ rpc, url, chainId, kind, client });
}

// ───────────────────────────── gas: the RPC's own estimator only ─────────────────────────────

const issued = new WeakSet();
const sameTx = (a, b) => lc(a.from) === lc(b.from) && lc(a.to) === lc(b.to) && lc(a.data ?? '0x') === lc(b.data ?? '0x') && BigInt(a.value ?? 0) === BigInt(b.value ?? 0);

/** eth_estimateGas on `conn` for exactly `tx`, from its sender, no state override. */
export async function gasQuote(conn, tx) {
  const req = { from: tx.from, to: tx.to, ...(tx.data && tx.data !== '0x' ? { data: tx.data } : {}), ...(BigInt(tx.value ?? 0) ? { value: hex(tx.value) } : {}) };
  const estimate = BigInt(await conn.rpc('eth_estimateGas', [req, 'latest']));
  const q = Object.freeze({ estimate, gasLimit: gasLimitFromEstimate(estimate), source: conn.kind, conn, tx: Object.freeze({ ...tx, data: tx.data ?? '0x', value: BigInt(tx.value ?? 0) }) });
  issued.add(q);
  return q;
}

/** Signs `tx` with `quote`'s limit. Refuses foreign quotes, other txs, other connections and, on chain 143, non-Monad estimates outside a local fork. */
export async function signWithQuote(conn, account, quote, tx, { nonce, fees }) {
  if (!issued.has(quote)) throw new Error('refusing to sign: gas limit did not come from gasQuote (the RPC\'s eth_estimateGas)');
  if (quote.conn !== conn) throw new Error('refusing to sign: gas quote came from a different RPC connection');
  if (!sameTx(quote.tx, { ...tx, from: account.address })) throw new Error('refusing to sign: gas quote was estimated for a different transaction or sender');
  if (quote.source !== 'monad' && !(conn.kind === 'anvil-fork' && quote.source === 'anvil-fork')) throw new Error(`refusing to sign: gas limit came from ${quote.source}, not a Monad RPC`);
  if (conn.chainId === 143 && conn.kind !== 'anvil-fork' && quote.source !== 'monad') throw new Error('refusing to sign for Monad mainnet: gas limit did not come from a Monad RPC');
  const raw = await account.signTransaction({
    chainId: conn.chainId,
    type: 'eip1559',
    to: tx.to,
    data: tx.data ?? '0x',
    value: BigInt(tx.value ?? 0),
    nonce,
    gas: quote.gasLimit,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  if (parseTransaction(raw).gas !== quote.gasLimit) throw new Error('signed gas limit differs from the quote');
  return raw;
}

/** Base fee (floored at Monad's 100 gwei), tip, and maxFee = base * 1.25 + tip. */
export async function fees(conn, tipWei = 2_000_000_000n) {
  const b = await conn.rpc('eth_getBlockByNumber', ['latest', false]);
  const reported = b?.baseFeePerGas ? BigInt(b.baseFeePerGas) : 0n;
  const base = reported > MONAD_MIN_BASE_FEE ? reported : MONAD_MIN_BASE_FEE;
  return { baseFee: base, maxFeePerGas: base + base / 4n + tipWei, maxPriorityFeePerGas: tipWei };
}

/** Quote (fresh), sign and send one transaction; throws unless it succeeded. */
export async function sendTx(conn, account, txIn, { tipWei, state = { sync: true }, waitOpts } = {}) {
  const { quote, fees: feesIn, ...tx } = txIn;
  const full = { ...tx, from: account.address };
  const q = quote ?? (await gasQuote(conn, full));
  const nonce = Number(BigInt(await conn.rpc('eth_getTransactionCount', [account.address, 'pending'])));
  const f = feesIn ?? (await fees(conn, tipWei));
  const raw = await signWithQuote(conn, account, q, full, { nonce, fees: f });
  const { receipt, hash } = await sendRaw(conn.rpc, raw, state, waitOpts);
  if (receipt.status !== '0x1') throw new Error(`transaction ${hash} reverted`);
  return { hash, receipt, quote: q, nonce };
}

// ───────────────────────────── reads ─────────────────────────────

export async function call(conn, to, abi, functionName, args = []) {
  const r = await conn.rpc('eth_call', [{ to, data: encodeFunctionData({ abi, functionName, args }) }, 'latest']);
  return decodeFunctionResult({ abi, functionName, data: r });
}
export const balance = async (conn, a) => BigInt(await conn.rpc('eth_getBalance', [a, 'latest']));
export const ausdBalance = (conn, a) => call(conn, AUSD[conn.chainId], AUSD_ABI, 'balanceOf', [a]);
export const code = async (conn, a) => String(await conn.rpc('eth_getCode', [a, 'latest']));
export const hasCode = async (conn, a) => {
  const c = await code(conn, a);
  return c !== '0x' && c !== '0x0';
};
export const blockNumber = async (conn) => Number(BigInt(await conn.rpc('eth_blockNumber', [])));
export const nonceOf = async (conn, a, tag = 'latest') => Number(BigInt(await conn.rpc('eth_getTransactionCount', [a, tag])));

let domainCache;
export async function ausdDomain(conn) {
  if (!domainCache) {
    const d = await call(conn, AUSD[conn.chainId], AUSD_ABI, 'eip712Domain');
    domainCache = { name: d[1], version: d[2] || '1' };
  }
  return { ...domainCache, chainId: conn.chainId, verifyingContract: AUSD[conn.chainId] };
}

/** ERC-3009 TransferWithAuthorization signed by `from` (an account), to `to`, valid for `ttl` seconds. */
export async function transferAuthCalldata(conn, from, to, value, { ttl = 3600, nonce } = {}) {
  const domain = await ausdDomain(conn);
  const validBefore = (await chainNow(conn)) + BigInt(ttl);
  const n = nonce ?? randomHex32();
  const message = { from: from.address, to, value, validAfter: 0n, validBefore, nonce: n };
  const signature = await from.signTypedData({
    domain,
    types: { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
    primaryType: 'TransferWithAuthorization',
    message,
  });
  return encodeFunctionData({ abi: AUSD_ABI, functionName: 'transferWithAuthorization', args: [from.address, to, value, 0n, validBefore, n, signature] });
}

/** ERC-3009 ReceiveWithAuthorization (to = the contract that pulls) signed by `from`. Returns the Auth3009 struct. */
export async function receiveAuth(conn, from, to, value, { ttl = 3600, nonce, validBefore } = {}) {
  const domain = await ausdDomain(conn);
  const vb = validBefore ?? (await chainNow(conn)) + BigInt(ttl);
  const n = nonce ?? randomHex32();
  const signature = await from.signTypedData({
    domain,
    types: { ReceiveWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
    primaryType: 'ReceiveWithAuthorization',
    message: { from: from.address, to, value, validAfter: 0n, validBefore: vb, nonce: n },
  });
  return { value, validAfter: 0n, validBefore: vb, nonce: n, signature };
}

/** The latest block's timestamp (follows a fork's warped clock). */
export async function chainNow(conn) {
  const b = await conn.rpc('eth_getBlockByNumber', ['latest', false]);
  return BigInt(b.timestamp);
}

export const randomHex32 = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

// ───────────────────────────── keys ─────────────────────────────

export const DEFAULT_KEYS_FILE = path.join(SECRETS, 'keys.env');

/**
 * Reads NAME=0x<64 hex> lines from an env-format file and returns { NAME: account }. Lines whose
 * value is not a 32-byte key (e.g. ANDROID_KEYSTORE_PASSWORD) are ignored. Values are never printed.
 */
export function loadKeys(file = DEFAULT_KEYS_FILE) {
  if (!existsSync(file)) throw new Error(`no keys file at ${file}`);
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2].replace(/^["']|["']$/g, '');
    if (!v.startsWith('0x')) v = '0x' + v;
    if (!/^0x[0-9a-fA-F]{64}$/.test(v)) continue;
    try {
      out[m[1]] = VA.privateKeyToAccount(v);
    } catch {
      throw new Error(`key ${m[1]} in ${file} is invalid (value hidden)`);
    }
  }
  return out;
}

export function need(keys, name, file) {
  const a = keys[name];
  if (!a) throw new Error(`${name} missing from ${file ?? 'the keys file'}`);
  return a;
}

// ───────────────────────────── deployments ─────────────────────────────

export function loadDeployment(chainId, file) {
  const f = file ?? path.join(CONTRACTS, 'deployments', `${chainId}.json`);
  if (!existsSync(f)) throw new Error(`no deployment file ${f}: deploy first (docs/mainnet-launch.md)`);
  const d = JSON.parse(readFileSync(f, 'utf8'));
  if (Number(d.chainId) !== Number(chainId)) throw new Error(`${f} is for chain ${d.chainId}, not ${chainId}`);
  if (lc(d.ausd) !== lc(AUSD[chainId])) throw new Error(`${f}: ausd ${d.ausd} is not AUSD on chain ${chainId}`);
  return { ...d, file: f };
}

// ───────────────────────────── cli ─────────────────────────────

export function parseArgs(argv, flags = ['fork']) {
  const [mode, ...rest] = argv;
  const o = { mode };
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`);
    const name = k.slice(2);
    if (flags.includes(name)) o[name] = true;
    else {
      if (i + 1 >= rest.length) throw new Error(`${k} needs a value`);
      o[name] = rest[++i];
    }
  }
  return o;
}

export const tipFrom = (a) => BigInt(Math.round(Number(a['tip-gwei'] ?? 2) * 1e9));

/** Identifies a plan by its meaning (never by random nonces or signatures). */
export function fingerprintOf(body) {
  const s = JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : v));
  return keccak256(toHex(s)).slice(0, 10);
}

/** The `send` command line to print after a check: no comments, zsh-safe. */
export function sendCommand(script, a, fp, extra = []) {
  const parts = ['node', script, 'send', '--chain', String(a.chain ?? 143)];
  if (a.rpc) parts.push('--rpc', a.rpc);
  if (a.fork) parts.push('--fork');
  for (const k of extra) if (a[k] !== undefined && a[k] !== true) parts.push(`--${k}`, String(a[k]));
  parts.push('--confirm', fp);
  return parts.join(' ');
}

export function printHeader(out, title, conn, rows) {
  out(`${title}: CHECK (nothing is sent)`);
  out('');
  out(`  chain id        ${conn.chainId}${conn.kind === 'anvil-fork' ? '  (LOCAL ANVIL FORK: test run, anvil estimates)' : ''}`);
  out(`  rpc             ${conn.url} (${conn.client || 'client unknown'})`);
  for (const [k, v] of rows) out(`  ${k.padEnd(15)} ${v}`);
  out(`  gas limits      ${conn.kind === 'monad' ? 'Monad' : 'anvil (fork test only)'} eth_estimateGas from each sender + 10 %, rounded up to 1,000; re-estimated right before signing`);
  out('');
}

export function runMain(fn, name) {
  fn().catch((e) => {
    console.error(`${name}: ${e.message}`);
    process.exit(1);
  });
}

export { getAddress };

// ───────────────────────────── step runner (check / send) ─────────────────────────────

/**
 * A step is { label, sender (account), lines?: string[], build: async () => ({ to, data, value }),
 * deferred?: true (its estimate needs earlier steps on chain), after?: async (sent) => void }.
 *
 * check: builds every step; estimates each non-deferred one on the connected RPC; deferred steps are
 * simulated together with the earlier ones through eth_simulateV1 on the same RPC (a projection only:
 * the real limit is estimated right before signing). Prints everything and returns the report.
 * send: requires `confirm === fingerprint`, then for each step builds it fresh, estimates, signs, sends.
 */
export async function checkSteps({ conn, steps, tipWei, out = console.log }) {
  const f = await fees(conn, tipWei);
  const rows = [];
  const built = [];
  for (const s of steps) {
    const { quote: _q, fees: _f, ...b } = await s.build();
    const tx = { ...b, from: s.sender.address };
    built.push(tx);
    const row = { s, tx };
    if (!s.deferred) {
      try {
        row.quote = await gasQuote(conn, tx);
        row.limit = row.quote.gasLimit;
      } catch (e) {
        row.error = e.message;
      }
    }
    rows.push(row);
  }
  if (rows.some((r) => r.s.deferred)) {
    try {
      const calls = built.map((t) => ({ from: t.from, to: t.to, data: t.data ?? '0x', ...(BigInt(t.value ?? 0) ? { value: hex(t.value) } : {}) }));
      const res = await conn.rpc('eth_simulateV1', [{ blockStateCalls: [{ calls }], validation: false }, 'latest']);
      const results = res?.[0]?.calls ?? [];
      rows.forEach((r, i) => {
        const c = results[i];
        if (!r.s.deferred || !c) return;
        if (c.status !== '0x1') r.error = `simulation failed: ${c.error?.message ?? c.returnData ?? 'reverted'}`;
        else {
          r.simulated = BigInt(c.gasUsed);
          r.limit = gasLimitFromEstimate(r.simulated);
        }
      });
    } catch (e) {
      rows.forEach((r) => {
        if (r.s.deferred && !r.error) r.note = `not simulated (${e.message.slice(0, 80)}); estimated right before signing`;
      });
    }
  }
  const bySender = new Map();
  rows.forEach((r, i) => {
    r.maxCost = (r.limit ?? 0n) * f.maxFeePerGas;
    const k = r.s.sender.address;
    bySender.set(k, (bySender.get(k) ?? 0n) + r.maxCost);
    out(`  [${i + 1}] ${r.s.label}`);
    out(`      from            ${r.s.sender.address}`);
    out(`      to              ${r.tx.to}${r.tx.data && r.tx.data !== '0x' ? `  selector ${r.tx.data.slice(0, 10)}` : ''}`);
    if (BigInt(r.tx.value ?? 0)) out(`      value           ${mon(r.tx.value)}`);
    for (const l of r.s.lines ?? []) out(`      ${l}`);
    if (r.error) out(`      status          FAILED: ${r.error}`);
    else if (r.quote) out(`      estimate        ${num(r.quote.estimate)} (${conn.kind === 'monad' ? 'Monad' : 'anvil fork'}), gas limit ${num(r.quote.gasLimit)}, max cost ${mon(r.maxCost)}`);
    else if (r.simulated !== undefined) out(`      simulated       ${num(r.simulated)} gas used after the earlier steps (eth_simulateV1), projected limit ${num(r.limit)}, max cost ${mon(r.maxCost)}; re-estimated right before signing`);
    else if (r.note) out(`      gas             ${r.note}`);
  });
  out('');
  out(`  fees            base ${gwei(f.baseFee)}, tip ${gwei(f.maxPriorityFeePerGas)}, maxFee ${gwei(f.maxFeePerGas)} (Monad charges the full gas limit)`);
  const short = [];
  for (const [addr, cost] of bySender) {
    const bal = await balance(conn, addr);
    out(`  gas payer       ${addr}: max ${mon(cost)}, balance ${mon(bal)}${bal < cost ? '  INSUFFICIENT' : ''}`);
    if (bal < cost) short.push(addr);
  }
  const errors = rows.filter((r) => r.error);
  return { rows, errors, short, fees: f };
}

export async function sendSteps({ conn, steps, tipWei, out = console.log }) {
  const state = { sync: true };
  const sent = [];
  for (const s of steps) {
    if (s.skipIf && (await s.skipIf())) {
      out(`  ${s.label}: skipped (${s.skipReason ?? 'nothing to do'})`);
      continue;
    }
    if (s.before) await s.before();
    const tx = await s.build();
    const r = await sendTx(conn, s.sender, tx, { tipWei, state });
    out(`  ${s.label}: ${r.hash} (block ${BigInt(r.receipt.blockNumber)}, estimate ${num(r.quote.estimate)}, limit ${num(r.quote.gasLimit)}, used ${num(r.receipt.gasUsed)})`);
    const rec = { label: s.label, hash: r.hash, block: Number(BigInt(r.receipt.blockNumber)), gasLimit: r.quote.gasLimit.toString(), gasUsed: BigInt(r.receipt.gasUsed).toString(), receipt: r.receipt };
    sent.push(rec);
    if (s.after) await s.after(rec);
  }
  return sent;
}

export function readyLine(out, report, cmd) {
  out('');
  if (report.errors.length) out('  Not ready: fix the failed steps above, then run check again.');
  else if (report.short.length) out(`  Not ready: fund ${report.short.join(', ')} with MON for gas, then run check again.`);
  else out('  Verify every line above. Then send with:');
  out('');
  out(`  ${cmd}`);
}

export const isMain = (url) => Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(url);
