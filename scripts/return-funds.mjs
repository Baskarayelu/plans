#!/usr/bin/env node
// ONE COMMAND to return every recoverable dollar and MON to the treasury and the deployer.
//
//   node scripts/return-funds.mjs check
//   node scripts/return-funds.mjs send --confirm <fingerprint printed by check>
//
// Accounts are the keys in ../secrets/keys.env (outside the repo): DEPLOYER (receives MON, pays the
// gas for the AUSD steps), TREASURY (receives AUSD), and every other 32-byte key in the file: the
// relayer lanes RELAYER_1..3, the demo members DEMO_BEN/ASHA/MAYA, and any test account (e.g.
// TEST_LEAH=0x…). In order, `send`:
//
//   1. refunds every EXPIRED, still-open ClaimEscrow claim whose source is one of these accounts
//      (judge and pilot links that nobody claimed; ClaimEscrow.refund is permissionless, the deployer
//      pays the gas). Open claims that have not expired yet are listed but cannot be recovered yet.
//   2. moves each account's whole AUSD balance to the treasury with an ERC-3009
//      TransferWithAuthorization signed by that account and submitted by the deployer, so the account
//      needs no MON and sends no transaction itself.
//   3. moves each account's MON to the deployer, as that account's ONLY transaction: Monad's
//      reserve-balance rule lets an undelegated account go below its 10 MON reserve only with an
//      "emptying" transaction, i.e. when it has sent nothing in the previous k = 3 blocks. So send
//      first checks that no account's nonce moved for k + 1 blocks (stop the relayer first), and
//      refuses EIP-7702-delegated accounts. Monad charges the full gas LIMIT at the effective price,
//      so value = balance - gasLimit * maxFeePerGas; what stays behind is gasLimit * (maxFee -
//      effective price), on Monad about 0.0006 MON per account (24,000 gas x 25 gwei).
//
// Gas: every limit is eth_estimateGas on the Monad RPC for that exact transaction from its sender
// (+10 %, rounded up to 1,000), re-estimated right before signing. With --fork (local anvil fork
// tests only) the estimates are anvil's; without it, an anvil/hardhat RPC is refused, and signing for
// chain 143 refuses any limit that did not come from a Monad RPC.
//
// Options: --chain 143|10143 (default 143), --rpc <url>, --keys <env file>, --only NAME,NAME,
// --except NAME,NAME (e.g. --except DEMO_BEN,DEMO_ASHA,DEMO_MAYA while judging runs),
// --deployments <file> (for the ClaimEscrow address; skipped if the file is missing),
// --tip-gwei <n>, --quiet-timeout <s> (default 120), --fork.

import { existsSync } from 'node:fs';
import path from 'node:path';
import * as O from './lib/monad-ops.mjs';
import { ESCROW_ABI } from './claim-links.mjs';

const { V } = O;
const { encodeFunctionData } = V;
const DELEGATION_PREFIX = '0xef0100';

