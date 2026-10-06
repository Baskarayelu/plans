/**
 * Local state in SQLite (node:sqlite, built into Node 24; no native build step).
 * Holds the listener's view of pots/members/proposals, push tokens, daily counters and demo runs.
 * Everything here can be rebuilt from chain logs except push tokens and counters.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAddress, type Address } from "viem";

export interface PotRow {
  address: Address;
  creator: Address;
  startTime: number;
  endTime: number;
  reviewWindow: number;
  settled: boolean;
  ackEpoch: number;
  frozenUntil: number;
  createdBlock: number;
}

export interface MemberRow {
  pot: Address;
  member: Address;
  country: string;
  idx: number;
  active: boolean;
  ackEpoch: number | null;
}

export type ProposalStatus = "pending" | "approved" | "executed" | "cancelled";

export interface ProposalRow {
  pot: Address;
  id: bigint;
  proposer: Address;
  kind: number;
  payee: Address;
  amount: bigint;
  category: number;
  splitMembers: Address[];
  approvalsRequired: number;
  expiresAt: number;
  status: ProposalStatus;
  createdAt: number;
}

export interface DemoRunRow {
  pot: Address;
  judge: Address;
  inviteSecret: string;
  stage: string;
  step: number;
  createdAt: number;
  updatedAt: number;
  endTime: number;
  lastError: string | null;
  meta: string | null; // JSON: app-supplied memos etc.
}

type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pots (
  address TEXT PRIMARY KEY, creator TEXT NOT NULL, start_time INTEGER NOT NULL, end_time INTEGER NOT NULL,
  review_window INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0, ack_epoch INTEGER NOT NULL DEFAULT 0,
  frozen_until INTEGER NOT NULL DEFAULT 0, created_block INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS members (
  pot TEXT NOT NULL, member TEXT NOT NULL, country TEXT NOT NULL DEFAULT '', idx INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, ack_epoch INTEGER, PRIMARY KEY (pot, member)
);
CREATE INDEX IF NOT EXISTS members_by_member ON members(member);
CREATE TABLE IF NOT EXISTS proposals (
  pot TEXT NOT NULL, id TEXT NOT NULL, proposer TEXT NOT NULL, kind INTEGER NOT NULL, payee TEXT NOT NULL,
  amount TEXT NOT NULL, category INTEGER NOT NULL, split_members TEXT NOT NULL, approvals_required INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (pot, id)
);
CREATE INDEX IF NOT EXISTS proposals_open ON proposals(status);
CREATE TABLE IF NOT EXISTS votes (pot TEXT NOT NULL, id TEXT NOT NULL, member TEXT NOT NULL, approve INTEGER NOT NULL, PRIMARY KEY (pot, id, member));
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, claim_signer TEXT NOT NULL, amount TEXT NOT NULL, source_spend_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_tokens (address TEXT NOT NULL, token TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (address, token));
CREATE INDEX IF NOT EXISTS push_by_token ON push_tokens(token);
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, day INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS demo_runs (
  pot TEXT PRIMARY KEY, judge TEXT NOT NULL, invite_secret TEXT NOT NULL, stage TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, end_time INTEGER NOT NULL, last_error TEXT, meta TEXT
);
`;

const a = (v: unknown) => getAddress(String(v));

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  // ───── kv ─────
  getKv(key: string): string | undefined {
    const r = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as Row | undefined;
    return r ? String(r.value) : undefined;
  }
  setKv(key: string, value: string) {
    this.db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  // ───── pots ─────
  upsertPot(p: Omit<PotRow, "settled" | "ackEpoch" | "frozenUntil">) {
    this.db
      .prepare(
        `INSERT INTO pots(address, creator, start_time, end_time, review_window, created_block) VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET creator = excluded.creator, start_time = excluded.start_time,
         end_time = excluded.end_time, review_window = excluded.review_window`,
      )
      .run(p.address, p.creator, p.startTime, p.endTime, p.reviewWindow, p.createdBlock);
  }
  getPot(address: Address): PotRow | undefined {
    const r = this.db.prepare("SELECT * FROM pots WHERE address = ?").get(getAddress(address)) as Row | undefined;
    return r ? this.#pot(r) : undefined;
  }
  hasPot(address: Address) {
    return !!this.db.prepare("SELECT 1 FROM pots WHERE address = ?").get(getAddress(address));
  }
  listPots(filter: { unsettled?: boolean } = {}): PotRow[] {
    const sql = filter.unsettled ? "SELECT * FROM pots WHERE settled = 0" : "SELECT * FROM pots";
    return (this.db.prepare(sql).all() as Row[]).map((r) => this.#pot(r));
  }
  setSettled(pot: Address) {
    this.db.prepare("UPDATE pots SET settled = 1 WHERE address = ?").run(pot);
  }
  /** Ack epochs only ever increase, so replays and out-of-order delivery are harmless. */
  bumpAckEpoch(pot: Address, epoch: number) {
    this.db.prepare("UPDATE pots SET ack_epoch = MAX(ack_epoch, ?) WHERE address = ?").run(epoch, pot);
  }
  setFrozenUntil(pot: Address, until: number) {
    this.db.prepare("UPDATE pots SET frozen_until = ? WHERE address = ?").run(until, pot);
  }
  #pot(r: Row): PotRow {
    return {
      address: a(r.address),
      creator: a(r.creator),
      startTime: Number(r.start_time),
      endTime: Number(r.end_time),
      reviewWindow: Number(r.review_window),
      settled: Number(r.settled) === 1,
      ackEpoch: Number(r.ack_epoch),
      frozenUntil: Number(r.frozen_until),
      createdBlock: Number(r.created_block),
    };
  }

  // ───── members ─────
  upsertMember(pot: Address, member: Address, country: string, idx: number) {
    this.db
      .prepare(
        `INSERT INTO members(pot, member, country, idx, active) VALUES(?, ?, ?, ?, 1)
         ON CONFLICT(pot, member) DO UPDATE SET country = excluded.country, idx = excluded.idx`,
      )
      .run(pot, member, country, idx);
  }
  setMemberInactive(pot: Address, member: Address) {
    this.db.prepare("UPDATE members SET active = 0 WHERE pot = ? AND member = ?").run(pot, member);
  }
  setMemberAck(pot: Address, member: Address, epoch: number) {
    this.db.prepare("UPDATE members SET ack_epoch = ? WHERE pot = ? AND member = ?").run(epoch, pot, member);
  }
  members(pot: Address, activeOnly = true): MemberRow[] {
    const sql = activeOnly ? "SELECT * FROM members WHERE pot = ? AND active = 1 ORDER BY idx" : "SELECT * FROM members WHERE pot = ? ORDER BY idx";
    return (this.db.prepare(sql).all(pot) as Row[]).map((r) => ({
      pot: a(r.pot),
      member: a(r.member),
      country: String(r.country),
      idx: Number(r.idx),
      active: Number(r.active) === 1,
      ackEpoch: r.ack_epoch === null || r.ack_epoch === undefined ? null : Number(r.ack_epoch),
    }));
  }
  potsOfMember(member: Address): Address[] {
    return (this.db.prepare("SELECT pot FROM members WHERE member = ? AND active = 1").all(member) as Row[]).map((r) => a(r.pot));
  }

  // ───── proposals ─────
  insertProposal(p: ProposalRow) {
    this.db
      .prepare(
        `INSERT INTO proposals(pot, id, proposer, kind, payee, amount, category, split_members, approvals_required, expires_at, status, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(pot, id) DO NOTHING`,
      )
      .run(
        p.pot,
        p.id.toString(),
        p.proposer,
        p.kind,
        p.payee,
        p.amount.toString(),
        p.category,
        JSON.stringify(p.splitMembers),
        p.approvalsRequired,
        p.expiresAt,
        p.status,
        p.createdAt,
      );
  }
  setProposalStatus(pot: Address, id: bigint, status: ProposalStatus) {
    // Executed/cancelled are terminal; don't let a late "approved" overwrite them.
    this.db
      .prepare("UPDATE proposals SET status = ? WHERE pot = ? AND id = ? AND status NOT IN ('executed', 'cancelled')")
      .run(status, pot, id.toString());
  }
  getProposal(pot: Address, id: bigint): ProposalRow | undefined {
    const r = this.db.prepare("SELECT * FROM proposals WHERE pot = ? AND id = ?").get(pot, id.toString()) as Row | undefined;
    return r ? this.#proposal(r) : undefined;
  }
  openProposals(pot?: Address): ProposalRow[] {
    const rows = pot
      ? this.db.prepare("SELECT * FROM proposals WHERE status IN ('pending', 'approved') AND pot = ?").all(pot)
      : this.db.prepare("SELECT * FROM proposals WHERE status IN ('pending', 'approved')").all();
    return (rows as Row[]).map((r) => this.#proposal(r));
  }
  #proposal(r: Row): ProposalRow {
    return {
      pot: a(r.pot),
      id: BigInt(String(r.id)),
      proposer: a(r.proposer),
      kind: Number(r.kind),
      payee: a(r.payee),
      amount: BigInt(String(r.amount)),
      category: Number(r.category),
      splitMembers: (JSON.parse(String(r.split_members)) as string[]).map(a),
      approvalsRequired: Number(r.approvals_required),
      expiresAt: Number(r.expires_at),
      status: String(r.status) as ProposalStatus,
      createdAt: Number(r.created_at),
    };
  }
  addVote(pot: Address, id: bigint, member: Address, approve: boolean) {
    this.db.prepare("INSERT OR REPLACE INTO votes(pot, id, member, approve) VALUES(?, ?, ?, ?)").run(pot, id.toString(), member, approve ? 1 : 0);
  }
  voters(pot: Address, id: bigint): Address[] {
    return (this.db.prepare("SELECT member FROM votes WHERE pot = ? AND id = ?").all(pot, id.toString()) as Row[]).map((r) => a(r.member));
  }

  // ───── claims ─────
  insertClaim(c: { id: bigint; source: Address; claimSigner: Address; amount: bigint; sourceSpendId: bigint }) {
    this.db
      .prepare("INSERT OR REPLACE INTO claims(id, source, claim_signer, amount, source_spend_id) VALUES(?, ?, ?, ?, ?)")
      .run(c.id.toString(), c.source, c.claimSigner, c.amount.toString(), c.sourceSpendId.toString());
  }
  getClaim(id: bigint) {
    const r = this.db.prepare("SELECT * FROM claims WHERE id = ?").get(id.toString()) as Row | undefined;
    return r
      ? { id, source: a(r.source), claimSigner: a(r.claim_signer), amount: BigInt(String(r.amount)), sourceSpendId: BigInt(String(r.source_spend_id)) }
      : undefined;
  }

  // ───── push tokens ─────
  addPushToken(address: Address, token: string) {
    this.db
      .prepare("INSERT INTO push_tokens(address, token, updated_at) VALUES(?, ?, ?) ON CONFLICT(address, token) DO UPDATE SET updated_at = excluded.updated_at")
      .run(address, token, Math.floor(Date.now() / 1000));
    // A token belongs to one device/account at a time: drop it from other addresses.
    this.db.prepare("DELETE FROM push_tokens WHERE token = ? AND address != ?").run(token, address);
    // Cap tokens per address (phones get reinstalled).
    this.db
      .prepare(
        "DELETE FROM push_tokens WHERE address = ? AND token NOT IN (SELECT token FROM push_tokens WHERE address = ? ORDER BY updated_at DESC LIMIT 5)",
      )
      .run(address, address);
  }
  removePushToken(token: string) {
    this.db.prepare("DELETE FROM push_tokens WHERE token = ?").run(token);
  }
  pushTokens(addresses: Address[]): { address: Address; token: string }[] {
    if (!addresses.length) return [];
    const q = `SELECT address, token FROM push_tokens WHERE address IN (${addresses.map(() => "?").join(",")})`;
    return (this.db.prepare(q).all(...addresses) as Row[]).map((r) => ({ address: a(r.address), token: String(r.token) }));
  }

  // ───── daily counters ─────
  /** Atomically consume one unit of a per-UTC-day quota. Returns false if the limit is reached. */
  takeDaily(key: string, limit: number, now = Date.now()): boolean {
    const day = Math.floor(now / 86_400_000);
    const r = this.db.prepare("SELECT day, count FROM counters WHERE key = ?").get(key) as Row | undefined;
    const count = r && Number(r.day) === day ? Number(r.count) : 0;
    if (count >= limit) return false;
    this.db
      .prepare("INSERT INTO counters(key, day, count) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET day = excluded.day, count = excluded.count")
      .run(key, day, count + 1);
    return true;
  }
  /** Give a unit back (e.g. when the action failed before doing anything). */
  refundDaily(key: string, now = Date.now()) {
    const day = Math.floor(now / 86_400_000);
    this.db.prepare("UPDATE counters SET count = MAX(count - 1, 0) WHERE key = ? AND day = ?").run(key, day);
  }

  // ───── demo runs ─────
  insertDemoRun(r: Omit<DemoRunRow, "updatedAt" | "lastError" | "step">) {
    this.db
      .prepare(
        "INSERT INTO demo_runs(pot, judge, invite_secret, stage, step, created_at, updated_at, end_time, meta) VALUES(?, ?, ?, ?, 0, ?, ?, ?, ?)",
      )
      .run(r.pot, r.judge, r.inviteSecret, r.stage, r.createdAt, r.createdAt, r.endTime, r.meta);
  }
  updateDemoRun(pot: Address, patch: { stage?: string; step?: number; lastError?: string | null }) {
    const cur = this.getDemoRun(pot);
    if (!cur) return;
    this.db
      .prepare("UPDATE demo_runs SET stage = ?, step = ?, last_error = ?, updated_at = ? WHERE pot = ?")
      .run(
        patch.stage ?? cur.stage,
        patch.step ?? cur.step,
        patch.lastError === undefined ? cur.lastError : patch.lastError,
        Math.floor(Date.now() / 1000),
        pot,
      );
  }
  getDemoRun(pot: Address): DemoRunRow | undefined {
    const r = this.db.prepare("SELECT * FROM demo_runs WHERE pot = ?").get(pot) as Row | undefined;
    return r ? this.#demo(r) : undefined;
  }
  demoRuns(activeOnly = false): DemoRunRow[] {
    const sql = activeOnly ? "SELECT * FROM demo_runs WHERE stage NOT IN ('done', 'failed', 'abandoned') ORDER BY created_at" : "SELECT * FROM demo_runs ORDER BY created_at";
    return (this.db.prepare(sql).all() as Row[]).map((r) => this.#demo(r));
  }
  #demo(r: Row): DemoRunRow {
    return {
      pot: a(r.pot),
      judge: a(r.judge),
      inviteSecret: String(r.invite_secret),
      stage: String(r.stage),
      step: Number(r.step),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      endTime: Number(r.end_time),
      lastError: r.last_error === null ? null : String(r.last_error),
      meta: r.meta === null ? null : String(r.meta),
    };
  }
}
