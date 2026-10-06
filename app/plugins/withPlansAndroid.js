/**
 * Plans Android build settings, applied on every `expo prebuild --clean`:
 *
 * 1. Signing: debug AND release are signed with the Plans release keystore when the env vars
 *    PLANS_KEYSTORE_PATH and PLANS_KEYSTORE_PASSWORD are set at Gradle time (optional:
 *    PLANS_KEY_ALIAS, default "plans"; PLANS_KEY_PASSWORD, default = store password).
 *    Passkeys and App Links are verified against this certificate's SHA-256 in
 *    https://plans.0xo.in/.well-known/assetlinks.json, so both variants must use it.
 *    Without the env vars the build falls back to the default debug keystore (passkeys will not work).
 *    No secret is written to the repository: Gradle reads System.getenv at build time.
 * 2. ABIs: reactNativeArchitectures defaults to arm64-v8a (override with PLANS_ABIS at prebuild).
 * 3. The debug variant bundles its JS (debuggableVariants = []), so a debug APK runs without Metro.
 */
const { withAppBuildGradle, withGradleProperties } = require("expo/config-plugins");

const SIGNING_MARK = "// plans:signing";

function addSigning(src) {
  if (src.includes(SIGNING_MARK)) return src;
  const signingBlock = `
    ${SIGNING_MARK}
    signingConfigs {
        plans {
            def ksPath = System.getenv("PLANS_KEYSTORE_PATH")
            if (ksPath != null && !ksPath.isEmpty()) {
                storeFile file(ksPath)
                storePassword System.getenv("PLANS_KEYSTORE_PASSWORD")
                keyAlias (System.getenv("PLANS_KEY_ALIAS") ?: "plans")
                keyPassword (System.getenv("PLANS_KEY_PASSWORD") ?: System.getenv("PLANS_KEYSTORE_PASSWORD"))
            }
        }`;
  // Insert our signing config at the start of the existing signingConfigs block.
  let out = src.replace(/signingConfigs\s*\{/, (m) => `${signingBlock}\n    }\n    ${m}`);
  // Point both build types at it when the env is present.
  const pick = `(System.getenv("PLANS_KEYSTORE_PATH") ? signingConfigs.plans : signingConfigs.debug)`;
  out = out.replace(/(buildTypes\s*\{[\s\S]*?debug\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/, `$1signingConfig ${pick}`);
  out = out.replace(/(release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/, `$1signingConfig ${pick}`);
  return out;
}

function addDebuggableVariants(src) {
  if (src.includes("debuggableVariants = []")) return src;
  return src.replace(/react\s*\{/, (m) => `${m}\n    // plans: bundle JS into debug builds too, so they run without Metro\n    debuggableVariants = []`);
}

const withPlansAndroid = (config) => {
  config = withAppBuildGradle(config, (c) => {
    c.modResults.contents = addDebuggableVariants(addSigning(c.modResults.contents));
    return c;
  });
  config = withGradleProperties(config, (c) => {
    const abis = process.env.PLANS_ABIS || "arm64-v8a";
    const set = (key, value) => {
      const item = c.modResults.find((p) => p.type === "property" && p.key === key);
      if (item) item.value = value;
      else c.modResults.push({ type: "property", key, value });
    };
    set("reactNativeArchitectures", abis);
    set("org.gradle.jvmargs", "-Xmx4096m -XX:MaxMetaspaceSize=1024m");
    return c;
  });
  return config;
};

module.exports = withPlansAndroid;
