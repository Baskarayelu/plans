import { describe, expect, it } from "vitest";
import { RelayError } from "../../src/errors.js";
import { capFor, DEFAULT_GAS_CAPS, feesFor, gasLimitFor, maxCost, MONAD_MIN_BASE_FEE } from "../../src/gas.js";

const policy = { marginBps: 1000, marginFixed: 10_000, caps: {} };

describe("gas-limit policy", () => {
  it("adds a small margin to the estimate", () => {
    expect(gasLimitFor("vote", 100_000n, policy)).toBe(120_000n); // 100k * 1.1 + 10k
    expect(gasLimitFor("vote", 100_001n, policy)).toBe(120_002n); // rounds up
  });

  it("never clamps the limit to the cap: the cap only rejects", () => {
    const cap = BigInt(DEFAULT_GAS_CAPS.ack);
    // An estimate just under the cap keeps its full margin, even though the limit is above the cap.
    expect(gasLimitFor("ack", cap - 1n, policy)).toBe(((cap - 1n) * 11_000n + 9_999n) / 10_000n + 10_000n);
    expect(gasLimitFor("ack", cap, policy) > cap).toBe(true);
  });

  it("refuses actions whose estimate is over the cap", () => {
    expect(() => gasLimitFor("ack", BigInt(DEFAULT_GAS_CAPS.ack) + 1n, policy)).toThrow(RelayError);
    try {
      gasLimitFor("ack", 10_000_000n, policy);
    } catch (e) {
      expect((e as RelayError).code).toBe("GAS_CAP_EXCEEDED");
      expect((e as RelayError).status).toBe(422);
    }
  });

  it("honours cap overrides and has a default for unknown actions", () => {
    expect(capFor("ack", { ...policy, caps: { ack: 50_000 } })).toBe(50_000);
    expect(capFor("mystery", policy)).toBe(1_000_000);
    expect(() => gasLimitFor("ack", 60_000n, { ...policy, caps: { ack: 50_000 } })).toThrow(/needs more gas/);
  });

  it("every relay action has a cap", async () => {
    const { ACTION_NAMES } = await import("../../src/actions.js");
    for (const a of ACTION_NAMES) expect(DEFAULT_GAS_CAPS[a], a).toBeGreaterThan(0);
  });

  it("prices at Monad's 100 gwei base-fee floor with a 2 gwei tip", () => {
    const f = feesFor(null, 2_000_000_000n, 1_000_000_000_000n);
    expect(f.maxPriorityFeePerGas).toBe(2_000_000_000n);
    expect(f.maxFeePerGas).toBe(MONAD_MIN_BASE_FEE + MONAD_MIN_BASE_FEE / 4n + 2_000_000_000n);
    expect(feesFor(1n, 2n, 10n ** 15n).maxFeePerGas).toBe(MONAD_MIN_BASE_FEE + MONAD_MIN_BASE_FEE / 4n + 2n);
    expect(feesFor(400_000_000_000n, 2_000_000_000n, 300_000_000_000n).maxFeePerGas).toBe(300_000_000_000n); // capped
  });

  it("computes the reserve-balance cost from the gas limit", () => {
    expect(maxCost(120_000n, 127_000_000_000n)).toBe(15_240_000_000_000_000n);
  });
});
