/**
 * Demo members Ben (London, GB), Asha (Bengaluru, IN) and Maya (New York, US).
 *
 * They are ordinary members: each action is an EIP-712 message signed with the member's own key
 * and sent through the same Relayer.relay() path (validation, allowlist, simulation) as the app.
 *  - auto-approve pending spends up to DEMO_APPROVE_CAP after a random 3–8 s delay
 *  - auto-ack once a plan's end time passes or a human member acks
 *  - "Try a settle-up": a short plan created by Maya for one judge, scripted after the judge joins
 */
import { getAddress, type Address, type Hex, type PrivateKeyAccount, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ausdAbi, factoryAbi, potAbi } from "../abi.js";
import { resolveAusdDomain } from "../ausd.js";
import type { Config } from "../config.js";
import {
  asciiToBytes,
  EMPTY_AUTH,
  EMPTY_KEYREG,
  EMPTY_PERMIT,
  factoryDomain,
  factoryTypes,
  hashCreatePotParams,
  hashMemo,
  hashSplit,
  randomBytes32,
  randomNonce,
  signPot,
  signReceiveAuth,
  ZERO_BYTES32,
  type CreatePotParams,
  type Split,
} from "../eip712.js";
import { RelayError } from "../errors.js";
import type { Faucet } from "../faucet.js";
import type { ChainEvent } from "../listener.js";
import { log, shortErr } from "../log.js";
import type { Relayer, RelayResult } from "../relay.js";
import type { DemoRunRow, Store } from "../store.js";
import { Backoff, demoMembersToAck, pickDemoVoter, planSettleUp, randomDelay, SETTLE_UP_STEPS } from "./policy.js";

type DemoKey = "ben" | "asha" | "maya";

export interface DemoAccount {
  key: DemoKey;
  name: string;
  city: string;
  country: string;
  account: PrivateKeyAccount;
}

const PROFILES: Record<DemoKey, { name: string; city: string; country: string }> = {
  ben: { name: "Ben", city: "London", country: "GB" },
  asha: { name: "Asha", city: "Bengaluru", country: "IN" },
  maya: { name: "Maya", city: "New York", country: "US" },
};

export const DEMO_RULES = {
  instantMax: 250_000n, // $0.25
  oneApprovalMax: 1_000_000n, // $1
  highTier: 0,
  memberDailyCap: 0n,
  memberTotalCap: 0n,
  payeePolicy: 0,
  minContribution: 0n,
  proposalTtl: 3600,
  ruleTimelock: 300,
  categoryBudgets: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as const,
};

/** Plaintext meta for demo plans when the app doesn't supply group-key ciphertext. Version byte 0x00 = plaintext JSON. */
export function demoMeta(name: string): Hex {
  const json = JSON.stringify({ v: 0, name, emoji: "🧾", demo: true });
  return `0x00${Buffer.from(json, "utf8").toString("hex")}` as Hex;
}

export interface TrySettleUpExtras {
  meta?: Hex;
  creatorKeyWrap?: Hex;
  inviteKeyWrap?: Hex;
  inviteSecret?: Hex;
  memos?: Hex[];
}

export interface DemoDeps {
  cfg: Config["demo"];
  chainId: number;
  isTestnet: boolean;
  store: Store;
  relayer: Relayer;
  client: PublicClient;
  faucet?: Faucet;
  rng?: () => number;
  now?: () => number;
}

export class DemoService {
  readonly accounts: DemoAccount[];
  readonly demoSet: Set<string>;
  #scheduled = new Map<string, NodeJS.Timeout>();
  #inflight = new Set<string>();
  #cooldown = new Map<string, number>();
  #backoff = new Backoff();
  #runNextAt = new Map<string, number>();
  #timer: NodeJS.Timeout | null = null;
  #ticking = false;
  #ausdDomain?: { name: string; version: string };
  readonly rng: () => number;
  readonly now: () => number;

  constructor(readonly d: DemoDeps) {
    this.rng = d.rng ?? Math.random;
    this.now = d.now ?? Date.now;
    this.accounts = (Object.keys(PROFILES) as DemoKey[])
      .filter((k) => d.cfg.keys[k])
      .map((k) => ({ key: k, ...PROFILES[k], account: privateKeyToAccount(d.cfg.keys[k]!.reveal()) }));
    this.demoSet = new Set(this.accounts.map((a) => a.account.address.toLowerCase()));
  }

