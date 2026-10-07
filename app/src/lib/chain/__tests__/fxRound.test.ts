/** chain/rpc FxReference helpers (pure parts) and the relayer's /v1/fx/round client. */
jest.mock("../../../config", () => ({
  config: { chainId: 10143, relayerUrl: "https://relayer.test", contracts: { plansFactory: "0xFAc7000000000000000000000000000000000001", plansSend: "0x5e4d000000000000000000000000000000000005" } },
}));

import { stringToHex } from "viem";
import { fxReferenceRateE8, isFxRoundFresh, MAX_FX_AGE_SEC, toFxRound } from "../rpc";

const raw = {
  roundId: 12n,
  scheduledTime: 1_791_270_000n,
  writtenAt: 1_791_270_004n,
  rateDate: 20261007,
  sourceMask: 7,
  currencies: ["GBP", "EUR", "INR", "NGN", "JPY", "CHF", "AED", "SGD"].map((c) => stringToHex(c, { size: 3 })),
  usdPerUnitE8: [134_000_000n, 116_000_000n, 1_130_000n, 0n, 0n, 0n, 0n, 0n],
  sourceMasks: [3, 3, 7, 0, 0, 0, 0, 0],
};

describe("FxReference round helpers", () => {
  it("decodes a round into codes and drops absent currencies", () => {
    const r = toFxRound(raw)!;
    expect(r).toMatchObject({ roundId: 12n, scheduledTime: 1_791_270_000, rateDate: 20261007, sourceMask: 7 });
    expect(r.usdPerUnitE8).toEqual({ GBP: 134_000_000n, EUR: 116_000_000n, INR: 1_130_000n });
    expect(r.sourceMasks).toEqual({ GBP: 3, EUR: 3, INR: 7 });
    expect(toFxRound({ ...raw, roundId: 0n })).toBeNull();
  });

  it("computes the reference rate like PlansSend (floored, USD = 1e8)", () => {
    const r = toFxRound(raw)!;
    expect(fxReferenceRateE8(r, "GBP", "INR")).toBe(11_858_407_079n); // 1.34e8 * 1e8 / 1_130_000
    expect(fxReferenceRateE8(r, "GBP", "USD")).toBe(134_000_000n);
    expect(fxReferenceRateE8(r, "AUSD", "GBP")).toBe(74_626_865n);
    expect(fxReferenceRateE8(r, "GBP", "NGN")).toBeNull();
  });

  it("is fresh for 6 hours after its scheduled time", () => {
    const r = toFxRound(raw)!;
    expect(MAX_FX_AGE_SEC).toBe(21_600);
    expect(isFxRoundFresh(r, r.scheduledTime + 21_600)).toBe(true);
    expect(isFxRoundFresh(r, r.scheduledTime + 21_601)).toBe(false);
    expect(isFxRoundFresh(null)).toBe(false);
  });
});
