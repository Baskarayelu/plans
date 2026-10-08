// Unit tests for script/monad-send.mjs against a mocked Monad RPC. Nothing touches a network.
//   node --test script/monad-send.test.mjs        (from contracts/; or: npm --prefix tools test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEM = path.join(HERE, '..', 'tools', 'node_modules', 'viem', '_esm');
const V = await import(pathToFileURL(path.join(VIEM, 'index.js')).href);
const { privateKeyToAccount } = await import(pathToFileURL(path.join(VIEM, 'accounts', 'index.js')).href);
const { concat, getContractAddress, keccak256, toHex, parseTransaction, recoverTransactionAddress, encodeAbiParameters, getAddress } = V;
const M = await import(pathToFileURL(path.join(HERE, 'monad-send.mjs')).href);

// anvil's well-known test key 0 (public; never funded on Monad)
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const AUSD = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';
const CHAIN = 10143;

const FX_OWNER = '0x44E61d9E73394EDEBAB7095D224B0a6185EDa4e3';
const FX_TRANSMITTER = '0x00000000000000000000000000000000000cafe1';
const fxArgs = (o = {}) =>
  encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint64' }],
    [o.owner ?? FX_OWNER, o.simForwarder ?? M.CRE[CHAIN].simForwarder, o.simTransmitter ?? FX_TRANSMITTER, o.chainSelector ?? M.CRE[CHAIN].chainSelector],
  );

/** A forge-shaped dry-run file with four CREATE2 deployments (tiny fake initcodes; FxReference's ends with real constructor args). */
function dryRun(fx = {}) {
  const mk = (name, tag, additional = []) => {
    const salt = keccak256(toHex(`plans.v1.${name}`));
    const initcode = name === 'FxReference' ? concat([toHex(`init:${tag}`), fxArgs(fx)]) : toHex(`init:${tag}`);
    const data = concat([salt, initcode]);
    const addr = getContractAddress({ opcode: 'CREATE2', from: M.CREATE2_DEPLOYER, salt, bytecode: initcode });
    return {
      hash: null,
      transactionType: 'CREATE2',
      contractName: name,
      contractAddress: addr.toLowerCase(),
      transaction: { from: '0x000000000000000000000000000000000000dead', to: M.CREATE2_DEPLOYER.toLowerCase(), gas: '0x7a621', value: '0x0', input: data, nonce: '0x0', chainId: '0x279f' },
      additionalContracts: additional,
    };
  };
  const kr = mk('KeyRegistry', 'kr');
  const fxr = mk('FxReference', 'fx');
  const ps = mk('PlansSend', 'ps');
  const escrow = getAddress('0x00000000000000000000000000000000000e5c20');
  const impl = getAddress('0x0000000000000000000000000000000000001a11');
  const pf = mk('PlansFactory', 'pf', [
    { transactionType: 'CREATE', contractName: 'ClaimEscrow', address: escrow.toLowerCase(), initCode: '0x00' },
    { transactionType: 'CREATE', contractName: 'Pot', address: impl.toLowerCase(), initCode: '0x00' },
  ]);
  const a = (t) => getAddress(t.contractAddress);
  return {
    transactions: [kr, fxr, ps, pf],
    returns: { d: { internal_type: 'struct Deploy.Deployment', value: `(${CHAIN}, ${AUSD}, ${a(kr)}, ${a(fxr)}, ${a(ps)}, ${a(pf)}, ${escrow}, ${impl})` } },
    chain: CHAIN,
  };
}

/**
 * A mocked Monad RPC. eth_estimateGas returns a different pseudo-random value on every call (so a
 * hard-coded limit cannot match by accident) and is logged with its params; every raw transaction
 * is decoded and logged in the same sequence.
 */
