/** In-memory token buckets (per IP, per address). Daily quotas live in the Store so they survive restarts. */
export class RateLimiter {
  #buckets = new Map<string, { tokens: number; at: number }>();
  #lastSweep = 0;

  constructor(
    readonly capacity: number,
    readonly windowMs: number,
    readonly now: () => number = Date.now,
  ) {}

  /** Take one token for `key`. Returns ok=false with retryAfterMs when the bucket is empty. */
  take(key: string): { ok: boolean; retryAfterMs: number; remaining: number } {
    if (this.capacity <= 0) return { ok: true, retryAfterMs: 0, remaining: Infinity };
    const t = this.now();
    const rate = this.capacity / this.windowMs; // tokens per ms
    const b = this.#buckets.get(key) ?? { tokens: this.capacity, at: t };
    b.tokens = Math.min(this.capacity, b.tokens + (t - b.at) * rate);
    b.at = t;
    let res: { ok: boolean; retryAfterMs: number; remaining: number };
    if (b.tokens >= 1) {
      b.tokens -= 1;
      res = { ok: true, retryAfterMs: 0, remaining: Math.floor(b.tokens) };
    } else {
      res = { ok: false, retryAfterMs: Math.ceil((1 - b.tokens) / rate), remaining: 0 };
    }
    this.#buckets.set(key, b);
    this.#sweep(t);
    return res;
  }

  #sweep(t: number) {
    if (t - this.#lastSweep < 60_000) return;
    this.#lastSweep = t;
    for (const [k, b] of this.#buckets) if (t - b.at > this.windowMs) this.#buckets.delete(k);
  }

  get size() {
    return this.#buckets.size;
  }
}
