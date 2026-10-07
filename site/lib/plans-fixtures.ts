// Local fixtures for /v/<pot> and /s/<pot>: a mock of the Envio response for screenshots and review
// before an indexer is deployed. Active ONLY when PLANS_FIXTURES=1 and never on a Vercel production
// deployment. The fixture plan's meta is real ciphertext made with the app's construction, so the
// shared page exercises the same in-browser decryption as a real link.
//
//   PLANS_FIXTURES=1 npm run build && PLANS_FIXTURES=1 npm start
//   /v/0x7e57000000000000000000000000000000000a01#s=<FIXTURE_INVITE_FRAGMENT>&n=Maya
//   /s/0x7e57000000000000000000000000000000000a02#n=Lisbon%2C%2012%E2%80%9316%20Oct

import { sha256 } from "@noble/hashes/sha2.js";
import { addressOf, groupEncrypt, inviteKeyPair, sealDeterministic, toBase64Url, toHex, utf8 } from "./plans-crypto";
import type { Loaded, ProofPlan, SharedPlan } from "./plans-data";

export const FIXTURE_SHARED_POT = "0x7e57000000000000000000000000000000000a01";
export const FIXTURE_PROOF_POT = "0x7e57000000000000000000000000000000000a02";

export function fixturesEnabled(): boolean {
  return process.env.PLANS_FIXTURES === "1" && process.env.VERCEL_ENV !== "production";
}

export function isFixturePot(pot: string): boolean {
  return fixturesEnabled() && (pot === FIXTURE_SHARED_POT || pot === FIXTURE_PROOF_POT);
}

const seed = (s: string) => sha256(utf8(`plans.site.fixture|${s}`));
const FIXTURE_SECRET = seed("invite");
/** base64url invite secret for the fixture link (a test value; it unlocks nothing real). */
export const FIXTURE_INVITE_FRAGMENT = toBase64Url(FIXTURE_SECRET);

const D = 1_000_000;
const usd = (n: number) => String(Math.round(n * D));
const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;

function shared(): SharedPlan {
  const pot = FIXTURE_SHARED_POT;
  const groupKey = seed("groupkey");
  const meta = groupEncrypt(groupKey, "meta", pot, utf8(JSON.stringify({ v: 1, name: "Lisbon, 12–16 Oct", emoji: "🌊", color: "#2FA6B8" })), seed("n1").slice(0, 24));
  const wrap = sealDeterministic(inviteKeyPair(FIXTURE_SECRET).publicKey, groupKey, `groupkey|${pot}`, seed("eph"), seed("n2").slice(0, 24));
  return {
    pot,
    meta: toHex(meta),
    inviteKeyWrap: toHex(wrap),
    inviteSigner: addressOf(FIXTURE_SECRET),
    signerWraps: [],
    status: "Active",
    startTime: utc(2026, 10, 12),
    endTime: utc(2026, 10, 16, 22),
    reviewWindow: 24 * 3600,
    settledAt: null,
    balance: usd(446),
    memberCount: 4,
    activeMemberCount: 4,
    memberCountries: ["GB", "GB", "US", "IN"],
    isDemo: false,
    rules: {
      instantMax: usd(25),
      oneApprovalMax: usd(200),
      highTier: "MAJORITY",
      memberDailyCap: usd(150),
      memberTotalCap: "0",
      payeePolicy: "ANYONE",
      minContribution: "0",
      proposalTtl: String(24 * 3600),
      ruleTimelock: "3600",
      categoryBudgets: ["0", "0", "0", "0", "0", "0", "0", "0"],
    },
  };
}

function proof(): ProofPlan {
  const m = (i: number, c: string) => ({ address: `0x7e5700000000000000000000000000000000b00${i}`, country: c });
  const members = [m(1, "GB"), m(2, "GB"), m(3, "US"), m(4, "IN")];
  const tx = "0x" + "5e771ed0".repeat(8);
  return {
    pot: FIXTURE_PROOF_POT,
    status: "Settled",
    startTime: utc(2026, 10, 12),
    endTime: utc(2026, 10, 16, 22),
    reviewWindow: 12 * 3600,
    settledAt: utc(2026, 10, 17, 10, 42),
    memberCount: 4,
    isDemo: false,
    totalContributed: usd(800),
    totalSpent: usd(687.6),
    totalPaidOut: usd(112.4),
    spendCount: 18,
    members,
    payouts: [
      { account: members[0].address, amount: usd(40.1) },
      { account: members[1].address, amount: usd(24.2) },
      { account: members[2].address, amount: usd(28.1) },
      { account: members[3].address, amount: usd(20) },
    ],
    settlements: [{ paidOut: usd(112.4), pulledIn: "0", timestamp: utc(2026, 10, 17, 10, 42), txHash: tx }],
  };
}

export function getShared(pot: string): Loaded<SharedPlan> {
  return pot === FIXTURE_SHARED_POT ? { state: "ok", data: shared() } : { state: "not-found" };
}

export function getProof(pot: string): Loaded<ProofPlan> {
  return pot === FIXTURE_PROOF_POT ? { state: "ok", data: proof() } : { state: "not-found" };
}
