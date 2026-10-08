#!/usr/bin/env node
// Creates N claim links of $0.50 each from the treasury through ClaimEscrow.createWithAuthorization
// (send-by-link, exactly as the app's createClaimLink does it). For each link: a fresh 32-byte claim
// key, the treasury signs an ERC-3009 ReceiveWithAuthorization whose nonce commits to
// (claimSigner, expiry, fromCountry, salt), and the deployer submits it and pays the gas.
//
//   node scripts/claim-links.mjs check
//   node scripts/claim-links.mjs send --confirm <fingerprint printed by check>
//
// The links (https://plans.0xo.in/c/1#k=<claim key>&n=<sender>&a=<amount units>) are secrets. They
// are written ONLY to a private file (mode 0600) under ../secrets/ (outside the repository), never
// printed and never committed. Each key is written to that file BEFORE its transaction is sent, so a
// crash can never strand locked money without its key. Unclaimed links can be refunded to the
// treasury after expiry with scripts/return-funds.mjs (ClaimEscrow.refund is permissionless; nothing
// refunds them automatically).
//
// Options: --count <n> (default 8), --amount <dollars> (default 0.50), --expiry <ISO time>
// (default 2026-10-31T23:59:59Z), --sender-name <text> (default Plans), --from-country <XX> (default
// none), --out-dir <dir> (default ../secrets), --deployments <file> (default
// contracts/deployments/<chain>.json), --host <link host> (default plans.0xo.in), --chain, --rpc,
// --keys, --tip-gwei, --fork (local anvil fork tests only).

import { writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import * as O from './lib/monad-ops.mjs';

const { V, VA } = O;
const { encodeFunctionData, encodeAbiParameters, keccak256, parseAbi, decodeEventLog, toHex, stringToHex, parseUnits } = V;

export const ESCROW_ABI = parseAbi([
  'struct Auth3009 { uint256 value; uint256 validAfter; uint256 validBefore; bytes32 nonce; bytes signature; }',
  'function createWithAuthorization(address from, address claimSigner, uint64 expiry, bytes2 fromCountry, bytes32 salt, Auth3009 auth) returns (uint256 id)',
  'function claim(uint256 id, address recipient, bytes2 toCountry, bytes claimSig)',
  'function refund(uint256 id)',
  'function claimCount() view returns (uint256)',
  'function claimInfo(uint256 id) view returns (address source, address claimSigner, uint256 amount, uint64 expiry, uint256 sourceSpendId, uint8 status)',
  'event ClaimCreated(uint256 indexed id, address indexed source, address indexed claimSigner, uint256 amount, uint64 expiry, uint256 sourceSpendId, bytes2 fromCountry)',
]);

const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const claimUrl = (host, key, { sender, amount }) => {
  const frag = [`k=${b64url(key)}`, sender ? `n=${encodeURIComponent(sender)}` : null, amount !== undefined ? `a=${amount}` : null].filter(Boolean).join('&');
  return `https://${host}/c/1#${frag}`;
};
export const claimAuthNonce = (signer, expiry, fromCountry, salt) =>
  keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint64' }, { type: 'bytes2' }, { type: 'bytes32' }], [signer, expiry, fromCountry, salt]));
const countryBytes = (c) => (c ? (/^[A-Z]{2}$/.test(c) ? stringToHex(c) : (() => { throw new Error(`--from-country must be two capital letters, got ${c}`); })()) : '0x0000');

/** createWithAuthorization calldata for one link (treasury-signed). */
export async function linkCalldata(conn, escrow, treasury, { key, amount, expiry, fromCountry }) {
  const signer = VA.privateKeyToAccount(toHex(key)).address;
  const salt = O.randomHex32();
  const auth = await O.receiveAuth(conn, treasury, escrow, amount, { nonce: claimAuthNonce(signer, expiry, fromCountry, salt), ttl: 3600 });
  return { signer, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'createWithAuthorization', args: [treasury.address, signer, expiry, fromCountry, salt, auth] }) };
}

export function assertPrivateDir(dir) {
  const abs = path.resolve(dir);
  const rel = path.relative(O.REPO, abs);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(`refusing to write claim links inside the repository (${abs}); use a directory outside it, e.g. ${O.SECRETS}`);
  return abs;
}

function writePrivate(file, obj) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
}

