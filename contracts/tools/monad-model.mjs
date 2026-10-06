// Monad gas model: re-prices an Ethereum (anvil) struct-log trace with Monad's MONAD_TEN rules.
//
// Sources (fetched 2026-10-06):
//   https://docs.monad.xyz/developer-essentials/opcode-pricing
//   https://mips.monad.xyz/MIPs/MIP-8 (page-ified storage), MIP-3 (linear memory)
//   category-labs/monad: category/vm/runtime/storage.cpp (MIP-8 SSTORE, no refund),
//   category/execution/ethereum/state3/page_tracker.hpp, category/execution/monad/monad_transaction_gas.cpp
//   (compute_gas_refund returns 0 since MONAD_ONE), category/execution/ethereum/transaction_gas.cpp (intrinsic gas).
//
// Formula (per transaction):
//   ethExec   = intrinsic + Σ_frames(ethereum gas consumed)            (pre-refund; from the trace)
//   monadExec = ethExec + Σ_steps (monadCost(step) − ethCost(step))   for the repriced items:
//               SLOAD / SSTORE (paged storage), cold account access (+7,500), precompiles,
//               memory expansion (3w + w²/512 → floor(w/2)).
//   Ethereum refunds (EIP-3529) are not subtracted: Monad has no refunds (and charges the gas limit).
//   monadMinLimit = intrinsic + need(top frame), where need() replays the EIP-150 63/64 rule and the
//               EIP-2200 SSTORE sentry (gasleft must be > 2,300) bottom-up with Monad prices. This is
//               the smallest gas limit with which the transaction succeeds — what eth_estimateGas looks for.

const ZERO = '0x0000000000000000000000000000000000000000';

export const MONAD = {
  coldAccount: 10100n,
  warmAccess: 100n,
  sloadColdPage: 8100n,
  sstoreBase: 100n,
  pageLoad: 8000n,
  pageWrite: 2800n,
  stateGrowth: 17000n,
};

export const PRECOMPILES = [
  ...Array.from({ length: 0x11 }, (_, i) => i + 1),
  0x100,
].map((n) => '0x' + n.toString(16).padStart(40, '0'));

const lc = (s) => s.toLowerCase();
const bmax = (a, b) => (a > b ? a : b);
const addrOf = (word) => '0x' + BigInt(word).toString(16).padStart(40, '0').slice(-40);
const words = (len) => (len + 31n) / 32n;
const ethMem = (w) => 3n * w + (w * w) / 512n;
const monadMem = (w) => w / 2n;

/** Smallest A with A − floor(A/64) ≥ n (EIP-150: all but one 64th is forwarded). */
export function aMin(n) {
  if (n <= 0n) return 0n;
  let a = (n * 64n) / 63n;
  while (a - a / 64n < n) a++;
  while (a > 0n && a - 1n - (a - 1n) / 64n >= n) a--;
  return a;
}

/** Highest memory word count an opcode needs (0n = none). `st` is bottom→top. */
function memWords(op, st) {
  const t = (k) => BigInt(st[st.length - 1 - k]);
  const reg = (off, len) => (len === 0n ? 0n : words(off + len));
  switch (op) {
    case 'MLOAD':
    case 'MSTORE':
      return reg(t(0), 32n);
    case 'MSTORE8':
      return reg(t(0), 1n);
    case 'KECCAK256':
    case 'SHA3':
    case 'RETURN':
    case 'REVERT':
    case 'LOG0':
    case 'LOG1':
    case 'LOG2':
    case 'LOG3':
    case 'LOG4':
      return reg(t(0), t(1));
    case 'CALLDATACOPY':
    case 'CODECOPY':
    case 'RETURNDATACOPY':
      return reg(t(0), t(2));
    case 'EXTCODECOPY':
      return reg(t(1), t(3));
    case 'MCOPY':
      return bmax(reg(t(0), t(2)), reg(t(1), t(2)));
    case 'CREATE':
    case 'CREATE2':
      return reg(t(1), t(2));
    case 'CALL':
    case 'CALLCODE':
      return bmax(reg(t(3), t(4)), reg(t(5), t(6)));
    case 'DELEGATECALL':
    case 'STATICCALL':
      return bmax(reg(t(2), t(3)), reg(t(4), t(5)));
    default:
      return 0n;
  }
}

