// Builds every Plans brand file from the approved design:
//   mark   = the "wristband": marigold stripes 0.27 wide with 0.09 gaps, 1.2 × 0.55, corner radius 0.14
//            (design/gen/app.css `.logo .lb`, landing `.logo .band`)
//   word   = "plans" in Bricolage Grotesque ExtraBold, tracking −0.02 em, mark-to-word gap 0.45 em
//   colours = design tokens (pine ink #10231B, marigold #F5B83D, light ground #F4F6F1, dark ground #0C1511)
// Text is converted to outlines so every SVG renders identically without fonts installed.
//
// Usage: npm --prefix brand install && npm --prefix brand run build
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPO = path.resolve(ROOT, "..");
const OUT = path.join(ROOT);
const font = (f) => opentype.loadSync(path.join(ROOT, "fonts", f));
const BRICOLAGE = font("Bricolage_Grotesque_wght_800.ttf");
const FIGTREE_500 = font("Figtree_wght_500.ttf");
const FIGTREE_600 = font("Figtree_wght_600.ttf");

const C = {
  pine: "#10231B", // --ink (light)
  marigold: "#F5B83D", // --accent
  paper: "#F4F6F1", // --bg (light)
  night: "#0C1511", // --bg (dark)
  mist: "#E8F0EA", // --ink (dark)
  muted: "#93A69A", // --muted (dark)
};

// ── primitives ────────────────────────────────────────────────────────────
const f = (n) => +n.toFixed(2);

/** The wristband mark, `w` wide, top-left at (x, y). gap = colour of the gaps, or null for cut-outs. */
function mark(x, y, w, fill = C.marigold, gap = null) {
  const u = w / 1.2;
  const h = 0.55 * u;
  const r = 0.14 * u;
  const id = `clip${Math.round(x)}_${Math.round(y)}_${Math.round(w)}`;
  const stripes = [0, 0.36, 0.72, 1.08]
    .map((s) => `<rect x="${f(x + s * u)}" y="${f(y)}" width="${f(Math.min(0.27, 1.2 - s) * u)}" height="${f(h)}"/>`)
    .join("");
  return (
    `<clipPath id="${id}"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(r)}"/></clipPath>` +
    `<g clip-path="url(#${id})">` +
    (gap ? `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${gap}"/>` : "") +
    `<g fill="${fill}">${stripes}</g></g>`
  );
}
const markHeight = (w) => (0.55 * w) / 1.2;

/** Text as an outlined path. Returns { d, width }. Baseline at (x, y). */
function text(fontObj, str, x, y, size, tracking = 0) {
  let cursor = x;
  const parts = [];
  const glyphs = fontObj.stringToGlyphs(str);
  glyphs.forEach((g, i) => {
    parts.push(g.getPath(cursor, y, size).toPathData(2));
    let adv = (g.advanceWidth / fontObj.unitsPerEm) * size;
    if (i < glyphs.length - 1) adv += (fontObj.getKerningValue(g, glyphs[i + 1]) / fontObj.unitsPerEm) * size;
    cursor += adv + tracking * size;
  });
  return { d: parts.join(""), width: cursor - x - tracking * size };
}
const textWidth = (fontObj, str, size, tracking = 0) => text(fontObj, str, 0, 0, size, tracking).width;
/** Cap height of the wordmark font, used to centre the mark on the x-height band. */
const xHeight = (fontObj, size) => ((fontObj.tables.os2.sxHeight || 500) / fontObj.unitsPerEm) * size;

/** Mark + "plans" lockup with its top-left at (x, y); size = wordmark font size. Returns { svg, width, height }. */
function lockup(x, y, size, wordColor, gapColor) {
  const mw = 1.2 * size;
  const mh = markHeight(mw);
  const gap = 0.45 * size;
  const word = text(BRICOLAGE, "plans", 0, 0, size, -0.02);
  const xh = xHeight(BRICOLAGE, size);
  const asc = (BRICOLAGE.ascender / BRICOLAGE.unitsPerEm) * size;
  const baseline = y + asc;
  const markY = baseline - xh / 2 - mh / 2;
  const wordPath = text(BRICOLAGE, "plans", x + mw + gap, baseline, size, -0.02);
  return {
    svg: mark(x, markY, mw, C.marigold, gapColor) + `<path d="${wordPath.d}" fill="${wordColor}"/>`,
    width: mw + gap + word.width,
    height: asc + (Math.abs(BRICOLAGE.descender) / BRICOLAGE.unitsPerEm) * size,
  };
}

