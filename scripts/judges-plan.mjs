#!/usr/bin/env node
// Sets up the judges' plan on mainnet ("Metropolis Judges' Trip", docs/submission.md step 4): Maya
// creates it with the app's Pilot rules (instant up to $0.25, one approval up to $1), Ben and Asha
// join, and the three fund it with $1.00 in total (docs/funding.md: the demo members' $1.00 each
// funds the judges' plan, $1.00 in total; default deposits Maya $0.40, Ben $0.30, Asha $0.30).
//
// Everything is built exactly as the app builds it, with the app's own code (imported through tsx):
// the EIP-712 messages (app/src/lib/chain/eip712.ts), the encrypted plan meta and the invite key
// wrap (app/src/lib/crypto/seal.ts, keys.ts) and the invite link (app/src/lib/domain/links.ts). The
// demo members sign; the deployer submits each transaction and pays the gas.
//
//   node scripts/judges-plan.mjs check
//   node scripts/judges-plan.mjs send --confirm <fingerprint printed by check>
//
// The invite link (https://plans.0xo.in/j/<plan>#s=<invite secret>&n=Maya), the invite secret and
// the group key are secrets: written only to a private file (mode 0600) under ../secrets/, BEFORE
// the first transaction, never printed or committed.
//
// Options: --name <text>, --end <ISO time> (default 2026-10-31T23:59:59Z), --deposits <maya,ben,asha
// dollars> (default 0.40,0.30,0.30), --out-dir, --deployments, --host, --chain, --rpc, --keys,
// --tip-gwei, --fork (local anvil fork tests only).
// Needs: npm --prefix e2e/stage-a install (tsx) and app/node_modules (pnpm --dir app install).

import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as O from './lib/monad-ops.mjs';
import { assertPrivateDir } from './claim-links.mjs';

const { V, VA } = O;
const { encodeFunctionData, toHex, parseUnits, stringToHex } = V;

const TSX = path.join(O.REPO, 'e2e', 'stage-a', 'node_modules', 'tsx', 'dist', 'esm', 'api', 'index.mjs');
async function appModules() {
  if (!existsSync(TSX)) throw new Error('tsx not installed: run `npm --prefix e2e/stage-a install` first');
  if (!existsSync(path.join(O.REPO, 'app', 'node_modules', '@noble'))) throw new Error('app dependencies missing: run `pnpm --dir app install` first');
  const { tsImport } = await import(pathToFileURL(TSX).href);
  const p = (f) => pathToFileURL(path.join(O.REPO, 'app', 'src', 'lib', f)).href;
  const [eip712, abi, seal, keys, links, rules] = await Promise.all(
    ['chain/eip712.ts', 'chain/abi.ts', 'crypto/seal.ts', 'crypto/keys.ts', 'domain/links.ts', 'domain/rules.ts'].map((f) => tsImport(p(f), import.meta.url)),
  );
  return { eip712, abi, seal, keys, links, rules };
}

const MEMBERS = [
  { key: 'DEMO_MAYA', name: 'Maya', country: 'US' },
  { key: 'DEMO_BEN', name: 'Ben', country: 'GB' },
  { key: 'DEMO_ASHA', name: 'Asha', country: 'IN' },
];
const rnd32 = () => crypto.getRandomValues(new Uint8Array(32));
const randomNonce = () => BigInt(toHex(rnd32()));

/** Everything secret or random for one plan. In `check` these are throwaway values. */
export function freshSecrets() {
  return { salt: toHex(rnd32()), inviteSecret: rnd32(), groupKey: rnd32() };
}

