/**
 * Faucet limits: one top-up per account per day, a generous per-network limit with its own code (a
 * venue's Wi-Fi puts a whole group behind one address), and an overall daily cap.
 */
import type { Address, PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { Faucet } from "../../src/faucet.js";
import type { LanePool } from "../../src/lanes.js";
import type { Relayer } from "../../src/relay.js";
import { Store } from "../../src/store.js";

const AUSD = "0x00000000000000000000000000000000000000a5" as Address;
const LANE = "0x00000000000000000000000000000000000000f1" as Address;
const addr = (i: number) => `0x${i.toString(16).padStart(40, "0")}` as Address;

function faucet(limits: { perAddressPerDay: number; perIpPerDay: number; totalPerDay: number }) {
  const client = { readContract: async () => 10_000_000_000n } as unknown as PublicClient;
  let n = 0;
  const relayer = { sendInternal: async () => ({ txHash: `0x${(++n).toString(16).padStart(64, "0")}` }) } as unknown as Relayer;
  const pool = { lanes: [{ address: LANE }] } as unknown as LanePool;
  return new Faucet({ enabled: true, isMainnet: false, ausd: AUSD, amount: 25_000_000n, ...limits }, client, relayer, pool, new Store(":memory:"));
}

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code);

describe("faucet limits", () => {
  it("gives each account one top-up a day (FAUCET_LIMIT)", async () => {
    const f = faucet({ perAddressPerDay: 1, perIpPerDay: 40, totalPerDay: 400 });
    expect(await code(f.drip(addr(1), "1.1.1.1"))).toBe("ok");
    expect(await code(f.drip(addr(1), "2.2.2.2"))).toBe("FAUCET_LIMIT");
  });

  it("a brand-new account on a busy network gets FAUCET_NETWORK_LIMIT, never FAUCET_LIMIT", async () => {
    const f = faucet({ perAddressPerDay: 1, perIpPerDay: 2, totalPerDay: 400 });
    expect(await code(f.drip(addr(1), "9.9.9.9"))).toBe("ok");
    expect(await code(f.drip(addr(2), "9.9.9.9"))).toBe("ok");
    expect(await code(f.drip(addr(3), "9.9.9.9"))).toBe("FAUCET_NETWORK_LIMIT");
    // that refusal did not use up account 3's own top-up: it works from another network
    expect(await code(f.drip(addr(3), "8.8.8.8"))).toBe("ok");
  });

  it("stops everyone at the daily cap (FAUCET_DAILY_CAP) without using up their own allowance", async () => {
    const f = faucet({ perAddressPerDay: 1, perIpPerDay: 40, totalPerDay: 2 });
    expect(await code(f.drip(addr(1), "1.0.0.1"))).toBe("ok");
    expect(await code(f.drip(addr(2), "1.0.0.2"))).toBe("ok");
    expect(await code(f.drip(addr(3), "1.0.0.3"))).toBe("FAUCET_DAILY_CAP");
  });

});
