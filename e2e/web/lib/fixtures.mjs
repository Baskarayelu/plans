// Fixture layer for the Plans web app: realistic plan data while the Envio indexer isn't live.
//
//   import { installFixtures } from "./lib/fixtures.mjs";
//   const fx = await installFixtures(page, { balance: 5_000_000n });   // BEFORE page.goto
//   ... create an account (lib/session.mjs) ...
//   fx.ids.lisbon  → "/app/plan/" + fx.ids.lisbon
//
// What it answers (everything else goes to the network unchanged):
//   - POST <any>/graphql with a GraphQL `query` (the build default https://indexer.plans.0xo.in/v1/graphql
//     or whatever the relayer publishes): every query in app/src/lib/api/envio.ts, by operation name.
//   - GET <relayer>/v1/config → {"chainId":10143,"graphqlUrl":"https://indexer.plans.0xo.in/v1/graphql"}
//   - GET <relayer>/v1/fx?from=&to=, /v1/fx/round → one consistent FX round (opts.fx = false passes them through)
//   - GET <relayer>/v1/demo/accounts → { enabled: true, accounts: [], pots: [] } (opts.demo overrides; null passes through)
//   - JSON-RPC eth_call on the Monad RPC: AUSD balanceOf(me) when opts.balance is set; reads on the fixture
//     pots (canSettle, isMember, netOf, previewSpend, activeMemberCount, settled); KeyRegistry.keyOf(fixture person).
//   - CORS preflights (OPTIONS) for all of the above.
//
// The signed-in person ("me") is whoever the page created: learnt from the `account` variable of the
// MyPlans/AccountActivity queries (or the stored account in localStorage). Plan names use the plaintext
// meta form (0x00 || JSON) so they read without group keys. Member names come from real encrypted
// profile wraps (0x50 || groupBox(profile)) under a per-plan group key, wrapped (sealed box) to the
// page's own X25519 key — read from localStorage "plans.kv.plans.account.v1".x25519Public — so names
// show exactly as they would for a real member, without the "Demo" tag that demo accounts get.
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ORIGIN, route } from "./browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "../../../app");
const req = createRequire(resolve(APP_ROOT, "package.json"));
const { xchacha20poly1305 } = req("@noble/ciphers/chacha.js");
const { x25519 } = req("@noble/curves/ed25519.js");
const { hkdf } = req("@noble/hashes/hkdf.js");
const { sha256 } = req("@noble/hashes/sha2.js");
const viem = req("viem");
const { privateKeyToAccount } = req("viem/accounts");

export const CHAIN_ID = 10143;
export const GRAPHQL_URL = "https://indexer.plans.0xo.in/v1/graphql";
export const RPC_HOSTS = ["testnet-rpc.monad.xyz"];

// ─────────────── bytes / crypto (mirror of app/src/lib/crypto/seal.ts) ───────────────

const enc = new TextEncoder();
const utf8 = (s) => enc.encode(s);
const toHex = (b) => "0x" + Buffer.from(b).toString("hex");
const fromHex = (h) => new Uint8Array(Buffer.from(h.replace(/^0x/, ""), "hex"));
const concat = (...a) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of a) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};
const rand = (n) => new Uint8Array(randomBytes(n));
const seed = (label) => sha256(utf8(`plans-fixture/${label}`));

function seal(recipientPub, plaintext, context) {
  const eph = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(eph);
  const shared = x25519.getSharedSecret(eph, recipientPub);
  const key = hkdf(sha256, shared, concat(ephPub, recipientPub), utf8("plans/v1/seal"), 32);
  const n = rand(24);
  const ct = xchacha20poly1305(key, n, utf8(`plans/v1/seal|${context}`)).encrypt(plaintext);
  return concat(new Uint8Array([0x01]), ephPub, n, ct);
}
const groupEncrypt = (gk, kind, pot, pt) => {
  const n = rand(24);
  return concat(new Uint8Array([0x01]), n, xchacha20poly1305(gk, n, utf8(`plans/v1/${kind}|${pot.toLowerCase()}`)).encrypt(pt));
};
const wrapGroupKey = (pub, gk, pot) => toHex(seal(pub, gk, `groupkey|${pot.toLowerCase()}`));
const profileWrap = (gk, pot, p) =>
  toHex(concat(new Uint8Array([0x50]), groupEncrypt(gk, "profile", pot, utf8(JSON.stringify({ v: 1, n: p.name, c: p.city, cc: p.country, cur: p.currency })))));
/** Plaintext plan meta: 0x00 || JSON (decodeMeta reads it without a group key). */
const plainMeta = (m) => toHex(concat(new Uint8Array([0x00]), utf8(JSON.stringify({ v: 1, name: m.name, emoji: m.emoji, color: m.color }))));
/** Plaintext memo: 0x00 || UTF-8 (decodeMemo reads it without a group key). */
const plainMemo = (t) => (t ? toHex(concat(new Uint8Array([0x00]), utf8(t))) : "0x");

// ─────────────── the fixture people and pots (fixed, so other agents can rely on them) ───────────────

function person(key, name, city, country, currency) {
  const sk = seed(`person/${key}`);
  const address = privateKeyToAccount(toHex(sk)).address.toLowerCase();
  const xSecret = seed(`x25519/${key}`);
  return { key, name, city, country, currency, address, xPub: x25519.getPublicKey(xSecret) };
}

export const PEOPLE = {
  sam: person("sam", "Sam", "New York", "US", "USD"),
  asha: person("asha", "Asha", "Bengaluru", "IN", "INR"),
  ben: person("ben", "Ben", "Manchester", "GB", "GBP"),
  leo: person("leo", "Leo", "Bristol", "GB", "GBP"),
};

const pad = (head, tail) => "0x" + head + "0".repeat(40 - head.length - tail.length) + tail;
/** Pot addresses: the first 6 hex digits (used in testIDs like plan-card-1150b0) differ per pot. */
export const POTS = {
  lisbon: pad("1150b0", "a1"),
  /** The same Lisbon plan after it ended, everyone checked the numbers: canSettle() = true. Not in MyPlans. */
  lisbonEnded: pad("1150e0", "a2"),
  glasto: pad("61a570", "b1"),
};
const BUSINESS = { villa: pad("b17a00", "01"), taberna: pad("7abe00", "02"), tram: pad("7a3000", "03"), mercado: pad("3e4c00", "04"), bar: pad("ba4000", "05"), pastel: pad("9a5700", "06"), boat: pad("b0a700", "07"), camp: pad("ca3900", "08"), coach: pad("c0ac00", "09"), cider: pad("c1de00", "0a") };

const USD = (d) => String(Math.round(d * 1_000_000));
const ZERO_HASH = "0x" + "0".repeat(64);
const txh = (label) => toHex(seed(`tx/${label}`));

