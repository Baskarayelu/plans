/**
 * B5: measures the time from a tap to the system passkey sheet and drives the waiting state.
 *
 * Android shows the passkey sheet in its own activity, so the moment it appears our window loses
 * focus (AppState "blur") or the app goes to the background. The first of those after the tap is
 * the sheet. Every measurement is written to logcat under PLANS_TIMING:
 *   adb logcat -s PLANS_TIMING
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, type NativeEventSubscription } from "react-native";
import { logLine } from "../../../modules/plans-native";
import { SHEET_GIVE_UP_MS, SHEET_SLOW_MS, sheetPhase, timingLine, type PasskeyFlow, type SheetPhase } from "./sheetTiming";

export function usePasskeyWait() {
  const [phase, setPhase] = useState<SheetPhase>("idle");
  const run = useRef<{ flow: PasskeyFlow; t0: number; shown: boolean; subs: NativeEventSubscription[]; timers: ReturnType<typeof setTimeout>[] } | null>(null);

  const stop = useCallback(() => {
    const r = run.current;
    if (!r) return;
    r.subs.forEach((s) => s.remove());
    r.timers.forEach((t) => clearTimeout(t));
    run.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  /** Call right before starting the passkey call. */
  const start = useCallback(
    (flow: PasskeyFlow) => {
      stop();
      const r = { flow, t0: Date.now(), shown: false, subs: [] as NativeEventSubscription[], timers: [] as ReturnType<typeof setTimeout>[] };
      run.current = r;
      setPhase("quiet");
      const onSheet = () => {
        if (run.current !== r || r.shown) return;
        r.shown = true;
        const ms = Date.now() - r.t0;
        logLine("PLANS_TIMING", timingLine(flow, ms, "shown"));
        r.timers.forEach((t) => clearTimeout(t));
        setPhase("idle");
      };
      if (Platform.OS === "web") {
        // Browsers: the passkey dialog takes focus from the page (window "blur"); there is no AppState "blur".
        if (typeof window !== "undefined") {
          window.addEventListener("blur", onSheet);
          r.subs.push({ remove: () => window.removeEventListener("blur", onSheet) } as NativeEventSubscription);
        }
      } else r.subs.push(AppState.addEventListener("blur", onSheet));
      r.subs.push(AppState.addEventListener("change", (s) => (s !== "active" ? onSheet() : undefined)));
      const tick = () => {
        if (run.current !== r) return;
        setPhase(sheetPhase(Date.now() - r.t0, r.shown));
      };
      r.timers.push(setTimeout(tick, SHEET_SLOW_MS));
      r.timers.push(
        setTimeout(() => {
          if (run.current !== r || r.shown) return;
          logLine("PLANS_TIMING", timingLine(flow, Date.now() - r.t0, "still-waiting"));
          tick();
        }, SHEET_GIVE_UP_MS),
      );
    },
    [stop],
  );

  /** Call when the passkey call has finished (either way). */
  const finish = useCallback(
    (result: "ok" | string) => {
      const r = run.current;
      if (r && !r.shown) logLine("PLANS_TIMING", timingLine(r.flow, Date.now() - r.t0, `no-sheet:${result}`));
      stop();
      setPhase("idle");
    },
    [stop],
  );

  return { phase, start, finish };
}
