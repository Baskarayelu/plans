// Stage B end-to-end flows for the Plans web app against PUBLIC TESTNET (Monad testnet + the live
// relayer), mirroring the Android Maestro flows in app/e2e/*.yaml with the same testIDs.
//
//   node flows.mjs [--only create,plan,join,...] [--width 390|1440] [--app-dir DIR | --live] [--json out.json]
//
// Flows (Maestro file in brackets):
//   create        [01] new browser → Create account (one passkey) → name/country → home with a balance
//   test-dollars  [03b] Add money → Get test dollars → faucet transaction → balance goes up
//   plan          New plan → name → rules → Create plan (createPot) → invite link → plan home
//   join          [02] second person opens the plan's invite link → Join (one passkey) → You're in → plan
//   claim         [03] funded person makes a money link (claimCreate) → new person claims it
//   spend         [04] Pay → member → $0.10 → Food & drink → Goes through now → Paid + Settled in + Proof
//   approval      [05] $0.40 → Needs 1 more approval → Ask for an OK → the other member approves
//   send          [06] person B shows their Plans code; funded A (USD) sends 1 to B (GBP) → Sent receipt
//   dispute       [07] question a spend you were part of → the group votes
//   settle        [08] You → Try a settle-up → demo plan (join) → End plan & settle up → All settled
//   collect       Pot.collect after settlement (no UI path in the app: reported, not run)
//   restore       [09] clear site data (keep the passkey) → I already use Plans → same address + key fingerprint
//   receipt       [10] a spend with a note → opened on a "second device" holding the same passkey
//
// Each person is a separate browser context with its own CDP virtual authenticator (lib/flowkit.mjs).
// The run shares two scarce things between flows: ONE faucet top-up (the relayer allows 3 per network
// per day and 1 per account per day) on a "bank" person, and ONE plan created by the bank (createPot is
// capped per network per day too). Flows that need money or a plan borrow them.
//
// Status per flow: PASS, FAIL (an app or harness problem: screenshot + logs), or BLOCKED (reason) when
// something outside the app stops it: "indexer" (the Envio GraphQL endpoint isn't live; every step
// that doesn't need it is still done), "faucet-limit" (no test dollars left for this network today),
// "no-ui" (no screen does it), "demo-limit", "relayer-underfunded" / "relayer-down" (the relayer's
// gas lanes ran dry or it answered 502/503). Results: .runs/<timestamp>/results.json + screenshots.
//
// PLANS_GRAPHQL_URL=<url> makes the app use that indexer (the relayer's /v1/config is answered with
// it), so the flows can run against an indexer before the relayer publishes it. VERBOSE=1 prints steps
// and the app's console; HEADFUL=1 shows the browser; SHOTS=1 keeps end screenshots of passing flows.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? d : args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true;
};
const LIVE = !!opt("live", false);
if (opt("app-dir")) process.env.APP_DIR = resolve(String(opt("app-dir")));
if (LIVE) process.env.APP_DIR = "";
const WIDTH = Number(opt("width", 390));
const DESK = WIDTH >= 1024;

// browser.mjs reads APP_DIR at import time.
const { ORIGIN, APP_DIR, launch, sleep, typeInto } = await import("./lib/browser.mjs");
const { createAccount, accountAddress, firstVisible, pushRoute } = await import("./lib/session.mjs");
const fk = await import("./lib/flowkit.mjs");
const { Blocked, click, clickText, errorBanner, isVisible, lastClip, textOf, txCount, waitAny, waitTx, webAppLink } = fk;

const ALL = ["create", "test-dollars", "plan", "join", "claim", "spend", "approval", "send", "dispute", "settle", "collect", "restore", "receipt"];
const ONLY = opt("only") ? String(opt("only")).split(",").map((s) => s.trim()).filter(Boolean) : ALL;
for (const f of ONLY) if (!ALL.includes(f)) throw new Error(`unknown flow "${f}" (flows: ${ALL.join(", ")})`);

const DEPLOY = JSON.parse(readFileSync(resolve(HERE, "../../contracts/deployments/10143.json"), "utf8"));
const AUSD = DEPLOY.ausd;
const usd = (u) => `$${(Number(u) / 1e6).toFixed(2)}`;

// ─────────────── shared helpers ───────────────

/** Moves an actor to an app path without a reload when it's already in the app (a reload locks the session). */
async function go(a, path = "/app") {
  const url = new URL(a.page.url());
  const inApp = url.origin === ORIGIN && url.pathname.startsWith("/app");
  const atGate = inApp && (await firstVisible(a.page, ["screen-welcome", "screen-unlock"], { timeout: 300 }).catch(() => null));
  if (!inApp || atGate) {
    await a.page.goto(ORIGIN + "/app", { waitUntil: "load" });
    // the stored account unlocks by itself (the unlock screen starts the ceremony; the virtual passkey answers)
    await waitAny(a.page, { ids: ["screen-home", "screen-profile", "screen-welcome"], timeout: 45000 });
  }
  if (path !== "/app") {
    await pushRoute(a.page, path);
    await sleep(400);
  } else if (!(await isVisible(a.page, "screen-home"))) {
    await pushRoute(a.page, "/app");
    await sleep(400);
  }
}

async function tabTo(a, tab) {
  await go(a, "/app");
  await click(a.page, DESK ? `rail-${tab}` : `tab-${tab}`);
}