/** USD per 1 unit, 8 decimals (FxReference convention). 1 GBP = 1.3472 USD, 1 USD = 83.6 INR, 1 EUR = 1.087 USD. */
export const USD_PER_E8 = {
  USD: 100_000_000n,
  GBP: 134_720_000n,
  EUR: 108_700_000n,
  INR: 1_196_172n,
  NGN: 64_516n,
  JPY: 673_400n,
  CHF: 113_000_000n,
  AED: 27_229_000n,
  SGD: 77_520_000n,
};
const fxRateE8 = (from, to) => {
  const f = USD_PER_E8[from] ?? null;
  const t = USD_PER_E8[to] ?? null;
  if (!f || !t) return null;
  return (f * 100_000_000n) / t;
};

const RULES_BALANCED = {
  instantMax: USD(25),
  oneApprovalMax: USD(200),
  highTier: "MAJORITY",
  memberDailyCap: USD(150),
  memberTotalCap: "0",
  payeePolicy: "ANYONE",
  minContribution: "0",
  proposalTtl: "86400",
  ruleTimelock: "3600",
};
function approvalsRequired(amountUnits, active) {
  const a = BigInt(amountUnits);
  let n;
  if (a <= BigInt(RULES_BALANCED.instantMax)) n = 1;
  else if (a <= BigInt(RULES_BALANCED.oneApprovalMax)) n = 2;
  else n = Math.floor(active / 2) + 1;
  return Math.max(1, Math.min(n, Math.max(active, 1)));
}

// ─────────────── world builder ───────────────

/**
 * Builds the fixture world around `me` (lowercase address) and my X25519 public key (Uint8Array or
 * null when the keys aren't available: then plans read as "Locked" except their names).
 */
