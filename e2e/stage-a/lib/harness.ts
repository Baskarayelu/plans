/**
 * Scenario recorder, expectations, "nothing changed onchain" checks, invariants and time control.
 */
import { type Address, type Hex } from "viem";
import { AUSD_TOTAL_SUPPLY_SLOT, AUSD, type Anvil, type Deployment } from "./env";
import { ABI, findEvent, type Api, type Ctx, type HttpResult } from "./plans";

export type Kind = "flow" | "failure" | "invariant" | "http";

export interface Result {
  id: number;
  group: string;
  name: string;
  kind: Kind;
  status: "PASS" | "FAIL";
  expected: string;
  actual: string;
  txs: Hex[];
  latency: { action: string; latencyMs?: number; totalMs?: number; clientMs: number; sync?: boolean; gasUsed?: string; gasLimit?: string }[];
  error?: string;
  notes: string[];
  ms: number;
}

export class Check extends Error {}

export interface Env {
  anvil: Anvil;
  dep: Deployment;
  ctx: Ctx;
  api: Api;
  strict: Api;
  pots: Map<Address, string>; // pot -> label, for invariants and fingerprints
  tracked: Map<string, string>; // lowercase address -> label, for AUSD conservation
  demoPots: Set<string>;
  fundedTotal: bigint; // AUSD added to tracked addresses by the harness
  supplyAfterFunding: bigint;
}

const fmt = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

export class Scenario {
  txs: Hex[] = [];
  latency: Result["latency"] = [];
  notes: string[] = [];
  expected = "";
  actual = "";
  okCount?: number;
  lastOk?: string;
  constructor(readonly env: Env) {}

  note(s: string) {
    this.notes.push(s);
  }

  expect(cond: unknown, msg: string): void {
    if (!cond) throw new Check(msg);
  }

  eq<T>(actual: T, expected: T, what: string) {
    if (fmt(actual) !== fmt(expected)) throw new Check(`${what}: expected ${fmt(expected)}, got ${fmt(actual)}`);
  }

  /** A relayed action that must succeed onchain. Records tx hash and latency. */
  ok(r: HttpResult, ...events: string[]): HttpResult {
    const b = r.body;
    if (r.status !== 200 || b.status !== "success") {
      throw new Check(`${r.request?.action ?? "request"}: expected success, got HTTP ${r.status} ${fmt(b.error ?? b.status)}`);
    }
    this.txs.push(b.txHash!);
    this.latency.push({ action: b.action ?? "?", latencyMs: b.latencyMs, totalMs: b.totalMs, clientMs: r.clientMs, sync: b.sync, gasUsed: b.gasUsed, gasLimit: b.gasLimit });
    for (const e of events) if (!findEvent(r, e)) throw new Check(`${b.action}: missing event ${e} (got ${(b.events ?? []).map((x) => x.name).join(", ")})`);
    this.okCount = (this.okCount ?? 0) + 1;
    this.lastOk = `${b.action}${events.length ? ` (${events.join(", ")})` : ""}`;
    return r;
  }

  /**
   * A request that must be refused with the given status/code (and SpendBlocked reason), with a
   * plain-English message, and leave the chain untouched: no transaction to the target was mined
   * and the fingerprint of every tracked pot, the escrow and AUSD balances is unchanged.
   */
  async rejects(
    send: () => Promise<HttpResult>,
    exp: { status: number; code: string; reason?: number; error?: string },
    target?: Address,
  ): Promise<HttpResult> {
    const before = await fingerprint(this.env);
    const b0 = await this.env.anvil.pub.getBlockNumber();
    const r = await send();
    const b1 = await this.env.anvil.pub.getBlockNumber();
    const after = await fingerprint(this.env);
    const err = r.body?.error;
    const got = `HTTP ${r.status} ${err?.code ?? "(no code)"}${err?.reason !== undefined ? ` reason ${err.reason}` : ""}`;
    this.expected = this.expected || `HTTP ${exp.status} ${exp.code}${exp.reason !== undefined ? ` (reason ${exp.reason})` : ""}, no state change`;
    this.actual = `${got}: "${err?.message ?? ""}"`;
    const codeOk = exp.code === "*" ? !!err?.code : err?.code === exp.code;
    if (r.status !== exp.status || !codeOk || (exp.reason !== undefined && err?.reason !== exp.reason)) {
      throw new Check(`expected HTTP ${exp.status} ${exp.code}${exp.reason !== undefined ? `/${exp.reason}` : ""}, got ${got}: ${fmt(err ?? r.body)}`);
    }
    if (exp.error && err?.error !== exp.error) throw new Check(`expected Solidity error ${exp.error}, got ${err?.error}`);
    plainEnglish(this, err?.message);
    if (r.body?.txHash) throw new Check(`a transaction was sent: ${r.body.txHash}`);
    if (fmt(before) !== fmt(after)) throw new Check(`state changed: ${diff(before, after)}`);
    if (b1 !== b0 && target) {
      for (let n = b0 + 1n; n <= b1; n++) {
        const blk = await this.env.anvil.pub.getBlock({ blockNumber: n, includeTransactions: true });
        for (const tx of blk.transactions) {
          if (typeof tx !== "string" && tx.to?.toLowerCase() === target.toLowerCase()) throw new Check(`a transaction to ${target} was mined in block ${n}`);
        }
      }
      this.note(`${b1 - b0} unrelated block(s) mined meanwhile (demo/background); none touched the target`);
    }
    return r;
  }
}

