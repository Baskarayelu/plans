import { SectionHeader } from "@/components/ui/primitives";
import { TextFlippingBoard } from "@/components/ui/text-flipping-board";

// Example plans, not real data. 24 columns; the first 8 are the label column.
const BOARDS = [
  ["PLAN    LISBON 12-16 OCT", "PEOPLE  4  GB US IN PT", "POT     $1,240.00", "DINNER  $36.00 / 3", "BOAT    $250 APPROVED", "STATUS  SETTLED 0.6 S"],
  ["PLAN    GLASTONBURY CREW", "PEOPLE  6  GB IE NG", "POT     $2,310.00", "TICKETS $1,890.00", "CAMPING $180 / 6", "STATUS  ON TRACK"],
  ["PLAN    SANA'S WEDDING", "PEOPLE  9  IN GB US AE", "POT     $3,050.00", "STAY    $1,400 OF $1,600", "GIFTS   ₹25,000 SENT", "STATUS  SETTLE SUNDAY"],
];

export function DeparturesBoard() {
  return (
    <section aria-labelledby="board-title" className="mx-auto max-w-[1180px] pt-[104px]">
      <SectionHeader id="board-title" badge="Now boarding" title="Trips, festivals, house shares. One pot each." />
      <div className="relative rounded-[28px] border border-line bg-surface p-[clamp(14px,3vw,34px)] shadow-card">
        <div className="mb-4 flex flex-wrap justify-between gap-x-4 gap-y-2 font-mono text-xs leading-none font-semibold tracking-[.08em] text-muted uppercase">
          <span>Plans departures</span>
          <span className="inline-flex items-center gap-2 text-pos">
            <span aria-hidden="true" className="size-2 animate-live rounded-full bg-current motion-reduce:animate-none" />
            Example plans
          </span>
        </div>
        <TextFlippingBoard boards={BOARDS} ariaLabel="Example plans board: a Lisbon trip, a festival crew and a wedding, each with its own pot." />
      </div>
    </section>
  );
}
