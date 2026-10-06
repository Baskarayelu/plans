/**
 * Countries, their currencies and money formatting. Pure (no Intl dependency, so Hermes and Node
 * format identically). Amounts on the wire are AUSD base units (6 decimals) as bigint.
 */

export type Currency = { code: string; symbol: string; name: string; decimals: number; plural: string };

export const CURRENCIES: Record<string, Currency> = {
  USD: { code: "USD", symbol: "$", name: "US dollar", decimals: 2, plural: "dollars" },
  GBP: { code: "GBP", symbol: "£", name: "Pound sterling", decimals: 2, plural: "pounds" },
  EUR: { code: "EUR", symbol: "€", name: "Euro", decimals: 2, plural: "euros" },
  INR: { code: "INR", symbol: "₹", name: "Indian rupee", decimals: 0, plural: "rupees" },
  NGN: { code: "NGN", symbol: "₦", name: "Nigerian naira", decimals: 0, plural: "naira" },
  CAD: { code: "CAD", symbol: "CA$", name: "Canadian dollar", decimals: 2, plural: "Canadian dollars" },
  AUD: { code: "AUD", symbol: "A$", name: "Australian dollar", decimals: 2, plural: "Australian dollars" },
  JPY: { code: "JPY", symbol: "¥", name: "Japanese yen", decimals: 0, plural: "yen" },
  CHF: { code: "CHF", symbol: "CHF ", name: "Swiss franc", decimals: 2, plural: "francs" },
  SGD: { code: "SGD", symbol: "S$", name: "Singapore dollar", decimals: 2, plural: "Singapore dollars" },
  AED: { code: "AED", symbol: "AED ", name: "UAE dirham", decimals: 2, plural: "dirhams" },
  MXN: { code: "MXN", symbol: "MX$", name: "Mexican peso", decimals: 2, plural: "pesos" },
  BRL: { code: "BRL", symbol: "R$", name: "Brazilian real", decimals: 2, plural: "reais" },
  ZAR: { code: "ZAR", symbol: "R", name: "South African rand", decimals: 2, plural: "rand" },
  KES: { code: "KES", symbol: "KSh ", name: "Kenyan shilling", decimals: 0, plural: "shillings" },
  PHP: { code: "PHP", symbol: "₱", name: "Philippine peso", decimals: 2, plural: "pesos" },
  PLN: { code: "PLN", symbol: "zł ", name: "Polish złoty", decimals: 2, plural: "złoty" },
  SEK: { code: "SEK", symbol: "kr ", name: "Swedish krona", decimals: 2, plural: "kronor" },
  NOK: { code: "NOK", symbol: "kr ", name: "Norwegian krone", decimals: 2, plural: "kroner" },
  DKK: { code: "DKK", symbol: "kr ", name: "Danish krone", decimals: 2, plural: "kroner" },
  TRY: { code: "TRY", symbol: "₺", name: "Turkish lira", decimals: 2, plural: "lira" },
  KRW: { code: "KRW", symbol: "₩", name: "South Korean won", decimals: 0, plural: "won" },
  CNY: { code: "CNY", symbol: "CN¥", name: "Chinese yuan", decimals: 2, plural: "yuan" },
  HKD: { code: "HKD", symbol: "HK$", name: "Hong Kong dollar", decimals: 2, plural: "Hong Kong dollars" },
  NZD: { code: "NZD", symbol: "NZ$", name: "New Zealand dollar", decimals: 2, plural: "New Zealand dollars" },
  THB: { code: "THB", symbol: "฿", name: "Thai baht", decimals: 2, plural: "baht" },
  IDR: { code: "IDR", symbol: "Rp ", name: "Indonesian rupiah", decimals: 0, plural: "rupiah" },
  ILS: { code: "ILS", symbol: "₪", name: "Israeli shekel", decimals: 2, plural: "shekels" },
  CZK: { code: "CZK", symbol: "Kč ", name: "Czech koruna", decimals: 2, plural: "koruna" },
  HUF: { code: "HUF", symbol: "Ft ", name: "Hungarian forint", decimals: 0, plural: "forints" },
  RON: { code: "RON", symbol: "lei ", name: "Romanian leu", decimals: 2, plural: "lei" },
  ISK: { code: "ISK", symbol: "kr ", name: "Icelandic króna", decimals: 0, plural: "krónur" },
  BGN: { code: "BGN", symbol: "лв ", name: "Bulgarian lev", decimals: 2, plural: "leva" },
  MYR: { code: "MYR", symbol: "RM ", name: "Malaysian ringgit", decimals: 2, plural: "ringgit" },
};

