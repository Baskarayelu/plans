// Loads the web app (local export by default), prints console errors and saves a screenshot.
//   node smoke.mjs [path=/app] [width=1440] [theme=light] [out=smoke.png]
import { ORIGIN, addPasskeyAuthenticator, launch, newPage, serveLocalApp, sleep } from "./lib/browser.mjs";
const [path = "/app", width = "1440", theme = "light", out = "smoke.png"] = process.argv.slice(2);
const browser = await launch();
try {
  const page = await newPage(browser, { width: Number(width), height: Number(width) < 700 ? 844 : 900, theme, mobile: Number(width) < 700 });
  await serveLocalApp(page);
  await addPasskeyAuthenticator(page);
  await page.goto(ORIGIN + path, { waitUntil: "load" });
  await sleep(Number(process.env.WAIT ?? 4000));
  await page.screenshot({ path: out });
  console.log(page.logs.filter((l) => /error|warn/i.test(l)).slice(0, 40).join("\n"));
  console.log("url:", page.url());
} finally {
  await browser.close();
}
