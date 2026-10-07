/** Web "Create account": an existing passkey is always looked for first, and nothing is created without the person choosing it. */
const mockState: { calls: string[]; opts: unknown[]; find: "ok" | "cancelled" | "no-credentials" | "prf-unavailable" | "not-supported" } = { calls: [], opts: [], find: "ok" };
const calls = mockState.calls;

jest.mock("../lib/identity/session", () => {
  class PasskeyError extends Error {
    kind: string;
    detail: string;
    constructor(k: string, d: string) {
      super(k);
      this.kind = k;
      this.detail = d;
    }
  }
  return {
    PasskeyError,
    findExistingAccount: jest.fn(async (opts?: { hints?: string[] }) => {
      mockState.opts.push(opts);
      mockState.calls.push(`find${opts?.hints ? ":" + opts.hints.join(",") : ""}`);
      if (mockState.find !== "ok") throw new PasskeyError(mockState.find, "test");
      return { kind: "restored", isNew: false, linked: false };
    }),
    createNewAccount: jest.fn(async () => {
      mockState.calls.push("create");
      return { isNew: true };
    }),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const w = require("../lib/identity/webCreate") as typeof import("../lib/identity/webCreate");

beforeEach(() => {
  calls.length = 0;
  mockState.opts.length = 0;
  mockState.find = "ok";
});

describe("web create account", () => {
  it("an existing passkey answers: that account, nothing created", async () => {
    await expect(w.webCreateStart()).resolves.toEqual({ kind: "restored", isNew: false, linked: false });
    expect(calls).toEqual(["find"]);
  });

  it.each(["cancelled", "no-credentials", "prf-unavailable"] as const)("%s → the choice, never an automatic create", async (k) => {
    mockState.find = k;
    await expect(w.webCreateStart()).resolves.toEqual({ kind: "choose", why: k });
    expect(calls).toEqual(["find"]);
  });

  it("a browser without passkeys goes to the unsupported screen", async () => {
    mockState.find = "not-supported";
    await expect(w.webCreateStart()).rejects.toMatchObject({ kind: "not-supported" });
    expect(calls).toEqual(["find"]);
  });

  it("'Use your phone's passkey' asks again leading with the phone; only 'I'm new' creates", async () => {
    await w.signInWithPhone();
    expect(calls).toEqual(["find:hybrid"]);
    await w.createAsNew();
    expect(calls).toEqual(["find:hybrid", "create"]);
  });

  it("never lets a phone's passkey in half-way: the QR choice requires the keys output, the first look does when it came from another device (176a)", async () => {
    await w.webCreateStart();
    await w.signInWithPhone();
    expect(mockState.opts).toEqual([{ requireKeys: "cross-device" }, { hints: ["hybrid"], requireKeys: true }]);
  });
});
