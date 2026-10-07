// Shared helpers for driving the Plans web app in headless Chrome.
//
// The app must run on the real origin https://plans.0xo.in: passkeys are bound to the rpId
// plans.0xo.in and the relayer only allows that origin (CORS). Two modes:
//   - local (APP_DIR set, default ../../site/public/app): requests to https://plans.0xo.in/app/* are
//     answered from the local static export by request interception (SPA fallback to index.html).
//     Everything else (relayer, RPC, the landing page) goes to the network as usual.
//   - live (APP_DIR=""): the deployed site is used as is.
// Passkeys come from Chrome's CDP virtual authenticator (ctap2, internal, resident keys, UV, PRF).
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ORIGIN = process.env.PLANS_ORIGIN ?? "https://plans.0xo.in";
export const APP_DIR = process.env.APP_DIR === undefined ? resolve(HERE, "../../../site/public/app") : process.env.APP_DIR;
export const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

export async function launch({ headless = process.env.HEADFUL ? false : true } = {}) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless,
    args: ["--hide-scrollbars", "--no-first-run", "--no-default-browser-check"],
    defaultViewport: null,
  });
}

// ─────────────── request routing ───────────────
//
// Puppeteer resolves an intercepted request once. Rather than several page.on("request") handlers
// racing (which needs cooperative intercept mode), every page gets ONE dispatcher and a list of
// routes. A route is `async (req, url) => response | undefined`: the first route that returns a
// response ({ status, headers, body, contentType }) answers the request; when none does, the
// request goes to the network unchanged. Routes run in the order they were added.
const ROUTES = new WeakMap();

async function ensureDispatcher(page) {
  if (ROUTES.has(page)) return ROUTES.get(page);
  const routes = [];
  ROUTES.set(page, routes);
  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    if (req.isInterceptResolutionHandled?.()) return;
    let url;
    try {
      url = new URL(req.url());
    } catch {
      url = null;
    }
    if (url && url.protocol !== "data:" && url.protocol !== "blob:") {
      for (const r of routes) {
        let res;
        try {
          res = await r(req, url);
        } catch (e) {
          if (process.env.VERBOSE) console.log(`  route error for ${req.url()}: ${e?.stack ?? e}`);
          res = undefined;
        }
        if (res) {
          if (req.isInterceptResolutionHandled?.()) return;
          return req.respond(res).catch(() => undefined);
        }
      }
    }
    if (req.isInterceptResolutionHandled?.()) return;
    return req.continue().catch(() => undefined);
  });
  return routes;
}

/**
 * Adds a request route to this page (see above). Call before page.goto. Returns a function that
 * removes the route again.
 */
export async function route(page, handler, { first = false } = {}) {
  const routes = await ensureDispatcher(page);
  if (first) routes.unshift(handler);
  else routes.push(handler);
  return () => {
    const i = routes.indexOf(handler);
    if (i >= 0) routes.splice(i, 1);
  };
}

/** Answers https://plans.0xo.in/app/* from the local export when APP_DIR is set. */
export async function serveLocalApp(page, appDir = APP_DIR) {
  if (!appDir) return;
  if (!existsSync(join(appDir, "index.html"))) throw new Error(`No web export at ${appDir}. Run app/scripts/build-web.sh first.`);
  await route(page, (req, url) => {
    if (url.origin !== ORIGIN || !(url.pathname === "/app" || url.pathname.startsWith("/app/"))) return undefined;
    let rel = decodeURIComponent(url.pathname.replace(/^\/app\/?/, ""));
    let file = join(appDir, rel);
    if (!rel || !existsSync(file) || statSync(file).isDirectory()) file = join(appDir, "index.html");
    return {
      status: 200,
      headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" },
      body: readFileSync(file),
    };
  });
}

/**
 * Adds a CDP virtual authenticator that behaves like a platform passkey provider with PRF.
 * Returns { cdp, authenticatorId, credentials(), clear() }.
 */
export async function addPasskeyAuthenticator(page) {
  const cdp = await page.createCDPSession();
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    cdp,
    authenticatorId,
    credentials: async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials,
    addCredential: (credential) => cdp.send("WebAuthn.addCredential", { authenticatorId, credential }),
    clear: () => cdp.send("WebAuthn.clearCredentials", { authenticatorId }),
  };
}

export async function newPage(browser, { width = 1440, height = 900, theme = "light", mobile = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: theme },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  const logs = [];
  page.on("console", (m) => {
    const t = m.text();
    logs.push(`[${m.type()}] ${t}`);
    if (process.env.VERBOSE) console.log(`  console.${m.type()}: ${t}`);
  });
  page.on("pageerror", (e) => {
    logs.push(`[pageerror] ${e.message}`);
    if (process.env.VERBOSE) console.log(`  pageerror: ${e.message}`);
  });
  page.logs = logs;
  return page;
}

/**
 * The first VISIBLE element with this testID. Screens stay mounted under the one on top (the router
 * stack, the laptop shell), so the same testID can exist several times with only one showing.
 */
async function visibleByTestId(page, testID, timeout) {
  const h = await page.waitForFunction(
    (id) => {
      for (const el of document.querySelectorAll(`[data-testid="${id}"]`)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const st = getComputedStyle(el);
        if (st.visibility === "hidden" || st.display === "none") continue;
        return el;
      }
      return null;
    },
    { timeout, polling: 100 },
    testID,
  );
  return h.asElement();
}

/** Clicks the (first visible) element with this testID (react-native-web renders testID as data-testid). */
export async function tap(page, testID, { timeout = 30000 } = {}) {
  const el = await visibleByTestId(page, testID, timeout).catch((e) => {
    throw new Error(`Waiting for visible [data-testid="${testID}"] failed: ${e.message.split("\n")[0]}`);
  });
  await el.click();
  return el;
}

export async function waitFor(page, testID, { timeout = 30000 } = {}) {
  return visibleByTestId(page, testID, timeout);
}

export async function typeInto(page, testID, text, { timeout = 30000 } = {}) {
  const el = await visibleByTestId(page, testID, timeout);
  await el.click({ clickCount: 3 });
  await el.type(text);
  return el;
}

export async function waitForText(page, text, { timeout = 30000 } = {}) {
  await page.waitForFunction((t) => document.body && document.body.innerText.includes(t), { timeout }, text);
}

/** The app's PLANS_TIMING marks (performance.mark + console), collected from the page. */
export async function timingMarks(page) {
  return page.evaluate(() => (window.__plansTiming ?? []).slice());
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Answers relayed actions, the faucet and demo starts with "unavailable" (503) so a run makes no
 * testnet writes (screenshots, link checks). The app retries key registration at the next unlock.
 */
export async function noTestnetWrites(page) {
  return route(
    page,
    async (req, url) => {
      if (/relayer/.test(url.hostname) && req.method() === "POST" && /^\/v1\/(relay|faucet|demo)/.test(url.pathname))
        return {
          status: 503,
          headers: { "access-control-allow-origin": "*" },
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "test run: no testnet writes" } }),
        };
      return undefined;
    },
    { first: true },
  );
}
