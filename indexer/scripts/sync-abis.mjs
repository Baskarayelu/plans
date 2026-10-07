#!/usr/bin/env node
// Regenerates abis/*.json (events only) from the Foundry build of the Solidity interfaces.
// Usage: (cd ../contracts && forge build) && node scripts/sync-abis.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "..", "contracts", "out");
const map = {
  PlansFactory: ["IPlansPeriphery.sol", "IPlansFactory.json"],
  Pot: ["IPot.sol", "IPot.json"],
  KeyRegistry: ["IPlansPeriphery.sol", "IKeyRegistry.json"],
  ClaimEscrow: ["IPlansPeriphery.sol", "IClaimEscrow.json"],
  PlansSend: ["IPlansPeriphery.sol", "IPlansSend.json"],
  // The contract artifact (not IFxReference) so the inherited ownership events are included too.
  FxReference: ["FxReference.sol", "FxReference.json"],
};
for (const [name, [dir, file]] of Object.entries(map)) {
  const { abi } = JSON.parse(readFileSync(join(out, dir, file), "utf8"));
  const events = abi.filter((x) => x.type === "event");
  writeFileSync(join(root, "abis", `${name}.json`), JSON.stringify(events, null, 2) + "\n");
  console.log(`${name}: ${events.length} events`);
}
