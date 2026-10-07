// Screenshots of the Plans web app with fixture data (lib/fixtures.mjs), for design review.
//
//   node shoot.mjs [--app-dir DIR] [--out DIR] [--only home,plan,...] [--widths 1440,390] [--themes light,dark]
//
// Writes <out>/app-<name>-<width>-<theme>.png (default out: ../../site/screenshots) and prints any
// page errors and horizontal overflow per shot. APP_DIR (or --app-dir) is the web export to serve;
// default ../../site/public/app.
//
// Routes are reached by clicking through the app (rail on laptops, tab bar on phones, buttons on
// screens), never by reloading: a reload (or a pushState into a route the router hasn't seen) locks
// the session. Each width gets two signed-up sessions: the normal fixture world, and one where the
// Lisbon plan has ended so the settle-up preview is reachable. Themes are switched live.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
if (arg("app-dir")) process.env.APP_DIR = resolve(arg("app-dir"));
const OUT = resolve(arg("out", resolve(HERE, "../../site/screenshots")));
const ONLY = arg("only") ? new Set(arg("only").split(",").map((s) => s.trim()).filter(Boolean)) : null;
const WIDTHS = arg("widths", "1440,390").split(",").map(Number);
const THEMES = arg("themes", "light,dark").split(",");

// browser.mjs reads APP_DIR at import time, so import after the flag is applied.
const { ORIGIN, APP_DIR, addPasskeyAuthenticator, launch, newPage, noTestnetWrites, serveLocalApp, sleep, tap } = await import("./lib/browser.mjs");
const { installFixtures, claimPath, PEOPLE } = await import("./lib/fixtures.mjs");
const { createAccount, firstVisible, pushRoute, unlockIfNeeded } = await import("./lib/session.mjs");

const want = (name) => !ONLY || ONLY.has(name);
const sel = (id) => `[data-testid="${id}"]`;
const report = [];
mkdirSync(OUT, { recursive: true });

async function visible(page, id) {
  return page.evaluate(
    (s) =>
      [...document.querySelectorAll(s)].some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      }),
    sel(id),
  );
}

async function overflow(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const doc = document.documentElement.scrollWidth - vw;
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= vw + 1) continue;
      // clipped by a scroller / overflow-hidden ancestor that itself fits? then it's intended
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox !== "visible" && a.getBoundingClientRect().right <= vw + 1) {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;
      const id = el.getAttribute("data-testid");
      const text = (el.innerText || "").trim().slice(0, 40).replace(/\s+/g, " ");
      out.push(`${id ? `[${id}]` : el.tagName.toLowerCase()} right=${Math.round(r.right)}${text ? ` "${text}"` : ""}`);
      if (out.length >= 5) break;
    }
    return { doc, els: out };
  });
}

function trackErrors(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.split("\n")[0]));
  return () => errs.splice(0, errs.length);
}

async function shoot(page, name, width, takeErrors) {
  for (const theme of THEMES) {
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: theme },
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    await sleep(700);
    const file = `${OUT}/app-${name}-${width}-${theme}.png`;
    await page.screenshot({ path: file });
    const ov = await overflow(page);
    const errors = takeErrors();
    report.push({ name, width, theme, file, overflow: ov, errors });
    const flags = [ov.doc > 0 ? `page scrolls sideways by ${ov.doc}px` : "", ov.els.length ? `overflow: ${ov.els.join("; ")}` : "", errors.length ? `errors: ${errors.join(" | ")}` : ""].filter(Boolean);
    console.log(`  ${flags.length ? "!" : "✓"} app-${name}-${width}-${theme}.png${flags.length ? `\n      ${flags.join("\n      ")}` : ""}`);
  }
}

/** Rail on laptops, tab bar on phones; backs out of pushed screens first when needed. */
async function goPlace(page, place, desk) {
  const id = desk ? `rail-${place}` : `tab-${place}`;
  for (let i = 0; i < 5 && !(await visible(page, id)); i++) {
    if (await visible(page, "btn-back")) await tap(page, "btn-back");
    else if (await visible(page, "btn-close")) await tap(page, "btn-close");
    else break;
    await sleep(500);
  }
  if (await visible(page, id)) await tap(page, id);
  else await pushRoute(page, { plans: "/app", send: "/app/send", activity: "/app/activity", you: "/app/you" }[place]);
  await unlockIfNeeded(page);
}

async function waitAny(page, ids, timeout = 20000) {
  try {
    return await firstVisible(page, ids, { timeout });
  } catch {
    return null;
  }
}

async function openPlan(page, desk, pot) {
  const rail = `rail-plan-${pot.slice(2, 8)}`;
  if (desk && (await visible(page, rail))) await tap(page, rail);
  else {
    await goPlace(page, "plans", desk);
    await waitAny(page, ["screen-home"]);
    await tap(page, `plan-card-${pot.slice(2, 8)}`, { timeout: 20000 });
  }
  await waitAny(page, ["pot-card", "feed", "banner-settled"]);
  await sleep(800);
}

