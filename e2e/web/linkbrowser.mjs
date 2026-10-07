// "Link a browser" (designs 165–178) end to end in headless Chrome, between browser contexts, with
// the relayer's slot route answered locally (lib/slots.mjs) and every testnet write blocked
// (noTestnetWrites); plans and balances come from lib/fixtures.mjs. Passkeys are CDP virtual
// authenticators (PRF on), one per context.
//
//   node linkbrowser.mjs [--app-dir DIR] [--widths 1440,390] [--shots DIR] [--themes light,dark]
//
// Checks, per width:
//   - an existing passkey in this browser → "Create account" restores it (no second account)
//   - no passkey → 166, nothing created; option order (phone widths: "Link this browser" first)
//   - a passkey without PRF answers → 176a with "Link with a code" → 168
//   - link with a typed code: wrong code (175), no connection on both sides (175 / 176c), then
//     "They match" → the browser opens the SAME account (address, key fingerprint), vault saved
//   - the code never appears in a request URL, the address bar or history
//   - 175: pictures don't match, code ran out, code already used; 176b code ran out → new code
//   - a link QR opened as an address on the approving device → Unlock → straight to the pictures
//   - the approving device shows "… can now use your account" on its next open
//   - 177 unlock in a linked browser (vault); 178 the browser removes itself (passkey confirmation)
//     → "This browser was removed" and its passkey no longer opens the account; the approving
//     device removes another linked browser
// With --shots, every screen is saved as link-<item>-<width>-<theme>.png.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
if (arg("app-dir")) process.env.APP_DIR = resolve(arg("app-dir"));
const WIDTHS = arg("widths", "1440,390").split(",").map(Number);
const SHOTS = arg("shots") ? resolve(arg("shots")) : null;
const THEMES = arg("themes", "light,dark").split(",");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const { ORIGIN, APP_DIR, addPasskeyAuthenticator, launch, newPage, noTestnetWrites, serveLocalApp, sleep, tap, typeInto, waitFor } = await import("./lib/browser.mjs");
const { installFixtures } = await import("./lib/fixtures.mjs");
const { accountAddress, createAccount, firstVisible, unlockIfNeeded } = await import("./lib/session.mjs");
const { SlotStore, installSlots } = await import("./lib/slots.mjs");

const req = createRequire(resolve(HERE, "../../app/package.json"));
const { xchacha20poly1305 } = req("@noble/ciphers/chacha.js");
const { hkdf } = req("@noble/hashes/hkdf.js");
const { sha256 } = req("@noble/hashes/sha2.js");
const utf8 = (s) => new TextEncoder().encode(s);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const shots = [];

async function shoot(page, name, width) {
  if (!SHOTS) return;
  for (const theme of THEMES) {
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: theme },
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    await sleep(500);
    const file = `${SHOTS}/link-${name}-${width}-${theme}.png`;
    await page.screenshot({ path: file });
    const doc = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    shots.push({ file, overflow: doc });
    console.log(`  shot ${file.split("/").pop()}${doc > 0 ? `  ! page scrolls sideways by ${doc}px` : ""}`);
  }
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: THEMES[0] },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
}

async function person(browser, width, store, { auth = true, prf = true, fixtures = true } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx, { width, height: width < 700 ? 844 : 900, theme: THEMES[0], mobile: width < 700 });
  page.urls = [];
  page.on("request", (r) => page.urls.push(r.url()));
  await serveLocalApp(page);
  await noTestnetWrites(page);
  await installSlots(page, store);
  if (fixtures) await installFixtures(page, { balance: 5_000_000n, myCountry: "GB" });
  if (auth) {
    page.__auth = await addPasskeyAuthenticator(page);
    if (!prf) {
      // A second authenticator without PRF stands in for a provider that gives none.
      await page.__auth.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: page.__auth.authenticatorId });
      const { authenticatorId } = await page.__auth.cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: false, automaticPresenceSimulation: true },
      });
      page.__auth.authenticatorId = authenticatorId;
    }
  }
  return { ctx, page };
}

