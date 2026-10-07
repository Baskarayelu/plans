// Quality gate: screenshots at desktop 1440 and mobile 390, light and dark, for every page.
// Drives the locally installed Google Chrome with puppeteer-core (no Chromium download).
// Usage: PLANS_FIXTURES=1 npm run build && PLANS_FIXTURES=1 npm start (port 3000), then:
//   node scripts/screenshots.mjs [baseUrl] [onlyPageName[,another…]]
// PLANS_FIXTURES=1 serves the local mock plans (lib/plans-fixtures.ts) for the /v and /s pages; it is never
// active on a Vercel production deployment.
// Output: screenshots/<page>-<width>-<theme>.png, plus proof-og-1200x630.png (the /s link preview).
// Also fails if any page scrolls horizontally.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] ?? "http://localhost:3000";
const only = process.argv[3]?.split(",");

// Must match lib/plans-fixtures.ts.
const FIXTURE_SHARED_POT = "0x7e57000000000000000000000000000000000a01";
const FIXTURE_PROOF_POT = "0x7e57000000000000000000000000000000000a02";
const FIXTURE_SECRET = createHash("sha256").update("plans.site.fixture|invite").digest("base64url");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const PAGES = [
  { name: "landing", path: "/", fullPage: true },
  { name: "download", path: "/download", fullPage: true },
  { name: "invite", path: "/j/lis-7Kq2#not-a-real-secret", fullPage: true },
  { name: "claim", path: "/c/8fK2wq#not-a-real-secret", fullPage: false },
  { name: "stats", path: "/stats", fullPage: true },
  { name: "docs", path: "/docs", fullPage: false },
  { name: "docs-how-plans-works", path: "/docs/how-plans-works", fullPage: false },
  { name: "docs-why-monad", path: "/docs/why-monad", fullPage: false },
  { name: "docs-without-the-relayer", path: "/docs/without-the-relayer", fullPage: false },
  { name: "shared-plan", path: `/v/${FIXTURE_SHARED_POT}#s=${FIXTURE_SECRET}&n=Maya`, fullPage: true },
  { name: "shared-plan-missing-secret", path: `/v/${FIXTURE_SHARED_POT}`, fullPage: true },
  { name: "proof", path: `/s/${FIXTURE_PROOF_POT}`, fullPage: true },
  { name: "proof-with-name", path: `/s/${FIXTURE_PROOF_POT}#n=${encodeURIComponent("Lisbon, 12–16 Oct")}`, fullPage: true },
  // Not a fixture: with no NEXT_PUBLIC_ENVIO_GRAPHQL_URL this shows the "can't load right now" state.
  { name: "shared-plan-unavailable", path: `/v/0x${"1".repeat(40)}#s=x`, fullPage: false },
  { name: "web-app", path: "/app", fullPage: false },
];
const SIZES = [
  { width: 1440, height: 900, mobile: false },
  { width: 390, height: 844, mobile: true },
];
const THEMES = ["light", "dark"];

mkdirSync(join(root, "screenshots"), { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
const problems = [];
try {
  for (const p of PAGES.filter((p) => !only || only.includes(p.name))) {
    for (const s of SIZES) {
      for (const theme of THEMES) {
        const page = await browser.newPage();
        await page.setViewport({ width: s.width, height: s.height, deviceScaleFactor: 1, isMobile: s.mobile, hasTouch: s.mobile });
        await page.emulateMediaFeatures([
          { name: "prefers-color-scheme", value: theme },
          // screenshots show the settled state of every animation
          { name: "prefers-reduced-motion", value: "reduce" },
        ]);
        await page.goto(base + p.path, { waitUntil: "load", timeout: 60000 });
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        if (p.fullPage) {
          // trigger in-view effects, then return to the top
          await page.evaluate(async () => {
            for (let y = 0; y < document.body.scrollHeight; y += 600) {
              window.scrollTo(0, y);
              await new Promise((r) => setTimeout(r, 40));
            }
            window.scrollTo(0, 0);
          });
        }
        await new Promise((r) => setTimeout(r, 400));
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 0) problems.push(`${p.name} ${s.width} ${theme}: horizontal overflow ${overflow}px`);
        const file = join(root, "screenshots", `${p.name}-${s.width}-${theme}.png`);
        await page.screenshot({ path: file, fullPage: p.fullPage });
        console.log("✓", file.replace(root + "/", ""), overflow > 0 ? `(overflow ${overflow}px)` : "");
        await page.close();
      }
    }
  }
  if (!only || only.includes("proof-og")) {
    // The link preview /s/<pot> advertises in its og:image meta tag.
    const page = await browser.newPage();
    await page.goto(`${base}/s/${FIXTURE_PROOF_POT}`, { waitUntil: "load" });
    const og = await page.$eval('meta[property="og:image"]', (m) => m.getAttribute("content"));
    await page.close();
    const res = await fetch(new URL(new URL(og).pathname + new URL(og).search, base));
    if (!res.ok || res.headers.get("content-type") !== "image/png") problems.push(`proof-og: ${res.status} ${res.headers.get("content-type")}`);
    const file = join(root, "screenshots", "proof-og-1200x630.png");
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log("✓", file.replace(root + "/", ""));
  }
} finally {
  await browser.close();
}
if (problems.length) {
  console.error("\nProblems:\n" + problems.join("\n"));
  process.exit(1);
}
