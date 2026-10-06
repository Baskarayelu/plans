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