export type Country = { code: string; name: string; flag: string; currency: string };

const C = (code: string, name: string, currency: string): Country => ({
  code,
  name,
  currency,
  flag: String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)),
});

export const COUNTRIES: Country[] = [
  C("GB", "United Kingdom", "GBP"),
  C("US", "United States", "USD"),
  C("IN", "India", "INR"),
  C("NG", "Nigeria", "NGN"),
  C("DE", "Germany", "EUR"),
  C("FR", "France", "EUR"),
  C("ES", "Spain", "EUR"),
  C("PT", "Portugal", "EUR"),
  C("IT", "Italy", "EUR"),
  C("NL", "Netherlands", "EUR"),
  C("IE", "Ireland", "EUR"),
  C("BE", "Belgium", "EUR"),
  C("AT", "Austria", "EUR"),
  C("FI", "Finland", "EUR"),
  C("GR", "Greece", "EUR"),
  C("CA", "Canada", "CAD"),
  C("AU", "Australia", "AUD"),
  C("NZ", "New Zealand", "NZD"),
  C("JP", "Japan", "JPY"),
  C("KR", "South Korea", "KRW"),
  C("CN", "China", "CNY"),
  C("HK", "Hong Kong", "HKD"),
  C("SG", "Singapore", "SGD"),
  C("MY", "Malaysia", "MYR"),
  C("TH", "Thailand", "THB"),
  C("ID", "Indonesia", "IDR"),
  C("PH", "Philippines", "PHP"),
  C("AE", "United Arab Emirates", "AED"),
  C("IL", "Israel", "ILS"),
  C("TR", "Türkiye", "TRY"),
  C("CH", "Switzerland", "CHF"),
  C("SE", "Sweden", "SEK"),
  C("NO", "Norway", "NOK"),
  C("DK", "Denmark", "DKK"),
  C("IS", "Iceland", "ISK"),
  C("PL", "Poland", "PLN"),
  C("CZ", "Czechia", "CZK"),
  C("HU", "Hungary", "HUF"),
  C("RO", "Romania", "RON"),
  C("BG", "Bulgaria", "BGN"),
  C("MX", "Mexico", "MXN"),
  C("BR", "Brazil", "BRL"),
  C("ZA", "South Africa", "ZAR"),
  C("KE", "Kenya", "KES"),
];

export function countryByCode(code?: string | null): Country | undefined {
  if (!code) return undefined;
  return COUNTRIES.find((c) => c.code === code.toUpperCase());
}

export function currencyFor(code?: string | null): Currency {
  return CURRENCIES[code ?? "USD"] ?? CURRENCIES.USD;
}

export function flagFor(country?: string | null): string {
  return countryByCode(country)?.flag ?? "";
}

// ─────────────── formatting ───────────────

export const AUSD_DECIMALS = 6;
export const ONE_DOLLAR = 1_000_000n;

function group(intPart: string, currency: string): string {
  if (currency === "INR" && intPart.length > 3) {
    const last3 = intPart.slice(-3);
    let rest = intPart.slice(0, -3);
    const parts: string[] = [];
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest) parts.unshift(rest);
    return `${parts.join(",")},${last3}`;
  }
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Rounds a non-negative fixed-point value (`decimalsIn` places) to `decimalsOut` places, half up. */
function roundFixed(v: bigint, decimalsIn: number, decimalsOut: number): bigint {
  if (decimalsOut >= decimalsIn) return v * 10n ** BigInt(decimalsOut - decimalsIn);
  const div = 10n ** BigInt(decimalsIn - decimalsOut);
  return (v + div / 2n) / div;
}

