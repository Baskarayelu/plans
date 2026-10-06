/** fetch with a timeout, JSON in/out, bigint-safe bodies. */

export class NetworkError extends Error {
  constructor(message = "offline") {
    super(message);
  }
}

export function jsonStringify(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
}

export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal, headers: { "content-type": "application/json", accept: "application/json", ...(init.headers ?? {}) } });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : "network");
  } finally {
    clearTimeout(t);
  }
  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body: body as T, headers: res.headers };
}
