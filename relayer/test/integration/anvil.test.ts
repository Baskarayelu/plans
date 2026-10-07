/**
 * End-to-end against anvil with the real contracts from ../contracts/out and MockAUSD:
 * createPot → join → propose → vote → ack → settle via the HTTP API, revert decoding,
 * push dispatch, demo approvals/acks, "Try a settle-up", and the long-stop job.
 * Skips (with a message) if the contracts haven't been built yet.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { getAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ausdAbi, plansSendAbi, potAbi } from "../../src/abi.js";
import { loadConfig } from "../../src/config.js";
import {
  asciiToBytes,
  factoryDomain,
  factoryTypes,
  hashCreatePotParams,
  hashMemo,
  hashSendMeta,
  hashSplit,
  randomBytes32,
  randomNonce,
  signPot,
  signReceiveAuth,
  ZERO_BYTES32,
  type CreatePotParams,
  type SendMeta,
} from "../../src/eip712.js";
import { registerErrors } from "../../src/errors.js";
import { pushRegisterMessage } from "../../src/push.js";
import type { RelayResult } from "../../src/relay.js";
import { buildServices, type Services } from "../../src/services.js";
import { ANVIL_KEYS, artifact, artifactsAvailable, deployAll, startAnvil, waitFor } from "./helpers.js";

const avail = artifactsAvailable();
if (!avail.ok) console.warn(`[integration] skipped: contract artifacts missing in contracts/out: ${avail.missing.join(", ")}`);

const USD = (x: number) => BigInt(Math.round(x * 1_000_000));
const AGORA = { name: "Agora Dollar", version: "1" };

describe.skipIf(!avail.ok)("relayer on anvil with real contracts", () => {
  let anvil: Awaited<ReturnType<typeof startAnvil>>;
  let d: Awaited<ReturnType<typeof deployAll>>;
  let s: Services;
  let blobDir: string;
  const pushes: { to: string; title: string; body: string }[] = [];
  const alice = privateKeyToAccount(generatePrivateKey());
  const bob = privateKeyToAccount(generatePrivateKey());
  const judge = privateKeyToAccount(generatePrivateKey());
  const demoKeys = { ben: generatePrivateKey(), asha: generatePrivateKey(), maya: generatePrivateKey() };
  const chainId = 31337;

  const relay = async (action: string, params: Record<string, unknown>) => {
    const r = await s.app.request("/v1/relay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, params }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    });
    return { status: r.status, body: (await r.json()) as RelayResult & { error?: { code: string; message: string; reason?: number } } };
  };
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);
  const auth = (from: PrivateKeyAccount, to: Address, value: bigint) =>
    signReceiveAuth(from, { chainId, ausd: d.ausd, to, value, validBefore: deadline(), domain: AGORA });
  const balance = async (a: Address) => (await d.pub.readContract({ address: d.ausd, abi: ausdAbi, functionName: "balanceOf", args: [a] })) as bigint;

  async function createPot(creator: PrivateKeyAccount, invite: PrivateKeyAccount, opts: { deposit?: bigint; endIn?: number; reviewWindow?: number } = {}) {
    const block = await d.pub.getBlock();
    const params: CreatePotParams = {
      rules: {
        instantMax: USD(0.25),
        oneApprovalMax: USD(1),
        highTier: 0,
        memberDailyCap: 0n,
        memberTotalCap: 0n,
        payeePolicy: 0,
        minContribution: 0n,
        proposalTtl: 3600,
        ruleTimelock: 300,
        categoryBudgets: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
      },
      startTime: block.timestamp,
      endTime: block.timestamp + BigInt(opts.endIn ?? 3600),
      reviewWindow: opts.reviewWindow ?? 0,
      inviteSigner: invite.address,
      creatorCountry: asciiToBytes("GB"),
      creatorSafetyNet: 0n,
      meta: "0x00",
      creatorKeyWrap: "0x",
      inviteKeyWrap: "0x",
      salt: randomBytes32(),
    };
    const nonce = randomNonce();
    const dl = deadline();
    const sig = await creator.signTypedData({
      domain: factoryDomain(chainId, d.factory),
      types: factoryTypes,
      primaryType: "CreatePot",
      message: { creator: creator.address, paramsHash: hashCreatePotParams(params), nonce, deadline: dl },
    });
    const predicted = (await d.pub.readContract({
      address: d.factory,
      abi: artifact("PlansFactory").abi,
      functionName: "predictPot",
      args: [creator.address, params.salt],
    })) as Address;
    const deposit = opts.deposit ? await auth(creator, predicted, opts.deposit) : undefined;
    const r = await relay("createPot", {
      creator: creator.address,
      params: { ...params, rules: { ...params.rules, categoryBudgets: [...params.rules.categoryBudgets] } },
      nonce,
      deadline: dl,
      sig,
      ...(deposit ? { deposit } : {}),
    });
    return { r, pot: predicted };
  }

  async function join(pot: Address, member: PrivateKeyAccount, invite: PrivateKeyAccount, country: string, deposit?: bigint) {
    const nonce = randomNonce();
    const dl = deadline();
    const memberSig = await signPot(member, chainId, pot, "Join", { member: member.address, country: asciiToBytes(country), safetyNet: 0n, nonce, deadline: dl });
    const inviteSig = await signPot(invite, chainId, pot, "Invite", { member: member.address });
    return relay("join", {
      pot,
      member: member.address,
      country,
      nonce,
      deadline: dl,
      memberSig,
      inviteSig,
      ...(deposit ? { deposit: await auth(member, pot, deposit) } : {}),
    });
  }

  async function propose(pot: Address, proposer: PrivateKeyAccount, amount: bigint, payee: Address, members: Address[], category = 3) {
    const nonce = randomNonce();
    const dl = deadline();
    const split = { members, weights: members.map(() => 1) };
    const sig = await signPot(proposer, chainId, pot, "Propose", {
      proposer: proposer.address,
      kind: 0,
      payee,
      amount,
      category,
      splitHash: hashSplit(split),
      receiptHash: ZERO_BYTES32,
      memoHash: hashMemo("0x"),
      nonce,
      deadline: dl,
    });
    return relay("propose", { pot, proposer: proposer.address, kind: "PAY", payee, amount, category, split, nonce, deadline: dl, sig });
  }

  async function vote(pot: Address, member: PrivateKeyAccount, id: bigint, approve = true) {
    const nonce = randomNonce();
    const dl = deadline();
    const sig = await signPot(member, chainId, pot, "Vote", { member: member.address, id, approve, nonce, deadline: dl });
    return relay("vote", { pot, member: member.address, id, approve, nonce, deadline: dl, sig });
  }

  async function ack(pot: Address, member: PrivateKeyAccount) {
    const nonce = randomNonce();
    const dl = deadline();
    const sig = await signPot(member, chainId, pot, "Ack", { member: member.address, nonce, deadline: dl });
    return relay("ack", { pot, member: member.address, nonce, deadline: dl, sig });
  }

  beforeAll(async () => {
    anvil = await startAnvil();
    d = await deployAll(anvil.url);
    registerErrors(artifact("Pot").abi);
    registerErrors(artifact("MockAUSD").abi);
    registerErrors(artifact("PlansSend").abi);
    registerErrors(artifact("FxReference").abi);
    for (const a of [alice, bob, judge]) await d.mint(a.address, USD(100));
    for (const k of Object.values(demoKeys)) await d.mint(privateKeyToAccount(k).address, USD(10));
    await d.mint(privateKeyToAccount(ANVIL_KEYS[1]).address, USD(100)); // lane 0 holds faucet AUSD

    const cfg = loadConfig({
      CHAIN_ID: "31337",
      RPC_URL: anvil.url,
      WS_URL: anvil.ws,
      FACTORY_ADDRESS: d.factory,
      PLANS_SEND_ADDRESS: d.plansSend,
      AUSD_ADDRESS: d.ausd,
      RELAYER_KEYS: ANVIL_KEYS.slice(1).join(","),
      START_BLOCK: "0",
      POLL_INTERVAL_MS: "200",
      LANE_MIN_BALANCE_WEI: "0",
      DEMO_ENABLED: "true",
      DEMO_KEY_BEN: demoKeys.ben,
      DEMO_KEY_ASHA: demoKeys.asha,
      DEMO_KEY_MAYA: demoKeys.maya,
      DEMO_VOTE_DELAY_MIN_MS: "300",
      DEMO_VOTE_DELAY_MAX_MS: "600",
      DEMO_STEP_DELAY_MS: "50",
      DEMO_TICK_MS: "150",
      LONGSTOP_ENABLED: "false",
      FAUCET_ENABLED: "true", // testnet-only feature; enabled explicitly on the local chain
      PUSH_ENABLED: "true",
      EXPO_PUSH_URL: "https://expo.test/push",
      LOG_LEVEL: "error",
    });
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith("https://expo.test")) {
        const msgs = JSON.parse(String(init!.body)) as { to: string; title: string; body: string }[];
        pushes.push(...msgs);
        return new Response(JSON.stringify({ data: msgs.map(() => ({ status: "ok" })) }));
      }
      return new Response(JSON.stringify({ base: "GBP", date: "2026-10-05", rates: { USD: 1.34, INR: 118.9 } }));
    });
    blobDir = mkdtempSync(pathJoin(tmpdir(), "plans-it-blobs-"));
    s = await buildServices(cfg, { fetchImpl: fetchImpl as never, dbPath: ":memory:", blobDir });
    await s.start();
    await waitFor(() => s.listener!.caughtUp, "listener catch-up");
  }, 120_000);

  afterAll(async () => {
    await s?.stop();
    anvil?.stop();
    if (blobDir) rmSync(blobDir, { recursive: true, force: true });
  });

  it("reports health with lanes, contracts and the sync send method", async () => {
    const r = await s.app.request("/v1/health");
    const j = (await r.json()) as { ok: boolean; chainId: number; lanes: unknown[]; contracts: Record<string, string> };
    expect(r.status).toBe(200);
    expect(j.chainId).toBe(31337);
    expect(j.lanes).toHaveLength(3);
    expect(getAddress(j.contracts.claimEscrow)).toBe(getAddress(s.relayer.contracts.claimEscrow!));
    expect(j.contracts.keyRegistry.toLowerCase()).toBe(d.keyRegistry.toLowerCase());
  });

  it("createPot → join → propose → vote → ack → settle through the HTTP API", async () => {
    const invite = privateKeyToAccount(generatePrivateKey());
    // bob registers for push (EIP-191 verified against the chain client)
    const dl = Math.floor(Date.now() / 1000) + 300;
    const token = "ExponentPushToken[bobbobbobbob]";
    const regSig = await bob.signMessage({ message: pushRegisterMessage(bob.address, token, dl) });
    const reg = await s.app.request("/v1/push/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: bob.address, expoPushToken: token, deadline: dl, signature: regSig }),
    });
    expect(reg.status).toBe(200);

    const { r: created, pot } = await createPot(alice, invite, { deposit: USD(2) });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.status).toBe("success");
    expect(created.body.sync).toBe(true);
    expect(created.body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(created.body.events.map((e) => e.name)).toEqual(expect.arrayContaining(["PotCreated", "MemberJoined", "Contributed"]));
    // tight gas limits: limit is estimate + ~10%, so gasUsed is close to it
    expect(BigInt(created.body.gasLimit)).toBeLessThan((BigInt(created.body.gasUsed) * 14n) / 10n);
    expect(await balance(pot)).toBe(USD(2));
    const tx = await s.app.request(`/v1/tx/${created.body.txHash}`);
    expect(tx.status).toBe(200);
    expect(await tx.json()).toMatchObject({
      txHash: created.body.txHash,
      action: "createPot",
      latencyMs: created.body.latencyMs,
      totalMs: created.body.totalMs,
      blockNumber: created.body.blockNumber,
      status: "success",
    });

    const joined = await join(pot, bob, invite, "IN", USD(1));
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body.events.find((e) => e.name === "MemberJoined")?.args.member).toBe(bob.address);

    // An invite signed by the wrong key is decoded into a friendly error
    const stranger = privateKeyToAccount(generatePrivateKey());
    const badJoin = await join(pot, stranger, privateKeyToAccount(generatePrivateKey()), "US");
    expect(badJoin.status).toBe(422);
    expect(badJoin.body.error!.code).toBe("INVALID_INVITE");
    expect(badJoin.body.error!.message).toMatch(/invite link/);

    // $0.40 needs one approval
    const p = await propose(pot, alice, USD(0.4), bob.address, [alice.address, bob.address]);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const proposed = p.body.events.find((e) => e.name === "SpendProposed")!;
    expect(proposed.args.approvalsRequired).toBe(2);
    const id = BigInt(proposed.args.id as string);
    await waitFor(() => pushes.some((m) => m.to === token && m.title === "Approval needed"), "approval push to bob");

    // Over the pot balance → SpendBlocked(9) with plain English
    const tooBig = await propose(pot, alice, USD(50), bob.address, [alice.address, bob.address]);
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error).toMatchObject({ code: "INSUFFICIENT_POT_BALANCE", reason: 9, error: "SpendBlocked" });

    const v = await vote(pot, bob, id);
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body.events.map((e) => e.name)).toEqual(expect.arrayContaining(["Voted", "SpendExecuted"]));
    const again = await vote(pot, bob, id);
    expect(again.status).toBe(422);

    // Settle before acks is refused by simulation
    const early = await relay("settle", { pot });
    expect(early.status).toBe(422);
    expect(early.body.error!.code).toBe("CANNOT_SETTLE");

    expect((await ack(pot, alice)).status).toBe(200);
    expect((await ack(pot, bob)).status).toBe(200);
    const bobBefore = await balance(bob.address);
    const aliceBefore = await balance(alice.address);
    const settled = await relay("settle", { pot });
    expect(settled.status, JSON.stringify(settled.body)).toBe(200);
    expect(settled.body.events.map((e) => e.name)).toContain("Settled");
    // nets: alice 2 - 0.2 = 1.8, bob 1 - 0.2 = 0.8 (bob already got 0.40 as payee)
    expect((await balance(alice.address)) - aliceBefore).toBe(USD(1.8));
    expect((await balance(bob.address)) - bobBefore).toBe(USD(0.8));
    await waitFor(() => s.store.getPot(pot)?.settled, "settled in store");
  });

  it("refuses non-pot targets and expired requests", async () => {
    const r = await relay("settle", { pot: d.ausd });
    expect(r.status).toBe(403);
    const nonce = randomNonce();
    const exp = await relay("ack", { pot: d.ausd, member: alice.address, nonce, deadline: 1, sig: "0x" + "11".repeat(65) });
    expect(exp.status).toBe(422);
    expect(exp.body.error!.code).toBe("EXPIRED");
  });

  it("reads the FxReference address from the factory", async () => {
    expect(s.relayer.contracts.fxReference?.toLowerCase()).toBe(d.fxReference.toLowerCase());
    // (GET /v1/fx/round is cached for 15 s, so the first read happens after rounds are written below.)
  });

  it("send records the FxReference round, its reference rate and the difference", async () => {
    const now = (await d.pub.getBlock()).timestamp;
    // round 1 is 7 h old (stale), round 2 is fresh: GBP $1.34, INR $0.0113
    await d.writeFxRound({ GBP: 134_000_000n, INR: 1_130_000n }, now - 7n * 3600n);
    await d.writeFxRound({ GBP: 134_000_000n, INR: 1_130_000n, EUR: 116_000_000n });
    const round = (await (await s.app.request("/v1/fx/round")).json()) as { roundId: string; fresh: boolean; usdPerUnitE8: Record<string, string>; sourceMasks: Record<string, number> };
    expect(round).toMatchObject({ roundId: "2", fresh: true, usdPerUnitE8: { GBP: "134000000", INR: "1130000", EUR: "116000000" }, sourceMasks: { GBP: 3 } });

    const send = async (fxRoundId: bigint | undefined, fxRateE8 = 11_800_000_000n) => {
      const meta: SendMeta = {
        to: bob.address,
        fromCountry: asciiToBytes("GB"),
        toCountry: asciiToBytes("IN"),
        fromCurrency: asciiToBytes("GBP"),
        toCurrency: asciiToBytes("INR"),
        fxRateE8,
        fxTimestamp: BigInt(Math.floor(Date.now() / 1000)),
        fxRoundId: fxRoundId ?? 0n,
        memoHash: ZERO_BYTES32,
        salt: randomBytes32(),
      };
      const a = await signReceiveAuth(alice, { chainId, ausd: d.ausd, to: d.plansSend, value: USD(1), validBefore: deadline(), nonce: hashSendMeta(meta), domain: AGORA });
      const { fxRoundId: _omit, ...rest } = meta;
      return relay("send", { from: alice.address, meta: fxRoundId === undefined ? rest : meta, auth: a });
    };

    // fresh round: ref = floor(1.34e8 * 1e8 / 1_130_000) = 11_858_407_079; diff = trunc((11.8e9 - ref) * 1e4 / ref) = -49
    const ok = await send(2n);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const sent = ok.body.events.find((e) => e.name === "Sent")!;
    expect(sent.args).toMatchObject({ fxRoundId: "2", refRateE8: "11858407079", fxDiffBps: "-49", amount: "1000000" });
    expect(await d.pub.readContract({ address: d.plansSend, abi: plansSendAbi, functionName: "fxReference" })).toBe(getAddress(d.fxReference));

    // no fxRoundId at all (an older client): defaults to 0 in the nonce and the calldata
    const plain = await send(undefined);
    expect(plain.status, JSON.stringify(plain.body)).toBe(200);
    expect(plain.body.events.find((e) => e.name === "Sent")!.args).toMatchObject({ fxRoundId: "0", refRateE8: "0", fxDiffBps: "0" });

    const unknown = await send(99n);
    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toMatchObject({ code: "FX_ROUND_UNKNOWN", error: "FxRoundUnknown" });
    const stale = await send(1n);
    expect(stale.status).toBe(422);
    expect(stale.body.error).toMatchObject({ code: "FX_ROUND_STALE", error: "FxRoundStale" });
    expect(stale.body.error!.message).toMatch(/more than 6 hours old/);
    expect(JSON.stringify(stale.body.error)).not.toMatch(/unrecognised|0x[0-9a-f]{8}\)/);
  });

  it("collect pays a member whose payout AUSD refused at settlement, once the account is unfrozen", async () => {
    const invite = privateKeyToAccount(generatePrivateKey());
    const { r, pot } = await createPot(alice, invite, { deposit: USD(2) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await join(pot, bob, invite, "IN", USD(1))).status).toBe(200);

    const early = await relay("collect", { pot, member: bob.address });
    expect(early.status).toBe(422);
    expect(early.body.error).toMatchObject({ code: "NOT_SETTLED", error: "NotSettled" });

    expect((await ack(pot, alice)).status).toBe(200);
    expect((await ack(pot, bob)).status).toBe(200);
    const mockAbi = artifact("MockAUSD").abi;
    const setFrozen = async (on: boolean) =>
      d.pub.waitForTransactionReceipt({ hash: await d.wallet.writeContract({ address: d.ausd, abi: mockAbi, functionName: "setFrozen", args: [bob.address, on] } as never) });
    await setFrozen(true);
    const settled = await relay("settle", { pot });
    expect(settled.status, JSON.stringify(settled.body)).toBe(200);
    const ev = settled.body.events.find((e) => e.name === "Settled")!;
    expect(ev.args).toMatchObject({ unpaidClaims: "1000000", fxRoundId: "2" }); // round 2 is fresh
    await waitFor(() => s.store.getPot(pot)?.settled, "settled in store");

    const refused = await relay("collect", { pot, member: bob.address });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({ code: "PAYOUT_REFUSED", error: "PayoutRefused" });
    expect(refused.body.error!.message).toMatch(/claim is kept/);

    await setFrozen(false);
    const before = await balance(bob.address);
    const c = await relay("collect", { pot, member: bob.address });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.events.map((e) => e.name)).toEqual(expect.arrayContaining(["Payout", "Collected"]));
    expect(c.body.events.find((e) => e.name === "Collected")!.args).toMatchObject({ member: bob.address, amount: "1000000" });
    expect((await balance(bob.address)) - before).toBe(USD(1));

    const again = await relay("collect", { pot, member: bob.address });
    expect(again.status).toBe(422);
    expect(again.body.error).toMatchObject({ code: "NOTHING_TO_COLLECT" });
    const stranger = await relay("collect", { pot, member: judge.address });
    expect(stranger.status).toBe(422);
    expect(stranger.body.error!.code).toBe("NOT_MEMBER");
  });

  it("demo members approve small spends and ack after a human acks", async () => {
    const invite = privateKeyToAccount(generatePrivateKey());
    const { r, pot } = await createPot(alice, invite, { deposit: USD(1) });
    expect(r.status).toBe(200);
    const ben = s.demo!.acct("ben");
    await s.demo!.join(ben, pot, invite);
    await waitFor(() => s.store.members(pot).length === 2, "ben joined");

    const p = await propose(pot, alice, USD(0.5), alice.address, [alice.address, ben.account.address]);
    expect(p.status).toBe(200);
    const id = BigInt(p.body.events.find((e) => e.name === "SpendProposed")!.args.id as string);
    const t0 = Date.now();
    await waitFor(() => s.store.getProposal(pot, id)?.status === "executed", "Ben's approval executes the spend", 15_000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250); // waited the random delay

    // a second small spend: Ben approves that too
    const big = await propose(pot, alice, USD(0.45), alice.address, [alice.address]);
    expect(big.status).toBe(200);
    const bigId = BigInt(big.body.events.find((e) => e.name === "SpendProposed")!.args.id as string);
    await waitFor(() => s.store.getProposal(pot, bigId)?.status === "executed", "second approval");

    expect((await ack(pot, alice)).status).toBe(200);
    await waitFor(() => {
      const row = s.store.getPot(pot)!;
      return s.store.members(pot).every((m) => m.ackEpoch === row.ackEpoch);
    }, "Ben acks after Alice");
    expect(await d.pub.readContract({ address: pot, abi: potAbi, functionName: "canSettle" })).toBe(true);
  });

  it("demo members leave spends above the approval cap alone", async () => {
    const invite = privateKeyToAccount(generatePrivateKey());
    const { pot } = await createPot(bob, invite, { deposit: USD(5) });
    await s.demo!.join(s.demo!.acct("asha"), pot, invite);
    await waitFor(() => s.store.members(pot).length === 2, "asha joined");
    const p = await propose(pot, bob, USD(1.5), bob.address, [bob.address]); // > $1 cap → majority of 2 = 2
    expect(p.status).toBe(200);
    const id = BigInt(p.body.events.find((e) => e.name === "SpendProposed")!.args.id as string);
    await new Promise((r) => setTimeout(r, 1500));
    expect(s.store.getProposal(pot, id)?.status).toBe("pending");
    expect(s.store.voters(pot, id)).toEqual([]);
  });

  it("Try a settle-up: demo plan, judge joins, scripted spends and acks, judge settles", async () => {
    const res = await s.app.request("/v1/demo/try-settle-up", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
      body: JSON.stringify({ member: judge.address }),
    });
    const j = (await res.json()) as { pot: Address; inviteSecret: Hex; creator: Address; endTime: number };
    expect(res.status, JSON.stringify(j)).toBe(200);
    expect(j.creator).toBe(s.demo!.acct("maya").account.address);

    const accounts = (await (await s.app.request("/v1/demo/accounts")).json()) as { accounts: { name: string; address: string }[]; pots: { pot: string }[] };
    expect(accounts.accounts.map((a) => a.name)).toEqual(["Ben", "Asha", "Maya"]);
    expect(accounts.pots.map((p) => p.pot)).toContain(j.pot);

    // The app joins the judge with the invite secret
    const joined = await join(j.pot, judge, privateKeyToAccount(j.inviteSecret), "US");
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);

    await waitFor(
      async () => {
        const st = (await (await s.app.request(`/v1/demo/try-settle-up/${j.pot}`)).json()) as { stage: string; lastError: string | null };
        if (st.stage === "failed") throw new Error(st.lastError ?? "failed");
        return st.stage === "ready";
      },
      "demo script to finish",
      45_000,
      200,
    );
    const members = s.store.members(j.pot).map((m) => m.member);
    expect(members).toHaveLength(4);
    const spends = s.store.openProposals(j.pot);
    expect(spends).toEqual([]); // all instant, executed
    expect(await d.pub.readContract({ address: j.pot, abi: potAbi, functionName: "netOf", args: [judge.address] })).toBeLessThan(0n);

    // Judge acks and presses Settle up
    expect((await ack(j.pot, judge)).status).toBe(200);
    const settled = await relay("settle", { pot: j.pot });
    expect(settled.status, JSON.stringify(settled.body)).toBe(200);
    const names = settled.body.events.map((e) => e.name);
    expect(names).toContain("Settled");
    expect(names).toContain("DebtRecorded"); // the judge gave no safety net, so their share is a debt
    await waitFor(async () => {
      const st = (await (await s.app.request(`/v1/demo/try-settle-up/${j.pot}`)).json()) as { stage: string };
      return st.stage === "done";
    }, "run marked done");

    // per-judge rate limit (default 3/day)
    for (let i = 0; i < 2; i++) {
      const again = await s.app.request("/v1/demo/try-settle-up", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ member: judge.address }) });
      expect(again.status).toBe(200);
    }
    const limited = await s.app.request("/v1/demo/try-settle-up", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ member: judge.address }) });
    expect(limited.status).toBe(429);
  }, 90_000);

  it("faucet forwards test dollars once per address per day", async () => {
    const who = privateKeyToAccount(generatePrivateKey()).address;
    const req = () =>
      s.app.request("/v1/faucet", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7" }, body: JSON.stringify({ address: who }) });
    const r = await req();
    expect(r.status, await r.clone().text()).toBe(200);
    expect(await balance(who)).toBe(USD(25));
    const again = await req();
    expect(again.status).toBe(429);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("FAUCET_LIMIT");
  });

  it("long-stop settles a forgotten plan 30 days after its review window", async () => {
    const invite = privateKeyToAccount(generatePrivateKey());
    const { pot } = await createPot(alice, invite, { deposit: USD(1), endIn: 60, reviewWindow: 3600 });
    await join(pot, bob, invite, "IN", USD(1));
    await waitFor(() => s.store.members(pot).length === 2, "members");
    const now = Number((await d.pub.getBlock()).timestamp);
    expect(await s.longStop!.runOnce(now)).toEqual([]); // not due yet
    await d.pub.request({ method: "evm_increaseTime" as never, params: [60 + 3600 + 31 * 86_400] as never });
    await d.pub.request({ method: "evm_mine" as never, params: [] as never });
    const later = Number((await d.pub.getBlock()).timestamp);
    const done = await s.longStop!.runOnce(later);
    expect(done).toContain(pot);
    expect(await d.pub.readContract({ address: pot, abi: potAbi, functionName: "settled" })).toBe(true);
  });
});
