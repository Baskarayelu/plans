// Aceternity UI Pro block "CTA With Background Noise" (CTA Sections), adapted: pine panel, marigold hairlines,
// the noise drawn as an inline SVG (no image download), and two ticket stubs where the block has screenshots.
// Keeps id "get", the copy, and the primary button pointing at DOWNLOAD_PATH (/download).
import { Button, BtnTag, Chip } from "@/components/ui/primitives";
import { DOWNLOAD_PATH, RELEASE_LIVE, RELEASE_TAG } from "@/lib/site";
import { TicketStub } from "./Hero";

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function Hairlines({ edge }: { edge: "top" | "bottom" }) {
  const pos = edge === "top" ? "-top-px" : "-bottom-px";
  return (
    <>
      <div className={`absolute ${pos} right-10 z-30 h-px w-1/2 bg-gradient-to-r from-transparent via-accent to-transparent md:right-60`} />
      <div className={`absolute ${pos} right-10 z-30 h-px w-1/2 bg-gradient-to-r from-transparent via-pos to-transparent md:right-40`} />
      <div className={`absolute ${pos} right-10 z-30 h-px w-1/2 bg-gradient-to-r from-transparent via-info to-transparent md:right-80`} />
    </>
  );
}

export function FinalCta() {
  return (
    <section id="get" aria-labelledby="get-title" className="mx-auto max-w-[1180px] scroll-mt-24 pt-[104px] pb-10">
      <div className="relative z-20 grid w-full grid-cols-1 overflow-hidden rounded-[35px] border border-line bg-gradient-to-br from-[#10231b] to-[#0a1711] text-[#f4f1e8] md:grid-cols-2">
        <Hairlines edge="top" />
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[.12] [mask-image:radial-gradient(#fff,transparent,75%)]"
          style={{ backgroundImage: NOISE, backgroundSize: "160px" }}
        />
        <div className="relative px-6 py-12 sm:px-12 sm:pt-20 sm:pb-16">
          <h2
            id="get-title"
            className="m-0 max-w-[560px] font-display text-[clamp(32px,4.4vw,52px)] leading-[1.04] font-extrabold tracking-[-0.03em] text-balance"
          >
            Start a plan before the group chat goes quiet
          </h2>
          <p className="mt-6 mb-0 max-w-[30rem] text-lg text-[#f4f1e8]/75">
            {RELEASE_LIVE
              ? "Download the test version, start a plan and drop the link in your chat."
              : "The Android test version is being prepared. It will be on the download page when it's published."}
          </p>
          <div className="mt-8">
            <Button href={DOWNLOAD_PATH}>
              Download for Android <BtnTag>{RELEASE_TAG}</BtnTag>
            </Button>
          </div>
          <p className="mt-5 mb-0 font-mono text-xs leading-snug font-medium text-[#f4f1e8]/60">
            Android 9 or newer · free for groups · open source (MIT)
          </p>
        </div>
        <div aria-hidden="true" className="relative flex min-h-[260px] items-center justify-center overflow-hidden px-6 pb-12 md:min-h-0 md:pb-0">
          <TicketStub
            className="relative z-10 -rotate-[8deg] max-[420px]:scale-90 md:-translate-x-16 md:translate-y-14"
            title="Lisbon, 3 friends"
            tag={<Chip tone="pos">Settled</Chip>}
            amount="$412.80"
            sub="£ · $ · ₹ · one tap"
            foot={
              <>
                Everyone paid back
                <br />
                <b className="font-semibold text-pos">0.6 s on Monad</b>
              </>
            }
          />
          <TicketStub
            className="absolute top-[12%] right-[5%] rotate-[9deg] opacity-90 max-md:hidden"
            title="Invite"
            tag={<Chip>Join</Chip>}
            amount="Asha's birthday"
            sub="$25 each · 5 friends"
            foot="Tap the link, use your fingerprint"
          />
        </div>
        <Hairlines edge="bottom" />
      </div>
    </section>
  );
}
