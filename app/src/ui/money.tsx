import { formatLocal, formatUsd, currencyFor } from "../lib/domain/currency";
import { useFx, useMe } from "../lib/state/data";

/**
 * Money is shown as dollars with the person's own currency alongside: "$446.00 · £331.06".
 * `useLocal()` returns a formatter for the signed-in person's currency (undefined until the
 * reference rate arrives, or when their currency is dollars).
 */
export function useLocal(currencyOverride?: string) {
  const { currency } = useMe();
  const cur = currencyOverride ?? currency;
  const fx = useFx(cur);
  const rate = fx.data?.rateE8;
  const fmt = (units: bigint, opts: { sign?: boolean } = {}) => (cur === "USD" ? undefined : formatLocal(units, cur, rate, opts));
  return { currency: cur, rateE8: rate, fmt, symbol: currencyFor(cur).symbol, fx: fx.data };
}

export function usdAndLocal(units: bigint, local: (u: bigint) => string | undefined): string {
  const l = local(units);
  return l ? `${formatUsd(units)} · ${l}` : formatUsd(units);
}

export { formatUsd };