/**
 * Opens a Plans link (invite /j, claim /c, Plans code /p) the way a person does: a page load of
 * https://plans.0xo.in/app/<kind>/…#secret. When the app doesn't take the link (unmatched route, or
 * the secret got lost), that's recorded as an app bug and the flow carries on through
 * "Join with a link or code" (paste the link → Open), which parses it inside the app.
 */
async function openLink(t, a, url, expectIds, what) {
  const link = webAppLink(url);
  t.step(`${a.label}: open ${what} ${link.replace(/#.*/, "#…")}`);
  await a.page.goto(link, { waitUntil: "load" });
  const got = await waitAny(a.page, { ids: [...expectIds, "expo-router-unmatched", "screen-join-dead"], timeout: 30000 }).catch(() => "timeout");
  const dead = got === "screen-join-dead" ? await textOf(a.page, "dead-invite-reason") : null;
  if (got === "expo-router-unmatched" || (dead && /incomplete|cut off/i.test(dead))) {
    const path = new URL(link).pathname.replace(/0x[0-9a-fA-F]{40}/, "0x…");
    t.bug(`opening the ${what} ${path}#… in a browser shows ${got === "expo-router-unmatched" ? '"Unmatched Route"' : `"${dead}"`} (the link isn't handed to the app before the router reads the URL; the address bar keeps the secret)`);
    await go(a, "/app/join-link");
    await waitAny(a.page, { ids: ["field-link"], timeout: 20000 });
    await typeInto(a.page, "field-link", url);
    await click(a.page, "btn-open-link");
    return waitAny(a.page, { ids: [...expectIds, "screen-join-dead"], timeout: 30000 }).catch(() => "timeout");
  }
  return got;
}

/** Creates the actor's account (name, country) and records its address. */
async function signUp(t, a, { name, country = "US", countryName = "United States" }) {
  t.step(`${a.label}: create account (${name}, ${country})`);
  a.address = await createAccount(a.page, { name, country, countryName });
  a.name = name;
  a.country = country;
  t.data[`${a.label}Address`] = a.address;
  return a.address;
}

async function fingerprintOf(a) {
  return a.page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("plans.kv.plans.account.v1") ?? "null")?.fingerprint ?? null;
    } catch {
      return null;
    }
  });
}

/** The three key pictures on the "Your key" screen (key-emoji-0..2). */
async function keyScreenFingerprint(a) {
  await go(a, "/app/key");
  await waitAny(a.page, { ids: ["screen-key"] });
  await a.page.waitForFunction(() => document.querySelector('[data-testid="key-emoji-0"]')?.innerText.trim() !== "·", { timeout: 15000 });
  const parts = [];
  for (let i = 0; i < 3; i++) parts.push(await textOf(a.page, `key-emoji-${i}`));
  return parts.join("");
}

/** Get test dollars through the UI. Returns { ok, txHash?, limited?, reason? }. */
async function getTestDollars(t, a) {
  await go(a, "/app");
  t.step(`${a.label}: Add money → Get test dollars`);
  const add = await firstVisible(a.page, ["btn-home-add-money", "btn-home-add"], { timeout: 20000 });
  await click(a.page, add);
  await click(a.page, "row-get-test-dollars");
  await waitAny(a.page, { ids: ["btn-get-test-dollars"] });
  const n = txCount(a);
  const errs = a.relayErrors.length;
  await click(a.page, "btn-get-test-dollars");
  const limited = async () => {
    const e = a.relayErrors.slice(errs).find((x) => x.path === "/v1/faucet");
    if (e) return `${e.code}: ${e.message}`;
    return errorBanner(a.page);
  };
  const end = Date.now() + 90000;
  for (;;) {
    const m = fk.txMarks(a).slice(n).find((m) => m.event === "faucet_ok");
    if (m) {
      t.step(`${a.label}: faucet ${m.txHash}`);
      return { ok: true, txHash: m.txHash };
    }
    const why = await limited();
    if (why) {
      const label = await a.page.$eval('[data-testid="btn-get-test-dollars"]', (el) => el.innerText.trim()).catch(() => null);
      return { ok: false, limited: /FAUCET_LIMIT/.test(why), reason: why, button: label };
    }
    if (Date.now() > end) throw new Error("no faucet transaction within 90 s");
    await sleep(300);
  }
}

/** Types an amount: the phone keypad (key-1, key-dot…) or, on a laptop, the amount input. */
async function enterAmount(page, text) {
  if (await isVisible(page, "key-1")) {
    for (const ch of text) await click(page, `key-${ch === "." ? "dot" : ch}`);
    return;
  }
  const el = await page.waitForSelector('input[data-testid="amount-display"]', { visible: true, timeout: 15000 });
  await el.click({ clickCount: 3 });
  await el.type(text.startsWith(".") ? `0${text}` : text);
}

/** Waits for the home balance to show at least `min` (units of 1e-6 USD). */
async function waitHomeBalance(a, min, timeout = 30000) {
  await go(a, "/app");
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    last = await textOf(a.page, "home-balance");
    const m = last?.match(/\$([\d,]+\.\d\d)/);
    if (m && Math.round(Number(m[1].replace(/,/g, "")) * 1e6) >= Number(min)) return last;
    await sleep(1000);
  }
  throw new Error(`home balance stayed at ${last}`);
}

// ─────────────── run-level shared state: the bank (one faucet top-up) and the plan ───────────────

