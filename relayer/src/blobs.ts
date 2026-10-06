/**
 * Content-addressed store for encrypted receipt photos. The server only ever sees ciphertext:
 * the app encrypts with the group key and uploads to PUT /v1/blobs/:sha256 (sha256 of the ciphertext).
 * Files live under <dir>/<aa>/<bb>/<sha256>, written atomically (temp file + rename).
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RelayError } from "./errors.js";

export const SHA256_RE = /^[0-9a-f]{64}$/;

export function normaliseHash(h: string): string {
  const x = h.toLowerCase().replace(/^0x/, "");
  if (!SHA256_RE.test(x)) throw new RelayError(400, "INVALID_HASH", "The blob id must be a sha256 hex digest.");
  return x;
}

export interface BlobOptions {
  dir: string;
  maxBytes: number;
  diskCapBytes: number;
}

export class BlobStore {
  #used = 0;
  #pending = 0; // bytes reserved by uploads in progress

  constructor(readonly opts: BlobOptions) {
    mkdirSync(opts.dir, { recursive: true });
    this.#used = BlobStore.#scan(opts.dir);
  }

  static #scan(dir: string): number {
    let total = 0;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) total += BlobStore.#scan(p);
      else if (SHA256_RE.test(name)) total += st.size;
    }
    return total;
  }

  get usedBytes() {
    return this.#used;
  }

  pathFor(hash: string) {
    return join(this.opts.dir, hash.slice(0, 2), hash.slice(2, 4), hash);
  }

  has(hash: string) {
    return existsSync(this.pathFor(hash));
  }

  /** Store `bytes` under `hashIn` after checking the digest. Idempotent. */
  async put(hashIn: string, bytes: Uint8Array): Promise<{ sha256: string; size: number; created: boolean }> {
    const hash = normaliseHash(hashIn);
    if (bytes.byteLength === 0) throw new RelayError(400, "EMPTY_BODY", "The blob is empty.");
    if (bytes.byteLength > this.opts.maxBytes) {
      throw new RelayError(413, "BLOB_TOO_LARGE", `Blobs are limited to ${this.opts.maxBytes} bytes.`);
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== hash) {
      throw new RelayError(400, "HASH_MISMATCH", "The body's sha256 doesn't match the blob id.", { expected: hash, actual });
    }
    const path = this.pathFor(hash);
    if (existsSync(path)) return { sha256: hash, size: bytes.byteLength, created: false };
    if (this.#used + this.#pending + bytes.byteLength > this.opts.diskCapBytes) {
      throw new RelayError(507, "STORAGE_FULL", "Receipt storage is full right now.");
    }
    this.#pending += bytes.byteLength;
    try {
      mkdirSync(join(this.opts.dir, hash.slice(0, 2), hash.slice(2, 4)), { recursive: true });
      const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(tmp, bytes, { flag: "wx" });
      if (existsSync(path)) {
        await unlink(tmp); // a concurrent upload of the same blob won
        return { sha256: hash, size: bytes.byteLength, created: false };
      }
      await rename(tmp, path);
      this.#used += bytes.byteLength;
      return { sha256: hash, size: bytes.byteLength, created: true };
    } finally {
      this.#pending -= bytes.byteLength;
    }
  }

  async get(hashIn: string): Promise<Uint8Array | undefined> {
    const hash = normaliseHash(hashIn);
    try {
      return new Uint8Array(await readFile(this.pathFor(hash)));
    } catch {
      return undefined;
    }
  }
}
