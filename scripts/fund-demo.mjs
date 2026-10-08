#!/usr/bin/env node
// Tops up the demo members Ben, Asha and Maya with AUSD from the treasury (docs/funding.md, stage 1:
// $1.00 each). The treasury signs an ERC-3009 TransferWithAuthorization per member; the deployer
// submits it and pays the gas, so the treasury needs no MON. A member already at or above the
// target gets nothing.
//
//   node scripts/fund-demo.mjs check
//   node scripts/fund-demo.mjs send --confirm <fingerprint printed by check>
//
// Options: --chain 143|10143 (default 143), --rpc <url>, --target <dollars per member> (default 1.00),
// --keys <env file> (default ../secrets/keys.env), --tip-gwei <n>, --fork (local anvil fork tests only).
// Gas: eth_estimateGas on the Monad RPC (+10 %, rounded up to 1,000), re-estimated right before signing.

import * as O from './lib/monad-ops.mjs';

const { V } = O;
export const MEMBERS = [
  ['DEMO_BEN', 'Ben (London, GB)'],
  ['DEMO_ASHA', 'Asha (Bengaluru, IN)'],
  ['DEMO_MAYA', 'Maya (New York, US)'],
];

export async function plan(conn, keys, { target }) {
  const deployer = O.need(keys, 'DEPLOYER');
  const treasury = O.need(keys, 'TREASURY');
  const treasuryBal = await O.ausdBalance(conn, treasury.address);
  const transfers = [];
  for (const [name, label] of MEMBERS) {
    const m = O.need(keys, name);
    const bal = await O.ausdBalance(conn, m.address);
    const amount = bal >= target ? 0n : target - bal;
    transfers.push({ name, label, address: m.address, before: bal, amount });
  }
  const total = transfers.reduce((s, t) => s + t.amount, 0n);
  const steps = transfers
    .filter((t) => t.amount > 0n)
    .map((t) => ({
      label: `AUSD ${O.usd(t.amount)} treasury -> ${t.label}`,
      sender: deployer,
      lines: [`member          ${t.address} (now ${O.usd(t.before)}, after ${O.usd(t.before + t.amount)})`, `authorization   TransferWithAuthorization signed by the treasury ${treasury.address}`],
      build: async () => ({ to: O.AUSD[conn.chainId], data: await O.transferAuthCalldata(conn, treasury, t.address, t.amount) }),
    }));
  const fp = O.fingerprintOf({ op: 'fund-demo', chain: conn.chainId, kind: conn.kind, deployer: deployer.address, treasury: treasury.address, transfers: transfers.map((t) => [t.address, t.amount]) });
  return { deployer, treasury, treasuryBal, transfers, total, steps, fp };
}

export async function main(argv = process.argv.slice(2), out = console.log) {
  const a = O.parseArgs(argv);
  if (a.mode !== 'check' && a.mode !== 'send') throw new Error('usage: node scripts/fund-demo.mjs check|send [--chain 143] [--rpc url] [--target 1.00] [--keys file] [--confirm fp] [--fork]');
  const conn = await O.connect({ chainId: a.chain ?? 143, rpcUrl: a.rpc, fork: a.fork });
  const keys = O.loadKeys(a.keys);
  const target = V.parseUnits(String(a.target ?? '1.00'), 6);
  const p = await plan(conn, keys, { target });
  const tipWei = O.tipFrom(a);
  if (a.mode === 'check') {
    O.printHeader(out, 'Fund demo members', conn, [
      ['treasury', `${p.treasury.address} (AUSD ${O.usd(p.treasuryBal)})`],
      ['gas payer', `${p.deployer.address} (deployer)`],
      ['target', `${O.usd(target)} AUSD per demo member`],
      ['total', `${O.usd(p.total)} AUSD${p.total > p.treasuryBal ? '  INSUFFICIENT: treasury short' : ''}`],
    ]);
    if (!p.steps.length) out('  Every demo member is already at the target: nothing to send.');
    const r = await O.checkSteps({ conn, steps: p.steps, tipWei, out });
    if (p.total > p.treasuryBal) r.errors.push({ error: 'treasury AUSD below the total' });
    out(`  fingerprint     ${p.fp}`);
    O.readyLine(out, r, O.sendCommand('scripts/fund-demo.mjs', a, p.fp, ['target', 'keys']));
    return { ...p, report: r };
  }
  if (a.confirm !== p.fp) throw new Error(`--confirm ${a.confirm ?? '(missing)'} does not match this plan's fingerprint ${p.fp}: run check and verify it first`);
  if (p.total > p.treasuryBal) throw new Error(`treasury AUSD ${O.usd(p.treasuryBal)} < ${O.usd(p.total)}`);
  out(`Funding demo members on chain ${conn.chainId}${conn.kind === 'anvil-fork' ? ' (local fork)' : ''}`);
  const sent = await O.sendSteps({ conn, steps: p.steps, tipWei, out });
  for (const t of p.transfers) out(`  ${t.label}: ${O.usd(await O.ausdBalance(conn, t.address))}`);
  out(`  treasury now ${O.usd(await O.ausdBalance(conn, p.treasury.address))}`);
  return { ...p, sent };
}

if (O.isMain(import.meta.url)) O.runMain(() => main(), 'fund-demo');
