"use client";

// Aceternity UI Pro block "Features with sticky scroll" (Feature Sections), adapted: each step's text drifts
// down while its demo panel fades in beside it (lg and up); stacked cards below lg and under reduced motion.
// Keeps the section id "how" (nav anchor) and the heading copy; fed by FEATURE_STEPS.
import { memo, useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { SectionHeader, Chip } from "@/components/ui/primitives";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

export interface FeatureStep {
  n: string;
  title: string;
  body: string;
  demo: React.ReactNode;
}

function Fingerprint() {
  return (
    <div className="relative grid size-14 place-items-center rounded-full border border-line bg-surface" aria-hidden="true">
      <span className="absolute -inset-1.5 animate-ring rounded-full border-2 border-accent opacity-0 motion-reduce:animate-none" />
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M7 11a5 5 0 0 1 10 0v2a9 9 0 0 1-1 4" />
        <path d="M12 11v3a7 7 0 0 1-2 5" />
        <path d="M4 9a8 8 0 0 1 16 0" />
        <path d="M9 14v-3a3 3 0 0 1 6 0" />
      </svg>
    </div>
  );
}

export const FEATURE_STEPS: FeatureStep[] = [
  {
    n: "Step 1",
    title: "Join with one fingerprint",
    body: "Tap the invite in your group chat. Your fingerprint creates your account and joins the plan.",
    demo: <Fingerprint />,
  },
  {
    n: "Step 2",
    title: "Add money in your currency",
    body: "Type £40, $50 or ₹4,000. The pot holds digital dollars and shows everyone their own currency.",
    demo: <span className="font-mono text-[22px] font-semibold tnum">£40 → $53.89</span>,
  },
  {
    n: "Step 3",
    title: "Spend under the group’s rules",
    body: "Small spends go straight through. Bigger ones wait for a friend’s yes. Everyone sees it live.",
    demo: <Chip tone="pos">Goes through now · under $25</Chip>,
  },
  {
    n: "Step 4",
    title: "Settle up in one tap",
    body: "At the end, one tap pays back everyone who is owed and collects from anyone who owes.",
    demo: <Chip>3 countries · 1 tap · 0.6 s</Chip>,
  },
];

function DemoPanel({ children, big }: { children: React.ReactNode; big?: boolean }) {
  return (
    <div
      className={
        "relative grid place-items-center overflow-hidden rounded-[22px] border border-line bg-surface-2 p-6 " +
        (big ? "min-h-[300px]" : "min-h-[150px]")
      }
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 [background-image:radial-gradient(color-mix(in_srgb,var(--ink)_14%,transparent)_1px,transparent_1px)] [background-size:15px_15px] mask-radial-from-40% mask-radial-at-center"
      />
      <div className={"relative z-10 " + (big ? "origin-center scale-[1.35]" : "")}>{children}</div>
    </div>
  );
}

function StepText({ s, compact }: { s: FeatureStep; compact?: boolean }) {
  return (
    <>
      <span className="font-mono text-[13px] leading-none font-semibold text-muted">{s.n}</span>
      <h3
        className={
          "mt-3 mb-0 max-w-md font-display leading-[1.1] font-bold tracking-[-0.02em] " +
          (compact ? "text-[22px]" : "text-[clamp(24px,3vw,36px)]")
        }
      >
        {s.title}
      </h3>
      <p className={"mt-3 mb-0 max-w-sm text-muted " + (compact ? "text-[15px]" : "text-[17px]")}>{s.body}</p>
    </>
  );
}

const ScrollStep = memo(function ScrollStep({ s, index }: { s: FeatureStep; index: number }) {
  const ref = useRef<HTMLLIElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const translate = useTransform(scrollYProgress, [0, 1], [0, 160]);
  const translateContent = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const opacity = useTransform(scrollYProgress, [0, 0.12, 0.55, 0.8, 1], [0, 1, 1, 0, 0]);
  const opacityText = useTransform(scrollYProgress, [0, 0.2, 0.5, 0.8, 1], [0, 0, 1, 1, 0]);
  return (
    <li ref={ref} className="relative my-20 grid grid-cols-2 items-start gap-12 first:mt-10">
      <motion.div style={{ y: translate, opacity: index === 0 ? opacityText : 1 }}>
        <StepText s={s} />
      </motion.div>
      <motion.div style={{ y: translateContent, opacity }}>
        <DemoPanel big>{s.demo}</DemoPanel>
      </motion.div>
    </li>
  );
});

export function FeatureSection({ steps = FEATURE_STEPS }: { steps?: FeatureStep[] }) {
  const reduce = usePrefersReducedMotion();
  return (
    <section id="how" aria-labelledby="how-title" className="mx-auto max-w-[1180px] scroll-mt-24 pt-[104px]">
      <SectionHeader
        id="how-title"
        badge="How it works"
        title="From the group chat to settled, in four steps"
        lede="Everything happens in the app. Nobody needs a bank in the same country or anything to set up first."
      />
      {!reduce && (
        <ol className="m-0 hidden list-none p-0 px-6 lg:block">
          {steps.map((s, i) => (
            <ScrollStep key={s.n} s={s} index={i} />
          ))}
        </ol>
      )}
      <ol className={"m-0 grid list-none grid-cols-1 gap-4 p-0 min-[561px]:grid-cols-2 " + (reduce ? "lg:grid-cols-4" : "lg:hidden")}>
        {steps.map((s) => (
          <li key={s.n} className="relative grid min-w-0 content-start gap-0 rounded-[20px] border border-line bg-surface p-[22px]">
            <StepText s={s} compact />
            <div className="mt-4">
              <DemoPanel>{s.demo}</DemoPanel>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
