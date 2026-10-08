// Unit tests for scripts/lib/monad-ops.mjs against mocked RPCs. Nothing touches a network.
//   node --test scripts/lib/monad-ops.test.mjs     (or: npm --prefix contracts/tools test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const O = await import(pathToFileURL(path.join(HERE, 'monad-ops.mjs')).href);
const { VA, V } = O;

const account = VA.privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const TO = '0x0000000000000000000000000000000000000bee';

function fakeRpc({ chainId = 143, client = 'Monad/0.16.4' } = {}) {
  const log = [];
  let seed = 7;
  const rpc = async (method, params = []) => {
    log.push({ method, params });
    switch (method) {
      case 'eth_chainId':
        return V.toHex(chainId);
      case 'web3_clientVersion':
        return client;
      case 'eth_estimateGas':
        seed = (seed * 48271) % 2147483647;
        return V.toHex(21000 + (seed % 50000));
      case 'eth_getBlockByNumber':
        return { baseFeePerGas: V.toHex(100_000_000_000n), timestamp: '0x6700' };
      default:
        throw new Error('unexpected ' + method);
    }
  };
  return { rpc, log };
}

const fees = { maxFeePerGas: 127_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n };

test('connect: a Monad node without --fork; anvil/hardhat refused; --fork only on a local anvil; chain must match', async () => {
  const c = await O.connect({ chainId: 143, rpcUrl: 'https://rpc.monad.xyz', rpc: fakeRpc().rpc });
  assert.equal(c.kind, 'monad');
  await assert.rejects(O.connect({ chainId: 143, rpcUrl: 'http://127.0.0.1:8545', rpc: fakeRpc({ client: 'anvil/v1.5.0' }).rpc }), /not a Monad node/);
  await assert.rejects(O.connect({ chainId: 143, rpcUrl: 'http://127.0.0.1:8545', rpc: fakeRpc({ client: 'HardhatNetwork/2.0' }).rpc }), /not a Monad node/);
  await assert.rejects(O.connect({ chainId: 143, rpcUrl: 'https://rpc.monad.xyz', fork: true, rpc: fakeRpc({ client: 'anvil/v1.5.0' }).rpc }), /LOCAL anvil/);
  await assert.rejects(O.connect({ chainId: 143, rpcUrl: 'http://127.0.0.1:8545', fork: true, rpc: fakeRpc().rpc }), /LOCAL anvil/);
  await assert.rejects(O.connect({ chainId: 143, rpcUrl: 'x', rpc: fakeRpc({ chainId: 10143 }).rpc }), /expected 143/);
  await assert.rejects(O.connect({ chainId: 1, rpcUrl: 'x', rpc: fakeRpc({ chainId: 1 }).rpc }), /not Monad/);
  const f = await O.connect({ chainId: 143, rpcUrl: 'http://127.0.0.1:8545', fork: true, rpc: fakeRpc({ client: 'anvil/v1.5.0' }).rpc });
  assert.equal(f.kind, 'anvil-fork');
});

test('gas: limit = the connection\'s own estimate + 10 % rounded up to 1,000, for that exact tx; no state override', async () => {
  const f = fakeRpc();
  const c = await O.connect({ chainId: 143, rpcUrl: 'https://rpc.monad.xyz', rpc: f.rpc });
  const tx = { from: account.address, to: TO, data: '0x1234', value: 5n };
  const q = await O.gasQuote(c, tx);
  const est = f.log.find((l) => l.method === 'eth_estimateGas');
  assert.equal(est.params.length, 2);
  assert.equal(est.params[1], 'latest');
  assert.deepEqual(est.params[0], { from: account.address, to: TO, data: '0x1234', value: '0x5' });
  assert.equal(q.gasLimit, O.gasLimitFromEstimate(q.estimate));
  assert.equal(q.source, 'monad');
  const raw = await O.signWithQuote(c, account, q, tx, { nonce: 0, fees });
  assert.equal(V.parseTransaction(raw).gas, q.gasLimit);
  assert.equal(V.parseTransaction(raw).chainId, 143);
});

