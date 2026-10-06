import { createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { fromHex, toBase64Url, toHex, utf8 } from "../lib/crypto/bytes";
import { ACCOUNT_PRF_SALT, KEYS_PRF_SALT, deriveAccountPrivateKey, deriveKeys, inviteKeyPair } from "../lib/crypto/keys";
import { createHash } from "node:crypto";

const PRF_A = fromHex("0x0101010101010101010101010101010101010101010101010101010101010101");
const PRF_B = fromHex("0xa0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf");

function nodeX25519Public(secret: Uint8Array): string {
  const key = createPrivateKey({ key: { kty: "OKP", crv: "X25519", d: toBase64Url(secret), x: "" } as never, format: "jwk" });
  const jwk = createPublicKey(key).export({ format: "jwk" }) as { x: string };
  return jwk.x;
}

describe("PRF salts", () => {
  it("account salt is Mera's default sha256('mera.prf.salt.v1')", () => {
    expect(toHex(ACCOUNT_PRF_SALT)).toBe(toHex(createHash("sha256").update("mera.prf.salt.v1").digest()));
  });
  it("keys salt is sha256('plans.keys.v1')", () => {
    expect(toHex(KEYS_PRF_SALT)).toBe(toHex(createHash("sha256").update("plans.keys.v1").digest()));
  });
});

describe("account derivation (Mera recipe)", () => {
  it("matches viem's mnemonicToAccount for the same BIP-39 entropy", () => {
    const pk = deriveAccountPrivateKey(PRF_A);
    const ours = privateKeyToAccount(toHex(pk)).address;
    const viemAcct = mnemonicToAccount(entropyToMnemonic(PRF_A, wordlist)).address;
    expect(ours).toBe(viemAcct);
  });

  it("is deterministic (fixed vector)", () => {
    const a = privateKeyToAccount(toHex(deriveAccountPrivateKey(PRF_A))).address;
    const b = privateKeyToAccount(toHex(deriveAccountPrivateKey(PRF_A))).address;
    expect(a).toBe(b);
    expect(a).toMatchSnapshot();
  });

  it("rejects wrong-length PRF output", () => {
    expect(() => deriveAccountPrivateKey(new Uint8Array(31))).toThrow();
  });
});

describe("keys namespace", () => {
  it("derives X25519 and cache keys with HKDF-SHA256 (checked against node:crypto)", () => {
    const k = deriveKeys(PRF_B);
    const expectX = new Uint8Array(hkdfSync("sha256", PRF_B, new Uint8Array(), utf8("plans/v1/x25519"), 32));
    const expectC = new Uint8Array(hkdfSync("sha256", PRF_B, new Uint8Array(), utf8("plans/v1/cache"), 32));
    expect(toHex(k.x25519Secret)).toBe(toHex(expectX));
    expect(toHex(k.cacheKey)).toBe(toHex(expectC));
    expect(toBase64Url(k.x25519Public)).toBe(nodeX25519Public(k.x25519Secret));
  });

  it("is deterministic across devices (fixed vector)", () => {
    const k1 = deriveKeys(PRF_B);
    const k2 = deriveKeys(new Uint8Array(PRF_B));
    expect(toHex(k1.x25519Public)).toBe(toHex(k2.x25519Public));
    expect(k1.fingerprint).toBe(k2.fingerprint);
    expect({ pub: toHex(k1.x25519Public), fingerprint: k1.fingerprint }).toMatchSnapshot();
  });

  it("differs per PRF output", () => {
    expect(toHex(deriveKeys(PRF_A).x25519Public)).not.toBe(toHex(deriveKeys(PRF_B).x25519Public));
  });

  it("invite key pair uses its own HKDF label", () => {
    const inv = inviteKeyPair(PRF_A);
    const expectS = new Uint8Array(hkdfSync("sha256", PRF_A, new Uint8Array(), utf8("plans/v1/invite-x25519"), 32));
    expect(toHex(inv.secret)).toBe(toHex(expectS));
    expect(toBase64Url(inv.publicKey)).toBe(nodeX25519Public(inv.secret));
  });
});
