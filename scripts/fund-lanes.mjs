#!/usr/bin/env node
// Tops up the relayer lanes RELAYER_1..3 with MON from the deployer (docs/funding.md: the 15 MON
// stage-1 deposit pays the deploy, the rest goes to the three relayer keys). A lane already at or
// above the target gets nothing.
//
//   node scripts/fund-lanes.mjs check
//   node scripts/fund-lanes.mjs send --confirm <fingerprint printed by check>
//
// Options: --each <MON per lane> (default 4), --keep <MON the deployer keeps> (default 1; covers the
// claim links, judges' plan and return-funds gas), --chain, --rpc, --keys, --tip-gwei, --fork.
// Gas: eth_estimateGas on the Monad RPC (+10 %, rounded up to 1,000), re-estimated before signing.

import * as O from './lib/monad-ops.mjs';

const { V } = O;
const LANES = ['RELAYER_1', 'RELAYER_2', 'RELAYER_3'];

export async function main(argv = process.argv.slice(2), out = console.log) {
  const a = O.parseArgs(argv);
  if (a.mode !== 'check' && a.mode !== 'send') throw new Error('usage: node scripts/fund-lanes.mjs check|send [--each 4] [--keep 1] [--confirm fp] [--fork]');
  const conn = await O.connect({ chainId: a.chain ?? 143, rpcUrl: a.rpc, fork: a.fork });
  const keys = O.loadKeys(a.keys);
  const deployer = O.need(keys, 'DEPLOYER');
  const each = V.parseEther(String(a.each ?? '4'));
  const keep = V.parseEther(String(a.keep ?? '1'));
  const lanes = [];
  for (const n of LANES) {
    const acct = O.need(keys, n);
    const bal = await O.balance(conn, acct.address);
    lanes.push({ name: n, address: acct.address, before: bal, amount: bal >= each ? 0n : each - bal });
  }
  const total = lanes.reduce((s, l) => s + l.amount, 0n);
  const deployerBal = await O.balance(conn, deployer.address);
  const steps = lanes
    .filter((l) => l.amount > 0n)
    .map((l) => ({
      label: `MON ${V.formatEther(l.amount)} deployer -> ${l.name}`,
      sender: deployer,
      lines: [`lane            ${l.address} (now ${O.mon(l.before)}, after ${O.mon(l.before + l.amount)})`],
      build: async () => ({ to: l.address, value: l.amount }),
    }));
  const fp = O.fingerprintOf({ op: 'fund-lanes', chain: conn.chainId, kind: conn.kind, deployer: deployer.address, lanes: lanes.map((l) => [l.address, l.amount]) });
  const tipWei = O.tipFrom(a);
  const tooMuch = deployerBal < total + keep;
  if (a.mode === 'check') {
    O.printHeader(out, 'Fund relayer lanes', conn, [
      ['deployer', `${deployer.address} (${O.mon(deployerBal)})`],
      ['target', `${O.mon(each)} per lane; deployer keeps at least ${O.mon(keep)}`],
      ['total', `${O.mon(total)}${tooMuch ? `  NOT ENOUGH: deployer would keep less than ${O.mon(keep)}` : ''}`],
    ]);
    if (!steps.length) out('  Every lane is already at the target: nothing to send.');
    const r = await O.checkSteps({ conn, steps, tipWei, out });
    if (tooMuch) r.errors.push({ error: 'deployer balance' });
    out(`  fingerprint     ${fp}`);
    O.readyLine(out, r, O.sendCommand('scripts/fund-lanes.mjs', a, fp, ['each', 'keep', 'keys']));
    return { fp, report: r };
  }
  if (a.confirm !== fp) throw new Error(`--confirm ${a.confirm ?? '(missing)'} does not match this plan's fingerprint ${fp}: run check and verify it first`);
  if (tooMuch) throw new Error(`deployer ${O.mon(deployerBal)} < ${O.mon(total)} + keep ${O.mon(keep)}`);
  out(`Funding relayer lanes on chain ${conn.chainId}${conn.kind === 'anvil-fork' ? ' (local fork)' : ''}`);
  const sent = await O.sendSteps({ conn, steps, tipWei, out });
  for (const l of lanes) out(`  ${l.name} ${l.address}: ${O.mon(await O.balance(conn, l.address))}`);
  out(`  deployer now ${O.mon(await O.balance(conn, deployer.address))}`);
  return { fp, sent };
}

if (O.isMain(import.meta.url)) O.runMain(() => main(), 'fund-lanes');
