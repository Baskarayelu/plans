/**
 * "Create account" in a browser (requirement: never silently a second account).
 *
 *   1. Ask the browser for ANY Plans passkey (discoverable get, no allowCredentials). The browser's
 *      own dialog lists every passkey it can reach for plans.0xo.in, including "Use a phone or
 *      tablet" (hybrid). An answer → that account (restored, possibly a linked browser's vault).
 *   2. Nothing answered (closed, none found, or the phone's passkey gave no PRF over hybrid) → the
 *      person chooses: use the phone's passkey (the browser's QR), link this browser (design 166–170),
 *      or "I'm new to Plans". Only that last choice creates a passkey.
 *
 * Android keeps createOrRestore (Credential Manager's "immediately available" check).
 */
import type { PasskeyFailure } from "./session";
import { createNewAccount, findExistingAccount, PasskeyError } from "./session";

export type WebCreateStart = { kind: "restored"; isNew: boolean; linked: boolean } | { kind: "choose"; why: PasskeyFailure };

/** Failures that mean "this browser can't do passkeys at all": the unsupported screen, not the choice. */
const HARD: PasskeyFailure[] = ["not-supported", "no-provider", "domain-not-verified"];

export async function webCreateStart(): Promise<WebCreateStart> {
  try {
    // A phone's passkey picked through "Use a phone or tablet" here must bring the keys output too,
    // or it's the 176a path (link with a code) rather than an account opened half-way.
    const r = await findExistingAccount({ requireKeys: "cross-device" });
    return { kind: "restored", isNew: r.isNew, linked: r.linked };
  } catch (e) {
    const kind = e instanceof PasskeyError ? e.kind : "failed";
    if (HARD.includes(kind)) throw e;
    return { kind: "choose", why: kind };
  }
}

/**
 * Choice (i): the phone's passkey through the browser's own QR ("hybrid", design 167). A browser
 * that doesn't return the PRF outputs over hybrid fails as "prf-unavailable" with nothing saved,
 * and the choice screen shows 176a with "Link with a code". (Needs a real-device test; see
 * discoverableSignIn in session.ts.)
 */
export async function signInWithPhone(): Promise<{ isNew: boolean; linked: boolean }> {
  const r = await findExistingAccount({ hints: ["hybrid"], requireKeys: true });
  return { isNew: r.isNew, linked: r.linked };
}

/** Choice (iii): "I'm new to Plans" — the only path that creates a new account. */
export async function createAsNew(displayName = "Plans"): Promise<{ isNew: boolean }> {
  return createNewAccount(displayName);
}