function fakeMonad({ plan, deployed = [], sync = true, clientVersion = 'Monad/v0.11', balance = 10n ** 20n, wiring = {} } = {}) {
  const code = new Map([[M.CREATE2_DEPLOYER.toLowerCase(), '0x60'], [AUSD.toLowerCase(), '0x60']]);
  for (const a of deployed) code.set(a.toLowerCase(), '0x60');
  const log = [];
  const calls = [];
  let nonce = 5;
  let seed = 12345;
  const receipts = new Map();
  const d = plan.deployment;
  const deploy = (raw) => {
    const tx = parseTransaction(raw);
    const salt = tx.data.slice(0, 66);
    const addr = getContractAddress({ opcode: 'CREATE2', from: M.CREATE2_DEPLOYER, salt, bytecode: '0x' + tx.data.slice(66) });
    code.set(addr.toLowerCase(), '0x60');
    if (addr.toLowerCase() === d.plansFactory.toLowerCase()) {
      code.set(d.claimEscrow.toLowerCase(), '0x60');
      code.set(d.potImplementation.toLowerCase(), '0x60');
    }
    nonce++;
    const r = { status: '0x1', blockNumber: '0x99', gasUsed: '0x5208', transactionHash: keccak256(raw) };
    receipts.set(keccak256(raw), r);
    return r;
  };
  const rpc = async (method, params = []) => {
    switch (method) {
      case 'eth_chainId':
        return toHex(CHAIN);
      case 'web3_clientVersion':
        return clientVersion;
      case 'eth_getCode':
        return code.get(params[0].toLowerCase()) ?? '0x';
      case 'eth_getBalance':
        return toHex(balance);
      case 'eth_getTransactionCount':
        return toHex(nonce);
      case 'eth_getBlockByNumber':
        return { baseFeePerGas: toHex(100_000_000_000n), number: '0x99' };
      case 'eth_estimateGas': {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        const est = 300_000 + (seed % 900_000);
        log.push({ kind: 'estimate', params, result: BigInt(est) });
        return toHex(est);
      }
      case 'eth_sendRawTransactionSync': {
        if (!sync) throw Object.assign(new Error('the method eth_sendRawTransactionSync does not exist'), { code: -32601 });
        log.push({ kind: 'send', method, raw: params[0] });
        return deploy(params[0]);
      }
      case 'eth_sendRawTransaction':
        log.push({ kind: 'send', method, raw: params[0] });
        deploy(params[0]);
        return keccak256(params[0]);
      case 'eth_getTransactionReceipt':
        return receipts.get(params[0]) ?? null;
      case 'eth_call': {
        const sel = params[0].data.slice(0, 10);
        const to = params[0].to.toLowerCase();
        calls.push({ to, sel });
        if (sel === selector('CHAIN_SELECTOR')) return encodeAbiParameters([{ type: 'uint64' }], [wiring.chainSelector ?? plan.fx.chainSelector]);
        const map = {
          [selector('ausd')]: d.ausd,
          [selector('keyRegistry')]: d.keyRegistry,
          [selector('claimEscrow')]: d.claimEscrow,
          [selector('potImplementation')]: d.potImplementation,
          [selector('fxReference')]: wiring.fxReference?.[to] ?? d.fxReference,
          [selector('factory')]: d.plansFactory,
          [selector('SIM_FORWARDER')]: plan.fx.simForwarder,
        };
        if (!map[sel]) throw new Error('unexpected eth_call ' + sel);
        return encodeAbiParameters([{ type: 'address' }], [map[sel]]);
      }
      default:
        throw new Error('unexpected ' + method);
    }
  };
  return { rpc, log, code, calls };
}
const selector = (fn) => keccak256(toHex(`${fn}()`)).slice(0, 10);

const plan = () => M.loadPlan(dryRun(), CHAIN);
const quiet = () => {};

test('gas limit = Monad estimate + 10%, rounded up to 1,000', () => {
  assert.equal(M.gasLimitFromEstimate(370_720n), 408_000n);
  assert.equal(M.gasLimitFromEstimate(909n), 1_000n);
  assert.equal(M.gasLimitFromEstimate(1_000n), 2_000n);
  assert.equal(M.gasLimitFromEstimate(8_466_838n), 9_314_000n);
  assert.throws(() => M.gasLimitFromEstimate(0n));
});

test('check sends nothing and prints what to verify', async () => {
  const p = plan();
  const f = fakeMonad({ plan: p });
  const r = await M.buildReport({ rpc: f.rpc, rpcUrl: 'https://testnet-rpc.monad.xyz', plan: p, from: account.address, tipWei: 2_000_000_000n });
  const lines = [];
  M.printReport(r, (s) => lines.push(s));
  const out = lines.join('\n');
  assert.equal(f.log.filter((x) => x.kind === 'send').length, 0);
  const estimates = f.log.filter((x) => x.kind === 'estimate');
  assert.equal(estimates.length, 4);
  r.rows.forEach((row, i) => assert.equal(row.quote.gasLimit, M.gasLimitFromEstimate(estimates[i].result)));
  for (const s of ['chain id        10143', 'https://testnet-rpc.monad.xyz', account.address, 'balance         100 MON', 'nonce (pending) 5', 'fingerprint     ' + r.fingerprint, `node script/monad-send.mjs send --chain 10143 --rpc https://testnet-rpc.monad.xyz --confirm ${r.fingerprint}`, `fx owner        ${FX_OWNER}`, `fx forwarder    ${M.CRE[CHAIN].simForwarder}`, `fx transmitter  ${getAddress(FX_TRANSMITTER)}`, 'fx chain sel.   2183018362218727504']) {
    assert.ok(out.includes(s), `missing: ${s}`);
  }
  for (const row of r.rows) {
    assert.ok(out.includes(row.predicted), 'predicted address');
    assert.ok(out.includes(row.quote.gasLimit.toLocaleString('en-US')), 'gas limit');
  }
  assert.ok(!out.includes('0x7a621') && !out.includes('501,281'), "forge's dry-run gas is never used");
});

