import type { Metadata } from "next";
import { PageShell } from "@/components/ui/primitives";
import { PrfProbe } from "./PrfProbe";

export const metadata: Metadata = {
  title: "Passkey check",
  description: "Checks that this browser returns both Plans keys from one passkey prompt.",
  robots: { index: false, follow: false },
};

export default function ProbePage() {
  return (
    <PageShell>
      <div className="mx-auto grid max-w-[680px] gap-5 py-10">
        <h1 className="m-0 font-display text-4xl font-extrabold tracking-tight">Passkey check</h1>
        <p className="m-0 text-muted">
          For testing only. This creates a test passkey for plans.0xo.in, then signs in once and asks for both Plans
          keys: the account key and the <span className="font-mono">plans.keys.v1</span> key. It shows only short
          fingerprints of what came back, never the keys themselves. Nothing is sent anywhere.
        </p>
        <PrfProbe />
      </div>
    </PageShell>
  );
}