  get enabled() {
    return this.d.cfg.enabled && this.accounts.length > 0;
  }

  acct(k: DemoKey): DemoAccount {
    const a = this.accounts.find((x) => x.key === k);
    if (!a) throw new RelayError(503, "DEMO_NOT_CONFIGURED", `Demo account ${PROFILES[k].name} has no key configured.`);
    return a;
  }

  isDemo(a: string) {
    return this.demoSet.has(a.toLowerCase());
  }

  publicAccounts() {
    return {
      enabled: this.enabled,
      accounts: this.accounts.map((a) => ({ name: a.name, city: a.city, country: a.country, address: a.account.address })),
      pots: this.d.store.demoRuns().map((r) => ({ pot: r.pot, stage: r.stage, createdAt: r.createdAt })),
    };
  }

  start() {
    if (!this.enabled) return;
    this.#timer = setInterval(() => void this.tick(), this.d.cfg.tickMs);
    if (this.d.isTestnet && this.d.faucet?.enabled) void this.#fundFromFaucet();
    log.info("demo members enabled", { accounts: this.accounts.map((a) => `${a.name}:${a.account.address}`) });
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    for (const t of this.#scheduled.values()) clearTimeout(t);
    this.#scheduled.clear();
  }

  /** Listener hook: react quickly to events that may need a demo action. */
  handle = (ev: ChainEvent) => {
    if (!this.enabled || !ev.live) return;
    if (["SpendProposed", "Voted", "Acked", "AcksReset", "MemberJoined", "Settled", "SpendExecuted"].includes(ev.name)) {
      setTimeout(() => void this.tick(), 50);
    }
  };

  #nowSec() {
    return Math.floor(this.now() / 1000);
  }

  async #ausd(): Promise<{ address: Address; domain: { name: string; version: string } }> {
    const address = this.d.relayer.contracts.ausd;
    if (!address) throw new RelayError(503, "NOT_CONFIGURED", "AUSD address unknown.");
    this.#ausdDomain ??= await resolveAusdDomain(this.d.client, address, this.d.chainId);
    return { address, domain: this.#ausdDomain };
  }

