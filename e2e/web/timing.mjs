// Taps and seconds from the landing page (https://plans.0xo.in) to a first confirmed transaction,
// in a browser, measured end to end with a CDP virtual passkey (ctap2, internal, resident key, UV, PRF).
//
//   node timing.mjs [--path test-dollars|demo|both] [--runs N] [--width 1440|390] [--live] [--json out.json]
//
// Paths (docs/first-tx-timing.md):
//   test-dollars  landing → "Use Plans in your browser" → Create account → (new to Plans) → name → Continue
//                 → Add money → Get test dollars → Get test dollars  ⇒ first confirmed transaction (faucet)
//   demo          … → Continue → Start demo → Start the demo  ⇒ first confirmed transaction (joining the demo plan)
//
// The landing page is always the live site. The web app is the local export (site/public/app) served on
// https://plans.0xo.in/app by interception, unless --live (the deployed /app). The relayer and Monad
// testnet are real, so the numbers include real network and chain time. A "tap" is one click; typing the
// name counts as one tap plus its keystrokes (reported separately). The passkey prompt is answered by
// the virtual authenticator instantly, so real people add their fingerprint/face time (~1–2 s) per prompt.
import { writeFileSync } from "node:fs";
import { ORIGIN, addPasskeyAuthenticator, launch, newPage, serveLocalApp, sleep, timingMarks } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? d : args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true;
};
const PATHS = opt("path", "both") === "both" ? ["test-dollars", "demo"] : [opt("path")];
const RUNS = Number(opt("runs", 1));
const WIDTH = Number(opt("width", 1440));
const LIVE = !!opt("live", false);
const NAME = "Maya";

async function visible(page, testID, timeout) {
  try {
    await page.waitForSelector(`[data-testid="${testID}"]`, { visible: true, timeout });
    return true;
  } catch {
    return false;
  }
}

async function run(browser, path) {
  // A fresh profile per run (no stored account, empty passkey list), like a first visit.
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx, { width: WIDTH, height: WIDTH < 700 ? 844 : 900, mobile: WIDTH < 700 });
  try {
    return await runOn(page, path);
  } catch (e) {
    e.page = page;
    throw e;
  }
}

async function runOn(page, path) {
  if (!LIVE) await serveLocalApp(page);
  const auth = await addPasskeyAuthenticator(page);
  const steps = [];
  let taps = 0;
  let keys = 0;
  const t0 = Date.now();
  const step = (name, extra = {}) => steps.push({ step: name, ms: Date.now() - t0, taps, ...extra });
  const tap = async (testID, { timeout = 60000 } = {}) => {
    const el = await page.waitForSelector(`[data-testid="${testID}"]`, { visible: true, timeout });
    await el.click();
    taps++;
  };

  // 1. Landing page (live site), then the web-app button.
  await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
  step("landing_loaded");
  const btn = await page.waitForSelector('a[href="/app"]', { visible: true, timeout: 30000 });
  await btn.click();
  taps++;
  await page.waitForSelector('[data-testid="btn-create-account"]', { visible: true, timeout: 60000 });
  step("welcome_shown");

  // 2. Create account (passkey). The web flow first asks the browser for an existing passkey; with none it
  //    offers a choice, where "I'm new to Plans" makes the account.
  await tap("btn-create-account");
  for (let i = 0; i < 3; i++) {
    if (await visible(page, "field-name", 4000)) break;
    for (const id of ["btn-new-to-plans", "btn-create-new", "btn-create-account-secondary"]) {
      if (await visible(page, id, 500)) {
        await tap(id);
        break;
      }
    }
  }
  await page.waitForSelector('[data-testid="field-name"]', { visible: true, timeout: 60000 });
  step("passkey_created", { credentials: (await auth.credentials()).length });

  // 3. Name → Continue.
  const field = await page.$('[data-testid="field-name"]');
  await field.click();
  taps++;
  await field.type(NAME);
  keys += NAME.length;
  await tap("btn-continue");
  await page.waitForSelector('[data-testid="screen-home"]', { visible: true, timeout: 60000 });
  step("home_shown");

  // 4. The first transaction.
  if (path === "test-dollars") {
    await tap("btn-home-add-money");
    await tap("row-get-test-dollars");
    await tap("btn-get-test-dollars");
    await page.waitForFunction(() => (window.__plansTiming ?? []).some((m) => m.event === "faucet_ok"), { timeout: 120000 });
  } else {
    // "Try a settle-up": from the Home card when it's shown, else You → Try a settle-up.
    if (await visible(page, "btn-start-demo", 3000)) await tap("btn-start-demo");
    else {
      await tap(WIDTH >= 1024 ? "rail-you" : "tab-you");
      await tap("row-try-settle-up");
    }
    await tap("btn-start-the-demo");
    await page.waitForFunction(() => (window.__plansTiming ?? []).some((m) => m.event === "relay_ok" && m.action === "join"), { timeout: 180000 });
  }
  step("first_tx_confirmed");
  const marks = await timingMarks(page);
  // The first transaction the person asked for (faucet top-up, or joining the demo plan). The app also
  // registers the person's key in the background right after sign-up (relay_ok registerKey), which is
  // reported separately as the first confirmed transaction overall.
  const first = marks.find((m) => (path === "test-dollars" ? m.event === "faucet_ok" : m.event === "relay_ok" && m.action === "join"));
  const auto = marks.find((m) => m.event === "tx_first");
  await page.close();
  const landingWall = t0;
  return {
    path,
    width: WIDTH,
    live: LIVE,
    taps,
    keystrokes: keys,
    seconds: +((Date.now() - t0) / 1000).toFixed(2),
    txHash: first?.txHash ?? null,
    tx: first ?? null,
    firstOverall: auto ? { ...auto, secondsFromLanding: +((auto.wall - landingWall) / 1000).toFixed(2) } : null,
    steps,
    marks,
  };
}

const browser = await launch();
const results = [];
try {
  for (const p of PATHS) {
    for (let i = 0; i < RUNS; i++) {
      try {
        const r = await run(browser, p);
        results.push(r);
        console.log(`${p} #${i + 1}: ${r.taps} taps (+${r.keystrokes} keystrokes), ${r.seconds} s to a confirmed transaction ${r.txHash ?? ""}`);
        if (r.firstOverall && r.firstOverall.txHash !== r.txHash) console.log(`   (first confirmed transaction overall: ${r.firstOverall.action ?? r.firstOverall.kind} ${r.firstOverall.txHash} at ${r.firstOverall.secondsFromLanding} s, sent in the background after sign-up)`);
        for (const s of r.steps) console.log(`   ${String((s.ms / 1000).toFixed(2)).padStart(7)} s  ${String(s.taps).padStart(2)} taps  ${s.step}`);
      } catch (e) {
        if (e.page) {
          const shot = `/tmp/plans-timing-fail-${p}.png`;
          await e.page.screenshot({ path: shot }).catch(() => {});
          console.log(`   screenshot: ${shot}\n   ${e.page.logs.filter((l) => /error|PLANS_TIMING/i.test(l)).slice(-12).join("\n   ")}`);
          await e.page.close().catch(() => {});
        }
        results.push({ path: p, error: String(e?.message ?? e) });
        console.log(`${p} #${i + 1}: FAILED ${e?.message ?? e}`);
      }
    }
  }
} finally {
  await browser.close();
}
const out = opt("json", null);
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
process.exit(results.some((r) => r.error) ? 1 : 0);
