// Building blocks for flows.mjs: actors (one browser context + one virtual passkey each), the
// indexer watch, transaction marks, results with PASS / FAIL / BLOCKED, and failure screenshots.
//
// An "actor" is one person on one device: its own incognito-like browser context (separate
// localStorage / IndexedDB / cookies), its own page and its own CDP virtual authenticator. The app
// is served on https://plans.0xo.in/app (local export by interception unless live), so passkeys
// (rpId plans.0xo.in) and the relayer's CORS behave as in production.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ORIGIN, addPasskeyAuthenticator, newPage, route, serveLocalApp, sleep } from "./browser.mjs";

export const RELAYER = process.env.PLANS_RELAYER_URL ?? "https://relayer-production-ecef.up.railway.app";
export const BUILD_GRAPHQL = "https://indexer.plans.0xo.in/v1/graphql";
export const RPC = process.env.PLANS_RPC_URL ?? "https://testnet-rpc.monad.xyz";
export const sel = (id) => `[data-testid="${id}"]`;

/** Thrown when a step can't run for a reason outside the app (indexer not live, no UI path…). */
export class Blocked extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

// ─────────────── environment probe ───────────────

/**
 * What the relayer publishes (/v1/config) and whether the GraphQL endpoint the app will use answers.
 * PLANS_GRAPHQL_URL overrides the published URL (served to the app by intercepting /v1/config).
 */
export async function probeEnvironment() {
  const env = { relayer: RELAYER, publishedGraphqlUrl: null, graphqlUrl: null, graphqlOverride: process.env.PLANS_GRAPHQL_URL || null, indexerLive: false, indexerError: null, relayerOk: false };
  try {
    const r = await fetch(`${RELAYER}/v1/config`, { signal: AbortSignal.timeout(8000) });
    const c = await r.json();
    env.relayerOk = r.ok;
    env.chainId = c.chainId;
    env.publishedGraphqlUrl = c.graphqlUrl ?? null;
  } catch (e) {
    env.relayerError = String(e?.message ?? e);
  }
  env.graphqlUrl = env.graphqlOverride ?? env.publishedGraphqlUrl ?? BUILD_GRAPHQL;
  try {
    const r = await fetch(env.graphqlUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "query Probe { __typename }" }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await r.json().catch(() => null);
    env.indexerLive = r.ok && !!body?.data;
    if (!env.indexerLive) env.indexerError = `HTTP ${r.status} ${JSON.stringify(body?.errors ?? body)?.slice(0, 200)}`;
  } catch (e) {
    env.indexerError = String(e?.cause?.code ?? e?.cause?.message ?? e?.message ?? e);
  }
  return env;
}

// ─────────────── actors ───────────────

/**
 * A new person on a new device. opts: { label, width, live, appDir, graphqlUrl, theme }.
 * Returns { label, ctx, page, auth, indexer: { failures, ok }, close() }.
 */
export async function newActor(browser, opts) {
  const { label, width = 390, live = false, appDir, graphqlUrl = process.env.PLANS_GRAPHQL_URL } = opts;
  const ctx = await browser.createBrowserContext();
  const mobile = width < 700;
  const page = await newPage(ctx, { width, height: mobile ? 844 : 900, theme: opts.theme ?? "light", mobile });
  const actor = { label, ctx, page, width, indexer: { failures: [], ok: 0, errors: [] } };
  if (!live) await serveLocalApp(page, appDir);
  if (graphqlUrl) await overrideGraphqlUrl(page, graphqlUrl);
  watchIndexer(actor);
  collectMarks(actor);
  watchRelayer(actor);
  await captureClipboard(page);
  actor.auth = await addPasskeyAuthenticator(page);
  actor.close = () => ctx.close().catch(() => undefined);
  return actor;
}

/** Answers the relayer's GET /v1/config with this GraphQL URL (no rebuild needed to try an indexer). */
export async function overrideGraphqlUrl(page, graphqlUrl) {
  const cors = { "access-control-allow-origin": ORIGIN, "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS", vary: "origin" };
  await route(page, (req, url) => {
    if (url.origin !== new URL(RELAYER).origin || url.pathname !== "/v1/config") return undefined;
    if (req.method() === "OPTIONS") return { status: 204, headers: cors, body: "" };
    return { status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ chainId: 10143, graphqlUrl }) };
  });
}

