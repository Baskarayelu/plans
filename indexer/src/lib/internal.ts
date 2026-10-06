// Internal accounts (demo members, team test accounts) are excluded from traction metrics.
// Source: internal-accounts.json at the indexer root (committed). Format:
//   { "accounts": [ { "address": "0x…", "kind": "demo" | "team", "label": "Ben (demo)" } ] }
// `kind: "demo"` also marks every plan the account joins as a demo plan.
// ENVIO_INTERNAL_ACCOUNTS_FILE overrides the path (used by the tests).
// Changing the list changes historical classification: redeploy / resync the indexer after editing it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type InternalKind = "None" | "Demo" | "Team";

type Entry = { address: string; kind: string; label?: string };

let cache: { path: string; map: Map<string, InternalKind> } | undefined;

function candidatePaths(): string[] {
  const env = process.env.ENVIO_INTERNAL_ACCOUNTS_FILE;
  if (env) return [isAbsolute(env) ? env : resolve(process.cwd(), env)];
  const out: string[] = [];
  try {
    out.push(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "internal-accounts.json"));
  } catch {
    // import.meta.url unavailable in some bundlers; fall through to cwd
  }
  out.push(resolve(process.cwd(), "internal-accounts.json"));
  return out;
}

function load(): Map<string, InternalKind> {
  const paths = candidatePaths();
  const path = paths.find((p) => existsSync(p)) ?? paths[0] ?? "";
  if (cache && cache.path === path) return cache.map;
  const map = new Map<string, InternalKind>();
  if (path && existsSync(path)) {
    const json = JSON.parse(readFileSync(path, "utf8")) as { accounts?: Entry[] };
    for (const e of json.accounts ?? []) {
      if (!e || typeof e.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(e.address)) {
        throw new Error(`internal-accounts.json: invalid address ${JSON.stringify(e)}`);
      }
      const kind: InternalKind = String(e.kind).toLowerCase() === "demo" ? "Demo" : "Team";
      map.set(e.address.toLowerCase(), kind);
    }
  }
  cache = { path, map };
  return map;
}

export function internalKindOf(address: string): InternalKind {
  return load().get(address.toLowerCase()) ?? "None";
}
