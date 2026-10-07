/**
 * App Links (https://plans.0xo.in/...) — verified for the app through assetlinks.json:
 *
 *   /j/<pot>#s=<inviteSecret>&n=<inviter name>       invite to a plan
 *   /c/1#k=<claimKey>&n=<sender>&m=<note>&a=<amount> claim link (send-by-link or a pot pay link)
 *   /p/<address>#n=<name>&c=<city>&cc=<country>&cur=<currency>&a=<amount>   Plans code
 *
 * Secrets (invite secret, claim key) travel only in the fragment, which browsers never send to
 * the web server. Names in the fragment are only a hint for the screen before the real data loads.
 *
 * Site-only routes (the app doesn't claim them, so they always open in the browser):
 *   /v/<pot>#…            read-only shared plan for people who aren't members yet (build 2, 122–124)
 *   /s/<pot>[#n=<name>]   public settle-up proof; the name only when the sharer opted in
 *                         (lib/share/settleCard.ts builds these links)
 */
import { fromBase64Url, toBase64Url } from "../crypto/bytes";

export type InviteLink = { kind: "invite"; pot: `0x${string}`; secret: Uint8Array; inviter?: string };
export type ClaimLink = { kind: "claim"; key: Uint8Array; sender?: string; note?: string; amount?: string };
export type CodeLink = { kind: "code"; address: `0x${string}`; name?: string; city?: string; country?: string; currency?: string; amount?: string };
export type ParsedLink = InviteLink | ClaimLink | CodeLink;

const enc = encodeURIComponent;

function fragment(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${enc(v as string)}`);
  return parts.length ? `#${parts.join("&")}` : "";
}

function parseFragment(f: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of f.replace(/^#/, "").split("&")) {
    if (!kv) continue;
    const i = kv.indexOf("=");
    if (i < 0) continue;
    try {
      out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function inviteUrl(host: string, pot: string, secret: Uint8Array, inviter?: string): string {
  return `https://${host}/j/${pot.toLowerCase()}${fragment({ s: toBase64Url(secret), n: inviter })}`;
}

export function claimUrl(host: string, key: Uint8Array, extra: { sender?: string; note?: string; amount?: string } = {}): string {
  return `https://${host}/c/1${fragment({ k: toBase64Url(key), n: extra.sender, m: extra.note, a: extra.amount })}`;
}

export function codeUrl(host: string, address: string, p: { name?: string; city?: string; country?: string; currency?: string; amount?: string } = {}): string {
  return `https://${host}/p/${address.toLowerCase()}${fragment({ n: p.name, c: p.city, cc: p.country, cur: p.currency, a: p.amount })}`;
}

/** Short, human display for a link (no secret). */
export function displayLink(url: string): string {
  const m = /^https?:\/\/([^/]+)\/([jcp])\/([^#?]*)/.exec(url);
  if (!m) return url;
  const id = m[3];
  const short = id.length > 10 ? `${id.slice(2, 6)}-${id.slice(-4)}` : id || "link";
  return `${m[1]}/${m[2]}/${short}`;
}

/** Accepts https links, the app scheme (plans://j/...) and bare paths. */
export function parseLink(input: string): ParsedLink | null {
  const s = input.trim();
  const m = /^(?:https?:\/\/[^/]+|[a-z-]+:\/\/?)?\/?([jcp])\/([^#?\s]*)(?:\?[^#]*)?(#.*)?$/i.exec(s);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const id = m[2];
  const f = parseFragment(m[3] ?? "");
  try {
    if (kind === "j") {
      if (!/^0x[0-9a-fA-F]{40}$/.test(id) || !f.s) return null;
      const secret = fromBase64Url(f.s);
      if (secret.length !== 32) return null;
      return { kind: "invite", pot: id.toLowerCase() as `0x${string}`, secret, inviter: f.n };
    }
    if (kind === "c") {
      if (!f.k) return null;
      const key = fromBase64Url(f.k);
      if (key.length !== 32) return null;
      return { kind: "claim", key, sender: f.n, note: f.m, amount: f.a };
    }
    if (kind === "p") {
      if (!/^0x[0-9a-fA-F]{40}$/.test(id)) return null;
      return { kind: "code", address: id.toLowerCase() as `0x${string}`, name: f.n, city: f.c, country: f.cc, currency: f.cur, amount: f.a };
    }
  } catch {
    return null;
  }
  return null;
}
