/**
 * Rewrites incoming App Links (https://plans.0xo.in/j|c|p/...) into app routes. Secrets live in
 * the URL fragment, which the router would drop, so they are moved into route params here.
 */
import { parseLink } from "../lib/domain/links";
import { toBase64Url } from "../lib/crypto/bytes";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  try {
    const link = parseLink(path);
    if (!link) return path;
    const q = (o: Record<string, string | undefined>) =>
      Object.entries(o)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
        .join("&");
    if (link.kind === "invite") return `/join?${q({ pot: link.pot, s: toBase64Url(link.secret), n: link.inviter })}`;
    if (link.kind === "claim") return `/claim?${q({ k: toBase64Url(link.key), n: link.sender, m: link.note, a: link.amount })}`;
    if (link.kind === "code")
      return `/send/amount?${q({ to: link.address, n: link.name, c: link.city, cc: link.country, cur: link.currency, a: link.amount })}`;
    return path;
  } catch {
    return "/";
  }
}
