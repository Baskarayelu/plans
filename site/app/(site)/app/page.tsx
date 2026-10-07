import type { Metadata } from "next";
import { Button, Badge } from "@/components/ui/primitives";
import { DesktopQrCard } from "@/components/plans/DesktopQrCard";
import { DOWNLOAD_PATH } from "@/lib/site";

export const metadata: Metadata = {
  title: "Plans in your browser",
  description: "Plans in your browser is coming soon. The Android test version is available now.",
  robots: { index: false, follow: true },
};

// Placeholder until the web app ships. Links to /app ("Use Plans in your browser") are labelled
// "Coming soon" everywhere on the site while this page is here.
export default function WebAppPlaceholder() {
  return (
    <div className="mx-auto flex max-w-[980px] items-center justify-center gap-14 pt-12 pb-6 sm:pt-16">
      <div className="relative isolate grid max-w-[560px] flex-1 justify-items-center gap-4 overflow-hidden rounded-[35px] border border-line bg-surface px-5 py-12 text-center sm:px-10">
        <div aria-hidden="true" className="dots-bg absolute inset-0 -z-10 opacity-70" />
        <Badge>Coming soon</Badge>
        <h1 className="m-0 font-display text-[clamp(32px,6vw,48px)] leading-[1.04] font-extrabold tracking-[-0.03em] text-balance">
          Plans in your browser is on its way
        </h1>
        <p className="m-0 max-w-[440px] text-[17px] text-pretty text-muted">
          You’ll be able to join and run plans from any browser with a passkey. Until then, Plans runs on Android.
        </p>
        <Button href={DOWNLOAD_PATH} className="mt-2">
          Get the Android app
        </Button>
      </div>
      <DesktopQrCard title="Get it on your phone" sub="Scan with your Android phone’s camera to open the download page." />
    </div>
  );
}