test('send: every signed gas limit is the Monad estimate (+10%) for that exact tx, from the deployer, no state override', async () => {
  const p = plan();
  const f = fakeMonad({ plan: p });
  const dir = mkdtempSync(path.join(tmpdir(), 'monad-send-'));
  const r0 = await M.buildReport({ rpc: f.rpc, rpcUrl: 'x', plan: p, from: account.address, tipWei: 1n });
  f.log.length = 0;
  const { sent, file } = await M.runSend({ rpc: f.rpc, rpcUrl: 'x', plan: p, account, tipWei: 1n, confirm: r0.fingerprint, deploymentsDir: dir, out: quiet, waitOpts: { sleepMs: 1 } });
  const sends = f.log.filter((x) => x.kind === 'send');
  assert.equal(sends.length, 4);
  assert.equal(sent.length, 4);
  for (const s of sends) {
    const i = f.log.indexOf(s);
    const tx = parseTransaction(s.raw);
    const from = await recoverTransactionAddress({ serializedTransaction: s.raw });
    assert.equal(from, account.address);
    const est = [...f.log.slice(0, i)].reverse().find((x) => x.kind === 'estimate');
    assert.ok(est, 'an eth_estimateGas precedes every send');
    assert.equal(est.params.length, 2, 'no state override');
    assert.equal(est.params[1], 'latest');
    assert.equal(est.params[0].from, account.address);
    assert.equal(est.params[0].to.toLowerCase(), tx.to.toLowerCase());
    assert.equal(est.params[0].data, tx.data);
    assert.equal(tx.gas, M.gasLimitFromEstimate(est.result));
    assert.equal(tx.chainId, CHAIN);
  }
  const j = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(j.plansFactory, p.deployment.plansFactory);
  assert.equal(j.claimEscrow, p.deployment.claimEscrow);
  assert.equal(j.potImplementation, p.deployment.potImplementation);
  assert.equal(j.fxReference, p.deployment.fxReference);
  assert.deepEqual(j.fxConfig, { owner: FX_OWNER, simForwarder: M.CRE[CHAIN].simForwarder, simTransmitter: getAddress(FX_TRANSMITTER), chainSelector: '2183018362218727504' });
  assert.equal(j.transactions.length, 4);
  assert.deepEqual(Object.keys(j.salts), ['fxReference', 'keyRegistry', 'plansFactory', 'plansSend']);
  // the wiring was read from the factory, PlansSend, the Pot implementation and FxReference
  const d = p.deployment;
  for (const [to, fn] of [[d.plansFactory, 'fxReference'], [d.plansSend, 'fxReference'], [d.plansSend, 'ausd'], [d.potImplementation, 'fxReference'], [d.potImplementation, 'factory'], [d.fxReference, 'SIM_FORWARDER'], [d.fxReference, 'CHAIN_SELECTOR']]) {
    assert.ok(f.calls.some((c) => c.to === to.toLowerCase() && c.sel === selector(fn)), `verified ${fn} on ${to}`);
  }
});

test('send skips transactions whose CREATE2 address already has code', async () => {
  const p = plan();
  const f = fakeMonad({ plan: p, deployed: [p.deployment.keyRegistry] });
  const r0 = await M.buildReport({ rpc: f.rpc, rpcUrl: 'x', plan: p, from: account.address, tipWei: 1n });
  assert.equal(r0.pending.length, 3);
  const { sent } = await M.runSend({ rpc: f.rpc, rpcUrl: 'x', plan: p, account, tipWei: 1n, confirm: r0.fingerprint, deploymentsDir: mkdtempSync(path.join(tmpdir(), 'ms-')), out: quiet, waitOpts: { sleepMs: 1 } });
  assert.deepEqual(sent.map((s) => s.contract), ['FxReference', 'PlansSend', 'PlansFactory']);
  // a second run sends nothing
  const before = f.log.filter((x) => x.kind === 'send').length;
  const again = await M.runSend({ rpc: f.rpc, rpcUrl: 'x', plan: p, account, tipWei: 1n, confirm: r0.fingerprint, deploymentsDir: mkdtempSync(path.join(tmpdir(), 'ms-')), out: quiet });
  assert.equal(again.sent.length, 0);
  assert.equal(f.log.filter((x) => x.kind === 'send').length, before);
});

