// Web link entry and reload checks. No testnet transactions: the indexer, relayer reads and RPC
// balance are answered by fixtures (lib/fixtures.mjs); only the passkey is real (virtual authenticator).
//
//   node links.mjs [--app-dir DIR] [--width 390|1440]
//
// Checks:
//   1. Plans links opened in a browser reach their screen (never "Unmatched Route"), and the secret in
//      "#" is gone from the address bar and from history:
//        /app/j/<pot>#s=…&n=…   /app/v/<pot>#s=…   /app/join#pot=…&s=…   /app/c/1#k=…   /app/claim#k=…   /app/p/<addr>#n=…
//        /app/link#c=…&k=…&e=… (a link-this-browser QR; the full flow is in linkbrowser.mjs)
//   2. An invite whose secret isn't a usable key (all zeros, short) shows the "stopped working" state, no crash.
//   3. Reloading a deep route with a stored account goes through Unlock and comes back to that route.
//   4. Client-side navigation (pushState + popstate) keeps the session unlocked.
import { createHash } from "node:crypto";
import { ORIGIN, addPasskeyAuthenticator, launch, newPage, noTestnetWrites, serveLocalApp, sleep } from "./lib/browser.mjs";
import { POTS, installFixtures } from "./lib/fixtures.mjs";
import { createAccount, firstVisible, pushRoute } from "./lib/session.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? d : args[i + 1];
};
const APP_DIR = opt("app-dir", process.env.APP_DIR);
const WIDTH = Number(opt("width", 390));
const b64u = (b) => Buffer.from(b).toString("base64url");
const SECRET = b64u(createHash("sha256").update("plans.e2e.links|invite").digest());
const KEY = b64u(createHash("sha256").update("plans.e2e.links|claim").digest());
const ADDR = "0x" + "5a".repeat(20);
const LINK_CODE = "K7Q29RXDM4TA";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function fresh(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx, { width: WIDTH, height: WIDTH < 700 ? 844 : 900, mobile: WIDTH < 700 });
  await serveLocalApp(page, APP_DIR);
  await noTestnetWrites(page); // no testnet writes from these checks
  await installFixtures(page);
  page.__auth = await addPasskeyAuthenticator(page);
  return { ctx, page };
}

async function where(page) {
  return page.evaluate(() => ({ href: location.href, path: location.pathname + location.search, hash: location.hash, text: document.body.innerText.slice(0, 4000) }));
}

