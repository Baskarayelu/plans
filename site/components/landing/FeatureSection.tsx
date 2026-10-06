// PRO BLOCK SLOT: "Feature Sections" (Aceternity UI Pro). Replace the body of this component with the Pro block
// and feed it FEATURE_STEPS; keep the section id "how" (nav anchor) and the heading copy.
import { SectionHeader, Chip } from "@/components/ui/primitives";

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

export function FeatureSection({ steps = FEATURE_STEPS }: { steps?: FeatureStep[] }) {
  return (
    <section id="how" aria-labelledby="how-title" className="mx-auto max-w-[1180px] scroll-mt-24 pt-[104px]">
      <SectionHeader
        id="how-title"
        badge="How it works"
        title="From the group chat to settled, in four steps"
        lede="Everything happens in the app. Nobody needs a bank in the same country or anything to set up first."
      />
      <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 min-[561px]:grid-cols-2 min-[961px]:grid-cols-4">
        {steps.map((s) => (
          <li key={s.n} className="relative grid min-w-0 content-start gap-3 rounded-[20px] border border-line bg-surface p-[22px]">
            <span className="font-mono text-[13px] leading-none font-semibold text-muted">{s.n}</span>
            <h3 className="m-0 font-display text-[22px] leading-[1.15] font-bold tracking-[-0.02em]">{s.title}</h3>
            <p className="m-0 text-[15px] text-muted">{s.body}</p>
            <div className="mt-1.5 grid min-h-[92px] place-items-center rounded-[14px] bg-surface-2 p-3">{s.demo}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
