/**
 * A check that runs before anything signs or relays (lib/link/removalWatch.ts registers one: a
 * linked browser that was removed locks itself instead). Kept free of imports so session.ts and
 * the relayer client can both call it without import cycles.
 */
let hook: (() => Promise<void>) | null = null;

/** Registers the check (one at a time; null removes it). */
export function setBeforeSensitive(fn: (() => Promise<void>) | null): void {
  hook = fn;
}

/** Runs the check; throws when the action must not go ahead. */
export async function beforeSensitive(): Promise<void> {
  if (hook) await hook();
}

const SIGNERS = ["sign", "signMessage", "signTypedData", "signTransaction", "signAuthorization"] as const;

/** The same account, with the check run before each of its signing methods. */
export function guardAccount<A extends object>(account: A): A {
  const out: Record<string, unknown> = { ...(account as Record<string, unknown>) };
  for (const k of SIGNERS) {
    const f = out[k];
    if (typeof f === "function") {
      out[k] = async (...args: unknown[]) => {
        await beforeSensitive();
        return (f as (...a: unknown[]) => unknown).apply(account, args);
      };
    }
  }
  return out as A;
}
