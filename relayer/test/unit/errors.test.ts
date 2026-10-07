import { encodeErrorResult, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { decodeRevert, extractRevertData, friendlyForName, SPEND_BLOCKED_REASONS } from "../../src/errors.js";

const abi = parseAbi([
  "error SpendBlocked(uint8 reason)",
  "error AlreadyMember()",
  "error Error(string)",
  "error Panic(uint256)",
  "error SomethingNewAndOdd()",
]);

// Signatures as in contracts/src (Pot, PlansSend); decoded through src/abi.errors.generated.json.
const newErrors = parseAbi([
  "error NotSettled()",
  "error NothingToCollect()",
  "error PayoutRefused()",
  "error FxRoundUnknown(uint64 roundId)",
  "error FxRoundStale(uint64 roundId, uint64 scheduledTime)",
  "error FxPairUnavailable(uint64 roundId, bytes3 fromCurrency, bytes3 toCurrency)",
  "error StaleReport(uint64 scheduledTime, uint64 last)",
  "error RateMoveTooLarge(bytes3 ccy, uint64 prev, uint64 rate)",
]);

describe("collect and FX reference errors", () => {
  const cases: [string, unknown[], string, RegExp][] = [
    ["NotSettled", [], "NOT_SETTLED", /isn't settled yet/],
    ["NothingToCollect", [], "NOTHING_TO_COLLECT", /nothing to collect/i],
    ["PayoutRefused", [], "PAYOUT_REFUSED", /AUSD refused the payout.*frozen.*claim is kept.*try again later/i],
    ["FxRoundUnknown", [7n], "FX_ROUND_UNKNOWN", /isn't on chain.*Refresh the quote/],
    ["FxRoundStale", [7n, 1791270000n], "FX_ROUND_STALE", /more than 6 hours old.*Refresh the quote/],
    ["FxPairUnavailable", [7n, "0x474250", "0x494e52"], "FX_PAIR_UNAVAILABLE", /doesn't cover these currencies/],
    ["StaleReport", [1n, 2n], "STALE_REPORT", /older than the latest round/],
    ["RateMoveTooLarge", ["0x474250", 1n, 2n], "RATE_MOVE_TOO_LARGE", /moved more than/],
  ];
  it.each(cases)("%s → %s with a plain-English message", (name, args, code, msg) => {
    const data = encodeErrorResult({ abi: newErrors, errorName: name as never, args: args as never });
    const d = decodeRevert(data);
    expect(d.error).toBe(name);
    expect(d.code).toBe(code);
    expect(d.message).toMatch(msg);
    expect(d.message).not.toMatch(/0x[0-9a-f]{8}|unrecognised/i); // never a raw selector
  });

  it("does not confuse NotSettled with PotSettled ('already settled')", () => {
    expect(friendlyForName("NotSettled")).not.toMatch(/already settled/);
    expect(friendlyForName("PotSettled")).toMatch(/already settled/);
  });

  it("keeps the FxRoundStale arguments for the app", () => {
    const d = decodeRevert(encodeErrorResult({ abi: newErrors, errorName: "FxRoundStale", args: [7n, 1791270000n] }));
    expect(d.args).toEqual([7n, 1791270000n]);
  });
});

describe("revert decoding", () => {
  it("maps every SpendBlocked reason to a code and plain English", () => {
    for (let r = 1; r <= 11; r++) {
      const data = encodeErrorResult({ abi, errorName: "SpendBlocked", args: [r] });
      const d = decodeRevert(data);
      expect(d.error).toBe("SpendBlocked");
      expect(d.reason).toBe(r);
      expect(d.code).toBe(SPEND_BLOCKED_REASONS[r].code);
      expect(d.message).toBe(SPEND_BLOCKED_REASONS[r].message);
    }
    expect(decodeRevert(encodeErrorResult({ abi, errorName: "SpendBlocked", args: [6] })).message).toMatch(/budget/);
    expect(decodeRevert(encodeErrorResult({ abi, errorName: "SpendBlocked", args: [99] })).message).toMatch(/reason 99/);
  });

  it("decodes contract custom errors from the generated ABI", () => {
    const d = decodeRevert(encodeErrorResult({ abi, errorName: "AlreadyMember" }));
    expect(d).toMatchObject({ error: "AlreadyMember", code: "ALREADY_MEMBER" });
    expect(d.message).toMatch(/already in this plan/);
  });

  it("decodes require strings and panics", () => {
    expect(decodeRevert(encodeErrorResult({ abi, errorName: "Error", args: ["nope"] }))).toMatchObject({ error: "Error", message: "nope" });
    expect(decodeRevert(encodeErrorResult({ abi, errorName: "Panic", args: [0x11n] })).code).toBe("PANIC");
  });

  it("handles empty and unknown revert data", () => {
    expect(decodeRevert(undefined).code).toBe("REVERTED");
    expect(decodeRevert("0x").code).toBe("REVERTED");
    expect(decodeRevert("0xdeadbeef").message).toMatch(/0xdeadbeef/);
  });

  it("humanises unknown error names", () => {
    expect(friendlyForName("SomethingNewAndOdd")).toBe("Something new and odd.");
    expect(friendlyForName("WeirdSignatureThing")).toMatch(/signature/i);
  });

  it("finds revert data nested in RPC errors", () => {
    const data = encodeErrorResult({ abi, errorName: "SpendBlocked", args: [9] });
    expect(extractRevertData({ cause: { cause: { data } } })).toBe(data);
    expect(extractRevertData({ error: { code: 3, data } })).toBe(data);
    expect(extractRevertData({ cause: { data: { data } } })).toBe(data);
    expect(extractRevertData(new Error("x"))).toBeUndefined();
  });
});
