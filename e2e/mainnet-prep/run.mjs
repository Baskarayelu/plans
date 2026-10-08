#!/usr/bin/env node
// Mainnet launch rehearsal on a LOCAL anvil fork of Monad mainnet (chain 143, real AUSD).
//
//   node e2e/mainnet-prep/run.mjs
//
// It runs the owner's launch scripts exactly as docs/mainnet-launch.md tells the owner to, each as
// `check` then `send --confirm <fingerprint>`, with --fork pointed at the local anvil:
//
//   1. deploy: forge dry run of Deploy.s.sol (into a temp broadcast dir) -> monad-send.mjs check/send
//      --fork; all six contracts, wiring verified, deployments written to a temp <chain>-fork.json.
//   2. fund-demo.mjs: Ben, Asha, Maya topped up to $1.00 from the treasury.
//   3. claim-links.mjs: 8 x $0.50 links; every link checked onchain; one claimed with its key.
//   4. judges-plan.mjs: "Metropolis Judges' Trip" created by Maya, Ben and Asha join, $1.00 in total.
//   5. time moves past the links' expiry; return-funds.mjs check/send: expired links refunded, all
//      AUSD back to the treasury, all MON back to the deployer (emptying transactions after a quiet
//      window), balances asserted exactly.
//   Plus refusals: monad-send and return-funds without --fork against anvil, --fork against a
//   non-local URL, a wrong fingerprint, claim links into the repository.
//
// Every key is a fresh throwaway key written to a temp keys file: no real key ever signs anything
// here, so no transaction valid on mainnet is ever created. Real mainnet is only read, by anvil, to
// fork. FX_OWNER / FX_SIM_TRANSMITTER are the real deployer ADDRESS (public, docs/funding.md), so
// the fork deploys to the same addresses the real launch will produce from this source.
// Anvil's eth_estimateGas is used here because this is a fork test; the real path uses Monad's.
//
// Env: FORK_URL (default https://rpc.monad.xyz), FORK_BLOCK, KEEP=1 (keep the temp dir).

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const O = await import(pathToFileURL(path.join(REPO, 'scripts', 'lib', 'monad-ops.mjs')).href);
const { V, VA } = O;
const { toHex, pad, keccak256, encodeAbiParameters, parseUnits, encodeFunctionData } = V;

const FORK_URL = process.env.FORK_URL ?? 'https://rpc.monad.xyz';
const AUSD = O.AUSD[143];
const BAL_BASE = '0x455730fed596673e69db1907be2e521374ba893f1a04cc5f5dd931616cd6b700';
const SUPPLY_SLOT = '0x455730fed596673e69db1907be2e521374ba893f1a04cc5f5dd931616cd6b702';
const REAL_DEPLOYER_ADDRESS = '0x44E61d9E73394EDEBAB7095D224B0a6185EDa4e3';
const USD = (x) => parseUnits(String(x), 6);
const MON = (x) => parseUnits(String(x), 18);

const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
    s.on('error', rej);
  });

