/** A send refused for an out-of-date rate reads as the designed message (152 States). */
jest.mock("../../../config", () => ({ config: { chainId: 10143, contracts: {}, relayerUrl: "https://relayer.test" } }));

import { friendlyError, RelayError } from "../../api/relayer";

it("FX_OUT_OF_DATE: “Rates are out of date. Try again in a minute.”", () => {
  const f = friendlyError(new RelayError(409, "FX_OUT_OF_DATE", ""));
  expect(f.title).toBe("Rates are out of date");
  expect(f.message).toBe("Try again in a minute.");
});