export async function main(argv = process.argv.slice(2), out = console.log) {
  const a = O.parseArgs(argv);
  if (a.mode !== 'check' && a.mode !== 'send') throw new Error('usage: node scripts/claim-links.mjs check|send [--count 8] [--amount 0.50] [--expiry ISO] [--confirm fp] [--fork]');
  const conn = await O.connect({ chainId: a.chain ?? 143, rpcUrl: a.rpc, fork: a.fork });
  const keys = O.loadKeys(a.keys);
  const dep = O.loadDeployment(conn.chainId, a.deployments);
  const escrow = O.getAddress(dep.claimEscrow);
  if (!(await O.hasCode(conn, escrow))) throw new Error(`no ClaimEscrow code at ${escrow} on chain ${conn.chainId}`);
  const deployer = O.need(keys, 'DEPLOYER');
  const treasury = O.need(keys, 'TREASURY');
  const count = Number(a.count ?? 8);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('--count must be 1..100');
  const amount = parseUnits(String(a.amount ?? '0.50'), 6);
  if (amount <= 0n) throw new Error('--amount must be positive');
  const expiryIso = a.expiry ?? '2026-10-31T23:59:59Z';
  const expiryMs = Date.parse(expiryIso);
  if (!Number.isFinite(expiryMs)) throw new Error(`--expiry ${expiryIso} is not a date`);
  const expiry = BigInt(Math.floor(expiryMs / 1000));
  const now = await O.chainNow(conn);
  if (expiry <= now + 3600n) throw new Error(`--expiry ${expiryIso} must be at least an hour after the chain's time`);
  const fromCountry = countryBytes(a['from-country']);
  const sender = a['sender-name'] ?? 'Plans';
  const host = a.host ?? 'plans.0xo.in';
  const outDir = assertPrivateDir(a['out-dir'] ?? O.SECRETS);
  const total = amount * BigInt(count);
  const treasuryBal = await O.ausdBalance(conn, treasury.address);
  const tipWei = O.tipFrom(a);
  const fp = O.fingerprintOf({ op: 'claim-links', chain: conn.chainId, kind: conn.kind, escrow, deployer: deployer.address, treasury: treasury.address, count, amount, expiry, fromCountry, sender, host });

  const keysForRun = [];
  const steps = Array.from({ length: count }, (_, i) => ({
    label: `claim link ${i + 1}/${count}: ${O.usd(amount)} from the treasury`,
    sender: deployer,
    lines: [`escrow          ${escrow} createWithAuthorization (treasury ${treasury.address} signs ReceiveWithAuthorization)`],
    build: async () => {
      const key = keysForRun[i] ?? crypto.getRandomValues(new Uint8Array(32));
      const { data } = await linkCalldata(conn, escrow, treasury, { key, amount, expiry, fromCountry });
      return { to: escrow, data };
    },
  }));

  if (a.mode === 'check') {
    O.printHeader(out, 'Judge claim links', conn, [
      ['claim escrow', escrow],
      ['treasury', `${treasury.address} (AUSD ${O.usd(treasuryBal)})`],
      ['gas payer', `${deployer.address} (deployer)`],
      ['links', `${count} x ${O.usd(amount)} = ${O.usd(total)}${total > treasuryBal ? '  INSUFFICIENT: treasury short' : ''}`],
      ['expiry', `${new Date(Number(expiry) * 1000).toISOString()} (refundable to the treasury after this, with return-funds.mjs)`],
      ['link format', `https://${host}/c/1#k=<claim key>&n=${encodeURIComponent(sender)}&a=${amount}`],
      ['links file', `${outDir}/claim-links-${conn.chainId}${conn.kind === 'anvil-fork' ? '-fork' : ''}-<time>.json (mode 0600, outside the repo; links are never printed)`],
    ]);
    const r = await O.checkSteps({ conn, steps, tipWei, out });
    if (total > treasuryBal) r.errors.push({ error: 'treasury AUSD below the total' });
    out(`  fingerprint     ${fp}`);
    O.readyLine(out, r, O.sendCommand('scripts/claim-links.mjs', a, fp, ['count', 'amount', 'expiry', 'sender-name', 'from-country', 'out-dir', 'deployments', 'host', 'keys']));
    return { fp, report: r };
  }

  if (a.confirm !== fp) throw new Error(`--confirm ${a.confirm ?? '(missing)'} does not match this plan's fingerprint ${fp}: run check and verify it first`);
  if (total > treasuryBal) throw new Error(`treasury AUSD ${O.usd(treasuryBal)} < ${O.usd(total)}`);
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const file = path.join(outDir, `claim-links-${conn.chainId}${conn.kind === 'anvil-fork' ? '-fork' : ''}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const doc = { chainId: conn.chainId, network: conn.kind, claimEscrow: escrow, treasury: treasury.address, amountUnits: amount.toString(), amount: O.usd(amount), expiry: Number(expiry), expiryIso: new Date(Number(expiry) * 1000).toISOString(), createdAt: new Date().toISOString(), links: [] };
  writePrivate(file, doc);
  out(`Creating ${count} claim links on chain ${conn.chainId}${conn.kind === 'anvil-fork' ? ' (local fork)' : ''}; links go to ${file}`);
  for (let i = 0; i < count; i++) {
    const key = crypto.getRandomValues(new Uint8Array(32));
    keysForRun[i] = key;
    const signer = VA.privateKeyToAccount(toHex(key)).address;
    const entry = { n: i + 1, url: claimUrl(host, key, { sender, amount }), claimSigner: signer, claimKey: toHex(key), status: 'pending', claimId: null, tx: null };
    doc.links.push(entry);
    writePrivate(file, doc);
    const [sent] = await O.sendSteps({ conn, steps: [steps[i]], tipWei, out });
    const ev = sent.receipt.logs
      .filter((l) => O.lc(l.address) === O.lc(escrow))
      .map((l) => {
        try {
          return decodeEventLog({ abi: ESCROW_ABI, data: l.data, topics: l.topics });
        } catch {
          return null;
        }
      })
      .find((e) => e?.eventName === 'ClaimCreated');
    if (!ev || O.lc(ev.args.claimSigner) !== O.lc(signer) || ev.args.amount !== amount) throw new Error(`link ${i + 1}: no matching ClaimCreated in ${sent.hash} (key kept in ${file})`);
    Object.assign(entry, { status: 'open', claimId: ev.args.id.toString(), tx: sent.hash });
    writePrivate(file, doc);
  }
  out(`  ${count} links created (${O.usd(total)}). Treasury now ${O.usd(await O.ausdBalance(conn, treasury.address))}.`);
  out(`  Links: ${file} (private; paste them into the portal's judge field only)`);
  return { fp, file, doc };
}

if (O.isMain(import.meta.url)) O.runMain(() => main(), 'claim-links');