const shared = { bank: null, plan: null, member: null };
let browser, ENV, DIR;
const actorOpts = () => ({ width: WIDTH, live: LIVE, appDir: APP_DIR });

/** The run's funded person (US, USD). Funded at most once per run. */
async function ensureBank(t) {
  if (!shared.bank) {
    const a = await fk.newActor(browser, { ...actorOpts(), label: "bank" });
    shared.bank = { actor: a, funded: false, tried: false };
    t.adopt(a);
    await signUp(t, a, { name: "Maya", country: "US", countryName: "United States" });
  }
  t.adopt(shared.bank.actor);
  return shared.bank;
}

async function ensureFunded(t, { required = true } = {}) {
  const b = await ensureBank(t);
  if (!b.tried) {
    b.tried = true;
    const r = await getTestDollars(t, b.actor);
    b.funded = r.ok;
    b.faucet = r;
    if (r.ok) {
      b.balance = await fk.ausdBalanceOf(AUSD, b.actor.address).catch(() => null);
      t.data.bankBalance = b.balance !== null ? usd(b.balance) : null;
    }
  }
  if (!b.funded && required) {
    t.data.faucet = b.faucet;
    throw new Blocked(b.faucet?.limited ? "faucet-limit" : /RELAYER_UNDERFUNDED/.test(b.faucet?.reason ?? "") ? "relayer-underfunded" : "faucet", `no test dollars for the bank: ${b.faucet?.reason}${b.faucet?.button ? ` (button now reads "${b.faucet.button}")` : ""}`);
  }
  return b;
}

/** New plan → name → rules → (deposit when funded) → Create plan. Returns { pot, inviteUrl, txHash }. */
async function createPlanVia(t, a, { name = "Lisbon trip", deposit = true } = {}) {
  t.step(`${a.label}: New plan`);
  await go(a, "/app");
  // Home only offers "New plan" once the plan list loaded (or on the laptop rail). When the list can't
  // load (indexer down) a phone has no way in, so the flow opens the route directly and notes it.
  const entry = DESK ? "rail-new-plan" : (await firstVisible(a.page, ["btn-new-plan", "card-new-plan", "btn-home-retry"], { timeout: 20000 }).catch(() => null));
  if (entry && entry !== "btn-home-retry") await click(a.page, entry);
  else {
    t.note("Phone home shows no New plan button while the plan list can't load (\"Couldn't load your plans\"): opened /app/plan/new directly.");
    await pushRoute(a.page, "/app/plan/new");
  }
  await typeInto(a.page, "field-plan-name", name);
  await click(a.page, "btn-next-set-the-rules");
  await waitAny(a.page, { ids: ["screen-plan-rules"] });
  await waitAny(a.page, { ids: ["chip-deposit-0", "btn-rules-add-balance"], timeout: 20000 });
  if (deposit) {
    const chip = await a.page.$$eval('[data-testid^="chip-deposit-"]', (els) => els.map((e) => e.getAttribute("data-testid")).filter((id) => /chip-deposit-\d+$/.test(id) && id !== "chip-deposit-0"));
    if (chip.length) {
      t.step(`${a.label}: put in ${chip[0].replace("chip-deposit-", "$")}`);
      await click(a.page, chip[0]);
    }
  }
  const n = txCount(a);
  t.step(`${a.label}: Create plan`);
  await click(a.page, "btn-create-plan");
  const m = await waitTx(a, "createPot", { since: n, timeout: 90000, orElse: () => errorBanner(a.page) });
  t.step(`${a.label}: createPot ${m.txHash}`);
  await waitAny(a.page, { ids: ["screen-invite"], timeout: 30000 });
  const pot = new URL(a.page.url()).pathname.match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase();
  // The invite link: what "Copy link" puts on the clipboard (the screen shows a short form).
  await click(a.page, "btn-copy-link");
  await sleep(300);
  const inviteUrl = await lastClip(a.page, /\/j\/0x/);
  if (!inviteUrl) throw new Error("Copy link put no invite link on the clipboard");
  t.step(`${a.label}: invite link ${inviteUrl.replace(/#.*/, "#…")}`);
  return { pot, inviteUrl, txHash: m.txHash, shown: await textOf(a.page, "invite-link-text") };
}

/** The run's plan, made by the bank (with money in it when the bank is funded). */
async function ensurePlan(t, { funded = false } = {}) {
  if (funded) await ensureFunded(t);
  const b = await ensureBank(t);
  if (!shared.plan) {
    shared.plan = await createPlanVia(t, b.actor, { deposit: b.funded });
    shared.plan.funded = b.funded;
    t.data.pot = shared.plan.pot;
  }
  if (funded && !shared.plan.funded) throw new Blocked("faucet-limit", "the run's plan has no money in it");
  return shared.plan;
}

/** Opens the plan home for an actor (needs the indexer). */
async function openPlan(t, a, pot) {
  await go(a, `/app/plan/${pot}`);
  await t.indexed(a, "plan home", async () => {
    const got = await waitAny(a.page, { ids: ["pot-card", "banner-plan-error", "btn-plan-loading-retry"], timeout: ENV.indexerLive ? 60000 : 20000 });
    if (got !== "pot-card") throw new Error(`plan home shows ${got}: ${await errorBanner(a.page)}`);
  });
}

