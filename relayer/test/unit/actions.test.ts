import { decodeFunctionData, encodeFunctionData, getAddress, toFunctionSelector, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { potAbi, factoryAbi, plansSendAbi } from "../../src/abi.js";
import { ACTION_NAMES, prepareAction, ValidationError } from "../../src/actions.js";
import { asciiToBytes, hashSendMeta, ZERO_BYTES32 } from "../../src/eip712.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const POT = "0x3333333333333333333333333333333333333333";
const SIG = ("0x" + "ab".repeat(65)) as Hex;
const B32 = ("0x" + "cd".repeat(32)) as Hex;

const propose = (over: Record<string, unknown> = {}) => ({
  action: "propose",
  params: {
    pot: POT,
    proposer: A,
    kind: "PAY",
    payee: B,
    amount: "400000",
    category: 3,
    split: { members: [A, B], weights: [1, 1] },
    nonce: "123",
    deadline: 2_000_000_000,
    sig: SIG,
    ...over,
  },
});

function issues(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return (e as Error).message;
  }
  throw new Error("expected a ValidationError");
}

describe("action validation", () => {
  it("covers every action in the spec", () => {
    expect(ACTION_NAMES.sort()).toEqual(
      [
        "createPot", "join", "contribute", "propose", "vote", "cancelSpend", "execute", "expire", "openDispute",
        "resolveDispute", "voteDispute", "finalizeDispute", "freeze", "voteUnfreeze", "proposeRules", "voteRules",
        "applyRules", "exit", "ack", "settle", "payDebt", "collect", "rotateInvite", "postKeyWraps", "registerKey", "send",
        "claimCreate", "claim", "claimRefund",
      ].sort(),
    );
  });

  it("encodes a valid propose with enum names and numeric strings", () => {
    const p = prepareAction(propose());
    expect(p.target).toBe("pot");
    expect(p.actor).toBe(A);
    expect(p.deadline).toBe(2_000_000_000n);
    const d = decodeFunctionData({ abi: potAbi, data: p.data });
    expect(d.functionName).toBe("propose");
    expect(d.args![1]).toBe(0); // PAY
    expect(d.args![3]).toBe(400000n);
    expect(d.args![6]).toBe("0x" + "00".repeat(32)); // receiptHash default
    expect(d.args![7]).toBe("0x"); // memo default
  });

  it("rejects unknown actions and missing params", () => {
    expect(issues(() => prepareAction({ action: "drain", params: {} }))).toMatch(/action/);
    expect(issues(() => prepareAction({ action: "vote", params: {} }))).toMatch(/params\.pot/);
  });

  it("rejects bad addresses, duplicate split members, zero weights and long memos", () => {
    expect(issues(() => prepareAction(propose({ payee: "0x123" })))).toMatch(/payee/);
    expect(issues(() => prepareAction(propose({ split: { members: [A, A], weights: [1, 1] } })))).toMatch(/duplicate/);
    expect(issues(() => prepareAction(propose({ split: { members: [A, B], weights: [1, 0] } })))).toMatch(/greater than zero/);
    expect(issues(() => prepareAction(propose({ split: { members: [A, B], weights: [1] } })))).toMatch(/same length/);
    expect(issues(() => prepareAction(propose({ memo: "0x" + "00".repeat(513) })))).toMatch(/512 bytes/);
    expect(issues(() => prepareAction(propose({ category: 8 })))).toMatch(/category/);
    expect(issues(() => prepareAction(propose({ amount: "0" })))).toMatch(/above zero/);
    expect(issues(() => prepareAction(propose({ amount: "-5" })))).toMatch(/non-negative/);
    expect(issues(() => prepareAction(propose({ kind: "STEAL" })))).toMatch(/PAY, LINK, PERSONAL/);
  });

  it("rejects integers out of range for their Solidity type", () => {
    const rules = {
      instantMax: (1n << 64n).toString(), oneApprovalMax: 0, highTier: "MAJORITY", memberDailyCap: 0, memberTotalCap: 0,
      payeePolicy: "ANYONE", minContribution: 0, proposalTtl: 3600, ruleTimelock: 300, categoryBudgets: [0, 0, 0, 0, 0, 0, 0, 0],
    };
    expect(issues(() => prepareAction({ action: "proposeRules", params: { pot: POT, member: A, rules, nonce: 1, deadline: 1, sig: SIG } }))).toMatch(/uint64/);
  });

  it("accepts ISO codes for bytes2/bytes3 and fills absent optional structs", () => {
    const join = prepareAction({
      action: "join",
      params: { pot: POT, member: A, country: "GB", nonce: 1, deadline: 2_000_000_000, memberSig: SIG, inviteSig: SIG },
    });
    const d = decodeFunctionData({ abi: potAbi, data: join.data });
    expect(d.args![1]).toBe("0x4742");
    expect((d.args![6] as { value: bigint }).value).toBe(0n); // empty deposit
    expect((d.args![8] as { pubKey: Hex }).pubKey).toBe("0x" + "00".repeat(32));

    const send = prepareAction({
      action: "send",
      params: {
        from: A,
        meta: { to: B, fromCountry: "GB", toCountry: "IN", fromCurrency: "GBP", toCurrency: "INR", fxRateE8: "11000000000", fxTimestamp: 1, salt: B32 },
        auth: { value: "1500000", validBefore: 2_000_000_000, nonce: B32, signature: SIG },
      },
    });
    expect(send.target).toBe("plansSend");
    const s = decodeFunctionData({ abi: plansSendAbi, data: send.data });
    expect((s.args![1] as { fromCurrency: Hex }).fromCurrency).toBe("0x474250");
    expect(issues(() => prepareAction({ action: "join", params: { pot: POT, member: A, country: "gb", nonce: 1, deadline: 1, memberSig: SIG, inviteSig: SIG } }))).toMatch(/country/);
  });

  it("requires a deposit authorisation for contribute", () => {
    expect(issues(() => prepareAction({ action: "contribute", params: { pot: POT, member: A } }))).toMatch(/auth is required/);
  });

  it("encodes createPot for the factory", () => {
    const p = prepareAction({
      action: "createPot",
      params: {
        creator: A,
        params: {
          rules: {
            instantMax: 250000, oneApprovalMax: 1000000, highTier: 0, memberDailyCap: 0, memberTotalCap: 0, payeePolicy: 0,
            minContribution: 0, proposalTtl: 3600, ruleTimelock: 300, categoryBudgets: [0, 0, 0, 0, 0, 0, 0, 0],
          },
          startTime: 1, endTime: 1000, reviewWindow: 0, inviteSigner: B, creatorCountry: "US", salt: B32,
        },
        nonce: 5, deadline: 2_000_000_000, sig: SIG,
      },
    });
    expect(p.target).toBe("factory");
    expect(decodeFunctionData({ abi: factoryAbi, data: p.data }).functionName).toBe("createPot");
  });

  it("permissionless actions have no actor", () => {
    expect(prepareAction({ action: "settle", params: { pot: POT } }).actor).toBeUndefined();
    expect(prepareAction({ action: "execute", params: { pot: POT, id: "0x1" } }).actor).toBeUndefined();
    expect(prepareAction({ action: "collect", params: { pot: POT, member: A } }).data).toMatch(/^0x/); // unsigned, actor = member
  });
});

