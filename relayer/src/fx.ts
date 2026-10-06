/**
 * Reference FX from ECB rates (frankfurter.app), cached, signed with a relayer key (EIP-191)
 * so the app can show it as "the reference rate" and put it on the PlansSend receipt.
 * AUSD is treated as USD.
 */
import type { LocalAccount } from "viem";
import { z } from "zod";
import { RelayError } from "./errors.js";

export const fxQuerySchema = z.object({
  from: z.string().regex(/^[A-Za-z]{3,4}$/).transform((s) => s.toUpperCase()),
  to: z.string().regex(/^[A-Za-z]{3,4}$/).transform((s) => s.toUpperCase()),
});

export const normaliseCurrency = (c: string) => (c === "AUSD" ? "USD" : c);

export interface FxQuote {
  from: string;
  to: string;
  rate: string;
  rateE8: string;
  timestamp: number; // unix seconds when the reference was fetched
  date: string; // ECB reference date
  source: string;
  signer: string;
  message: string;
  signature: string;
}

export function fxMessage(q: { from: string; to: string; rateE8: string; timestamp: number; date: string; source: string }) {
  return `Plans FX reference\nPair: ${q.from}/${q.to}\nRateE8: ${q.rateE8}\nTimestamp: ${q.timestamp}\nDate: ${q.date}\nSource: ${q.source}`;
}

/** Decimal rate → integer with 8 decimals, without float drift for typical inputs. */
export function toE8(rate: number): bigint {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("invalid rate");
  const [i, f = ""] = rate.toFixed(10).split(".");
  const frac = (f + "0000000000").slice(0, 10);
  // round half up at the 9th decimal
  let v = BigInt(i) * 100_000_000n + BigInt(frac.slice(0, 8));
  if (Number(frac[8]) >= 5) v += 1n;
  return v;
}

interface Table {
  base: string;
  date: string;
  rates: Record<string, number>;
  fetchedAt: number;
}

export class FxService {
  #cache = new Map<string, Table>();
  #inflight = new Map<string, Promise<Table>>();
  readonly source = "ECB reference rates via frankfurter.app";

  constructor(
    readonly opts: { url: string; cacheMs: number },
    readonly signer: LocalAccount,
    readonly fetchImpl: typeof fetch = fetch,
    readonly now: () => number = Date.now,
  ) {}

  async #table(base: string): Promise<Table> {
    const c = this.#cache.get(base);
    if (c && this.now() - c.fetchedAt < this.opts.cacheMs) return c;
    const inflight = this.#inflight.get(base);
    if (inflight) return inflight;
    const p = (async () => {
      try {
        const res = await this.fetchImpl(`${this.opts.url}?from=${encodeURIComponent(base)}`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
          redirect: "follow",
        });
        if (res.status === 404 || res.status === 422 || res.status === 400) {
          throw new RelayError(400, "UNSUPPORTED_CURRENCY", `No reference rate for ${base}.`);
        }
        if (!res.ok) throw new Error(`FX source HTTP ${res.status}`);
        const j = (await res.json()) as { base?: string; date?: string; rates?: Record<string, number> };
        if (!j.rates || !j.date) throw new Error("FX source returned no rates");
        const t: Table = { base, date: j.date, rates: j.rates, fetchedAt: this.now() };
        this.#cache.set(base, t);
        return t;
      } catch (e) {
        if (e instanceof RelayError) throw e;
        if (c) return c; // serve stale rather than nothing
        throw new RelayError(503, "FX_UNAVAILABLE", "The reference exchange rate is unavailable right now.");
      } finally {
        this.#inflight.delete(base);
      }
    })();
    this.#inflight.set(base, p);
    return p;
  }

  async quote(fromIn: string, toIn: string): Promise<FxQuote> {
    const from = normaliseCurrency(fromIn);
    const to = normaliseCurrency(toIn);
    let rate: number;
    let date: string;
    let fetchedAt: number;
    if (from === to) {
      rate = 1;
      date = new Date(this.now()).toISOString().slice(0, 10);
      fetchedAt = this.now();
    } else {
      const t = await this.#table(from);
      const r = t.rates[to];
      if (r === undefined) throw new RelayError(400, "UNSUPPORTED_CURRENCY", `No reference rate for ${from} to ${to}.`);
      rate = r;
      date = t.date;
      fetchedAt = t.fetchedAt;
    }
    const body = { from: fromIn, to: toIn, rateE8: toE8(rate).toString(), timestamp: Math.floor(fetchedAt / 1000), date, source: this.source };
    const message = fxMessage(body);
    const signature = await this.signer.signMessage!({ message });
    return { ...body, rate: String(rate), signer: this.signer.address, message, signature };
  }
}
