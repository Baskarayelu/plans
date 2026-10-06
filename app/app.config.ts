import type { ConfigContext, ExpoConfig } from "expo/config";
import fs from "node:fs";
import path from "node:path";

/**
 * Two build variants, chosen with APP_NETWORK=testnet|mainnet at prebuild/bundle time.
 *
 *   testnet → "Plans Test", package in.oxo.plans.test, chain 10143
 *   mainnet → "Plans",      package in.oxo.plans,      chain 143
 *
 * Both use rpId plans.0xo.in. Contract addresses come from ../contracts/deployments/<chainId>.json
 * when present; otherwise they are zero placeholders and the app shows "not deployed yet" states.
 * Every URL can be overridden with an env var (see README.md).
 */
type Network = "testnet" | "mainnet";

const network: Network = process.env.APP_NETWORK === "mainnet" ? "mainnet" : "testnet";
const isMainnet = network === "mainnet";
const chainId = isMainnet ? 143 : 10143;
const ZERO = "0x0000000000000000000000000000000000000000";

type Deployment = {
  ausd?: string;
  keyRegistry?: string;
  plansSend?: string;
  plansFactory?: string;
  claimEscrow?: string;
  startBlock?: number;
};

function readDeployment(id: number): Deployment {
  const file = path.resolve(__dirname, "..", "contracts", "deployments", `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Deployment;
  } catch {
    return {};
  }
}

const dep = readDeployment(chainId);
const AUSD = {
  143: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
  10143: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
}[chainId];

const env = (k: string, d: string): string => process.env[k] ?? d;

const plans = {
  network,
  chainId,
  rpId: "plans.0xo.in",
  linkHost: "plans.0xo.in",
  relayerUrl: env(
    isMainnet ? "PLANS_RELAYER_URL_MAINNET" : "PLANS_RELAYER_URL_TESTNET",
    env("PLANS_RELAYER_URL", isMainnet ? "https://relayer.plans.0xo.in" : "https://relayer-testnet.plans.0xo.in"),
  ),
  graphqlUrl: env(
    isMainnet ? "PLANS_GRAPHQL_URL_MAINNET" : "PLANS_GRAPHQL_URL_TESTNET",
    env("PLANS_GRAPHQL_URL", "https://indexer.plans.0xo.in/v1/graphql"),
  ),
  rpcUrl: env("PLANS_RPC_URL", isMainnet ? "https://rpc.monad.xyz" : "https://testnet-rpc.monad.xyz"),
  wsUrl: env("PLANS_WS_URL", isMainnet ? "wss://rpc.monad.xyz" : "wss://testnet-rpc.monad.xyz"),
  explorerTx: isMainnet ? "https://monadvision.com/tx/" : "https://testnet.monadvision.com/tx/",
  contracts: {
    ausd: dep.ausd ?? AUSD,
    keyRegistry: dep.keyRegistry ?? ZERO,
    plansSend: dep.plansSend ?? ZERO,
    plansFactory: dep.plansFactory ?? ZERO,
    claimEscrow: dep.claimEscrow ?? ZERO,
  },
  deployed: Boolean(dep.plansFactory),
};

const packageName = isMainnet ? "in.oxo.plans" : "in.oxo.plans.test";
const scheme = isMainnet ? "plans" : "plans-test";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isMainnet ? "Plans" : "Plans Test",
  slug: "plans",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme,
  userInterfaceStyle: "automatic",
  platforms: ["android"],
  android: {
    package: packageName,
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: "#10231B",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    permissions: ["android.permission.CAMERA", "android.permission.POST_NOTIFICATIONS", "android.permission.VIBRATE"],
    blockedPermissions: ["android.permission.RECORD_AUDIO", "android.permission.READ_EXTERNAL_STORAGE"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          { scheme: "https", host: plans.linkHost, pathPrefix: "/j/" },
          { scheme: "https", host: plans.linkHost, pathPrefix: "/c/" },
          { scheme: "https", host: plans.linkHost, pathPrefix: "/p/" },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    "expo-localization",
    [
      "expo-camera",
      {
        cameraPermission: "Plans uses the camera to scan Plans codes and photograph receipts.",
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-image-picker",
      { photosPermission: "Plans lets you attach a receipt photo from your gallery." },
    ],
    ["expo-notifications", { color: "#F5B83D" }],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#F4F6F1",
        image: "./assets/splash-icon.png",
        imageWidth: 120,
        dark: { backgroundColor: "#0C1511", image: "./assets/splash-icon.png" },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 28,
          enableMinifyInReleaseBuilds: false,
        },
      },
    ],
    "./plugins/withPlansAndroid",
  ],
  experiments: { typedRoutes: false },
  extra: {
    plans,
    eas: process.env.EXPO_PROJECT_ID ? { projectId: process.env.EXPO_PROJECT_ID } : undefined,
  },
});
