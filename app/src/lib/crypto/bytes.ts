/** Byte helpers shared by the crypto, chain and link modules. Pure; no React Native imports. */

const HEX = "0123456789abcdef";

export function toHex(bytes: Uint8Array): `0x${string}` {
  let s = "0x";
  for (const b of bytes) s += HEX[b >> 4] + HEX[b & 15];
  return s as `0x${string}`;
}

export function fromHex(hex: string): Uint8Array {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error("invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** UTF-8 decoder that does not depend on TextDecoder (missing on some Hermes builds). Throws on invalid input when `strict`. */
export function fromUtf8(bytes: Uint8Array, strict = false): string {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8", { fatal: strict }).decode(bytes);
  }
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b >= 0xc2 && b < 0xe0 && i < bytes.length) cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (b >= 0xe0 && b < 0xf0 && i + 1 < bytes.length) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else if (b >= 0xf0 && b < 0xf5 && i + 2 < bytes.length)
      cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else {
      if (strict) throw new Error("invalid utf-8");
      cp = 0xfffd;
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    s += B64U[a >> 2] + B64U[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) s += B64U[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) s += B64U[c & 63];
  }
  return s;
}

export function fromBase64Url(s: string): Uint8Array {
  const clean = s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64U.indexOf(ch);
    if (v < 0) throw new Error("invalid base64url");
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export function wipe(...arrays: (Uint8Array | undefined | null)[]): void {
  for (const a of arrays) a?.fill(0);
}