const browser = await launch();
try {
  // 1. Links, opened with no account in the browser.
  const cases = [
    { name: "invite /app/j/<pot>#s=", url: `/app/j/${POTS.lisbon}#s=${SECRET}&n=Maya`, path: `/app/join?pot=${POTS.lisbon}&n=Maya`, screen: ["screen-join", "screen-join-dead"], secret: SECRET },
    { name: "shared plan /app/v/<pot>#s=", url: `/app/v/${POTS.lisbon}#s=${SECRET}&n=Maya`, path: `/app/join?pot=${POTS.lisbon}&n=Maya`, screen: ["screen-join", "screen-join-dead"], secret: SECRET },
    { name: "invite alias /app/join#pot=&s=", url: `/app/join#pot=${POTS.lisbon}&s=${SECRET}`, path: `/app/join?pot=${POTS.lisbon}`, screen: ["screen-join", "screen-join-dead"], secret: SECRET },
    { name: "claim /app/c/1#k=", url: `/app/c/1#k=${KEY}&n=Ben&a=25000000`, path: `/app/claim?n=Ben&a=25000000`, screen: ["screen-claim"], secret: KEY },
    { name: "claim alias /app/claim#k=", url: `/app/claim#k=${KEY}&n=Ben`, path: `/app/claim?n=Ben`, screen: ["screen-claim"], secret: KEY },
    { name: "Plans code /app/p/<addr>#n=", url: `/app/p/${ADDR}#n=Sam&cc=US`, path: null, screen: ["screen-welcome", "screen-send-amount", "screen-amount"], secret: null },
    // "Link this browser" QR opened as an address in a browser without the account: Add a browser explains; the code is gone from the bar.
    { name: "link QR /app/link#c=&k=&e=", url: `/app/link#c=${LINK_CODE}&k=${b64u(new Uint8Array(32).fill(7))}&e=${Math.floor(Date.now() / 1000) + 600}`, path: "/app/add-browser", screen: ["screen-add-browser-none"], secret: LINK_CODE },
  ];
  for (const c of cases) {
    const { ctx, page } = await fresh(browser);
    try {
      await page.goto(ORIGIN + c.url, { waitUntil: "load" });
      const got = await firstVisible(page, [...c.screen, "screen-join-dead"], { timeout: 20000 }).catch(() => null);
      await sleep(600); // let the router settle (the old bug restored the original URL ~40 ms later)
      const w = await where(page);
      const unmatched = /Unmatched Route|This screen doesn't exist/i.test(w.text);
      const leaked = c.secret ? w.href.includes(c.secret) : false;
      const backLeak = c.secret
        ? await page.evaluate(async (s) => {
            // The replaced entry is the only one: going back leaves the app (about:blank), never the secret URL.
            return history.length <= 2 && !location.href.includes(s);
          }, c.secret)
        : true;
      const pathOk = c.path ? w.path === c.path : !w.href.includes("#");
      check(c.name, !!got && !unmatched && !leaked && backLeak && pathOk && !w.hash, `screen=${got} at ${w.path}${w.hash}`);
    } finally {
      await ctx.close();
    }
  }

  // 2. Incomplete invites.
  for (const [name, s] of [
    ["invite with an all-zero secret", b64u(new Uint8Array(32))],
    ["invite with a short secret", b64u(new Uint8Array(7).fill(3))],
    ["invite with no secret", ""],
  ]) {
    const { ctx, page } = await fresh(browser);
    try {
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${ORIGIN}/app/j/${POTS.lisbon}${s ? `#s=${s}` : ""}`, { waitUntil: "load" });
      const got = await firstVisible(page, ["screen-join-dead", "screen-join"], { timeout: 20000 }).catch(() => null);
      check(name, got === "screen-join-dead" && errors.length === 0, `screen=${got}${errors.length ? " errors: " + errors.join("; ") : ""}`);
    } finally {
      await ctx.close();
    }
  }

  // 3 + 4. Reload a deep route → Unlock → back to it; pushState navigation keeps the session.
  {
    const { ctx, page } = await fresh(browser);
    try {
      await createAccount(page, { name: "Maya" }).catch(async (e) => {
        await page.screenshot({ path: "/tmp/plans-links-fail.png" });
        console.log(page.url(), page.logs.slice(-15).join("\n"));
        throw e;
      });
      await pushRoute(page, `/app/plan/${POTS.lisbon}`);
      await sleep(1500);
      const unlockedStill = !(await page.$('[data-testid="screen-unlock"]')) && !(await page.$('[data-testid="btn-unlock-receipts"]'));
      const st = await page.evaluate(() => location.pathname);
      check("pushState navigation keeps the session unlocked", unlockedStill && st === `/app/plan/${POTS.lisbon}`, st);

      await page.reload({ waitUntil: "load" });
      const got = await firstVisible(page, ["screen-unlock"], { timeout: 20000 }).catch(() => null);
      const w1 = await where(page);
      check("reload on a deep route shows Unlock", got === "screen-unlock", `${w1.path}`);
      if (got) {
        // Unlock asks for the passkey by itself when it opens; the button is only there if that was closed.
        const btn = await page.waitForSelector('[data-testid="btn-unlock"]', { visible: true, timeout: 3000 }).catch(() => null);
        if (btn && (await page.evaluate(() => location.pathname === "/app/unlock"))) await btn.click().catch(() => {});
        await page.waitForFunction((p) => location.pathname === p, { timeout: 20000 }, `/app/plan/${POTS.lisbon}`).catch(() => null);
        const w2 = await where(page);
        check("after Unlock, back on the same route", w2.path.startsWith(`/app/plan/${POTS.lisbon}`), w2.path);
      }
    } finally {
      await ctx.close();
    }
  }
  // 5. Never a second account: with a Plans passkey already in this browser's password manager,
  //    "Create account" (after clearing site data) picks it up instead of making a new one.
  {
    const { ctx, page } = await fresh(browser);
    try {
      const auth = page.__auth;
      const first = await createAccount(page, { name: "Maya" });
      const cdp = await page.createCDPSession();
      await cdp.send("Storage.clearDataForOrigin", { origin: ORIGIN, storageTypes: "all" });
      await page.goto(ORIGIN + "/app", { waitUntil: "load" });
      await (await page.waitForSelector('[data-testid="btn-create-account"]', { visible: true })).click();
      const got = await firstVisible(page, ["screen-restored", "field-name", "btn-new-to-plans", "screen-home"], { timeout: 20000 }).catch(() => null);
      const again = await page.evaluate(() => JSON.parse(localStorage.getItem("plans.kv.plans.account.v1") ?? "null")?.address?.toLowerCase() ?? null);
      const creds = (await auth.credentials()).length;
      check("Create account with an existing passkey restores it (no second account)", got === "screen-restored" && again === first && creds === 1, `screen=${got} same=${again === first} passkeys=${creds}`);
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