export function buildWorld({ me, myPub, now = Math.floor(Date.now() / 1000), empty = false, myCountry = "GB", lisbonEnded = false }) {
  const { sam, asha, ben, leo } = PEOPLE;
  const H = 3600;
  const D = 86400;
  let block = 4_800_000;
  const ev = (label) => {
    block += 7;
    return { id: `${CHAIN_ID}_${block}_${Math.abs(hash32(label)) % 50}`, txHash: txh(label), block };
  };

  // ── Lisbon ──
  // Day 2 of 5: started at local midnight yesterday, ends just before midnight on day 5. The name
  // carries the real dates ("Lisbon, 6–10 Oct") so it agrees with the date line under it.
  const startDay = new Date(now * 1000);
  startDay.setHours(0, 0, 0, 0);
  startDay.setDate(startDay.getDate() - 1);
  const lisbonName = (startSec) => {
    const s0 = new Date(startSec * 1000);
    const s4 = new Date(s0);
    s4.setDate(s4.getDate() + 4);
    const mon = (d) => d.toLocaleString("en-GB", { month: "short" });
    return `Lisbon, ${mon(s0) === mon(s4) ? `${s0.getDate()}–${s4.getDate()} ${mon(s4)}` : `${s0.getDate()} ${mon(s0)}–${s4.getDate()} ${mon(s4)}`}`;
  };
  const L = {
    pot: POTS.lisbon,
    meta: { emoji: "🌊", color: "#2FA6B8" },
    start: Math.floor(startDay.getTime() / 1000),
    members: [
      { a: me, country: myCountry, idx: 0 },
      { a: sam.address, country: "US", idx: 1 },
      { a: asha.address, country: "IN", idx: 2 },
      { a: ben.address, country: "GB", idx: 3 },
    ],
  };
  L.end = L.start + 5 * D - 60;
  L.created = L.start - 2 * D;
  const lisbonContribs = [
    { a: me, amount: USD(180), at: L.created },
    { a: sam.address, amount: USD(200), at: L.created + 3 * H },
    { a: asha.address, amount: USD(200), at: L.created + 5 * H },
    { a: ben.address, amount: USD(200), at: L.created + D + 2 * H },
    { a: me, amount: USD(20), at: now - 4 * H },
  ];
  const joins = { [me]: L.created, [sam.address]: L.created + 3 * H, [asha.address]: L.created + 5 * H, [ben.address]: L.created + D + 2 * H };
  const all4 = [me, sam.address, asha.address, ben.address];
  // id, proposer, payee, amount, category, memo, split, executedAt | null, approvers (besides proposer)
  const lisbonSpends = [
    { n: 1, by: ben.address, payee: BUSINESS.villa, amount: USD(240), cat: 0, memo: "Villa deposit", split: all4, at: L.start + 12 * H, ok: [sam.address, asha.address] },
    { n: 2, by: asha.address, payee: BUSINESS.pastel, amount: USD(12), cat: 3, memo: "Pastéis de nata", split: all4, at: L.start + 10 * H, ok: [] },
    { n: 3, by: ben.address, payee: BUSINESS.mercado, amount: USD(24), cat: 3, memo: "Mercado da Ribeira", split: all4, at: L.start + 14 * H, ok: [] },
    { n: 4, by: sam.address, payee: BUSINESS.bar, amount: USD(24), cat: 3, memo: "Drinks in Bairro Alto", split: all4, at: L.start + 21 * H, ok: [] },
    { n: 5, by: me, payee: BUSINESS.tram, amount: USD(18), cat: 2, memo: "Tram passes", split: [me, sam.address, ben.address], at: now - H, ok: [] },
    { n: 6, by: sam.address, payee: BUSINESS.taberna, amount: USD(36), cat: 3, memo: "Dinner at Taberna", split: [me, sam.address, asha.address], at: now - 120, ok: [asha.address] },
  ];
  const boat = { n: 7, by: asha.address, payee: BUSINESS.boat, amount: USD(250), cat: 4, memo: "Boat trip", split: all4, proposedAt: now - 2 * H, ok: [ben.address] };

  // ── Glastonbury ──
  const y = new Date(now * 1000).getUTCFullYear();
  const jun28 = Date.UTC(y, 5, 28, 12) / 1000 < now ? y : y - 1;
  const G = {
    pot: POTS.glasto,
    meta: { name: "Glastonbury crew", emoji: "🎪", color: "#D9539B" },
    start: Date.UTC(jun28, 5, 24, 10) / 1000,
    end: Date.UTC(jun28, 5, 28, 12) / 1000,
    settledAt: Date.UTC(jun28, 5, 28, 17, 4) / 1000,
    members: [
      { a: ben.address, country: "GB", idx: 0 },
      { a: me, country: myCountry, idx: 1 },
      { a: sam.address, country: "US", idx: 2 },
      { a: asha.address, country: "IN", idx: 3 },
      { a: leo.address, country: "GB", idx: 4 },
    ],
  };
  G.created = G.start - 9 * D;
  const all5 = G.members.map((m) => m.a);
  const glastoSpends = [
    { n: 1, by: leo.address, payee: BUSINESS.camp, amount: USD(300), cat: 0, memo: "Camping pitch", split: all5, at: G.start + 2 * H, ok: [ben.address, sam.address] },
    { n: 2, by: sam.address, payee: BUSINESS.coach, amount: USD(160), cat: 1, memo: "Coach to Pilton", split: all5, at: G.start + 5 * H, ok: [ben.address] },
    { n: 3, by: ben.address, payee: BUSINESS.cider, amount: USD(184.55), cat: 3, memo: "Food & cider", split: all5, at: G.start + 2 * D, ok: [asha.address] },
  ];

  const pots = {};
  if (!empty) {
    pots[POTS.lisbon] = lisbonPot(lisbonEnded, POTS.lisbon);
    pots[POTS.lisbonEnded] = lisbonPot(true, POTS.lisbonEnded);
    pots[POTS.glasto] = glastoPot();
  }

  function spendRow(pot, s, opts = {}) {
    const e = ev(`${pot}/spend/${s.n}`);
    const active = opts.active ?? 4;
    const req = approvalsRequired(s.amount, active);
    const pending = opts.status === "Pending";
    const votes = [
      ...(req > 1 ? [{ account_id: s.by, approve: true, timestamp: s.proposedAt ?? s.at - 600 }] : []),
      ...s.ok.slice(0, req - 1).map((a, i) => ({ account_id: a, approve: true, timestamp: (s.proposedAt ?? s.at - 600) + 300 * (i + 1) })),
    ];
    return {
      id: `${pot}-${s.n}`,
      spendId: String(s.n),
      kind: "PAY",
      status: opts.status ?? "Executed",
      proposer_id: s.by,
      payee: s.payee,
      amount: s.amount,
      category: s.cat,
      memo: plainMemo(s.memo),
      receiptHash: ZERO_HASH,
      approvals: pending ? 1 + s.ok.length : req,
      approvalsRequired: req,
      rejections: 0,
      expiresAt: String((s.proposedAt ?? s.at - 600) + 86400),
      proposedAt: s.proposedAt ?? (req > 1 ? s.at - 600 : s.at),
      executedAt: pending ? null : s.at,
      cancelReason: opts.status === "Cancelled" ? 2 : null,
      claimId: null,
      splitMembers: s.split,
      splitWeights: s.split.map(() => "1"),
      hasOpenDispute: false,
      txHash: e.txHash,
      votes: pending ? [{ account_id: s.by, approve: true, timestamp: s.proposedAt }, ...s.ok.map((a, i) => ({ account_id: a, approve: true, timestamp: s.proposedAt + 1800 * (i + 1) }))] : votes,
      // extra (not in the query; stripped by `pick` where needed)
      _shares: splitShares(s.amount, s.split),
    };
  }

  function splitShares(amount, split) {
    const a = BigInt(amount);
    const n = BigInt(split.length);
    const each = a / n;
    let rest = a - each * n;
    return split.map((m) => {
      let v = each;
      if (rest > 0n) {
        v += 1n;
        rest -= 1n;
      }
      return { account_id: m, amount: v };
    });
  }

  function keyWrapsFor(pot, gk, members, created, joinsAt) {
    const out = [];
    const creator = members[0].a;
    for (const m of members) {
      const at = joinsAt[m.a] ?? created;
      const pub = m.a === me ? myPub : personByAddr(m.a)?.xPub;
      if (pub) out.push({ member_id: m.a, by_id: m.a === creator ? creator : creator, wrap: wrapGroupKey(pub, gk, pot), timestamp: m.a === creator ? created : at + 40 });
      const p = personByAddr(m.a);
      if (p) out.push({ member_id: m.a, by_id: m.a, wrap: profileWrap(gk, pot, p), timestamp: at + 5 });
    }
    return out.sort((x, y) => x.timestamp - y.timestamp);
  }

  function lisbonPot(ended, pot) {
    const now2 = now;
    const start = ended ? L.start - 5 * D : L.start;
    const shift = start - L.start;
    const end = start + 5 * D - 60;
    const gk = seed(`groupkey/${pot}`);
    const spendsDone = lisbonSpends.map((s) => spendRow(pot, { ...s, at: s.n >= 5 && ended ? end - 3 * H - s.n * 600 : s.at + (s.n < 5 ? shift : 0) }));
    const pendingBoat = ended ? null : spendRow(pot, boat, { status: "Pending" });
    const spends = [...spendsDone, ...(pendingBoat ? [pendingBoat] : [])];
    const share = {};
    for (const s of spendsDone) for (const x of s._shares) share[x.account_id] = (share[x.account_id] ?? 0n) + x.amount;
    const contributed = {};
    for (const c of lisbonContribs) contributed[c.a] = (contributed[c.a] ?? 0n) + BigInt(c.amount);
    const totalIn = Object.values(contributed).reduce((a, b) => a + b, 0n);
    const totalSpent = spendsDone.reduce((a, s) => a + BigInt(s.amount), 0n);
    const balance = totalIn - totalSpent;
    const members = L.members.map((m) => {
      const c = contributed[m.a] ?? 0n;
      const sh = share[m.a] ?? 0n;
      return {
        address: m.a,
        country: m.country,
        status: "Active",
        safetyNet: USD(50),
        contributed: String(c),
        personalPaid: "0",
        share: String(sh),
        withdrawn: "0",
        net: String(c - sh),
        debt: "0",
        lastAckEpoch: ended ? "1" : null,
        joinedAt: joins[m.a] + shift,
        memberIndex: String(m.idx),
      };
    });
    const budgets = ["300000000", "0", "80000000", "120000000", "300000000", "0", "0", "0"];
    const catNames = ["Stay", "Travel", "Getting around", "Food & drink", "Tickets & activities", "Groceries", "Shopping", "Other"];
    const categorySpends = [0, 2, 3, 4].map((cat) => {
      const done = spendsDone.filter((s) => s.category === cat);
      const spent = done.reduce((a, s) => a + BigInt(s.amount), 0n);
      return { category: cat, name: catNames[cat], budget: budgets[cat], spent: String(spent), refunded: "0", remaining: String(BigInt(budgets[cat]) - spent), spendCount: done.length };
    });
    const keyWraps = keyWrapsFor(pot, gk, L.members, L.created + shift, Object.fromEntries(Object.entries(joins).map(([a, t]) => [a, t + shift])));
    const activity = [];
    for (const m of L.members) {
      const e = ev(`${pot}/join/${m.a}`);
      activity.push({ id: e.id, kind: "MemberJoined", account_id: m.a, pot_id: pot, counterparty: null, amount: null, ref: `${pot}-${m.a}`, timestamp: joins[m.a] + shift, txHash: e.txHash });
    }
    lisbonContribs.forEach((c, i) => {
      const e = ev(`${pot}/contrib/${i}`);
      activity.push({ id: e.id, kind: "Contributed", account_id: c.a, pot_id: pot, counterparty: null, amount: c.amount, ref: null, timestamp: i < 4 ? c.at + shift : ended ? end - 5 * H : c.at, txHash: e.txHash });
    });
    for (const s of spendsDone) activity.push({ id: ev(`${pot}/exec/${s.spendId}`).id, kind: "SpendExecuted", account_id: s.proposer_id, pot_id: pot, counterparty: s.payee, amount: s.amount, ref: s.id, timestamp: s.executedAt, txHash: s.txHash });
    if (pendingBoat) activity.push({ id: ev(`${pot}/prop/7`).id, kind: "SpendProposed", account_id: pendingBoat.proposer_id, pot_id: pot, counterparty: pendingBoat.payee, amount: pendingBoat.amount, ref: pendingBoat.id, timestamp: pendingBoat.proposedAt, txHash: pendingBoat.txHash });
    if (ended) for (const m of L.members) activity.push({ id: ev(`${pot}/ack/${m.a}`).id, kind: "Acked", account_id: m.a, pot_id: pot, counterparty: null, amount: null, ref: null, timestamp: end + 600 + m.idx * 300, txHash: txh(`${pot}/ack/${m.a}`) });
    return {
      gk,
      activity,
      spends,
      row: {
        id: pot,
        meta: plainMeta({ ...L.meta, name: lisbonName(start) }),
        inviteKeyWrap: "0x",
        inviteSigner: pad("1a7173", "ff"),
        creator_id: me,
        status: "Active",
        startTime: String(start),
        endTime: String(end),
        reviewWindow: "86400",
        settledAt: null,
        balance: String(balance),
        frozenUntil: "0",
        ackEpoch: ended ? "1" : "0",
        acksInEpoch: ended ? 4 : 0,
        rulesVersion: "1",
        ...RULES_BALANCED,
        categoryBudgets: budgets,
        totalContributed: String(totalIn),
        totalSpent: String(totalSpent),
        totalPaidOut: "0",
        spendCount: spends.length,
        memberCount: 4,
        activeMemberCount: 4,
        countries: [...new Set(L.members.map((m) => m.country))],
        isDemo: false,
        lastActivityAt: ended ? end + 1500 : now2 - 120,
        createdAt: L.created + shift,
      },
      members,
      balances: members.map((m) => ({ account_id: m.address, net: m.net, owes: "0", owedByMembers: "0", owedByPot: BigInt(m.net) > 0n ? m.net : "0", settledUp: false })),
      categorySpends,
      settlementEdges: members.filter((m) => BigInt(m.net) > 0n).map((m) => ({ kind: "PotToMember", from_id: null, to_id: m.address, amount: m.net, fromCountry: null, toCountry: m.country })),
      disputes: [],
      ruleChanges: [],
      keyWraps,
      freezes: [],
      acks: ended ? L.members.map((m) => ({ account_id: m.a, ackEpoch: "1", timestamp: end + 600 + m.idx * 300 })) : [],
      payouts: [],
      pulls: [],
      settlements: [],
      canSettle: ended,
    };
  }

  function glastoPot() {
    const pot = POTS.glasto;
    const gk = seed(`groupkey/${pot}`);
    const spends = glastoSpends.map((s) => spendRow(pot, s, { active: 5 }));
    const share = {};
    for (const s of spends) for (const x of s._shares) share[x.account_id] = (share[x.account_id] ?? 0n) + x.amount;
    const contributed = { [me]: 120_000_000n, [sam.address]: 150_000_000n, [asha.address]: 150_000_000n, [ben.address]: 150_000_000n, [leo.address]: 150_000_000n };
    // settle: everyone square except me (-8.91 recorded as debt) and Ben (+8.91 still owed to him)
    const net0 = Object.fromEntries(G.members.map((m) => [m.a, contributed[m.a] - (share[m.a] ?? 0n)]));
    const myDebt = -net0[me];
    const withdrawn = {};
    for (const m of G.members) withdrawn[m.a] = m.a === me ? 0n : m.a === ben.address ? net0[m.a] - myDebt : net0[m.a];
    const joinsG = { [ben.address]: G.created, [me]: G.created + 2 * H, [sam.address]: G.created + 5 * H, [asha.address]: G.created + D, [leo.address]: G.created + 2 * D };
    const members = G.members.map((m) => {
      const net = contributed[m.a] - (share[m.a] ?? 0n) - withdrawn[m.a];
      return {
        address: m.a,
        country: m.country,
        status: "Active",
        safetyNet: m.a === me ? "0" : USD(50),
        contributed: String(contributed[m.a]),
        personalPaid: "0",
        share: String(share[m.a] ?? 0n),
        withdrawn: String(withdrawn[m.a]),
        net: String(net),
        debt: m.a === me ? String(myDebt) : "0",
        lastAckEpoch: "1",
        joinedAt: joinsG[m.a],
        memberIndex: String(m.idx),
      };
    });
    const totalIn = Object.values(contributed).reduce((a, b) => a + b, 0n);
    const totalSpent = spends.reduce((a, s) => a + BigInt(s.amount), 0n);
    const paidOut = Object.values(withdrawn).reduce((a, b) => a + b, 0n);
    const settleTx = txh(`${pot}/settle`);
    const payouts = G.members
      .filter((m) => withdrawn[m.a] > 0n)
      .map((m) => ({ account_id: m.a, amount: String(withdrawn[m.a]), afterSettlement: false, source: "Automatic", collectedBy_id: null, timestamp: G.settledAt, txHash: settleTx }));
    const activity = [];
    for (const m of G.members) activity.push({ id: ev(`${pot}/join/${m.a}`).id, kind: "MemberJoined", account_id: m.a, pot_id: pot, counterparty: null, amount: null, ref: `${pot}-${m.a}`, timestamp: joinsG[m.a], txHash: txh(`${pot}/join/${m.a}`) });
    for (const m of G.members) activity.push({ id: ev(`${pot}/contrib/${m.a}`).id, kind: "Contributed", account_id: m.a, pot_id: pot, counterparty: null, amount: String(contributed[m.a]), ref: null, timestamp: joinsG[m.a] + 60, txHash: txh(`${pot}/contrib/${m.a}`) });
    for (const s of spends) activity.push({ id: ev(`${pot}/exec/${s.spendId}`).id, kind: "SpendExecuted", account_id: s.proposer_id, pot_id: pot, counterparty: s.payee, amount: s.amount, ref: s.id, timestamp: s.executedAt, txHash: s.txHash });
    for (const p of payouts) activity.push({ id: ev(`${pot}/payout/${p.account_id}`).id, kind: "Payout", account_id: p.account_id, pot_id: pot, counterparty: null, amount: p.amount, ref: null, timestamp: G.settledAt, txHash: settleTx });
    activity.push({ id: ev(`${pot}/debt`).id, kind: "DebtRecorded", account_id: me, pot_id: pot, counterparty: null, amount: String(myDebt), ref: null, timestamp: G.settledAt, txHash: settleTx });
    activity.push({ id: ev(`${pot}/settled`).id, kind: "Settled", account_id: ben.address, pot_id: pot, counterparty: null, amount: String(paidOut), ref: null, timestamp: G.settledAt, txHash: settleTx });
    const budgets = ["0", "0", "0", "0", "0", "0", "0", "0"];
    const catNames = { 0: "Stay", 1: "Travel", 3: "Food & drink" };
    return {
      gk,
      activity,
      spends,
      row: {
        id: pot,
        meta: plainMeta(G.meta),
        inviteKeyWrap: "0x",
        inviteSigner: pad("1a7174", "ff"),
        creator_id: ben.address,
        status: "Settled",
        startTime: String(G.start),
        endTime: String(G.end),
        reviewWindow: "86400",
        settledAt: G.settledAt,
        balance: "0",
        frozenUntil: "0",
        ackEpoch: "1",
        acksInEpoch: 5,
        rulesVersion: "1",
        ...RULES_BALANCED,
        categoryBudgets: budgets,
        totalContributed: String(totalIn),
        totalSpent: String(totalSpent),
        totalPaidOut: String(paidOut),
        spendCount: spends.length,
        memberCount: 5,
        activeMemberCount: 5,
        countries: [...new Set(G.members.map((m) => m.country))],
        isDemo: false,
        lastActivityAt: G.settledAt,
        createdAt: G.created,
      },
      members,
      balances: members.map((m) => ({ account_id: m.address, net: m.net, owes: BigInt(m.net) < 0n ? String(-BigInt(m.net)) : "0", owedByMembers: BigInt(m.net) > 0n ? m.net : "0", owedByPot: "0", settledUp: BigInt(m.net) === 0n })),
      categorySpends: [0, 1, 3].map((cat) => {
        const done = spends.filter((s) => s.category === cat);
        return { category: cat, name: catNames[cat], budget: "0", spent: String(done.reduce((a, s) => a + BigInt(s.amount), 0n)), refunded: "0", remaining: null, spendCount: done.length };
      }),
      settlementEdges: [{ kind: "MemberToMember", from_id: me, to_id: ben.address, amount: String(myDebt), fromCountry: myCountry, toCountry: "GB" }],
      disputes: [],
      ruleChanges: [],
      keyWraps: keyWrapsFor(pot, gk, G.members, G.created, joinsG),
      freezes: [],
      acks: G.members.map((m) => ({ account_id: m.a, ackEpoch: "1", timestamp: G.end + 1800 + m.idx * 600 })),
      payouts,
      pulls: [],
      settlements: [{ by_id: ben.address, paidOut: String(paidOut), pulledIn: "0", unpaidClaims: "0", fxRoundId: "41", timestamp: G.settledAt, txHash: settleTx }],
      canSettle: false,
    };
  }

  // ── reference rounds (FxReference, written by Chainlink CRE) ──
  // 40 covers the send to Sam (3 h ago) and the tram spend (1 h ago), with a pound slightly weaker
  // than today's quote so its receipt shows a real difference; 41 is the one the Glastonbury
  // settle-up recorded; 42 is the latest (50 min ago). Spends older than 6 h after round 40 have no
  // round in effect and fall back to Plans' quote.
  const roundRow = (id, scheduledTime, overrides = {}) => {
    const rates = { ...USD_PER_E8, ...overrides };
    return {
      id: String(id),
      fxReference: "0xab7eede1da994137a340155f350a8f81358ffca2",
      roundId: String(id),
      scheduledTime: String(scheduledTime),
      writtenAt: scheduledTime + 60,
      rateDate: Number(new Date((scheduledTime - 86400) * 1000).toISOString().slice(0, 10).replace(/-/g, "")),
      sourceMask: 3,
      ...Object.fromEntries(["GBP", "EUR", "INR", "NGN", "JPY", "CHF", "AED", "SGD"].map((c) => [`rate${c}`, String(rates[c])])),
      blockNumber: 4_799_000 + id,
      txHash: txh(`fxround/${id}`),
      _rates: rates,
    };
  };
  const fxRounds = [roundRow(40, now - 3 * H - 40 * 60, { GBP: 134_650_000n }), roundRow(41, G.settledAt - 25 * 60, { GBP: 127_110_000n, INR: 1_198_800n }), roundRow(42, now - 50 * 60)];
  const roundById = (id) => fxRounds.find((r) => r.roundId === String(id)) ?? null;

  // ── my money (AccountActivity) ──
  const account = { Activity: [], sendsIn: [], sendsOut: [], claimsIn: [], claimsOut: [], payouts: [] };
  if (!empty) {
    for (const p of [pots[POTS.lisbon], pots[POTS.glasto]]) for (const a of p.activity) if (a.account_id === me) account.Activity.push({ ...a });
    // `roundId` = the round the sender named ("0" = none, then the receipt shows the quoted rate);
    // its reference rate and the difference are worked out like PlansSend does.
    const sendFields = (id, from, to, amountUsd, fromC, toC, fromCur, toCur, at, roundId = "0") => {
      const rate = fxRateE8(fromCur, toCur) ?? 100_000_000n;
      const r = roundById(roundId);
      const usdOf = (c) => (c === "USD" ? 100_000_000n : r?._rates[c]);
      const ref = r && usdOf(fromCur) && usdOf(toCur) ? (usdOf(fromCur) * 100_000_000n) / usdOf(toCur) : 0n;
      return {
        id,
        from_id: from,
        to_id: to,
        amount: USD(amountUsd),
        fromCountry: fromC,
        toCountry: toC,
        fromCurrency: fromCur,
        toCurrency: toCur,
        fxRateE8: String(rate),
        fxTimestamp: String(at - 30),
        fxRoundId: r ? String(roundId) : "0",
        refRateE8: String(ref),
        fxDiffBps: String(ref > 0n ? ((rate - ref) * 10_000n) / ref : 0n),
        memoHash: ZERO_HASH,
        timestamp: at,
        txHash: txh(`send/${id}`),
      };
    };
    // I sent £1.50 ($2.02) to Sam, naming round 40; Ben sent me $12.00 (pounds to pounds, no round);
    // Asha sent me $6.00 from rupees with no round (the receipt shows Plans' quote).
    account.sendsOut.push(sendFields(ev("send/out1").id, me, sam.address, 2.02, myCountry, "US", "GBP", "USD", now - 3 * H, "40"));
    account.sendsIn.push(sendFields(ev("send/in1").id, ben.address, me, 12, "GB", myCountry, "GBP", "GBP", now - 2 * D - 5 * H));
    account.sendsIn.push(sendFields(ev("send/in2").id, asha.address, me, 6, "IN", myCountry, "INR", "GBP", now - 5 * H));
    // a $25 link I sent, claimed by Asha; a $10 link from Sam that I claimed
    account.claimsOut.push({ id: "c-101", claimId: "101", claimSigner: pad("c1a101", "01"), amount: USD(25), expiry: String(now + 2 * D), status: "Claimed", createdAt: now - 5 * D, claimedAt: now - 5 * D + 2 * H, refundedAt: null, recipient_id: asha.address, txHash: txh("claim/101") });
    account.claimsIn.push({ id: "c-88", claimId: "88", source: sam.address, amount: USD(10), fromCountry: "US", toCountry: myCountry, status: "Claimed", createdAt: now - 7 * D, claimedAt: now - 6 * D, txHash: txh("claim/88") });
    account.Activity.push({ id: ev("claimed/88").id, kind: "Claimed", pot_id: null, counterparty: sam.address, amount: USD(10), ref: "c-88", timestamp: now - 6 * D, txHash: txh("claim/88") });
    account.Activity.sort((a, b) => b.timestamp - a.timestamp);
  }

  // An open $25 link from Ben (answers ClaimBySigner for any signer).
  const claimLink = {
    id: "c-202",
    claimId: "202",
    source: ben.address,
    sourceAccount_id: ben.address,
    sourcePot_id: null,
    spend_id: null,
    claimSigner: pad("c1a202", "02"),
    amount: USD(25),
    expiry: String(now + 6 * D),
    fromCountry: "GB",
    toCountry: null,
    status: "Open",
    createdAt: now - 20 * 60,
    claimedAt: null,
    refundedAt: null,
    recipient_id: null,
    txHash: txh("claim/202"),
  };

  const fxRound = fxRounds[fxRounds.length - 1];

  return { me, now, pots, account, claimLink, fxRound, fxRounds, empty };
}

