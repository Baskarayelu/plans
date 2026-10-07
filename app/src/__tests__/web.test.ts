/**
 * Web shims: storage (only what Android stores, in localStorage), the browser passkey bridge
 * (dual PRF salts in one ceremony, error mapping), web links (secrets stay in memory), layout
 * breakpoints, the right-panel picker and the tab-title count.
 */
import { createHash } from "node:crypto";
import { fromBase64Url, toBase64Url, toHex } from "../lib/crypto/bytes";

// ─── a tiny localStorage for node ───
class MemStorage {
  m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const ls = new MemStorage();
Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });

/* eslint-disable @typescript-eslint/no-require-imports */
const kv = require("../lib/state/kv.web") as typeof import("../lib/state/kv.web");
const files = require("../lib/state/files.web") as typeof import("../lib/state/files.web");
const bridge = require("../lib/identity/passkeyBridge.web") as typeof import("../lib/identity/passkeyBridge.web");
const links = require("../lib/domain/webLinks") as typeof import("../lib/domain/webLinks");
const responsive = require("../ui/shell/responsive") as typeof import("../ui/shell/responsive");
/* eslint-enable @typescript-eslint/no-require-imports */

beforeEach(() => ls.clear());

describe("kv.web (account metadata, prefs, nonces)", () => {
  it("round-trips under a plans.kv. prefix and deletes", async () => {
    await kv.kvSet("plans.account.v1", '{"v":1}');
    expect(ls.getItem("plans.kv.plans.account.v1")).toBe('{"v":1}');
    expect(await kv.kvGet("plans.account.v1")).toBe('{"v":1}');
    await kv.kvDelete("plans.account.v1");
    expect(await kv.kvGet("plans.account.v1")).toBeNull();
  });
  it("reads null and drops writes when storage throws (private windows, blocked site data)", async () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    Object.defineProperty(globalThis, "localStorage", { value: bad, configurable: true });
    try {
      await expect(kv.kvSet("x", "y")).resolves.toBeUndefined();
      await expect(kv.kvGet("x")).resolves.toBeNull();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
    }
  });
});

describe("files.web (encrypted cache and receipt ciphertext)", () => {
  it("stores bytes as base64url and clears one folder only", () => {
    const b = new Uint8Array([1, 2, 3, 250]);
    files.fileWrite("cache", "a.bin", b);
    files.fileWrite("blobs", "h.bin", new Uint8Array([9]));
    expect(ls.getItem("plans.cache.a.bin")).toBe(toBase64Url(b));
    expect(Array.from(files.fileRead("cache", "a.bin")!)).toEqual([1, 2, 3, 250]);
    files.folderClear("cache");
    expect(files.fileRead("cache", "a.bin")).toBeNull();
    expect(Array.from(files.fileRead("blobs", "h.bin")!)).toEqual([9]);
    files.fileDelete("blobs", "h.bin");
    expect(files.fileRead("blobs", "h.bin")).toBeNull();
  });
  it("keeps receipt blobs in memory when storage is full", () => {
    const full = new MemStorage();
    full.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    Object.defineProperty(globalThis, "localStorage", { value: full, configurable: true });
    try {
      files.fileWrite("blobs", "big.bin", new Uint8Array([7, 7]));
      expect(Array.from(files.fileRead("blobs", "big.bin")!)).toEqual([7, 7]);
      expect(() => files.fileWrite("cache", "c.bin", new Uint8Array([1]))).toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
    }
  });
  it("the cache layer only ever writes ciphertext (cache.ts encrypts before files.ts)", () => {
    // cache.ts writes 0x01 ‖ nonce ‖ XChaCha20-Poly1305 output; nothing else calls fileWrite("cache").
    const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../lib/state/cache.ts"), "utf8") as string;
    expect(src).toMatch(/fileWrite\("cache", `\$\{safe\(name\)\}\.bin`, concatBytes\(new Uint8Array\(\[1\]\), nonce, ct\)\)/);
  });
});

