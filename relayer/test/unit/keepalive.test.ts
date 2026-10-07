/** The indexer keep-alive reads one GlobalStats row, and is off without a GraphQL URL. */
import { describe, expect, it, vi } from "vitest";
import { IndexerKeepAlive, KEEPALIVE_QUERY, pingIndexer } from "../../src/keepalive.js";

const ok = () => new Response(JSON.stringify({ data: { GlobalStats: [] } }), { status: 200 });

describe("indexer keep-alive", () => {
  it("posts the one-row query to the GraphQL URL", async () => {
    const f = vi.fn(async () => ok());
    await expect(pingIndexer("https://indexer.example/v1/graphql", f as unknown as typeof fetch)).resolves.toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://indexer.example/v1/graphql");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ query: KEEPALIVE_QUERY });
  });

  it("fails on HTTP errors and GraphQL errors", async () => {
    const http = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(pingIndexer("https://x", http as unknown as typeof fetch)).rejects.toThrow("503");
    const gql = vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "no" }] }), { status: 200 }));
    await expect(pingIndexer("https://x", gql as unknown as typeof fetch)).rejects.toThrow("GraphQL");
  });

  it("does nothing without a URL, and pings on schedule with one", async () => {
    vi.useFakeTimers();
    try {
      const off = vi.fn(async () => ok());
      new IndexerKeepAlive(null, { intervalMs: 1000, firstDelayMs: 10 }, off as unknown as typeof fetch).start();
      await vi.advanceTimersByTimeAsync(5000);
      expect(off).not.toHaveBeenCalled();

      const on = vi.fn(async () => ok());
      const k = new IndexerKeepAlive("https://x", { intervalMs: 1000, firstDelayMs: 10 }, on as unknown as typeof fetch);
      k.start();
      await vi.advanceTimersByTimeAsync(2100);
      k.stop();
      expect(on).toHaveBeenCalledTimes(3);
      expect(k.lastOkAt).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
