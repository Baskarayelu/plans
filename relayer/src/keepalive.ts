/**
 * Indexer keep-alive. Envio Cloud's free plan pauses a deployment whose GraphQL endpoint sees no queries
 * for 7 days, so the relayer reads one row from it once a day (and shortly after start). Off when
 * INDEXER_GRAPHQL_URL is unset.
 */
import { log, shortErr } from "./log.js";

export const KEEPALIVE_QUERY = "query PlansKeepAlive { GlobalStats(limit: 1) { id } }";

export async function pingIndexer(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: KEEPALIVE_QUERY }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`indexer answered ${res.status}`);
  const body = (await res.json()) as { errors?: unknown[] };
  if (body.errors?.length) throw new Error("indexer returned GraphQL errors");
  return true;
}

export class IndexerKeepAlive {
  #timer: NodeJS.Timeout | null = null;
  lastOkAt: number | null = null;

  constructor(
    readonly url: string | null,
    readonly opts: { intervalMs: number; firstDelayMs: number } = { intervalMs: 24 * 3_600_000, firstDelayMs: 60_000 },
    readonly fetchImpl: typeof fetch = fetch,
  ) {}

  start() {
    const url = this.url;
    if (!url) return;
    const loop = async () => {
      try {
        await pingIndexer(url, this.fetchImpl);
        this.lastOkAt = Date.now();
      } catch (e) {
        log.warn("indexer keep-alive failed", { error: shortErr(e) });
      }
      this.#timer = setTimeout(loop, this.opts.intervalMs);
      this.#timer.unref?.();
    };
    this.#timer = setTimeout(loop, this.opts.firstDelayMs);
    this.#timer.unref?.();
  }

  stop() {
    if (this.#timer) clearTimeout(this.#timer);
  }
}
