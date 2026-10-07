/**
 * "Chrome on a Mac": how a browser names itself when it asks to be linked (design 173, 174, 178).
 * It comes from the browser's own user agent, so the phone shows it as a hint ("says it's …"),
 * never as proof: the three link pictures are the real check.
 */

const BROWSERS: [RegExp, string][] = [
  [/EdgiOS\/|EdgA\/|Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/FxiOS\/|Firefox\//, "Firefox"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/CriOS\/|Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPad/, "an iPad"],
  [/iPhone|iPod/, "an iPhone"],
  [/Android/, "Android"],
  [/CrOS/, "a Chromebook"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "a Mac"],
  [/Linux/, "Linux"],
];

/** "Chrome on a Mac", "Safari on an iPhone", "Edge on Windows"; "A browser" when nothing matches. At most 60 characters. */
export function deviceLabelFromUa(ua: string | undefined | null): string {
  if (!ua) return "A browser";
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (browser && os) return `${browser} on ${os}`.slice(0, 60);
  if (browser) return browser;
  if (os) return `A browser on ${os}`;
  return "A browser";
}

/** This browser's label (web), or null outside a browser. */
export function thisBrowserLabel(): string | null {
  if (typeof navigator === "undefined" || !navigator.userAgent) return null;
  return deviceLabelFromUa(navigator.userAgent);
}