describe("collect", () => {
  it("validates {pot, member} and encodes Pot.collect(member)", () => {
    const p = prepareAction({ action: "collect", params: { pot: POT, member: A.toLowerCase() } });
    expect(p.target).toBe("pot");
    expect(p.pot).toBe(getAddress(POT));
    expect(p.actor).toBe(getAddress(A)); // rate-limited per member
    expect(p.deadline).toBeUndefined();
    const d = decodeFunctionData({ abi: potAbi, data: p.data });
    expect(d.functionName).toBe("collect");
    expect(d.args).toEqual([getAddress(A)]);
    expect(p.data.slice(0, 10)).toBe(toFunctionSelector("collect(address)"));
    expect(p.data).toBe(encodeFunctionData({ abi: potAbi, functionName: "collect", args: [getAddress(A)] }));
  });

  it("rejects a missing or malformed member or pot", () => {
    expect(issues(() => prepareAction({ action: "collect", params: { pot: POT } }))).toMatch(/params\.member/);
    expect(issues(() => prepareAction({ action: "collect", params: { pot: POT, member: "0x12" } }))).toMatch(/params\.member/);
    expect(issues(() => prepareAction({ action: "collect", params: { member: A } }))).toMatch(/params\.pot/);
  });
});

describe("send meta.fxRoundId", () => {
  const meta = { to: B, fromCountry: "GB", toCountry: "IN", fromCurrency: "GBP", toCurrency: "INR", fxRateE8: "11800000000", fxTimestamp: 1791270666, salt: B32 };
  const auth = { value: "1000000", validBefore: 2_000_000_000, nonce: B32, signature: SIG };
  const decodeMeta = (data: Hex) => decodeFunctionData({ abi: plansSendAbi, data }).args![1] as Record<string, unknown>;

  it("encodes fxRoundId in the SendMeta tuple, between fxTimestamp and memoHash", () => {
    const p = prepareAction({ action: "send", params: { from: A, meta: { ...meta, fxRoundId: "12" }, auth } });
    expect(decodeMeta(p.data)).toMatchObject({ fxRateE8: 11_800_000_000n, fxTimestamp: 1791270666n, fxRoundId: 12n, memoHash: "0x" + "00".repeat(32) });
    expect(p.data.slice(0, 10)).toBe(
      toFunctionSelector("send(address,(address,bytes2,bytes2,bytes3,bytes3,uint64,uint64,uint64,bytes32,bytes32),(uint256,uint256,uint256,bytes32,bytes))"),
    );
    // the meta tuple is static: words 1..10 after `from` are its fields in order; word 8 is fxRoundId
    const words = p.data.slice(10).match(/.{64}/g)!;
    expect(BigInt("0x" + words[7])).toBe(1791270666n); // fxTimestamp
    expect(BigInt("0x" + words[8])).toBe(12n); // fxRoundId
    expect(words[9]).toBe("00".repeat(32)); // memoHash
    expect("0x" + words[10]).toBe(B32); // salt
  });

  it("defaults a missing fxRoundId to 0 so older clients still validate", () => {
    const p = prepareAction({ action: "send", params: { from: A, meta, auth } });
    expect(decodeMeta(p.data).fxRoundId).toBe(0n);
    expect(prepareAction({ action: "send", params: { from: A, meta: { ...meta, fxRoundId: 0 }, auth } }).data).toBe(p.data);
  });

  it("the calldata's meta hashes to the 3009 nonce the app signs (keccak256(abi.encode(meta)))", () => {
    const m = { to: getAddress(B), fromCountry: asciiToBytes("GB"), toCountry: asciiToBytes("IN"), fromCurrency: asciiToBytes("GBP"), toCurrency: asciiToBytes("INR"), fxRateE8: 11_800_000_000n, fxTimestamp: 1791270666n, fxRoundId: 12n, memoHash: ZERO_BYTES32, salt: B32 };
    const p = prepareAction({ action: "send", params: { from: A, meta: { ...meta, fxRoundId: 12 }, auth } });
    expect(hashSendMeta(decodeMeta(p.data) as never)).toBe(hashSendMeta(m));
    expect(hashSendMeta(m)).not.toBe(hashSendMeta({ ...m, fxRoundId: 0n }));
  });

  it("rejects fxRoundId outside uint64", () => {
    expect(issues(() => prepareAction({ action: "send", params: { from: A, meta: { ...meta, fxRoundId: (1n << 64n).toString() }, auth } }))).toMatch(/fxRoundId.*uint64/);
    expect(issues(() => prepareAction({ action: "send", params: { from: A, meta: { ...meta, fxRoundId: "-1" }, auth } }))).toMatch(/fxRoundId/);
  });
});

