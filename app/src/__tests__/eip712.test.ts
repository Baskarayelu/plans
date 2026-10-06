import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  stringToHex,
  concatHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AUSD_TYPES,
  CLAIMS_TYPES,
  FACTORY_TYPES,
  HighTier,
  KEYS_TYPES,
  POT_TYPES,
  PayeePolicy,
  SpendKind,
  claimAuthNonce,
  codeToBytes,
  encodeTypeString,
  paramsHash,
  rulesHash,
  sendAuthNonce,
  splitHash,
  typed,
  wrapsHash,
  type CreatePotParams,
  type Rules,
  type SendMeta,
} from "../lib/chain/eip712";

const CONTRACTS = path.resolve(__dirname, "../../../contracts/src");
const haveContracts = existsSync(CONTRACTS);
const haveCast = (() => {
  try {
    execFileSync("cast", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const chainId = 10143;
const pot = "0x1234567890123456789012345678901234567890" as Address;
const factory = "0x6b555AeD3d87ca294460376a373838cF0E436d21" as Address;
const ausd = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" as Address;
const member = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const other = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

const rules: Rules = {
  instantMax: 25_000_000n,
  oneApprovalMax: 200_000_000n,
  highTier: HighTier.MAJORITY,
  memberDailyCap: 150_000_000n,
  memberTotalCap: 0n,
  payeePolicy: PayeePolicy.ANYONE,
  minContribution: 0n,
  proposalTtl: 86400,
  ruleTimelock: 3600,
  categoryBudgets: [300_000_000n, 0n, 80_000_000n, 120_000_000n, 300_000_000n, 0n, 0n, 0n],
};

const params: CreatePotParams = {
  rules,
  startTime: 1791270000n,
  endTime: 1791700000n,
  reviewWindow: 86400,
  inviteSigner: other,
  creatorCountry: codeToBytes("GB", 2),
  creatorSafetyNet: 100_000_000n,
  meta: "0x01aabbcc",
  creatorKeyWrap: "0x01ddeeff",
  inviteKeyWrap: "0x",
  salt: `0x${"ab".repeat(32)}`,
};

/** All `keccak256("Name(...)")` type strings in a Solidity file (handles strings split over lines). */
function solTypeStrings(file: string): string[] {
  const src = readFileSync(path.join(CONTRACTS, file), "utf8");
  const out: string[] = [];
  const re = /keccak256\(\s*"([A-Za-z0-9]+\([^"]*\))"\s*\)/g;
  let mt: RegExpExecArray | null;
  while ((mt = re.exec(src))) out.push(mt[1]);
  return out;
}

(haveContracts ? describe : describe.skip)("type strings match the contracts", () => {
  const pot = solTypeStrings("Pot.sol");
  it.each(Object.entries(POT_TYPES))("Pot %s", (name, fields) => {
    expect(pot).toContain(encodeTypeString(name, fields));
  });
  it("PlansFactory CreatePot", () => {
    expect(solTypeStrings("PlansFactory.sol")).toContain(encodeTypeString("CreatePot", FACTORY_TYPES.CreatePot));
  });
  it("KeyRegistry RegisterKey", () => {
    expect(solTypeStrings("KeyRegistry.sol")).toContain(encodeTypeString("RegisterKey", KEYS_TYPES.RegisterKey));
  });
  it("ClaimEscrow Claim", () => {
    expect(solTypeStrings("ClaimEscrow.sol")).toContain(encodeTypeString("Claim", CLAIMS_TYPES.Claim));
  });
  it("AUSD types are the ERC-3009 / ERC-2612 standard strings", () => {
    expect(encodeTypeString("ReceiveWithAuthorization", AUSD_TYPES.ReceiveWithAuthorization)).toBe(
      "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
    );
    expect(encodeTypeString("Permit", AUSD_TYPES.Permit)).toBe("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
  });
});

/** The digest exactly as test/utils/PlansSigs.sol builds it (independent of viem's typed-data code). */
function manualDigest(name: string, verifying: Address, structHash: Hex): Hex {
  const DOMAIN = keccak256(stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
  const sep = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [DOMAIN, keccak256(stringToHex(name)), keccak256(stringToHex("1")), BigInt(chainId), verifying],
    ),
  );
  return keccak256(concatHex(["0x1901", sep, structHash]));
}
const th = (s: string) => keccak256(stringToHex(s));

describe("digests match a hand-built PlansSigs-style encoding", () => {
  const nonce = 0x1234n;
  const deadline = 1791300000n;

  it("Propose", () => {
    const split = { members: [member.address, other], weights: [1, 2] };
    const memo = "0x01020304" as Hex;
    const receipt = `0x${"cd".repeat(32)}` as Hex;
    const t = typed.propose(chainId, pot, { proposer: member.address, kind: SpendKind.PAY, payee: other, amount: 18_000_000n, category: 2, split, receiptHash: receipt, memo, nonce, deadline });
    const sh = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "uint8" }, { type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
        [
          th("Propose(address proposer,uint8 kind,address payee,uint256 amount,uint8 category,bytes32 splitHash,bytes32 receiptHash,bytes32 memoHash,uint256 nonce,uint256 deadline)"),
          member.address, 0, other, 18_000_000n, 2,
          keccak256(encodeAbiParameters([{ type: "address[]" }, { type: "uint32[]" }], [split.members, split.weights])),
          receipt, keccak256(memo), nonce, deadline,
        ],
      ),
    );
    expect(hashTypedData(t)).toBe(manualDigest("Plans Pot", pot, sh));
  });

  it("Join and Invite", async () => {
    const t = typed.join(chainId, pot, { member: member.address, country: codeToBytes("IN", 2), safetyNet: 100_000_000n, nonce, deadline });
    const sh = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "bytes2" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [th("Join(address member,bytes2 country,uint256 safetyNet,uint256 nonce,uint256 deadline)"), member.address, "0x494e", 100_000_000n, nonce, deadline],
      ),
    );
    expect(hashTypedData(t)).toBe(manualDigest("Plans Pot", pot, sh));
    const inv = typed.invite(chainId, pot, member.address);
    expect(hashTypedData(inv)).toBe(manualDigest("Plans Pot", pot, keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [th("Invite(address member)"), member.address]))));
    const sig = await member.signTypedData(t);
    expect(await recoverTypedDataAddress({ ...t, signature: sig } as never)).toBe(member.address);
  });

  it("every simple Pot message hashes like the contract", () => {
    const cases: [string, Hex, Hex][] = [
      ["Vote(address member,uint256 id,bool approve,uint256 nonce,uint256 deadline)", hashTypedData(typed.vote(chainId, pot, { member: member.address, id: 7n, approve: true, nonce, deadline })),
        keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], [th("Vote(address member,uint256 id,bool approve,uint256 nonce,uint256 deadline)"), member.address, 7n, true, nonce, deadline]))],
      ["Ack", hashTypedData(typed.ack(chainId, pot, { member: member.address, nonce, deadline })),
        keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }], [th("Ack(address member,uint256 nonce,uint256 deadline)"), member.address, nonce, deadline]))],
      ["Freeze", hashTypedData(typed.freeze(chainId, pot, { member: member.address, nonce, deadline })),
        keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }], [th("Freeze(address member,uint256 nonce,uint256 deadline)"), member.address, nonce, deadline]))],
      ["Exit", hashTypedData(typed.exit(chainId, pot, { member: member.address, nonce, deadline })),
        keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }], [th("Exit(address member,uint256 nonce,uint256 deadline)"), member.address, nonce, deadline]))],
      ["DisputeVote", hashTypedData(typed.disputeVote(chainId, pot, { member: member.address, disputeId: 2n, spenderCovers: false, nonce, deadline })),
        keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], [th("DisputeVote(address member,uint256 disputeId,bool spenderCovers,uint256 nonce,uint256 deadline)"), member.address, 2n, false, nonce, deadline]))],
    ];
    for (const [, got, sh] of cases) expect(got).toBe(manualDigest("Plans Pot", pot, sh));
  });

  it("PostKeyWraps, ProposeRules, CreatePot use abi.encode(struct) hashes", () => {
    const wraps = [{ member: other, wrap: "0x01abcdef" as Hex }];
    expect(wrapsHash(wraps)).toBe(
      keccak256(encodeAbiParameters([{ type: "tuple[]", components: [{ name: "member", type: "address" }, { name: "wrap", type: "bytes" }] }], [wraps])),
    );
    const t = typed.createPot(chainId, factory, { creator: member.address, params, nonce, deadline });
    const sh = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
        [th("CreatePot(address creator,bytes32 paramsHash,uint256 nonce,uint256 deadline)"), member.address, paramsHash(params), nonce, deadline],
      ),
    );
    expect(hashTypedData(t)).toBe(manualDigest("Plans Factory", factory, sh));
    expect(rulesHash(rules)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("AUSD ReceiveWithAuthorization uses the Agora Dollar domain", () => {
    const t = typed.receiveWithAuthorization(chainId, ausd, { from: member.address, to: pot, value: 1_000_000n, validAfter: 0n, validBefore: deadline, nonce: `0x${"11".repeat(32)}` });
    const sh = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
        [th("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"), member.address, pot, 1_000_000n, 0n, deadline, `0x${"11".repeat(32)}`],
      ),
    );
    expect(hashTypedData(t)).toBe(manualDigest("Agora Dollar", ausd, sh));
  });
});

