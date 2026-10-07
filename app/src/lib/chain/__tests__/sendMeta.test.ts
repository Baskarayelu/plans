/**
 * PlansSend's ERC-3009 nonce is keccak256(abi.encode(meta)) over the 10-field SendMeta
 * (contracts/src/interfaces/IPlansPeriphery.sol):
 *   to, fromCountry, toCountry, fromCurrency, toCurrency, fxRateE8, fxTimestamp, fxRoundId, memoHash, salt
 * The vectors below were computed with Foundry:
 *   cast abi-encode "f((address,bytes2,bytes2,bytes3,bytes3,uint64,uint64,uint64,bytes32,bytes32))" "(…)" | cast keccak
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { decodeFunctionData, encodeFunctionData, getAbiItem, keccak256, toEventSelector, type Address, type Hex } from "viem";
import { fxReferenceAbi, plansSendAbi, potAbi } from "../abi";
import { buildSendMeta } from "../actions";
import { codeToBytes, sendAuthNonce, type SendMeta } from "../eip712";

jest.mock("../../../config", () => ({ config: { chainId: 10143, contracts: {} } }));
jest.mock("../../api/relayer", () => ({ relay: jest.fn(), RelayError: class extends Error {} }));
jest.mock("../../identity/session", () => ({ currentAccount: jest.fn() }));
jest.mock("../../state/storage", () => ({ secureNonceStore: { load: jest.fn(), save: jest.fn() } }));
jest.mock("../rpc", () => ({ ausdPermitNonce: jest.fn(), registeredKey: jest.fn(), rpc: jest.fn() }));

const to = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const base = {
  fromCountry: codeToBytes("GB", 2),
  toCountry: codeToBytes("IN", 2),
  fromCurrency: codeToBytes("GBP", 3),
  toCurrency: codeToBytes("INR", 3),
  fxRateE8: 11_800_000_000n,
  fxTimestamp: 1791270666n,
  memoHash: `0x${"00".repeat(32)}` as Hex,
  salt: `0x${"42".repeat(32)}` as Hex,
};
const meta = (fxRoundId: bigint): SendMeta => ({ to, ...base, fxRoundId });

// cast abi-encode … "(0x7099…79C8,0x4742,0x494e,0x474250,0x494e52,11800000000,1791270666,<fxRoundId>,0x00…00,0x42…42)" | cast keccak
const CAST_ROUND_12 = "0xc35a44a94347143e655f943dd94818b16ac848bd0d6feb91960d07471dd142b1";
const CAST_ROUND_0 = "0x2397ea52ad0319478598dd3eafb15d76fc2064eaf525f62d005da2886a44a0e0";

describe("SendMeta nonce with fxRoundId", () => {
  it("matches the Foundry vectors (Solidity keccak256(abi.encode(meta)))", () => {
    expect(sendAuthNonce(meta(12n))).toBe(CAST_ROUND_12);
    expect(sendAuthNonce(meta(0n))).toBe(CAST_ROUND_0);
  });

  it("is a static 10-word tuple with fxRoundId between fxTimestamp and memoHash", () => {
    const word = (h: string) => h.replace(/^0x/, "");
    const right = (h: string) => word(h).padEnd(64, "0");
    const left = (h: string) => word(h).padStart(64, "0");
    const m = meta(12n);
    const enc = `0x${left(to.toLowerCase())}${right("4742")}${right("494e")}${right("474250")}${right("494e52")}${left((11_800_000_000n).toString(16))}${left((1791270666n).toString(16))}${left((12n).toString(16))}${word(m.memoHash)}${word(m.salt)}` as Hex;
    expect(enc.length).toBe(2 + 64 * 10);
    expect(sendAuthNonce(m)).toBe(keccak256(enc));
  });

  it("follows the struct's field order, not the object's key order", () => {
    const m = meta(12n);
    const shuffled = { salt: m.salt, fxRoundId: m.fxRoundId, memoHash: m.memoHash, to: m.to, fxTimestamp: m.fxTimestamp, fxRateE8: m.fxRateE8, toCurrency: m.toCurrency, fromCurrency: m.fromCurrency, toCountry: m.toCountry, fromCountry: m.fromCountry } as SendMeta;
    expect(sendAuthNonce(shuffled)).toBe(CAST_ROUND_12);
  });

  it("the ABI's SendMeta tuple is the contract's, so send calldata carries the hashed meta", () => {
    const input = getAbiItem({ abi: plansSendAbi, name: "send" }).inputs[1] as unknown as { components: readonly { name: string; type: string }[] };
    expect(input.components.map((c) => `${c.type} ${c.name}`)).toEqual([
      "address to", "bytes2 fromCountry", "bytes2 toCountry", "bytes3 fromCurrency", "bytes3 toCurrency",
      "uint64 fxRateE8", "uint64 fxTimestamp", "uint64 fxRoundId", "bytes32 memoHash", "bytes32 salt",
    ]);
    const m = meta(12n);
    const data = encodeFunctionData({ abi: plansSendAbi, functionName: "send", args: [to, m, { value: 1n, validAfter: 0n, validBefore: 2n, nonce: sendAuthNonce(m), signature: "0x" }] });
    const decoded = decodeFunctionData({ abi: plansSendAbi, data }).args![1] as SendMeta;
    expect(sendAuthNonce(decoded)).toBe(CAST_ROUND_12);
  });

  it("buildSendMeta defaults fxRoundId to 0n (older callers) and keeps an explicit round", () => {
    expect(buildSendMeta(to, base)).toEqual(meta(0n));
    expect(sendAuthNonce(buildSendMeta(to, base))).toBe(CAST_ROUND_0);
    expect(buildSendMeta(to, { ...base, fxRoundId: 12n }).fxRoundId).toBe(12n);
    expect(buildSendMeta(to, { ...base, fxRoundId: undefined }).fxRoundId).toBe(0n);
  });

  it("event topics match the contracts", () => {
    const ev = (abi: readonly unknown[], name: string) => toEventSelector((abi as { type: string; name: string }[]).find((x) => x.type === "event" && x.name === name) as never);
    expect(ev(plansSendAbi, "Sent")).toBe("0x23c552becce99eb89d1a96f69d7578207d91127ef5d5ccbeb167f7aedf77313b");
    expect(ev(potAbi, "Settled")).toBe("0x4a7b234a4bdfc722e8e9d251a072b4e04917b9f23c9eb95930d009b47c810d4a");
    expect(ev(potAbi, "Collected")).toBe("0x484decdc1e9549e1866295f6f86c889ded3f7de410e7488a7a415978589dc8fd");
    expect(ev(fxReferenceAbi, "RoundWritten")).toBe("0x8476deb7dae7ccbca73276a9dc7a676dd3d71d7dd028588e95c88c4c111a233e");
  });
});

const haveCast = (() => {
  try {
    execFileSync("cast", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

(haveCast ? describe : describe.skip)("SendMeta nonce: live cast cross-check", () => {
  it("matches cast abi-encode + keccak for a few rounds", () => {
    const cast = (...args: string[]) => execFileSync("cast", args, { encoding: "utf8" }).trim();
    for (const id of [0n, 1n, 12n, (1n << 64n) - 1n]) {
      const m = meta(id);
      const enc = cast(
        "abi-encode",
        "f((address,bytes2,bytes2,bytes3,bytes3,uint64,uint64,uint64,bytes32,bytes32))",
        `(${m.to},${m.fromCountry},${m.toCountry},${m.fromCurrency},${m.toCurrency},${m.fxRateE8},${m.fxTimestamp},${m.fxRoundId},${m.memoHash},${m.salt})`,
      );
      expect(sendAuthNonce(m)).toBe(cast("keccak", enc));
    }
  });
});

const IFACE = path.resolve(__dirname, "../../../../../contracts/src/interfaces/IPlansPeriphery.sol");
(existsSync(IFACE) ? describe : describe.skip)("SendMeta against the Solidity source", () => {
  it("has the same fields in the same order as IPlansSend.SendMeta", () => {
    const src = readFileSync(IFACE, "utf8");
    const body = /struct SendMeta \{([\s\S]*?)\}/.exec(src)![1];
    const fields = body
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter(Boolean)
      .map((l) => l.replace(/;$/, ""));
    const input = getAbiItem({ abi: plansSendAbi, name: "send" }).inputs[1] as unknown as { components: readonly { name: string; type: string }[] };
    expect(input.components.map((c) => `${c.type} ${c.name}`)).toEqual(fields);
  });
});
