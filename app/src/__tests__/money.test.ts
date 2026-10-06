import {
  formatFixed,
  formatLocal,
  formatRate,
  formatUsd,
  formatUsdShort,
  invertRateE8,
  localE8ToUsd,
  parseAmount,
  usdToLocalE8,
  countryByCode,
  currencyFor,
} from "../lib/domain/currency";

describe("money formatting", () => {
  it("formats AUSD units as dollars", () => {
    expect(formatUsd(446_000_000n)).toBe("$446.00");
    expect(formatUsd(250_000n)).toBe("$0.25");
    expect(formatUsd(1_234_567_890n)).toBe("$1,234.57");
    expect(formatUsd(-12_000_000n)).toBe("−$12.00");
    expect(formatUsd(12_000_000n, { sign: true })).toBe("+$12.00");
    expect(formatUsd(0n)).toBe("$0.00");
    expect(formatUsd(5n)).toBe("$0.00");
  });
  it("short dollars", () => {
    expect(formatUsdShort(36_000_000n)).toBe("$36");
    expect(formatUsdShort(250_000n)).toBe("$0.25");
    expect(formatUsdShort(1_000_000_000n)).toBe("$1,000");
  });
  it("converts to local currency with a 1e8 rate", () => {
    // 1 USD = 0.7423 GBP
    const r = 74_230_000n;
    expect(formatLocal(446_000_000n, "GBP", r)).toBe("£331.07");
    expect(formatLocal(446_000_000n, "USD", undefined)).toBe("$446.00");
    expect(formatLocal(1_000_000n, "GBP", undefined)).toBeUndefined();
  });
  it("rupees use lakh grouping and no decimals", () => {
    const r = 8_360_000_000n; // 83.60 INR per USD
    expect(formatLocal(600_000_000n, "INR", r)).toBe("₹50,160");
    expect(formatLocal(2_000_000_000n, "INR", r)).toBe("₹1,67,200");
    expect(formatFixed(12_345_678_900_000_000n, 8, "INR")).toBe("₹12,34,56,789");
  });
  it("round-trips local → USD", () => {
    const gbpPerUsd = 74_230_000n;
    const typed = parseAmount("20", 8)!; // £20
    const usd = localE8ToUsd(typed, gbpPerUsd);
    expect(formatUsd(usd)).toBe("$26.94");
    expect(usdToLocalE8(usd, gbpPerUsd)).toBeLessThanOrEqual(typed);
  });
  it("parses typed amounts", () => {
    expect(parseAmount("12.5", 6)).toBe(12_500_000n);
    expect(parseAmount("1,000", 6)).toBe(1_000_000_000n);
    expect(parseAmount("0.255", 2)).toBeNull();
    expect(parseAmount("abc", 6)).toBeNull();
    expect(parseAmount("", 6)).toBeNull();
    expect(parseAmount(".5", 6)).toBe(500_000n);
  });
  it("formats reference rates", () => {
    expect(formatRate("GBP", "USD", 134_720_000n)).toBe("1 GBP = 1.3472 USD");
    expect(formatRate("USD", "INR", 8_360_000_000n)).toBe("1 USD = 83.6000 INR");
    expect(formatRate("USD", "JPY", 14_950_000_000n)).toBe("1 USD = 149.50 JPY");
    expect(invertRateE8(134_720_000n)).toBe(74_228_029n);
  });
  it("countries map to currencies and flags", () => {
    expect(countryByCode("GB")?.flag).toBe("🇬🇧");
    expect(countryByCode("in")?.currency).toBe("INR");
    expect(currencyFor("XXX").code).toBe("USD");
  });
});