test('falls back to eth_sendRawTransaction when the sync method is missing', async () => {
  const p = plan();
  const f = fakeMonad({ plan: p, sync: false });
  const r0 = await M.buildReport({ rpc: f.rpc, rpcUrl: 'x', plan: p, from: account.address, tipWei: 1n });
  await M.runSend({ rpc: f.rpc, rpcUrl: 'x', plan: p, account, tipWei: 1n, confirm: r0.fingerprint, deploymentsDir: mkdtempSync(path.join(tmpdir(), 'ms-')), out: quiet, waitOpts: { sleepMs: 1 } });
  assert.equal(f.log.filter((x) => x.method === 'eth_sendRawTransaction').length, 4);
});

test('refuses: wrong --confirm, unfunded deployer, non-Monad node, wrong chain, tampered plan', async () => {
  const p = plan();
  const send = (f, confirm) => M.runSend({ rpc: f.rpc, rpcUrl: 'x', plan: p, account, tipWei: 1n, confirm, deploymentsDir: mkdtempSync(path.join(tmpdir(), 'ms-')), out: quiet });
  const f1 = fakeMonad({ plan: p });
  await assert.rejects(send(f1, '0xdeadbeef'), /does not match this plan's fingerprint/);
  const f2 = fakeMonad({ plan: p, balance: 1n });
  const fp = M.fingerprint(p, account.address);
  await assert.rejects(send(f2, fp), /balance .* < total max cost/);
  const f3 = fakeMonad({ plan: p, clientVersion: 'anvil/v1.5.0' });
  await assert.rejects(send(f3, fp), /not a Monad node/);
  for (const f of [f1, f2, f3]) assert.equal(f.log.filter((x) => x.kind === 'send').length, 0);
  assert.throws(() => M.loadPlan(dryRun(), 143), /not 143/);
  const bad = dryRun();
  bad.transactions[1].contractAddress = '0x000000000000000000000000000000000000beef';
  assert.throws(() => M.loadPlan(bad, CHAIN), /CREATE2 address/);
  const notCreate2 = dryRun();
  notCreate2.transactions[0].transaction.to = '0x000000000000000000000000000000000000beef';
  assert.throws(() => M.loadPlan(notCreate2, CHAIN), /not a call to the CREATE2 deployer/);
});

test('signWithMonadGas refuses limits that did not come from monadGasQuote for that tx', async () => {
  const p = plan();
  const f = fakeMonad({ plan: p });
  const t = p.txs[0];
  const tx = { from: account.address, to: t.to, data: t.data, value: 0n };
  const opts = { chainId: CHAIN, nonce: 0, fees: { maxFeePerGas: 2n, maxPriorityFeePerGas: 1n } };
  const forged = Object.freeze({ estimate: 100_000n, gasLimit: 110_000n, tx });
  await assert.rejects(M.signWithMonadGas(account, forged, tx, opts), /did not come from monadGasQuote/);
  const q = await M.monadGasQuote(f.rpc, tx);
  const other = { ...tx, data: p.txs[1].data };
  await assert.rejects(M.signWithMonadGas(account, q, other, opts), /different transaction/);
  const raw = await M.signWithMonadGas(account, q, tx, opts);
  assert.equal(parseTransaction(raw).gas, q.gasLimit);
});

test('loads the deployer key without exposing it', () => {
  const k = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
  const d = M.loadDeployer({ env: { PLANS_DEPLOYER_KEY: k }, keysFile: '/nonexistent' });
  assert.equal(d.account.address, privateKeyToAccount(k).address);
  assert.ok(!JSON.stringify({ source: d.source }).includes(k.slice(2)));
  assert.throws(() => M.loadDeployer({ env: { PLANS_DEPLOYER_KEY: '0x1234' }, keysFile: '/nonexistent' }), (e) => /value hidden/.test(e.message) && !e.message.includes('1234'));
  assert.equal(M.loadDeployer({ env: {}, keysFile: '/nonexistent' }), null);
});

test('FxReference constructor args must be Chainlink\'s forwarder and selector for the chain, with an owner and transmitter', () => {
  assert.throws(() => M.loadPlan(dryRun({ simForwarder: M.CRE[143].simForwarder }), CHAIN), /not Chainlink's MockKeystoneForwarder/);
  assert.throws(() => M.loadPlan(dryRun({ chainSelector: 1n }), CHAIN), /chainSelector 1 != 2183018362218727504/);
  assert.throws(() => M.loadPlan(dryRun({ owner: '0x0000000000000000000000000000000000000000' }), CHAIN), /owner and simTransmitter must be set/);
  assert.throws(() => M.loadPlan(dryRun({ simTransmitter: '0x0000000000000000000000000000000000000000' }), CHAIN), /owner and simTransmitter must be set/);
  const p = M.loadPlan(dryRun(), CHAIN);
  assert.equal(p.fx.owner, FX_OWNER);
  assert.equal(p.fx.chainSelector, 2183018362218727504n);
});

test('verify refuses a deployment whose PlansSend or Pot points at another FxReference', async () => {
  const p = plan();
  const other = '0x000000000000000000000000000000000000f00d';
  for (const where of ['plansSend', 'potImplementation', 'plansFactory']) {
    const f = fakeMonad({ plan: p, deployed: [p.deployment.keyRegistry, p.deployment.fxReference, p.deployment.plansSend, p.deployment.plansFactory, p.deployment.claimEscrow, p.deployment.potImplementation], wiring: { fxReference: { [p.deployment[where].toLowerCase()]: other } } });
    await assert.rejects(M.verifyDeployment(f.rpc, p.deployment, p.fx), /fxReference\(\) = /);
  }
  const f = fakeMonad({ plan: p, deployed: [p.deployment.keyRegistry, p.deployment.fxReference, p.deployment.plansSend, p.deployment.plansFactory, p.deployment.claimEscrow, p.deployment.potImplementation], wiring: { chainSelector: 1n } });
  await assert.rejects(M.verifyDeployment(f.rpc, p.deployment, p.fx), /CHAIN_SELECTOR/);
});

test('--fork rehearsal: only a local anvil, anvil quotes never signed outside it, a Monad node refused in fork mode', async () => {
  const p = plan();
  const fp = M.fingerprint(p, account.address);
  const dir = mkdtempSync(path.join(tmpdir(), 'ms-fork-'));
  const send = (f, url, fork) => M.runSend({ rpc: f.rpc, rpcUrl: url, plan: p, account, tipWei: 1n, confirm: fp, deploymentsDir: dir, out: quiet, fork });
  // fork mode against a real Monad node or a remote anvil: refused, nothing sent
  const monadNode = fakeMonad({ plan: p });
  await assert.rejects(send(monadNode, 'http://127.0.0.1:8545', true), /needs anvil/);
  const remoteAnvil = fakeMonad({ plan: p, clientVersion: 'anvil/v1.5.0' });
  await assert.rejects(send(remoteAnvil, 'https://rpc.monad.xyz', true), /local anvil/);
  // without --fork an anvil is refused (unchanged)
  await assert.rejects(send(fakeMonad({ plan: p, clientVersion: 'anvil/v1.5.0' }), 'http://127.0.0.1:8545', false), /not a Monad node/);
  for (const f of [monadNode, remoteAnvil]) assert.equal(f.log.filter((x) => x.kind === 'send').length, 0);
  // a quote from anvil can't be signed unless the run is a fork rehearsal
  const t = p.txs[0];
  const tx = { from: account.address, to: t.to, data: t.data, value: 0n };
  const q = await M.monadGasQuote(remoteAnvil.rpc, tx, 'anvil-fork');
  const opts = { chainId: 143, nonce: 0, fees: { maxFeePerGas: 2n, maxPriorityFeePerGas: 1n } };
  await assert.rejects(M.signWithMonadGas(account, q, tx, opts), /not a Monad RPC/);
  assert.equal(parseTransaction(await M.signWithMonadGas(account, q, tx, { ...opts, fork: true })).gas, q.gasLimit);
  // a local anvil fork: sends, and writes <chain>-fork.json, never <chain>.json
  const local = fakeMonad({ plan: p, clientVersion: 'anvil/v1.5.0' });
  const r = await send(local, 'http://127.0.0.1:8545', true);
  assert.equal(path.basename(r.file), `${CHAIN}-fork.json`);
  assert.equal(local.log.filter((x) => x.kind === 'send').length, 4);
});