/** Formats a fixed-point number with `decimals` places as a currency string. */
export function formatFixed(value: bigint, decimals: number, currencyCode: string, opts: { sign?: boolean; minDecimals?: number } = {}): string {
  const cur = currencyFor(currencyCode);
  const neg = value < 0n;
  const abs = neg ? -value : value;
  let outDec = cur.decimals;
  // Small amounts keep cents even for zero-decimal currencies would be odd; but dollars under $1
  // in a 2-decimal currency always show 2 places.
  if (opts.minDecimals !== undefined) outDec = Math.max(outDec, opts.minDecimals);
  const r = roundFixed(abs, decimals, outDec);
  const s = r.toString().padStart(outDec + 1, "0");
  const intPart = s.slice(0, s.length - outDec) || "0";
  const frac = outDec > 0 ? `.${s.slice(s.length - outDec)}` : "";
  const sign = neg ? "−" : opts.sign && abs > 0n ? "+" : "";
  return `${sign}${cur.symbol}${group(intPart, cur.code)}${frac}`;
}

/** Dollars from AUSD base units: 446000000n → "$446.00". */
export function formatUsd(units: bigint, opts: { sign?: boolean } = {}): string {
  return formatFixed(units, AUSD_DECIMALS, "USD", opts);
}

/** Short dollars: "$36" when whole, else "$36.50". */
export function formatUsdShort(units: bigint): string {
  if (units % ONE_DOLLAR === 0n) {
    const neg = units < 0n;
    return `${neg ? "−" : ""}$${group(((neg ? -units : units) / ONE_DOLLAR).toString(), "USD")}`;
  }
  return formatUsd(units);
}

/**
 * Converts AUSD units to a local currency with a rate in 1e8 fixed point (units of `to` per 1 USD),
 * returning the local amount in 1e8 fixed point.
 */
export function usdToLocalE8(units: bigint, rateE8: bigint): bigint {
  // units has 6 decimals; result with 8 decimals: units * rateE8 / 1e6
  return (units * rateE8) / 1_000_000n;
}

/** Local amount (1e8 fixed point) → AUSD units, given rate (local per USD, 1e8). Floors. */
export function localE8ToUsd(localE8: bigint, rateE8: bigint): bigint {
  if (rateE8 === 0n) return 0n;
  return (localE8 * 1_000_000n) / rateE8;
}

export function formatLocal(units: bigint, currencyCode: string, usdToLocalRateE8: bigint | undefined, opts: { sign?: boolean } = {}): string | undefined {
  if (currencyCode === "USD") return formatUsd(units, opts);
  if (!usdToLocalRateE8) return undefined;
  return formatFixed(usdToLocalE8(units, usdToLocalRateE8), 8, currencyCode, opts);
}

/** Parses a typed amount ("12.5", "1,000") into fixed point with `decimals` places. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const t = text.replace(/[,\s]/g, "");
  if (!/^\d*(\.\d*)?$/.test(t) || t === "" || t === ".") return null;
  const [i, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  return BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** Rate text for receipts: "1 GBP = 1.3472 USD". `rateE8` = units of `to` per 1 `from`. */
export function formatRate(from: string, to: string, rateE8: bigint): string {
  const digits = rateE8 / 100_000_000n >= 100n ? 2 : 4;
  const s = roundFixed(rateE8, 8, digits).toString().padStart(digits + 1, "0");
  return `1 ${from} = ${group(s.slice(0, -digits), to)}.${s.slice(-digits)} ${to}`;
}

export function invertRateE8(rateE8: bigint): bigint {
  if (rateE8 === 0n) return 0n;
  return (10n ** 16n + rateE8 / 2n) / rateE8;
}