describe("ERC-3009 nonce binding (IPlansPeriphery.sol)", () => {
  it("claim nonce = keccak256(abi.encode(claimSigner, expiry, fromCountry, salt))", () => {
    const salt = `0x${"07".repeat(32)}` as Hex;
    const n = claimAuthNonce(other, 1791900000n, codeToBytes("GB", 2), salt);
    const expected = keccak256(
      concatHex([
        `0x${"00".repeat(12)}${other.slice(2).toLowerCase()}`,
        `0x${(1791900000n).toString(16).padStart(64, "0")}`,
        `0x4742${"00".repeat(30)}`,
        salt,
      ]),
    );
    expect(n).toBe(expected);
  });

  it("send nonce = keccak256(abi.encode(meta)) with a static tuple (no offset)", () => {
    const meta: SendMeta = {
      to: other,
      fromCountry: codeToBytes("GB", 2),
      toCountry: codeToBytes("US", 2),
      fromCurrency: codeToBytes("GBP", 3),
      toCurrency: codeToBytes("USD", 3),
      fxRateE8: 132250000n,
      fxTimestamp: 1791270666n,
      memoHash: `0x${"00".repeat(32)}`,
      salt: `0x${"99".repeat(32)}`,
    };
    const word = (h: string) => h.replace(/^0x/, "");
    const right = (h: string) => word(h).padEnd(64, "0");
    const left = (h: string) => word(h).padStart(64, "0");
    const expected = keccak256(
      `0x${left(other.toLowerCase())}${right("4742")}${right("5553")}${right("474250")}${right("555344")}${left((132250000n).toString(16))}${left((1791270666n).toString(16))}${word(meta.memoHash)}${word(meta.salt)}`,
    );
    expect(sendAuthNonce(meta)).toBe(expected);
  });
});

