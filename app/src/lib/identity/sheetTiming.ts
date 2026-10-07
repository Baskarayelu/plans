/**
 * B5: how long Android takes between the tap ("Create account", "I already use Plans", "Join")
 * and its passkey sheet appearing. Pure parts only; the hook lives in usePasskeyWait.ts.
 *
 *   under SHEET_SLOW_MS     nothing changes on screen (fast phones never see a spinner)
 *   from SHEET_SLOW_MS      the button says "Opening passkey…" (design 126)
 *   from SHEET_GIVE_UP_MS   the screen says the step didn't open (design 129)
 */

export const SHEET_SLOW_MS = 1_000;
export const SHEET_GIVE_UP_MS = 15_000;

/** What the screen shows while the tap is waiting for the system sheet. */
export type SheetPhase = "idle" | "quiet" | "waiting" | "stuck";

export type PasskeyFlow = "create" | "restore" | "join" | "unlock";

/**
 * Phase for a tap made `elapsedMs` ago. Once the sheet has appeared (`shown`) or the call has
 * finished (`settled`) the screen goes back to normal.
 */
export function sheetPhase(elapsedMs: number, shown: boolean, settled = false): SheetPhase {
  if (shown || settled || elapsedMs < 0) return "idle";
  if (elapsedMs >= SHEET_GIVE_UP_MS) return "stuck";
  if (elapsedMs >= SHEET_SLOW_MS) return "waiting";
  return "quiet";
}

/** Whether the loading state (design 126) is worth showing for a measured delay. */
export function needsWaitingState(delayMs: number): boolean {
  return delayMs >= SHEET_SLOW_MS;
}

/**
 * One logcat line under tag PLANS_TIMING, e.g.
 *   "passkey_sheet flow=create ms=842 result=shown slow=false"
 *   "passkey_sheet flow=restore ms=95 result=no-sheet:cancelled slow=false"
 */
export function timingLine(flow: PasskeyFlow, ms: number, result: string): string {
  const m = Math.max(0, Math.round(ms));
  return `passkey_sheet flow=${flow} ms=${m} result=${result} slow=${needsWaitingState(m)}`;
}
