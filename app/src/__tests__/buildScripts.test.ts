/**
 * The APK and the web app must be built against the same relayer by default: app.config.ts's own
 * testnet default (relayer-testnet.plans.0xo.in) has no DNS record, so a build script that leaves
 * PLANS_RELAYER_URL_TESTNET unset makes an app that can't reach the chain.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const script = (name: string) => readFileSync(join(__dirname, "../../scripts", name), "utf8");

/** The URL a script falls back to for one of PLANS_RELAYER_URL_TESTNET / _MAINNET. */
function relayerDefault(src: string, net: "TESTNET" | "MAINNET"): string | null {
  const line = src.split("\n").find((l) => l.startsWith(`export PLANS_RELAYER_URL_${net}=`));
  return line?.match(/(https:\/\/[^}"]+)/)?.[1] ?? null;
}

describe("build scripts: relayer defaults", () => {
  it("build-apk.sh defaults both networks' relayers, like build-web.sh", () => {
    for (const net of ["TESTNET", "MAINNET"] as const) {
      const apk = relayerDefault(script("build-apk.sh"), net);
      expect(apk).toMatch(/^https:\/\//);
      expect(apk).toBe(relayerDefault(script("build-web.sh"), net));
    }
  });

  it("the testnet default is the live Railway relayer, not the domain without DNS", () => {
    expect(relayerDefault(script("build-apk.sh"), "TESTNET")).toBe("https://relayer-production-ecef.up.railway.app");
  });

  it("build-apk.sh refuses an APK whose app config doesn't name the relayer", () => {
    expect(script("build-apk.sh")).toMatch(/unzip -p "\$DEST" assets\/app\.config \| grep -qF/);
  });
});