function hash32(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
function personByAddr(a) {
  return Object.values(PEOPLE).find((p) => p.address === a?.toLowerCase());
}

// ─────────────── GraphQL answers ───────────────

const strip = (o) => {
  if (Array.isArray(o)) return o.map(strip);
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, strip(v)]));
  return o;
};
const desc = (k) => (a, b) => (b[k] ?? 0) - (a[k] ?? 0);

function detailOf(p) {
  const recent = [...p.spends].sort(desc("proposedAt")).slice(0, 40);
  return strip({
    ...p.row,
    members: p.members,
    balances: [...p.balances].sort((a, b) => (BigInt(b.net) > BigInt(a.net) ? 1 : -1)),
    categorySpends: p.categorySpends,
    settlementEdges: p.settlementEdges,
    spends: p.spends.filter((s) => s.status === "Pending" || s.status === "Approved").sort(desc("proposedAt")),
    recent,
    disputes: p.disputes,
    ruleChanges: p.ruleChanges,
    keyWraps: p.keyWraps,
    freezes: p.freezes,
    acks: p.acks,
    payouts: p.payouts,
    pulls: p.pulls,
    settlements: p.settlements,
  });
}

export function answerGraphql(world, query, variables = {}, myPubHex = null) {
  const op = (query.match(/^\s*(?:query|mutation)\s+(\w+)/) || [])[1] ?? "";
  const lc = (s) => String(s ?? "").toLowerCase();
  const pot = world.pots[lc(variables.pot)];
  const keyRow = (a) => {
    const p = personByAddr(a);
    if (p) return { id: p.address, key: toHex(p.xPub), country: p.country };
    if (lc(a) === world.me) return { id: world.me, key: myPubHex, country: null };
    return null;
  };
  switch (op) {
    case "MyPlans": {
      const mine = world.empty ? [] : [POTS.lisbon, POTS.glasto].map((id) => world.pots[id]).filter(Boolean);
      return {
        Member: mine
          .map((p) => {
            const m = p.members.find((x) => x.address === world.me);
            return strip({
              id: `${p.row.id}-${world.me}`,
              status: m.status,
              net: m.net,
              contributed: m.contributed,
              share: m.share,
              debt: m.debt,
              safetyNet: m.safetyNet,
              _joinedAt: m.joinedAt,
              pot: {
                ...p.row,
                spends: p.spends.filter((s) => s.status === "Pending" || s.status === "Approved").map((s) => ({ id: s.id, spendId: s.spendId, proposer_id: s.proposer_id, amount: s.amount, approvals: s.approvals, approvalsRequired: s.approvalsRequired, votes: s.votes.map((v) => ({ account_id: v.account_id, approve: v.approve })) })),
                recent: p.spends.filter((s) => s.status === "Executed").sort(desc("executedAt")).slice(0, 1).map((s) => ({ proposer_id: s.proposer_id, amount: s.amount, executedAt: s.executedAt, kind: s.kind })),
                members: p.members.map((x) => ({ address: x.address, country: x.country, status: x.status })),
                keyWraps: p.keyWraps,
              },
            });
          }),
        Account: world.me ? [{ id: world.me, key: myPubHex, country: null, isUser: true, keyWraps: [] }] : [],
      };
    }
    case "PlanDetail":
      return { Pot: pot ? [detailOf(pot)] : [] };
    case "PotPreview":
      return { Pot: pot ? [strip({ ...pot.row, members: pot.members.map((x) => ({ address: x.address, country: x.country, status: x.status })), keyWraps: pot.keyWraps })] : [] };
    case "PlanActivity": {
      const rows = pot ? [...pot.activity].sort((a, b) => b.timestamp - a.timestamp || (a.id < b.id ? 1 : -1)) : [];
      const off = Number(variables.offset ?? 0);
      return { Activity: rows.slice(off, off + Number(variables.limit ?? 50)).map(({ pot_id, ...r }) => r) };
    }
    case "AccountActivity": {
      const a = world.account;
      return { Activity: a.Activity.map(({ account_id, ...r }) => r).slice(0, Number(variables.limit ?? 60)), sendsIn: a.sendsIn, sendsOut: a.sendsOut, claimsIn: a.claimsIn, claimsOut: a.claimsOut, payouts: a.payouts };
    }
    case "SpendDetail": {
      const id = lc(variables.spend);
      const p = world.pots[id.split("-")[0]];
      const s = p?.spends.find((x) => x.id === id);
      if (!s) return { Spend: [] };
      const catNames = ["Stay", "Travel", "Getting around", "Food & drink", "Tickets & activities", "Groceries", "Shopping", "Other"];
      return {
        Spend: [
          strip({
            ...s,
            categoryName: catNames[s.category],
            refunded: "0",
            lastDisputeOutcome: "None",
            shares: s._shares.map((x) => ({ account_id: x.account_id, originalAmount: String(x.amount), refunded: "0", amount: String(x.amount) })),
            disputes: [],
            claims: [],
          }),
        ],
      };
    }
    case "ClaimBySigner":
      return { Claim: world.empty ? [] : [world.claimLink] };
    case "AccountKey":
      return { Account: [keyRow(variables.account)].filter(Boolean) };
    case "AccountKeys":
      return { Account: (variables.accounts ?? []).map(keyRow).filter(Boolean) };
    case "LatestFxRound":
      return { FxRound: strip([world.fxRound]) };
    case "FxRoundById":
      return { FxRound: strip(world.fxRounds.filter((r) => r.roundId === String(variables.roundId))) };
    case "FxRoundAt": {
      const at = Number(variables.at);
      const r = world.fxRounds.filter((x) => Number(x.scheduledTime) <= at).sort((a, b) => Number(b.scheduledTime) - Number(a.scheduledTime))[0];
      return { FxRound: r ? strip([r]) : [] };
    }
    default:
      return null;
  }
}