/** Ethereum (Prague) vs Monad precompile execution cost. `known=false` → treated as equal. */
function precompileCost(addr, argsLen) {
  const n = parseInt(addr, 16);
  const w = words(argsLen);
  switch (n) {
    case 1:
      return { eth: 3000n, monad: 6000n, known: true };
    case 2:
      return { eth: 60n + 12n * w, monad: 60n + 12n * w, known: true };
    case 3:
      return { eth: 600n + 120n * w, monad: 600n + 120n * w, known: true };
    case 4:
      return { eth: 15n + 3n * w, monad: 15n + 3n * w, known: true };
    case 6:
      return { eth: 150n, monad: 300n, known: true };
    case 7:
      return { eth: 6000n, monad: 30000n, known: true };
    case 8: {
      const k = argsLen / 192n;
      return { eth: 45000n + 34000n * k, monad: 225000n + 170000n * k, known: true };
    }
    case 10:
      return { eth: 50000n, monad: 200000n, known: true };
    default:
      return { eth: 0n, monad: 0n, known: false }; // modexp, blake2f, BLS, P256: not used by Plans
  }
}

const ACCOUNT_OPS = new Set(['BALANCE', 'EXTCODESIZE', 'EXTCODEHASH', 'EXTCODECOPY']);
const CALL_OPS = new Set(['CALL', 'CALLCODE', 'DELEGATECALL', 'STATICCALL']);
const CREATE_OPS = new Set(['CREATE', 'CREATE2']);
const CLEAN_END = new Set(['STOP', 'RETURN', 'REVERT', 'SELFDESTRUCT']);

/**
 * Re-prices one transaction.
 * @param {object} p
 * @param {Array} p.logs           struct logs (anvil debug_traceTransaction, stack enabled)
 * @param {bigint} p.txGas         transaction gas limit
 * @param {string} p.from
 * @param {string|null} p.to       null for contract creation
 * @param {string|null} p.created  receipt.contractAddress
 * @param {boolean} p.status
 * @param {string} p.coinbase
 * @param {string} p.calldata      tx input (for the EIP-7623 floor)
 * @param {(addr:string, slot:bigint)=>Promise<bigint>} p.original  storage value at tx start
 * @param {Array} [p.debugFrames]  if given, receives one entry per closed frame (Monad gas used / needed)
 */
