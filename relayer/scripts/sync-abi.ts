/**
 * Collect every custom error from the contracts' forge artifacts (contracts/out) into
 * src/abi.errors.generated.json, so the relayer can decode reverts into friendly messages.
 * Run after `forge build` in ../contracts:  pnpm sync-abi
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const outDir = resolve(process.argv[2] ?? join(import.meta.dirname, "../../contracts/out"));
const target = join(import.meta.dirname, "../src/abi.errors.generated.json");

function* artifacts(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "build-info") continue;
    if (statSync(p).isDirectory()) yield* artifacts(p);
    else if (name.endsWith(".json")) yield p;
  }
}

type AbiItem = { type: string; name?: string; inputs?: { type: string; name: string; components?: unknown[] }[] };
const seen = new Map<string, AbiItem>();
let files = 0;
for (const f of artifacts(outDir)) {
  // Skip test and script artifacts (forge-std etc.)
  if (/\.t\.sol|\.s\.sol|forge-std|Std|Vm\.sol|console|Test\.sol/.test(f)) continue;
  const j = JSON.parse(readFileSync(f, "utf8")) as { abi?: AbiItem[] };
  files++;
  for (const item of j.abi ?? []) {
    if (item.type !== "error") continue;
    const sig = `${item.name}(${(item.inputs ?? []).map((i) => i.type).join(",")})`;
    if (!seen.has(sig)) seen.set(sig, item);
  }
}
const errors = [...seen.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
writeFileSync(target, JSON.stringify(errors, null, 2) + "\n");
console.log(`scanned ${files} artifacts in ${outDir}; wrote ${errors.length} errors to ${target}`);
