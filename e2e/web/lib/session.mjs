// Account helpers for the web harness: create a fresh Plans account on a page that already has
// serveLocalApp + addPasskeyAuthenticator (and, optionally, installFixtures) set up.
import { ORIGIN, sleep, tap, typeInto } from "./browser.mjs";

const sel = (id) => `[data-testid="${id}"]`;

/** Resolves with the first of these testIDs that becomes visible. */
export async function firstVisible(page, ids, { timeout = 30000 } = {}) {
  const handle = await page.waitForFunction(
    (ids) => {
      for (const id of ids) {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none") return id;
      }
      return false;
    },
    { timeout, polling: 100 },
    ids,
  );
  return handle.jsonValue();
}

/**
 * goto /app → Create account → (new-to-Plans choice if the app asks for an existing passkey first)
 * → name (+ country) → Continue → home. Returns the account's address (lowercase).
 * `country` is an ISO code ("GB"); the country sheet is searched by `countryName` or the code.
 */
export async function createAccount(page, { name = "Maya", country, countryName, city, goto = true, timeout = 60000 } = {}) {
  if (goto) await page.goto(ORIGIN + "/app", { waitUntil: "load" });
  await tap(page, "btn-create-account", { timeout });
  // The web create flow may first look for an existing passkey; with an empty virtual authenticator
  // that lookup fails or is cancelled and a choice appears.
  // Wait for the outcome of the first ceremony: the profile form, home, or the choice screen.
  // (Right after the tap, Welcome's own button is still on screen for a moment, so don't act on it.)
  for (let i = 0; i < 40; i++) {
    const got = await firstVisible(page, ["field-name", "screen-home", "btn-new-to-plans", "btn-create-new", "btn-try-again"], { timeout: 1000 }).catch(() => null);
    if (got === "field-name" || got === "screen-home") break;
    if (got === "btn-new-to-plans" || got === "btn-create-new" || got === "btn-try-again") {
      await tap(page, got);
      await page.waitForSelector(sel(got), { hidden: true, timeout }).catch(() => undefined);
    }
  }
  const at = await firstVisible(page, ["field-name", "screen-home"], { timeout });
  if (at === "field-name") {
    await typeInto(page, "field-name", name);
    if (country) {
      await tap(page, "field-country");
      await typeInto(page, "field-country-search", countryName ?? country);
      await sleep(200);
      await tap(page, `country-${country}`);
      await page.waitForSelector(sel("sheet-country"), { hidden: true, timeout: 5000 }).catch(() => undefined);
    }
    if (city) await typeInto(page, "field-city", city);
    await tap(page, "btn-continue");
    await firstVisible(page, ["screen-home"], { timeout });
  }
  return accountAddress(page);
}

/** The stored account address (lowercase), or null. */
export async function accountAddress(page) {
  const a = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("plans.kv.plans.account.v1") ?? "null")?.address ?? null;
    } catch {
      return null;
    }
  });
  return a ? a.toLowerCase() : null;
}

/** If the unlock screen is showing (after a full reload), taps Unlock and waits for it to go. */
export async function unlockIfNeeded(page, { timeout = 30000 } = {}) {
  const showing = await firstVisible(page, ["btn-unlock"], { timeout: 1500 }).catch(() => null);
  if (!showing) return false;
  await tap(page, "btn-unlock");
  await page.waitForFunction(
    () => ![...document.querySelectorAll('[data-testid="screen-unlock"]')].some((e) => e.getBoundingClientRect().width > 0),
    { timeout, polling: 200 },
  );
  return true;
}

/**
 * Client-side navigation inside the SPA (no reload, so the session stays unlocked):
 * history.pushState + popstate, which expo-router (react-navigation's web linking) follows.
 */
export async function pushRoute(page, path) {
  await page.evaluate((p) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}