/** Fails if a user-facing message is empty, a raw selector, or the decoder's "unrecognised" fallback. */
export function plainEnglish(s: Scenario, msg: string | undefined) {
  s.expect(typeof msg === "string" && msg.length > 8, `message is empty: ${fmt(msg)}`);
  s.expect(!/unrecognised error|0x[0-9a-f]{8}/i.test(msg!), `message is not plain English: "${msg}"`);
}

function diff(a: unknown, b: unknown): string {
  const A = a as Record<string, unknown>;
  const B = b as Record<string, unknown>;
  const out: string[] = [];
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) if (fmt(A[k]) !== fmt(B[k])) out.push(`${k}: ${fmt(A[k])} -> ${fmt(B[k])}`);
  return out.join("; ").slice(0, 800);
}

// ───────────── reads ─────────────

export async function ausdBal(env: Env, who: Address): Promise<bigint> {
  return (await env.anvil.pub.readContract({ address: AUSD, abi: ABI.ausd, functionName: "balanceOf", args: [who] })) as bigint;
}

export async function potRead<T = unknown>(env: Env, pot: Address, fn: string, args: unknown[] = []): Promise<T> {
  return (await env.anvil.pub.readContract({ address: pot, abi: ABI.pot, functionName: fn, args })) as T;
}

export async function net(env: Env, pot: Address, who: Address): Promise<bigint> {
  return potRead<bigint>(env, pot, "netOf", [who]);
}

export async function potState(env: Env, pot: Address) {
  const members = await potRead<Address[]>(env, pot, "members");
  const nets = await Promise.all(members.map((m) => net(env, pot, m)));
  const [settled, spendCount, disputeCount, ruleChangeCount, ackEpoch, frozenUntil, rulesVersion, inviteSigner, active] = await Promise.all(
    ["settled", "spendCount", "disputeCount", "ruleChangeCount", "ackEpoch", "frozenUntil", "rulesVersion", "inviteSigner", "activeMemberCount"].map((f) => potRead(env, pot, f)),
  );
  return { balance: await ausdBal(env, pot), members: members.length, active, nets, settled, spendCount, disputeCount, ruleChangeCount, ackEpoch, frozenUntil, rulesVersion, inviteSigner };
}

export async function fingerprint(env: Env) {
  const out: Record<string, unknown> = {};
  for (const [pot, label] of env.pots) if (!env.demoPots.has(pot.toLowerCase())) out[`pot:${label}`] = await potState(env, pot);
  out.escrowClaims = await env.anvil.pub.readContract({ address: env.dep.claimEscrow, abi: ABI.escrow, functionName: "claimCount" });
  const bals: Record<string, string> = {};
  for (const [a, label] of env.tracked) if (!label.startsWith("demo:")) bals[label] = (await ausdBal(env, a as Address)).toString();
  out.balances = bals;
  return out;
}

// ───────────── invariants ─────────────

export interface InvariantReport {
  ok: boolean;
  lines: string[];
}

/**
 * I1 per pot: Σ netOf(all members ever) == AUSD.balanceOf(pot) (≤ if someone sent AUSD unsolicited).
 * Escrow: AUSD.balanceOf(escrow) == Σ amount of Open claims. PlansSend holds nothing.
 * Conservation: Σ AUSD over every tracked address == what the harness funded, and totalSupply is
 * unchanged since funding (no mint or burn).
 */
