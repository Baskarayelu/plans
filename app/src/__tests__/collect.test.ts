/** Collect banner: who a settled pot still owes, and in what order. */
import { uncollected } from "../lib/domain/collect";

const ME = "0x00000000000000000000000000000000000000Aa";
const SAM = "0x00000000000000000000000000000000000000bB";
const ASHA = "0x00000000000000000000000000000000000000cc";
const D = 1_000_000n;

describe("uncollected", () => {
  it("is empty before settlement, whatever the nets", () => {
    expect(uncollected([{ address: ME, net: String(5n * D) }], ME, false)).toEqual([]);
  });

  it("lists only members still owed (net > 0), mine first, then by amount", () => {
    const rows = uncollected(
      [
        { address: SAM, net: String(2n * D) },
        { address: ASHA, net: String(9n * D) },
        { address: ME, net: String(1n * D) },
        { address: "0x00000000000000000000000000000000000000dd", net: "0" },
        { address: "0x00000000000000000000000000000000000000ee", net: String(-3n * D) },
      ],
      ME.toLowerCase(),
      true,
    );
    expect(rows.map((r) => [r.address.slice(-2), r.net, r.mine])).toEqual([
      ["aa", 1n * D, true],
      ["cc", 9n * D, false],
      ["bb", 2n * D, false],
    ]);
  });

  it("matches the signed-in address case-insensitively", () => {
    expect(uncollected([{ address: ME, net: "1" }], ME.toUpperCase().replace("0X", "0x"), true)[0].mine).toBe(true);
  });
});
