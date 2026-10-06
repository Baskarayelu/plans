// PRO BLOCK SLOT: "CTA Sections" (Aceternity UI Pro). Replace the panel with the Pro CTA; keep id "get",
// the copy below, and the primary button pointing at DOWNLOAD_PATH (/download).
import { Button, BtnTag } from "@/components/ui/primitives";
import { DOWNLOAD_PATH, RELEASE_LIVE, RELEASE_TAG } from "@/lib/site";

export function FinalCta() {
  return (
    <section id="get" aria-labelledby="get-title" className="mx-auto max-w-[1180px] scroll-mt-24 pt-[104px] pb-10">
      <div className="relative grid justify-items-center gap-5 overflow-hidden rounded-[35px] bg-ink px-5 py-[72px] text-center text-bg">
        <h2
          id="get-title"
          className="m-0 max-w-[820px] font-display text-[clamp(32px,4.4vw,52px)] leading-[1.04] font-extrabold tracking-[-0.03em] text-balance text-bg"
        >
          Start a plan before the group chat goes quiet
        </h2>
        <p className="m-0 max-w-[540px] text-lg text-[color-mix(in_srgb,var(--bg)_72%,transparent)]">
          {RELEASE_LIVE
            ? "Download the test version, start a plan and drop the link in your chat."
            : "The Android test version is being prepared. It will be on the download page when it's published."}
        </p>
        <Button href={DOWNLOAD_PATH}>
          Download for Android <BtnTag>{RELEASE_TAG}</BtnTag>
        </Button>
        <span className="font-mono text-xs leading-snug font-medium text-[color-mix(in_srgb,var(--bg)_60%,transparent)]">
          Android 9 or newer · free for groups · open source (MIT)
        </span>
      </div>
    </section>
  );
}
