/** Minimal structured JSON logger. Never pass private keys; Secret values serialise as "[redacted]". */
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: Level = (process.env.LOG_LEVEL as Level) ?? "info";

export function setLogLevel(l: Level) {
  threshold = l;
}

function safe(v: unknown): unknown {
  return JSON.parse(
    JSON.stringify(v, (_k, x) => {
      if (typeof x === "bigint") return x.toString();
      if (x instanceof Error) return { name: x.name, message: x.message };
      return x;
    }) ?? "null",
  );
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (order[level] < order[threshold]) return;
  if (process.env.VITEST && process.env.LOG_IN_TESTS !== "1") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(fields ? (safe(fields) as object) : {}) });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => emit("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => emit("error", m, f),
};

/** Use for error messages that may echo raw RPC payloads (signed tx bytes are not secrets, but keep logs lean). */
export function shortErr(e: unknown): string {
  const m = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e);
  return m.length > 400 ? m.slice(0, 400) + "…" : m;
}