describe("passkeyBridge.web (browser WebAuthn with two PRF salts)", () => {
  const out1 = new Uint8Array(32).fill(0x11);
  const out2 = new Uint8Array(32).fill(0x22);
  const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
  let lastOptions: { publicKey: Record<string, unknown>; mediation?: string } | null = null;
  let mode: "both" | "first" | "cancel" | "security" = "both";

  beforeEach(() => {
    lastOptions = null;
    mode = "both";
    const cred = (kind: "create" | "get") => ({
      id: "AQID",
      rawId: buf(new Uint8Array([1, 2, 3])),
      type: "public-key",
      authenticatorAttachment: "platform",
      response:
        kind === "create"
          ? { clientDataJSON: buf(new Uint8Array([1])), attestationObject: buf(new Uint8Array([2])), getTransports: () => ["internal", "hybrid"], getAuthenticatorData: () => buf(new Uint8Array(37)) }
          : { clientDataJSON: buf(new Uint8Array([1])), authenticatorData: buf(new Uint8Array(37)), signature: buf(new Uint8Array([3])), userHandle: buf(new Uint8Array([4, 5])) },
      getClientExtensionResults: () => ({
        prf: { enabled: true, results: mode === "first" ? { first: buf(out1) } : { first: buf(out1), second: buf(out2) } },
      }),
    });
    const fail = () => {
      const e = new Error(mode === "cancel" ? "The operation either timed out or was not allowed." : "bad rp");
      (e as Error & { name: string }).name = mode === "cancel" ? "NotAllowedError" : "SecurityError";
      throw e;
    };
    Object.defineProperty(globalThis, "PublicKeyCredential", { value: function PublicKeyCredential() {}, configurable: true });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        credentials: {
          async create(o: { publicKey: Record<string, unknown> }) {
            lastOptions = o;
            if (mode === "cancel" || mode === "security") fail();
            return cred("create");
          },
          async get(o: { publicKey: Record<string, unknown>; mediation?: string }) {
            lastOptions = o;
            if (mode === "cancel" || mode === "security") fail();
            return cred("get");
          },
        },
      },
    });
  });

  const salt = (s: string) => toBase64Url(new Uint8Array(createHash("sha256").update(s).digest()));

  it("asks for both salts in one get and returns both outputs as base64url", async () => {
    const r = await bridge.Passkey.getPlatformKey({
      rpId: "plans.0xo.in",
      challenge: toBase64Url(new Uint8Array(32)),
      userVerification: "required",
      extensions: { prf: { eval: { first: salt("mera.prf.salt.v1"), second: salt("plans.keys.v1") } } },
    });
    const ev = (lastOptions!.publicKey.extensions as { prf: { eval: { first: Uint8Array; second: Uint8Array } } }).prf.eval;
    expect(toHex(ev.first)).toBe(toHex(fromBase64Url(salt("mera.prf.salt.v1"))));
    expect(toHex(ev.second)).toBe(toHex(fromBase64Url(salt("plans.keys.v1"))));
    expect(lastOptions!.publicKey.allowCredentials).toBeUndefined(); // discoverable: the browser lists every passkey
    const prf = (r.clientExtensionResults as { prf: { results: { first: string; second: string } } }).prf.results;
    expect(toHex(fromBase64Url(prf.first))).toBe(toHex(out1));
    expect(toHex(fromBase64Url(prf.second))).toBe(toHex(out2));
    expect(r.rawId).toBe("AQID");
    expect(bridge.takeLastUserHandle()).toBe(toBase64Url(new Uint8Array([4, 5])));
  });

  it("works with Mera through the shared dual-PRF client (first → account, second → keys)", async () => {
    jest.resetModules();
    jest.doMock("../lib/identity/passkeyBridge", () => jest.requireActual("../lib/identity/passkeyBridge.web"));
    const { getPasskeyPrfOutput } = require("@category-labs/mera") as typeof import("@category-labs/mera");
    const wc = require("../lib/identity/webauthnClient") as typeof import("../lib/identity/webauthnClient");
    const r = await getPasskeyPrfOutput({ rpId: "plans.0xo.in", webAuthnClient: wc.createDualPrfClient() });
    expect(toHex(r.prfOutput)).toBe(toHex(out1));
    expect(toHex(wc.takeSecondOutput()!)).toBe(toHex(out2));
    jest.dontMock("../lib/identity/passkeyBridge");
  });

  it("passes allowCredentials and hints through, and creates with PRF eval at create time", async () => {
    await bridge.Passkey.getPlatformKey({ rpId: "plans.0xo.in", challenge: "AA", allowCredentials: [{ type: "public-key", id: "AQID" }], hints: ["hybrid"] });
    expect((lastOptions!.publicKey.allowCredentials as { id: Uint8Array }[])[0].id).toEqual(new Uint8Array([1, 2, 3]));
    expect(lastOptions!.publicKey.hints).toEqual(["hybrid"]);
    const c = await bridge.Passkey.createPlatformKey({
      rp: { id: "plans.0xo.in", name: "Plans" },
      user: { id: "AQ", name: "Maya", displayName: "Maya" },
      challenge: "AA",
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      extensions: { prf: { eval: { first: salt("mera.prf.salt.v1"), second: salt("plans.keys.v1") } } },
    });
    expect((lastOptions!.publicKey.rp as { id: string }).id).toBe("plans.0xo.in");
    expect(c.response.transports).toEqual(["internal", "hybrid"]);
    expect((c.clientExtensionResults as { prf: { enabled: boolean } }).prf.enabled).toBe(true);
  });

  it("returns no second output when the browser gives only one (the app then asks once more)", async () => {
    mode = "first";
    const r = await bridge.Passkey.getPlatformKey({ rpId: "plans.0xo.in", challenge: "AA", extensions: { prf: { eval: { first: salt("a"), second: salt("b") } } } });
    expect((r.clientExtensionResults as { prf: { results: Record<string, string> } }).prf.results.second).toBeUndefined();
  });

  it("maps browser errors to the app's passkey error codes", async () => {
    mode = "cancel";
    await expect(bridge.Passkey.getPlatformKey({ rpId: "plans.0xo.in", challenge: "AA" })).rejects.toMatchObject({ error: "UserCancelled" });
    mode = "security";
    await expect(bridge.Passkey.createPlatformKey({ rp: { id: "x", name: "x" }, user: { id: "AQ", name: "a", displayName: "a" }, challenge: "AA", pubKeyCredParams: [] })).rejects.toMatchObject({ error: "BadConfiguration" });
    expect(bridge.webErrorCode({ name: "NotSupportedError" })).toBe("NotSupported");
    expect(bridge.webErrorCode({ name: "InvalidStateError" })).toBe("InvalidState");
    await expect(bridge.Passkey.getImmediate({ rpId: "x", challenge: "AA" })).rejects.toMatchObject({ error: "NoCredentials" });
  });

  it("reports no passkeys in browsers without WebAuthn", async () => {
    Object.defineProperty(globalThis, "PublicKeyCredential", { value: undefined, configurable: true });
    expect(bridge.isSupported()).toBe(false);
    await expect(bridge.Passkey.getPlatformKey({ rpId: "x", challenge: "AA" })).rejects.toMatchObject({ error: "NotSupported" });
  });
});

