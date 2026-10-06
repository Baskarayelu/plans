// Summarises the live ground-truth check recorded in gas-results.json by script/monad-gas.mjs:
// for every table transaction, the model's minimum gas limit vs the minimum found on Monad mainnet.
//   node tools/live-check.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { meta, records } = JSON.parse(fs.readFileSync(path.join(here, "gas-results.json"), "utf8"));
const checked = records.filter((r) => r.table && r.live && r.live.minLimit != null);
const match = checked.filter((r) => String(r.live.minLimit) === String(r.model.monadMinLimit));
const n = (x) => Number(x).toLocaleString("en-US");

console.log(`${checked.length} transactions replayed on Monad mainnet`);
if (meta?.liveBlock) console.log(`live block ${meta.liveBlock}`);
console.log(`model min gas == live min gas: ${match.length} / ${checked.length}`);
for (const label of ["PlansSend.send", "join (+ 3009 deposit only)", "settle (6 members)"]) {
  const r = checked.find((x) => x.label === label);
  if (r) console.log(`  ${label.padEnd(28)} ${n(r.live.minLimit).padStart(8)}`);
}