export async function survey(conn, keys, a) {
  const deployer = O.need(keys, 'DEPLOYER');
  const treasury = O.need(keys, 'TREASURY');
  const only = a.only ? new Set(String(a.only).split(',')) : null;
  const except = new Set(a.except ? String(a.except).split(',') : []);
  const names = Object.keys(keys).filter((n) => (!only || only.has(n) || n === 'DEPLOYER' || n === 'TREASURY') && !except.has(n));
  const seen = new Set();
  const accounts = [];
  for (const name of names) {
    const acct = keys[name];
    if (seen.has(O.lc(acct.address))) continue;
    seen.add(O.lc(acct.address));
    const [mon, ausd, code, latest, pending] = await Promise.all([O.balance(conn, acct.address), O.ausdBalance(conn, acct.address), O.code(conn, acct.address), O.nonceOf(conn, acct.address, 'latest'), O.nonceOf(conn, acct.address, 'pending')]);
    const c = O.lc(code);
    accounts.push({ name, acct, mon, ausd, delegated: c.startsWith(DELEGATION_PREFIX), contract: c !== '0x' && c !== '0x0' && !c.startsWith(DELEGATION_PREFIX), latest, pending });
  }
  // Claims: our expired open ones are refundable now; unexpired ones are listed.
  const ours = new Map(accounts.map((x) => [O.lc(x.acct.address), x.name]));
  let escrow = null;
  const refundable = [];
  const locked = [];
  const depFile = a.deployments ?? path.join(O.CONTRACTS, 'deployments', `${conn.chainId}.json`);
  if (existsSync(depFile)) {
    escrow = O.getAddress(O.loadDeployment(conn.chainId, depFile).claimEscrow);
    if (await O.hasCode(conn, escrow)) {
      const count = Number(await O.call(conn, escrow, ESCROW_ABI, 'claimCount'));
      const now = await O.chainNow(conn);
      for (let id = 1; id <= count; id += 20) {
        const ids = Array.from({ length: Math.min(20, count - id + 1) }, (_, i) => id + i);
        const infos = await Promise.all(ids.map((i) => O.call(conn, escrow, ESCROW_ABI, 'claimInfo', [BigInt(i)])));
        infos.forEach(([source, , amount, expiry, , status], i) => {
          if (Number(status) !== 1 || !ours.has(O.lc(source))) return;
          const c = { id: ids[i], source, sourceName: ours.get(O.lc(source)), amount, expiry };
          (BigInt(expiry) < now ? refundable : locked).push(c);
        });
      }
    } else escrow = null;
  }
  return { deployer, treasury, accounts, escrow, refundable, locked, depFile };
}

/** MON sweep for one account: value = balance - limit * maxFee, with a limit estimated for that exact value. */
async function monSweepTx(conn, from, to, tipWei) {
  const bal = await O.balance(conn, from.address);
  const f = await O.fees(conn, tipWei);
  let limit = (await O.gasQuote(conn, { from: from.address, to, value: 1n })).gasLimit;
  for (let i = 0; i < 3; i++) {
    const value = bal - limit * f.maxFeePerGas;
    if (value <= 0n) return null;
    const q = await O.gasQuote(conn, { from: from.address, to, value });
    if (q.gasLimit <= limit) return { to, value, quote: q, fees: f };
    limit = q.gasLimit;
  }
  throw new Error(`gas estimate for the MON sweep from ${from.address} keeps rising`);
}

/** Waits until none of `addrs` has sent anything for k + 1 blocks (Monad's emptying-transaction condition). */
async function quietWindow(conn, addrs, timeoutS, out) {
  const start = await O.blockNumber(conn);
  const n0 = await Promise.all(addrs.map((x) => O.nonceOf(conn, x, 'latest')));
  const p0 = await Promise.all(addrs.map((x) => O.nonceOf(conn, x, 'pending')));
  addrs.forEach((x, i) => {
    if (p0[i] !== n0[i]) throw new Error(`${x} has pending transactions (stop the relayer, wait, run check again)`);
  });
  out(`  waiting for ${O.RESERVE_BLOCKS + 1} quiet blocks after block ${start} (Monad reserve balance: an emptying transaction must be the sender's only one in k = ${O.RESERVE_BLOCKS} blocks)`);
  const t0 = Date.now();
  while ((await O.blockNumber(conn)) < start + O.RESERVE_BLOCKS + 1) {
    if (Date.now() - t0 > timeoutS * 1000) throw new Error('chain did not advance; nothing sent');
    await O.sleep(400);
  }
  const n1 = await Promise.all(addrs.map((x) => O.nonceOf(conn, x, 'pending')));
  addrs.forEach((x, i) => {
    if (n1[i] !== n0[i]) throw new Error(`${x} sent a transaction during the quiet window (is the relayer still running?); nothing more sent, run check again`);
  });
}

