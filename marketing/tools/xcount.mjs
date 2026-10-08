// Counts a post the way X does (twitter-text v3 "weighted length", limit 280):
// - text is NFC-normalised first;
// - every URL counts 23, whatever its length (t.co wrapping). Bare domains such as plans.0xo.in are
//   linked by X too, so they count 23 as well;
// - every emoji counts 2 (a whole emoji sequence, e.g. a flag or a ZWJ family, is one emoji);
// - other characters count 1 if their code point is in X's weight-100 ranges
//   (U+0000-U+10FF, U+2000-U+200D, U+2010-U+201F, U+2032-U+2037), otherwise 2.
//   node xcount.mjs "text"            prints the count
//   node xcount.mjs --file post.txt   counts a file (trailing newline ignored)
//   echo text | node xcount.mjs -     counts stdin
// Exit code 1 if the text is over 280.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const LIMIT = 280;
const URL_WEIGHT = 23;
const ONE = [[0x0000, 0x10ff], [0x2000, 0x200d], [0x2010, 0x201f], [0x2032, 0x2037]];

// Scheme URLs, and bare host names ending in a common TLD (X links those without a scheme).
const URL_RE =
  /\bhttps?:\/\/[^\s]+|(?<![@\w.])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|xyz|in|app|dev|co|ai|finance|link|me|so|gg)\b(?:\/[^\s]*)?/gi;
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export function xLength(input) {
  const text = input.normalize("NFC");
  let n = 0;
  let last = 0;
  const parts = [];
  for (const m of text.matchAll(URL_RE)) {
    // X leaves trailing sentence punctuation out of the link
    const url = m[0].replace(/[.,!?;:)]+$/, "");
    parts.push(text.slice(last, m.index));
    n += URL_WEIGHT;
    last = m.index + url.length;
  }
  parts.push(text.slice(last));
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  for (const part of parts) {
    for (const { segment } of seg.segment(part)) {
      if (EMOJI_RE.test(segment)) {
        n += 2;
        continue;
      }
      for (const ch of segment) {
        const cp = ch.codePointAt(0);
        n += ONE.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
      }
    }
  }
  return n;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  let text;
  if (args[0] === "--file") text = fs.readFileSync(args[1], "utf8").replace(/\n$/, "");
  else if (args[0] === "-") text = fs.readFileSync(0, "utf8").replace(/\n$/, "");
  else text = args.join(" ");
  const n = xLength(text);
  console.log(`${n} / ${LIMIT}`);
  process.exit(n > LIMIT ? 1 : 0);
}
