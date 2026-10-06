export const SITE_URL = "https://plans.0xo.in";
export const SITE_HOST = "plans.0xo.in";
export const ANDROID_PACKAGE = "in.oxo.plans";
export const GITHUB_URL = "https://github.com/Baskarayelu/plans";
export const X_URL = "https://x.com/PlansOnMonad";
export const X_HANDLE = "@PlansOnMonad";
export const DOWNLOAD_PATH = "/download";
import release from "@/public/release.json";

/** True only once an APK is actually published (release.json status "live"). */
export const RELEASE_LIVE = release.status === "live";
/** Button tag: states only what is true about the Android build right now. */
export const RELEASE_TAG = RELEASE_LIVE ? "Test version" : "Coming soon";

export const LANDING_NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/#rules", label: "Group rules" },
  { href: "/#borders", label: "Across borders" },
  { href: "/#numbers", label: "Numbers" },
  { href: "/docs", label: "Docs" },
] as const;
