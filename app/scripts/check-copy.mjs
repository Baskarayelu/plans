#!/usr/bin/env node
/**
 * Copy lint: user-visible strings in route and UI files must not use crypto vocabulary.
 *   banned anywhere: wallet, address, gas, token, chain, transaction, blockchain, crypto, sign*
 *   allowed: "Sign out", "sign in to"
 *   "AUSD" / "Digital dollars" only on screens 09 (balance), 43 (send tab), 45 (send amount),
 *   plus the approved build-2 additions: 140/141 (backing card and "About digital dollars", in
 *   src/ui/agora/dollars.tsx) and 147 ("If the digital dollar is frozen", src/ui/risks/content.ts and its screen)
 * Checks JSX text and string literals that look like prose (contain a space or start upper-case),
 * skipping imports, testIDs, route paths and object keys. Hidden Diagnostics is exempt.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIRS = ["src/app", "src/ui"];
const EXEMPT = new Set(["src/app/diagnostics.tsx"]);
const AUSD_OK = new Set(["src/app/balance.tsx", "src/app/(tabs)/send.tsx", "src/app/send/amount.tsx", "src/ui/agora/dollars.tsx", "src/ui/risks/content.ts", "src/app/risks/[topic].tsx"]);
const BANNED = /\b(wallets?|address(es)?|gas|tokens?|chains?|transactions?|blockchains?|crypto|sign(ed|ing|s|ature|atures)?)\b/i;
const ALLOWED = [/sign out/gi, /sign in to/gi];

function walk(d) {
  const out = [];
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts)$/.test(f)) out.push(p);
  }
  return out;
}

function stripTemplateExpressions(t) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (depth === 0 && t[i] === "$" && t[i + 1] === "{") {
      depth = 1;
      i++;
      out += " ";
      continue;
    }
    if (depth > 0) {
      if (t[i] === "{") depth++;
      else if (t[i] === "}") depth--;
      continue;
    }
    out += t[i];
  }
  return out;
}

function prose(src) {
  const items = [];
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // JSX text: skip spans that are really code (TS generics, comparisons) rather than prose.
  for (const m of noComments.matchAll(/>([^<>{}]+)</g)) if (!/[=;()]|=>|\.\w+\(/.test(m[1])) items.push(m[1]);
  for (const m of noComments.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    // template literals: only the literal text counts, not the ${...} code inside
    const s = m[1] === "`" ? stripTemplateExpressions(m[2]) : m[2];
    if (m[1] === "`" && /[;{}]|=>/.test(s)) continue;
    const before = noComments.slice(Math.max(0, m.index - 30), m.index);
    if (/import|from\s*$|require\(\s*$|testID=\s*\{?\s*$|pathname:\s*$|name=\s*$|queryKey|icon=\s*$/.test(before)) continue;
    if (/^[a-z0-9_./:[\]-]+$/i.test(s) && !/\s/.test(s)) continue; // identifiers, routes, ids
    if (/^https?:|^0x|^\/|^[a-z]+-[a-z-]+$/.test(s)) continue;
    items.push(s);
  }
  return items;
}

let bad = 0;
for (const dir of DIRS) {
  for (const file of walk(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, file);
    if (EXEMPT.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    for (let s of prose(src)) {
      for (const a of ALLOWED) s = s.replace(a, "");
      const m = BANNED.exec(s);
      if (m) {
        console.log(`${rel}: "${s.trim().slice(0, 90)}" → ${m[0]}`);
        bad++;
      }
      if (!AUSD_OK.has(rel) && /\bAUSD\b|digital dollars/i.test(s)) {
        console.log(`${rel}: "${s.trim().slice(0, 90)}" → AUSD caption outside 09/43/45/140/141/147`);
        bad++;
      }
    }
  }
}
if (bad) {
  console.log(`\n${bad} copy problem(s).`);
  process.exit(1);
}
console.log("copy ok");