/** Records GraphQL request failures (DNS, HTTP errors, GraphQL errors) the page sees. */
function watchIndexer(actor) {
  const isGql = (u) => /\/graphql(\?|$)/.test(u) || u.startsWith(BUILD_GRAPHQL);
  actor.page.on("requestfailed", (req) => {
    if (!isGql(req.url())) return;
    // a failed CORS preflight (OPTIONS) means the POST never goes out: count it too
    actor.indexer.failures.push({ url: req.url(), method: req.method(), error: req.failure()?.errorText ?? "failed", at: Date.now() });
  });
  actor.page.on("response", async (res) => {
    const req = res.request();
    if (!isGql(res.url()) || req.method() !== "POST") return;
    if (res.status() >= 400) {
      actor.indexer.failures.push({ url: res.url(), error: `HTTP ${res.status()}`, at: Date.now() });
      return;
    }
    try {
      const body = await res.json();
      if (body?.errors?.length) actor.indexer.errors.push({ url: res.url(), error: body.errors[0]?.message, at: Date.now() });
      else actor.indexer.ok++;
    } catch {
      /* body not available */
    }
  });
}

/** Records the relayer's error answers (status, code, message) per endpoint, e.g. faucet limits. */
function watchRelayer(actor) {
  actor.relayErrors = [];
  actor.page.on("response", async (res) => {
    if (!res.url().startsWith(RELAYER) || res.request().method() === "OPTIONS" || res.status() < 400) return;
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* no body */
    }
    actor.relayErrors.push({ path: new URL(res.url()).pathname, status: res.status(), code: body?.error?.code ?? null, message: body?.error?.message ?? null, at: Date.now() });
  });
}

export function indexerDown(actor) {
  return actor.indexer.failures.length > 0 && actor.indexer.ok === 0;
}

export function indexerSummary(actor) {
  const f = actor.indexer.failures[actor.indexer.failures.length - 1] ?? actor.indexer.errors[actor.indexer.errors.length - 1];
  return f ? `${f.url} → ${f.error} (${actor.indexer.failures.length} failed, ${actor.indexer.ok} ok)` : "no GraphQL request seen";
}

// ─────────────── waiting ───────────────

/** Visible element with this testID right now? */
export async function isVisible(page, id) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  }, sel(id));
}

/**
 * Waits until one of `ids` (testIDs) or `texts` (substrings / RegExp sources of document text) shows.
 * Returns the id, or "text:<t>" for a text match.
 */