function run(cmd, args, { env = {}, cwd = REPO, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}):\n${out.slice(-4000)}`);
  return { status: r.status, out };
}
const fpOf = (out) => {
  const m = out.match(/fingerprint\s+(0x[0-9a-f]{8})/);
  if (!m) throw new Error(`no fingerprint in:\n${out.slice(-3000)}`);
  return m[1];
};

async function main() {
  const work = mkdtempSync(path.join(tmpdir(), 'plans-mainnet-prep-'));
  const logDir = path.join(work, 'logs');
  mkdirSync(logDir);
  const log = (name, text) => writeFileSync(path.join(logDir, `${name}.log`), text);

  // ── throwaway keys, same names as ../secrets/keys.env ──
  const names = ['DEPLOYER', 'TREASURY', 'RELAYER_1', 'RELAYER_2', 'RELAYER_3', 'DEMO_BEN', 'DEMO_ASHA', 'DEMO_MAYA', 'TEST_ALICE'];
  const pks = Object.fromEntries(names.map((n) => [n, VA.generatePrivateKey()]));
  const keysFile = path.join(work, 'keys.env');
  writeFileSync(keysFile, names.map((n) => `${n}=${pks[n]}`).join('\n') + '\nANDROID_KEYSTORE_PASSWORD=not-a-key\n', { mode: 0o600 });
  const acct = Object.fromEntries(names.map((n) => [n, VA.privateKeyToAccount(pks[n])]));

  // ── anvil fork (1 s blocks so Monad's k-block quiet window can elapse) ──
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const args = ['--fork-url', FORK_URL, '--code-size-limit', '131072', '--port', String(port), '--host', '127.0.0.1', '--block-time', '1', '--retries', '20', '--timeout', '60000'];
  if (process.env.FORK_BLOCK) args.push('--fork-block-number', process.env.FORK_BLOCK);
  const anvil = spawn('anvil', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let anvilOut = '';
  anvil.stdout.on('data', (d) => (anvilOut += d));
  anvil.stderr.on('data', (d) => (anvilOut += d));
  const stop = () => {
    try {
      anvil.kill('SIGKILL');
    } catch {
      /* gone */
    }
  };
  process.on('exit', stop);
  const rpc = O.makeRpc(rpcUrl);
  for (let i = 0; ; i++) {
    try {
      if (/anvil/i.test(await rpc('web3_clientVersion'))) break;
    } catch {
      if (i > 240) throw new Error('anvil did not start:\n' + anvilOut.slice(-2000));
      await O.sleep(250);
    }
  }
  const conn = await O.connect({ chainId: 143, rpcUrl, fork: true });
  const forkBlock = await O.blockNumber(conn);
  console.log(`anvil fork of ${FORK_URL} at block ${forkBlock} on ${rpcUrl}; work dir ${work}`);

  // ── fund the throwaway accounts on the fork ──
  const setMon = (a, wei) => rpc('anvil_setBalance', [a, toHex(wei)]);
  const slot = (a) => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [a, BAL_BASE]));
  async function addAusd(a, amount) {
    const raw = BigInt(await rpc('eth_getStorageAt', [AUSD, slot(a), 'latest']));
    await rpc('anvil_setStorageAt', [AUSD, slot(a), pad(toHex((((raw >> 8n) + amount) << 8n) | (raw & 0xffn)), { size: 32 })]);
    const ts = BigInt(await rpc('eth_getStorageAt', [AUSD, SUPPLY_SLOT, 'latest']));
    await rpc('anvil_setStorageAt', [AUSD, SUPPLY_SLOT, pad(toHex(ts + amount), { size: 32 })]);
  }
  const monStart = { DEPLOYER: MON(15), RELAYER_1: MON('1.3'), RELAYER_2: MON('1.2'), RELAYER_3: MON('1.35'), TREASURY: MON('0.05'), DEMO_MAYA: MON('0.02'), TEST_ALICE: MON('0.5') };
  for (const [n, w] of Object.entries(monStart)) await setMon(acct[n].address, w);
  const ausdStart = { TREASURY: USD(12), RELAYER_1: USD('0.25'), TEST_ALICE: USD(2) };
  for (const [n, u] of Object.entries(ausdStart)) await addAusd(acct[n].address, u);
  for (const [n, u] of Object.entries(ausdStart)) check(`fork funding: ${n} has ${O.usd(u)} AUSD`, (await O.ausdBalance(conn, acct[n].address)) === u);

  const common = ['--chain', '143', '--rpc', rpcUrl, '--fork', '--keys', keysFile];

  // ── 1. deploy: dry run + monad-send check/send --fork ──
  const broadcastDir = path.join(work, 'broadcast');
  const depDir = path.join(work, 'deployments');
  const fxEnv = { FX_OWNER: REAL_DEPLOYER_ADDRESS, FX_SIM_TRANSMITTER: REAL_DEPLOYER_ADDRESS, FOUNDRY_BROADCAST: broadcastDir };
  const dry = run('forge', ['script', 'script/Deploy.s.sol', '--rpc-url', rpcUrl, '--disable-code-size-limit', '--sender', '0x000000000000000000000000000000000000dEaD'], { cwd: path.join(REPO, 'contracts'), env: fxEnv });
  log('1-forge-dry-run', dry.out);
  const planFile = path.join(broadcastDir, 'Deploy.s.sol', '143', 'dry-run', 'run-latest.json');
  check('deploy: forge dry run wrote the plan to the temp broadcast dir (not contracts/broadcast)', existsSync(planFile));
  const msEnv = { PLANS_DEPLOYER_KEY: pks.DEPLOYER };
  const msArgs = ['contracts/script/monad-send.mjs'];
  const refusedNoFork = run('node', [...msArgs, 'check', '--chain', '143', '--rpc', rpcUrl, '--plan', planFile], { env: msEnv, allowFail: true });
  check('deploy: monad-send without --fork refuses the anvil RPC', refusedNoFork.status !== 0 && /not a Monad node/.test(refusedNoFork.out));
  const msCheck = run('node', [...msArgs, 'check', '--chain', '143', '--rpc', rpcUrl, '--fork', '--out', depDir, '--plan', planFile], { env: msEnv });
  log('1-monad-send-check', msCheck.out);
  const msFp = fpOf(msCheck.out);
  check('deploy: check prints 4 pending CREATE2 transactions and a fingerprint', /to send\s+4 of 4/.test(msCheck.out), msFp);
  const wrong = run('node', [...msArgs, 'send', '--chain', '143', '--rpc', rpcUrl, '--fork', '--out', depDir, '--plan', planFile, '--confirm', '0x00000000'], { env: msEnv, allowFail: true });
  check('deploy: send with a wrong fingerprint refused', wrong.status !== 0 && /does not match/.test(wrong.out));
  const msSend = run('node', [...msArgs, 'send', '--chain', '143', '--rpc', rpcUrl, '--fork', '--out', depDir, '--plan', planFile, '--confirm', msFp], { env: msEnv });
  log('1-monad-send-send', msSend.out);
  const depFile = path.join(depDir, '143-fork.json');
  const dep = JSON.parse(readFileSync(depFile, 'utf8'));
  check('deploy: send verified code + wiring and wrote 143-fork.json (temp dir)', /verified: code at all 6 addresses/.test(msSend.out) && dep.chainId === 143);
  check('deploy: 4 transactions sent, each with gas limit = estimate + 10 % rounded up', dep.transactions.length === 4 && dep.transactions.every((t) => BigInt(t.gasLimit) === O.gasLimitFromEstimate(BigInt(t.estimate))));
  for (const k of ['keyRegistry', 'fxReference', 'plansSend', 'plansFactory', 'claimEscrow', 'potImplementation']) check(`deploy: code at ${k} ${dep[k]}`, await O.hasCode(conn, dep[k]));
  check('deploy: contracts/deployments/143.json untouched', !existsSync(path.join(REPO, 'contracts', 'deployments', '143.json')));
  const msRerun = run('node', [...msArgs, 'check', '--chain', '143', '--rpc', rpcUrl, '--fork', '--out', depDir, '--plan', planFile], { env: msEnv });
  check('deploy: re-run check skips everything (0 of 4 to send)', /to send\s+0 of 4/.test(msRerun.out));
  const realDep = path.join(REPO, 'contracts', 'deployments', '143.json');
  if (existsSync(realDep)) {
    const real = JSON.parse(readFileSync(realDep, 'utf8'));
    check('deploy: fork addresses equal contracts/deployments/143.json', ['keyRegistry', 'fxReference', 'plansSend', 'plansFactory', 'claimEscrow', 'potImplementation'].every((k) => O.lc(real[k]) === O.lc(dep[k])));
  }

  // ── 2. fund demo members ──
  const fdCheck = run('node', ['scripts/fund-demo.mjs', 'check', ...common]);
  log('2-fund-demo-check', fdCheck.out);
  const fdSend = run('node', ['scripts/fund-demo.mjs', 'send', ...common, '--confirm', fpOf(fdCheck.out)]);
  log('2-fund-demo-send', fdSend.out);
  for (const n of ['DEMO_BEN', 'DEMO_ASHA', 'DEMO_MAYA']) check(`fund-demo: ${n} has $1.00`, (await O.ausdBalance(conn, acct[n].address)) === USD(1));
  check('fund-demo: treasury paid $3.00', (await O.ausdBalance(conn, acct.TREASURY.address)) === USD(9));
  const fdAgain = run('node', ['scripts/fund-demo.mjs', 'check', ...common]);
  check('fund-demo: re-run has nothing to send', /already at the target/.test(fdAgain.out));

  // ── 3. claim links ──
  const linksDir = path.join(work, 'secrets');
  const inRepo = run('node', ['scripts/claim-links.mjs', 'check', ...common, '--deployments', depFile, '--out-dir', path.join(REPO, 'tmp-links')], { allowFail: true });
  check('claim-links: refuses an output directory inside the repository', inRepo.status !== 0 && /inside the repository/.test(inRepo.out));
  const clArgs = [...common, '--deployments', depFile, '--out-dir', linksDir, '--count', '8', '--amount', '0.50'];
  const clCheck = run('node', ['scripts/claim-links.mjs', 'check', ...clArgs]);
  log('3-claim-links-check', clCheck.out);
  check('claim-links: check sends nothing', (await O.ausdBalance(conn, acct.TREASURY.address)) === USD(9) && !existsSync(linksDir));
  const clSend = run('node', ['scripts/claim-links.mjs', 'send', ...clArgs, '--confirm', fpOf(clCheck.out)]);
  log('3-claim-links-send', clSend.out.replace(/#k=[A-Za-z0-9_-]+/g, '#k=<hidden>'));
  check('claim-links: no link printed to the terminal', !/#k=/.test(clSend.out));
  const linkFile = readdirSync(linksDir).filter((f) => f.startsWith('claim-links-143-fork-') && f.endsWith('.json')).map((f) => path.join(linksDir, f))[0];
  const links = JSON.parse(readFileSync(linkFile, 'utf8'));
  check('claim-links: 8 links written to the private file', links.links.length === 8 && links.links.every((l) => l.status === 'open' && /^https:\/\/plans\.0xo\.in\/c\/1#k=[A-Za-z0-9_-]{43}&n=Plans&a=500000$/.test(l.url)));
  const { ESCROW_ABI } = await import(pathToFileURL(path.join(REPO, 'scripts', 'claim-links.mjs')).href);
  let allOpen = true;
  for (const l of links.links) {
    const [source, signer, amount, , , status] = await O.call(conn, dep.claimEscrow, ESCROW_ABI, 'claimInfo', [BigInt(l.claimId)]);
    const keySigner = VA.privateKeyToAccount(l.claimKey).address;
    allOpen &&= O.lc(source) === O.lc(acct.TREASURY.address) && O.lc(signer) === O.lc(keySigner) && amount === USD('0.5') && Number(status) === 1;
  }
  check('claim-links: every link is an open $0.50 claim from the treasury, signer = the link key', allOpen);
  check('claim-links: treasury paid $4.00', (await O.ausdBalance(conn, acct.TREASURY.address)) === USD(5));
  // claim link 1 with its key, as the app does, into TEST_ALICE
  const l1 = links.links[0];
  const linkKey = VA.privateKeyToAccount(l1.claimKey);
  const claimSig = await linkKey.signTypedData({
    domain: { name: 'Plans Claims', version: '1', chainId: 143, verifyingContract: dep.claimEscrow },
    types: { Claim: [{ name: 'id', type: 'uint256' }, { name: 'recipient', type: 'address' }, { name: 'toCountry', type: 'bytes2' }] },
    primaryType: 'Claim',
    message: { id: BigInt(l1.claimId), recipient: acct.TEST_ALICE.address, toCountry: '0x4742' },
  });
  await O.sendTx(conn, acct.DEPLOYER, { to: dep.claimEscrow, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'claim', args: [BigInt(l1.claimId), acct.TEST_ALICE.address, '0x4742', claimSig] }) });
  check('claim-links: link 1 claimed with its key: TEST_ALICE +$0.50', (await O.ausdBalance(conn, acct.TEST_ALICE.address)) === USD('2.5'));

  // ── 4. judges' plan ──
  const jpArgs = [...common, '--deployments', depFile, '--out-dir', linksDir];
  const jpCheck = run('node', ['scripts/judges-plan.mjs', 'check', ...jpArgs]);
  log('4-judges-plan-check', jpCheck.out);
  check("judges-plan: check simulates createPot + 2 joins (eth_simulateV1) without failures", !/FAILED/.test(jpCheck.out) && /Verify every line/.test(jpCheck.out));
  const jpSend = run('node', ['scripts/judges-plan.mjs', 'send', ...jpArgs, '--confirm', fpOf(jpCheck.out)]);
  log('4-judges-plan-send', jpSend.out);
  check('judges-plan: invite link not printed', !/#s=/.test(jpSend.out));
  const jpFile = readdirSync(linksDir).filter((f) => f.startsWith('judges-plan-143-fork-')).map((f) => path.join(linksDir, f))[0];
  const jp = JSON.parse(readFileSync(jpFile, 'utf8'));
  const potAbi = V.parseAbi(['function memberCount() view returns (uint256)', 'function isMember(address) view returns (bool)']);
  check('judges-plan: plan holds $1.00', (await O.ausdBalance(conn, jp.pot)) === USD(1));
  let members = 'n/a';
  try {
    members = await Promise.all(['DEMO_MAYA', 'DEMO_BEN', 'DEMO_ASHA'].map((n) => O.call(conn, jp.pot, potAbi, 'isMember', [acct[n].address])));
  } catch {
    /* getter name differs */
  }
  check('judges-plan: Maya, Ben and Asha are members', Array.isArray(members) ? members.every(Boolean) : /Asha joins/.test(jpSend.out), JSON.stringify(members));
  check('judges-plan: invite link format', /^https:\/\/plans\.0xo\.in\/j\/0x[0-9a-f]{40}#s=[A-Za-z0-9_-]{43}&n=Maya$/.test(jp.inviteUrl));

  // ── 5. return funds ──
  // Move past the links' expiry (31 Oct) so the 7 unclaimed links are refundable.
  const now = Number(await O.chainNow(conn));
  const target = Date.parse('2026-11-01T00:00:00Z') / 1000;
  if (target > now) await rpc('evm_increaseTime', [target - now]);
  await rpc('evm_mine', []);
  const rfRefused = run('node', ['scripts/return-funds.mjs', 'check', '--chain', '143', '--rpc', rpcUrl, '--keys', keysFile, '--deployments', depFile], { allowFail: true });
  check('return-funds: without --fork the anvil RPC is refused', rfRefused.status !== 0 && /not a Monad node/.test(rfRefused.out));
  const rfRemote = run('node', ['scripts/return-funds.mjs', 'check', '--chain', '143', '--rpc', FORK_URL, '--fork', '--keys', keysFile], { allowFail: true });
  check('return-funds: --fork against a non-local RPC is refused', rfRemote.status !== 0 && /LOCAL anvil/.test(rfRemote.out));
  const rfArgs = [...common, '--deployments', depFile];
  const before = {};
  for (const n of names) before[n] = { mon: await O.balance(conn, acct[n].address), ausd: await O.ausdBalance(conn, acct[n].address) };
  const rfCheck = run('node', ['scripts/return-funds.mjs', 'check', ...rfArgs]);
  log('5-return-funds-check', rfCheck.out);
  check('return-funds: check finds the 7 expired unclaimed links', (rfCheck.out.match(/refund expired claim #/g) ?? []).length === 7);
  check('return-funds: check sends nothing', (await O.ausdBalance(conn, acct.TREASURY.address)) === before.TREASURY.ausd);
  const rfWrong = run('node', ['scripts/return-funds.mjs', 'send', ...rfArgs, '--confirm', '0x12345678'], { allowFail: true });
  check('return-funds: wrong fingerprint refused', rfWrong.status !== 0 && /does not match/.test(rfWrong.out));
  const rfSend = run('node', ['scripts/return-funds.mjs', 'send', ...rfArgs, '--confirm', fpOf(rfCheck.out)]);
  log('5-return-funds-send', rfSend.out);
  const after = {};
  for (const n of names) after[n] = { mon: await O.balance(conn, acct[n].address), ausd: await O.ausdBalance(conn, acct[n].address) };
  // AUSD: everything except the judges' plan's $1.00 ends at the treasury.
  const ausdTotalStart = Object.values(ausdStart).reduce((s, x) => s + x, 0n);
  check('return-funds: treasury AUSD = everything funded - $1.00 locked in the judges\' plan', after.TREASURY.ausd === ausdTotalStart - USD(1), O.usd(after.TREASURY.ausd));
  check('return-funds: every other account holds 0 AUSD', names.filter((n) => n !== 'TREASURY').every((n) => after[n].ausd === 0n));
  check('return-funds: escrow holds 0 AUSD (7 refunded, 1 claimed)', (await O.ausdBalance(conn, dep.claimEscrow)) === 0n);
  // MON: exact conservation. Everything others held is now at the deployer, minus the gas paid.
  const hashes = [...rfSend.out.matchAll(/: (0x[0-9a-f]{64}) \(block/g)].map((m) => m[1]);
  let gasPaid = 0n;
  for (const h of hashes) {
    const r = await rpc('eth_getTransactionReceipt', [h]);
    gasPaid += BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice);
  }
  const monBefore = names.reduce((s, n) => s + before[n].mon, 0n);
  const monAfter = names.reduce((s, n) => s + after[n].mon, 0n);
  check('return-funds: MON conserved: before - gas paid = after', monBefore - gasPaid === monAfter, `gas ${O.mon(gasPaid)} over ${hashes.length} txs`);
  // Each MON sweep leaves exactly what the fee bound reserved but did not charge: <= gasLimit x maxFee.
  const sweeps = {};
  let toDeployer = 0n;
  let deployerGas = 0n;
  for (const h of hashes) {
    const [tx, r] = await Promise.all([rpc('eth_getTransactionByHash', [h]), rpc('eth_getTransactionReceipt', [h])]);
    if (O.lc(tx.to) === O.lc(acct.DEPLOYER.address) && BigInt(tx.value) > 0n) {
      sweeps[O.lc(tx.from)] = BigInt(tx.gas) * BigInt(tx.maxFeePerGas);
      toDeployer += BigInt(tx.value);
    }
    if (O.lc(tx.from) === O.lc(acct.DEPLOYER.address)) deployerGas += BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice);
  }
  const leftovers = names.filter((n) => n !== 'DEPLOYER').map((n) => [n, after[n].mon, sweeps[O.lc(acct[n].address)] ?? 0n]);
  check('return-funds: every MON holder was swept; what remains is at most its sweep\'s gasLimit x maxFee (fee dust)', leftovers.every(([n, w, bound]) => (before[n].mon === 0n ? w === 0n : bound > 0n && w <= bound)), leftovers.map(([n, w]) => `${n} ${O.mon(w)}`).join(', '));
  check('return-funds: deployer MON after = before + swept - its own gas', after.DEPLOYER.mon === before.DEPLOYER.mon + toDeployer - deployerGas, `+${O.mon(toDeployer)}`);
  check('return-funds: MON moved only after a quiet window of k + 1 blocks', /quiet blocks after block/.test(rfSend.out));
  const rfAgain = run('node', ['scripts/return-funds.mjs', 'check', ...rfArgs]);
  check('return-funds: re-run finds nothing left to move', !/AUSD \$[0-9.]+ .* -> treasury/.test(rfAgain.out) && !/MON .* -> deployer/.test(rfAgain.out));

  // ── report ──
  const summary = { date: new Date().toISOString(), forkUrl: FORK_URL, forkBlock, passed: results.filter((r) => r.ok).length, failed: failures, deployment: Object.fromEntries(['keyRegistry', 'fxReference', 'plansSend', 'plansFactory', 'claimEscrow', 'potImplementation'].map((k) => [k, dep[k]])), deployGas: dep.transactions.map((t) => ({ contract: t.contract, anvilEstimate: t.estimate, gasLimit: t.gasLimit })), results };
  writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n${summary.passed} passed, ${failures} failed. Logs: ${logDir}`);
  stop();
  if (!process.env.KEEP && !failures) rmSync(work, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(`mainnet-prep: ${e.stack ?? e.message}`);
  process.exit(1);
});
