import { SectionHeader, Chip } from "@/components/ui/primitives";
import { WorldMap } from "@/components/ui/world-map";
import { TicketStub } from "./Hero";

export function AcrossBorders() {
  return (
    <section id="borders" aria-labelledby="borders-title" className="mx-auto max-w-[1180px] scroll-mt-24 pt-[104px]">
      <SectionHeader
        id="borders-title"
        badge="Across borders"
        title="Your friends live in different countries. Your pot doesn’t mind."
        lede="Send to a friend in another country and they see it in their own currency in under a second, with the exchange rate on the receipt."
      />
      <div className="relative overflow-hidden rounded-[28px] border border-line bg-surface">
        <WorldMap
          routes={[
            ["LON", "NYC"],
            ["NYC", "LIS"],
            ["BLR", "LIS"],
            ["LON", "BLR"],
            ["LOS", "LON"],
          ]}
          ariaLabel="Map with money moving between London, New York, Bengaluru, Lisbon and Lagos"
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 min-[901px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-3 rounded-[22px] border border-line bg-surface p-6">
          <h3 className="m-0 font-display text-[22px] leading-[1.15] font-bold tracking-[-0.02em]">
            Send to anyone, even without the app
          </h3>
          <p className="m-0 max-w-[46ch] text-[15px] text-muted">
            Send a link. Your friend opens it, confirms with their fingerprint and the money is theirs, wherever they
            are. If nobody claims it in 7 days, it comes back to you.
          </p>
          <div className="flex flex-wrap gap-2">
            <Chip>🇬🇧 → 🇺🇸 £1.50 = $2.02</Chip>
            <Chip>🇺🇸 → 🇮🇳 $25 = ₹2,090</Chip>
            <Chip>🇮🇳 → 🇬🇧 ₹1,000 = £8.96</Chip>
          </div>
        </div>
        <TicketStub
          className="w-auto"
          title="Maya → Sam"
          tag={<span className="font-mono text-xs font-medium text-muted">London → New York</span>}
          amount={
            <>
              $2.02 <span className="text-[15px] text-muted">· £1.50</span>
            </>
          }
          sub="Digital dollars (AUSD)"
          foot={
            <span className="tnum">
              Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC
              <br />
              <b className="font-semibold text-pos">Settled in 0.6 s</b> · Network cost covered by Plans
            </span>
          }
        />
      </div>
    </section>
  );
}