test('signing refuses forged quotes, other txs, other connections, and anvil quotes outside a verified local fork', async () => {
  const c = await O.connect({ chainId: 143, rpcUrl: 'https://rpc.monad.xyz', rpc: fakeRpc().rpc });
  const c2 = await O.connect({ chainId: 143, rpcUrl: 'https://rpc1.monad.xyz', rpc: fakeRpc().rpc });
  const tx = { from: account.address, to: TO, data: '0x', value: 1n };
  const q = await O.gasQuote(c, tx);
  await assert.rejects(O.signWithQuote(c, account, Object.freeze({ ...q }), tx, { nonce: 0, fees }), /did not come from gasQuote/);
  await assert.rejects(O.signWithQuote(c, account, q, { ...tx, value: 2n }, { nonce: 0, fees }), /different transaction/);
  await assert.rejects(O.signWithQuote(c2, account, q, tx, { nonce: 0, fees }), /different RPC connection/);
  // an anvil-fork quote can only be signed on that same verified local fork connection
  const fork = await O.connect({ chainId: 143, rpcUrl: 'http://127.0.0.1:8545', fork: true, rpc: fakeRpc({ client: 'anvil/v1.5.0' }).rpc });
  const fq = await O.gasQuote(fork, tx);
  assert.equal(fq.source, 'anvil-fork');
  await assert.rejects(O.signWithQuote(c, account, fq, tx, { nonce: 0, fees }), /different RPC connection/);
  assert.ok(await O.signWithQuote(fork, account, fq, tx, { nonce: 0, fees }));
});

test('keys: only 32-byte keys are loaded; a bad key is reported without its value', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ops-'));
  const f = path.join(dir, 'keys.env');
  writeFileSync(f, 'DEPLOYER=ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80\nANDROID_KEYSTORE_PASSWORD=hunter2\n# comment\nexport TREASURY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"\n');
  const k = O.loadKeys(f);
  assert.deepEqual(Object.keys(k).sort(), ['DEPLOYER', 'TREASURY']);
  assert.equal(k.DEPLOYER.address, account.address);
  assert.throws(() => O.need(k, 'DEMO_BEN', f), /DEMO_BEN missing/);
  writeFileSync(f, `BAD=0x${'f'.repeat(64)}\n`);
  assert.throws(() => O.loadKeys(f), (e) => /value hidden/.test(e.message) && !e.message.includes('ffff'));
});

test('fingerprint: by meaning, case-insensitive for addresses, sensitive to amounts', () => {
  const a = O.fingerprintOf({ op: 'x', to: '0xAbCdEf0000000000000000000000000000000001', amount: 5n });
  assert.equal(a, O.fingerprintOf({ op: 'x', to: '0xabcdef0000000000000000000000000000000001', amount: 5n }));
  assert.notEqual(a, O.fingerprintOf({ op: 'x', to: '0xabcdef0000000000000000000000000000000001', amount: 6n }));
  assert.match(a, /^0x[0-9a-f]{8}$/);
});

test('send command is zsh-safe: no comments, no shell metacharacters', () => {
  const cmd = O.sendCommand('scripts/x.mjs', { chain: 143, rpc: 'https://rpc.monad.xyz', count: '8' }, '0x12345678', ['count']);
  assert.equal(cmd, 'node scripts/x.mjs send --chain 143 --rpc https://rpc.monad.xyz --count 8 --confirm 0x12345678');
  assert.doesNotMatch(cmd, /[#;&|!]/);
});

test('claim-links refuses to write inside the repository', async () => {
  const { assertPrivateDir } = await import(pathToFileURL(path.join(HERE, '..', 'claim-links.mjs')).href);
  assert.throws(() => assertPrivateDir(path.join(O.REPO, 'docs')), /inside the repository/);
  assert.equal(assertPrivateDir(O.SECRETS), O.SECRETS);
});
