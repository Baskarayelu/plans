#!/usr/bin/env node
// Read-only preflight for the Monad mainnet launch. Sends nothing, signs nothing.
//
//   node scripts/mainnet-preflight.mjs
//
// Checks: the RPC is a Monad node on chain 143; AUSD (0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a) is
// Agora's token with EIP-712 domain "Agora Dollar"/1 on chain 143; the canonical CREATE2 deployer and
// Chainlink's MockKeystoneForwarder have code; whether the Plans contracts from the forge dry run
// (contracts/broadcast/Deploy.s.sol/143/dry-run) or from contracts/deployments/143.json already have
// code; and every account in ../secrets/keys.env (addresses only) with its MON and AUSD, against what
// docs/funding.md expects for each stage. Exit code 1 if a hard check fails.
//
// Options: --rpc <url> (default https://rpc.monad.xyz), --keys <env file>, --stage 1|2 (default 1:
// what the deploy needs; 2 adds the judges' claim links), --links <n> (default 8).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as O from './lib/monad-ops.mjs';

const { V } = O;
const CREATE2 = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const MOCK_FORWARDER = '0x9eF6468C5f37b976E57d52054c693269479A784d';

export async function main(argv = process.argv.slice(2), out = console.log) {
  const a = O.parseArgs(['preflight', ...argv]);
  const conn = await O.connect({ chainId: 143, rpcUrl: a.rpc });
  let bad = 0;
  const line = (ok, what, detail = '') => {
    if (ok === false) bad++;
    out(`  ${ok === true ? 'OK  ' : ok === false ? 'FAIL' : 'NOTE'}  ${what}${detail ? `: ${detail}` : ''}`);
  };
  out('Plans mainnet preflight (read-only)');
  out('');
  line(true, 'RPC', `${conn.url}, chain ${conn.chainId}, ${conn.client || 'client unknown'}, block ${await O.blockNumber(conn)}`);
  const ausd = O.AUSD[143];
  line(await O.hasCode(conn, ausd), 'AUSD has code', ausd);
  try {
    const d = await O.ausdDomain(conn);
    line(d.name === 'Agora Dollar' && d.version === '1', 'AUSD EIP-712 domain', `${d.name} / ${d.version} / chain ${d.chainId}`);
  } catch (e) {
    line(false, 'AUSD EIP-712 domain', e.message);
  }
  line(await O.hasCode(conn, CREATE2), 'canonical CREATE2 deployer', CREATE2);
  line(await O.hasCode(conn, MOCK_FORWARDER), 'Chainlink MockKeystoneForwarder (FxReference simulation mode)', MOCK_FORWARDER);

  // Contracts: from 143.json if present, else from the dry run.
  const depFile = path.join(O.CONTRACTS, 'deployments', '143.json');
  const dryRun = path.join(O.CONTRACTS, 'broadcast', 'Deploy.s.sol', '143', 'dry-run', 'run-latest.json');
  let addrs = null;
  if (existsSync(depFile)) {
    const d = JSON.parse(readFileSync(depFile, 'utf8'));
    addrs = { source: 'contracts/deployments/143.json', ...d };
  } else if (existsSync(dryRun)) {
    const v = JSON.parse(readFileSync(dryRun, 'utf8')).returns?.d?.value;
    if (v) {
      const p = v.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim());
      if (p.length === 8) addrs = { source: 'forge dry run (run-latest.json)', keyRegistry: p[2], fxReference: p[3], plansSend: p[4], plansFactory: p[5], claimEscrow: p[6], potImplementation: p[7] };
      else line(null, 'contracts', 'the dry run is from an older Deploy.s.sol (no FxReference): re-run step 2');
    }
  }
  if (addrs) {
    out('');
    out(`  contracts (${addrs.source})`);
    for (const k of ['keyRegistry', 'fxReference', 'plansSend', 'plansFactory', 'claimEscrow', 'potImplementation']) out(`        ${k.padEnd(18)} ${addrs[k]}  ${(await O.hasCode(conn, addrs[k])) ? 'deployed' : 'not deployed'}`);
  } else if (!existsSync(dryRun)) line(null, 'contracts', 'no dry run yet (step 2 of docs/mainnet-launch.md)');

  // Accounts.
  out('');
  let keys = {};
  try {
    keys = O.loadKeys(a.keys);
  } catch (e) {
    line(false, 'keys file', e.message);
  }
  const stage = Number(a.stage ?? 1);
  const links = Number(a.links ?? 8);
  const want = {
    DEPLOYER: { mon: V.parseEther('1.6'), why: 'deploy: max cost at 127 gwei (contracts/README: 1.58 MON) before the lanes are funded' },
    TREASURY: { ausd: V.parseUnits(String(3 + (stage >= 2 ? links * 0.5 : 0)), 6), why: `$3 demo members${stage >= 2 ? ` + ${links} x $0.50 claim links` : ''} (docs/funding.md)` },
  };
  out('  accounts (addresses from the keys file; keys are never printed)');
  for (const [name, acct] of Object.entries(keys)) {
    const [m, u] = await Promise.all([O.balance(conn, acct.address), O.ausdBalance(conn, acct.address)]);
    const w = want[name];
    const okMon = w?.mon === undefined || m >= w.mon;
    const okAusd = w?.ausd === undefined || u >= w.ausd;
    out(`        ${name.padEnd(12)} ${acct.address}  ${O.mon(m).padEnd(30)} ${O.usd(u)} AUSD${w ? `  ${okMon && okAusd ? 'enough' : 'NEEDS FUNDS'}: ${w.why}` : ''}`);
    if (w && !(okMon && okAusd)) bad++;
  }
  out('');
  out(bad ? `  ${bad} check(s) not ready.` : '  Ready for the next step.');
  return bad;
}

if (O.isMain(import.meta.url)) O.runMain(async () => process.exit((await main()) ? 1 : 0), 'mainnet-preflight');