export async function buildPlan(conn, s, tipWei) {
  const { deployer, treasury } = s;
  const steps = [];
  for (const c of s.refundable) {
    steps.push({
      label: `refund expired claim #${c.id}: ${O.usd(c.amount)} back to ${c.sourceName}`,
      sender: deployer,
      lines: [`escrow          ${s.escrow} refund(${c.id}), expired ${new Date(Number(c.expiry) * 1000).toISOString()}`],
      build: async () => ({ to: s.escrow, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'refund', args: [BigInt(c.id)] }) }),
    });
  }
  const refundsTo = new Map();
  for (const c of s.refundable) refundsTo.set(O.lc(c.source), (refundsTo.get(O.lc(c.source)) ?? 0n) + BigInt(c.amount));
  for (const x of s.accounts) {
    if (O.lc(x.acct.address) === O.lc(treasury.address)) continue;
    const expected = x.ausd + (refundsTo.get(O.lc(x.acct.address)) ?? 0n);
    if (expected === 0n) continue;
    steps.push({
      label: `AUSD ${O.usd(expected)} ${x.name} -> treasury`,
      sender: deployer,
      deferred: x.ausd === 0n,
      lines: [`authorization   TransferWithAuthorization signed by ${x.name} ${x.acct.address}, whole balance at send time`],
      skipIf: async () => (await O.ausdBalance(conn, x.acct.address)) === 0n,
      skipReason: 'no AUSD',
      build: async () => {
        const bal = await O.ausdBalance(conn, x.acct.address);
        return { to: O.AUSD[conn.chainId], data: await O.transferAuthCalldata(conn, x.acct, treasury.address, bal > 0n ? bal : expected) };
      },
    });
  }
  const monSources = s.accounts.filter((x) => O.lc(x.acct.address) !== O.lc(deployer.address) && x.mon > 0n);
  const skipped = [];
  const monSteps = [];
  for (const x of monSources) {
    if (x.delegated || x.contract) {
      skipped.push(`${x.name}: ${x.delegated ? 'EIP-7702 delegated (no emptying exception on Monad)' : 'has contract code'}, ${O.mon(x.mon)} left`);
      continue;
    }
    const probe = await monSweepTx(conn, x.acct, deployer.address, tipWei).catch((e) => ({ error: e.message }));
    if (!probe) {
      skipped.push(`${x.name}: ${O.mon(x.mon)} is below one transfer's max gas cost`);
      continue;
    }
    monSteps.push({
      label: `MON ${x.name} -> deployer (its only transaction: emptying)`,
      sender: x.acct,
      lines: [`balance         ${O.mon(x.mon)}; sends balance - gasLimit x maxFee (about ${probe.value ? O.mon(probe.value) : '?'} now)`],
      build: async () => {
        const t = await monSweepTx(conn, x.acct, deployer.address, tipWei);
        if (!t) throw new Error(`${x.name}: balance no longer covers the gas`);
        return t;
      },
    });
  }
  return { steps, monSteps, monSources, skipped };
}

