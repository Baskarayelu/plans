// Renders a real asciinema recording (v3 .cast) into a silent, looping 1080×1350 MP4 for phone feeds.
// The terminal output is replayed byte for byte through xterm.js; only the timing is changed:
// long waits are shortened, each output gets reading time, and the end cross-fades to the first frame.
//   node render-cast.mjs <cast> <out.mp4> "<window title>" [targetSeconds]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [castPath, outPath, title, targetArg] = process.argv.slice(2);
const TARGET = Number(targetArg ?? 11);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const W = 1080, H = 1350, FPS = 30, FADE = 0.6;

// ── read the cast, convert v3 deltas to absolute times, then re-time ──
const lines = fs.readFileSync(castPath, "utf8").trim().split("\n");
const header = JSON.parse(lines[0]);
let t = 0;
const events = lines.slice(1).map((l) => JSON.parse(l)).map(([d, kind, data]) => ((t += d), { t, kind, data })).filter((e) => e.kind === "o");
// group events that land within 50 ms into one visible state
const states = [];
for (const e of events) {
  const last = states[states.length - 1];
  if (last && e.t - last.t < 0.05) last.data += e.data;
  else states.push({ t: e.t, data: e.data });
}
// hold each state for reading time: 0.5 s plus 0.3 s per printed line, capped
const holds = states.map((s) => Math.min(2.6, 0.5 + 0.3 * (s.data.match(/\r?\n/g) || []).length));
const lead = 0.5;
let total = lead + holds.reduce((a, b) => a + b, 0) + FADE;
const finalExtra = Math.max(0, TARGET - total);
holds[holds.length - 1] += finalExtra;
total += finalExtra;
if (total > 15) throw new Error(`clip would be ${total.toFixed(1)} s; shorten the recording`);

// ── render each state with xterm.js in headless Chrome ──
const { default: puppeteer } = await import(path.join(REPO, "site/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js"));
const markSvg = fs.readFileSync(path.join(REPO, "brand/src/mark-dark.svg"), "utf8");
const html = `<!doctype html><html><head>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Figtree:wght@600&display=block">
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<style>
  html,body{margin:0;width:${W}px;height:${H}px;background:#10231B;overflow:hidden}
  .top{position:absolute;top:70px;left:48px;right:48px;display:flex;align-items:center;gap:18px;color:#E8F0EA;font:600 34px Figtree,sans-serif}
  .top svg{width:74px;height:auto}
  .card{position:absolute;left:48px;right:48px;top:190px;bottom:120px;background:#0C1511;border:2px solid #26362D;border-radius:28px;overflow:hidden}
  .bar{height:64px;display:flex;align-items:center;padding:0 30px;color:#93A69A;font:400 24px 'IBM Plex Mono',monospace;border-bottom:2px solid #1B2A22}
  #term{position:absolute;top:92px;left:34px;right:20px;bottom:24px}
  .xterm .xterm-viewport{overflow:hidden!important;background:#0C1511!important}
</style></head><body>
<div class="top">${markSvg.replace(/<svg /, '<svg ')}<span>plans</span></div>
<div class="card"><div class="bar">${title}</div><div id="term"></div></div>
<script>
  window.ready = document.fonts.load("31px 'IBM Plex Mono'").then(() => {
    const term = new Terminal({ cols: ${header.term.cols}, rows: ${header.term.rows}, fontFamily: "'IBM Plex Mono', monospace", fontSize: 31, lineHeight: 1.06,
      cursorBlink: false, cursorStyle: "block", allowProposedApi: true,
      theme: { background: "#0C1511", foreground: "#E8F0EA", cursor: "#F5B83D", green: "#4CC38A", brightGreen: "#4CC38A", red: "#FF7A66", yellow: "#F5B83D" } });
    term.open(document.getElementById("term"));
    window.write = (d) => new Promise((r) => term.write(d, r));
  });
</script></body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plans-clip-"));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle0" });
await page.evaluate(() => window.ready);
const frames = [];
const shot = async (i) => {
  const f = path.join(tmp, `s${String(i).padStart(3, "0")}.png`);
  await page.screenshot({ path: f });
  return f;
};
frames.push({ file: await shot(0), dur: lead });
for (let i = 0; i < states.length; i++) {
  await page.evaluate((d) => window.write(d), states[i].data);
  frames.push({ file: await shot(i + 1), dur: holds[i] });
}
await browser.close();

// ── encode: concat the states, then cross-fade the tail into the first frame for a seamless loop ──
const list = frames.map((f) => `file '${f.file}'\nduration ${f.dur.toFixed(3)}`).join("\n") + `\nfile '${frames.at(-1).file}'\n`;
fs.writeFileSync(path.join(tmp, "list.txt"), list);
const body = path.join(tmp, "body.mp4");
const enc = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS), "-crf", "18", "-preset", "slow"];
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"), "-vf", `fps=${FPS}`, ...enc, body]);
const bodyLen = frames.reduce((a, f) => a + f.dur, 0);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", body, "-loop", "1", "-t", String(FADE + 0.1), "-i", frames[0].file,
  "-filter_complex", `[0:v]fps=${FPS},settb=1/${FPS},format=yuv420p[m];[1:v]fps=${FPS},settb=1/${FPS},format=yuv420p[a];[m][a]xfade=transition=fade:duration=${FADE}:offset=${(bodyLen - FADE).toFixed(3)},format=yuv420p`,
  "-an", ...enc, "-movflags", "+faststart", outPath]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${outPath}  (${bodyLen.toFixed(2)} s planned)`);
