import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../src/ratelimit.js";
import { Store } from "../../src/store.js";

describe("token-bucket rate limiter", () => {
  it("allows a burst up to capacity then refills over the window", () => {
    let now = 0;
    const rl = new RateLimiter(3, 60_000, () => now);
    expect(rl.take("ip:1").ok).toBe(true);
    expect(rl.take("ip:1").ok).toBe(true);
    expect(rl.take("ip:1").ok).toBe(true);
    const r = rl.take("ip:1");
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
    expect(r.retryAfterMs).toBeLessThanOrEqual(20_000);
    expect(rl.take("ip:2").ok).toBe(true); // keys are independent
    now += 20_000;
    expect(rl.take("ip:1").ok).toBe(true);
    expect(rl.take("ip:1").ok).toBe(false);
  });

  it("is disabled with capacity 0", () => {
    const rl = new RateLimiter(0, 1000);
    for (let i = 0; i < 100; i++) expect(rl.take("x").ok).toBe(true);
  });
});

describe("daily quotas", () => {
  it("counts per UTC day and can refund", () => {
    const s = new Store(":memory:");
    const day1 = Date.UTC(2026, 9, 6, 10);
    expect(s.takeDaily("faucet:addr:a", 2, day1)).toBe(true);
    expect(s.takeDaily("faucet:addr:a", 2, day1)).toBe(true);
    expect(s.takeDaily("faucet:addr:a", 2, day1)).toBe(false);
    s.refundDaily("faucet:addr:a", day1);
    expect(s.takeDaily("faucet:addr:a", 2, day1)).toBe(true);
    expect(s.takeDaily("faucet:addr:a", 2, Date.UTC(2026, 9, 7, 0, 0, 1))).toBe(true); // next day resets
  });
});