export async function buildSteps({ conn, app, dep, deployer, members, secrets, opts }) {
  const { eip712, abi, seal, keys: K } = app;
  const factory = O.getAddress(dep.plansFactory);
  const [maya, ben, asha] = members;
  const pot = O.getAddress(await O.call(conn, factory, abi.factoryAbi, 'predictPot', [maya.account.address, secrets.salt]));
  const invite = VA.privateKeyToAccount(toHex(secrets.inviteSecret));
  const now = await O.chainNow(conn);
  const deadline = now + 3600n;
  const rules = app.rules.PRESETS.pilot.rules;
  const params = {
    rules,
    startTime: now,
    endTime: opts.end,
    reviewWindow: 0,
    inviteSigner: invite.address,
    creatorCountry: stringToHex(maya.country),
    creatorSafetyNet: 0n,
    meta: toHex(seal.encodeMeta(secrets.groupKey, pot, { name: opts.name, emoji: '🏙️', color: '#2FA6B8' })),
    creatorKeyWrap: '0x',
    inviteKeyWrap: toHex(seal.wrapGroupKey(K.inviteKeyPair(secrets.inviteSecret).publicKey, secrets.groupKey, pot)),
    salt: secrets.salt,
  };
  const steps = [];
  steps.push({
    label: `Maya creates "${opts.name}" and adds ${O.usd(opts.deposits[0])}`,
    sender: deployer,
    lines: [
      `factory         ${factory} createPot, creator Maya ${maya.account.address}`,
      `plan address    ${pot} (predictPot)`,
      `rules           Pilot preset: instant up to ${O.usd(rules.instantMax)}, one approval up to ${O.usd(rules.oneApprovalMax)}, no review window`,
      `ends            ${new Date(Number(opts.end) * 1000).toISOString()}`,
    ],
    build: async () => {
      const nonce = randomNonce();
      const sig = await maya.account.signTypedData(eip712.typed.createPot(conn.chainId, factory, { creator: maya.account.address, params, nonce, deadline }));
      const deposit = await O.receiveAuth(conn, maya.account, pot, opts.deposits[0]);
      return {
        to: factory,
        data: encodeFunctionData({ abi: abi.factoryAbi, functionName: 'createPot', args: [maya.account.address, params, nonce, deadline, sig, deposit, eip712.EMPTY_PERMIT, eip712.EMPTY_KEYREG] }),
      };
    },
  });
  for (const [i, m] of [[1, ben], [2, asha]]) {
    steps.push({
      label: `${m.name} joins and adds ${O.usd(opts.deposits[i])}`,
      sender: deployer,
      deferred: true,
      lines: [`member          ${m.account.address} (${m.country}), invite signed with the plan's invite key`],
      build: async () => {
        const nonce = randomNonce();
        const country = stringToHex(m.country);
        const memberSig = await m.account.signTypedData(eip712.typed.join(conn.chainId, pot, { member: m.account.address, country, safetyNet: 0n, nonce, deadline }));
        const inviteSig = await invite.signTypedData(eip712.typed.invite(conn.chainId, pot, m.account.address));
        const deposit = await O.receiveAuth(conn, m.account, pot, opts.deposits[i]);
        return {
          to: pot,
          data: encodeFunctionData({ abi: abi.potAbi, functionName: 'join', args: [m.account.address, country, nonce, deadline, memberSig, inviteSig, deposit, eip712.EMPTY_PERMIT, eip712.EMPTY_KEYREG] }),
        };
      },
    });
  }
  return { pot, steps, params };
}

