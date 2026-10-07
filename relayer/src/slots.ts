/**
 * Keyed "slots": small ciphertext records the app addresses by a 32-byte id it derives itself.
 * Used to link a browser to an account (docs: app/docs/crypto.md §9):
 *
 *   - link offer / reply: write-once, 60–600 s TTL, id = sha256 of a secret only the two devices know
 *   - account vault: permanent, overwritable only by whoever knows `auth` (the server keeps sha256(auth))
 *
 * The server never sees keys; it stores opaque bytes. Unlike the content-addressed blob store,
 * the id is chosen by the client, so writes are guarded: an existing, unexpired slot is
 * overwritten only when it was created with `auth` and the request presents the same `auth`;
 * otherwise 409 SLOT_TAKEN.
 *
 * Files: <dir>/<aa>/<id> (dir defaults to <BLOB_DIR>/slots), JSON
 *   {"v":1,"data":"<base64url>","expiresAt":<unix s>|null,"authHash":"<hex>"|null}
 * written atomically (temp file + rename). All slot I/O is synchronous: records are at most a few
 * KB, and it makes check-then-write atomic within the (single-replica) process, so two racing
 * PUTs to an empty write-once slot can't both win. Expired slots are deleted lazily on read or
 * write, and by `sweep()` (run hourly by the server).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RelayError } from "./errors.js";

export const SLOT_ID_RE = /^[0-9a-f]{64}$/;
export const SLOT_MAX_BYTES = 8192;
export const SLOT_TTL_MIN = 60;
export const SLOT_TTL_MAX = 600;

export function normaliseSlotId(id: string): string {
  const x = id.toLowerCase();
  if (!SLOT_ID_RE.test(x)) throw new RelayError(400, "INVALID_SLOT_ID", "The slot id must be 64 hex characters.");
  return x;
}

export interface SlotOptions {
  dir: string;
  /** Decoded data limit per slot (default 8192). */
  maxBytes?: number;
  /** Shared disk cap (the blob store's); slots and blobs together stay under it. */
  diskCapBytes: number;
  /** Bytes used by other stores sharing the cap (the blob store). */
  otherUsedBytes?: () => number;
  /** Clock in ms (tests). */
  now?: () => number;
}

type SlotFile = { v: 1; data: string; expiresAt: number | null; authHash: string | null };

export type PutSlotOptions = { ttl?: number; auth?: string };

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest();

export class SlotStore {
  #used = 0;

  constructor(readonly opts: SlotOptions) {
    mkdirSync(opts.dir, { recursive: true });
    this.#used = SlotStore.#scan(opts.dir);
  }

  static #scan(dir: string): number {
    let total = 0;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) total += SlotStore.#scan(p);
      else if (SLOT_ID_RE.test(name)) total += st.size;
    }
    return total;
  }

  get usedBytes() {
    return this.#used;
  }

  get maxBytes() {
    return this.opts.maxBytes ?? SLOT_MAX_BYTES;
  }

  #nowSec() {
    return Math.floor((this.opts.now?.() ?? Date.now()) / 1000);
  }

  pathFor(id: string) {
    return join(this.opts.dir, id.slice(0, 2), id);
  }

  #read(path: string): { rec: SlotFile; size: number } | undefined {
    let raw: Buffer;
    try {
      raw = readFileSync(path);
    } catch {
      return undefined;
    }
    try {
      const rec = JSON.parse(raw.toString("utf8")) as SlotFile;
      if (rec?.v !== 1 || typeof rec.data !== "string") return undefined;
      return { rec, size: raw.byteLength };
    } catch {
      return undefined;
    }
  }

  #delete(path: string, size: number) {
    try {
      unlinkSync(path);
      this.#used = Math.max(0, this.#used - size);
    } catch {
      /* already gone */
    }
  }

  #expired(rec: SlotFile) {
    return rec.expiresAt !== null && rec.expiresAt <= this.#nowSec();
  }

  /** Reads a slot; expired slots are deleted and reported missing. */
  get(idIn: string): { data: Uint8Array; expiresAt: number | null } | undefined {
    const id = normaliseSlotId(idIn);
    const path = this.pathFor(id);
    const cur = this.#read(path);
    if (!cur) return undefined;
    if (this.#expired(cur.rec)) {
      this.#delete(path, cur.size);
      return undefined;
    }
    return { data: new Uint8Array(Buffer.from(cur.rec.data, "base64url")), expiresAt: cur.rec.expiresAt };
  }

  /**
   * Creates (no slot, or an expired one) → created: true; overwrites an unexpired slot only if it
   * has an auth hash and sha256(auth) matches → created: false; otherwise 409 SLOT_TAKEN.
   */
  put(idIn: string, data: Uint8Array, o: PutSlotOptions = {}): { id: string; created: boolean; expiresAt: number | null } {
    const id = normaliseSlotId(idIn);
    if (data.byteLength === 0) throw new RelayError(400, "EMPTY_BODY", "The slot data is empty.");
    if (data.byteLength > this.maxBytes) throw new RelayError(413, "SLOT_TOO_LARGE", `Slots are limited to ${this.maxBytes} bytes.`);
    if (o.ttl !== undefined && (!Number.isInteger(o.ttl) || o.ttl < SLOT_TTL_MIN || o.ttl > SLOT_TTL_MAX)) {
      throw new RelayError(400, "INVALID_TTL", `ttl must be a whole number of seconds from ${SLOT_TTL_MIN} to ${SLOT_TTL_MAX}.`);
    }
    if (o.auth !== undefined && !/^[0-9a-fA-F]{64}$/.test(o.auth)) throw new RelayError(400, "INVALID_AUTH", "auth must be 64 hex characters.");
    const authHash = o.auth !== undefined ? sha256(Buffer.from(o.auth.toLowerCase(), "hex")) : null;

    const path = this.pathFor(id);
    const cur = this.#read(path);
    let replacedSize = 0;
    let created = true;
    if (cur) {
      if (this.#expired(cur.rec)) {
        replacedSize = cur.size;
      } else {
        const stored = cur.rec.authHash ? Buffer.from(cur.rec.authHash, "hex") : null;
        if (!stored || !authHash || stored.length !== authHash.length || !timingSafeEqual(stored, authHash)) {
          throw new RelayError(409, "SLOT_TAKEN", "This slot is already taken.");
        }
        replacedSize = cur.size;
        created = false;
      }
    }

    const expiresAt = o.ttl !== undefined ? this.#nowSec() + o.ttl : null;
    const rec: SlotFile = { v: 1, data: Buffer.from(data).toString("base64url"), expiresAt, authHash: authHash ? authHash.toString("hex") : null };
    const bytes = Buffer.from(JSON.stringify(rec), "utf8");
    const other = this.opts.otherUsedBytes?.() ?? 0;
    if (other + this.#used - replacedSize + bytes.byteLength > this.opts.diskCapBytes) {
      throw new RelayError(507, "STORAGE_FULL", "Storage is full right now.");
    }
    mkdirSync(join(this.opts.dir, id.slice(0, 2)), { recursive: true });
    const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, bytes, { flag: "wx" });
    renameSync(tmp, path);
    this.#used += bytes.byteLength - replacedSize;
    return { id, created, expiresAt };
  }

  /** Deletes every expired slot; returns how many. */
  sweep(): number {
    let n = 0;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        let st;
        try {
          st = statSync(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(p);
        else if (SLOT_ID_RE.test(name)) {
          const cur = this.#read(p);
          if (cur && this.#expired(cur.rec)) {
            this.#delete(p, cur.size);
            n++;
          }
        }
      }
    };
    walk(this.opts.dir);
    return n;
  }
}
