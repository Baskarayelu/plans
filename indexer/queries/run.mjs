// Runs every query in this folder against a GraphQL endpoint (default: local Hasura) — schema check.
// Usage: node queries/run.mjs [endpoint]
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const endpoint = process.argv[2] ?? "http://localhost:8080/v1/graphql";
const dir = dirname(fileURLToPath(import.meta.url));
const vars = {
  account: "0xa11ce00000000000000000000000000000000001",
  pot: "0x9000000000000000000000000000000000000001",
  spend: "0x9000000000000000000000000000000000000001-1",
  chainId: 10143,
};
let failed = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".graphql"))) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/query (\w+)\(([^)]*)\)/g)) {
    const declared = [...m[2].matchAll(/\$(\w+)/g)].map((x) => x[1]);
    const variables = Object.fromEntries(Object.entries(vars).filter(([k]) => declared.includes(k)));
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: src, operationName: m[1], variables }),
    });
    const json = await res.json();
    if (json.errors) {
      failed++;
      console.log(`✗ ${f} ${m[1]}: ${JSON.stringify(json.errors)}`);
    } else console.log(`✓ ${f} ${m[1]}`);
  }
}
process.exit(failed ? 1 : 0);
