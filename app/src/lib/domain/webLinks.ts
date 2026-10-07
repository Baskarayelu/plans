/**
 * Web app links (https://plans.0xo.in/app/...). The same links the Android app opens, under /app,
 * plus readable aliases. Secrets stay in the "#" part, which browsers never send to a server:
 *
 *   /app/j/<pot>#s=<invite secret>&n=<inviter>        invite (same as /j/…)
 *   /app/join#pot=<pot>&s=<invite secret>&n=<inviter>  invite (alias)
 *   /app/v/<pot>#s=<invite secret>&n=<inviter>        "Continue in your browser" from a shared plan (/v/…)
 *   /app/c/1#k=<claim key>&n=&m=&a=                    claim link (same as /c/…)
 *   /app/claim#k=<claim key>&n=&m=&a=                  claim link (alias)
 *   /app/p/<address>#n=&c=&cc=&cur=&a=                 Plans code (same as /p/…)
 *
 * On load the web app turns these into its own routes WITHOUT the secret in the address bar: the
 * parsed link waits in memory (`pendingLink`) for the join/claim screen, and history.replaceState
 * swaps the URL for /app/join?pot=… or /app/claim before the router reads it.
 */
import { toBase64Url } from "../crypto/bytes";
import { createStore } from "../state/observable";
import { parseLink, type ParsedLink } from "./links";

export const pendingLink = createStore<ParsedLink | null>(null);

/** Maps a web path + fragment to a Plans link, or null when it isn't one. `path` excludes "/app". */
export function webPathToLink(path: string, hash: string): ParsedLink | null {
  const p = path.replace(/\/+$/, "") || "/";
  const h = hash.startsWith("#") ? hash : hash ? `#${hash}` : "";
  const direct = /^\/([jcp])\/([^/]*)$/.exec(p);
  if (direct) return parseLink(`/${direct[1]}/${direct[2]}${h}`);
  const shared = /^\/v\/(0x[0-9a-fA-F]{40})$/.exec(p);
  if (shared) return parseLink(`/j/${shared[1]}${h}`);
  if (p === "/join" || p === "/claim") {
    const f = new URLSearchParams(h.replace(/^#/, ""));
    if (p === "/join") {
      const pot = f.get("pot");
      if (!pot) return null;
      f.delete("pot");
      return parseLink(`/j/${pot}#${f.toString()}`);
    }
    return parseLink(`/c/1${h}`);
  }
  return null;
}

/** The app route for a link, with no secret in it (the secret is handed over through pendingLink). */
export function routeForLink(l: ParsedLink): string {
  const q = (o: Record<string, string | undefined>) => {
    const s = Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join("&");
    return s ? `?${s}` : "";
  };
  if (l.kind === "invite") return `/join${q({ pot: l.pot, n: l.inviter })}`;
  if (l.kind === "claim") return `/claim${q({ n: l.sender, m: l.note, a: l.amount })}`;
  return `/send/amount${q({ to: l.address, n: l.name, c: l.city, cc: l.country, cur: l.currency, a: l.amount })}`;
}

/** Secret for a screen: the route param if present (Android App Links), else the pending web link. */
export function takeInviteSecret(pot: string | undefined): string | undefined {
  const l = pendingLink.get();
  if (l?.kind === "invite" && pot && l.pot === pot.toLowerCase()) return toBase64Url(l.secret);
  return undefined;
}

export function takeClaimKey(): string | undefined {
  const l = pendingLink.get();
  return l?.kind === "claim" ? toBase64Url(l.key) : undefined;
}