  async #fundFromFaucet() {
    const { address } = await this.#ausd().catch(() => ({ address: undefined }));
    if (!address) return;
    for (const a of this.accounts) {
      try {
        const bal = (await this.d.client.readContract({ address, abi: ausdAbi, functionName: "balanceOf", args: [a.account.address] })) as bigint;
        if (bal < 1_000_000n) {
          await this.d.faucet!.requestFromFaucet(a.account.address);
          log.info("demo account funded from testnet faucet", { name: a.name });
          await new Promise((r) => setTimeout(r, 61_000));
        }
      } catch (e) {
        log.warn("demo faucet funding failed", { name: a.name, error: shortErr(e) });
      }
    }
  }

  // ───────────── the tick ─────────────

  async tick() {
    if (!this.enabled || this.#ticking) return;
    this.#ticking = true;
    try {
      this.#scheduleVotes();
      this.#scheduleAcks();
      for (const run of this.d.store.demoRuns(true)) void this.#advance(run);
    } catch (e) {
      log.warn("demo tick failed", { error: shortErr(e) });
    } finally {
      this.#ticking = false;
    }
  }

  #demoPots(): Address[] {
    const set = new Set<Address>();
    for (const a of this.accounts) for (const p of this.d.store.potsOfMember(a.account.address)) set.add(p);
    return [...set];
  }

  #scheduleVotes() {
    const s = this.d.store;
    const nowSec = this.#nowSec();
    for (const pot of this.#demoPots()) {
      const active = s.members(pot).map((m) => m.member);
      for (const p of s.openProposals(pot)) {
        const key = `vote:${pot}:${p.id}`;
        if (this.#backoff.blocked(key) || this.#inflight.has(key) || this.#coolingDown(key)) continue;
        const voter = pickDemoVoter({
          proposal: p,
          voters: s.voters(pot, p.id),
          activeMembers: active,
          demo: this.demoSet,
          approveCap: this.d.cfg.approveCap,
          nowSec,
          alreadyScheduled: this.#scheduled.has(key),
        });
        if (!voter) continue;
        const delay = randomDelay(this.d.cfg.voteDelayMinMs, this.d.cfg.voteDelayMaxMs, this.rng);
        log.info("demo vote scheduled", { pot, id: p.id.toString(), voter, delayMs: delay });
        this.#scheduled.set(
          key,
          setTimeout(() => {
            void this.#doVote(pot, p.id, voter, key).finally(() => this.#scheduled.delete(key));
          }, delay),
        );
      }
    }
  }

  #coolingDown(key: string) {
    const u = this.#cooldown.get(key);
    if (u === undefined) return false;
    if (u > this.now()) return true;
    this.#cooldown.delete(key);
    return false;
  }

  async #doVote(pot: Address, id: bigint, voterAddr: Address, key: string) {
    const s = this.d.store;
    const p = s.getProposal(pot, id);
    if (!p || p.status !== "pending") return;
    if (s.voters(pot, id).some((v) => v.toLowerCase() === voterAddr.toLowerCase())) return;
    const a = this.accounts.find((x) => x.account.address.toLowerCase() === voterAddr.toLowerCase());
    if (!a) return;
    this.#inflight.add(key);
    try {
      const res = await this.vote(a, pot, id, true);
      this.#backoff.ok(key);
      this.#cooldown.set(key, this.now() + 3_000);
      log.info("demo member approved", { name: a.name, pot, id: id.toString(), txHash: res.txHash });
    } catch (e) {
      this.#backoff.fail(key);
      log.warn("demo vote failed", { name: a.name, pot, id: id.toString(), error: shortErr(e) });
    } finally {
      this.#inflight.delete(key);
    }
  }

  #scheduleAcks() {
    const s = this.d.store;
    const nowSec = this.#nowSec();
    for (const pot of this.#demoPots()) {
      const row = s.getPot(pot);
      if (!row) continue;
      // Scripted runs ack as their last steps; don't ack early mid-script.
      const run = s.getDemoRun(pot);
      if (run && (run.stage === "awaiting_judge" || run.stage === "running")) continue;
      for (const m of demoMembersToAck({ pot: row, members: s.members(pot), demo: this.demoSet, nowSec })) {
        const key = `ack:${pot}:${m}:${row.ackEpoch}`;
        if (this.#backoff.blocked(key) || this.#inflight.has(key) || this.#coolingDown(key)) continue;
        const a = this.accounts.find((x) => x.account.address.toLowerCase() === m.toLowerCase());
        if (!a) continue;
        this.#inflight.add(key);
        void this.ack(a, pot)
          .then((r) => {
            this.#backoff.ok(key);
            this.#cooldown.set(key, this.now() + 10_000);
            log.info("demo member acked", { name: a.name, pot, txHash: r.txHash });
          })
          .catch((e) => {
            this.#backoff.fail(key);
            log.warn("demo ack failed", { name: a.name, pot, error: shortErr(e) });
          })
          .finally(() => this.#inflight.delete(key));
      }
    }
  }

  // ───────────── signed actions (same relay path as the app) ─────────────

  #deadline() {
    return BigInt(this.#nowSec() + 600);
  }

  async vote(a: DemoAccount, pot: Address, id: bigint, approve: boolean): Promise<RelayResult> {
    const nonce = randomNonce();
    const deadline = this.#deadline();
    const sig = await signPot(a.account, this.d.chainId, pot, "Vote", { member: a.account.address, id, approve, nonce, deadline });
    return this.d.relayer.relay({ action: "vote", params: { pot, member: a.account.address, id, approve, nonce, deadline, sig } }, { source: "demo" });
  }

  async ack(a: DemoAccount, pot: Address): Promise<RelayResult> {
    const nonce = randomNonce();
    const deadline = this.#deadline();
    const sig = await signPot(a.account, this.d.chainId, pot, "Ack", { member: a.account.address, nonce, deadline });
    return this.d.relayer.relay({ action: "ack", params: { pot, member: a.account.address, nonce, deadline, sig } }, { source: "demo" });
  }

  async join(a: DemoAccount, pot: Address, invite: PrivateKeyAccount): Promise<RelayResult> {
    const nonce = randomNonce();
    const deadline = this.#deadline();
    const country = asciiToBytes(a.country);
    const memberSig = await signPot(a.account, this.d.chainId, pot, "Join", { member: a.account.address, country, safetyNet: 0n, nonce, deadline });
    const inviteSig = await signPot(invite, this.d.chainId, pot, "Invite", { member: a.account.address });
    return this.d.relayer.relay(
      {
        action: "join",
        params: { pot, member: a.account.address, country: a.country, nonce, deadline, memberSig, inviteSig },
      },
      { source: "demo" },
    );
  }

  async contribute(a: DemoAccount, pot: Address, amount: bigint): Promise<RelayResult> {
    const { address, domain } = await this.#ausd();
    const bal = (await this.d.client.readContract({ address, abi: ausdAbi, functionName: "balanceOf", args: [a.account.address] })) as bigint;
    if (bal < amount) {
      if (this.d.isTestnet && this.d.faucet?.enabled) await this.d.faucet.requestFromFaucet(a.account.address).catch(() => undefined);
      else throw new RelayError(503, "DEMO_UNDERFUNDED", `Demo account ${a.name} needs more AUSD.`);
    }
    const auth = await signReceiveAuth(a.account, {
      chainId: this.d.chainId,
      ausd: address,
      to: pot,
      value: amount,
      validBefore: BigInt(this.#nowSec() + 3600),
      domain,
    });
    return this.d.relayer.relay({ action: "contribute", params: { pot, member: a.account.address, auth } }, { source: "demo" });
  }

  async propose(
    a: DemoAccount,
    pot: Address,
    s: { kind: number; payee: Address; amount: bigint; category: number; split: Split; memo?: Hex },
  ): Promise<RelayResult> {
    const nonce = randomNonce();
    const deadline = this.#deadline();
    const memo = s.memo ?? "0x";
    const sig = await signPot(a.account, this.d.chainId, pot, "Propose", {
      proposer: a.account.address,
      kind: s.kind,
      payee: s.payee,
      amount: s.amount,
      category: s.category,
      splitHash: hashSplit(s.split),
      receiptHash: ZERO_BYTES32,
      memoHash: hashMemo(memo),
      nonce,
      deadline,
    });
    return this.d.relayer.relay(
      {
        action: "propose",
        params: {
          pot,
          proposer: a.account.address,
          kind: s.kind,
          payee: s.payee,
          amount: s.amount,
          category: s.category,
          split: { members: s.split.members, weights: s.split.weights },
          receiptHash: ZERO_BYTES32,
          memo,
          nonce,
          deadline,
          sig,
        },
      },
      { source: "demo" },
    );
  }

  async createPot(creator: DemoAccount, params: CreatePotParams): Promise<{ pot: Address; result: RelayResult }> {
    const factory = this.d.relayer.contracts.factory;
    if (!factory) throw new RelayError(503, "NOT_CONFIGURED", "PlansFactory address is not configured.");
    const nonce = randomNonce();
    const deadline = this.#deadline();
    const sig = await creator.account.signTypedData({
      domain: factoryDomain(this.d.chainId, factory),
      types: factoryTypes,
      primaryType: "CreatePot",
      message: { creator: creator.account.address, paramsHash: hashCreatePotParams(params), nonce, deadline },
    });
    const result = await this.d.relayer.relay(
      {
        action: "createPot",
        params: {
          creator: creator.account.address,
          params: { ...params, rules: { ...params.rules, categoryBudgets: [...params.rules.categoryBudgets] } },
          nonce,
          deadline,
          sig,
          deposit: EMPTY_AUTH,
          safetyNet: EMPTY_PERMIT,
          keyReg: EMPTY_KEYREG,
        },
      },
      { source: "demo" },
    );
    const ev = result.events.find((e) => e.name === "PotCreated");
    let pot = ev ? (getAddress(String(ev.args.pot)) as Address) : undefined;
    pot ??= (await this.d.client.readContract({ address: factory, abi: factoryAbi, functionName: "predictPot", args: [creator.account.address, params.salt] })) as Address;
    return { pot, result };
  }

  // ───────────── Try a settle-up ─────────────

  async trySettleUp(judgeIn: string, ip: string, extras: TrySettleUpExtras = {}) {
    if (!this.enabled) throw new RelayError(404, "DEMO_DISABLED", "Demo members aren't enabled on this relayer.");
    const judge = getAddress(judgeIn);
    if (this.isDemo(judge)) throw new RelayError(400, "INVALID_MEMBER", "That's a demo account.");
    const maya = this.acct("maya");
    this.acct("ben");
    this.acct("asha");
    const plan = planSettleUp({ deposit: this.d.cfg.deposit, maxOutlay: this.d.cfg.maxOutlay, instantMax: DEMO_RULES.instantMax });

    const judgeKey = `demo:judge:${judge.toLowerCase()}`;
    const ipKey = `demo:ip:${ip}`;
    if (!this.d.store.takeDaily(judgeKey, this.d.cfg.perJudgePerDay)) {
      throw new RelayError(429, "DEMO_LIMIT", "You've started enough demo settle-ups for today. Try again tomorrow.");
    }
    if (!this.d.store.takeDaily(ipKey, this.d.cfg.perIpPerDay)) {
      this.d.store.refundDaily(judgeKey);
      throw new RelayError(429, "DEMO_NETWORK_LIMIT", "Many people on this network started a demo today.");
    }
    try {
      const inviteSecret = extras.inviteSecret ?? generatePrivateKey();
      const invite = privateKeyToAccount(inviteSecret);
      const block = await this.d.client.getBlock({ blockTag: "latest" });
      const t = Number(block.timestamp);
      const params: CreatePotParams = {
        rules: DEMO_RULES,
        startTime: BigInt(t), // Pot treats a start in the past as "now"
        endTime: BigInt(t + this.d.cfg.planMinutes * 60),
        reviewWindow: 0,
        inviteSigner: invite.address,
        creatorCountry: asciiToBytes(maya.country),
        creatorSafetyNet: 0n,
        meta: extras.meta ?? demoMeta("Try a settle-up"),
        creatorKeyWrap: extras.creatorKeyWrap ?? "0x",
        inviteKeyWrap: extras.inviteKeyWrap ?? "0x",
        salt: randomBytes32(),
      };
      const { pot, result } = await this.createPot(maya, params);
      this.d.store.insertDemoRun({
        pot,
        judge,
        inviteSecret,
        stage: "awaiting_judge",
        createdAt: this.#nowSec(),
        endTime: Number(params.endTime),
        meta: JSON.stringify({ memos: extras.memos ?? [], deposit: plan.deposit.toString() }),
      });
      log.info("demo settle-up created", { pot, judge, txHash: result.txHash });
      return {
        pot,
        inviteSecret,
        inviteSigner: invite.address,
        creator: maya.account.address,
        startTime: Number(params.startTime),
        endTime: Number(params.endTime),
        rules: { instantMax: "250000", oneApprovalMax: "1000000", reviewWindow: 0 },
        demoMembers: this.publicAccounts().accounts,
        txHash: result.txHash,
        latencyMs: result.latencyMs,
      };
    } catch (e) {
      this.d.store.refundDaily(judgeKey);
      this.d.store.refundDaily(ipKey);
      throw e;
    }
  }

  runStatus(pot: Address) {
    const r = this.d.store.getDemoRun(pot);
    if (!r) return undefined;
    const step = r.stage === "running" ? SETTLE_UP_STEPS[r.step] : undefined;
    return { pot: r.pot, judge: r.judge, stage: r.stage, step: step ?? null, stepIndex: r.step, totalSteps: SETTLE_UP_STEPS.length, endTime: r.endTime, lastError: r.lastError };
  }

  #runBusy = new Set<string>();

  async #advance(run: DemoRunRow) {
    if (this.#runBusy.has(run.pot)) return;
    if ((this.#runNextAt.get(run.pot) ?? 0) > this.now()) return;
    this.#runBusy.add(run.pot);
    const s = this.d.store;
    const nowSec = this.#nowSec();
    try {
      const pot = s.getPot(run.pot);
      if (pot?.settled) {
        s.updateDemoRun(run.pot, { stage: "done", lastError: null });
        return;
      }
      switch (run.stage) {
        case "awaiting_judge": {
          const joined = s.members(run.pot).some((m) => m.member.toLowerCase() === run.judge.toLowerCase());
          if (joined) {
            s.updateDemoRun(run.pot, { stage: "running", step: 0 });
            this.#runNextAt.set(run.pot, this.now() + this.d.cfg.stepDelayMs);
          } else if (nowSec > run.endTime) {
            s.updateDemoRun(run.pot, { stage: "abandoned" });
          }
          return;
        }
        case "running": {
          const step = SETTLE_UP_STEPS[run.step];
          if (!step) {
            s.updateDemoRun(run.pot, { stage: "ready" });
            return;
          }
          const key = `run:${run.pot}:${run.step}`;
          if (this.#backoff.blocked(key)) return;
          try {
            const tx = await this.#doStep(run, step);
            this.#backoff.ok(key);
            s.updateDemoRun(run.pot, { step: run.step + 1, lastError: null });
            this.#runNextAt.set(run.pot, this.now() + this.d.cfg.stepDelayMs);
            log.info("demo settle-up step", { pot: run.pot, step, txHash: tx?.txHash ?? null });
          } catch (e) {
            const n = this.#backoff.fail(key);
            const msg = e instanceof RelayError ? `${e.code}: ${e.message}` : shortErr(e);
            log.warn("demo settle-up step failed", { pot: run.pot, step, attempt: n, error: msg });
            if (n >= 5) s.updateDemoRun(run.pot, { stage: "failed", lastError: `${step}: ${msg}` });
            else s.updateDemoRun(run.pot, { lastError: `${step}: ${msg}` });
          }
          return;
        }
        case "ready": {
          // Normally the judge presses Settle up. If nobody does, settle after the end time.
          if (nowSec > run.endTime + 120) {
            const key = `settle:${run.pot}`;
            if (this.#backoff.blocked(key)) return;
            const can = (await this.d.client.readContract({ address: run.pot, abi: potAbi, functionName: "canSettle" })) as boolean;
            if (!can) {
              this.#backoff.fail(key);
              return;
            }
            try {
              await this.d.relayer.relay({ action: "settle", params: { pot: run.pot } }, { source: "demo" });
              s.updateDemoRun(run.pot, { stage: "done" });
            } catch (e) {
              this.#backoff.fail(key);
              s.updateDemoRun(run.pot, { lastError: `settle: ${shortErr(e)}` });
            }
          }
          return;
        }
      }
    } catch (e) {
      log.warn("demo run advance failed", { pot: run.pot, error: shortErr(e) });
    } finally {
      this.#runBusy.delete(run.pot);
    }
  }

  async #doStep(run: DemoRunRow, step: (typeof SETTLE_UP_STEPS)[number]): Promise<RelayResult | null> {
    const s = this.d.store;
    const pot = run.pot;
    const meta = run.meta ? (JSON.parse(run.meta) as { memos?: Hex[]; deposit?: string }) : {};
    const plan = planSettleUp({
      deposit: meta.deposit ? BigInt(meta.deposit) : this.d.cfg.deposit,
      maxOutlay: this.d.cfg.maxOutlay,
      instantMax: DEMO_RULES.instantMax,
    });
    const [who, what] = step.split(".") as [string, string];
    const isMember = (a: Address) => s.members(pot).some((m) => m.member.toLowerCase() === a.toLowerCase());

    if (who === "spend") {
      const i = Number(what);
      const sp = plan.spends[i];
      const by = this.acct(sp.by);
      const judgeIn = isMember(run.judge);
      const everyone = [this.acct("ben"), this.acct("asha"), this.acct("maya")].map((x) => x.account.address);
      let members: Address[] = sp.splitWithJudgeOnly ? [by.account.address] : everyone;
      if (judgeIn) members = [...members, run.judge];
      if (members.length < 2 && sp.splitWithJudgeOnly) members = everyone;
      const split = { members, weights: members.map(() => 1) };
      const memo = (meta.memos?.[i] && /^0x([0-9a-fA-F]{2})*$/.test(meta.memos[i]) ? meta.memos[i] : "0x") as Hex;
      return this.propose(by, pot, { kind: sp.kind, payee: by.account.address, amount: sp.amount, category: sp.category, split, memo });
    }
    const a = this.acct(who as DemoKey);
    switch (what) {
      case "join": {
        if (isMember(a.account.address)) return null;
        const onchain = (await this.d.client.readContract({ address: pot, abi: potAbi, functionName: "isMember", args: [a.account.address] })) as boolean;
        if (onchain) return null;
        return this.join(a, pot, privateKeyToAccount(run.inviteSecret as Hex));
      }
      case "contribute":
        return this.contribute(a, pot, plan.deposit);
      case "ack": {
        const row = s.getPot(pot);
        const me = s.members(pot).find((m) => m.member.toLowerCase() === a.account.address.toLowerCase());
        if (row && me && me.ackEpoch === row.ackEpoch) return null;
        return this.ack(a, pot);
      }
    }
    throw new Error(`unknown demo step ${step}`);
  }
}
