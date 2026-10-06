"use client";

// PRO BLOCK SLOT: "Bento Grids" (Aceternity UI Pro). Replace the grid below with the Pro bento and pass each
// cell's title/body/visual from RULES_CELLS; keep the section id "rules" (nav anchor) and the header copy.
import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { SectionHeader, Chip } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

function Tiers() {
  const rows = [
    { amt: "≤ $25", label: "Goes through now", cls: "bg-[color-mix(in_srgb,var(--pos)_16%,transparent)] text-pos" },
    { amt: "≤ $200", label: "One friend approves", cls: "bg-[color-mix(in_srgb,var(--accent)_30%,transparent)]" },
    { amt: "> $200", label: "Most of the group approves", cls: "bg-[color-mix(in_srgb,var(--info)_16%,transparent)] text-info" },
  ];
  return (
    <div className="mt-1.5 grid gap-2">
      {rows.map((r) => (
        <div key={r.amt} className="grid grid-cols-[92px_1fr] items-center gap-3 text-sm">
          <span className="font-mono text-sm leading-none font-semibold">{r.amt}</span>
          <span className={cn("flex h-[30px] items-center rounded-[10px] px-3 text-[13px] font-semibold", r.cls)}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function Budgets() {
  const reduce = usePrefersReducedMotion();
  const rows = [
    { name: "Stay", used: "$480 of $600", w: 80 },
    { name: "Tickets & activities", used: "$150 of $400", w: 37.5 },
    { name: "Food & drink", used: "$188 of $200", w: 94, over: true },
  ];
  return (
    <div className="mt-1.5 grid gap-3">
      {rows.map((r) => (
        <div key={r.name} className="grid gap-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <span>{r.name}</span>
            <span className="font-mono text-[13px] text-muted tnum">{r.used}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            {reduce ? (
              <div className={cn("h-full rounded-full", r.over ? "bg-neg" : "bg-pos")} style={{ width: `${r.w}%` }} />
            ) : (
              <motion.div
                className={cn("h-full origin-left rounded-full", r.over ? "bg-neg" : "bg-pos")}
                style={{ width: `${r.w}%` }}
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 1.4, ease: [0.2, 0.7, 0.2, 1] }}
              />
            )}
          </div>
        </div>
      ))}
      <div className="rounded-xl bg-[color-mix(in_srgb,var(--neg)_10%,transparent)] px-3 py-2.5 text-[13px] leading-snug font-semibold text-neg">
        Over the Food &amp; drink budget by $12. Ask the group to raise it.
      </div>
    </div>
  );
}

export interface RulesCell {
  key: string;
  title: string;
  body: string;
  visual: React.ReactNode;
  span: "wide" | "third";
}

export const RULES_CELLS: RulesCell[] = [
  {
    key: "tiers",
    title: "Small things go through. Big things need a yes.",
    body: "Balanced, the default: up to $25 is instant, up to $200 needs one friend, above that the majority.",
    visual: <Tiers />,
    span: "wide",
  },
  {
    key: "budgets",
    title: "Budgets per category",
    body: "Set a cap for stay, food or tickets. A spend that would go over is stopped before any money moves.",
    visual: <Budgets />,
    span: "wide",
  },
  {
    key: "pause",
    title: "Anyone can hit pause",
    body: "Something looks wrong? Any member can stop all spending for a day while the group sorts it out.",
    visual: (
      <span className="inline-flex w-fit items-center gap-2.5 rounded-full border border-line px-4 py-3 font-semibold">
        <i aria-hidden="true" className="h-3.5 w-3 border-x-4 border-ink" />
        Pause spending
      </span>
    ),
    span: "third",
  },
  {
    key: "disputes",
    title: "Fair disputes",
    body: "Think a split is wrong? Flag it. The friend who paid can fix it, or the rest of the group decides.",
    visual: <Chip className="w-fit">Keep · or · Spender covers</Chip>,
    span: "third",
  },
  {
    key: "leave",
    title: "Leave any time",
    body: "Going home early? Leave the plan and get back what you put in, minus your share so far.",
    visual: (
      <Chip tone="pos" className="w-fit tnum">
        Your refund: $61.40
      </Chip>
    ),
    span: "third",
  },
];

export function RulesBento({ cells = RULES_CELLS }: { cells?: RulesCell[] }) {
  return (
    <section id="rules" aria-labelledby="rules-title" className="mx-auto max-w-[1180px] scroll-mt-24 pt-[104px]">
      <SectionHeader
        id="rules-title"
        badge="Group rules"
        title="Rules your group sets, kept by the pot itself"
        lede="Pick Easygoing, Balanced or Strict, then change anything. Nobody, including us, can spend outside the rules."
      />
      <div className="grid grid-cols-1 gap-4 min-[901px]:grid-cols-6">
        {cells.map((c) => (
          <div
            key={c.key}
            className={cn(
              "relative grid min-w-0 content-start gap-3 overflow-hidden rounded-[22px] border border-line bg-surface p-6",
              c.span === "wide" ? "min-[901px]:col-span-3" : "min-[901px]:col-span-2",
            )}
          >
            <h3 className="m-0 font-display text-[22px] leading-[1.15] font-bold tracking-[-0.02em]">{c.title}</h3>
            <p className="m-0 max-w-[46ch] text-[15px] text-muted">{c.body}</p>
            {c.visual}
          </div>
        ))}
      </div>
    </section>
  );
}
