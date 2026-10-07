/** chain/actions: the `collect` builder and `send` with/without fxRoundId (relay is mocked). */
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const mockRelay = jest.fn(async (action: string, params: Record<string, unknown>) => ({ action, params, txHash: "0x", events: [] }));
const mockAccount = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

jest.mock("../../../config", () => ({
  config: {
    chainId: 10143,
    contracts: {
      ausd: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
      plansSend: "0x5e4d000000000000000000000000000000000005",
      plansFactory: "0xFAc7000000000000000000000000000000000001",
      keyRegistry: "0x0000000000000000000000000000000000000000",
      claimEscrow: "0xC1a1000000000000000000000000000000000003",
    },
  },
}));
jest.mock("../../api/relayer", () => ({ relay: (a: string, p: Record<string, unknown>) => mockRelay(a, p), RelayError: class extends Error {} }));
jest.mock("../../identity/session", () => ({ currentAccount: () => mockAccount }));
jest.mock("../../state/storage", () => ({ secureNonceStore: { load: jest.fn(async () => null), save: jest.fn(async () => undefined) } }));
jest.mock("../rpc", () => ({ ausdPermitNonce: jest.fn(async () => 0n), registeredKey: jest.fn(async () => null), rpc: jest.fn() }));

import { recoverTypedDataAddress } from "viem";
import { collect, send } from "../actions";
import { codeToBytes, sendAuthNonce, typed, type SendMeta } from "../eip712";

const POT = "0x9000000000000000000000000000000000000009" as Address;
const OTHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

beforeEach(() => mockRelay.mockClear());

describe("collect", () => {
  it("relays action 'collect' with {pot, member} for the signed-in account by default", async () => {
    await collect(POT);
    expect(mockRelay).toHaveBeenCalledTimes(1);
    expect(mockRelay).toHaveBeenCalledWith("collect", { pot: POT, member: mockAccount.address });
  });

  it("can collect for another member (it only ever pays that member)", async () => {
    await collect(POT, OTHER);
    expect(mockRelay).toHaveBeenCalledWith("collect", { pot: POT, member: OTHER });
  });
});

describe("send", () => {
  const meta = {
    fromCountry: codeToBytes("GB", 2),
    toCountry: codeToBytes("IN", 2),
    fromCurrency: codeToBytes("GBP", 3),
    toCurrency: codeToBytes("INR", 3),
    fxRateE8: 11_800_000_000n,
    fxTimestamp: 1791270666n,
    memoHash: `0x${"00".repeat(32)}` as const,
    salt: `0x${"42".repeat(32)}` as const,
  };

  async function sent() {
    const [action, params] = mockRelay.mock.calls[0];
    expect(action).toBe("send");
    const p = params as { from: Address; meta: SendMeta; auth: { value: bigint; validAfter: bigint; validBefore: bigint; nonce: `0x${string}`; signature: `0x${string}` } };
    // the 3009 nonce is the hash of exactly the meta that is relayed, and the signature covers it
    expect(p.auth.nonce).toBe(sendAuthNonce(p.meta));
    const typedData = typed.receiveWithAuthorization(10143, "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC", {
      from: mockAccount.address,
      to: "0x5e4d000000000000000000000000000000000005",
      value: p.auth.value,
      validAfter: p.auth.validAfter,
      validBefore: p.auth.validBefore,
      nonce: p.auth.nonce,
    });
    const signer = await recoverTypedDataAddress({ ...(typedData as object), signature: p.auth.signature } as never);
    expect(signer).toBe(mockAccount.address);
    return p;
  }

  it("without fxRoundId (older callers such as planOps) sends and hashes fxRoundId = 0n", async () => {
    await send({ to: OTHER, amount: 1_000_000n, meta });
    const p = await sent();
    expect(p.meta).toEqual({ ...meta, to: OTHER, fxRoundId: 0n });
  });

  it("with fxRoundId relays and hashes that round", async () => {
    await send({ to: OTHER, amount: 1_000_000n, meta: { ...meta, fxRoundId: 12n } });
    const p = await sent();
    expect(p.meta.fxRoundId).toBe(12n);
    expect(p.auth.nonce).toBe("0xc35a44a94347143e655f943dd94818b16ac848bd0d6feb91960d07471dd142b1"); // cast vector (sendMeta.test.ts)
  });
});
