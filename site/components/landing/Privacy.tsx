import { SectionHeader } from "@/components/ui/primitives";

function Mini({ top, bottom }: { top: string; bottom: string }) {
  return (
    <div className="grid w-[180px] justify-items-center gap-2.5 rounded-[26px] border border-line bg-bg px-3.5 py-4 text-center">
      <span className="font-mono text-[11px] leading-snug font-medium text-muted">{top}</span>
      <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1.5 text-lg tracking-[2px]">🦊🌵🎈</span>
      <span className="font-mono text-[11px] leading-snug font-medium text-muted">{bottom}</span>
    </div>
  );
}

export function Privacy() {
  return (
    <section aria-labelledby="priv-title" className="mx-auto max-w-[1180px] pt-[104px]">
      <SectionHeader id="priv-title" badge="Private by default" title="Your receipts are for your group only" />
      <div className="grid grid-cols-1 items-stretch gap-4 min-[901px]:grid-cols-2">
        <div className="grid min-w-0 content-start gap-3 rounded-[22px] border border-line bg-surface p-6">
          <h3 className="m-0 font-display text-[22px] leading-[1.15] font-bold tracking-[-0.02em]">Locked with your fingerprint</h3>
          <p className="m-0 text-[15px] text-muted">
            Receipt photos, notes and names are encrypted with a key that comes from your passkey. Only people in the
            plan can open them.
          </p>
          <p className="m-0 text-[15px] text-muted">
            New phone? Sign in with the same passkey and everything is back, receipts included. Nothing to copy,
            nothing to remember.
          </p>
        </div>
        <div className="grid min-w-0 content-center rounded-[22px] border border-line bg-surface p-6">
          <div className="flex flex-wrap justify-center gap-3.5">
            <Mini top="Your phone" bottom="Receipts unlocked" />
            <Mini top="Your new phone" bottom="Same key, same receipts" />
          </div>
        </div>
      </div>
    </section>
  );
}
