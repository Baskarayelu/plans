/**
 * The dual-PRF Mera client: one ceremony asks for both salts; Mera gets `first`, the keys
 * namespace gets `second`; missing `second` degrades cleanly.
 */
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput } from "@category-labs/mera";
import { createHash } from "node:crypto";
import { fromBase64Url, toBase64Url, toHex } from "../lib/crypto/bytes";

type Req = { extensions?: { prf?: { eval?: { first?: string; second?: string } } } };
const mockState: { calls: { kind: string; req: Req }[]; mode: "both" | "first-only" | "create-enabled-only" } = { calls: [], mode: "both" };
const calls = mockState.calls;

const out1 = new Uint8Array(32).fill(0x11);
const out2 = new Uint8Array(32).fill(0x22);
const mockOut1 = Buffer.from(out1).toString("base64url");
const mockOut2 = Buffer.from(out2).toString("base64url");

jest.mock("react-native-passkey", () => ({
  Passkey: {
    async createPlatformKey(req: Req) {
      mockState.calls.push({ kind: "create", req });
      const m = mockState.mode;
      const results = m === "both" ? { first: mockOut1, second: mockOut2 } : m === "first-only" ? { first: mockOut1 } : undefined;
      return {
        id: "AQID",
        rawId: "AQID",
        response: { clientDataJSON: "", attestationObject: "", transports: ["internal", "hybrid"] },
        clientExtensionResults: { prf: { enabled: true, ...(results ? { results } : {}) } },
      };
    },
    async getPlatformKey(req: Req) {
      mockState.calls.push({ kind: "get", req });
      const results = mockState.mode === "first-only" ? { first: mockOut1 } : { first: mockOut1, second: mockOut2 };
      return { id: "AQID", rawId: "AQID", response: {}, clientExtensionResults: { prf: { results } } };
    },
    async getImmediate(req: Req) {
      mockState.calls.push({ kind: "immediate", req });
      throw { error: "NoCredentials", message: "none" };
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createDualPrfClient, takeSecondOutput, ceremoniesSince } = require("../lib/identity/webauthnClient") as typeof import("../lib/identity/webauthnClient");

const sha = (s: string) => toBase64Url(new Uint8Array(createHash("sha256").update(s).digest()));

beforeEach(() => {
  calls.length = 0;
  mockState.mode = "both";
});

describe("dual PRF client", () => {
  it("asks for both salts in one get ceremony and splits the outputs", async () => {
    const t0 = Date.now();
    const r = await getPasskeyPrfOutput({ rpId: "plans.0xo.in", webAuthnClient: createDualPrfClient() });
    expect(calls).toHaveLength(1);
    expect(calls[0].req.extensions?.prf?.eval?.first).toBe(sha("mera.prf.salt.v1"));
    expect(calls[0].req.extensions?.prf?.eval?.second).toBe(sha("plans.keys.v1"));
    expect(toHex(r.prfOutput)).toBe(toHex(out1));
    expect(toHex(takeSecondOutput()!)).toBe(toHex(out2));
    expect(takeSecondOutput()).toBeNull();
    expect(ceremoniesSince(t0)[0]).toMatchObject({ kind: "get", gotFirst: true, gotSecond: true });
  });

  it("returns first only when the provider ignores second", async () => {
    mockState.mode = "first-only";
    const r = await getPasskeyPrfOutput({ rpId: "plans.0xo.in", webAuthnClient: createDualPrfClient() });
    expect(toHex(r.prfOutput)).toBe(toHex(out1));
    expect(takeSecondOutput()).toBeNull();
  });

  it("create evaluates both salts at creation (one prompt)", async () => {
    const r = await createPasskeyWithPrfOutput({ rp: { id: "plans.0xo.in", name: "Plans" }, user: { name: "a", displayName: "a" }, webAuthnClient: createDualPrfClient() });
    expect(calls.map((c) => c.kind)).toEqual(["create"]);
    expect(toHex(r.prfOutput)).toBe(toHex(out1));
    expect(toHex(takeSecondOutput()!)).toBe(toHex(out2));
  });

  it("create without create-time outputs falls back to one get that also asks for both", async () => {
    mockState.mode = "create-enabled-only";
    await createPasskeyWithPrfOutput({ rp: { id: "plans.0xo.in", name: "Plans" }, user: { name: "a", displayName: "a" }, webAuthnClient: createDualPrfClient() });
    expect(calls.map((c) => c.kind)).toEqual(["create", "get"]);
    expect(calls[1].req.extensions?.prf?.eval?.second).toBe(sha("plans.keys.v1"));
    expect(takeSecondOutput()).not.toBeNull();
  });

  it("keys-only ceremony asks for one salt", async () => {
    const keysSalt = fromBase64Url(sha("plans.keys.v1"));
    await getPasskeyPrfOutput({ rpId: "plans.0xo.in", prfSalt: keysSalt, webAuthnClient: createDualPrfClient({ secondSalt: null }) });
    expect(calls[0].req.extensions?.prf?.eval?.first).toBe(sha("plans.keys.v1"));
    expect(calls[0].req.extensions?.prf?.eval?.second).toBeUndefined();
  });

  it("immediate mode reports no credentials without UI", async () => {
    await expect(getPasskeyPrfOutput({ rpId: "plans.0xo.in", webAuthnClient: createDualPrfClient({ immediate: true }) })).rejects.toMatchObject({ code: "PASSKEY_OPERATION_FAILED" });
    expect(calls[0].kind).toBe("immediate");
  });
});
