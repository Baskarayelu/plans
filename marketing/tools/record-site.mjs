// Records the live Plans landing page (real site, real motion) at phone size into a silent, looping
// 1080×1350 MP4 using Chrome's screencast: hero → departures board → world map, then a cross-fade
// back to the first frame.
//   node record-site.mjs <url> <out.mp4>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [url, outPath] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const FPS = 30, FADE = 0.6;
const VW = 432, VH = 540, DSF = 2.5; // 4:5 phone viewport rendered at 1080×1350

const { default: puppeteer } = await import(path.join(REPO, "site/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js"));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: DSF, isMobile: true, hasTouch: true });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "no-preference" }]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plans-site-"));
const frames = [];
const cdp = await page.createCDPSession();
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const file = path.join(tmp, `f${String(frames.length).padStart(4, "0")}.png`);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  frames.push({ file, ts: metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

// load once so fonts and images are cached, then record a fresh load
await page.goto(url, { waitUntil: "networkidle0" });
await page.goto("about:blank");
await cdp.send("Page.startScreencast", { format: "png", maxWidth: VW * DSF, maxHeight: VH * DSF, everyNthFrame: 1 });
await page.goto(url, { waitUntil: "domcontentloaded" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const scrollToText = (txt, offset) =>
  page.evaluate(
    (t, o) => {
      const el = [...document.querySelectorAll("h2,h1")].find((e) => e.textContent.includes(t));
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - o, behavior: "smooth" });
    },
    txt,
    offset,
  );
await wait(3600); // hero: word reveal and floating cards
await scrollToText("One pot each", 70); // departures board
await wait(3400);
await scrollToText("Your pot doesn", 40); // world map
await wait(3600);
await cdp.send("Page.stopScreencast");
await browser.close();

// drop the about:blank frames before the page paints, then build a concat list from real timestamps
const firstReal = frames.findIndex((f) => fs.statSync(f.file).size > 20000);
const used = frames.slice(firstReal);
const t0 = used[0].ts;
const list = used
  .map((f, i) => `file '${f.file}'\nduration ${(((used[i + 1]?.ts ?? f.ts + 1 / FPS) - f.ts)).toFixed(4)}`)
  .join("\n") + `\nfile '${used.at(-1).file}'\n`;
fs.writeFileSync(path.join(tmp, "list.txt"), list);
const bodyLen = used.at(-1).ts - t0 + 1 / FPS;
const body = path.join(tmp, "body.mp4");
const enc = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS), "-crf", "18", "-preset", "slow"];
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"),
  "-vf", `fps=${FPS},scale=1080:1350:flags=lanczos`, ...enc, body]);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", body, "-loop", "1", "-t", String(FADE + 0.1), "-i", used[0].file,
  "-filter_complex", `[0:v]fps=${FPS},settb=1/${FPS},format=yuv420p[m];[1:v]scale=1080:1350,fps=${FPS},settb=1/${FPS},format=yuv420p[a];[m][a]xfade=transition=fade:duration=${FADE}:offset=${(bodyLen - FADE).toFixed(3)},format=yuv420p`,
  "-an", ...enc, "-movflags", "+faststart", outPath]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${outPath}  (${used.length} screencast frames, ${bodyLen.toFixed(2)} s)`);
