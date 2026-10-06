import { MemoryNonceStore, NonceAllocator } from "../lib/chain/nonces";

const A = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";

describe("nonce allocator (248-bit prefix + low-byte counter)", () => {
  it("shares one bitmap word for 256 nonces, then moves to a new prefix", async () => {
    const alloc = new NonceAllocator(new MemoryNonceStore());
    const ns: bigint[] = [];
    for (let i = 0; i < 257; i++) ns.push(await alloc.next(A));
    const words = new Set(ns.slice(0, 256).map((n) => n >> 8n));
    expect(words.size).toBe(1);
    expect(ns.slice(0, 256).map((n) => Number(n & 0xffn))).toEqual(Array.from({ length: 256 }, (_, i) => i));
    expect(ns[256] >> 8n).not.toBe(ns[0] >> 8n);
    expect(new Set(ns).size).toBe(257);
  });
  it("persists the counter across restarts", async () => {
    const store = new MemoryNonceStore();
    const a = new NonceAllocator(store);
    const n1 = await a.next(A);
    await new Promise((r) => setTimeout(r, 0));
    const b = new NonceAllocator(store);
    const n2 = await b.next(A);
    expect(n2).toBe(n1 + 1n);
  });
  it("parallel callers get distinct nonces", async () => {
    const a = new NonceAllocator(new MemoryNonceStore());
    const ns = await Promise.all(Array.from({ length: 20 }, () => a.next(A)));
    expect(new Set(ns).size).toBe(20);
  });
  it("rotate draws a fresh prefix (collision fallback)", async () => {
    const a = new NonceAllocator(new MemoryNonceStore());
    const n1 = await a.next(A);
    await a.rotate(A);
    const n2 = await a.next(A);
    expect(n2 >> 8n).not.toBe(n1 >> 8n);
    expect(n2 & 0xffn).toBe(0n);
  });
  it("different devices pick different prefixes", async () => {
    const x = await new NonceAllocator(new MemoryNonceStore()).next(A);
    const y = await new NonceAllocator(new MemoryNonceStore()).next(A);
    expect(x >> 8n).not.toBe(y >> 8n);
  });
});
