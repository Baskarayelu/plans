/** /v1/health, /v1/config, /v1/fx, /v1/blobs, /v1/tx, request validation, target allowlist, limits. */
import { createHash, randomBytes } from "node:crypto";
import { getAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID } from "../lib/env";
import { plainEnglish } from "../lib/harness";
import { build, codeToBytes, jsonStringify, potParams, randomHex32, USD } from "../lib/plans";
import type { T } from "./types";

export async function httpScenarios({ R, env, A }: T) {
  R.group = "http";
  const api = env.api;
  let laneSigner: Address | undefined;

  await R.run("GET /v1/health", "http", "200, ok, chain 143, contracts and 3 lanes", async (s) => {
    const r = await api.get("/v1/health");
    s.eq(r.status, 200, "status");
    s.eq(r.body.ok, true, "ok");
    s.eq(r.body.chainId, CHAIN_ID, "chainId");
    s.eq(getAddress(r.body.contracts.factory), env.dep.plansFactory, "factory");
    s.eq(getAddress(r.body.contracts.claimEscrow), env.dep.claimEscrow, "claimEscrow");
    s.eq(getAddress(r.body.contracts.keyRegistry), env.dep.keyRegistry, "keyRegistry");
    s.eq(r.body.lanes.length, 3, "lanes");
    s.expect(r.body.listener?.caughtUp === true, "listener caught up");
    s.eq(r.body.faucet.enabled, false, "faucet off on 143");
    s.eq(r.body.demo.enabled, true, "demo on");
    laneSigner = getAddress(r.body.lanes[0].address);
    s.actual = `200 ok, block ${r.body.block}, sendRawTransactionSync=${r.body.sendRawTransactionSync}, ${r.clientMs} ms`;
  });

  await R.run("GET /v1/config", "http", '200 {"chainId":143,"graphqlUrl":null}', async (s) => {
    const r = await api.get("/v1/config");
    s.eq(r.status, 200, "status");
    s.eq(r.body, { chainId: CHAIN_ID, graphqlUrl: null }, "body");
    s.expect(/max-age=60/.test(r.headers.get("cache-control") ?? ""), "cache-control");
    s.actual = `200 ${JSON.stringify(r.body)}`;
  });

  await R.run("GET /v1/fx GBP->USD is signed by lane 0", "http", "rateE8 127000000, EIP-191 signature recovers to lane 0", async (s) => {
    const r = await api.get("/v1/fx?from=GBP&to=USD");
    s.eq(r.status, 200, "status");
    s.eq(r.body.rateE8, "127000000", "rateE8");
    s.eq(r.body.date, "2026-10-06", "date");
    const signer = await recoverMessageAddress({ message: r.body.message, signature: r.body.signature });
    s.eq(signer, getAddress(r.body.signer), "recovered signer");
    s.eq(signer, laneSigner, "signer is lane 0 from /v1/health");
    s.expect(r.body.message.includes("Pair: GBP/USD") && r.body.message.includes("RateE8: 127000000"), "message format");
    s.actual = `200 rate ${r.body.rate}, signer = lane 0, ${r.clientMs} ms`;
  });

  await R.run("GET /v1/fx AUSD is treated as USD", "http", "USD->AUSD rate 1", async (s) => {
    const r = await api.get("/v1/fx?from=USD&to=AUSD");
    s.eq(r.status, 200, "status");
    s.eq(r.body.rateE8, "100000000", "rateE8");
    s.actual = "200 rate 1";
  });

  await R.run("GET /v1/fx unsupported currency", "failure", "400 UNSUPPORTED_CURRENCY", async (s) => {
    const r = await api.get("/v1/fx?from=GBP&to=XYZ");
    s.eq([r.status, r.body.error?.code], [400, "UNSUPPORTED_CURRENCY"], "status/code");
    plainEnglish(s, r.body.error?.message);
    const r2 = await api.get("/v1/fx?from=QQQ&to=USD");
    s.eq([r2.status, r2.body.error?.code], [400, "UNSUPPORTED_CURRENCY"], "unknown base");
    const r3 = await api.get("/v1/fx?from=G1&to=USD");
    s.eq([r3.status, r3.body.error?.code], [400, "INVALID_PARAMS"], "malformed code");
    s.actual = `400 ${r.body.error.code}: "${r.body.error.message}"; malformed -> 400 INVALID_PARAMS`;
  });

  // ───── blobs ─────
  const blob = new Uint8Array(randomBytes(4096));
  const sha = createHash("sha256").update(blob).digest("hex");

  await R.run("PUT /v1/blobs (octet-stream) then re-PUT", "http", "201 created, then 200 created:false", async (s) => {
    const r = await api.req("PUT", `/v1/blobs/${sha}`, { body: blob, headers: { "content-type": "application/octet-stream" } });
    s.eq([r.status, (r.body as any).created, (r.body as any).size], [201, true, 4096], "first put");
    const r2 = await api.req("PUT", `/v1/blobs/0x${sha}`, { body: blob, headers: { "content-type": "application/octet-stream" } });
    s.eq([r2.status, (r2.body as any).created], [200, false], "re-put");
    s.actual = "201 then 200 created:false";
  });

  await R.run("PUT /v1/blobs (JSON base64url)", "http", "201", async (s) => {
    const b = new Uint8Array(randomBytes(300));
    const h = createHash("sha256").update(b).digest("hex");
    const r = await api.req("PUT", `/v1/blobs/${h}`, { body: JSON.stringify({ data: Buffer.from(b).toString("base64url") }), headers: { "content-type": "application/json" } });
    s.eq(r.status, 201, "status");
    s.actual = "201";
  });

  await R.run("GET /v1/blobs (JSON, raw, If-None-Match)", "http", "same bytes both ways, 304 on matching ETag", async (s) => {
    const j = await api.get(`/v1/blobs/${sha}`, { accept: "application/json" });
    s.eq(j.status, 200, "json status");
    s.eq(Buffer.from(j.body.data, "base64url").toString("hex"), Buffer.from(blob).toString("hex"), "json bytes");
    s.expect(/immutable/.test(j.headers.get("cache-control") ?? ""), "immutable cache");
    const raw = await api.get(`/v1/blobs/${sha}`, { accept: "application/octet-stream" });
    s.eq(raw.status, 200, "raw status");
    s.eq(Buffer.from(raw.body as Uint8Array).toString("hex"), Buffer.from(blob).toString("hex"), "raw bytes");
    s.expect(raw.headers.get("etag") !== j.headers.get("etag"), "ETag differs by representation");
    const nm = await api.get(`/v1/blobs/${sha}`, { accept: "application/octet-stream", "if-none-match": raw.headers.get("etag")! });
    s.eq(nm.status, 304, "If-None-Match");
    s.actual = "200 json + 200 raw (same bytes), 304";
  });

  await R.run("PUT /v1/blobs hash mismatch", "failure", "400 HASH_MISMATCH, nothing stored", async (s) => {
    const other = createHash("sha256").update("not the body").digest("hex");
    const r = await api.req("PUT", `/v1/blobs/${other}`, { body: blob, headers: { "content-type": "application/octet-stream" } });
    s.eq([r.status, (r.body as any).error?.code], [400, "HASH_MISMATCH"], "status/code");
    plainEnglish(s, (r.body as any).error?.message);
    const g = await api.get(`/v1/blobs/${other}`);
    s.eq(g.status, 404, "not stored");
    s.actual = `400 HASH_MISMATCH: "${(r.body as any).error.message}"; GET -> 404`;
  });

  await R.run("PUT /v1/blobs bad requests", "failure", "415 wrong type, 400 INVALID_HASH, 400 INVALID_BASE64, 400 EMPTY_BODY, 404 unknown", async (s) => {
    const ct = await api.req("PUT", `/v1/blobs/${sha}`, { body: "x", headers: { "content-type": "text/plain" } });
    s.eq([ct.status, (ct.body as any).error?.code], [415, "UNSUPPORTED_MEDIA_TYPE"], "content type");
    const bh = await api.req("PUT", `/v1/blobs/xyz`, { body: blob, headers: { "content-type": "application/octet-stream" } });
    s.eq([bh.status, (bh.body as any).error?.code], [400, "INVALID_HASH"], "bad hash");
    const b64 = await api.req("PUT", `/v1/blobs/${sha}`, { body: JSON.stringify({ data: "!!!" }), headers: { "content-type": "application/json" } });
    s.eq([b64.status, (b64.body as any).error?.code], [400, "INVALID_BASE64"], "bad base64");
    const empty = createHash("sha256").update(new Uint8Array()).digest("hex");
    const eb = await api.req("PUT", `/v1/blobs/${empty}`, { body: new Uint8Array(), headers: { "content-type": "application/octet-stream" } });
    s.eq([eb.status, (eb.body as any).error?.code], [400, "EMPTY_BODY"], "empty");
    const unk = await api.get(`/v1/blobs/${"ab".repeat(32)}`);
    s.eq([unk.status, unk.body.error?.code], [404, "NOT_FOUND"], "unknown");
    s.actual = "415, 400 INVALID_HASH, 400 INVALID_BASE64, 400 EMPTY_BODY, 404";
  });

  await R.run("PUT /v1/blobs over 2 MB", "failure", "413 BLOB_TOO_LARGE", async (s) => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    const h = createHash("sha256").update(big).digest("hex");
    const r = await api.req("PUT", `/v1/blobs/${h}`, { body: big, headers: { "content-type": "application/octet-stream" } });
    s.eq([r.status, (r.body as any).error?.code], [413, "BLOB_TOO_LARGE"], "status/code");
    s.actual = `413 ${(r.body as any).error.code}`;
  });

  // ───── /v1/tx and request validation ─────
  await R.run("GET /v1/tx unknown and malformed hash", "failure", "404 NOT_FOUND, 400 INVALID_HASH", async (s) => {
    const r = await api.get(`/v1/tx/0x${"11".repeat(32)}`);
    s.eq([r.status, r.body.error?.code], [404, "NOT_FOUND"], "unknown");
    const m = await api.get(`/v1/tx/0x1234`);
    s.eq([m.status, m.body.error?.code], [400, "INVALID_HASH"], "malformed");
    s.actual = "404 NOT_FOUND, 400 INVALID_HASH";
  });

  await R.run("POST /v1/relay invalid JSON / unknown action / bad params", "failure", "400 INVALID_JSON, 400 INVALID_PARAMS with issue paths", async (s) => {
    const j = await api.req("POST", "/v1/relay", { body: "{nope", headers: { "content-type": "application/json" } });
    s.eq([j.status, (j.body as any).error?.code], [400, "INVALID_JSON"], "invalid json");
    const u = await api.relay("mint", {});
    s.eq([u.status, u.body.error?.code], [400, "INVALID_PARAMS"], "unknown action");
    const p = await api.relay("vote", { pot: "0x1234", member: env.dep.plansFactory, id: "x", approve: "yes", nonce: 1, deadline: 1, sig: "0x" });
    s.eq([p.status, p.body.error?.code], [400, "INVALID_PARAMS"], "bad params");
    const paths = ((p.body.error?.issues as { path: string }[]) ?? []).map((i) => i.path);
    for (const want of ["params.pot", "params.id", "params.approve", "params.sig"]) s.expect(paths.includes(want), `issue for ${want} (got ${paths.join(", ")})`);
    const cat = await api.relay("propose", { pot: env.dep.plansFactory, proposer: A.alice.address, kind: "PAY", payee: A.shop, amount: "1", category: 9, split: { members: [A.alice.address, A.alice.address], weights: [1, 0] }, nonce: 1, deadline: 9e12, sig: "0x01" });
    const cpaths = ((cat.body.error?.issues as { path: string; message: string }[]) ?? []).map((i) => `${i.path}: ${i.message}`).join("; ");
    s.expect(cat.status === 400 && /category/.test(cpaths) && /duplicate/.test(cpaths) && /weights/.test(cpaths), `propose pre-validation (got ${cpaths})`);
    s.actual = `400 INVALID_JSON; 400 INVALID_PARAMS (${paths.length} issues); category/duplicate/zero-weight caught before the chain`;
  });

  await R.run("relayer target allowlist rejects non-Plans contracts", "failure", "403 TARGET_NOT_ALLOWED for AUSD, an EOA and the Pot implementation", async (s) => {
    const params = async (pot: Address) => build.vote(env.ctx, pot, A.alice, 1n, true);
    const r = await s.rejects(async () => api.relay("vote", await params(env.dep.ausd)), { status: 403, code: "TARGET_NOT_ALLOWED" }, env.dep.ausd);
    await s.rejects(async () => api.relay("settle", { pot: A.stranger }), { status: 403, code: "TARGET_NOT_ALLOWED" });
    await s.rejects(async () => api.relay("settle", { pot: env.dep.potImplementation }), { status: 403, code: "TARGET_NOT_ALLOWED" }, env.dep.potImplementation);
    await s.rejects(async () => api.relay("execute", { pot: env.dep.plansFactory, id: 1 }), { status: 403, code: "TARGET_NOT_ALLOWED" }, env.dep.plansFactory);
    s.actual = `403 TARGET_NOT_ALLOWED x4: "${r.body.error!.message}"`;
  });

  await R.run("POST /v1/faucet on mainnet", "failure", "404 FAUCET_DISABLED", async (s) => {
    const r = await api.postJson("/v1/faucet", { address: A.frank.address });
    s.eq([r.status, r.body.error?.code], [404, "FAUCET_DISABLED"], "status/code");
    s.actual = "404 FAUCET_DISABLED";
  });

  await R.run("unknown endpoint", "failure", "404 NOT_FOUND JSON", async (s) => {
    const r = await api.get("/v1/nope");
    s.eq([r.status, r.body.error?.code], [404, "NOT_FOUND"], "status/code");
    s.actual = "404 NOT_FOUND";
  });
}

