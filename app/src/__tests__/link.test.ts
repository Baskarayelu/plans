/**
 * "Link this browser" (docs/crypto.md §9): code, offer, QR, fingerprint, reply, vault, the
 * relayer slot client and the browser-side orchestration against an in-memory slot server.
 */
jest.mock("../config", () => ({ config: { relayerUrl: "https://relayer.test", linkHost: "plans.0xo.in", rpId: "plans.0xo.in" } }));

import { x25519 } from "@noble/curves/ed25519.js";
import { createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { createHash, hkdfSync } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { fromBase64Url, fromHex, toBase64Url, toHex, utf8 } from "../lib/crypto/bytes";
import { FINGERPRINT_EMOJI, emojiFromDigest, keyFingerprint } from "../lib/crypto/fingerprint";
import { deriveAccountPrivateKey, deriveKeys } from "../lib/crypto/keys";
import { seal } from "../lib/crypto/seal";
import { loadVault, saveVault, startBrowserLink } from "../lib/link/browserLink";
import {
  accountAddress,
  bundleFromPrf,
  CROCKFORD,
  decodeBundle,
  encodeBundle,
  formatCode,
  LinkError,
  linkFingerprint,
  linkQrUrl,
  linkSecretFromCode,
  makeOffer,
  newLinkCode,
  normaliseCode,
  openOffer,
  openReply,
  openVault,
  parseLinkQr,
  replyContext,
  sealReply,
  sealVault,
  slotIds,
  vaultId,
  vaultKeys,
  verifyBundle,
  type AccountBundle,
} from "../lib/link/protocol";
import { getSlot, putSlot, SlotError } from "../lib/link/slots";

const PRF_A = fromHex("0x0101010101010101010101010101010101010101010101010101010101010101");
const PRF_B = fromHex("0xa0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf");
const CODE = "0123456789AB";
const NOW = 1_800_000_000;
const PROFILE = { name: "Leah", country: "GB", currency: "GBP", city: "London" };

const hex = (b: Uint8Array) => toHex(b).slice(2);
const nodeSha = (...parts: (string | Uint8Array)[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(typeof p === "string" ? Buffer.from(p, "utf8") : p);
  return new Uint8Array(h.digest());
};
const nodeHkdf = (ikm: Uint8Array, salt: string | Uint8Array, info: string) =>
  new Uint8Array(hkdfSync("sha256", ikm, typeof salt === "string" ? utf8(salt) : salt, utf8(info), 32));

function expectLinkError(f: () => unknown, kind: LinkError["kind"]) {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(LinkError);
    expect((e as LinkError).kind).toBe(kind);
    return;
  }
  throw new Error(`expected LinkError ${kind}`);
}

function phoneBundle(t = NOW): AccountBundle {
  return bundleFromPrf(PRF_A, PRF_B, PROFILE, t);
}

function linkKeys() {
  const secret = x25519.utils.randomSecretKey();
  return { secret, pub: x25519.getPublicKey(secret) };
}

describe("link code", () => {
  it("generates 12 Crockford characters from 60 bits", () => {
    for (let i = 0; i < 50; i++) {
      const c = newLinkCode();
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
      expect(normaliseCode(c)).toBe(c);
    }
    // fixed bits → fixed code: 0xff.. gives all 'Z'; 0x00.. all '0'
    expect(newLinkCode((n) => new Uint8Array(n).fill(0xff))).toBe("ZZZZZZZZZZZZ");
    expect(newLinkCode((n) => new Uint8Array(n))).toBe("000000000000");
    // 0x08 0x86 0x42 ... = 00001 00010 00011 00100 ... (first 4 groups 1,2,3,4)
    expect(newLinkCode(() => new Uint8Array([0x08, 0x86, 0x42, 0, 0, 0, 0, 0])).slice(0, 4)).toBe("1234");
    expect(CROCKFORD).toHaveLength(32);
  });

  it("normalises typed input and formats for display", () => {
    expect(normaliseCode("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(normaliseCode(" abcd efgh  jkmn ")).toBe("ABCDEFGHJKMN");
    expect(normaliseCode("ILOo-0123-4567")).toBe("1100" + "01234567");
    expect(formatCode("0123456789ab")).toBe("0123-4567-89AB");
    expect(formatCode("0123-4567-89AB")).toBe("0123-4567-89AB");
    expectLinkError(() => normaliseCode("0123-4567-89AU"), "bad-code"); // U is not Crockford
    expectLinkError(() => normaliseCode("0123-4567-89A"), "bad-code");
    expectLinkError(() => normaliseCode("0123-4567-89ABC"), "bad-code");
    expectLinkError(() => normaliseCode("0123-4567-89A!"), "bad-code");
    // typed variants give the same secret
    expect(hex(linkSecretFromCode("0123-4567-89ab"))).toBe(hex(linkSecretFromCode(CODE)));
    expect(hex(linkSecretFromCode("O123-4567-89AB"))).toBe(hex(linkSecretFromCode(CODE)));
  });
});

describe("fixed vectors (checked against node:crypto)", () => {
  const s = linkSecretFromCode(CODE);

  it("s = HKDF(code, salt 'plans/v1/link', info 'plans/v1/link-secret')", () => {
    expect(hex(s)).toBe(hex(nodeHkdf(utf8(CODE), "plans/v1/link", "plans/v1/link-secret")));
    expect(hex(s)).toBe("f52ea686d420735524c29e1970805855957d1cd49c4c90718f5b4ee247058128");
  });

  it("slot ids = sha256(prefix ‖ s)", () => {
    const ids = slotIds(s);
    expect(ids.offer).toBe(hex(nodeSha("plans/v1/link-offer|", s)));
    expect(ids.reply).toBe(hex(nodeSha("plans/v1/link-reply|", s)));
    expect(ids.offer).toBe("bd8296e5f34a5911c7de7ae8b8e27495759178267a83b87c24cb6ce80a1614ca");
    expect(ids.reply).toBe("16a77a317f267e50e92382461afc5a5e3226c215b1c54f2f89ece0c8bc44e7e3");
  });

  it("vault keys and id", () => {
    const b2 = new Uint8Array(32).fill(0x42);
    const v = vaultKeys(b2);
    expect(hex(v.key)).toBe(hex(nodeHkdf(b2, new Uint8Array(), "plans/v1/vault")));
    expect(hex(v.auth)).toBe(hex(nodeHkdf(b2, new Uint8Array(), "plans/v1/vault-auth")));
    expect(hex(v.key)).toBe("ea287b7f705239e6023271e96b91a113f8a006594e0118e94535c85963e905e4");
    expect(hex(v.auth)).toBe("f67778d1d5f8776281693815bb8fda55d0813c058eeeeb2b63fd51748413344d");
    expect(vaultId(new Uint8Array([1, 2, 3]))).toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
  });

  it("offer box = 0x01 ‖ nonce ‖ XChaCha20-Poly1305(HKDF(s,'','plans/v1/link-offer'))", () => {
    const { pub } = linkKeys();
    const nonce = new Uint8Array(24).fill(7);
    const box = makeOffer(s, pub, NOW + 600, "Safari on Mac", nonce);
    expect(box[0]).toBe(1);
    expect(hex(box.slice(1, 25))).toBe(hex(nonce));
    // decrypt independently with the node-derived key
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { xchacha20poly1305 } = require("@noble/ciphers/chacha.js");
    const key = nodeHkdf(s, new Uint8Array(), "plans/v1/link-offer");
    const pt = JSON.parse(Buffer.from(xchacha20poly1305(key, nonce, utf8("plans/v1/link-offer")).decrypt(box.slice(25))).toString());
    expect(pt).toEqual({ v: 1, k: toBase64Url(pub), e: NOW + 600, d: "Safari on Mac" });
  });

  it("link fingerprint = EMOJI[d0..d2] of sha256('plans/v1/link-fp' ‖ s ‖ linkPub)", () => {
    const pub = new Uint8Array(32).fill(9);
    const d = nodeSha("plans/v1/link-fp", s, pub);
    expect(linkFingerprint(s, pub)).toBe(FINGERPRINT_EMOJI[d[0]] + FINGERPRINT_EMOJI[d[1]] + FINGERPRINT_EMOJI[d[2]]);
  });

  it("emojiFromDigest keeps keyFingerprint unchanged", () => {
    const k = new Uint8Array(32);
    expect(keyFingerprint(k)).toBe(emojiFromDigest(nodeSha(k)));
    expect(keyFingerprint(k)).toBe(FINGERPRINT_EMOJI[0x66] + FINGERPRINT_EMOJI[0x68] + FINGERPRINT_EMOJI[0x7a]);
  });
});

describe("offer", () => {
  it("round-trips and rejects the wrong code, tampering and expiry", () => {
    const s = linkSecretFromCode(CODE);
    const { pub } = linkKeys();
    const box = makeOffer(s, pub, NOW + 600, "Chrome on Windows");
    const o = openOffer(s, box, NOW);
    expect(hex(o.linkPub)).toBe(hex(pub));
    expect(o.exp).toBe(NOW + 600);
    expect(o.deviceLabel).toBe("Chrome on Windows");

    expectLinkError(() => openOffer(linkSecretFromCode("0123456789AC"), box, NOW), "tampered");
    const bad = new Uint8Array(box);
    bad[bad.length - 1] ^= 1;
    expectLinkError(() => openOffer(s, bad, NOW), "tampered");
    expectLinkError(() => openOffer(s, box, NOW + 601), "expired");
    // the wrong code also points at a different slot
    expect(slotIds(linkSecretFromCode("0123456789AC")).offer).not.toBe(slotIds(s).offer);
  });
});

describe("QR", () => {
  it("round-trips the URL", () => {
    const { pub } = linkKeys();
    const url = linkQrUrl(CODE, pub, NOW + 600, "plans.0xo.in");
    expect(url).toBe(`https://plans.0xo.in/app/link#c=${CODE}&k=${toBase64Url(pub)}&e=${NOW + 600}`);
    const q = parseLinkQr(url, { host: "plans.0xo.in" });
    expect(q.code).toBe(CODE);
    expect(hex(q.linkPub)).toBe(hex(pub));
    expect(q.exp).toBe(NOW + 600);
  });

  it("rejects other hosts, other paths and broken fields", () => {
    const { pub } = linkKeys();
    const k = toBase64Url(pub);
    expectLinkError(() => parseLinkQr(`https://evil.example/app/link#c=${CODE}&k=${k}&e=1`, { host: "plans.0xo.in" }), "bad-code");
    expectLinkError(() => parseLinkQr(`https://plans.0xo.in/j/abc#c=${CODE}&k=${k}&e=1`), "bad-code");
    expectLinkError(() => parseLinkQr(`https://plans.0xo.in/app/link#c=${CODE}&k=${k.slice(2)}&e=1`), "bad-code");
    expectLinkError(() => parseLinkQr(`https://plans.0xo.in/app/link#c=${CODE}&k=${k}`), "bad-code");
    expectLinkError(() => parseLinkQr(`https://plans.0xo.in/app/link#c=0123U&k=${k}&e=1`), "bad-code");
    expectLinkError(() => parseLinkQr("hello"), "bad-code");
  });
});

describe("link fingerprint", () => {
  it("is deterministic and differs for another key or another code", () => {
    const s = linkSecretFromCode(CODE);
    const a = linkKeys().pub;
    const b = linkKeys().pub;
    expect(linkFingerprint(s, a)).toBe(linkFingerprint(new Uint8Array(s), new Uint8Array(a)));
    expect([...linkFingerprint(s, a)]).toHaveLength(3);
    expect(linkFingerprint(s, a)).not.toBe(linkFingerprint(s, b));
    expect(linkFingerprint(s, a)).not.toBe(linkFingerprint(linkSecretFromCode("0123456789AC"), a));
  });
});

describe("account bundle and reply", () => {
  const s = linkSecretFromCode(CODE);
  const exp = NOW + 600;

  it("bundle carries the derived account key (not the PRF) and verifies", () => {
    const b = phoneBundle();
    expect(hex(b.accountKey)).toBe(hex(deriveAccountPrivateKey(PRF_A)));
    expect(hex(b.accountKey)).not.toBe(hex(PRF_A));
    expect(hex(b.keysIkm)).toBe(hex(PRF_B));
    expect(b.address).toBe(privateKeyToAccount(toHex(b.accountKey)).address);
    expect(b.fingerprint).toBe(deriveKeys(PRF_B).fingerprint);
    const json = JSON.parse(Buffer.from(encodeBundle(b)).toString());
    expect(Object.keys(json).sort()).toEqual(["a", "addr", "fp", "k", "p", "t", "v"]);
    expect(json.addr).toBe(b.address);
    expect(json.p).toEqual(PROFILE);
    const back = decodeBundle(encodeBundle(b));
    expect(back.address).toBe(b.address);
    expect(back.profile).toEqual(PROFILE);
    verifyBundle(back, { now: NOW, exp });
  });

  it("reply round-trips with the right link key", () => {
    const { secret, pub } = linkKeys();
    const sealed = sealReply(pub, s, exp, phoneBundle(NOW + 5));
    const b = openReply(secret, s, exp, sealed, NOW + 10);
    expect(b.address).toBe(phoneBundle().address);
    expect(b.fingerprint).toBe(deriveKeys(PRF_B).fingerprint);
    expect(b.profile).toEqual(PROFILE);
    expect(b.t).toBe(NOW + 5);
  });

  it("another X25519 key can't open it", () => {
    const { pub } = linkKeys();
    const sealed = sealReply(pub, s, exp, phoneBundle());
    expectLinkError(() => openReply(linkKeys().secret, s, exp, sealed, NOW), "tampered");
  });

  it("an expired link is rejected, and so is a reply time outside the window", () => {
    const { secret, pub } = linkKeys();
    expectLinkError(() => openReply(secret, s, exp, sealReply(pub, s, exp, phoneBundle()), exp + 1), "expired");
    expectLinkError(() => openReply(secret, s, exp, sealReply(pub, s, exp, phoneBundle(NOW - 661)), NOW), "expired");
    expectLinkError(() => openReply(secret, s, exp, sealReply(pub, s, exp, phoneBundle(NOW + 61)), NOW), "expired");
    expect(openReply(secret, s, exp, sealReply(pub, s, exp, phoneBundle(NOW + 60)), NOW).t).toBe(NOW + 60);
  });

  it("a tampered reply (one flipped byte anywhere) is rejected", () => {
    const { secret, pub } = linkKeys();
    const sealed = sealReply(pub, s, exp, phoneBundle());
    for (const i of [1, 40, 60, sealed.length - 1]) {
      const bad = new Uint8Array(sealed);
      bad[i] ^= 0x01;
      expectLinkError(() => openReply(secret, s, exp, bad, NOW), "tampered");
    }
  });

  it("a reply sealed for another s or another exp (context) is rejected", () => {
    const { secret, pub } = linkKeys();
    const otherS = linkSecretFromCode("ZZZZZZZZZZZZ");
    expectLinkError(() => openReply(secret, s, exp, sealReply(pub, otherS, exp, phoneBundle()), NOW), "tampered");
    expectLinkError(() => openReply(secret, s, exp, sealReply(pub, s, exp + 1, phoneBundle()), NOW), "tampered");
    // a plain seal with no link context (someone who knows linkPub but not s) is rejected too
    expectLinkError(() => openReply(secret, s, exp, seal(pub, encodeBundle(phoneBundle()), ""), NOW), "tampered");
    expect(replyContext(s, exp)).toBe(`link|${hex(s)}|${exp}`);
  });

  it("a bundle whose addr doesn't match a, or whose fp doesn't match k, is rejected", () => {
    const { secret, pub } = linkKeys();
    const wrongAddr = { ...phoneBundle(), address: "0x000000000000000000000000000000000000dEaD" as const };
    expectLinkError(() => openReply(secret, s, exp, sealReply(pub, s, exp, wrongAddr), NOW), "wrong-account");
    const wrongFp = { ...phoneBundle(), keysIkm: new Uint8Array(32).fill(3) };
    expectLinkError(() => openReply(secret, s, exp, sealReply(pub, s, exp, wrongFp), NOW), "wrong-account");
    const wrongKey = { ...phoneBundle(), accountKey: deriveAccountPrivateKey(PRF_B) };
    expectLinkError(() => openReply(secret, s, exp, sealReply(pub, s, exp, wrongKey), NOW), "wrong-account");
  });

  it("malformed bundles are 'tampered'", () => {
    expectLinkError(() => decodeBundle(utf8("{}")), "tampered");
    expectLinkError(() => decodeBundle(utf8("not json")), "tampered");
    const j = JSON.parse(Buffer.from(encodeBundle(phoneBundle())).toString());
    expectLinkError(() => decodeBundle(utf8(JSON.stringify({ ...j, v: 2 }))), "tampered");
    expectLinkError(() => decodeBundle(utf8(JSON.stringify({ ...j, a: "zz" }))), "tampered");
  });
});

describe("browser-side derivation equals the phone's own", () => {
  it("the Mera session from the bundle's key gives the phone's address; deriveKeys(k) gives its fingerprint", async () => {
    // The phone's own unlock: PRF first → Mera recipe → session; PRF second → keys.
    const phonePk = deriveAccountPrivateKey(new Uint8Array(PRF_A));
    const phoneAccount = toViemAccount(createSecp256k1SigningSession({ privateKey: phonePk }));
    const phoneFp = deriveKeys(new Uint8Array(PRF_B)).fingerprint;

    // The browser after the link: reply → bundle → openFromBundle's steps.
    const { secret, pub } = linkKeys();
    const s = linkSecretFromCode(CODE);
    const b = openReply(secret, s, NOW + 600, sealReply(pub, s, NOW + 600, phoneBundle()), NOW);
    const browserAccount = toViemAccount(createSecp256k1SigningSession({ privateKey: new Uint8Array(b.accountKey) }));
    const browserKeys = deriveKeys(b.keysIkm);

    expect(browserAccount.address).toBe(phoneAccount.address);
    expect(browserAccount.address).toBe(b.address);
    expect(accountAddress(b.accountKey)).toBe(phoneAccount.address);
    expect(browserKeys.fingerprint).toBe(phoneFp);
    expect(hex(browserKeys.x25519Public)).toBe(hex(deriveKeys(PRF_B).x25519Public));
    // and both sign the same way
    const msg = "plans link test";
    expect(await browserAccount.signMessage({ message: msg })).toBe(await phoneAccount.signMessage({ message: msg }));
  });
});

describe("vault", () => {
  const b2 = new Uint8Array(32).fill(0x42);
  const cred = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]);

  it("round-trips (t stored as linkedAt)", () => {
    const v = sealVault(b2, cred, phoneBundle(NOW));
    expect(v.id).toBe(hex(nodeSha(cred)));
    expect(v.auth).toBe(hex(nodeHkdf(b2, new Uint8Array(), "plans/v1/vault-auth")));
    expect(v.box[0]).toBe(1);
    // independent decrypt: key from node HKDF, aad "plans/v1/vault|" + id
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { xchacha20poly1305 } = require("@noble/ciphers/chacha.js");
    const pt = JSON.parse(
      Buffer.from(xchacha20poly1305(nodeHkdf(b2, new Uint8Array(), "plans/v1/vault"), v.box.slice(1, 25), utf8(`plans/v1/vault|${v.id}`)).decrypt(v.box.slice(25))).toString(),
    );
    expect(pt.linkedAt).toBe(NOW);
    expect(pt.t).toBeUndefined();
    const b = openVault(b2, cred, v.box);
    expect(b.address).toBe(phoneBundle().address);
    expect(b.t).toBe(NOW);
    expect(b.profile).toEqual(PROFILE);
  });

  it("rejects the wrong b2, the wrong credential id and tampering", () => {
    const v = sealVault(b2, cred, phoneBundle());
    expectLinkError(() => openVault(new Uint8Array(32).fill(0x43), cred, v.box), "tampered");
    expectLinkError(() => openVault(b2, new Uint8Array([9, 8, 7]), v.box), "tampered");
    const bad = new Uint8Array(v.box);
    bad[30] ^= 0x80;
    expectLinkError(() => openVault(b2, cred, bad), "tampered");
    expectLinkError(() => openVault(b2, cred, v.box.slice(0, 20)), "tampered");
  });
});

// ─────────────── slot client and browser orchestration (mocked fetch) ───────────────

type Slot = { data: string; expiresAt: number | null; auth?: string };
const server = { slots: new Map<string, Slot>(), now: NOW, fail: 0, calls: [] as { method: string; id: string; body?: Record<string, unknown> }[] };

function json(status: number, body: unknown) {
  return { status, text: async () => JSON.stringify(body), headers: new Headers() } as unknown as Response;
}

const fetchMock = jest.fn(async (url: string, init: RequestInit = {}) => {
  if (server.fail > 0) {
    server.fail--;
    throw new TypeError("Failed to fetch");
  }
  const m = /\/v1\/slots\/(.+)$/.exec(url);
  if (!m) return json(404, { error: { code: "NOT_FOUND" } });
  const id = m[1];
  const method = init.method ?? "GET";
  if (method === "PUT") {
    const body = JSON.parse(String(init.body)) as { data: string; ttl?: number; auth?: string };
    server.calls.push({ method, id, body });
    if (fromBase64Url(body.data).length > 8192) return json(413, { error: { code: "SLOT_TOO_LARGE" } });
    const cur = server.slots.get(id);
    const live = cur && (cur.expiresAt === null || cur.expiresAt > server.now);
    if (live && (!cur!.auth || cur!.auth !== body.auth)) return json(409, { error: { code: "SLOT_TAKEN", message: "taken" } });
    const expiresAt = body.ttl ? server.now + body.ttl : null;
    server.slots.set(id, { data: body.data, expiresAt, auth: body.auth });
    return json(live ? 200 : 201, { id, created: !live, expiresAt });
  }
  server.calls.push({ method, id });
  const cur = server.slots.get(id);
  if (!cur || (cur.expiresAt !== null && cur.expiresAt <= server.now)) return json(404, { error: { code: "NOT_FOUND" } });
  return json(200, { data: cur.data, expiresAt: cur.expiresAt });
});

beforeEach(() => {
  server.slots.clear();
  server.calls.length = 0;
  server.now = NOW;
  server.fail = 0;
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

describe("slots client", () => {
  const id = "ab".repeat(32);

  it("puts and gets bytes; 404 → null", async () => {
    expect(await getSlot(id)).toBeNull();
    expect(await putSlot(id, new Uint8Array([1, 2, 3]), { ttl: 600 })).toEqual({ created: true, expiresAt: NOW + 600 });
    expect(server.calls[1].body).toEqual({ data: "AQID", ttl: 600 });
    expect(Array.from((await getSlot(id))!)).toEqual([1, 2, 3]);
  });

  it("409 → SlotError taken; overwrite with the same auth works", async () => {
    await putSlot(id, new Uint8Array([1]), { ttl: 600 });
    await expect(putSlot(id, new Uint8Array([2]), { ttl: 600 })).rejects.toMatchObject({ kind: "taken", status: 409 });
    const v = "cd".repeat(32);
    const auth = "11".repeat(32);
    expect((await putSlot(v, new Uint8Array([1]), { auth })).created).toBe(true);
    expect((await putSlot(v, new Uint8Array([2]), { auth })).created).toBe(false);
    await expect(putSlot(v, new Uint8Array([3]), { auth: "22".repeat(32) })).rejects.toBeInstanceOf(SlotError);
  });

  it("network failure → SlotError offline with plain words", async () => {
    server.fail = 1;
    const e = await getSlot(id).catch((x) => x);
    expect(e).toBeInstanceOf(SlotError);
    expect(e.kind).toBe("offline");
    expect(e.friendly).not.toMatch(/wallet|address|token|chain|crypto/i);
  });

  it("refuses malformed ids before any request", async () => {
    await expect(getSlot("xyz")).rejects.toThrow();
    expect(server.calls).toHaveLength(0);
  });
});

describe("browser link orchestration", () => {
  it("uploads an offer, waits for the phone's reply, verifies it and saves the vault", async () => {
    const b2 = new Uint8Array(32).fill(0x42);
    const credentialId = toBase64Url(new Uint8Array([5, 5, 5]));
    const link = await startBrowserLink({ b2, credentialId, deviceLabel: "Safari on Mac", pollMs: 1, now: () => server.now });
    expect(link.displayCode).toBe(formatCode(link.code));
    expect(link.exp).toBe(NOW + 600);
    const q = parseLinkQr(link.qrUrl, { host: "plans.0xo.in" });
    expect(q.code).toBe(link.code);

    // typed-code path: the phone finds the offer, sees the same fingerprint
    const s = linkSecretFromCode(link.code);
    const offerSlot = server.slots.get(slotIds(s).offer)!;
    expect(offerSlot.expiresAt).toBe(NOW + 600);
    const offer = openOffer(s, fromBase64Url(offerSlot.data), NOW);
    expect(offer.deviceLabel).toBe("Safari on Mac");
    expect(hex(offer.linkPub)).toBe(hex(q.linkPub));
    expect(linkFingerprint(s, offer.linkPub)).toBe(link.fingerprint);

    const waiting = link.wait();
    await new Promise((r) => setTimeout(r, 5));
    // phone replies (as phoneLink.sendAccountToBrowser does)
    await putSlot(slotIds(s).reply, sealReply(offer.linkPub, s, offer.exp, phoneBundle(NOW)), { ttl: 600 });
    const bundle = await waiting;
    expect(bundle.address).toBe(phoneBundle().address);

    // the vault was saved for this browser's passkey and opens with b2
    const vault = server.slots.get(vaultId(new Uint8Array([5, 5, 5])))!;
    expect(vault.expiresAt).toBeNull();
    expect(vault.auth).toBe(hex(vaultKeys(b2).auth));
    const loaded = await loadVault(b2, new Uint8Array([5, 5, 5]));
    expect(loaded!.address).toBe(bundle.address);
    expect(loaded!.t).toBe(NOW);
    // a second answer to the same link is refused by the slot
    await expect(putSlot(slotIds(s).reply, new Uint8Array([1]), { ttl: 600 })).rejects.toMatchObject({ kind: "taken" });
    // the link is single-use
    await expect(link.wait()).rejects.toMatchObject({ kind: "expired" });
  });

  it("expires after 10 minutes without a reply and keeps polling through a network blip", async () => {
    const link = await startBrowserLink({ pollMs: 1, now: () => server.now });
    server.fail = 2;
    const waiting = link.wait();
    await new Promise((r) => setTimeout(r, 10));
    server.now = NOW + 601;
    await expect(waiting).rejects.toMatchObject({ kind: "expired" });
  });

  it("a tampered reply ends the link", async () => {
    const link = await startBrowserLink({ pollMs: 1, now: () => server.now });
    const s = linkSecretFromCode(link.code);
    const { pub } = linkKeys(); // sealed to the wrong key
    await putSlot(slotIds(s).reply, sealReply(pub, s, link.exp, phoneBundle()), { ttl: 600 });
    await expect(link.wait()).rejects.toMatchObject({ kind: "tampered" });
  });

  it("abort stops waiting", async () => {
    const link = await startBrowserLink({ pollMs: 50, now: () => server.now });
    const ctrl = new AbortController();
    const waiting = link.wait(ctrl.signal);
    ctrl.abort(new Error("left the screen"));
    await expect(waiting).rejects.toThrow("left the screen");
  });

  it("saveVault overwrites with the same passkey; loadVault is null without a vault", async () => {
    const b2 = new Uint8Array(32).fill(1);
    const cred = new Uint8Array([1, 1]);
    expect(await loadVault(b2, cred)).toBeNull();
    await saveVault(phoneBundle(NOW), b2, cred);
    await saveVault(phoneBundle(NOW + 1), b2, cred);
    expect((await loadVault(b2, cred))!.t).toBe(NOW + 1);
    await expect(loadVault(new Uint8Array(32).fill(2), cred)).rejects.toMatchObject({ kind: "tampered" });
  });
});
