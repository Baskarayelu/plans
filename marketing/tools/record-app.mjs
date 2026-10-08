// Records the live Plans web app (plans.0xo.in/app, real screens, real taps) at phone size into a
// silent, looping 1080×1350 MP4 with Chrome's screencast, then cross-fades the end into the first frame.
// Chrome gets an empty virtual passkey authenticator (CDP WebAuthn), so "Create account" really asks
// the browser for an existing Plans passkey, finds none and shows the choice screen. No passkey is
// created, no account is made and nothing is sent onchain.
//   node record-app.mjs <welcome|link> <out.mp4> [base=https://plans.0xo.in/app]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [scenario, outPath, base = "https://plans.0xo.in/app"] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const FPS = 30, FADE = 0.6;
const VW = 432, VH = 540, DSF = 2.5; // 4:5 phone viewport rendered at 1080×1350
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SCENARIOS = {
  // Welcome → Create account → the browser has no Plans passkey → "Use Plans on another phone already?"
  welcome: {
    url: base,
    async run(page) {
      await page.waitForSelector('[data-testid="screen-welcome"]');
      await wait(4200);
      await page.tap('[data-testid="btn-create-account"]');
      await page.waitForSelector('[data-testid="screen-link-choice"]', { timeout: 15000 });
      await wait(4200);
    },
  },
  // Choice screen → "Link this browser to your account" → step 1 of 3 ("Save a passkey for this browser")
  link: {
    url: `${base}/welcome?choose=1`,
    async run(page) {
      await page.waitForSelector('[data-testid="screen-link-choice"]', { timeout: 15000 });
      await wait(2600);
      await page.tap('[data-testid="btn-link-browser"]');
      await page.waitForSelector('[data-testid="screen-link-save"]', { timeout: 15000 });
      await wait(6400);
    },
  },
};
const sc = SCENARIOS[scenario];
if (!sc || !outPath) throw new Error("usage: node record-app.mjs <welcome|link> <out.mp4> [base]");

const { default: puppeteer } = await import(path.join(REPO, "site/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js"));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: DSF, isMobile: true, hasTouch: true });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "no-preference" }]);
const cdp = await page.createCDPSession();
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true },
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plans-app-"));
const frames = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const file = path.join(tmp, `f${String(frames.length).padStart(4, "0")}.png`);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  frames.push({ file, ts: metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

// load once so fonts and bundles are cached, then record a fresh load
await page.goto(sc.url, { waitUntil: "networkidle0" });
await page.goto("about:blank");
await cdp.send("Page.startScreencast", { format: "png", maxWidth: VW * DSF, maxHeight: VH * DSF, everyNthFrame: 1 });
await page.goto(sc.url, { waitUntil: "domcontentloaded" });
await sc.run(page);
// the screencast only sends a frame when the screen changes, so hold the last one until now
const endTs = Date.now() / 1000;
await cdp.send("Page.stopScreencast");
await browser.close();

// drop frames before the app paints, then build a concat list from real timestamps
const firstReal = frames.findIndex((f) => fs.statSync(f.file).size > 20000);
const used = frames.slice(firstReal);
const t0 = used[0].ts;
const list =
  used.map((f, i) => `file '${f.file}'\nduration ${((used[i + 1]?.ts ?? Math.max(endTs, f.ts + 1 / FPS)) - f.ts).toFixed(4)}`).join("\n") +
  `\nfile '${used.at(-1).file}'\n`;
fs.writeFileSync(path.join(tmp, "list.txt"), list);
const bodyLen = Math.max(endTs, used.at(-1).ts + 1 / FPS) - t0;
if (bodyLen > 15) throw new Error(`clip would be ${bodyLen.toFixed(1)} s`);
const body = path.join(tmp, "body.mp4");
const enc = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS), "-crf", "18", "-preset", "slow"];
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"),
  "-vf", `fps=${FPS},scale=1080:1350:flags=lanczos`, ...enc, body]);
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", body, "-loop", "1", "-t", String(FADE + 0.1), "-i", used[0].file,
  "-filter_complex", `[0:v]fps=${FPS},settb=1/${FPS},format=yuv420p[m];[1:v]scale=1080:1350,fps=${FPS},settb=1/${FPS},format=yuv420p[a];[m][a]xfade=transition=fade:duration=${FADE}:offset=${(bodyLen - FADE).toFixed(3)},format=yuv420p`,
  "-an", ...enc, "-movflags", "+faststart", outPath]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${outPath}  (${used.length} screencast frames, ${bodyLen.toFixed(2)} s)`);
