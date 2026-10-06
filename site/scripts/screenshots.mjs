// Quality gate: screenshots at desktop 1440 and mobile 390, light and dark, for every page.
// Drives the locally installed Google Chrome with puppeteer-core (no Chromium download).
// Usage: npm run build && npm start (port 3000), then: node scripts/screenshots.mjs [baseUrl] [onlyPageName]
// Output: screenshots/<page>-<width>-<theme>.png. Also fails if any page scrolls horizontally.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] ?? "http://localhost:3000";
const only = process.argv[3];
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
  for (const p of PAGES.filter((p) => !only || p.name === only)) {
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
} finally {
  await browser.close();
}
if (problems.length) {
  console.error("\nProblems:\n" + problems.join("\n"));
  process.exit(1);
}