// ─────────────── RPC answers ───────────────

const potReadAbi = viem.parseAbi([
  "function previewSpend(address proposer, uint8 kind, address payee, uint256 amount, uint8 category) view returns (uint8 approvalsRequired, bool ok, uint8 reason)",
  "function netOf(address member) view returns (int256)",
  "function isMember(address account) view returns (bool)",
  "function activeMemberCount() view returns (uint256)",
  "function canSettle() view returns (bool)",
  "function settled() view returns (bool)",
]);
const ercAbi = viem.parseAbi(["function balanceOf(address) view returns (uint256)", "function keyOf(address account) view returns (bytes32)"]);

function answerEthCall(world, call, opts) {
  const to = String(call?.to ?? "").toLowerCase();
  const data = call?.data ?? call?.input;
  if (!data) return undefined;
  const p = world.pots[to];
  if (p) {
    let d;
    try {
      d = viem.decodeFunctionData({ abi: potReadAbi, data });
    } catch {
      return { error: { code: 3, message: "execution reverted", data: "0x" } };
    }
    const active = p.members.filter((m) => m.status === "Active").length;
    let result;
    switch (d.functionName) {
      case "previewSpend": {
        const isMem = p.members.some((m) => m.address === String(d.args[0]).toLowerCase() && m.status === "Active");
        const ok = isMem && p.row.status === "Active" && Number(p.row.endTime) > world.now;
        const amount = d.args[3];
        const balance = BigInt(p.row.balance);
        result = [approvalsRequired(amount, active), ok && amount <= balance, !isMem ? 1 : !ok ? 2 : amount > balance ? 9 : 0];
        break;
      }
      case "netOf":
        result = BigInt(p.members.find((m) => m.address === String(d.args[0]).toLowerCase())?.net ?? "0");
        break;
      case "isMember":
        result = p.members.some((m) => m.address === String(d.args[0]).toLowerCase() && m.status === "Active");
        break;
      case "activeMemberCount":
        result = BigInt(active);
        break;
      case "canSettle":
        result = !!p.canSettle;
        break;
      case "settled":
        result = p.row.status === "Settled";
        break;
    }
    return { result: viem.encodeFunctionResult({ abi: potReadAbi, functionName: d.functionName, result }) };
  }
  let d;
  try {
    d = viem.decodeFunctionData({ abi: ercAbi, data });
  } catch {
    return undefined;
  }
  const arg = String(d.args[0]).toLowerCase();
  if (d.functionName === "balanceOf") {
    if (opts.balance !== undefined && opts.balance !== null && arg === world.me) return { result: viem.encodeFunctionResult({ abi: ercAbi, functionName: "balanceOf", result: BigInt(opts.balance) }) };
    const fp = personByAddr(arg);
    if (fp) return { result: viem.encodeFunctionResult({ abi: ercAbi, functionName: "balanceOf", result: 40_000_000n }) };
    return undefined;
  }
  if (d.functionName === "keyOf") {
    const fp = personByAddr(arg);
    if (fp) return { result: toHex(fp.xPub) };
  }
  return undefined;
}