/** A second person who joined the run's plan through its invite link (flow 02). */
async function joinVia(t, b, inviteUrl, { name = "Leah", country = "GB", countryName = "United Kingdom" } = {}) {
  await openLink(t, b, inviteUrl, ["btn-join-with-fingerprint", "btn-try-again", "join-loading"], "invite link");
  await t.indexed(b, "invite preview", async () => {
    const got = await waitAny(b.page, { ids: ["btn-join-with-fingerprint", "btn-try-again", "screen-join-dead"], timeout: ENV.indexerLive ? 60000 : 25000 });
    if (got !== "btn-join-with-fingerprint") throw new Error(`join screen shows ${got}: ${(await textOf(b.page, "screen-join"))?.slice(0, 160)}`);
  });
  const n = txCount(b);
  t.step(`${b.label}: Join (creates the passkey)`);
  await click(b.page, "btn-join-with-fingerprint");
  const at = await waitAny(b.page, { ids: ["field-name", "screen-joined"], timeout: 60000 });
  if (at === "field-name") {
    await typeInto(b.page, "field-name", name);
    await click(b.page, "field-country");
    await typeInto(b.page, "field-country-search", countryName);
    await sleep(200);
    await click(b.page, `country-${country}`);
    await click(b.page, "btn-continue");
    await waitAny(b.page, { ids: ["btn-join-with-fingerprint"], timeout: 30000 });
    await click(b.page, "btn-join-with-fingerprint");
  }
  const m = await waitTx(b, "join", { since: n, timeout: 90000, orElse: () => errorBanner(b.page) });
  t.step(`${b.label}: join ${m.txHash}`);
  await waitAny(b.page, { ids: ["screen-joined"], texts: ["You're in!"], timeout: 30000 });
  b.address = await accountAddress(b.page);
  b.name = name;
  return m;
}

/** The run's second plan member (joined through the invite link, flow 02); made once per run. */
async function ensureMember(t, { funded = true } = {}) {
  const plan = await ensurePlan(t, { funded });
  if (shared.member?.joined) return t.adopt(shared.member);
  if (!shared.member) shared.member = await fk.newActor(browser, { ...actorOpts(), label: "member" });
  const b = t.adopt(shared.member);
  if (shared.member.tried) throw new Blocked(shared.member.blocked ?? "join", "the run's member couldn't join the plan (see the join flow)");
  shared.member.tried = true;
  try {
    await joinVia(t, b, plan.inviteUrl);
    shared.member.joined = true;
  } catch (e) {
    shared.member.blocked = e instanceof Blocked ? e.reason : "join";
    throw e;
  }
  return b;
}

/** Pay a member from the pot: Pay → member → amount (keypad) → category → confirm. */
async function proposeSpend(t, a, pot, { payee, keys, category = 3, note, expect }) {
  await openPlan(t, a, pot);
  await click(a.page, "btn-pay");
  await clickText(a.page, payee);
  await waitAny(a.page, { ids: ["screen-pay-form"] });
  if (await isVisible(a.page, "btn-swap-currency")) {
    const label = await textOf(a.page, "btn-swap-currency");
    if (/dollars/i.test(label ?? "")) await click(a.page, "btn-swap-currency");
  }
  await enterAmount(a.page, keys.join(""));
  if (category !== undefined && (await isVisible(a.page, `chip-category-${category}`))) await click(a.page, `chip-category-${category}`);
  if (note) await typeInto(a.page, "field-note", note);
  await waitAny(a.page, { texts: [expect], timeout: 15000 });
  const n = txCount(a);
  return n;
}

// ─────────────── the flows ───────────────

