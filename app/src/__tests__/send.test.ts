/** Send maths (amount → dollars → their money), receipt captions and history rows. */
import {
  daysLeft,
  e8ToText,
  fitNote,
  fmtE8,
  noteBudget,
  quote,
  rateLine,
  rateSource,
  sendSides,
  shortRef,
  textToE8,
  utcOffsetLabel,
  utf8Len,
  whenText,
} from "../lib/send/convert";
import { moneyRows, planRows, recentRecipients, type AccountHistory } from "../lib/send/history";
import { formatUsd } from "../lib/domain/currency";

const USD_GBP = 74_230_000n; // 1 USD = 0.7423 GBP
const USD_INR = 8_350_000_000n; // 1 USD = 83.5 INR

describe("typed amounts", () => {
  it("parses into 1e8 with the currency's decimals", () => {
    expect(textToE8("1", "GBP")).toBe(100_000_000n);
    expect(textToE8("1.5", "GBP")).toBe(150_000_000n);
    expect(textToE8("1.505", "GBP")).toBeNull();
    expect(textToE8("", "GBP")).toBeNull();
    expect(textToE8("250", "INR")).toBe(25_000_000_000n);
    expect(textToE8("2.5", "INR")).toBeNull();
  });
  it("prints back for the keypad", () => {
    expect(e8ToText(150_000_000n, "GBP")).toBe("1.5");
    expect(e8ToText(134_716_400n, "USD")).toBe("1.35");
    expect(e8ToText(100_000_000n, "USD")).toBe("1");
    expect(e8ToText(4_175_000_000n, "INR")).toBe("42");
  });
});

describe("quote", () => {
  it("£1.00 to a dollar person: Sam gets $1.35 (demo path)", () => {
    const q = quote({ text: "1.00", inDollars: false, myCurrency: "GBP", theirCurrency: "USD", usdToMy: USD_GBP });
    expect(q.valid).toBe(true);
    expect(q.usdUnits).toBe(1_347_164n); // floored, never more than typed
    expect(q.theirE8).toBe(134_716_400n);
    expect(fmtE8(q.theirE8!, "USD")).toBe("$1.35");
    expect(fmtE8(q.myE8!, "GBP")).toBe("£1.00");
  });
  it("$0.05 to Asha shows rupees", () => {
    const q = quote({ text: "0.05", inDollars: true, myCurrency: "USD", theirCurrency: "INR", usdToTheir: USD_INR });
    expect(q.usdUnits).toBe(50_000n);
    expect(fmtE8(q.theirE8!, "INR")).toBe("₹4");
  });
  it("typing in dollars when my money is pounds", () => {
    const q = quote({ text: "2", inDollars: true, myCurrency: "GBP", theirCurrency: "INR", usdToMy: USD_GBP, usdToTheir: USD_INR });
    expect(q.usdUnits).toBe(2_000_000n);
    expect(fmtE8(q.myE8!, "GBP")).toBe("£1.48");
    expect(fmtE8(q.theirE8!, "INR")).toBe("₹167");
  });
  it("waits for rates", () => {
    const q = quote({ text: "1", inDollars: false, myCurrency: "GBP", theirCurrency: "USD" });
    expect(q.usdUnits).toBeNull();
    expect(q.theirE8).toBeNull();
    const r = quote({ text: "1", inDollars: false, myCurrency: "GBP", theirCurrency: "INR", usdToMy: USD_GBP });
    expect(r.usdUnits).toBe(1_347_164n);
    expect(r.theirE8).toBeNull();
  });
  it("zero and empty are not valid", () => {
    expect(quote({ text: "", inDollars: true, myCurrency: "USD", theirCurrency: "USD" }).valid).toBe(false);
    expect(quote({ text: "0", inDollars: true, myCurrency: "USD", theirCurrency: "USD" }).valid).toBe(false);
  });
});

describe("receipt captions", () => {
  it("rate line", () => {
    const ts = Date.UTC(2026, 9, 13, 14, 5) / 1000;
    expect(rateLine("GBP", "USD", 134_720_000n, ts, "ECB reference rates via frankfurter.app")).toBe("Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC");
    expect(rateLine("USD", "INR", 8_350_000_000n)).toBe("Rate 1 USD = 83.5000 INR");
    expect(rateSource(undefined)).toBe("Reference");
  });
  it("short reference", () => {
    expect(shortRef("0x7q2abcdef1405")).toBe("#7Q2-1405");
    expect(shortRef(undefined)).toBe("");
  });
  it("when, with a fixed zone", () => {
    expect(whenText(Date.UTC(2026, 9, 13, 14, 5, 12), 0)).toBe("Tue 13 Oct · 14:05:12");
    expect(whenText(Date.UTC(2026, 9, 13, 14, 5, 12), -240)).toBe("Tue 13 Oct · 10:05:12");
    expect(utcOffsetLabel(60)).toBe("UTC+1");
    expect(utcOffsetLabel(-240)).toBe("UTC−4");
    expect(utcOffsetLabel(330)).toBe("UTC+5:30");
  });
  it("days left", () => {
    const now = Date.UTC(2026, 9, 13, 12);
    expect(daysLeft(now / 1000 + 6.5 * 86400, now)).toBe(7);
    expect(daysLeft(now / 1000 - 10, now)).toBe(0);
  });
});