// ─────────────── install ───────────────

const CORS = {
  "access-control-allow-origin": ORIGIN,
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
  "access-control-allow-headers": "content-type,accept,authorization",
  "access-control-max-age": "600",
  "cache-control": "no-store",
};
const json = (body, status = 200) => ({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
const preflight = () => ({ status: 204, headers: CORS, body: "" });

const isRelayer = (url) => /relayer/.test(url.hostname);

const bytesToAscii = (h) => {
  try {
    return Buffer.from(String(h).replace(/^0x/, ""), "hex").toString("latin1").replace(/\0/g, "");
  } catch {
    return "";
  }
};

/** A successful relay result with the events the app reads for `action` (opts.relay). */
function fakeRelay(world, action, params) {
  const events = [];
  const big = (v) => BigInt(String(v ?? 0));
  if (action === "send") {
    const m = params.meta ?? {};
    const r = world.fxRounds.find((x) => x.roundId === String(big(m.fxRoundId)));
    const from = bytesToAscii(m.fromCurrency) || "USD";
    const to = bytesToAscii(m.toCurrency) || "USD";
    const usd = (c) => (c === "USD" ? 100_000_000n : r?._rates[c]);
    const ref = r && usd(from) && usd(to) ? (usd(from) * 100_000_000n) / usd(to) : 0n;
    const applied = big(m.fxRateE8);
    events.push({ name: "Sent", args: { from: params.from, to: m.to, amount: String(params.auth?.value ?? 0), fxRoundId: r ? r.roundId : "0", refRateE8: String(ref), fxDiffBps: String(ref > 0n ? ((applied - ref) * 10_000n) / ref : 0n) } });
  } else if (action === "propose") {
    events.push({ name: "SpendProposed", address: params.pot, args: { id: "99", approvalsRequired: "1" } }, { name: "SpendExecuted", address: params.pot, args: { id: "99" } });
  } else if (action === "settle") {
    const pot = world.pots[String(params.pot).toLowerCase()];
    let paid = 0n;
    for (const m of pot?.members ?? []) {
      const net = big(m.net);
      if (net <= 0n) continue;
      paid += net;
      events.push({ name: "Payout", address: params.pot, args: { member: m.address, amount: String(net) } });
    }
    events.push({ name: "Settled", address: params.pot, args: { by: world.me, paidOut: String(paid), pulledIn: "0", unpaidClaims: "0", fxRoundId: world.fxRound.roundId } });
  }
  return { action, txHash: toHex(rand(32)), blockNumber: "4800999", status: "success", latencyMs: 640, totalMs: 700, events };
}

/**
 * Installs the fixtures on `page` (call before the first navigation). Options:
 *   empty      true → no plans, no activity (first-run states)
 *   balance    AUSD units (bigint/number) answered for balanceOf(me); undefined → real RPC
 *   fx         false → /v1/fx and /v1/fx/round go to the real relayer
 *   demo       body for GET /v1/demo/accounts (default {enabled:true,accounts:[],pots:[]}); null → real relayer
 *   myCountry  country code recorded for me in the plans (default "GB")
 *   lisbonEnded true → the Lisbon pot (ids.lisbon) has ended and everyone checked the numbers, so
 *              plan → Review → "See the settle-up" reaches the settle-up preview (design 112).
 *              ids.lisbonEnded is that same ended state under its own address in either mode.
 *   relay      true → POST /v1/relay answers success with the events the app reads (send: Sent with
 *              the round's reference rate; propose: SpendProposed + SpendExecuted; settle: Payout per
 *              member owed money + Settled with the latest round). Nothing reaches the network. Install
 *              after noTestnetWrites (this route goes first).
 *   log        true → print every answered request
 * Returns { ids, people, world(), me(), stop() }.
 */
export async function installFixtures(page, opts = {}) {
  const state = { me: null, myPub: null, world: null, worldKey: "" };
  const now = Math.floor(Date.now() / 1000);
  const log = (...a) => (opts.log || process.env.VERBOSE ? console.log("  [fixtures]", ...a) : undefined);

  async function stored() {
    try {
      const raw = await page.evaluate(() => {
        try {
          return localStorage.getItem("plans.kv.plans.account.v1");
        } catch {
          return null;
        }
      });
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function worldFor(account) {
    if (account) state.me = String(account).toLowerCase();
    if (!state.me || !state.myPub) {
      const a = await stored();
      if (a?.address && !state.me) state.me = a.address.toLowerCase();
      if (a?.x25519Public && (!a.address || a.address.toLowerCase() === state.me)) state.myPub = a.x25519Public;
    }
    const me = state.me ?? "0x00000000000000000000000000000000000000e1";
    const key = `${me}|${state.myPub ?? ""}`;
    if (!state.world || state.worldKey !== key) {
      state.world = buildWorld({ me, myPub: state.myPub ? fromHex(state.myPub) : null, now, empty: !!opts.empty, myCountry: opts.myCountry ?? "GB", lisbonEnded: !!opts.lisbonEnded });
      state.worldKey = key;
      log(`world built for ${me}${state.myPub ? "" : " (no X25519 key yet: plans read as locked)"}`);
    }
    return state.world;
  }

  const stop = await route(page, async (req, url) => {
    const method = req.method();
    // ── GraphQL (indexer) ──
    if (/graphql$/.test(url.pathname)) {
      if (method === "OPTIONS") return preflight();
      if (method !== "POST") return undefined;
      let body;
      try {
        body = JSON.parse(req.postData() ?? "");
      } catch {
        return undefined;
      }
      if (typeof body?.query !== "string") return undefined;
      const v = body.variables ?? {};
      const world = await worldFor(v.account);
      const data = answerGraphql(world, body.query, v, state.myPub);
      const op = (body.query.match(/^\s*(?:query|mutation)\s+(\w+)/) || [])[1] ?? "?";
      if (!data) {
        log(`unknown GraphQL operation ${op}`);
        return json({ errors: [{ message: `fixtures: no answer for ${op}` }] });
      }
      log(`gql ${op}`);
      return json({ data });
    }
    // ── relayer ──
    if (isRelayer(url)) {
      const p = url.pathname;
      const ours = p === "/v1/config" || (opts.fx !== false && (p === "/v1/fx" || p === "/v1/fx/round")) || (opts.demo !== null && p === "/v1/demo/accounts");
      if (!ours) return undefined;
      if (method === "OPTIONS") return preflight();
      if (method !== "GET") return undefined;
      if (p === "/v1/config") return json({ chainId: CHAIN_ID, graphqlUrl: GRAPHQL_URL });
      if (p === "/v1/demo/accounts") return json(opts.demo ?? { enabled: true, accounts: [], pots: [] });
      const world = await worldFor();
      if (p === "/v1/fx/round") {
        const r = world.fxRound;
        return json({
          fxReference: r.fxReference,
          roundId: r.roundId,
          scheduledTime: Number(r.scheduledTime),
          writtenAt: r.writtenAt,
          rateDate: r.rateDate,
          sourceMask: r.sourceMask,
          usdPerUnitE8: Object.fromEntries(Object.entries(USD_PER_E8).filter(([c]) => c !== "USD").map(([c, v]) => [c, String(v)])),
          sourceMasks: Object.fromEntries(Object.keys(USD_PER_E8).filter((c) => c !== "USD").map((c) => [c, 3])),
          ageSec: world.now - Number(r.scheduledTime),
          maxAgeSec: 21600,
          fresh: true,
        });
      }
      const from = (url.searchParams.get("from") ?? "USD").toUpperCase();
      const to = (url.searchParams.get("to") ?? "USD").toUpperCase();
      const rate = fxRateE8(from, to);
      if (rate === null) return json({ error: { code: "FX_UNSUPPORTED", message: `No rate for ${from}/${to}` } }, 400);
      const date = new Date((world.now - 86400) * 1000).toISOString().slice(0, 10);
      const rateStr = (Number(rate) / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
      return json({
        from,
        to,
        rate: rateStr,
        rateE8: String(rate),
        timestamp: world.now - 600,
        date,
        source: "ECB reference rates via frankfurter.app (fixture)",
        signer: "0x0000000000000000000000000000000000000000",
        message: `Plans FX reference\nPair: ${from}/${to}\nRateE8: ${rate}\nTimestamp: ${world.now - 600}\nDate: ${date}\nSource: fixture`,
        signature: "0x" + "00".repeat(65),
      });
    }
    // ── Monad RPC ──
    if ((opts.rpcHosts ?? RPC_HOSTS).includes(url.hostname)) {
      if (method === "OPTIONS") return preflight();
      if (method !== "POST") return undefined;
      let body;
      try {
        body = JSON.parse(req.postData() ?? "");
      } catch {
        return undefined;
      }
      const world = await worldFor();
      const one = (c) => (c?.method === "eth_call" ? answerEthCall(world, c.params?.[0], opts) : undefined);
      if (Array.isArray(body)) {
        const answers = body.map(one);
        if (!answers.some(Boolean)) return undefined;
        // mixed batch: fetch the rest from the real node
        const rest = body.filter((_, i) => !answers[i]);
        let real = [];
        if (rest.length) {
          const r = await fetch(url.href, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rest) });
          real = await r.json();
        }
        const byId = new Map((Array.isArray(real) ? real : [real]).map((x) => [x.id, x]));
        return json(body.map((c, i) => (answers[i] ? { jsonrpc: "2.0", id: c.id, ...answers[i] } : byId.get(c.id))));
      }
      const a = one(body);
      if (!a) return undefined;
      log(`rpc eth_call → ${String(body.params?.[0]?.to).slice(0, 10)}`);
      return json({ jsonrpc: "2.0", id: body.id, ...a });
    }
    return undefined;
  });

  // Fake relay results (opts.relay): ahead of every other route, including noTestnetWrites.
  const stopRelay = opts.relay
    ? await route(
        page,
        async (req, url) => {
          if (!isRelayer(url) || url.pathname !== "/v1/relay") return undefined;
          if (req.method() === "OPTIONS") return preflight();
          if (req.method() !== "POST") return undefined;
          let body;
          try {
            body = JSON.parse(req.postData() ?? "");
          } catch {
            return undefined;
          }
          const world = await worldFor();
          log(`relay ${body?.action} (fake)`);
          await new Promise((r) => setTimeout(r, 300));
          return json(fakeRelay(world, String(body?.action ?? ""), body?.params ?? {}));
        },
        { first: true },
      )
    : () => undefined;

  return {
    ids: {
      lisbon: POTS.lisbon,
      lisbonEnded: POTS.lisbonEnded,
      glasto: POTS.glasto,
      boatSpend: "7",
      dinnerSpend: "6",
      tramSpend: "5",
      villaSpend: "1",
      people: Object.fromEntries(Object.entries(PEOPLE).map(([k, p]) => [k, p.address])),
    },
    people: PEOPLE,
    me: () => state.me,
    world: () => state.world,
    stop: () => (stop(), stopRelay()),
  };
}

/** A claim link URL for the fixture's open $25 link from Ben (the key is a fixed test value). */
export function claimPath() {
  const k = Buffer.from(seed("claimkey")).toString("base64url");
  return `/app/claim?k=${k}&n=Ben&a=25000000`;
}