const visible = (page, id) =>
  page.evaluate((id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].some((el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== "hidden"), id);
const textOf = (page, id) =>
  page.evaluate((id) => {
    for (const el of document.querySelectorAll(`[data-testid="${id}"]`)) if (el.getBoundingClientRect().width > 0) return el.innerText;
    return null;
  }, id);
const topOf = (page, id) =>
  page.evaluate((id) => {
    for (const el of document.querySelectorAll(`[data-testid="${id}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) return r.top;
    }
    return null;
  }, id);
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("plans.kv.plans.account.v1") ?? "null"));
const shiftClock = (page, ms) => page.evaluate((ms) => {
  const real = window.__realNow ?? (window.__realNow = Date.now);
  Date.now = () => real() + ms;
}, ms);

/** The link QR's address, rebuilt from the browser's offer the way a phone's camera would read it (docs/crypto.md §9.1–9.2). */
function qrUrlFromOffer(store, code) {
  const c = code.replace(/-/g, "");
  const s = hkdf(sha256, utf8(c), utf8("plans/v1/link"), utf8("plans/v1/link-secret"), 32);
  const offerSlot = Buffer.from(sha256(new Uint8Array([...utf8("plans/v1/link-offer|"), ...s]))).toString("hex");
  const box = store.bytes(offerSlot);
  const key = hkdf(sha256, s, new Uint8Array(), utf8("plans/v1/link-offer"), 32);
  const pt = JSON.parse(new TextDecoder().decode(xchacha20poly1305(key, box.slice(1, 25), utf8("plans/v1/link-offer")).decrypt(box.slice(25))));
  return `${ORIGIN}/app/link#c=${c}&k=${pt.k}&e=${pt.e}`;
}

/** After a full load the app unlocks by itself (the virtual passkey answers at once); tap Unlock only if it's still waiting. */
async function reach(page, ids, timeout = 25000) {
  let got = await firstVisible(page, ids, { timeout }).catch(() => null);
  if (!got && (await visible(page, "btn-unlock"))) {
    await tap(page, "btn-unlock").catch(() => undefined);
    got = await firstVisible(page, ids, { timeout }).catch(() => null);
  }
  return got;
}

async function goYou(page, width) {
  const tab = width >= 1024 ? "rail-you" : "tab-you";
  for (let i = 0; i < 4 && !(await visible(page, tab)); i++) {
    const out = ["btn-done", "btn-close", "btn-back"];
    let went = false;
    for (const id of out) if (!went && (await visible(page, id))) (await tap(page, id), (went = true));
    if (!went) break;
    await sleep(500);
  }
  await tap(page, tab);
  await waitFor(page, "screen-you");
  await sleep(600);
}

/** Browser side: 166 → 168 → 169. Returns the code and the pictures. */
async function startLink(page, width, { shots: doShots = false } = {}) {
  await page.goto(ORIGIN + "/app", { waitUntil: "load" });
  await tap(page, "btn-create-account");
  await waitFor(page, "screen-link-choice", { timeout: 30000 });
  await tap(page, "btn-link-browser");
  await waitFor(page, "screen-link-save");
  await sleep(500);
  if (doShots) await shoot(page, "168-save", width);
  await tap(page, "btn-save-passkey-here");
  await waitFor(page, "link-waiting");
  await page.waitForFunction(() => /\w{4}-\w{4}-\w{4}/.test(document.querySelector('[data-testid="link-code"]')?.innerText ?? ""), { timeout: 20000 });
  await sleep(400);
  const code = (await textOf(page, "link-code")).trim();
  const pictures = (await textOf(page, "link-pictures")).replace(/\s/g, "");
  return { code, pictures };
}

/** Approving side: You → Add a browser → type the code → 173. */
async function typeCode(page, width, code) {
  await goYou(page, width);
  await tap(page, width >= 1024 ? "btn-link-another-browser" : "row-add-browser");
  if (width < 1024) {
    await waitFor(page, "screen-add-browser-scan");
    await tap(page, "btn-type-code");
  }
  await waitFor(page, "screen-add-browser-type");
  await retype(page, "field-link-code", code.toLowerCase());
  await tap(page, "btn-continue");
}

/** Clears a text field with Backspace (the code field re-formats as it goes) and types. */
async function retype(page, id, text) {
  const el = await waitFor(page, id);
  await el.click();
  await page.keyboard.press("End");
  for (let i = 0; i < 20; i++) await page.keyboard.press("Backspace");
  await el.type(text);
}

async function run(browser, width) {
  console.log(`\n${width} px`);
  const store = new SlotStore();
  const desk = width >= 1024;

  // ── 165: the browser's own dialog is open (no authenticator, so it stays open) ──
  {
    const { ctx, page } = await person(browser, width, store, { auth: false });
    try {
      // Keep the browser's own dialog "open": the passkey request never answers in this context.
      await page.evaluateOnNewDocument(() => {
        if (navigator.credentials) navigator.credentials.get = () => new Promise(() => {});
      });
      await page.goto(ORIGIN + "/app", { waitUntil: "load" });
      await tap(page, "btn-create-account");
      const got = await firstVisible(page, ["welcome-looking-first"], { timeout: 8000 }).catch(() => null);
      check(`${width} 165 says it looks for a passkey first while the dialog is open`, got === "welcome-looking-first");
      await shoot(page, "165-looking", width);
    } finally {
      await ctx.close();
    }
  }

  // ── existing passkey → restore, never a second account ──
  {
    const { ctx, page } = await person(browser, width, store);
    try {
      const first = await createAccount(page, { name: "Maya" });
      const cdp = await page.createCDPSession();
      await cdp.send("Storage.clearDataForOrigin", { origin: ORIGIN, storageTypes: "all" });
      await page.goto(ORIGIN + "/app", { waitUntil: "load" });
      await tap(page, "btn-create-account");
      const got = await firstVisible(page, ["screen-restored", "screen-link-choice", "field-name"], { timeout: 20000 }).catch(() => null);
      const again = await accountAddress(page);
      const creds = (await page.__auth.credentials()).length;
      check(`${width} existing passkey → restored, no second account`, got === "screen-restored" && again === first && creds === 1, `screen=${got} passkeys=${creds}`);
    } finally {
      await ctx.close();
    }
  }

  // ── none found → 166, nothing created ──
  {
    const { ctx, page } = await person(browser, width, store);
    try {
      await page.goto(ORIGIN + "/app", { waitUntil: "load" });
      await tap(page, "btn-create-account");
      const got = await firstVisible(page, ["screen-link-choice", "field-name", "screen-home"], { timeout: 20000 }).catch(() => null);
      const creds = (await page.__auth.credentials()).length;
      const tPhone = await topOf(page, "btn-use-phone");
      const tLink = await topOf(page, "btn-link-browser");
      const tNew = await topOf(page, "btn-new-to-plans");
      const order = desk ? tPhone < tLink && tLink < tNew : tLink < tPhone && tPhone < tNew;
      check(`${width} no passkey → 166, nothing created, ${desk ? "phone's passkey" : "link this browser"} first`, got === "screen-link-choice" && creds === 0 && order && !(await stored(page)), `screen=${got} passkeys=${creds}`);
      await shoot(page, "166-choice", width);
      // Cancel in the browser's QR dialog (here: nothing to pick) → 166 as it was, still nothing made.
      await tap(page, "btn-use-phone");
      await sleep(1500);
      check(`${width} 167 closed → back on 166, nothing made`, (await visible(page, "screen-link-choice")) && (await page.__auth.credentials()).length === 0);
      // Back → 102
      await tap(page, "btn-back");
      check(`${width} 166 Back → Welcome`, !!(await firstVisible(page, ["btn-create-account"], { timeout: 5000 }).catch(() => null)));
    } finally {
      await ctx.close();
    }
  }

  // ── 176a: a passkey that answers without PRF ──
  {
    const { ctx, page } = await person(browser, width, store, { prf: false });
    try {
      // A Plans passkey saved by a provider without PRF (made here with "I'm new" while PRF is off fails), so add one by hand.
      const { generateKeyPairSync, randomBytes } = await import("node:crypto");
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      await page.__auth.cdp.send("WebAuthn.addCredential", {
        authenticatorId: page.__auth.authenticatorId,
        credential: {
          credentialId: randomBytes(16).toString("base64"),
          isResidentCredential: true,
          rpId: "plans.0xo.in",
          privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
          userHandle: randomBytes(16).toString("base64"),
          signCount: 0,
        },
      });
      await page.goto(ORIGIN + "/app", { waitUntil: "load" });
      await tap(page, "btn-create-account");
      const got = await firstVisible(page, ["link-choice-prf-missing", "screen-link-choice", "screen-home", "field-name"], { timeout: 20000 }).catch(() => null);
      check(`${width} 176a: passkey without the keys output → banner + "Link with a code", nothing saved`, got === "link-choice-prf-missing" && !(await stored(page)), `got=${got}`);
      await shoot(page, "176a-prf-missing", width);
      await tap(page, "btn-link-with-code");
      check(`${width} 176a "Link with a code" → 168`, !!(await firstVisible(page, ["screen-link-save"], { timeout: 8000 }).catch(() => null)));
    } finally {
      await ctx.close();
    }
  }

  // ── the approving device ("phone"; the web app here, lead's decision 7) ──
  const P = await person(browser, width, store);
  const B = await person(browser, width, store);
  const C = await person(browser, width, store);
  const B2 = await person(browser, width, store);
  try {
    const phoneAddr = await createAccount(P.page, { name: "Maya", country: "GB", countryName: "United Kingdom", city: "London" });
    const phoneFp = (await stored(P.page)).fingerprint;
    await sleep(2500); // DeviceWatch lists the phone
    if (width < 1024) {
      await goYou(P.page, width);
      check(`${width} 171 You has "Add a browser" with New`, (await visible(P.page, "row-add-browser")) && /New/.test((await textOf(P.page, "row-add-browser")) ?? ""));
      await shoot(P.page, "171-you", width);
    }

    // ── link with a typed code ──
    const { code, pictures } = await startLink(B.page, width, { shots: true });
    await shoot(B.page, "169-code", width);
    const bHref = await B.page.evaluate(() => location.href);
    check(`${width} 169 shows a code and three pictures; the address bar has no code`, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code) && Array.from(pictures).length === 3 && !bHref.includes(code.replace(/-/g, "")) && bHref.endsWith("/app/link"), `${code} ${pictures} ${bHref}`);

    // 172 (scan) shot on phone widths, then a wrong code (175)
    if (width < 1024) {
      await goYou(P.page, width);
      await tap(P.page, "row-add-browser");
      await waitFor(P.page, "screen-add-browser-scan");
      await sleep(800);
      await shoot(P.page, "172-scan", width);
      await tap(P.page, "btn-close");
    }
    await typeCode(P.page, width, "ZZZZ-ZZZZ-ZZZZ");
    check(`${width} 175 wrong code → "That code doesn't match"`, !!(await firstVisible(P.page, ["add-browser-code-error"], { timeout: 10000 }).catch(() => null)));
    await shoot(P.page, "175-wrong-code", width);
    await retype(P.page, "field-link-code", code.replace(/-/g, "").toLowerCase());
    await sleep(200);
    await shoot(P.page, "172-type", width);
    await tap(P.page, "btn-continue");
    await waitFor(P.page, "screen-add-browser-check");
    await sleep(500);
    const pPictures = (await textOf(P.page, "add-browser-pictures")).replace(/\s/g, "");
    const label = await textOf(P.page, "add-browser-device");
    check(`${width} 173 the same three pictures on both screens; the label is a hint`, pPictures === pictures && /Says it's Chrome on a Mac/.test(label ?? ""), `${pPictures} vs ${pictures}; ${label?.split("\n")[0]}`);
    await shoot(P.page, "173-check", width);

    // no connection while sending (175) and while the browser waits (176c)
    store.down = true;
    await tap(P.page, "btn-they-match");
    const off = await firstVisible(P.page, ["add-browser-offline"], { timeout: 15000 }).catch(() => null);
    const bOff = await firstVisible(B.page, ["link-notice-offline"], { timeout: 10000 }).catch(() => null);
    check(`${width} no connection: phone says nothing was sent (175), browser keeps its code (176c)`, off === "add-browser-offline" && bOff === "link-notice-offline");
    await shoot(P.page, "175-offline", width);
    await shoot(B.page, "176c-offline", width);
    store.down = false;
    await tap(B.page, "btn-try-again");
    await tap(P.page, "btn-try-again");
    const sent = await firstVisible(P.page, ["screen-add-browser-sent"], { timeout: 20000 }).catch(() => null);
    check(`${width} 174 sent`, sent === "screen-add-browser-sent" && /Chrome on a Mac can now use your account/.test((await P.page.evaluate(() => document.body.innerText)) ?? ""));
    await shoot(P.page, "174-sent", width);
    await tap(P.page, "btn-done");

    const done = await firstVisible(B.page, ["screen-link-done"], { timeout: 20000 }).catch(() => null);
    await sleep(1500);
    const bStored = await stored(B.page);
    check(
      `${width} 170 the browser opened the SAME account, kept in its vault`,
      done === "screen-link-done" && bStored?.address?.toLowerCase() === phoneAddr && bStored?.fingerprint === phoneFp && bStored?.vault === true && /Maya/.test((await textOf(B.page, "link-done-name")) ?? ""),
      `address ${bStored?.address?.toLowerCase() === phoneAddr ? "same" : "DIFFERENT"}, fingerprint ${bStored?.fingerprint === phoneFp ? "same" : "different"}`,
    );
    await shoot(B.page, "170-linked", width);
    const raw = code.replace(/-/g, "");
    const leaks = [...P.page.urls, ...B.page.urls, ...store.urls].filter((u) => u.toUpperCase().includes(raw) || u.toUpperCase().includes(code));
    const histB = await B.page.evaluate(() => [location.href, history.length]);
    check(`${width} the code is in no request URL, address bar or history entry`, leaks.length === 0 && !String(histB[0]).includes(raw), leaks.slice(0, 2).join(" "));
    check(
      `${width} the relayer only ever got ciphertext (no name, no key in any slot write)`,
      store.bodies.every((b) => !/Maya|London|"a":|addr/.test(Buffer.from(JSON.parse(b).data, "base64url").toString("latin1"))),
    );

    // 175 used / mismatch on the approving side
    await typeCode(P.page, width, code);
    await waitFor(P.page, "screen-add-browser-check");
    await tap(P.page, "btn-they-dont-match");
    check(`${width} 175 "They don't match" → stop, nothing sent`, !!(await firstVisible(P.page, ["screen-add-browser-mismatch"], { timeout: 8000 }).catch(() => null)));
    await shoot(P.page, "175-mismatch", width);
    await tap(P.page, "btn-done");
    await typeCode(P.page, width, code);
    await waitFor(P.page, "screen-add-browser-check");
    await tap(P.page, "btn-they-match");
    check(`${width} 175 an answered code → "already used"`, !!(await firstVisible(P.page, ["screen-add-browser-used"], { timeout: 15000 }).catch(() => null)));
    await shoot(P.page, "175-used", width);
    await tap(P.page, "btn-done");

    await tap(B.page, "btn-go-to-my-plans");
    check(`${width} 170 → home`, !!(await firstVisible(B.page, ["screen-home"], { timeout: 15000 }).catch(() => null)));

    // ── 176b / 175 code ran out ──
    const second = await startLink(B2.page, width);
    await shiftClock(P.page, 11 * 60_000);
    await typeCode(P.page, width, second.code);
    check(`${width} 175 a code that ran out (phone's clock)`, !!(await firstVisible(P.page, ["screen-add-browser-expired"], { timeout: 10000 }).catch(() => null)));
    await shoot(P.page, "175-expired", width);
    await shiftClock(P.page, 0);
    await tap(P.page, "btn-done");
    await shiftClock(B2.page, 11 * 60_000);
    const exp = await firstVisible(B2.page, ["link-notice-expired"], { timeout: 10000 }).catch(() => null);
    check(`${width} 176b the code ran out on the computer, QR greyed, "Make a new code"`, exp === "link-notice-expired" && (await visible(B2.page, "btn-make-new-code")));
    await shoot(B2.page, "176b-expired", width);
    await shiftClock(B2.page, 0);
    await tap(B2.page, "btn-make-new-code");
    await B2.page.waitForFunction((old) => { const t = document.querySelector('[data-testid="link-code"]')?.innerText ?? ""; return /\w{4}-\w{4}-\w{4}/.test(t) && t.trim() !== old; }, { timeout: 15000 }, second.code).catch(() => null);
    const third = (await textOf(B2.page, "link-code"))?.trim();
    check(`${width} 176b → a new code and new pictures`, !!third && third !== second.code && (await visible(B2.page, "link-waiting")));
    await tap(B2.page, "btn-cancel");
    check(`${width} 169 Cancel → 166`, !!(await waitFor(B2.page, "screen-link-choice", { timeout: 8000 }).catch(() => null)));

    // ── a link QR opened as an address on the approving device (a phone's camera app) ──
    const cl = await startLink(C.page, width);
    const qr = qrUrlFromOffer(store, cl.code);
    await P.page.goto(qr, { waitUntil: "load" });
    // the phone's notice for the first browser (its next open), shown for a few seconds after Unlock
    const noticeP = P.page
      .waitForFunction(() => /can now use your account/.test([...document.querySelectorAll('[data-testid="toast"]')].map((e) => e.innerText).join(" ")), { timeout: 40000, polling: 100 })
      .then(() => true)
      .catch(() => false);
    const atCheck = await reach(P.page, ["screen-add-browser-check"]);
    if (!atCheck) {
      await P.page.screenshot({ path: `${SHOTS ?? resolve(HERE, ".runs")}/debug-qr-${width}.png` });
      console.log(P.page.logs.slice(-25).join("\n"));
    }
    const pHref = await P.page.evaluate(() => location.href);
    const qrPics = (await textOf(P.page, "add-browser-pictures"))?.replace(/\s/g, "");
    check(`${width} link QR as an address → Unlock → the pictures; no code left in the address bar`, atCheck === "screen-add-browser-check" && qrPics === cl.pictures && !pHref.includes(cl.code.replace(/-/g, "")) && !pHref.includes("#"), pHref);
    const notice = await noticeP;
    check(`${width} the approving device shows "… can now use your account" on its next open`, notice);
    await tap(P.page, "btn-they-match");
    await firstVisible(P.page, ["screen-add-browser-sent"], { timeout: 20000 }).catch(() => null);
    const cDone = await firstVisible(C.page, ["screen-link-done"], { timeout: 20000 }).catch(() => null);
    check(`${width} the second browser is linked to the same account`, cDone === "screen-link-done" && (await stored(C.page))?.address?.toLowerCase() === phoneAddr);
    await tap(P.page, "btn-done");

    // ── 177 unlock in a linked browser ──
    // The first passkey prompt is "closed" so Unlock stays on screen for its picture.
    const hold = await B.page.evaluateOnNewDocument(() => {
      const real = navigator.credentials.get.bind(navigator.credentials);
      window.__plansRestoreGet = () => (navigator.credentials.get = real);
      navigator.credentials.get = () => Promise.reject(new DOMException("closed", "NotAllowedError"));
    });
    await B.page.reload({ waitUntil: "load" });
    const ul = await firstVisible(B.page, ["unlock-linked"], { timeout: 20000 }).catch(() => null);
    await sleep(1200);
    check(`${width} 177 Unlock says this browser is linked`, ul === "unlock-linked");
    await shoot(B.page, "177-unlock", width);
    await B.page.removeScriptToEvaluateOnNewDocument(hold.identifier);
    await B.page.evaluate(() => window.__plansRestoreGet());
    await tap(B.page, "btn-unlock");
    const home = await reach(B.page, ["screen-home"]);
    if (!home) {
      await B.page.screenshot({ path: `${SHOTS ?? resolve(HERE, ".runs")}/debug-177-${width}.png` });
      console.log(B.page.logs.slice(-12).join("\n"), await B.page.evaluate(() => location.href));
    }
    check(`${width} 177 → home with the same account (from the vault)`, home === "screen-home" && (await accountAddress(B.page)) === phoneAddr);

    // ── 178: the browser removes itself ──
    await sleep(1500);
    await goYou(B.page, width);
    if (desk) {
      await waitFor(B.page, "device-list");
      await shoot(B.page, "178-you", width);
    } else {
      await tap(B.page, "row-phones");
      await waitFor(B.page, "screen-devices");
      await sleep(800);
      await shoot(B.page, "178-devices", width);
    }
    const listText = (await B.page.evaluate(() => document.body.innerText)) ?? "";
    check(`${width} "Devices with your passkey" lists this linked browser`, /Linked · its own passkey/.test(listText) && (await visible(B.page, "btn-remove-this")));
    await tap(B.page, "btn-remove-this");
    await waitFor(B.page, "panel-remove-browser");
    await sleep(400);
    await shoot(B.page, "178-remove", width);
    const vaultsBefore = [...store.slots.values()].filter((s) => Buffer.from(s.data, "base64url").toString("latin1").includes("plans/v1/removed")).length;
    await tap(B.page, "btn-confirm-remove");
    const removed = await firstVisible(B.page, ["welcome-notice-removed"], { timeout: 20000 }).catch(() => null);
    const vaultsAfter = [...store.slots.values()].filter((s) => Buffer.from(s.data, "base64url").toString("latin1").includes("plans/v1/removed")).length;
    check(`${width} 178 remove (passkey confirmation) → "This browser was removed", its vault overwritten`, removed === "welcome-notice-removed" && vaultsAfter === vaultsBefore + 1 && !(await stored(B.page)));
    await shoot(B.page, "178-removed", width);
    // its passkey no longer opens the account
    await tap(B.page, "btn-restore");
    const again = await firstVisible(B.page, ["welcome-notice-removed", "screen-restored", "screen-home"], { timeout: 20000 }).catch(() => null);
    check(`${width} the removed browser's passkey no longer opens the account`, again === "welcome-notice-removed" && !(await stored(B.page)), `got=${again}`);

    // ── the approving device removes the other linked browser ──
    await P.page.goto(ORIGIN + "/app/devices", { waitUntil: "load" });
    await reach(P.page, ["screen-devices"]);
    await P.page.waitForFunction(() => /Linked · its own passkey/.test(document.body.innerText), { timeout: 15000 }).catch(() => null);
    await sleep(600);
    await shoot(P.page, "devices-phone", width);
    const removeBtn = await P.page.evaluate(() => [...document.querySelectorAll('[data-testid^="btn-remove-"]')].filter((e) => e.getBoundingClientRect().width > 0 && e.getAttribute("data-testid") !== "btn-remove-this").map((e) => e.getAttribute("data-testid")));
    if (removeBtn.length) {
      await tap(P.page, removeBtn[0]);
      await waitFor(P.page, "panel-remove-browser");
      await tap(P.page, "btn-confirm-remove");
      const gone = await P.page.waitForFunction(() => /was removed/.test(document.querySelector('[data-testid="toast"]')?.innerText ?? ""), { timeout: 20000 }).then(() => true).catch(() => false);
      check(`${width} the approving device removed the other browser (its own passkey confirmed)`, gone && (await stored(P.page))?.address?.toLowerCase() === phoneAddr);
      await C.page.reload({ waitUntil: "load" });
      const cGone = await firstVisible(C.page, ["welcome-notice-removed", "screen-home"], { timeout: 20000 }).catch(() => null);
      check(`${width} that browser, on its next open: "This browser was removed"`, cGone === "welcome-notice-removed");
    } else check(`${width} the approving device lists the other linked browser with Remove`, false, "no Remove button");
  } finally {
    for (const x of [P, B, C, B2]) await x.ctx.close().catch(() => undefined);
  }
}

console.log(`app: ${APP_DIR || "(live site)"}${SHOTS ? `\nshots: ${SHOTS}` : ""}`);
const browser = await launch();
try {
  for (const w of WIDTHS) {
    try {
      await run(browser, w);
    } catch (e) {
      check(`${w} run`, false, e.stack?.split("\n").slice(0, 3).join(" | "));
    }
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed${SHOTS ? `, ${shots.length} screenshots (${shots.filter((s) => s.overflow > 0).length} scroll sideways)` : ""}`);
process.exit(failed ? 1 : 0);
