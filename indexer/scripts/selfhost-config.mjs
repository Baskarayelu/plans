// Regenerates config.selfhost.yaml from config.yaml: same chains, contracts and addresses, plus Monad
// testnet public RPCs as the data source, for the self-hosted indexer (no HyperSync token needed).
//   node scripts/selfhost-config.mjs
import { readFileSync, writeFileSync } from "node:fs";
let s = readFileSync(new URL("../config.yaml", import.meta.url), "utf8");
s = s.replace(
  "# This file is the Monad TESTNET indexer deployed on Envio Cloud",
  "# config.selfhost.yaml: the same testnet indexer for SELF-HOSTING (Railway), generated from config.yaml by\n# scripts/selfhost-config.mjs. It reads Monad testnet over public RPC (no HyperSync token needed).\n# Do not edit by hand.\n#\n# This file is the Monad TESTNET indexer deployed on Envio Cloud",
);
s = s.replace(
  "  - id: 10143\n    start_block: 68940999",
  `  - id: 10143
    start_block: 68940999
    # Self-hosted: Monad's public RPCs (eth_getLogs is capped at 100 blocks there).
    rpc:
      - url: https://testnet-rpc.monad.xyz
        for: sync
        initial_block_interval: 100
        interval_ceiling: 100
        backoff_millis: 1000
      - url: https://monad-testnet.drpc.org
        for: fallback
        initial_block_interval: 100
        interval_ceiling: 100`,
);
if (!s.includes("for: sync")) throw new Error("config.yaml layout changed; update scripts/selfhost-config.mjs");
writeFileSync(new URL("../config.selfhost.yaml", import.meta.url), s);
console.log("wrote config.selfhost.yaml");
