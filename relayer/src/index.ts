import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { log, shortErr } from "./log.js";
import { buildServices } from "./services.js";

async function main() {
  const cfg = loadConfig();
  const s = await buildServices(cfg);
  await s.start();
  const server = serve({ fetch: s.app.fetch, port: cfg.port, hostname: cfg.host });
  log.info("plans relayer listening", {
    port: cfg.port,
    chainId: cfg.chainId,
    lanes: s.pool.lanes.map((l) => l.address),
    factory: s.relayer.contracts.factory ?? null,
    demo: s.demo?.enabled ?? false,
    faucet: s.faucet?.enabled ?? false,
  });
  const shutdown = async (sig: string) => {
    log.info("shutting down", { signal: sig });
    server.close();
    await s.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  log.error("fatal", { error: shortErr(e) });
  process.exit(1);
});