export async function reprice(p) {
  const logs = p.logs;
  const n = logs.length;
  const calldata = p.calldata.startsWith('0x') ? p.calldata.slice(2) : p.calldata;
  let zeros = 0n, nonzeros = 0n;
  for (let i = 0; i < calldata.length; i += 2) (calldata.slice(i, i + 2) === '00' ? zeros++ : nonzeros++);
  const floor7623 = 21000n + 10n * zeros + 40n * nonzeros;

  const acc = {
    coldAccounts: 0, coldAccountList: [], warmAccountAccesses: 0,
    sloads: 0, sstores: 0, pageLoads: 0, pageWrites: 0, stateGrowth: 0,
    ethSlotColdLoads: 0, freshSlotsEth: 0,
    precompileCalls: {}, ecrecover: 0,
    ethStorage: 0n, monadStorage: 0n, ethMem: 0n, monadMem: 0n,
    deltaStorage: 0n, deltaAccounts: 0n, deltaPrecompiles: 0n, deltaMemory: 0n,
    revertedFrames: 0, frames: 0,
  };
  const diag = { sloadMismatch: 0, sstoreMismatch: 0, accountMismatch: 0, memMismatch: 0, unknownPrecompile: 0, exceptionalHalts: 0, depthMismatch: 0 };

  if (n === 0) {
    return { empty: true, floor7623, acc, diag };
  }

  // ---- prepass: address produced by each CREATE/CREATE2 step
  const createResult = new Map();
  const pend = [];
  for (let i = 0; i < n; i++) {
    const s = logs[i];
    while (pend.length && pend[pend.length - 1].depth === s.depth && pend[pend.length - 1].i < i) {
      const q = pend.pop();
      createResult.set(q.i, lc(addrOf(s.stack[s.stack.length - 1])));
    }
    if (CREATE_OPS.has(s.op)) pend.push({ i, depth: s.depth });
  }

  // ---- journaled state (rolled back when a frame reverts, like EIP-2929 / MIP-8 page sets)
  const journal = [];
  const addJ = (set, k) => {
    if (!set.has(k)) {
      set.add(k);
      journal.push(() => set.delete(k));
    }
  };
  const setJ = (map, k, v) => {
    const had = map.has(k);
    const old = map.get(k);
    map.set(k, v);
    journal.push(() => (had ? map.set(k, old) : map.delete(k)));
  };
  let refund = 0n;
  const refundJ = (x) => {
    refund += x;
    journal.push(() => (refund -= x));
  };
  const rollback = (len) => {
    while (journal.length > len) journal.pop()();
  };

  const top = lc(p.to ?? p.created);
  const warmAcc = new Set([lc(p.from), top, lc(p.coinbase ?? ZERO), ...PRECOMPILES.map(lc)]);
  const warmSlots = new Set(); // Ethereum slot warmth
  const warmPages = new Set(); // Monad (account, page) warmth
  const dirtyPages = new Set(); // Monad pages already charged the 2,800 page write
  const growth = new Map(); // Monad per-page {cur, peak} slot-count growth
  const cur = new Map(); // current slot values
  const origCache = new Map();
  const original = async (a, key) => {
    const k = a + ':' + key;
    if (!origCache.has(k)) origCache.set(k, await p.original(a, key));
    return origCache.get(k);
  };

  const frames = [
    { ctx: top, startGas: BigInt(logs[0].gas), delta: 0n, need: 0n, mem: 0n, jl: 0, isCreate: p.to == null, call: null },
  ];
  let topResult = null;

  for (let i = 0; i < n; i++) {
    const s = logs[i];
    const op = s.op;
    const st = s.stack ?? [];
    const f = frames[frames.length - 1];
    if (s.depth !== frames.length) diag.depthMismatch++;
    const g = BigInt(s.gas);
    const gc = BigInt(s.gasCost);
    const usedBefore = f.startGas - g + f.delta; // Monad gas this frame consumed before this step
    let d = 0n; // Monad − Ethereum for this step (excluding child frames)
    let memM = 0n;

    // memory expansion
    const w = s.error ? 0n : memWords(op, st);
    if (w > f.mem) {
      const e = ethMem(w) - ethMem(f.mem);
      memM = monadMem(w) - monadMem(f.mem);
      d += memM - e;
      acc.deltaMemory += memM - e;
      acc.ethMem += e;
      acc.monadMem += memM;
      if ((op === 'MLOAD' || op === 'MSTORE' || op === 'MSTORE8') && gc !== 3n + e) diag.memMismatch++;
      f.mem = w;
    } else if ((op === 'MLOAD' || op === 'MSTORE' || op === 'MSTORE8') && gc !== 3n) diag.memMismatch++;

    let pushed = false;
    if (op === 'SLOAD') {
      acc.sloads++;
      const key = BigInt(st[st.length - 1]);
      const sk = f.ctx + ':' + key;
      const ethCold = !warmSlots.has(sk);
      if (ethCold) {
        addJ(warmSlots, sk);
        acc.ethSlotColdLoads++;
      }
      if ((ethCold ? 2100n : 100n) !== gc) diag.sloadMismatch++;
      const pk = f.ctx + ':' + (key >> 7n);
      let m = 100n;
      if (!warmPages.has(pk)) {
        addJ(warmPages, pk);
        acc.pageLoads++;
        m = MONAD.sloadColdPage;
      }
      d += m - gc;
      acc.deltaStorage += m - gc;
      acc.ethStorage += gc;
      acc.monadStorage += m;
    } else if (op === 'SSTORE') {
      acc.sstores++;
      if (usedBefore + 2301n > f.need) {
        f.need = usedBefore + 2301n;
        f.why = `SSTORE gas sentry at step ${i}`;
      }
      const key = BigInt(st[st.length - 1]);
      const val = BigInt(st[st.length - 2]);
      const sk = f.ctx + ':' + key;
      const orig = await original(f.ctx, key);
      const c = cur.has(sk) ? cur.get(sk) : orig;
      // Ethereum: EIP-2929 + EIP-2200 + EIP-3529
      let e = 0n;
      if (!warmSlots.has(sk)) {
        e += 2100n;
        addJ(warmSlots, sk);
      }
      if (val === c) e += 100n;
      else if (c === orig) {
        if (orig === 0n) {
          e += 20000n;
          acc.freshSlotsEth++;
        } else e += 2900n;
        if (orig !== 0n && val === 0n) refundJ(4800n);
      } else {
        e += 100n;
        if (orig !== 0n) {
          if (c === 0n) refundJ(-4800n);
          if (val === 0n) refundJ(4800n);
        }
        if (val === orig) refundJ(orig === 0n ? 19900n : 2800n);
      }
      if (e !== gc) diag.sstoreMismatch++;
      // Monad: MIP-8
      const pk = f.ctx + ':' + (key >> 7n);
      let m = MONAD.sstoreBase;
      if (!warmPages.has(pk)) {
        addJ(warmPages, pk);
        acc.pageLoads++;
        m += MONAD.pageLoad;
      }
      if (val !== c) {
        if (!dirtyPages.has(pk)) {
          addJ(dirtyPages, pk);
          acc.pageWrites++;
          m += MONAD.pageWrite;
        }
        const gr = growth.get(pk) ?? { cur: 0, peak: 0 };
        let nc = gr.cur;
        if (c === 0n && val !== 0n) nc++;
        else if (c !== 0n && val === 0n) nc--;
        let np = gr.peak;
        if (nc > np) {
          np = nc;
          m += MONAD.stateGrowth;
          acc.stateGrowth++;
        }
        setJ(growth, pk, { cur: nc, peak: np });
      }
      setJ(cur, sk, val);
      d += m - gc;
      acc.deltaStorage += m - gc;
      acc.ethStorage += gc;
      acc.monadStorage += m;
    } else if (ACCOUNT_OPS.has(op) || op === 'SELFDESTRUCT') {
      const a = lc(addrOf(st[st.length - 1]));
      const cold = !warmAcc.has(a);
      if (cold) {
        addJ(warmAcc, a);
        acc.coldAccounts++;
        acc.coldAccountList.push(a);
        d += MONAD.coldAccount - 2600n;
        acc.deltaAccounts += MONAD.coldAccount - 2600n;
      } else acc.warmAccountAccesses++;
      if (op !== 'EXTCODECOPY' && op !== 'SELFDESTRUCT' && (cold ? 2600n : 100n) !== gc) diag.accountMismatch++;
    } else if (CALL_OPS.has(op)) {
      const a = lc(addrOf(st[st.length - 2]));
      const cold = !warmAcc.has(a);
      if (cold) {
        addJ(warmAcc, a);
        acc.coldAccounts++;
        acc.coldAccountList.push(a);
        d += MONAD.coldAccount - 2600n;
        acc.deltaAccounts += MONAD.coldAccount - 2600n;
      } else acc.warmAccountAccesses++;
      let staticM = (cold ? MONAD.coldAccount : MONAD.warmAccess) + memM;
      if ((op === 'CALL' || op === 'CALLCODE') && BigInt(st[st.length - 3]) !== 0n) staticM += 9000n;
      const hasChild = i + 1 < n && logs[i + 1].depth === s.depth + 1;
      if (hasChild) {
        f.delta += d;
        const ctx = op === 'CALL' || op === 'STATICCALL' ? a : f.ctx;
        frames.push({ ctx, startGas: BigInt(logs[i + 1].gas), delta: 0n, need: 0n, mem: 0n, jl: journal.length, isCreate: false, call: { usedBefore, staticM } });
        acc.frames++;
        pushed = true;
      } else {
        let needChild = 0n;
        if (PRECOMPILES.includes(a)) {
          const argsLen = BigInt(op === 'CALL' || op === 'CALLCODE' ? st[st.length - 5] : st[st.length - 4]);
          const pc = precompileCost(a, argsLen);
          if (!pc.known) diag.unknownPrecompile++;
          d += pc.monad - pc.eth;
          acc.deltaPrecompiles += pc.monad - pc.eth;
          needChild = pc.monad;
          acc.precompileCalls[a] = (acc.precompileCalls[a] ?? 0) + 1;
          if (parseInt(a, 16) === 1) acc.ecrecover++;
        }
        if (usedBefore + staticM + aMin(needChild) > f.need) {
          f.need = usedBefore + staticM + aMin(needChild);
          f.why = `63/64 rule at ${op} ${a} (step ${i})`;
        }
      }
    } else if (CREATE_OPS.has(op)) {
      const created = createResult.get(i) ?? ZERO;
      if (created !== ZERO) addJ(warmAcc, created);
      const len = BigInt(st[st.length - 3]);
      const staticM = 32000n + 2n * words(len) + (op === 'CREATE2' ? 6n * words(len) : 0n) + memM;
      const hasChild = i + 1 < n && logs[i + 1].depth === s.depth + 1;
      if (hasChild) {
        f.delta += d;
        frames.push({ ctx: created, startGas: BigInt(logs[i + 1].gas), delta: 0n, need: 0n, mem: 0n, jl: journal.length, isCreate: true, call: { usedBefore, staticM } });
        acc.frames++;
        pushed = true;
      } else f.need = bmax(f.need, usedBefore + staticM);
    }

    if (!pushed) f.delta += d;

    // frame end?
    const nextDepth = i + 1 < n ? logs[i + 1].depth : 0;
    if (!pushed && nextDepth < s.depth) {
      const fr = frames.pop();
      const halted = !CLEAN_END.has(op) || !!s.error;
      if (halted) diag.exceptionalHalts++;
      const endLeft = halted ? 0n : g - gc;
      let ok;
      if (frames.length === 0) ok = p.status;
      else if (fr.isCreate) ok = lc(addrOf(logs[i + 1].stack[logs[i + 1].stack.length - 1])) !== ZERO;
      else ok = BigInt(logs[i + 1].stack[logs[i + 1].stack.length - 1]) === 1n;
      const deposit = fr.isCreate && op === 'RETURN' && ok ? 200n * BigInt(st[st.length - 2]) : 0n;
      const ethUsed = fr.startGas - endLeft + deposit;
      const monadUsed = ethUsed + fr.delta;
      const need = bmax(fr.need, monadUsed);
      if (!ok) {
        rollback(fr.jl);
        acc.revertedFrames++;
      }
      if (p.debugFrames) p.debugFrames.push({ depth: s.depth, ctx: fr.ctx, startGasEth: fr.startGas, ethUsed, monadUsed, need, ok });
      if (frames.length === 0) {
        topResult = { ethUsed, monadUsed, need, deposit, why: fr.need > monadUsed ? fr.why : 'gas used' };
      } else {
        const parent = frames[frames.length - 1];
        parent.delta += fr.delta;
        const cand = fr.call.usedBefore + fr.call.staticM + aMin(need);
        if (cand > parent.need) {
          parent.need = cand;
          parent.why = `63/64 rule into ${fr.ctx} → ${fr.need > monadUsed ? fr.why : 'its gas used'}`;
        }
      }
    }
  }
  if (!topResult) throw new Error('trace ended without closing the top frame');

  const intrinsic = p.txGas - BigInt(logs[0].gas);
  const ethPreRefund = intrinsic + topResult.ethUsed;
  const ethRefundApplied = refund < ethPreRefund / 5n ? refund : ethPreRefund / 5n;
  const ethGasUsedModel = bmax(floor7623, ethPreRefund - (refund > 0n ? ethRefundApplied : 0n));
  const monadExec = bmax(floor7623, intrinsic + topResult.monadUsed);
  const monadMinLimit = bmax(floor7623, intrinsic + topResult.need);
  return {
    intrinsic,
    floor7623,
    ethPreRefund,
    ethRefundCounter: refund,
    ethGasUsedModel,
    monadExec,
    monadMinLimit,
    codeDeposit: topResult.deposit,
    needWhy: topResult.why, // which constraint sets monadMinLimit
    acc,
    diag,
  };
}