async function session(browser, width, { ended }) {
  const desk = width >= 1024;
  // a fresh browser context per session: localStorage (the stored account) isn't shared
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx, { width, height: width < 700 ? 844 : 900, theme: THEMES[0], mobile: width < 700 });
  const takeErrors = trackErrors(page);
  await serveLocalApp(page);
  await addPasskeyAuthenticator(page);
  await noTestnetWrites(page);
  const fx = await installFixtures(page, { balance: 5_000_000n, lisbonEnded: ended, myCountry: "GB" });
  await createAccount(page, { name: "Maya", country: "GB", countryName: "United Kingdom", city: "London" });
  await waitAny(page, [`plan-card-${fx.ids.lisbon.slice(2, 8)}`]);
  await sleep(1500);
  const L = fx.ids.lisbon;
  const G = fx.ids.glasto;
  const step = async (name, go) => {
    if (!want(name)) return;
    try {
      await go();
      await shoot(page, name, width, takeErrors);
    } catch (e) {
      console.log(`  ✗ ${name}-${width}: ${e.message.split("\n")[0]}`);
      report.push({ name, width, failed: e.message });
    }
  };

  if (!ended) {
    await step("home", async () => {
      await goPlace(page, "plans", desk);
      await waitAny(page, [`plan-card-${L.slice(2, 8)}`]);
      await sleep(800);
    });
    await step("plan", () => openPlan(page, desk, L));
    await step("approval", async () => {
      await openPlan(page, desk, L);
      await tap(page, "btn-review-7", { timeout: 15000 });
      await waitAny(page, ["screen-approve"]);
      await sleep(1200);
    });
    await step("pay", async () => {
      await openPlan(page, desk, L);
      await tap(page, "btn-pay");
      await waitAny(page, ["screen-pay"]);
      await sleep(600);
      if (await visible(page, "payee-before-0")) {
        await tap(page, "payee-before-0");
        await waitAny(page, ["screen-pay-form"]);
      }
      await sleep(1200);
    });
    await step("send", async () => {
      await goPlace(page, "send", desk);
      await waitAny(page, ["screen-send"]);
      await sleep(1200);
    });
    await step("send-amount", async () => {
      await goPlace(page, "send", desk);
      await waitAny(page, ["screen-send"]);
      await tap(page, `recent-${PEOPLE.sam.address.slice(2, 8)}`, { timeout: 15000 });
      await waitAny(page, ["screen-send-amount"]);
      await sleep(1200);
    });
    await step("activity", async () => {
      await goPlace(page, "activity", desk);
      await waitAny(page, ["screen-activity"]);
      await sleep(1500);
    });
    await step("you", async () => {
      await goPlace(page, "you", desk);
      await waitAny(page, ["screen-you"]);
      await sleep(1000);
    });
    await step("summary", async () => {
      await openPlan(page, desk, G);
      await tap(page, "btn-see-summary");
      await waitAny(page, ["screen-memory"]);
      await sleep(1200);
    });
    // Not reachable by clicking (a settled plan links to its summary, not to /settle): pushState,
    // which may lock the session, so it runs last.
    await step("settled", async () => {
      await pushRoute(page, `/app/plan/${G}/settle`);
      await unlockIfNeeded(page);
      await sleep(2500);
    });
  } else {
    await step("settle", async () => {
      await openPlan(page, desk, L);
      const got = await waitAny(page, ["btn-review-and-settle", "btn-banner-review"], 10000);
      await tap(page, got ?? "btn-review-and-settle");
      await waitAny(page, ["screen-review"]);
      await tap(page, "btn-see-the-settle-up", { timeout: 15000 });
      await waitAny(page, ["screen-settle-preview"]);
      await sleep(1500);
    });
  }
  await ctx.close();
}

async function fresh(browser, width, name, path, waitIds) {
  if (!want(name)) return;
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx, { width, height: width < 700 ? 844 : 900, theme: THEMES[0], mobile: width < 700 });
  const takeErrors = trackErrors(page);
  await serveLocalApp(page);
  await addPasskeyAuthenticator(page);
  await noTestnetWrites(page);
  await installFixtures(page, { balance: 5_000_000n });
  try {
    await page.goto(ORIGIN + path, { waitUntil: "load" });
    await waitAny(page, waitIds);
    await sleep(1500);
    await shoot(page, name, width, takeErrors);
  } catch (e) {
    console.log(`  ✗ ${name}-${width}: ${e.message.split("\n")[0]}`);
  }
  await ctx.close();
}

console.log(`app: ${APP_DIR || "(live site)"}\nout: ${OUT}`);
const browser = await launch();
try {
  for (const width of WIDTHS) {
    console.log(`\n${width} px`);
    await fresh(browser, width, "welcome", "/app", ["screen-welcome"]);
    await fresh(browser, width, "claim", claimPath(), ["screen-claim"]);
    const normal = ["home", "plan", "approval", "pay", "send", "send-amount", "activity", "you", "summary", "settled"];
    if (normal.some(want)) await session(browser, width, { ended: false });
    if (want("settle")) await session(browser, width, { ended: true });
  }
} finally {
  await browser.close();
}
const bad = report.filter((r) => r.failed || r.errors?.length || r.overflow?.doc > 0 || r.overflow?.els.length);
console.log(`\n${report.filter((r) => r.file).length} screenshots, ${bad.length} with problems.`);
