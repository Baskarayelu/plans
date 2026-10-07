"use client";

// The plan name appears on a proof page only when the person who shared it put it in the link
// (`/s/<pot>#n=<name>`). It is read here, in this browser; the part after "#" never reaches a server,
// and nothing about the name is stored by Plans or used in the link-preview image.

import { useSyncExternalStore } from "react";
import { parseFragment } from "@/lib/plans-crypto";
import { cn } from "@/lib/utils";

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
const getName = () => {
  const n = parseFragment(window.location.hash).n?.trim();
  return n ? n.slice(0, 60) : "";
};
const getServer = () => "";

export function ProofHeadline({ headline, className }: { headline: string; className?: string }) {
  const name = useSyncExternalStore(subscribe, getName, getServer);
  const h1 = "m-0 font-display font-extrabold tracking-[-0.035em] text-balance";
  if (!name) return <h1 className={cn(h1, className, "leading-[1.04]")}>{headline}</h1>;
  return (
    <div className="grid gap-2">
      <h1 className={cn(h1, className, "leading-[1.04]")}>{name}</h1>
      <p className="m-0 text-[17px] text-pretty text-muted">{headline}.</p>
      <p className="m-0 text-xs text-muted">
        The person who shared this link added the plan’s name to it. Plans doesn’t store or show it anywhere else.
      </p>
    </div>
  );
}