export async function main(argv = process.argv.slice(2), out = console.log) {
  const a = O.parseArgs(argv);
  if (a.mode !== 'check' && a.mode !== 'send') throw new Error('usage: node scripts/return-funds.mjs check|send [--chain 143] [--rpc url] [--keys file] [--only A,B] [--except A,B] [--confirm fp] [--fork]');
  const conn = await O.connect({ chainId: a.chain ?? 143, rpcUrl: a.rpc, fork: a.fork });
  const keys = O.loadKeys(a.keys);
  const tipWei = O.tipFrom(a);
  const s = await survey(conn, keys, a);
  const p = await buildPlan(conn, s, tipWei);
  const fp = O.fingerprintOf({
    op: 'return-funds',
    chain: conn.chainId,
    kind: conn.kind,
    deployer: s.deployer.address,
    treasury: s.treasury.address,
    refunds: s.refundable.map((c) => c.id),
    ausd: s.accounts.map((x) => [x.acct.address, x.ausd]),
    mon: s.accounts.filter((x) => O.lc(x.acct.address) !== O.lc(s.deployer.address)).map((x) => [x.acct.address, x.mon]),
  });
  const totals = { ausd: s.accounts.filter((x) => O.lc(x.acct.address) !== O.lc(s.treasury.address)).reduce((t, x) => t + x.ausd, 0n) + s.refundable.reduce((t, c) => t + BigInt(c.amount), 0n), mon: p.monSources.reduce((t, x) => t + x.mon, 0n) };

  if (a.mode === 'check') {
    O.printHeader(out, 'Return funds', conn, [
      ['AUSD to', `${s.treasury.address} (treasury)`],
      ['MON to', `${s.deployer.address} (deployer; also pays the gas for refunds and AUSD moves)`],
      ['claim escrow', s.escrow ?? `none (no ${path.relative(O.REPO, s.depFile)} or no code)`],
    ]);
    out('  accounts');
    for (const x of s.accounts) out(`    ${x.name.padEnd(12)} ${x.acct.address}  ${O.usd(x.ausd).padStart(10)} AUSD  ${O.mon(x.mon)}${x.delegated ? '  (7702-delegated)' : ''}${x.pending !== x.latest ? '  PENDING TXS' : ''}`);
    if (s.locked.length) {
      out('  open claims not expired yet (not recoverable until expiry; run this again after it):');
      for (const c of s.locked) out(`    #${c.id} ${O.usd(c.amount)} from ${c.sourceName}, expires ${new Date(Number(c.expiry) * 1000).toISOString()}`);
    }
    for (const k of p.skipped) out(`  not swept: ${k}`);
    out('');
    out(`  recoverable     ${O.usd(totals.ausd)} AUSD to the treasury, up to ${O.mon(totals.mon)} to the deployer (minus gas)`);
    out('');
    const r = await O.checkSteps({ conn, steps: [...p.steps, ...p.monSteps], tipWei, out });
    if (s.accounts.some((x) => x.pending !== x.latest)) r.errors.push({ error: 'pending transactions' });
    out(`  fingerprint     ${fp}`);
    if (p.monSteps.length) out('  Before send: stop the relayer service (its lanes must send nothing during the sweep).');
    if (!p.steps.length && !p.monSteps.length) out('  Nothing to return.');
    O.readyLine(out, r, O.sendCommand('scripts/return-funds.mjs', a, fp, ['keys', 'only', 'except', 'deployments']));
    return { fp, survey: s, plan: p, report: r };
  }

  if (a.confirm !== fp) throw new Error(`--confirm ${a.confirm ?? '(missing)'} does not match the current state's fingerprint ${fp}: balances changed or the plan differs; run check again`);
  out(`Returning funds on chain ${conn.chainId}${conn.kind === 'anvil-fork' ? ' (local fork)' : ''}`);
  const sent = await O.sendSteps({ conn, steps: p.steps, tipWei, out });
  if (p.monSteps.length) {
    await quietWindow(conn, p.monSteps.map((m) => m.sender.address), Number(a['quiet-timeout'] ?? 120), out);
    sent.push(...(await O.sendSteps({ conn, steps: p.monSteps, tipWei, out })));
  }
  out('');
  out('  after');
  const after = [];
  for (const x of s.accounts) {
    const [m, u] = await Promise.all([O.balance(conn, x.acct.address), O.ausdBalance(conn, x.acct.address)]);
    after.push({ name: x.name, address: x.acct.address, mon: m, ausd: u });
    out(`    ${x.name.padEnd(12)} ${x.acct.address}  ${O.usd(u).padStart(10)} AUSD  ${O.mon(m)}`);
  }
  for (const k of p.skipped) out(`  not swept: ${k}`);
  if (s.locked.length) out(`  ${s.locked.length} open claim(s) not expired yet: run return-funds again after expiry.`);
  return { fp, sent, after, survey: s };
}

if (O.isMain(import.meta.url)) O.runMain(() => main(), 'return-funds');