export async function invariants(env: Env, opts: { cleanSettled?: Address[] } = {}): Promise<InvariantReport> {
  const lines: string[] = [];
  let ok = true;
  const bad = (s: string) => {
    ok = false;
    lines.push(`FAIL ${s}`);
  };
  for (const [pot, label] of env.pots) {
    const st = await potState(env, pot);
    const sum = st.nets.reduce((a, b) => a + b, 0n);
    if (sum !== st.balance) bad(`I1 ${label}: Σnet ${sum} != balance ${st.balance}`);
    else lines.push(`I1 ${label}: Σnet = balance = ${st.balance}`);
    if (opts.cleanSettled?.some((p) => p.toLowerCase() === pot.toLowerCase())) {
      if (!st.settled) bad(`${label}: expected settled`);
      if (st.balance !== 0n) bad(`${label}: clean settle left ${st.balance} in the pot`);
      else lines.push(`${label}: clean settle, pot holds 0`);
    }
  }
  const count = (await env.anvil.pub.readContract({ address: env.dep.claimEscrow, abi: ABI.escrow, functionName: "claimCount" })) as bigint;
  let open = 0n;
  for (let id = 1n; id <= count; id++) {
    const c = (await env.anvil.pub.readContract({ address: env.dep.claimEscrow, abi: ABI.escrow, functionName: "claimInfo", args: [id] })) as readonly unknown[];
    if (Number(c[5]) === 1) open += c[2] as bigint;
  }
  const escrowBal = await ausdBal(env, env.dep.claimEscrow);
  if (escrowBal !== open) bad(`escrow balance ${escrowBal} != Σ open claims ${open} (${count} claims)`);
  else lines.push(`escrow balance = Σ open claims = ${open} (${count} claims)`);
  const sendBal = await ausdBal(env, env.dep.plansSend);
  if (sendBal !== 0n) bad(`PlansSend holds ${sendBal}`);
  let total = 0n;
  for (const a of env.tracked.keys()) total += await ausdBal(env, a as Address);
  if (total !== env.fundedTotal) bad(`AUSD not conserved across tracked addresses: ${total} != funded ${env.fundedTotal}`);
  else lines.push(`AUSD conserved across ${env.tracked.size} tracked addresses: ${total}`);
  const supply = BigInt(await env.anvil.rpc<Hex>("eth_getStorageAt", [AUSD, AUSD_TOTAL_SUPPLY_SLOT, "latest"]));
  if (supply !== env.supplyAfterFunding) bad(`AUSD totalSupply changed: ${supply} != ${env.supplyAfterFunding}`);
  return { ok, lines };
}

// ───────────── time ─────────────

export async function warp(env: Env, seconds: number) {
  await env.anvil.rpc("evm_increaseTime", [seconds]);
  await env.anvil.rpc("evm_mine", []);
}

export async function waitFor<T>(fn: () => Promise<T>, what: string, timeoutMs = 60_000, everyMs = 250): Promise<NonNullable<T>> {
  const t0 = Date.now();
  let last: unknown;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v as NonNullable<T>;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ""}`);
}

// ───────────── runner ─────────────

export class Runner {
  results: Result[] = [];
  #id = 0;
  group = "";
  constructor(readonly env: Env) {}

  async run(name: string, kind: Kind, expected: string, fn: (s: Scenario) => Promise<void>): Promise<boolean> {
    const s = new Scenario(this.env);
    s.expected = expected;
    const t0 = Date.now();
    let error: string | undefined;
    try {
      await fn(s);
    } catch (e) {
      error = e instanceof Check ? e.message : `${(e as Error).message ?? e}`;
      if (!(e instanceof Check)) error = `harness error: ${error}`;
    }
    const r: Result = {
      id: ++this.#id,
      group: this.group,
      name,
      kind,
      status: error ? "FAIL" : "PASS",
      expected: s.expected,
      actual: error ? s.actual || error : s.actual || (s.okCount ? `${s.okCount} tx ok; last: ${s.lastOk}` : "as expected"),
      txs: s.txs,
      latency: s.latency,
      error,
      notes: s.notes,
      ms: Date.now() - t0,
    };
    this.results.push(r);
    const mark = r.status === "PASS" ? "PASS" : "FAIL";
    console.log(`${mark} [${r.group}] ${name}${error ? `\n     -> ${error}` : ""}`);
    return !error;
  }

  /** Runs the invariant checks as their own scenario row. */
  async invariants(label: string, opts: { cleanSettled?: Address[] } = {}) {
    await this.run(`invariants after ${label}`, "invariant", "I1 per pot, escrow = open claims, AUSD conserved", async (s) => {
      const r = await invariants(this.env, opts);
      s.actual = r.lines.filter((l) => !l.startsWith("I1 ")).join("; ") || "ok";
      if (!r.ok) throw new Check(r.lines.filter((l) => l.startsWith("FAIL")).join("; "));
      s.actual = `${r.lines.length} checks ok`;
    });
  }
}
