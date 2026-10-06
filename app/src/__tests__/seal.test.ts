import { fromHex, randomBytes, toHex, utf8, fromUtf8 } from "../lib/crypto/bytes";
import { FINGERPRINT_EMOJI, keyFingerprint } from "../lib/crypto/fingerprint";
import { deriveKeys, inviteKeyPair } from "../lib/crypto/keys";
import {
  decodeMemo,
  decodeMeta,
  decodeProfileWrap,
  decodeSendNote,
  encodeMemo,
  encodeMeta,
  encodeProfileWrap,
  encodeSendNote,
  groupDecrypt,
  groupEncrypt,
  newGroupKey,
  open,
  seal,
  unwrapGroupKey,
  wrapGroupKey,
} from "../lib/crypto/seal";

const POT = "0x1111111111111111111111111111111111111111";
const alice = deriveKeys(fromHex("0x" + "11".repeat(32)));
const bob = deriveKeys(fromHex("0x" + "22".repeat(32)));

describe("fingerprint emoji", () => {
  it("table has 256 distinct single-code-point emoji", () => {
    expect(FINGERPRINT_EMOJI).toHaveLength(256);
    expect(new Set(FINGERPRINT_EMOJI).size).toBe(256);
    for (const e of FINGERPRINT_EMOJI) {
      expect(Array.from(e)).toHaveLength(1);
      expect(/\p{Emoji_Presentation}/u.test(e)).toBe(true);
    }
  });
  it("is three emoji and stable", () => {
    const f = keyFingerprint(alice.x25519Public);
    expect(Array.from(f)).toHaveLength(3);
    expect(f).toBe(keyFingerprint(new Uint8Array(alice.x25519Public)));
    expect(f).toMatchSnapshot();
  });
  it("fixed vector: all-zero key", () => {
    // sha256(0^32) = 66687aad…  → indexes 0x66, 0x68, 0x7a
    expect(keyFingerprint(new Uint8Array(32))).toBe(FINGERPRINT_EMOJI[0x66] + FINGERPRINT_EMOJI[0x68] + FINGERPRINT_EMOJI[0x7a]);
  });
});

describe("sealed box", () => {
  it("round-trips", () => {
    const msg = utf8("group key goes here");
    const box = seal(bob.x25519Public, msg, "ctx");
    expect(box[0]).toBe(1);
    expect(fromUtf8(open(bob.x25519Secret, box, "ctx"))).toBe("group key goes here");
  });
  it("fails with the wrong key, wrong context or tampering", () => {
    const box = seal(bob.x25519Public, utf8("x"), "ctx");
    expect(() => open(alice.x25519Secret, box, "ctx")).toThrow();
    expect(() => open(bob.x25519Secret, box, "other")).toThrow();
    const t = new Uint8Array(box);
    t[t.length - 1] ^= 1;
    expect(() => open(bob.x25519Secret, t, "ctx")).toThrow();
  });
  it("is deterministic given ephemeral key and nonce (vector)", () => {
    const eph = fromHex("0x" + "33".repeat(32));
    const nonce = fromHex("0x" + "44".repeat(24));
    const a = seal(bob.x25519Public, utf8("hello"), "v", eph, nonce);
    const b = seal(bob.x25519Public, utf8("hello"), "v", eph, nonce);
    expect(toHex(a)).toBe(toHex(b));
    expect(toHex(a)).toMatchSnapshot();
  });
  it("group key wrap binds the pot", () => {
    const gk = newGroupKey();
    const w = wrapGroupKey(alice.x25519Public, gk, POT);
    expect(toHex(unwrapGroupKey(alice.x25519Secret, w, POT))).toBe(toHex(gk));
    expect(() => unwrapGroupKey(alice.x25519Secret, w, "0x2222222222222222222222222222222222222222")).toThrow();
    expect(w.length).toBeLessThanOrEqual(512);
  });
  it("invite wrap opens with the invite secret", () => {
    const secret = randomBytes(32);
    const inv = inviteKeyPair(secret);
    const gk = newGroupKey();
    const w = wrapGroupKey(inv.publicKey, gk, POT);
    expect(toHex(unwrapGroupKey(inviteKeyPair(secret).secret, w, POT))).toBe(toHex(gk));
  });
});

describe("group box", () => {
  const gk = newGroupKey();
  it("round-trips and binds kind and pot", () => {
    const box = groupEncrypt(gk, "memo", POT, utf8("Tram passes"));
    expect(fromUtf8(groupDecrypt(gk, "memo", POT, box))).toBe("Tram passes");
    expect(() => groupDecrypt(gk, "meta", POT, box)).toThrow();
    expect(() => groupDecrypt(gk, "memo", "0x2222222222222222222222222222222222222222", box)).toThrow();
  });
  it("meta: plaintext v0 and encrypted v1", () => {
    const plain = new Uint8Array([0, ...utf8(JSON.stringify({ v: 0, name: "Try a settle-up", emoji: "🧾", demo: true }))]);
    expect(decodeMeta(plain, POT)).toMatchObject({ name: "Try a settle-up", emoji: "🧾", demo: true });
    const enc = encodeMeta(gk, POT, { name: "Lisbon, 12–16 Oct", emoji: "🌊", color: "#2FA6B8" });
    expect(decodeMeta(enc, POT)).toBeNull();
    expect(decodeMeta(enc, POT, gk)).toMatchObject({ name: "Lisbon, 12–16 Oct", emoji: "🌊", color: "#2FA6B8" });
    expect(enc.length).toBeLessThanOrEqual(512);
  });
  it("profile wrap", () => {
    const w = encodeProfileWrap(gk, POT, { name: "Asha", city: "Bengaluru", country: "IN", currency: "INR" });
    expect(w[0]).toBe(0x50);
    expect(decodeProfileWrap(gk, POT, w)).toEqual({ name: "Asha", city: "Bengaluru", country: "IN", currency: "INR" });
  });
  it("memo", () => {
    const b = encodeMemo(gk, POT, "memo", { text: "Dinner at Taberna" });
    expect(decodeMemo(gk, POT, "memo", b)?.text).toBe("Dinner at Taberna");
    expect(decodeMemo(undefined, POT, "memo", b)).toBeNull();
    expect(encodeMemo(gk, POT, "memo", { text: "" })).toHaveLength(0);
  });
});

describe("send note in SendMeta.salt", () => {
  const from = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
  const to = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";
  it("round-trips between sender and receiver", () => {
    const salt = encodeSendNote(alice.x25519Secret, bob.x25519Public, from, to, { name: "Leah", city: "London", note: "Coffee ☕" });
    expect(salt).toHaveLength(32);
    expect(decodeSendNote(bob.x25519Secret, alice.x25519Public, from, to, salt)).toEqual({ name: "Leah", city: "London", note: "Coffee ☕" });
  });
  it("truncates on a character boundary", () => {
    const salt = encodeSendNote(alice.x25519Secret, bob.x25519Public, from, to, { name: "Maximiliana", city: "Rio de Janeiro", note: "🎉🎉🎉" });
    const n = decodeSendNote(bob.x25519Secret, alice.x25519Public, from, to, salt);
    expect(n?.name).toBe("Maximiliana");
    expect(Buffer.byteLength([n?.name, n?.city, n?.note].filter(Boolean).join("\x1f"))).toBeLessThanOrEqual(24);
  });
  it("random salts almost never decode", () => {
    let hits = 0;
    for (let i = 0; i < 200; i++) if (decodeSendNote(bob.x25519Secret, alice.x25519Public, from, to, randomBytes(32))) hits++;
    expect(hits).toBeLessThan(3);
  });
});