describe("both sides of a recorded send", () => {
  it("pounds → dollars uses the recorded rate", () => {
    const s = sendSides({ usdUnits: 2_020_000n, from: "GBP", to: "USD", rateE8: 134_720_000n });
    expect(formatUsd(2_020_000n)).toBe("$2.02");
    expect(fmtE8(s.fromE8!, "GBP")).toBe("£1.50");
    expect(fmtE8(s.toE8!, "USD")).toBe("$2.02");
  });
  it("dollars → rupees uses the recorded rate", () => {
    const s = sendSides({ usdUnits: 50_000n, from: "USD", to: "INR", rateE8: 8_350_000_000n });
    expect(fmtE8(s.fromE8!, "USD")).toBe("$0.05");
    expect(fmtE8(s.toE8!, "INR")).toBe("₹4");
  });
  it("pounds → rupees needs today's USD→GBP", () => {
    const none = sendSides({ usdUnits: 1_000_000n, from: "GBP", to: "INR", rateE8: 11_250_000_000n });
    expect(none.fromE8).toBeNull();
    const s = sendSides({ usdUnits: 1_000_000n, from: "GBP", to: "INR", rateE8: 11_250_000_000n, usdToFrom: USD_GBP });
    expect(fmtE8(s.fromE8!, "GBP")).toBe("£0.74");
    expect(fmtE8(s.toE8!, "INR")).toBe("₹84");
  });
});

describe("private note budget", () => {
  it("leaves 12 bytes for Leah in London", () => {
    expect(noteBudget("Leah", "London")).toBe(12);
    expect(noteBudget("A very long name here", "Somewhere")).toBe(0);
  });
  it("cuts whole characters only", () => {
    expect(utf8Len("Coffee ☕")).toBe(10);
    expect(fitNote("Coffee ☕☕", 12)).toBe("Coffee ☕");
    expect(fitNote("Coffee ☕☕", 9)).toBe("Coffee ");
  });
});

describe("history", () => {
  const me = "0x00000000000000000000000000000000000000aa";
  const sam = "0x00000000000000000000000000000000000000bb";
  const pot = "0x00000000000000000000000000000000000000cc";
  const send = (id: string, from: string, to: string, ts: number, extra: Partial<AccountHistory["sendsIn"][number]> = {}) => ({
    id,
    from_id: from,
    to_id: to,
    amount: "2020000",
    fromCurrency: "GBP",
    toCurrency: "USD",
    fromCountry: "GB",
    toCountry: "US",
    fxRateE8: "134720000",
    fxTimestamp: "1",
    memoHash: "0x",
    timestamp: ts,
    txHash: `0xtx${id}`,
    ...extra,
  });
  const data: AccountHistory = {
    Activity: [
      { id: "a1", kind: "Contributed", pot_id: pot, amount: "20000000", timestamp: 50, txHash: "0xc1" },
      { id: "a2", kind: "Claimed", ref: "claim-1", amount: "500000", timestamp: 40, txHash: "0xclaimtx" },
      { id: "a3", kind: "Voted", pot_id: pot, timestamp: 45, txHash: "0xv" },
    ],
    sendsIn: [send("s1", sam, me, 30)],
    sendsOut: [send("s2", me, sam, 60), send("s3", me, sam, 20, { toCurrency: "EUR" })],
    claimsIn: [{ id: "claim-1", claimId: "1", source: sam, amount: "500000", status: "Claimed", createdAt: 10, claimedAt: 40, txHash: "0xcreate" }],
    claimsOut: [{ id: "claim-2", claimId: "2", amount: "25000000", status: "Refunded", createdAt: 5, refundedAt: 70, expiry: "60", txHash: "0xlink" }],
    payouts: [{ pot_id: pot, account_id: me, amount: "3000000", afterSettlement: true, timestamp: 80, txHash: "0xpay" }],
  };
  it("merges and sorts money rows, signed", () => {
    const rows = moneyRows(data, me);
    expect(rows.map((r) => r.kind)).toEqual(["payout", "linkBack", "sendOut", "contributed", "claimIn", "sendIn", "sendOut", "linkOut"]);
    expect(rows.find((r) => r.kind === "contributed")!.usd).toBe(-20_000_000n);
    expect(rows.find((r) => r.kind === "sendIn")!.usd).toBe(2_020_000n);
    expect(rows.find((r) => r.kind === "claimIn")!.tx).toBe("0xclaimtx");
    expect(moneyRows(undefined)).toEqual([]);
  });
  it("recent recipients are distinct, newest first", () => {
    const r = recentRecipients(data, me);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ address: sam, currency: "USD", at: 60 });
  });
  it("plan rows skip my own joins and contributions and dedupe", () => {
    const rows = planRows(
      [
        { id: "p1", kind: "SpendExecuted", account_id: sam, amount: "36000000", timestamp: 10, txHash: "0x1", pot_id: pot },
        { id: "p1", kind: "SpendExecuted", account_id: sam, amount: "36000000", timestamp: 10, txHash: "0x1", pot_id: pot },
        { id: "p2", kind: "Contributed", account_id: me, amount: "1", timestamp: 11, txHash: "0x2", pot_id: pot },
        { id: "p3", kind: "MemberJoined", account_id: sam, timestamp: 12, txHash: "0x3", pot_id: pot },
        { id: "p4", kind: "KeyWrapped", account_id: sam, timestamp: 13, txHash: "0x4", pot_id: pot },
        { id: "p5", kind: "DebtRecorded", account_id: sam, amount: "1", timestamp: 14, txHash: "0x5", pot_id: pot },
        { id: "p6", kind: "Settled", timestamp: 15, txHash: "0x6", pot_id: pot },
      ],
      me,
    );
    expect(rows.map((r) => r.id)).toEqual(["p6", "p3", "p1"]);
  });
});
