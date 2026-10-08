// Post-deploy check: runs against the PUBLIC URL after every deploy of the site and the web app.
//
//   node postdeploy.mjs [--base https://plans.0xo.in] [--out DIR] [--browsers chrome,safari]
//                       [--signed-in] [--only-app]
//
// Chrome (puppeteer-core, local Google Chrome): every page opens in a fresh incognito context with
// the cache off, at desktop 1440×900 and phone 390×844 (mobile emulation), light and dark.
// Safari (safaridriver, W3C WebDriver): fresh automation session per page (Safari's automation
// windows are ephemeral: no cookies, no cache, no extensions), desktop and the narrowest window
// Safari allows, in the system appearance (WebDriver cannot switch it). Needs "Allow remote
// automation" in Safari > Settings > Developer; without it the Safari part FAILS, it is never skipped.
//
// A page FAILS on: any console error or uncaught exception; any failed or 4xx/5xx request to our
// own origin; the expected screen not appearing (blank page); on app pages, any of the 8 app fonts
// not loaded. --signed-in also creates a fresh account (Chrome virtual passkey), starts the demo
// plan and shoots home, plan and pay at both widths and both themes; it makes testnet transactions.
// Exit code 1 if anything failed. Results: <out>/results.json and <out>/*.png.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { addPasskeyAuthenticator, CHROME, sleep } from "./lib/browser.mjs";
import { createAccount, firstVisible } from "./lib/session.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const BASE = opt("--base", process.env.PLANS_ORIGIN ?? "https://plans.0xo.in").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const OUT = resolve(opt("--out", join(HERE, "..", "evidence", "postdeploy", "postdeploy-" + new Date().toISOString().replace(/[:.]/g, "-"))));
const BROWSERS = opt("--browsers", "chrome,safari").split(",");
const SIGNED_IN = args.includes("--signed-in");
const ONLY_APP = args.includes("--only-app");
mkdirSync(OUT, { recursive: true });

const APP_FONTS = [
  "BricolageGrotesque_700Bold",
  "BricolageGrotesque_800ExtraBold",
  "Figtree_400Regular",
  "Figtree_500Medium",
  "Figtree_600SemiBold",
  "Figtree_700Bold",
  "IBMPlexMono_500Medium",
  "IBMPlexMono_600SemiBold",
];

// A page is identified by what must be on screen: a testID (app) or a CSS selector (site).
const SITE_PAGES = [
  { name: "landing", path: "/", expect: { css: "h1" } },
  { name: "download", path: "/download", expect: { css: "h1" } },
  { name: "stats", path: "/stats", expect: { css: "h1" } },
  { name: "docs", path: "/docs", expect: { css: "h1" } },
];
const APP_PAGES = [
  { name: "app-root", path: "/app/", expect: { id: "screen-welcome" }, app: true },
  { name: "app-welcome", path: "/app/welcome", expect: { id: "screen-welcome" }, app: true },
  // A broken invite: exercises the link handling with no network writes.
  { name: "app-invite-dead", path: "/app/j/0x0000000000000000000000000000000000000001#s=AA", expect: { id: "screen-join-dead" }, app: true },
];
const PAGES = ONLY_APP ? APP_PAGES : [...SITE_PAGES, ...APP_PAGES];
const VIEWPORTS = [
  { key: "1440", width: 1440, height: 900, mobile: false },
  { key: "390", width: 390, height: 844, mobile: true },
];
const THEMES = ["light", "dark"];

const results = [];
const own = (u) => {
  try {
    return new URL(u).origin === ORIGIN;
  } catch {
    return false;
  }
};

function record(r) {
  results.push(r);
  const tag = r.ok ? "PASS" : "FAIL";
  console.log(`${tag}  ${r.browser} ${r.page} ${r.viewport} ${r.theme}${r.ok ? "" : "\n      " + r.problems.join("\n      ")}`);
}

/** In-page checks shared by both browsers: expected screen, not blank, fonts, captured errors, resources. */
const PAGE_PROBE = `
  const exp = arguments[0], fonts = arguments[1];
  const sel = exp.id ? '[data-testid="' + exp.id + '"]' : exp.css;
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const found = Array.from(document.querySelectorAll(sel)).some(vis);
  const text = (document.body && document.body.innerText || "").trim().length;
  // App fonts: all registered, none failed, and every one that visible text uses is loaded (browsers
  // only download a face when text uses it, so unused weights may still be "unloaded").
  const faces = Array.from(document.fonts || []);
  const fam = (f) => String(f.family || "").replace(/["']/g, "");
  const used = new Set();
  for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 4000)) {
    if (!el.childNodes.length || !Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    used.add(getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim());
  }
  const missingFonts = fonts.length ? fonts.filter((f) => {
    const mine = faces.filter((x) => fam(x) === f);
    if (!mine.length) return true;
    if (mine.some((x) => x.status === "error")) return true;
    return used.has(f) && !mine.some((x) => x.status === "loaded");
  }) : [];
  const resources = performance.getEntriesByType("resource").map((e) => ({ name: e.name, status: e.responseStatus || 0 }));
  return { found, text, missingFonts, errors: window.__plansErrors || null, resources, width: innerWidth, scheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", url: location.href };
`;

