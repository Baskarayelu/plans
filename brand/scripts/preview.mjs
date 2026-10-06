// Renders brand/preview/x-profile-preview.png: the X profile picture and banner as they appear
// on a desktop profile column (600 px) and on a phone (390 px), plus the picture at 48 px.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(ROOT, "..");
const b64 = (p) => `data:image/png;base64,${fs.readFileSync(path.join(ROOT, p)).toString("base64")}`;
const banner = b64("x/plans-x-banner-1500x500.png");
const avatar = b64("x/plans-x-profile-400.png");

// X geometry: banner is 3:1; avatar is ~22% of column width (134 px on 600), its centre on the banner's bottom edge,
// left edge 16 px in, with a 4 px ring in the page colour. Phones crop the banner's sides slightly (we show a ~7% crop).
const profile = (width, crop, handle) => {
  const bannerH = Math.round(width / 3);
  const av = Math.round(width * 0.22);
  return `
  <div class="col" style="width:${width}px">
    <div class="banner" style="height:${bannerH}px;background-image:url(${banner});background-size:${Math.round(width * (1 + crop))}px auto"></div>
    <div class="row" style="height:${Math.round(av / 2) + 12}px">
      <img class="av" src="${avatar}" style="width:${av}px;height:${av}px;top:${-Math.round(av / 2)}px">
      <span class="follow">Follow</span>
    </div>
    <div class="who"><b>Plans</b><span>${handle}</span></div>
    <p class="bio">A group money pot for trips and plans.</p>
  </div>`;
};

const html = `<html><head><style>
  body{margin:0;background:#E9ECEF;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#0F1419}
  .wrap{display:flex;gap:40px;padding:36px;align-items:flex-start}
  .label{font:600 13px/1.4 -apple-system,sans-serif;color:#536471;margin:0 0 10px}
  .col{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12)}
  .banner{background-position:center;background-repeat:no-repeat}
  .row{position:relative;display:flex;justify-content:flex-end;align-items:flex-start;padding:12px 16px 0}
  .av{position:absolute;left:16px;border-radius:50%;border:4px solid #fff;box-sizing:border-box}
  .follow{background:#0F1419;color:#fff;font-weight:700;font-size:15px;padding:8px 18px;border-radius:999px}
  .who{padding:4px 16px 0;display:flex;flex-direction:column}
  .who b{font-size:20px} .who span{color:#536471;font-size:15px}
  .bio{padding:0 16px 16px;margin:10px 0 0;font-size:15px}
  .small{display:flex;gap:16px;align-items:center;margin-top:18px;background:#fff;border-radius:12px;padding:12px 16px}
  .small img{width:48px;height:48px;border-radius:50%}
  .small .t{font-size:14px;color:#536471}
  .circle{position:relative;width:200px;height:200px;margin-top:18px}
  .circle img{width:200px;height:200px;opacity:.35}
  .circle i{position:absolute;inset:0;border-radius:50%;background:url(${avatar}) center/200px 200px}
</style></head><body><div class="wrap">
  <div><p class="label">Desktop profile (600 px column)</p>${profile(600, 0, "@your_handle (pending)")}
    <div class="small"><img src="${avatar}"><span class="t">Profile picture at 48 px, as in replies and timelines</span></div></div>
  <div><p class="label">Phone (390 px, sides cropped)</p>${profile(390, 0.08, "@your_handle (pending)")}
    <p class="label" style="margin-top:18px">Circle crop over the square original</p>
    <div class="circle"><img src="${avatar}"><i></i></div></div>
</div></body></html>`;

const { default: puppeteer } = await import(path.join(REPO, "site/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js"));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1146, height: 760, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
fs.mkdirSync(path.join(ROOT, "preview"), { recursive: true });
const h = await page.evaluate(() => document.querySelector(".wrap").getBoundingClientRect().height);
await page.screenshot({ path: path.join(ROOT, "preview/x-profile-preview.png"), clip: { x: 0, y: 0, width: 1146, height: Math.ceil(h) } });
await browser.close();
console.log("brand/preview/x-profile-preview.png");
