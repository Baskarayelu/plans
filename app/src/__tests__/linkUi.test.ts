/** Small pure pieces behind the link screens: the device label (a hint, design 173) and the code field (172). */
import { deviceLabelFromUa } from "../lib/link/deviceLabel";
import { codeChars, formatCodeInput, isCompleteCode } from "../lib/link/codeInput";
import { normaliseCode } from "../lib/link/protocol";

describe("device label", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", "Chrome on a Mac"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15", "Safari on a Mac"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1", "Safari on an iPhone"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1", "Chrome on an iPhone"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0", "Edge on Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", "Firefox on Linux"],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", "Chrome on Android"],
    ["Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari on an iPad"],
  ])("%s → %s", (ua, label) => {
    expect(deviceLabelFromUa(ua)).toBe(label);
  });

  it("falls back to plain words", () => {
    expect(deviceLabelFromUa("")).toBe("A browser");
    expect(deviceLabelFromUa(undefined)).toBe("A browser");
    expect(deviceLabelFromUa("curl/8.0")).toBe("A browser");
  });
});

describe("code field", () => {
  it("adds the dashes, any case, and stops at 12 characters", () => {
    expect(formatCodeInput("k7q2")).toBe("K7Q2");
    expect(formatCodeInput("k7q29")).toBe("K7Q2-9");
    expect(formatCodeInput("K7Q2-9RXD-M4")).toBe("K7Q2-9RXD-M4");
    expect(formatCodeInput("k7q2 9rxd m4ta extra")).toBe("K7Q2-9RXD-M4TA");
    // deleting back over a dash works (the dash isn't a character of the code)
    expect(formatCodeInput("K7Q2-")).toBe("K7Q2");
  });

  it("reads O as 0 and I or L as 1, drops what isn't in the code alphabet", () => {
    expect(codeChars("OIL")).toBe("011");
    expect(codeChars("u!@#a")).toBe("A");
    expect(isCompleteCode("K7Q2-9RXD-M4T")).toBe(false);
    expect(isCompleteCode("K7Q2-9RXD-M4TA")).toBe(true);
    // what the field produces is what the protocol reads
    expect(normaliseCode(formatCodeInput("k7q2 9rxd m4ta"))).toBe("K7Q29RXDM4TA");
  });
});