describe("config", () => {
  it("treats empty env values as unset and never enables the faucet on mainnet", async () => {
    const { loadConfig } = await import("../../src/config.js");
    const key = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    expect(loadConfig({ CHAIN_ID: "10143", RELAYER_KEYS: key, FAUCET_ENABLED: "" }).faucet.enabled).toBe(true);
    expect(loadConfig({ CHAIN_ID: "10143", RELAYER_KEYS: key, FAUCET_ENABLED: "false" }).faucet.enabled).toBe(false);
    expect(loadConfig({ CHAIN_ID: "10143", RELAYER_KEYS: key }).contracts.fxReference).toBeUndefined();
    expect(loadConfig({ CHAIN_ID: "10143", RELAYER_KEYS: key, FX_REFERENCE_ADDRESS: "0x" + "ab".repeat(20) }).contracts.fxReference).toBe(getAddress("0x" + "ab".repeat(20)));
    expect(loadConfig({ CHAIN_ID: "143", RELAYER_KEYS: key, FAUCET_ENABLED: "true" }).faucet.enabled).toBe(false);
    const main = loadConfig({ CHAIN_ID: "143", RELAYER_KEYS: key, START_BLOCK: "" });
    expect(main.rpcUrls).toHaveLength(4);
    expect(main.wsUrl).toBe("wss://rpc.monad.xyz");
    expect(main.contracts.ausd).toBe("0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a");
    expect(main.listener.startBlock).toBeUndefined();
    expect(() => loadConfig({ CHAIN_ID: "143", RELAYER_KEYS: "0x1234" })).toThrow(/value hidden/);
    expect(() => loadConfig({ CHAIN_ID: "999" })).toThrow(/RPC_URL/);
  });
});