(haveCast ? describe : describe.skip)("Foundry cast cross-check", () => {
  const cast = (...args: string[]) => execFileSync("cast", args, { encoding: "utf8" }).trim();
  it("splitHash matches cast abi-encode + keccak", () => {
    const split = { members: [member.address, other], weights: [1, 3] };
    const enc = cast("abi-encode", "f(address[],uint32[])", `[${split.members.join(",")}]`, "[1,3]");
    expect(splitHash(split)).toBe(cast("keccak", enc));
  });
  it("send nonce matches cast", () => {
    const meta: SendMeta = {
      to: other,
      fromCountry: "0x4742",
      toCountry: "0x494e",
      fromCurrency: "0x474250",
      toCurrency: "0x494e52",
      fxRateE8: 11_000_000_000n,
      fxTimestamp: 1791270666n,
      memoHash: `0x${"00".repeat(32)}`,
      salt: `0x${"42".repeat(32)}`,
    };
    const enc = cast(
      "abi-encode",
      "f((address,bytes2,bytes2,bytes3,bytes3,uint64,uint64,bytes32,bytes32))",
      `(${meta.to},${meta.fromCountry},${meta.toCountry},${meta.fromCurrency},${meta.toCurrency},${meta.fxRateE8},${meta.fxTimestamp},${meta.memoHash},${meta.salt})`,
    );
    expect(sendAuthNonce(meta)).toBe(cast("keccak", enc));
  });
  it("CreatePot paramsHash matches cast (dynamic tuple → offset word)", () => {
    const r = params.rules;
    const rulesT = `(${r.instantMax},${r.oneApprovalMax},${r.highTier},${r.memberDailyCap},${r.memberTotalCap},${r.payeePolicy},${r.minContribution},${r.proposalTtl},${r.ruleTimelock},[${r.categoryBudgets.join(",")}])`;
    const enc = cast(
      "abi-encode",
      "f(((uint64,uint64,uint8,uint64,uint64,uint8,uint64,uint32,uint32,uint64[8]),uint64,uint64,uint32,address,bytes2,uint256,bytes,bytes,bytes,bytes32))",
      `(${rulesT},${params.startTime},${params.endTime},${params.reviewWindow},${params.inviteSigner},${params.creatorCountry},${params.creatorSafetyNet},${params.meta},${params.creatorKeyWrap},${params.inviteKeyWrap},${params.salt})`,
    );
    expect(paramsHash(params)).toBe(cast("keccak", enc));
  });
});
