import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { friendlyError } from "../api/relayer";
import { LockedError } from "../identity/session";
import { NeedsKeysError } from "../domain/planOps";
import { createStore } from "./observable";

/**
 * Runs a money action with loading and error state.
 * - LockedError → the unlock screen (one fingerprint), then the person taps again.
 * - NeedsKeysError → "Unlock receipts".
 * - Anything else → a friendly { title, message }; `fatal: true` routes to screen 59.
 * Never retries a money action by itself, so nothing is ever sent twice.
 */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>, opts: { fatal?: boolean; context?: string } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; message: string; code: string } | null>(null);
  const inFlight = useRef(false);
  const run = useCallback(
    async (...a: A): Promise<R | undefined> => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        return await fn(...a);
      } catch (e) {
        if (e instanceof LockedError) {
          router.push("/unlock");
          return undefined;
        }
        if (e instanceof NeedsKeysError) {
          router.push("/unlock-keys");
          return undefined;
        }
        const f = friendlyError(e);
        setError(f);
        if (opts.fatal) router.push({ pathname: "/error", params: { title: f.title, message: f.message, code: f.code, context: opts.context ?? "" } });
        return undefined;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn],
  );
  return { run, busy, error, clearError: () => setError(null) };
}

/** Receipt details handed from an action screen to its receipt screen (keyed by tx hash). */
export type ReceiptData = {
  kind: "spend" | "approve" | "send" | "received" | "settle" | "add" | "join" | "link" | "claim" | "exit" | "debt" | "personal";
  txHash: string;
  settledMs: number;
  at: number;
  [k: string]: unknown;
};

export const receipts = createStore<Record<string, ReceiptData>>({});

export function putReceipt(r: ReceiptData): void {
  receipts.set((prev) => ({ ...prev, [r.txHash]: r }));
}

export function getReceipt(tx?: string): ReceiptData | undefined {
  return tx ? receipts.get()[tx] : undefined;
}