/** Production limits on the second relayer (default env): body size, per-IP, per-address and createPot quotas. */
export async function strictLimitScenarios({ R, env, A }: T) {
  R.group = "limits";
  const api = env.strict;
  const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  await R.run("oversized /v1/relay body (default 64 KB limit)", "failure", "413 BODY_TOO_LARGE", async (s) => {
    const body = jsonStringify({ action: "settle", params: { pot: A.stranger, pad: "a".repeat(70 * 1024) } });
    const r = await api.req("POST", "/v1/relay", { body, headers: { "content-type": "application/json", "x-forwarded-for": ip() } });
    s.eq([r.status, (r.body as any).error?.code], [413, "BODY_TOO_LARGE"], "status/code");
    s.actual = `413 BODY_TOO_LARGE: "${(r.body as any).error.message}"`;
  });

  await R.run("per-IP rate limit (120 POST/min)", "failure", "121st POST from one IP -> 429 RATE_LIMITED with retry-after", async (s) => {
    const me = ip();
    let firstLimited = -1;
    let retryAfter: string | null = null;
    for (let i = 1; i <= 125 && firstLimited < 0; i++) {
      const r = await api.req("POST", "/v1/relay", { body: "{}", headers: { "content-type": "application/json", "x-forwarded-for": me } });
      if (r.status === 429) {
        firstLimited = i;
        retryAfter = r.headers.get("retry-after");
        s.eq((r.body as any).error?.code, "RATE_LIMITED", "code");
      }
    }
    s.eq(firstLimited, 121, "first limited request");
    s.expect(retryAfter && Number(retryAfter) >= 1, "retry-after header");
    const other = await api.req("POST", "/v1/relay", { body: "{}", headers: { "content-type": "application/json", "x-forwarded-for": ip() } });
    s.eq(other.status, 400, "another IP is unaffected");
    s.actual = `request #${firstLimited} -> 429, retry-after ${retryAfter}s; other IP unaffected`;
  });

  await R.run("per-address rate limit (30 relays/min per signer)", "failure", "31st relay for one account -> 429 RATE_LIMITED", async (s) => {
    const who = privateKeyToAccount(generatePrivateKey());
    let firstLimited = -1;
    for (let i = 1; i <= 35 && firstLimited < 0; i++) {
      const p = await build.vote(env.ctx, A.stranger, who, 1n, true);
      const r = await api.relay("vote", p, { ip: ip() });
      if (r.status === 429) {
        firstLimited = i;
        s.eq(r.body.error?.code, "RATE_LIMITED", "code");
      } else s.eq(r.status, 403, `request ${i} reaches the allowlist`);
    }
    s.eq(firstLimited, 31, "first limited request");
    s.actual = `request #${firstLimited} for one signer -> 429 RATE_LIMITED`;
  });

  await R.run("createPot quota (30 per IP per day)", "failure", "failed createPots don't count; the 31st successful createPot from one IP -> 429", async (s) => {
    const me = ip();
    // 1. Requests that can never land (signed by someone else) are rejected and give their quota slot back.
    const block0 = await env.anvil.pub.getBlockNumber();
    for (let i = 1; i <= 35; i++) {
      const creator = privateKeyToAccount(generatePrivateKey());
      const params = await potParams(env.ctx, A.stranger);
      const b = await build.createPot(env.ctx, creator, params, { signer: A.frank });
      const r = await api.relay("createPot", b.params, { ip: me });
      s.eq([r.status, r.body.error?.code], [422, "INVALID_SIGNATURE"], `invalid request ${i}`);
    }
    s.eq(await env.anvil.pub.getBlockNumber(), block0, "no transaction sent for invalid requests");
    // 2. Valid createPots use the quota: 30 land, the 31st is limited.
    let firstLimited = -1;
    for (let i = 1; i <= 32 && firstLimited < 0; i++) {
      const creator = privateKeyToAccount(generatePrivateKey());
      const params = await potParams(env.ctx, A.stranger);
      const b = await build.createPot(env.ctx, creator, params);
      const r = await api.relay("createPot", b.params, { ip: me });
      if (r.status === 429) firstLimited = i;
      else s.eq(r.status, 200, `valid request ${i}`);
    }
    s.eq(firstLimited, 31, "first limited createPot");
    s.actual = `35 invalid createPots rejected without using the quota; valid createPot #${firstLimited} from one IP -> 429`;
  });

  await R.run("demo endpoints when the demo is off", "failure", "accounts enabled:false, try-settle-up 404 DEMO_DISABLED", async (s) => {
    const a = await api.get("/v1/demo/accounts");
    s.eq(a.body.enabled, false, "enabled");
    const r = await api.postJson("/v1/demo/try-settle-up", { member: A.judge.address }, { ip: ip() });
    s.eq([r.status, r.body.error?.code], [404, "DEMO_DISABLED"], "status/code");
    s.actual = "enabled:false; 404 DEMO_DISABLED";
  });
}
