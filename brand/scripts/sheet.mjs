// Contact sheet of the logo variants and icon set: brand/preview/icon-sheet.png
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(ROOT, "..");
const u = (p) => `data:image/png;base64,${fs.readFileSync(path.join(ROOT, p)).toString("base64")}`;
const cell = (label, inner, bg = "#fff") => `<figure style="background:${bg}"><div class="box">${inner}</div><figcaption>${label}</figcaption></figure>`;
const html = `<html><head><style>
body{margin:0;background:#E9ECEF;font:13px -apple-system,sans-serif;color:#333}
.g{display:grid;grid-template-columns:repeat(4,240px);gap:14px;padding:24px}
figure{margin:0;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.box{height:170px;display:grid;place-items:center} figcaption{background:#fff;padding:8px 10px}
img{display:block}
</style></head><body><div class="g">
${cell("Logo, light", `<img src="${u("logo/plans-logo-light.png")}" width="210">`, "#F4F6F1")}
${cell("Logo, dark", `<img src="${u("logo/plans-logo-dark.png")}" width="210">`, "#0C1511")}
${cell("Mark, light", `<img src="${u("logo/plans-mark-light.png")}" width="150">`, "#F4F6F1")}
${cell("Mark, dark", `<img src="${u("logo/plans-mark-dark.png")}" width="150">`, "#0C1511")}
${cell("App icon (legacy)", `<img src="${u("app/icon.png")}" width="120" style="border-radius:24px">`)}
${cell("Adaptive: fg on bg, circle mask", `<div style="width:130px;height:130px;border-radius:50%;background:url(${u("app/android-icon-background.png")}) center/cover"><img src="${u("app/android-icon-foreground.png")}" width="130"></div>`)}
${cell("Adaptive: monochrome (themed)", `<div style="width:130px;height:130px;border-radius:50%;background:#2E4E40"><img src="${u("app/android-icon-monochrome.png")}" width="130"></div>`)}
${cell("Splash on light / dark", `<div style="display:flex;gap:8px"><img src="${u("app/splash-icon.png")}" width="100" style="background:#F4F6F1;border-radius:8px"><img src="${u("app/splash-icon.png")}" width="100" style="background:#0C1511;border-radius:8px"></div>`)}
${cell("PWA maskable (80% safe circle)", `<div style="width:130px;height:130px;border-radius:50%;overflow:hidden"><img src="${u("web/icon-maskable-512.png")}" width="130"></div>`)}
${cell("PWA 192 / apple-touch 180", `<div style="display:flex;gap:10px;align-items:end"><img src="${u("web/icon-192.png")}" width="96" style="border-radius:20px"><img src="${u("web/apple-touch-icon.png")}" width="60" style="border-radius:13px"></div>`)}
${cell("Favicon 32 and 16 (actual size)", `<div style="display:flex;gap:14px;align-items:center"><img src="${u("web/favicon-32.png")}" width="32"><img src="${u("web/favicon-16.png")}" width="16"></div>`)}
${cell("App favicon 48", `<img src="${u("app/favicon.png")}" width="48">`)}
</div></body></html>`;
const { default: puppeteer } = await import(path.join(REPO, "site/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js"));
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const p = await b.newPage(); await p.setViewport({ width: 1050, height: 700 }); await p.setContent(html);
await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
await p.screenshot({ path: path.join(ROOT, "preview/icon-sheet.png"), fullPage: true }); await b.close();