describe("web links (secrets stay in '#', then in memory)", () => {
  const pot = "0x" + "ab".repeat(20);
  const secret = toBase64Url(new Uint8Array(32).fill(7));
  const key = toBase64Url(new Uint8Array(32).fill(9));

  it("maps /app/j, /app/join, /app/v, /app/c, /app/claim and /app/p", () => {
    for (const [path, hash] of [
      [`/j/${pot}`, `#s=${secret}&n=Maya`],
      ["/join", `#pot=${pot}&s=${secret}&n=Maya`],
      [`/v/${pot}`, `#s=${secret}&n=Maya`],
    ]) {
      const l = links.webPathToLink(path, hash);
      expect(l?.kind).toBe("invite");
      if (l?.kind === "invite") {
        expect(l.pot).toBe(pot);
        expect(toBase64Url(l.secret)).toBe(secret);
        expect(l.inviter).toBe("Maya");
      }
    }
    expect(links.webPathToLink("/c/1", `#k=${key}&n=Sam&a=25`)?.kind).toBe("claim");
    expect(links.webPathToLink("/claim", `#k=${key}`)?.kind).toBe("claim");
    expect(links.webPathToLink(`/p/${pot}`, "#n=Sam")?.kind).toBe("code");
  });

  it("ignores ordinary routes and links without their secret", () => {
    expect(links.webPathToLink("/", "")).toBeNull();
    expect(links.webPathToLink(`/plan/${pot}`, "")).toBeNull();
    expect(links.webPathToLink(`/j/${pot}`, "")).toBeNull();
    expect(links.webPathToLink("/claim", "")).toBeNull();
  });

  it("routes never contain the secret, and screens take it from memory", () => {
    const l = links.webPathToLink("/join", `#pot=${pot}&s=${secret}&n=Maya`)!;
    const route = links.routeForLink(l);
    expect(route).toBe(`/join?pot=${pot}&n=Maya`);
    expect(route).not.toContain(secret);
    links.pendingLink.set(l);
    expect(links.takeInviteSecret(pot)).toBe(secret);
    expect(links.takeInviteSecret("0x" + "cd".repeat(20))).toBeUndefined();
    const c = links.webPathToLink("/claim", `#k=${key}&n=Sam`)!;
    expect(links.routeForLink(c)).toBe("/claim?n=Sam");
    links.pendingLink.set(c);
    expect(links.takeClaimKey()).toBe(key);
  });
});

