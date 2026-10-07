/**
 * FxReference (Chainlink CRE receiver) on the fork, and the FX fields it feeds: PlansSend's reference
 * rate and difference, and the round recorded at settlement.
 *
 * Rounds are delivered exactly as `cre workflow simulate --broadcast` delivers them on Monad: the
 * configured transmitter (this run's throwaway key) calls Chainlink's real MockKeystoneForwarder
 * (0x9eF6…784d on mainnet) `report(receiver, rawReport, "", [])`, and the mock calls
 * `FxReference.onReport(metadata, payload)`. The mock swallows a failing `onReport` and emits
 * `ReportProcessed(result = false)`, so every scenario checks the round count and decodes the inner
 * revert from anvil's call trace.
 *
 * Gas: the mock's outer call succeeds even when `onReport` runs out of gas, so anvil's
 * `eth_estimateGas` can land below what `onReport` needs. Deliveries therefore take the smallest gas
 * at which anvil's call trace shows `onReport` succeeding (a search over `debug_traceCall`, the same
 * idea as contracts/script/monad-gas.mjs and cre/fx-workflow/scripts/gas-limit.mjs) plus 10 %.
 */
import { decodeErrorResult, encodeAbiParameters, encodeFunctionData, getAddress, keccak256, stringToHex, toHex, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { CHAIN_SELECTOR, SIM_FORWARDER, sendLocal, setMon } from "../lib/env";
import { ausdBal, potRead, type Scenario } from "../lib/harness";
import { ABI, build, chainNow, codeToBytes, findEvent, invitee, potParams, randomHex32, rules, USD, type SendMeta } from "../lib/plans";
import type { T } from "./types";

export const FX_CCYS = ["GBP", "EUR", "INR", "NGN", "JPY", "CHF", "AED", "SGD"] as const;
/** USD per unit, 8 decimals (GBP 1.32765, INR 0.01037, ...). */
export const FX_RATES: bigint[] = [132_765_000n, 112_690_000n, 1_037_000n, 75_600n, 632_500n, 120_400_000n, 27_229_000n, 78_300_000n];
/** bit 0 Frankfurter/ECB, bit 1 currency-api, bit 2 Frankfurter central-bank blend (NGN, AED). */
export const FX_MASKS: number[] = [3, 3, 3, 6, 3, 3, 6, 3];
const ON_REPORT = keccak256(stringToHex("onReport(bytes,bytes)")).slice(0, 10);

export interface FxState {
  stale?: bigint; // a round scheduled 7 h before it was written: stale from the start
  fresh?: bigint; // the round sends and settlement reference
  rates?: bigint[];
}

export function fxPayload(o: { scheduledTime: bigint; rates?: bigint[]; masks?: number[]; selector?: bigint; date?: number }): Hex {
  return encodeAbiParameters(
    [{ type: "uint64" }, { type: "uint64" }, { type: "uint32" }, { type: "bytes3[]" }, { type: "uint64[]" }, { type: "uint8[]" }],
    [o.selector ?? CHAIN_SELECTOR, o.scheduledTime, o.date ?? 20261006, FX_CCYS.map((c) => codeToBytes(c, 3)), o.rates ?? FX_RATES, o.masks ?? FX_MASKS],
  );
}

/** What the CRE forwarder receives: version | executionId | timestamp | donId | donConfigVersion | workflowCid | workflowName | workflowOwner | reportId | payload. */
export function rawReport(payload: Hex): Hex {
  const name = stringToHex("plansfx", { size: 10 }).slice(2);
  return `0x01${randomHex32().slice(2)}00000064` + `00000001` + `00000001` + "11".repeat(32) + name + "aa".repeat(20) + "0001" + payload.slice(2) as Hex;
}

const reportData = (fx: Address, raw: Hex) => encodeFunctionData({ abi: ABI.forwarder, functionName: "report", args: [fx, raw, "0x", []] });

interface Frame {
  to?: string;
  input?: string;
  output?: string;
  error?: string;
  calls?: Frame[];
}
function findOnReport(f: Frame, fx: Address): Frame | undefined {
  if (f.to?.toLowerCase() === fx.toLowerCase() && f.input?.startsWith(ON_REPORT)) return f;
  for (const c of f.calls ?? []) {
    const r = findOnReport(c, fx);
    if (r) return r;
  }
  return undefined;
}

/** Traces the forwarder call on anvil and returns whether onReport succeeded and its decoded revert. */
export async function traceDelivery(t: T, from: Address, raw: Hex, gas?: bigint): Promise<{ delivered: boolean; error?: string; args?: readonly unknown[] }> {
  const env = t.env;
  const call: Record<string, string> = { from, to: SIM_FORWARDER, data: reportData(env.dep.fxReference, raw) };
  if (gas !== undefined) call.gas = toHex(gas);
  const tr = await env.anvil.rpc<Frame>("debug_traceCall", [call, "latest", { tracer: "callTracer" }]);
  const f = findOnReport(tr, env.dep.fxReference);
  if (!f) return { delivered: false, error: tr.error ?? "onReport not called" };
  if (!f.error) return { delivered: true };
  try {
    const d = decodeErrorResult({ abi: ABI.fxReference, data: (f.output ?? "0x") as Hex });
    return { delivered: false, error: d.errorName, args: d.args };
  } catch {
    return { delivered: false, error: f.error };
  }
}

/** Smallest gas at which onReport succeeds (anvil trace search), + 10 %. Undefined if it never does. */
async function deliveryGas(t: T, from: Address, raw: Hex): Promise<bigint | undefined> {
  const env = t.env;
  let lo = BigInt(await env.anvil.rpc<Hex>("eth_estimateGas", [{ from, to: SIM_FORWARDER, data: reportData(env.dep.fxReference, raw) }, "latest"]));
  if ((await traceDelivery(t, from, raw, lo)).delivered) return (lo * 11n + 9n) / 10n;
  let hi = lo * 2n;
  for (let i = 0; i < 6 && !(await traceDelivery(t, from, raw, hi)).delivered; i++) {
    lo = hi;
    hi *= 2n;
  }
  if (!(await traceDelivery(t, from, raw, hi)).delivered) return undefined;
  while (hi - lo > 500n) {
    const mid = (lo + hi) / 2n;
    if ((await traceDelivery(t, from, raw, mid)).delivered) hi = mid;
    else lo = mid;
  }
  return (hi * 11n + 9n) / 10n;
}

async function roundCount(t: T): Promise<bigint> {
  return (await t.env.anvil.pub.readContract({ address: t.env.dep.fxReference, abi: ABI.fxReference, functionName: "latestRoundId" })) as bigint;
}

/** Sends the report from `from` through the simulation forwarder; returns the tx and ReportProcessed's result. */
async function deliver(s: Scenario, t: T, from: PrivateKeyAccount, raw: Hex) {
  const gas = await deliveryGas(t, from.address, raw);
  const r = await sendLocal(t.env.anvil, from, { to: SIM_FORWARDER, data: reportData(t.env.dep.fxReference, raw), ...(gas ? { gas } : {}) });
  s.eq(r.status, "success", "forwarder tx");
  s.txs.push(r.hash);
  const receipt = await t.env.anvil.pub.getTransactionReceipt({ hash: r.hash });
  const processed = receipt.logs.find((l) => l.address.toLowerCase() === SIM_FORWARDER.toLowerCase());
  const result = processed ? BigInt(processed.data) === 1n : undefined;
  const written = receipt.logs.find((l) => l.address.toLowerCase() === t.env.dep.fxReference.toLowerCase());
  return { hash: r.hash, result, written: !!written, gas: r.gasLimit };
}

/** A report that must be refused: the trace names `error`, the delivery tx changes no round. */
async function refused(s: Scenario, t: T, from: PrivateKeyAccount, raw: Hex, error: string) {
  const n0 = await roundCount(t);
  const tr = await traceDelivery(t, from.address, raw);
  s.eq(tr.error, error, "onReport revert");
  const d = await deliver(s, t, from, raw);
  s.eq([d.result, d.written], [false, false], "ReportProcessed(false), no RoundWritten");
  s.eq(await roundCount(t), n0, "round count unchanged");
  s.actual = `onReport reverted ${tr.error}${tr.args?.length ? `(${tr.args.map(String).join(", ")})` : ""}; the mock forwarder recorded ReportProcessed(false); no round written`;
}

const blockTime = async (t: T) => (await t.env.anvil.pub.getBlock({ blockTag: "latest" })).timestamp;

/** toCurrency per 1 fromCurrency from USD-per-unit rates, floored at 8 decimals (as PlansSend). */
const crossE8 = (fromUsd: bigint, toUsd: bigint) => (fromUsd * 100_000_000n) / toUsd;
const diffBps = (applied: bigint, ref: bigint) => ((applied - ref) * 10_000n) / ref; // BigInt division truncates toward zero, like Solidity

export async function fxReferenceScenarios(t: T): Promise<FxState> {
  const { R, env, A } = t;
  const api = env.api;
  const ctx = env.ctx;
  const fx = env.dep.fxReference;
  const tx = t.fxKeys.transmitter;
  const st: FxState = {};
  await setMon(env.anvil, tx.address, 10n ** 20n);
  await setMon(env.anvil, A.griefer.address, 10n ** 19n);
  const read = <R = unknown>(fn: string, args: unknown[] = []) => env.anvil.pub.readContract({ address: fx, abi: ABI.fxReference, functionName: fn, args }) as Promise<R>;

  R.group = "fx: FxReference via the CRE simulation forwarder";
  await R.run("deployment: simulation mode on Chainlink's MockKeystoneForwarder", "flow", "forwarder = mock, simTransmitter = this run's key, chain selector = Monad mainnet, max move 10 %", async (s) => {
    s.eq([getAddress(await read<Address>("forwarder")), getAddress(await read<Address>("simTransmitter")), await read<bigint>("CHAIN_SELECTOR"), Number(await read("maxMoveBps")), getAddress(await read<Address>("owner"))],
      [getAddress(SIM_FORWARDER), tx.address, CHAIN_SELECTOR, 1000, t.fxKeys.owner.address], "config");
    s.eq(await env.anvil.pub.readContract({ address: env.dep.plansFactory, abi: ABI.factory, functionName: "fxReference" }), fx, "factory.fxReference");
  });
  await R.run("round 1, scheduled 7 h before delivery (stale from the start)", "flow", "ReportProcessed(true), RoundWritten id 1", async (s) => {
    const d = await deliver(s, t, tx, rawReport(fxPayload({ scheduledTime: (await blockTime(t)) - 7n * 3600n })));
    s.eq([d.result, d.written], [true, true], "delivered");
    st.stale = await roundCount(t);
    s.eq(st.stale, 1n, "round id");
    s.note(`delivery gas limit ${d.gas} (smallest gas at which onReport succeeds in anvil's trace, + 10 %)`);
  });
  await R.run("round 2, scheduled now, through the simulation forwarder", "flow", "RoundWritten id 2; rates and source masks read back", async (s) => {
    const rates = FX_RATES.map((r) => r + r / 400n); // +0.25 %
    const d = await deliver(s, t, tx, rawReport(fxPayload({ scheduledTime: await blockTime(t), rates })));
    s.eq([d.result, d.written], [true, true], "delivered");
    st.fresh = await roundCount(t);
    st.rates = rates;
    s.eq(st.fresh, 2n, "round id");
    const round = await read<{ roundId: bigint; usdPerUnitE8: readonly bigint[]; sourceMasks: readonly number[]; sourceMask: number }>("latestRound");
    s.eq([round.roundId, round.usdPerUnitE8, round.sourceMasks, round.sourceMask], [2n, rates, FX_MASKS, 7], "latestRound");
    s.eq(await read("rateOf", [2n, codeToBytes("USD", 3)]), 100_000_000n, "USD = 1e8 (AUSD)");
  });
  await R.run("report from a stranger through the permissionless simulation forwarder", "failure", "onReport reverts InvalidTransmitter; ReportProcessed(false); no round", async (s) => {
    await refused(s, t, A.griefer, rawReport(fxPayload({ scheduledTime: await blockTime(t) })), "InvalidTransmitter");
  });
  await R.run("onReport called by the forwarder address itself (anvil-impersonated), wrong tx.origin", "failure", "reverts InvalidTransmitter", async (s) => {
    await env.anvil.rpc("anvil_impersonateAccount", [SIM_FORWARDER]);
    try {
      const data = encodeFunctionData({ abi: ABI.fxReference, functionName: "onReport", args: ["0x", fxPayload({ scheduledTime: await blockTime(t) })] });
      const e = await env.anvil.rpc("eth_call", [{ from: SIM_FORWARDER, to: fx, data }, "latest"]).then(() => undefined, (x: Error & { data?: unknown }) => x);
      s.expect(e, "call should revert");
      const d = decodeErrorResult({ abi: ABI.fxReference, data: (e as { data: Hex }).data });
      s.eq(d.errorName, "InvalidTransmitter", "error");
      s.actual = `reverts ${d.errorName}(${String(d.args?.[0])})`;
    } finally {
      await env.anvil.rpc("anvil_stopImpersonatingAccount", [SIM_FORWARDER]);
    }
  });
  await R.run("onReport from an address that is not the forwarder (the transmitter itself)", "failure", "reverts InvalidSender", async (s) => {
    const data = encodeFunctionData({ abi: ABI.fxReference, functionName: "onReport", args: ["0x", fxPayload({ scheduledTime: await blockTime(t) })] });
    const e = await env.anvil.rpc("eth_call", [{ from: tx.address, to: fx, data }, "latest"]).then(() => undefined, (x: Error & { data?: unknown }) => x);
    const d = decodeErrorResult({ abi: ABI.fxReference, data: (e as { data: Hex }).data });
    s.eq(d.errorName, "InvalidSender", "error");
    s.actual = `reverts ${d.errorName}`;
  });
  await R.run("replay: round 2's scheduled time again", "failure", "onReport reverts StaleReport; no round", async (s) => {
    const t2 = await read<bigint>("lastScheduledTime");
    await refused(s, t, tx, rawReport(fxPayload({ scheduledTime: t2, rates: st.rates })), "StaleReport");
  });
  await R.run("an older scheduled time", "failure", "onReport reverts StaleReport; no round", async (s) => {
    await refused(s, t, tx, rawReport(fxPayload({ scheduledTime: (await read<bigint>("lastScheduledTime")) - 60n, rates: st.rates })), "StaleReport");
  });
  await R.run("a rate moving more than 10 % from the last round (GBP +11 %)", "failure", "onReport reverts RateMoveTooLarge; no round", async (s) => {
    const rates = [...st.rates!];
    rates[0] = (rates[0] * 111n) / 100n;
    await refused(s, t, tx, rawReport(fxPayload({ scheduledTime: (await blockTime(t)) + 1n, rates })), "RateMoveTooLarge");
  });
  await R.run("a rate from a single source (INR)", "failure", "onReport reverts MissingSources; no round", async (s) => {
    const masks = [...FX_MASKS];
    masks[2] = 1;
    await refused(s, t, tx, rawReport(fxPayload({ scheduledTime: (await blockTime(t)) + 1n, rates: st.rates, masks })), "MissingSources");
  });
  await R.run("a report signed for another chain (Monad testnet selector)", "failure", "onReport reverts WrongChain; no round", async (s) => {
    await refused(s, t, tx, rawReport(fxPayload({ scheduledTime: (await blockTime(t)) + 1n, rates: st.rates, selector: 2183018362218727504n })), "WrongChain");
  });
  await R.run("owner powers: strangers cannot reconfigure; production mode refuses the mock forwarder", "failure", "Unauthorized for a stranger; InvalidConfig for setProductionMode(mock)", async (s) => {
    const callErr = async (from: Address, fn: string, args: unknown[]) => {
      const data = encodeFunctionData({ abi: ABI.fxReference, functionName: fn, args });
      const e = await env.anvil.rpc("eth_call", [{ from, to: fx, data }, "latest"]).then(() => undefined, (x: Error & { data?: unknown }) => x);
      return e ? decodeErrorResult({ abi: ABI.fxReference, data: (e as { data: Hex }).data }).errorName : "no revert";
    };
    const got = [
      await callErr(A.griefer.address, "setSimulationMode", [A.griefer.address]),
      await callErr(A.griefer.address, "setMaxMoveBps", [10_000]),
      await callErr(A.griefer.address, "setProductionMode", [A.griefer.address, randomHex32(), A.griefer.address]),
      await callErr(t.fxKeys.owner.address, "setProductionMode", [SIM_FORWARDER, randomHex32(), t.fxKeys.owner.address]),
    ];
    s.eq(got, ["Unauthorized", "Unauthorized", "Unauthorized", "InvalidConfig"], "reverts");
    s.actual = got.join(", ");
  });
  await R.run("GET /v1/fx/round", "http", "200 with the latest onchain round", async (s) => {
    const r = await api.get("/v1/fx/round");
    s.eq(r.status, 200, "status");
    s.eq(String(r.body.roundId), "2", "roundId");
    s.actual = `200 round ${r.body.roundId}, fresh ${r.body.fresh}`;
  });

  // ───── PlansSend with a reference round ─────
  R.group = "fx: PlansSend reference round";
  const metaFor = async (round: bigint, over: Partial<SendMeta> = {}): Promise<SendMeta> => ({
    to: A.frank.address,
    fromCountry: codeToBytes("GB", 2),
    toCountry: codeToBytes("IN", 2),
    fromCurrency: codeToBytes("GBP", 3),
    toCurrency: codeToBytes("INR", 3),
    fxRateE8: 12_750_000_000n,
    fxTimestamp: await chainNow(ctx),
    fxRoundId: round,
    memoHash: `0x${"00".repeat(32)}` as Hex,
    salt: randomHex32(),
    ...over,
  });
  await R.run("send naming the fresh round", "flow", "Sent with fxRoundId 2, the round's GBP->INR reference rate and the applied rate's difference in bps; amount unchanged", async (s) => {
    const meta = await metaFor(st.fresh!);
    const f0 = await ausdBal(env, A.frank.address);
    const r = s.ok(await api.relay("send", await build.send(ctx, A.gina, USD(3), meta)), "Sent");
    const ev = findEvent(r, "Sent")!.args;
    const ref = crossE8(st.rates![0], st.rates![2]);
    s.eq([ev.amount, ev.fxRateE8, ev.fxRoundId, ev.refRateE8, ev.fxDiffBps], [USD(3).toString(), meta.fxRateE8.toString(), "2", ref.toString(), diffBps(meta.fxRateE8, ref).toString()], "Sent FX fields");
    s.eq((await ausdBal(env, A.frank.address)) - f0, USD(3), "recipient delta = amount");
    s.actual = `Sent: applied ${meta.fxRateE8}, reference ${ref}, difference ${diffBps(meta.fxRateE8, ref)} bps`;
  });
  await R.run("send naming the stale round", "failure", "422 FX_ROUND_STALE", async (s) => {
    await s.rejects(async () => api.relay("send", await build.send(ctx, A.gina, USD(1), await metaFor(st.stale!))), { status: 422, code: "FX_ROUND_STALE" }, env.dep.plansSend);
  });
  await R.run("send naming a round that does not exist", "failure", "422 FX_ROUND_UNKNOWN", async (s) => {
    await s.rejects(async () => api.relay("send", await build.send(ctx, A.gina, USD(1), await metaFor(99n))), { status: 422, code: "FX_ROUND_UNKNOWN" }, env.dep.plansSend);
  });
  await R.run("send with a currency the round does not carry (KES)", "failure", "422 FX_PAIR_UNAVAILABLE", async (s) => {
    await s.rejects(async () => api.relay("send", await build.send(ctx, A.gina, USD(1), await metaFor(st.fresh!, { toCurrency: codeToBytes("KES", 3) }))), { status: 422, code: "FX_PAIR_UNAVAILABLE" }, env.dep.plansSend);
  });
  await R.run("relayer swaps the round id after signing", "failure", "422 NONCE_MISMATCH", async (s) => {
    const signed = await metaFor(st.fresh!);
    await s.rejects(async () => api.relay("send", await build.send(ctx, A.gina, USD(1), { ...signed, fxRoundId: st.stale! }, { signedMeta: signed })), { status: 422, code: "NONCE_MISMATCH" }, env.dep.plansSend);
  });

  // ───── settlement records the fresh round ─────
  R.group = "fx: settlement round";
  await R.run("settle with a fresh round", "flow", "Settled.fxRoundId = 2", async (s) => {
    const pot = await smallSettledPot(s, t, "FX1");
    s.eq(pot.fxRoundId, "2", "Settled.fxRoundId");
  });
  await R.invariants("fx");
  return st;
}

/** After the time phase: the rounds are more than 6 h old. */
export async function fxAfterTime(t: T, st: FxState) {
  const { R, env, A } = t;
  const ctx = env.ctx;
  R.group = "fx: after the rounds went stale";
  await R.run("settle with no fresh round", "flow", "Settled.fxRoundId = 0 (settlement never fails because of FX)", async (s) => {
    const pot = await smallSettledPot(s, t, "FX2");
    s.eq(pot.fxRoundId, "0", "Settled.fxRoundId");
  });
  await R.run("send naming round 2 after it went stale", "failure", "422 FX_ROUND_STALE", async (s) => {
    const meta: SendMeta = { to: A.frank.address, fromCountry: codeToBytes("GB", 2), toCountry: codeToBytes("IN", 2), fromCurrency: codeToBytes("GBP", 3), toCurrency: codeToBytes("INR", 3), fxRateE8: 12_750_000_000n, fxTimestamp: await chainNow(ctx), fxRoundId: st.fresh!, memoHash: `0x${"00".repeat(32)}` as Hex, salt: randomHex32() };
    await s.rejects(async () => env.api.relay("send", await build.send(ctx, A.gina, USD(1), meta)), { status: 422, code: "FX_ROUND_STALE" }, env.dep.plansSend);
  });
  await R.run("a new round after the gap; a send names it", "flow", "RoundWritten id 3; Sent with fxRoundId 3", async (s) => {
    const rates = st.rates!.map((r) => r - r / 200n); // -0.5 %
    const d = await deliver(s, t, t.fxKeys.transmitter, rawReport(fxPayload({ scheduledTime: await blockTime(t), rates })));
    s.eq([d.result, d.written], [true, true], "delivered");
    const meta: SendMeta = { to: A.frank.address, fromCountry: codeToBytes("GB", 2), toCountry: codeToBytes("IN", 2), fromCurrency: codeToBytes("GBP", 3), toCurrency: codeToBytes("INR", 3), fxRateE8: crossE8(rates[0], rates[2]), fxTimestamp: await chainNow(ctx), fxRoundId: 3n, memoHash: `0x${"00".repeat(32)}` as Hex, salt: randomHex32() };
    const r = s.ok(await env.api.relay("send", await build.send(ctx, A.gina, USD(1), meta)), "Sent");
    const ev = findEvent(r, "Sent")!.args;
    s.eq([ev.fxRoundId, ev.refRateE8, ev.fxDiffBps], ["3", crossE8(rates[0], rates[2]).toString(), "0"], "Sent FX fields");
  });
  await R.invariants("fx after the gap");
}

/** A two-member pot that settles at once by acks; returns Settled's fxRoundId. */
async function smallSettledPot(s: Scenario, t: T, label: string): Promise<{ pot: Address; fxRoundId: string }> {
  const { env, A } = t;
  const ctx = env.ctx;
  const invite = invitee();
  const b = await build.createPot(ctx, A.alice, await potParams(ctx, invite.address, { rules: rules() }), { deposit: USD(2) });
  s.ok(await env.api.relay("createPot", b.params), "PotCreated");
  env.pots.set(b.pot, label);
  env.tracked.set(b.pot.toLowerCase(), `pot ${label}`);
  s.ok(await env.api.relay("join", await build.join(ctx, b.pot, A.bob, invite, { deposit: USD(1) })), "MemberJoined");
  s.ok(await env.api.relay("ack", await build.ack(ctx, b.pot, A.alice)), "Acked");
  s.ok(await env.api.relay("ack", await build.ack(ctx, b.pot, A.bob)), "Acked");
  const r = s.ok(await env.api.relay("settle", { pot: b.pot }), "Settled");
  s.eq(await potRead(env, b.pot, "settled"), true, "settled");
  return { pot: b.pot, fxRoundId: String(findEvent(r, "Settled")!.args.fxRoundId) };
}
