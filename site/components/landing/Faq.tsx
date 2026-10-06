import { SectionHeader } from "@/components/ui/primitives";

export const FAQ = [
  {
    q: "What are digital dollars?",
    a: "The pot holds AUSD, a digital dollar issued by Agora and backed one to one by cash and short-term US Treasuries. You see it as dollars, next to your own currency.",
  },
  {
    q: "Do I need to know anything about crypto?",
    a: "No. You use your fingerprint. There are no passwords, seed phrases or network fees to pay.",
  },
  {
    q: "What if someone owes money at the end?",
    a: "When you join, you choose a small safety net. At settle-up, anything you owe up to that amount is collected from your Plans balance. Anything more is shown as a debt you can pay later.",
  },
  {
    q: "Can the organiser run off with the money?",
    a: "No. The pot has no owner. Every spend follows the rules the group agreed, and those rules can only change with the group’s approval.",
  },
  { q: "Which phones work?", a: "Android 9 or newer with a screen lock, for the beta. iPhone comes later." },
  {
    q: "How do I get money in and out?",
    a: "For the beta, a friend can send you a link, or you can receive digital dollars from an exchange. Bank and card top-ups are planned.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-[1180px] scroll-mt-24 pt-[104px]">
      <SectionHeader id="faq-title" badge="Questions" title="Good questions, short answers" />
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 min-[761px]:grid-cols-2">
        {FAQ.map((f, i) => (
          <details
            key={f.q}
            open={i === 0}
            className="group rounded-2xl border border-line bg-surface px-[18px] py-4 [&_summary::-webkit-details-marker]:hidden"
          >
            <summary className="flex cursor-pointer list-none justify-between gap-3 text-base font-semibold">
              {f.q}
              <span aria-hidden="true" className="font-mono text-xl leading-none font-medium text-muted">
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">–</span>
              </span>
            </summary>
            <p className="mt-2.5 mb-0 text-[15px] text-muted">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