const svgDoc = (w, h, body, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  (bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : "") +
  body +
  `</svg>\n`;

const files = {};
const put = (name, svg) => (files[name] = svg);

// ── 1. logo lockups (light / dark), transparent ─────────────────────────
for (const [variant, word, gap] of [
  ["light", C.pine, C.pine],
  ["dark", C.mist, null],
]) {
  const size = 200;
  const pad = 40;
  const probe = lockup(0, 0, size, word, gap);
  const W = Math.ceil(probe.width + 2 * pad);
  const H = Math.ceil(probe.height + 2 * pad);
  put(`logo-${variant}.svg`, svgDoc(W, H, lockup(pad, pad, size, word, gap).svg));
}

// ── 2. mark on its own (light / dark) ───────────────────────────────────
put("mark-light.svg", svgDoc(600, 275, mark(0, 0, 600, C.marigold, C.pine)));
put("mark-dark.svg", svgDoc(600, 275, mark(0, 0, 600, C.marigold, null)));

// ── 3. square portal logo 1024: pine ground, mark over wordmark ──────────
{
  const S = 1024;
  const mw = 560;
  const size = 200;
  const wordW = textWidth(BRICOLAGE, "plans", size, -0.02);
  const mh = markHeight(mw);
  const block = mh + 70 + size * 0.75;
  const top = (S - block) / 2;
  const word = text(BRICOLAGE, "plans", (S - wordW) / 2, top + mh + 70 + size * 0.72, size, -0.02);
  put("logo-square.svg", svgDoc(S, S, mark((S - mw) / 2, top, mw) + `<path d="${word.d}" fill="${C.paper}"/>`, C.pine));
}

// ── 4. icon: mark only on pine (app icon, X profile, PWA) ────────────────
const iconSvg = (S, markW, bg = C.pine, rx = 0) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">` +
  `<rect width="${S}" height="${S}" rx="${rx}" fill="${bg}"/>` +
  mark((S - markW) / 2, (S - markHeight(markW)) / 2, markW) +
  `</svg>\n`;
put("icon.svg", iconSvg(1024, 600));
put("x-profile.svg", iconSvg(400, 236));
put("favicon.svg", iconSvg(64, 46, C.pine, 14));
put("maskable.svg", iconSvg(1024, 520)); // inside the 80% maskable safe zone

// Android adaptive icon: 108 dp canvas, 66 dp safe zone → mark ≤ 61% of width
put("adaptive-foreground.svg", svgDoc(1024, 1024, mark((1024 - 560) / 2, (1024 - markHeight(560)) / 2, 560)));
put("adaptive-background.svg", svgDoc(1024, 1024, "", C.pine));
put(
  "adaptive-monochrome.svg",
  svgDoc(1024, 1024, mark((1024 - 560) / 2, (1024 - markHeight(560)) / 2, 560, "#FFFFFF", null)),
);
put("splash.svg", svgDoc(1024, 1024, mark((1024 - 420) / 2, (1024 - markHeight(420)) / 2, 420)));

// ── 5. X banner 1500 × 500 ───────────────────────────────────────────────
{
  const W = 1500;
  const H = 500;
  // The banner's sentence is the portal one-liner, read from docs/submission.md so the two never drift.
  const sub = fs.readFileSync(path.join(REPO, "docs", "submission.md"), "utf8");
  const oneLiner = sub.match(/field: One-line description[^\n]*\n[^\n]*\n```text\n([^\n]+)\n```/)[1];
  // dotted ground (Playful hero motif)
  let dots = "";
  for (let y = 10; y < H; y += 20) for (let x = 10; x < W; x += 20) dots += `M${x} ${y}h0`;
  const ground = `<path d="${dots}" stroke="${C.mist}" stroke-opacity=".09" stroke-width="2.4" stroke-linecap="round"/>`;
  // decorative wristbands, top-left only (bottom-left is under the profile picture)
  const deco =
    `<g transform="rotate(-14 210 90)" opacity=".9">${mark(90, 40, 240)}</g>` +
    `<g transform="rotate(9 330 220)" opacity=".35">${mark(250, 175, 150)}</g>`;
  // content block, centre-right safe area: x 540 → 1420, vertically centred inside y 70 → 430
  const x0 = 540;
  const size = 78;
  const textSize = 30;
  const leading = 41;
  const lines = wrap(FIGTREE_500, oneLiner, textSize, 860);
  const lockH = lockup(0, 0, size, C.paper, null).height;
  const blockH = lockH + 22 + lines.length * leading + 26 + 44;
  const top = Math.round((H - blockH) / 2);
  if (top < 60 || top + blockH > 440) throw new Error(`banner content outside safe area: ${top}..${top + blockH}`);
  const lock = lockup(x0, top, size, C.paper, null);
  let ty = top + lockH + 22 + textSize;
  let body = "";
  for (const line of lines) {
    body += `<path d="${text(FIGTREE_500, line, x0, ty, textSize).d}" fill="${C.mist}" fill-opacity=".86"/>`;
    ty += leading;
  }
  // "Built on Monad" pill
  const label = "Built on Monad";
  const lw = textWidth(FIGTREE_600, label, 22);
  const py = ty - textSize + 26;
  const pill =
    `<rect x="${x0 + 1}" y="${py}" width="${f(lw + 40)}" height="44" rx="22" fill="none" stroke="${C.marigold}" stroke-width="2"/>` +
    `<path d="${text(FIGTREE_600, label, x0 + 21, py + 29.5, 22).d}" fill="${C.marigold}"/>`;
  put("x-banner.svg", svgDoc(W, H, ground + deco + lock.svg + body + pill, C.pine));
}

function wrap(fontObj, str, size, maxW) {
  const words = str.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (textWidth(fontObj, next, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// ── write SVG sources ────────────────────────────────────────────────────
fs.mkdirSync(path.join(OUT, "src"), { recursive: true });
for (const [name, svg] of Object.entries(files)) fs.writeFileSync(path.join(OUT, "src", name), svg);

// ── render PNGs with headless Chrome ─────────────────────────────────────
const { default: puppeteer } = await import(path.join(REPO, "site/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js"));
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
async function png(src, out, size, transparent = false) {
  const svg = files[src];
  const [w, h] = Array.isArray(size) ? size : [size, size];
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  const img = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img src="${img}" style="display:block;width:${w}px;height:${h}px"></body></html>`,
  );
  await page.waitForSelector("img");
  await page.evaluate(() => document.querySelector("img").decode());
  await page.screenshot({ path: path.join(OUT, out), omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
}
const dims = (svg) => svg.match(/width="(\d+)" height="(\d+)"/).slice(1).map(Number);

const outputs = [
  ["logo-square.svg", "portal/plans-logo-1024.png", 1024],
  ["x-profile.svg", "x/plans-x-profile-400.png", 400],
  ["x-banner.svg", "x/plans-x-banner-1500x500.png", [1500, 500]],
  ["logo-light.svg", "logo/plans-logo-light.png", dims(files["logo-light.svg"]), true],
  ["logo-dark.svg", "logo/plans-logo-dark.png", dims(files["logo-dark.svg"]), true],
  ["mark-light.svg", "logo/plans-mark-light.png", [600, 275], true],
  ["mark-dark.svg", "logo/plans-mark-dark.png", [600, 275], true],
  ["icon.svg", "app/icon.png", 1024],
  ["adaptive-foreground.svg", "app/android-icon-foreground.png", 1024, true],
  ["adaptive-background.svg", "app/android-icon-background.png", 1024],
  ["adaptive-monochrome.svg", "app/android-icon-monochrome.png", 1024, true],
  ["splash.svg", "app/splash-icon.png", 1024, true],
  ["favicon.svg", "app/favicon.png", 48],
  ["icon.svg", "web/icon-192.png", 192],
  ["icon.svg", "web/icon-512.png", 512],
  ["maskable.svg", "web/icon-maskable-512.png", 512],
  ["icon.svg", "web/apple-touch-icon.png", 180],
  ["favicon.svg", "web/favicon-32.png", 32],
  ["favicon.svg", "web/favicon-16.png", 16],
];
for (const [src, out, size, transparent] of outputs) {
  fs.mkdirSync(path.dirname(path.join(OUT, out)), { recursive: true });
  await png(src, out, size, transparent);
}
fs.copyFileSync(path.join(OUT, "src", "favicon.svg"), path.join(OUT, "web", "favicon.svg"));
await browser.close();
console.log(`wrote ${Object.keys(files).length} SVGs and ${outputs.length} PNGs`);
