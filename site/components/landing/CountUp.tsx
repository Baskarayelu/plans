"use client";

import { useEffect, useRef } from "react";
import { animate, useInView } from "motion/react";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

/** Counts from 0 to `to` once, when scrolled into view. Renders the final value on the server and under reduced motion. */
export function CountUp({ to, decimals = 0 }: { to: number; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = usePrefersReducedMotion();
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || done.current) return;
    if (reduce) {
      el.textContent = to.toFixed(decimals); // the preference can arrive after the first effect armed it at 0
      return;
    }
    if (!inView) {
      el.textContent = (0).toFixed(decimals); // armed: waits at 0 until visible
      return;
    }
    done.current = true;
    const controls = animate(0, to, {
      duration: 1.4,
      ease: [0.33, 1, 0.68, 1],
      onUpdate: (v) => (el.textContent = v.toFixed(decimals)),
    });
    return () => controls.stop();
  }, [inView, reduce, to, decimals]);

  return <span ref={ref}>{to.toFixed(decimals)}</span>;
}