const FLOWS = {
  // 01 Fresh browser → Create account (one passkey prompt) → name/country → home with a balance.
  async create(t) {
    const a = await t.actor("A");
    await signUp(t, a, { name: "Sam", country: "US", countryName: "United States" });
    await waitAny(a.page, { ids: ["screen-home"] });
    await waitAny(a.page, { ids: ["home-balance"], timeout: 20000 });
    await waitAny(a.page, { texts: ["Your plans"] });
    t.data.balance = await textOf(a.page, "home-balance");
    // the app registers the person's key in the background (KeyRegistry) right after sign-up
    const m = await waitTx(a, "registerKey", { timeout: 60000 }).catch(() => null);
    if (m) t.step(`A: registerKey ${m.txHash}`);
    else t.note("no registerKey transaction within 60 s of sign-up");
    t.data.fingerprint = await keyScreenFingerprint(a);
    t.step(`A: key fingerprint ${t.data.fingerprint}`);
    if (!/^\S{2,}$/u.test(t.data.fingerprint)) throw new Error(`no key fingerprint on the key screen (${t.data.fingerprint})`);
    if (t.data.fingerprint !== (await fingerprintOf(a))) throw new Error("key screen fingerprint differs from the stored one");
  },

  // Add money → Get test dollars (one top-up per account per day, 3 per network per day).
  async "test-dollars"(t) {
    const b = await ensureFunded(t, { required: false });
    if (!b.funded) {
      t.data.faucet = b.faucet;
      throw new Blocked(b.faucet?.limited ? "faucet-limit" : "faucet", `${b.faucet?.reason}; the app shows "${b.faucet?.button}"`);
    }
    t.data.balance = await waitHomeBalance(b.actor, 1_000_000n);
    t.step(`bank: home balance ${t.data.balance}`);
  },

  // New plan → rules → Create plan (createPot relay) → invite screen with a link → plan home.
  async plan(t) {
    await ensureFunded(t, { required: false });
    const p = await ensurePlan(t);
    t.data.inviteShown = p.shown;
    t.data.funded = p.funded;
    await openPlan(t, shared.bank.actor, p.pot);
    t.data.potBalance = await textOf(shared.bank.actor.page, "pot-balance");
  },

  // 02 Invite link → Join with ONE prompt (new person: account + join) → You're in! → plan.
  async join(t) {
    if (process.env.PLANS_INVITE_URL) {
      const b = await t.actor("B");
      await joinVia(t, b, process.env.PLANS_INVITE_URL);
      await click(b.page, "btn-open-the-plan");
      await waitAny(b.page, { ids: ["plan-home"] });
      return;
    }
    const b = await ensureMember(t, { funded: false });
    await click(b.page, "btn-open-the-plan");
    await waitAny(b.page, { ids: ["plan-home"] });
  },

  // 03 Claim link: the bank sends a money link; a new person creates an account and claims it.
  async claim(t) {
    const bank = (await ensureFunded(t)).actor;
    await tabTo(bank, "send");
    t.step("bank: Send → Send by link");
    await click(bank.page, "btn-send-by-link");
    await waitAny(bank.page, { ids: ["amount-display"] });
    await enterAmount(bank.page, "1");
    const n = txCount(bank);
    await click(bank.page, "btn-confirm-with-fingerprint");
    const m = await waitTx(bank, ["claimCreate"], { since: n, timeout: 90000, orElse: () => errorBanner(bank.page) });
    t.step(`bank: claimCreate ${m.txHash}`);
    await waitAny(bank.page, { ids: ["screen-send-link-done"], timeout: 30000 });
    await click(bank.page, "btn-copy-link");
    await sleep(300);
    const url = await lastClip(bank.page, /\/c\//);
    if (!url) throw new Error("Copy link put no claim link on the clipboard");
    t.data.claimLink = url.replace(/#.*/, "#…");
    const c = await t.actor("C");
    await openLink(t, c, url, ["claim-status"], "claim link");
    await t.indexed(c, "claim lookup", async () => {
      const got = await waitAny(c.page, { ids: ["btn-create-account-and-claim", "btn-claim", "btn-claim-retry"], timeout: ENV.indexerLive ? 60000 : 25000 });
      if (got === "btn-claim-retry") throw new Error(await textOf(c.page, "claim-status"));
    });
    await click(c.page, "btn-create-account-and-claim");
    const at = await waitAny(c.page, { ids: ["field-name", "btn-claim", "settled-in"], timeout: 60000 });
    if (at === "field-name") {
      await typeInto(c.page, "field-name", "Ben");
      await click(c.page, "btn-continue");
    }
    const k = await waitTx(c, "claim", { timeout: 90000, orElse: () => errorBanner(c.page) });
    t.step(`C: claim ${k.txHash}`);
    await waitAny(c.page, { texts: ["is in your Plans account"], timeout: 30000 });
    await waitAny(c.page, { ids: ["settled-in"] });
  },

  // 04 Instant spend: $0.10 to a member, Food & drink → Goes through now → Paid + Settled in + Proof.
  async spend(t) {
    const member = await ensureMember(t);
    const plan = shared.plan;
    const a = shared.bank.actor;
    const n = await proposeSpend(t, a, plan.pot, { payee: member.name, keys: [".", "1", "0"], category: 3, note: "Dinner at Taberna", expect: "Goes through now" });
    await click(a.page, "btn-confirm-with-fingerprint");
    const m = await waitTx(a, ["propose", "execute"], { since: n, timeout: 90000, orElse: () => errorBanner(a.page) });
    t.step(`bank: ${m.action} ${m.txHash}`);
    await waitAny(a.page, { texts: ["Paid"], timeout: 30000 });
    await waitAny(a.page, { ids: ["settled-in"] });
    await waitAny(a.page, { ids: ["proof"] });
    shared.spendNote = "Dinner at Taberna";
  },

  // 05 Over the instant limit → Needs 1 more approval → Ask for an OK → the other member approves.
  async approval(t) {
    const member = await ensureMember(t);
    const plan = shared.plan;
    const a = shared.bank.actor;
    const n = await proposeSpend(t, a, plan.pot, { payee: member.name, keys: [".", "4", "0"], expect: /Needs 1 more approval/ });
    await click(a.page, "btn-ask-for-an-ok");
    const m = await waitTx(a, "propose", { since: n, timeout: 90000, orElse: () => errorBanner(a.page) });
    t.step(`bank: propose ${m.txHash}`);
    // the member reviews it from Activity
    await tabTo(member, "activity");
    await t.indexed(member, "pending request in Activity", () => member.page.waitForSelector('[data-testid^="btn-review-"]', { visible: true, timeout: 60000 }));
    await member.page.click('[data-testid^="btn-review-"]');
    const n2 = txCount(member);
    await click(member.page, "btn-approve");
    const v = await waitTx(member, ["vote", "execute"], { since: n2, timeout: 90000, orElse: () => errorBanner(member.page) });
    t.step(`member: ${v.action} ${v.txHash}`);
    await go(a, `/app/plan/${plan.pot}`);
    await waitAny(a.page, { texts: [/said OK|Approved|paid/], timeout: 40000 });
  },

  // 06 B shows their Plans code; A (USD, funded) opens it and sends 1 → B (GBP); receipt shows both currencies.
  async send(t) {
    const b = await t.actor("B");
    await signUp(t, b, { name: "Leah", country: "GB", countryName: "United Kingdom" });
    t.step("B: Receive → my Plans code");
    await go(b, "/app");
    await click(b.page, "btn-home-receive");
    await waitAny(b.page, { ids: ["my-code-qr", "btn-set-up"], timeout: 20000 });
    if (await isVisible(b.page, "btn-set-up")) throw new Error("my-code asks to set up first");
    await click(b.page, "btn-copy-link");
    await sleep(300);
    const code = await lastClip(b.page, /\/p\/0x/);
    if (!code) throw new Error("Copy link put no Plans code link on the clipboard");
    t.data.codeLink = code;
    const before = await fk.ausdBalanceOf(AUSD, b.address);
    // fund the sender first (the faucet screen is elsewhere); without money the amount steps still run
    const bank = await ensureFunded(t, { required: false });
    const a = bank.actor;
    // A opens B's link like a person clicking it: a fresh page load of /app/p/<address>#…
    let at = await openLink(t, a, code, ["amount-display"], "Plans code link");
    // a page load locks the session: the unlock screen may show first and unlock by itself
    if (at !== "amount-display") at = await waitAny(a.page, { ids: ["amount-display", "screen-home"], timeout: 30000 }).catch(() => "timeout");
    if (at !== "amount-display") {
      t.note(`Opening the Plans code link in a signed-in browser ended on ${at}, not the send amount screen: used Send → paste the link instead.`);
      await tabTo(a, "send");
      await typeInto(a.page, "field-search-people", code);
      await click(a.page, "search-link-result");
      await waitAny(a.page, { ids: ["amount-display"] });
    }
    await enterAmount(a.page, "1");
    await waitAny(a.page, { ids: ["recipient-gets"], timeout: 15000 });
    await a.page.waitForFunction(() => /\d/.test(document.querySelector('[data-testid="recipient-gets"]')?.innerText ?? ""), { timeout: 15000 });
    t.data.recipientGets = await textOf(a.page, "recipient-gets");
    t.step(`bank: 1 → B gets ${t.data.recipientGets}`);
    if (!/£/.test(t.data.recipientGets ?? "")) throw new Error(`recipient-gets should be in pounds: "${t.data.recipientGets}"`);
    if (!bank.funded) {
      t.data.notEnough = await isVisible(a.page, "not-enough");
      await ensureFunded(t); // throws BLOCKED (faucet-limit)
    }
    if (await isVisible(a.page, "btn-continue")) await click(a.page, "btn-continue"); // phone: amount → check and send
    await waitAny(a.page, { ids: ["btn-confirm-with-fingerprint"] });
    const n = txCount(a);
    await click(a.page, "btn-confirm-with-fingerprint");
    at = await waitAny(a.page, { ids: ["screen-sent", "screen-unlock", "screen-home", "banner-action-error"], timeout: 90000 });
    if (at !== "screen-sent") throw new Error(`after Confirm the app shows ${at} (${await errorBanner(a.page)})`);
    const m = await waitTx(a, "send", { since: n, timeout: 30000 });
    t.step(`bank: send ${m.txHash}`);
    await waitAny(a.page, { ids: ["settled-in"] });
    await waitAny(a.page, { ids: ["proof"] });
    t.data.sentFrom = await textOf(a.page, "sent-from-amount");
    t.data.sentTo = await textOf(a.page, "sent-to-amount");
    if (!/\$/.test(t.data.sentFrom ?? "") || !/£/.test(t.data.sentTo ?? "")) throw new Error(`receipt should show $ and £: from "${t.data.sentFrom}" to "${t.data.sentTo}"`);
    const after = await fk.ausdBalanceOf(AUSD, b.address);
    t.data.recipientBalance = `${usd(before)} → ${usd(after)}`;
    if (after <= before) throw new Error(`B's balance didn't go up (${t.data.recipientBalance})`);
    // B sees it on their home (balance read from the chain, no indexer needed)
    t.data.recipientHome = await waitHomeBalance(b, after);
  },

  // 07 Question a spend you were part of → the group votes.
  async dispute(t) {
    const member = await ensureMember(t);
    const plan = shared.plan;
    await openPlan(t, member, plan.pot);
    await t.indexed(member, "spend in the feed", () => member.page.waitForSelector('[data-testid^="feed-item-"]', { visible: true, timeout: 30000 }));
    await member.page.click('[data-testid^="feed-item-"]');
    await clickText(member.page, "Question this spend");
    await clickText(member.page, "Not part of the plan");
    const n = txCount(member);
    await click(member.page, "btn-send-to-the-group");
    const m = await waitTx(member, "openDispute", { since: n, timeout: 90000, orElse: () => errorBanner(member.page) });
    t.step(`member: openDispute ${m.txHash}`);
    await waitAny(member.page, { texts: [/Should .* cover/], timeout: 30000 });
  },

  // 08 You → Try a settle-up → demo plan with three demo friends → End plan & settle up → All settled.
  async settle(t) {
    const a = await t.actor("A");
    await signUp(t, a, { name: "Asha", country: "IN", countryName: "India" });
    await tabTo(a, "you");
    await click(a.page, "row-try-settle-up");
    await waitAny(a.page, { ids: ["btn-start-the-demo", "demo-disabled"] });
    if (await isVisible(a.page, "demo-disabled")) throw new Blocked("demo-disabled", await textOf(a.page, "demo-disabled"));
    const n = txCount(a);
    t.step("A: Start the demo");
    await sleep(1000); // let the screen settle: a tap during the first render can be lost on the laptop layout
    await click(a.page, "btn-start-the-demo");
    await a.page.waitForFunction(() => (window.__plansTiming ?? []).some((m) => m.event === "demo_started") || !!document.querySelector('[data-testid="demo-error"]'), { timeout: 8000 }).catch(async () => {
      t.note("the first tap on Start the demo did nothing; tapped again");
      await click(a.page, "btn-start-the-demo");
    });
    const m = await waitTx(a, "join", {
      since: n,
      timeout: 120000,
      orElse: async () => {
        const e = a.relayErrors.find((x) => x.path.startsWith("/v1/demo"));
        if (e?.code === "DEMO_LIMIT") throw new Blocked("demo-limit", e.message);
        return (await isVisible(a.page, "demo-error")) ? await textOf(a.page, "demo-error") : null;
      },
    });
    t.step(`A: join (demo plan) ${m.txHash}`);
    t.data.demoPot = new URL(a.page.url()).pathname.match(/0x[0-9a-fA-F]{40}/)?.[0] ?? null;
    await t.indexed(a, "demo plan", async () => {
      await waitAny(a.page, { ids: ["demo-step"], timeout: ENV.indexerLive ? 60000 : 25000 });
    });
    await waitAny(a.page, { texts: [/step 3 of 3|Next: end the plan/], timeout: 180000 });
    await a.page.waitForFunction(() => !document.querySelector('[data-testid="btn-end-plan-and-settle-up"][aria-disabled="true"]'), { timeout: 60000 });
    const n2 = txCount(a);
    await click(a.page, "btn-end-plan-and-settle-up");
    await waitAny(a.page, { ids: ["btn-settle-up"], timeout: 180000 });
    await click(a.page, "btn-settle-up");
    const s = await waitTx(a, "settle", { since: n2, timeout: 120000, orElse: () => errorBanner(a.page) });
    t.step(`A: settle ${s.txHash}`);
    await waitAny(a.page, { texts: ["All settled"], timeout: 30000 });
    await waitAny(a.page, { ids: ["settled-in"] });
    await waitAny(a.page, { ids: ["proof"] });
  },

  // Pot.collect(member) after settlement: lib/chain/actions.ts has collect(), but no screen calls it.
  async collect() {
    throw new Blocked("no-ui", "no screen calls collect() (app/src/lib/chain/actions.ts:299 is unused in src/app and src/ui); skipped payouts are only paid by someone calling Pot.collect");
  },

  // 09 Clear the site's data (keep the passkey) → I already use Plans → same address and key fingerprint.
  async restore(t) {
    const a = await t.actor("A");
    await signUp(t, a, { name: "Leah", country: "GB", countryName: "United Kingdom" });
    const addr = a.address;
    const fp = await keyScreenFingerprint(a);
    t.data.before = { address: addr, fingerprint: fp };
    t.step(`A: ${addr} ${fp}; clearing site data for ${ORIGIN}`);
    const cdp = await a.page.createCDPSession();
    await cdp.send("Storage.clearDataForOrigin", { origin: ORIGIN, storageTypes: "all" });
    await a.page.goto(ORIGIN + "/app", { waitUntil: "load" });
    const left = await a.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("plans.")).length);
    if (left) throw new Error(`site data not cleared (${left} plans.* keys left)`);
    if ((await a.auth.credentials()).length !== 1) throw new Error("the virtual passkey was lost");
    await waitAny(a.page, { ids: ["btn-restore"] });
    t.step("A: I already use Plans");
    await click(a.page, "btn-restore");
    await waitAny(a.page, { ids: ["screen-restored"], texts: ["Welcome back"], timeout: 45000 });
    const shown = await textOf(a.page, "key-fingerprint");
    const after = { address: await accountAddress(a.page), fingerprint: await fingerprintOf(a), shown };
    t.data.after = after;
    if (after.address !== addr) throw new Error(`restored a different account: ${after.address} ≠ ${addr}`);
    if (after.fingerprint !== fp) throw new Error(`key fingerprint changed: ${after.fingerprint} ≠ ${fp}`);
    if (shown && shown.replace(/\s/g, "") !== fp) throw new Error(`restored screen shows ${shown}, expected ${fp}`);
    await a.page.waitForSelector('[data-testid="btn-go-to-my-plans"]:not([aria-disabled="true"])', { visible: true, timeout: 30000 });
    await click(a.page, "btn-go-to-my-plans");
    const at = await waitAny(a.page, { ids: ["screen-home", "field-name"], timeout: 30000 });
    if (at === "field-name") {
      // The profile comes back from the person's encrypted profile in one of their plans (indexer);
      // a new account with no plans, or no indexer, asks for the name again.
      t.note(`profile not rebuilt (${ENV.indexerLive ? "account has no plans" : "indexer not live"}): typed the name again`);
      await typeInto(a.page, "field-name", "Leah");
      await click(a.page, "btn-continue");
      await waitAny(a.page, { ids: ["screen-home"], timeout: 30000 });
    }
    await waitAny(a.page, { texts: ["Your plans"] });
    const fp2 = await keyScreenFingerprint(a);
    if (fp2 !== fp) throw new Error(`key screen after restore shows ${fp2}, expected ${fp}`);
  },

  // 10 A spend with a note, read on a second device that holds the same passkey.
  async receipt(t) {
    // (a) Can a second browser context hold the SAME passkey? Export it (with its private key) from
    // A's virtual authenticator and import it into B's.
    const a = await t.actor("A");
    await signUp(t, a, { name: "Ben", country: "GB", countryName: "United Kingdom" });
    const creds = await a.auth.credentials();
    const b = await t.actor("B");
    for (const c of creds) await b.auth.addCredential(c);
    await b.page.goto(ORIGIN + "/app", { waitUntil: "load" });
    await click(b.page, "btn-restore");
    const got = await waitAny(b.page, { ids: ["screen-restored", "welcome-notice-prf-unavailable", "welcome-notice-error"], timeout: 30000 });
    const bAddr = await accountAddress(b.page);
    t.data.importedCredential = { result: got, sameAddress: bAddr === a.address, address: bAddr };
    if (got === "welcome-notice-prf-unavailable") {
      t.note(
        "CDP virtual authenticators keep the PRF (hmac-secret) key per credential and WebAuthn.getCredentials/addCredential don't carry it: the imported copy signs but returns no PRF, so the app says the passkey can't make keys (welcome-notice-prf-unavailable). A second context can't hold the same Plans account; the second device is emulated by clearing A's site data and restoring with A's own authenticator (as flow 09).",
      );
    } else if (got === "screen-restored" && bAddr === a.address) t.note("the imported credential carried its PRF output: same account in the second context");
    // (b) The spend with a note, in the run's plan, then the "second device" opens it.
    const member = await ensureMember(t);
    const plan = shared.plan;
    const bank = shared.bank.actor;
    if (!shared.spendNote) {
      const n = await proposeSpend(t, bank, plan.pot, { payee: member.name, keys: [".", "1", "0"], category: 3, note: "Dinner at Taberna", expect: "Goes through now" });
      await click(bank.page, "btn-confirm-with-fingerprint");
      await waitTx(bank, ["propose", "execute"], { since: n, timeout: 90000, orElse: () => errorBanner(bank.page) });
      shared.spendNote = "Dinner at Taberna";
    }
    // the member's "second device": same authenticator, site data cleared, restored
    const cdp = await member.page.createCDPSession();
    await cdp.send("Storage.clearDataForOrigin", { origin: ORIGIN, storageTypes: "all" });
    await member.page.goto(ORIGIN + "/app", { waitUntil: "load" });
    await click(member.page, "btn-restore");
    await waitAny(member.page, { ids: ["screen-restored"], timeout: 45000 });
    await click(member.page, "btn-go-to-my-plans");
    await openPlan(t, member, plan.pot);
    await waitAny(member.page, { texts: [shared.spendNote], timeout: 30000 });
    await clickText(member.page, new RegExp(shared.spendNote));
    await waitAny(member.page, { ids: ["screen-spend"], texts: [shared.spendNote] });
  },
};