export async function waitAny(page, { ids = [], texts = [], timeout = 30000 } = {}) {
  const h = await page.waitForFunction(
    (ids, texts) => {
      for (const id of ids) {
        for (const el of document.querySelectorAll(`[data-testid="${id}"]`)) {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          if (r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none") return id;
        }
      }
      const body = document.body?.innerText ?? "";
      for (const t of texts) if (new RegExp(t).test(body)) return `text:${t}`;
      return false;
    },
    { timeout, polling: 150 },
    ids,
    texts.map((t) => (t instanceof RegExp ? t.source : t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
  );
  return h.jsonValue();
}

export async function textOf(page, id) {
  return page.$eval(sel(id), (el) => el.innerText.trim()).catch(() => null);
}

/** Clicks a testID; with `last`, the last visible match (e.g. a sheet's button over a screen's). */
export async function click(page, id, { timeout = 30000 } = {}) {
  await page.waitForSelector(sel(id), { visible: true, timeout });
  await sleep(150); // a just-mounted screen can re-render under the pointer
  const ok = await page.evaluate((s) => {
    const els = [...document.querySelectorAll(s)].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    });
    const el = els[els.length - 1];
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    return true;
  }, sel(id));
  if (!ok) throw new Error(`${id} not visible`);
  const els = await page.$$(sel(id));
  for (let i = els.length - 1; i >= 0; i--) {
    const box = await els[i].boundingBox();
    if (box && box.width > 0) {
      await els[i].click();
      return;
    }
  }
  throw new Error(`${id} has no box`);
}

/** Clicks the first visible element whose text is exactly `text` (or matches a RegExp). */
export async function clickText(page, text, { timeout = 15000 } = {}) {
  const src = text instanceof RegExp ? text.source : `^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
  const h = await page.waitForFunction(
    (src) => {
      const re = new RegExp(src);
      const all = [...document.querySelectorAll("body *")].filter((el) => {
        if (!re.test((el.innerText ?? "").trim())) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      // the innermost match
      return all.find((el) => ![...el.children].some((c) => all.includes(c))) ?? false;
    },
    { timeout, polling: 150 },
    src,
  );
  await h.asElement().click();
}

// ─────────────── PLANS_TIMING marks (app/src/lib/timing.ts) ───────────────
//
// window.__plansTiming is lost on every reload, so each actor also collects the marks from the
// console ("PLANS_TIMING {json}") into actor.marks, which survives reloads and navigation.

function collectMarks(actor) {
  actor.marks = [];
  actor.page.on("console", (m) => {
    const t = m.text();
    if (!t.startsWith("PLANS_TIMING {")) return;
    try {
      actor.marks.push(JSON.parse(t.slice("PLANS_TIMING ".length)));
    } catch {
      /* not JSON */
    }
  });
}

const isTx = (m) => m.event === "relay_ok" || m.event === "faucet_ok";

/** Relayed / faucet transactions confirmed for this actor (relay_ok, faucet_ok), in order. */
export function txMarks(actor) {
  return actor.marks.filter(isTx);
}

/** The number of tx marks so far (pass as `since` to waitTx). */
export function txCount(actor) {
  return txMarks(actor).length;
}

/**
 * Waits for a relay_ok mark with this action (or faucet_ok when action = "faucet") after the
 * first `since` tx marks. `orElse()` may return a truthy value to stop waiting early (e.g. an error
 * banner showed); that value is thrown as an Error. Resolves with the mark.
 */
export async function waitTx(actor, action, { since = 0, timeout = 90000, orElse } = {}) {
  const end = Date.now() + timeout;
  const actions = [].concat(action);
  for (;;) {
    const m = txMarks(actor)
      .slice(since)
      .find((m) => actions.some((a) => (a === "faucet" ? m.event === "faucet_ok" : m.event === "relay_ok" && m.action === a)));
    if (m) return m;
    if (orElse) {
      const why = await orElse(); // may throw (e.g. Blocked) to stop waiting
      if (why) throw new Error(`waiting for ${actions.join("/")}: ${why}`);
    }
    if (Date.now() > end) throw new Error(`no ${actions.join("/")} transaction within ${timeout / 1000} s`);
    await sleep(300);
  }
}

/** Text of the first visible error banner on the page, if any. */
export async function errorBanner(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-testid^="banner-"][data-testid$="-error"], [data-testid="banner-action-error"], [data-testid="demo-error"], [data-testid="unlock-message"]')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return `${el.getAttribute("data-testid")}: ${el.innerText.replace(/\s+/g, " ").trim().slice(0, 200)}`;
    }
    return null;
  }).catch(() => null);
}

// ─────────────── clipboard / share capture ───────────────

/** Records what the app copies or shares (window.__plansClip), so links can be read back. */
async function captureClipboard(page) {
  await page.evaluateOnNewDocument(() => {
    window.__plansClip = [];
    const rec = (t) => window.__plansClip.push(String(t ?? ""));
    try {
      const c = navigator.clipboard;
      if (c) {
        const w = c.writeText?.bind(c);
        c.writeText = async (t) => {
          rec(t);
          try {
            await w?.(t);
          } catch {
            /* headless: no clipboard permission */
          }
        };
      }
      navigator.share = async (d) => rec(d?.url ?? d?.text ?? "");
      navigator.canShare = () => true;
    } catch {
      /* ignore */
    }
  });
}

/** The last link the app copied or shared that matches `re`. */
export async function lastClip(page, re = /https?:\/\//) {
  const all = await page.evaluate(() => (window.__plansClip ?? []).slice()).catch(() => []);
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i].match(re instanceof RegExp ? re : new RegExp(re));
    if (m) return all[i].match(/https?:\/\/\S+/)?.[0] ?? all[i];
  }
  return null;
}

/** https://plans.0xo.in/j/… → https://plans.0xo.in/app/j/… (where the web app opens links). */
export function webAppLink(url) {
  const u = new URL(url);
  if (!u.pathname.startsWith("/app/")) u.pathname = "/app" + u.pathname;
  return u.toString();
}

// ─────────────── chain reads (node side) ───────────────

/** AUSD balance (6 decimals) of an address, read with eth_call. */
export async function ausdBalanceOf(token, address) {
  const data = "0x70a08231" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: token, data }, "latest"] }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return BigInt(j.result);
}

export async function txReceipt(hash) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
  });
  return (await r.json()).result;
}

// ─────────────── results ───────────────

/** Resolves with fn()'s value, or `fallback` after `ms` (cleanup must never hang a run). */
export function within(ms, p, fallback = undefined) {
  return Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

export function runDir(base) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
  const dir = join(base, stamp);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Runs one flow. `fn(t)` gets a toolkit: t.actor(label) makes a new actor (closed afterwards),
 * t.step(text), t.note(text), t.tx(actor, mark), t.blocked(reason, text), t.data (free-form).
 * Status: PASS when fn returns; BLOCKED when it throws Blocked; FAIL otherwise (screenshots of
 * every actor's page go to <dir>/<flow>-<actor>.png).
 */
export async function runFlow(name, fn, { browser, dir, actorOpts, env }) {
  const t0 = Date.now();
  const res = { flow: name, status: "PASS", reason: null, error: null, bugs: [], steps: [], notes: [], txs: [], data: {}, screenshots: [], seconds: 0 };
  const actors = [];
  const t = {
    env,
    data: res.data,
    step: (s) => {
      res.steps.push({ s, at: +((Date.now() - t0) / 1000).toFixed(1) });
      if (process.env.VERBOSE) console.log(`   · ${s}`);
    },
    note: (s) => res.notes.push(s),
    /** An app bug the flow worked around: the flow carries on, and ends as FAIL. */
    bug: (s) => {
      res.bugs.push(s);
      if (process.env.VERBOSE) console.log(`   ! bug: ${s}`);
    },
    actor: async (label, extra = {}) => {
      const a = await newActor(browser, { ...actorOpts, ...extra, label });
      actors.push(a);
      return a;
    },
    /** Use an actor made elsewhere (e.g. shared): its txs are collected, but it isn't closed. */
    adopt: (a) => {
      if (!actors.some((x) => x.page === a.page)) actors.push({ ...a, borrowed: true, since: txCount(a) });
      return a;
    },
    blocked: (reason, s) => {
      throw new Blocked(reason, s);
    },
    /**
     * Runs a step that needs the indexer. When it fails and the page's GraphQL requests failed (or the
     * environment probe says the indexer is down), the flow is BLOCKED (indexer) instead of FAIL.
     */
    indexed: async (actor, what, f) => {
      try {
        return await f();
      } catch (e) {
        if (e instanceof Blocked) throw e;
        if (indexerDown(actor) || !env.indexerLive) {
          throw new Blocked("indexer", `${what}: needs the indexer (${indexerDown(actor) ? indexerSummary(actor) : env.indexerError ?? "indexer not live"}); last error: ${String(e?.message ?? e).split("\n")[0]}`);
        }
        throw e;
      }
    },
  };
  try {
    await fn(t);
  } catch (e) {
    if (e instanceof Blocked) {
      res.status = "BLOCKED";
      res.reason = e.reason;
      res.error = e.message;
    } else {
      // the relayer itself out of gas money / down while the flow ran: not the app's fault
      const down = actors.flatMap((a) => (a.relayErrors ?? []).filter((x) => x.at >= t0 && (x.code === "RELAYER_UNDERFUNDED" || x.status === 502 || x.status === 503)))[0];
      if (down) {
        res.status = "BLOCKED";
        res.reason = down.code === "RELAYER_UNDERFUNDED" ? "relayer-underfunded" : "relayer-down";
        res.error = `${down.path} → ${down.status} ${down.code ?? ""} ${down.message ?? ""} (then: ${String(e?.message ?? e).split("\n")[0]})`;
      } else {
        res.status = "FAIL";
        res.error = String(e?.stack ?? e).split("\n").slice(0, 4).join("\n");
      }
    }
  }
  if (res.bugs.length) {
    // app bugs win: the flow FAILs, and what happened after the workaround is kept in `after`
    res.after = res.status === "PASS" ? "rest of the flow passed" : `${res.status}${res.reason ? ` (${res.reason})` : ""}: ${res.error}`;
    res.status = "FAIL";
    res.reason = "app-bug";
    res.error = res.bugs.join(" | ");
  }
  for (const a of actors) {
    const ms = txMarks(a).slice(a.since ?? 0);
    const seen = new Set(res.txs.map((x) => x.txHash));
    for (const m of ms) {
      if (seen.has(m.txHash)) continue;
      res.txs.push({ actor: a.label, action: m.event === "faucet_ok" ? "faucet" : m.action, txHash: m.txHash, latencyMs: m.latencyMs ?? null, clientMs: m.clientMs ?? null });
    }
    if (res.status !== "PASS" || process.env.SHOTS) {
      const file = join(dir, `${name}-${a.label}.png`.replace(/[^\w.-]+/g, "_"));
      if ((await within(20000, a.page.screenshot({ path: file }).then(() => true), false))) res.screenshots.push(file);
    }
    if (res.status === "FAIL") {
      res.logs = res.logs ?? {};
      res.logs[a.label] = (a.page.logs ?? []).filter((l) => /error|warn|PLANS_TIMING/i.test(l)).slice(-25);
    }
    res.data.indexer = res.data.indexer ?? {};
    res.data.indexer[a.label] = { ok: a.indexer.ok, failures: a.indexer.failures.length, last: indexerSummary(a) };
    const re = (a.relayErrors ?? []).filter((e) => !a.since || e.at >= t0);
    if (re.length) (res.data.relayerErrors ??= {})[a.label] = re.map(({ at, ...e }) => e);
    if (!a.borrowed) await within(15000, a.close());
  }
  res.seconds = +((Date.now() - t0) / 1000).toFixed(1);
  return res;
}

export function writeResults(file, obj) {
  writeFileSync(file, JSON.stringify(obj, null, 2));
}

export { ORIGIN, sleep };