describe("layout breakpoints (design 101)", () => {
  it("phone < 760, tablet 760–1023, laptop 1024–1439, wide ≥ 1440; Android is always phone", () => {
    const m = responsive.modeForWidth;
    expect([390, 759, 760, 1023, 1024, 1439, 1440, 1920].map((w) => m(w, "web"))).toEqual(["phone", "phone", "tablet", "tablet", "laptop", "laptop", "wide", "wide"]);
    expect(m(1920, "android")).toBe("phone");
    expect(responsive.confirmLabelFor("phone")).toBe("Confirm with fingerprint");
    expect(responsive.confirmLabelFor("laptop")).toBe("Confirm with passkey");
    expect(responsive.confirmLabelFor("wide")).toBe("Confirm with passkey");
  });
});

describe("right panel picker", () => {
  it("shows the newest detail, else the form, else the live panel", () => {
    jest.isolateModules(() => {
      jest.doMock("expo-router", () => ({ useIsFocused: () => true }));
      const { pickPanel } = require("../ui/shell/panel") as typeof import("../ui/shell/panel");
      const e = (id: string, kind: "live" | "form" | "detail", seq: number) => ({ id, kind, seq, node: null, pad: true });
      expect(pickPanel([])).toBeUndefined();
      expect(pickPanel([e("a", "live", 1)])?.id).toBe("a");
      expect(pickPanel([e("a", "live", 1), e("b", "form", 2)])?.id).toBe("b");
      expect(pickPanel([e("a", "live", 1), e("b", "form", 2), e("c", "detail", 3), e("d", "detail", 4)])?.id).toBe("d");
    });
  });
});

describe("notify.web (tab title count while hidden)", () => {
  it("counts banners while the tab is hidden and clears when it's visible again", () => {
    const listeners: Record<string, () => void> = {};
    const doc = { title: "Plans", hidden: true, addEventListener: (n: string, f: () => void) => (listeners[n] = f) };
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
    jest.isolateModules(() => {
      const n = require("../lib/state/notify.web") as typeof import("../lib/state/notify.web");
      expect(n.usesPush).toBe(false);
      n.attention({ title: "Sam paid $36" });
      n.attention({ title: "Asha wants $250" });
      expect(doc.title).toBe("(2) Plans");
      doc.hidden = false;
      listeners.visibilitychange();
      expect(doc.title).toBe("Plans");
      n.attention({ title: "visible: no count" });
      expect(doc.title).toBe("Plans");
    });
    Object.defineProperty(globalThis, "document", { value: undefined, configurable: true });
  });
});

describe("QR decoding for the web scanner and photo upload", () => {
  it("reads a Plans code drawn as pixels (what a camera frame or photo gives the decoder)", () => {
    const QRCode = require("qrcode") as { create: (t: string, o?: object) => { modules: { size: number; get: (x: number, y: number) => number } } };
    const { decodeQrPixels } = require("../lib/qr/decode") as typeof import("../lib/qr/decode");
    const text = "https://plans.0xo.in/p/0x" + "ab".repeat(20) + "#n=Sam";
    const q = QRCode.create(text, { errorCorrectionLevel: "M" });
    const scale = 6;
    const quiet = 4;
    const n = (q.modules.size + quiet * 2) * scale;
    const px = new Uint8ClampedArray(n * n * 4).fill(255);
    for (let y = 0; y < q.modules.size; y++)
      for (let x = 0; x < q.modules.size; x++)
        if (q.modules.get(x, y))
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++) {
              const i = (((y + quiet) * scale + dy) * n + (x + quiet) * scale + dx) * 4;
              px[i] = px[i + 1] = px[i + 2] = 0;
            }
    expect(decodeQrPixels(px, n, n)).toBe(text);
    expect(decodeQrPixels(new Uint8ClampedArray(64 * 64 * 4).fill(255), 64, 64)).toBeNull();
  });
});