// ─────────────── main ───────────────

ENV = await fk.probeEnvironment();
DIR = fk.runDir(resolve(HERE, ".runs"));
console.log(`Plans web flows · ${LIVE ? "live site" : `local export ${APP_DIR}`} · ${WIDTH} px · relayer ${ENV.relayer}`);
console.log(`indexer ${ENV.graphqlUrl}: ${ENV.indexerLive ? "live" : `NOT live (${ENV.indexerError})`}${ENV.graphqlOverride ? " (PLANS_GRAPHQL_URL)" : ""}`);
browser = await launch();
const results = [];
try {
  for (const name of ONLY) {
    process.stdout.write(`${name.padEnd(13)} … `);
    const r = await fk.runFlow(name, FLOWS[name], { browser, dir: DIR, actorOpts: actorOpts(), env: ENV });
    results.push(r);
    const why = r.status === "PASS" ? "" : r.status === "BLOCKED" ? ` (${r.reason}) ${r.error}` : ` ${r.error?.split("\n")[0]}`;
    console.log(`${r.status}${why}  [${r.seconds} s]`);
    if (r.after) console.log(`    after the workaround: ${r.after}`);
    for (const x of r.txs) console.log(`    tx ${x.actor}: ${x.action.padEnd(12)} ${x.txHash}${x.latencyMs ? `  ${x.latencyMs} ms` : ""}`);
    for (const n of r.notes) console.log(`    note: ${n}`);
    for (const s of r.screenshots) console.log(`    screenshot: ${s}`);
    if (process.env.VERBOSE && r.logs) for (const [k, v] of Object.entries(r.logs)) console.log(`    ${k} log:\n      ${v.join("\n      ")}`);
  }
} finally {
  for (const a of [shared.bank?.actor, shared.member]) await fk.within(15000, a?.close?.());
  const proc = browser.process?.();
  await fk.within(20000, browser.close());
  try {
    proc?.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}
const out = { at: new Date().toISOString(), width: WIDTH, live: LIVE, appDir: APP_DIR || null, env: ENV, results };
fk.writeResults(resolve(DIR, "results.json"), out);
if (opt("json")) fk.writeResults(resolve(String(opt("json"))), out);
const count = (s) => results.filter((r) => r.status === s).length;
console.log(`\n${count("PASS")} passed, ${count("FAIL")} failed, ${count("BLOCKED")} blocked · ${resolve(DIR, "results.json")}`);
process.exit(count("FAIL") ? 1 : 0);