export async function main(argv = process.argv.slice(2), out = console.log) {
  const a = O.parseArgs(argv);
  if (a.mode !== 'check' && a.mode !== 'send') throw new Error('usage: node scripts/judges-plan.mjs check|send [--name text] [--end ISO] [--deposits 0.40,0.30,0.30] [--confirm fp] [--fork]');
  const conn = await O.connect({ chainId: a.chain ?? 143, rpcUrl: a.rpc, fork: a.fork });
  const keys = O.loadKeys(a.keys);
  const dep = O.loadDeployment(conn.chainId, a.deployments);
  if (!(await O.hasCode(conn, dep.plansFactory))) throw new Error(`no PlansFactory code at ${dep.plansFactory} on chain ${conn.chainId}`);
  const app = await appModules();
  const deployer = O.need(keys, 'DEPLOYER');
  const members = MEMBERS.map((m) => ({ ...m, account: O.need(keys, m.key) }));
  const name = a.name ?? "Metropolis Judges' Trip";
  const endIso = a.end ?? '2026-10-31T23:59:59Z';
  const end = BigInt(Math.floor(Date.parse(endIso) / 1000));
  if (!(end > (await O.chainNow(conn)) + 3600n)) throw new Error(`--end ${endIso} must be in the future`);
  const deposits = String(a.deposits ?? '0.40,0.30,0.30').split(',').map((x) => parseUnits(x.trim(), 6));
  if (deposits.length !== 3) throw new Error('--deposits needs three amounts: maya,ben,asha');
  const outDir = assertPrivateDir(a['out-dir'] ?? O.SECRETS);
  const host = a.host ?? 'plans.0xo.in';
  const opts = { name, end, deposits };
  const balances = await Promise.all(members.map((m) => O.ausdBalance(conn, m.account.address)));
  const short = members.filter((m, i) => balances[i] < deposits[i]);
  const tipWei = O.tipFrom(a);
  const fp = O.fingerprintOf({ op: 'judges-plan', chain: conn.chainId, kind: conn.kind, factory: dep.plansFactory, deployer: deployer.address, members: members.map((m) => m.account.address), name, end, deposits, host });

  if (a.mode === 'check') {
    const { steps, pot } = await buildSteps({ conn, app, dep, deployer, members, secrets: freshSecrets(), opts });
    O.printHeader(out, "Judges' plan", conn, [
      ['factory', dep.plansFactory],
      ['gas payer', `${deployer.address} (deployer)`],
      ...members.map((m, i) => [m.name.toLowerCase(), `${m.account.address}: adds ${O.usd(deposits[i])}, has ${O.usd(balances[i])} AUSD${balances[i] < deposits[i] ? '  INSUFFICIENT (run fund-demo.mjs first)' : ''}`]),
      ['total in plan', O.usd(deposits.reduce((s, x) => s + x, 0n))],
      ['plan address', `${pot} for this check only (send uses a fresh salt, so a new address)`],
      ['secrets file', `${outDir}/judges-plan-${conn.chainId}${conn.kind === 'anvil-fork' ? '-fork' : ''}-<time>.json (mode 0600; invite link never printed)`],
    ]);
    const r = await O.checkSteps({ conn, steps, tipWei, out });
    if (short.length) r.errors.push({ error: 'demo members short of AUSD' });
    out(`  fingerprint     ${fp}`);
    O.readyLine(out, r, O.sendCommand('scripts/judges-plan.mjs', a, fp, ['name', 'end', 'deposits', 'out-dir', 'deployments', 'host', 'keys']));
    return { fp, report: r };
  }

  if (a.confirm !== fp) throw new Error(`--confirm ${a.confirm ?? '(missing)'} does not match this plan's fingerprint ${fp}: run check and verify it first`);
  if (short.length) throw new Error(`not enough AUSD: ${short.map((m) => m.name).join(', ')} (run fund-demo.mjs first)`);
  const secrets = freshSecrets();
  const { steps, pot } = await buildSteps({ conn, app, dep, deployer, members, secrets, opts });
  const inviteUrl = app.links.inviteUrl(host, pot, secrets.inviteSecret, 'Maya');
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const file = path.join(outDir, `judges-plan-${conn.chainId}${conn.kind === 'anvil-fork' ? '-fork' : ''}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const doc = { chainId: conn.chainId, network: conn.kind, name, pot, inviteUrl, inviteSecret: toHex(secrets.inviteSecret), groupKey: toHex(secrets.groupKey), salt: secrets.salt, endIso: new Date(Number(end) * 1000).toISOString(), createdAt: new Date().toISOString(), txs: [] };
  const save = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  save();
  out(`Creating the judges' plan ${pot} on chain ${conn.chainId}${conn.kind === 'anvil-fork' ? ' (local fork)' : ''}; invite link goes to ${file}`);
  await O.sendSteps({
    conn,
    tipWei,
    out,
    steps: steps.map((s) => ({ ...s, after: async (rec) => { doc.txs.push({ step: s.label, hash: rec.hash, block: rec.block }); save(); } })),
  });
  const potBal = await O.ausdBalance(conn, pot);
  out(`  plan ${pot} holds ${O.usd(potBal)}; invite link in ${file} (private; portal only)`);
  return { fp, file, pot, doc };
}

if (O.isMain(import.meta.url)) O.runMain(() => main(), 'judges-plan');