async function statusOf(url) {
  try {
    const r = await fetch(url, { method: "GET", cache: "no-store", redirect: "manual" });
    return r.status;
  } catch (e) {
    return 0;
  }
}

// ───────────────────────── Chrome ─────────────────────────
async function chromePage(browser, vp, theme) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.mobile ? 2 : 1, isMobile: vp.mobile, hasTouch: vp.mobile });
  if (vp.mobile) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console error: ${m.text().slice(0, 240)}`);
  });
  page.on("pageerror", (e) => problems.push(`uncaught: ${String(e.message ?? e).slice(0, 240)}`));
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText;
    if (why === "net::ERR_ABORTED") return;
    // Own origin: always a failure. Elsewhere: named here so the matching console error is explained.
    problems.push(`request failed: ${r.url().split("?")[0]} (${why})${own(r.url()) ? "" : " [other origin]"}`);
  });
  page.on("response", (r) => {
    if (own(r.url()) && r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return { ctx, page, problems };
}

async function probeChrome(page, p, problems) {
  const sel = p.expect.id ? `[data-testid="${p.expect.id}"]` : p.expect.css;
  await page.waitForSelector(sel, { visible: true, timeout: 20000 }).catch(() => undefined);
  if (p.app) await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await sleep(1500); // late requests and errors
  const r = await page.evaluate(new Function(PAGE_PROBE), p.expect, p.app ? APP_FONTS : []);
  if (!r.found) problems.push(`expected ${p.expect.id ?? p.expect.css} not on screen (blank or wrong page) at ${r.url}`);
  if (r.text < 10) problems.push(`page has almost no text (${r.text} chars): blank`);
  if (r.missingFonts.length) problems.push(`fonts not loaded: ${r.missingFonts.join(", ")}`);
  return r;
}

async function runChrome() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars", "--no-first-run", "--no-default-browser-check"] });
  try {
    for (const p of PAGES) {
      for (const vp of VIEWPORTS) {
        for (const theme of THEMES) {
          const { ctx, page, problems } = await chromePage(browser, vp, theme);
          try {
            await page.goto(BASE + p.path, { waitUntil: "networkidle2", timeout: 45000 }).catch((e) => problems.push(`load: ${e.message}`));
            await probeChrome(page, p, problems);
            const shot = join(OUT, `chrome-${p.name}-${vp.key}-${theme}.png`);
            await page.screenshot({ path: shot });
            record({ browser: "chrome", page: p.name, viewport: vp.key, theme, ok: problems.length === 0, problems, shot });
          } finally {
            await ctx.close();
          }
        }
      }
    }
    if (SIGNED_IN) await signedIn(browser);
  } finally {
    await browser.close();
  }
}

/** Fresh account → demo plan → home, plan, pay; each shot at both themes. Testnet writes. */
async function signedIn(browser) {
  for (const vp of VIEWPORTS) {
    const { ctx, page, problems } = await chromePage(browser, vp, "light");
    const shots = [];
    const step = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        problems.push(`${name}: ${String(e.message ?? e).slice(0, 240)}`);
        throw e;
      }
    };
    const shoot = async (name) => {
      for (const theme of THEMES) {
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
        await sleep(600);
        const f = join(OUT, `chrome-live-${name}-${vp.key}-${theme}.png`);
        await page.screenshot({ path: f });
        shots.push(f);
      }
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    };
    try {
      await addPasskeyAuthenticator(page);
      await step("welcome", async () => {
        await page.goto(BASE + "/app/", { waitUntil: "networkidle2" });
        await firstVisible(page, ["screen-welcome"], { timeout: 20000 });
        await shoot("welcome");
      });
      await step("create account", async () => {
        await createAccount(page, { name: "Check", goto: false, timeout: 60000 });
        await firstVisible(page, ["screen-home"], { timeout: 60000 });
        await sleep(2500);
        await shoot("home");
      });
      await step("demo plan", async () => {
        const id = await firstVisible(page, ["row-try-settle-up", "btn-start-demo"], { timeout: 20000 });
        await page.click(`[data-testid="${id}"]`);
        const s = await firstVisible(page, ["btn-start-the-demo", "demo-disabled"], { timeout: 20000 });
        if (s === "demo-disabled") throw new Error("demo is disabled on the relayer");
        await sleep(1000);
        await page.click('[data-testid="btn-start-the-demo"]');
        await firstVisible(page, ["plan-home"], { timeout: 90000 });
        await sleep(3000);
        await shoot("plan");
      });
      await step("pay", async () => {
        await page.click('[data-testid="btn-pay"]');
        await firstVisible(page, ["screen-pay", "screen-pay-form"], { timeout: 20000 });
        await sleep(1500);
        await shoot("pay");
      });
    } catch {
      // recorded in problems
    } finally {
      record({ browser: "chrome", page: "signed-in (welcome, home, plan, pay)", viewport: vp.key, theme: "light+dark", ok: problems.length === 0, problems, shots });
      await ctx.close();
    }
  }
}

// ───────────────────────── Safari ─────────────────────────
async function wd(base, method, path, body) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.value?.message ?? `WebDriver ${method} ${path}: ${r.status}`);
  return j.value;
}

async function runSafari() {
  const port = 4600 + Math.floor(Math.random() * 300);
  const drv = spawn("/usr/bin/safaridriver", ["-p", String(port)], { stdio: "ignore" });
  const base = `http://localhost:${port}`;
  try {
    for (let i = 0; i < 30; i++) {
      if ((await fetch(base + "/status").then((r) => r.ok).catch(() => false))) break;
      await sleep(200);
    }
    const SAFARI_VPS = [
      { key: "1440", width: 1440, height: 900 },
      { key: "390", width: 390, height: 844 },
    ];
    for (const p of PAGES) {
      for (const vp of SAFARI_VPS) {
        const problems = [];
        let sid = null;
        let r = null;
        let shot = null;
        try {
          sid = (await wd(base, "POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } })).sessionId;
          await wd(base, "POST", `/session/${sid}/window/rect`, { width: vp.width, height: vp.height + 80 });
          await wd(base, "POST", `/session/${sid}/url`, { url: BASE + p.path });
          for (let i = 0; i < 40; i++) {
            r = await wd(base, "POST", `/session/${sid}/execute/sync`, { script: PAGE_PROBE, args: [p.expect, p.app ? APP_FONTS : []] });
            if (r.found && !r.missingFonts.length) break;
            await sleep(500);
          }
          await sleep(1500);
          r = await wd(base, "POST", `/session/${sid}/execute/sync`, { script: PAGE_PROBE, args: [p.expect, p.app ? APP_FONTS : []] });
          if (!r.found) problems.push(`expected ${p.expect.id ?? p.expect.css} not on screen (blank or wrong page)`);
          if (r.text < 10) problems.push(`page has almost no text (${r.text} chars): blank`);
          if (r.missingFonts.length) problems.push(`fonts not loaded: ${r.missingFonts.join(", ")}`);
          if (r.errors === null) problems.push("error capture missing (window.__plansErrors): the deployed HTML is not the current build");
          for (const e of r.errors ?? []) problems.push(`${e.t}: ${e.m}`);
          // Every resource from our origin must answer below 400 (Safari has no network log over WebDriver).
          const mine = [...new Set(r.resources.filter((x) => own(x.name)).map((x) => x.name))];
          for (const u of mine) {
            const st = r.resources.find((x) => x.name === u)?.status || (await statusOf(u));
            if (st >= 400 || st === 0) problems.push(`HTTP ${st || "failed"}: ${u}`);
          }
          if (vp.key === "390" && r.width > 420) problems.push(`Safari would not narrow below ${r.width}px; phone width not tested in Safari`);
          shot = join(OUT, `safari-${p.name}-${vp.key}-${r.scheme}.png`);
          writeFileSync(shot, Buffer.from(await wd(base, "GET", `/session/${sid}/screenshot`), "base64"));
        } catch (e) {
          problems.push(`safari: ${String(e.message ?? e).slice(0, 300)}`);
        } finally {
          if (sid) await wd(base, "DELETE", `/session/${sid}`).catch(() => undefined);
        }
        record({ browser: "safari", page: p.name, viewport: vp.key, theme: r?.scheme ?? "?", ok: problems.length === 0, problems, shot, width: r?.width });
      }
    }
  } finally {
    drv.kill();
  }
}

/** Static files the app depends on: the service worker must be JavaScript with its scope header. */
async function runStatic() {
  const problems = [];
  const r = await fetch(BASE + "/app/sw.js", { cache: "no-store" }).catch((e) => ({ ok: false, status: 0, headers: new Headers(), err: e }));
  const type = r.headers.get("content-type") ?? "";
  if (r.status !== 200) problems.push(`/app/sw.js HTTP ${r.status}`);
  if (!/javascript/.test(type)) problems.push(`/app/sw.js content-type "${type}" (expected JavaScript)`);
  if (r.headers.get("service-worker-allowed") !== "/app") problems.push(`/app/sw.js Service-Worker-Allowed "${r.headers.get("service-worker-allowed")}" (expected /app)`);
  const m = await fetch(BASE + "/app/manifest.webmanifest", { cache: "no-store" }).catch(() => ({ status: 0 }));
  if (m.status !== 200) problems.push(`/app/manifest.webmanifest HTTP ${m.status}`);
  record({ browser: "http", page: "sw.js + manifest", viewport: "-", theme: "-", ok: problems.length === 0, problems });
}

const started = Date.now();
await runStatic();
if (BROWSERS.includes("chrome")) await runChrome();
if (BROWSERS.includes("safari")) await runSafari();
const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, "results.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed · ${OUT}`);
process.exit(failed.length ? 1 : 0);
