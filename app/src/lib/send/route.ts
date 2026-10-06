/** Where a scanned or pasted Plans link leads inside the app (same mapping as +native-intent). */
import { toBase64Url } from "../crypto/bytes";
import type { ParsedLink } from "../domain/links";

export type Href = { pathname: string; params: Record<string, string> };

const clean = (o: Record<string, string | undefined>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") out[k] = v;
  return out;
};

export function hrefForLink(link: ParsedLink): Href {
  if (link.kind === "invite") return { pathname: "/join", params: clean({ pot: link.pot, s: toBase64Url(link.secret), n: link.inviter }) };
  if (link.kind === "claim") return { pathname: "/claim", params: clean({ k: toBase64Url(link.key), n: link.sender, m: link.note, a: link.amount }) };
  return { pathname: "/send/amount", params: clean({ to: link.address, n: link.name, c: link.city, cc: link.country, cur: link.currency, a: link.amount }) };
}
