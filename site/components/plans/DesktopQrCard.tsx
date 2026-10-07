import { QrCode } from "./QrCode";
import { DOWNLOAD_PATH, SITE_HOST, SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * QR to plans.0xo.in/download for visitors on a computer. Shown only with a wide viewport and a fine
 * pointer that can hover (the `desktop` variant in globals.css); phones and tablets never see it.
 */
export function DesktopQrCard({ title, sub, className }: { title: string; sub: React.ReactNode; className?: string }) {
  return (
    <div className={cn("hidden w-[340px] flex-none rounded-[22px] border border-line bg-surface p-6 text-center shadow-card desktop:block", className)}>
      <div className="font-mono text-xs font-semibold tracking-[.08em] text-muted uppercase">{title}</div>
      <div className="mt-3.5 inline-block rounded-2xl border border-line bg-white p-2.5">
        <QrCode value={`${SITE_URL}${DOWNLOAD_PATH}`} size={200} label={`QR code that opens ${SITE_HOST}${DOWNLOAD_PATH}`} />
      </div>
      <div className="mt-3 font-mono text-[13px] font-medium">
        {SITE_HOST}
        {DOWNLOAD_PATH}
      </div>
      <p className="mt-2 mb-0 text-[13px] text-pretty text-muted">{sub}</p>
    </div>
  );
}
