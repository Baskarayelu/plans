import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { FxService, fxMessage, toE8 } from "../../src/fx.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const signer = privateKeyToAccount(KEY);

function mockFetch(rates: Record<string, Record<string, number>>, date = "2026-10-05") {
  return vi.fn(async (url: string | URL | Request) => {
    const base = new URL(String(url)).searchParams.get("from")!;
    if (!rates[base]) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    return new Response(JSON.stringify({ amount: 1, base, date, rates: rates[base] }), { status: 200 });
  });
}

describe("FX reference", () => {
  it("converts decimal rates to 8-decimal integers", () => {
    expect(toE8(1.2734)).toBe(127_340_000n);
    expect(toE8(110.52)).toBe(11_052_000_000n);
    expect(toE8(0.000123456789)).toBe(12_346n);
    expect(toE8(1)).toBe(100_000_000n);
    expect(() => toE8(0)).toThrow();
  });

  it("returns a signed quote the app can verify (EIP-191)", async () => {
    let now = 1_760_000_000_000;
    const f = mockFetch({ GBP: { USD: 1.3412, INR: 118.9 } });
    const fx = new FxService({ url: "https://api.frankfurter.app/latest", cacheMs: 600_000 }, signer, f as never, () => now);
    const q = await fx.quote("GBP", "USD");
    expect(q).toMatchObject({ from: "GBP", to: "USD", rateE8: "134120000", date: "2026-10-05", timestamp: 1_760_000_000 });
    expect(q.message).toBe(fxMessage(q));
    expect(q.signer).toBe(signer.address);
    expect(await recoverMessageAddress({ message: q.message, signature: q.signature as `0x${string}` })).toBe(signer.address);
  });

  it("treats AUSD as USD and same-currency as 1", async () => {
    const f = mockFetch({ USD: { INR: 88.2 } });
    const fx = new FxService({ url: "https://x/latest", cacheMs: 600_000 }, signer, f as never);
    expect((await fx.quote("AUSD", "INR")).rateE8).toBe("8820000000");
    expect((await fx.quote("AUSD", "USD")).rateE8).toBe("100000000");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("caches for 10 minutes per base currency", async () => {
    let now = 0;
    const f = mockFetch({ GBP: { USD: 1.3, INR: 118 } });
    const fx = new FxService({ url: "https://x/latest", cacheMs: 600_000 }, signer, f as never, () => now);
    await fx.quote("GBP", "USD");
    now += 599_000;
    await fx.quote("GBP", "INR");
    expect(f).toHaveBeenCalledTimes(1);
    now += 2_000;
    await fx.quote("GBP", "USD");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("serves a stale rate when the source is down, and errors when it never loaded", async () => {
    let now = 0;
    let up = true;
    const f = vi.fn(async () => (up ? new Response(JSON.stringify({ base: "GBP", date: "d", rates: { USD: 1.3 } })) : new Response("x", { status: 500 })));
    const fx = new FxService({ url: "https://x/latest", cacheMs: 1000 }, signer, f as never, () => now);
    await fx.quote("GBP", "USD");
    up = false;
    now += 5000;
    expect((await fx.quote("GBP", "USD")).rateE8).toBe("130000000");
    const fx2 = new FxService({ url: "https://x/latest", cacheMs: 1000 }, signer, f as never, () => now);
    await expect(fx2.quote("GBP", "USD")).rejects.toMatchObject({ code: "FX_UNAVAILABLE" });
  });

  it("rejects unsupported currencies", async () => {
    const fx = new FxService({ url: "https://x/latest", cacheMs: 1000 }, signer, mockFetch({ GBP: { USD: 1.3 } }) as never);
    await expect(fx.quote("GBP", "XYZ")).rejects.toMatchObject({ code: "UNSUPPORTED_CURRENCY" });
    await expect(fx.quote("ABC", "USD")).rejects.toMatchObject({ code: "UNSUPPORTED_CURRENCY" });
  });
});
