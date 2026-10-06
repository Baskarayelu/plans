/**
 * The signed-in person: one passkey ceremony per app launch unlocks
 *   - the account (Mera default PRF salt → BIP-39 → m/44'/60'/0'/0/0 → Mera signing session → viem account)
 *   - the Plans keys (PRF salt sha256("plans.keys.v1") → HKDF → X25519 + cache key), from the
 *     same ceremony's `second` PRF output when the provider returns it.
 * Secrets stay in memory; the session ends after a long time in the background.
 */
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  isMeraError,
  type Secp256k1SigningSession,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { LocalAccount } from "viem";
import { config } from "../../config";
import { toHex, wipe } from "../crypto/bytes";
import { deriveAccountPrivateKey, deriveKeys, KEYS_PRF_SALT, type PlansKeys } from "../crypto/keys";
import { createStore } from "../state/observable";
import { storage, type Profile, type StoredAccount } from "../state/storage";
import { clearSecondOutput, createDualPrfClient, describeNativeError, lastCeremonyDiagnostics, nativeErrorCode, takeSecondOutput } from "./webauthnClient";

export type IdentityStatus = "loading" | "none" | "locked" | "unlocked";

export type IdentityState = {
  status: IdentityStatus;
  address?: `0x${string}`;
  credentialId?: string;
  profile?: Profile;
  fingerprint?: string;
  x25519Public?: string;
  /** True when unlocked but the keys namespace still needs its own ceremony. */
  keysPending: boolean;
  keyRegistered?: boolean;
};

export const identity = createStore<IdentityState>({ status: "loading", keysPending: false });

let session: Secp256k1SigningSession | null = null;
let account: LocalAccount | null = null;
let keys: PlansKeys | null = null;

export function currentAccount(): LocalAccount {
  if (!account) throw new LockedError();
  return account;
}
export function currentAccountOrNull(): LocalAccount | null {
  return account;
}
export function currentKeys(): PlansKeys | null {
  return keys;
}

export class LockedError extends Error {
  constructor() {
    super("Locked");
  }
}

export type PasskeyFailure =
  | "cancelled"
  | "no-credentials"
  | "not-supported"
  | "no-provider"
  | "prf-unavailable"
  | "domain-not-verified"
  | "failed";

export class PasskeyError extends Error {
  constructor(
    public kind: PasskeyFailure,
    public detail: string,
  ) {
    super(kind);
  }
}

export function classifyPasskeyError(e: unknown): PasskeyError {
  if (e instanceof PasskeyError) return e;
  const code = nativeErrorCode(e);
  const detail = describeNativeError(e);
  if (isMeraError(e) && e.code === "PRF_UNAVAILABLE") return new PasskeyError("prf-unavailable", detail);
  switch (code) {
    case "UserCancelled":
    case "Interrupted":
    case "TimedOut":
      return new PasskeyError("cancelled", detail);
    case "NoCredentials":
      return new PasskeyError("no-credentials", detail);
    case "NotSupported":
      return new PasskeyError("not-supported", detail);
    case "NotConfigured":
    case "NoCreateOption":
      return new PasskeyError("no-provider", detail);
    case "RequestFailed":
    case "BadConfiguration":
      return new PasskeyError("domain-not-verified", detail);
  }
  return new PasskeyError("failed", detail);
}

function openSession(prfFirst: Uint8Array): void {
  const pk = deriveAccountPrivateKey(prfFirst);
  try {
    session?.end();
    session = createSecp256k1SigningSession({ privateKey: pk });
    account = toViemAccount(session) as unknown as LocalAccount;
  } finally {
    wipe(pk, prfFirst);
  }
}

function applyKeys(prfSecond: Uint8Array | null): void {
  if (!prfSecond) return;
  try {
    if (keys) wipe(keys.x25519Secret, keys.cacheKey);
    keys = deriveKeys(prfSecond);
  } finally {
    wipe(prfSecond);
  }
}

async function finishUnlock(credentialId: string, prev: StoredAccount | null): Promise<{ isNew: boolean; switched: boolean }> {
  const address = account!.address as `0x${string}`;
  const switched = !!prev && prev.address.toLowerCase() !== address.toLowerCase();
  const stored: StoredAccount = {
    v: 1,
    address,
    credentialId,
    x25519Public: keys ? toHex(keys.x25519Public) : switched ? undefined : prev?.x25519Public,
    fingerprint: keys ? keys.fingerprint : switched ? undefined : prev?.fingerprint,
    profile: switched ? undefined : prev?.profile,
    createdAt: switched || !prev ? Date.now() : prev.createdAt,
    keyRegistered: switched ? false : prev?.keyRegistered,
  };
  await storage.saveAccount(stored);
  identity.set({
    status: "unlocked",
    address,
    credentialId,
    profile: stored.profile,
    fingerprint: stored.fingerprint,
    x25519Public: stored.x25519Public,
    keysPending: !keys,
    keyRegistered: stored.keyRegistered,
  });
  return { isNew: !prev || switched, switched };
}

const rp = () => ({ id: config.rpId, name: "Plans" });

/** App start: read stored metadata (no prompt). */
export async function loadIdentity(): Promise<void> {
  const a = await storage.loadAccount();
  if (!a) {
    identity.set({ status: "none", keysPending: false });
    return;
  }
  identity.set({
    status: "locked",
    address: a.address,
    credentialId: a.credentialId,
    profile: a.profile,
    fingerprint: a.fingerprint,
    x25519Public: a.x25519Public,
    keysPending: false,
    keyRegistered: a.keyRegistered,
  });
}

/** "I already use Plans": the system picker lists every Plans passkey (incl. other devices). */
export async function restoreWithPasskey(): Promise<{ isNew: boolean }> {
  const prev = await storage.loadAccount();
  try {
    const r = await getPasskeyPrfOutput({ rpId: config.rpId, webAuthnClient: createDualPrfClient() });
    openSession(r.prfOutput);
    applyKeys(takeSecondOutput());
    return finishUnlock(r.credentialId, prev);
  } catch (e) {
    clearSecondOutput();
    throw classifyPasskeyError(e);
  }
}

/** Unlock the stored account: pinned to its credential, so the sheet goes straight to the fingerprint. */
export async function unlockStored(): Promise<void> {
  const prev = await storage.loadAccount();
  if (!prev) throw new PasskeyError("no-credentials", "no stored account");
  try {
    const r = await getPasskeyPrfOutput({
      rpId: config.rpId,
      credential: { credentialId: prev.credentialId },
      webAuthnClient: createDualPrfClient(),
    });
    openSession(r.prfOutput);
    applyKeys(takeSecondOutput());
    await finishUnlock(r.credentialId, prev);
  } catch (e) {
    clearSecondOutput();
    throw classifyPasskeyError(e);
  }
}

/**
 * "Create account": first look for a Plans passkey already on this phone (no UI when there is
 * none), so nobody makes a second account by accident; only then create a new passkey.
 * Returns `restored: true` when an existing passkey answered instead.
 */
export async function createOrRestore(displayName: string): Promise<{ restored: boolean; isNew: boolean }> {
  const prev = await storage.loadAccount();
  try {
    const r = await getPasskeyPrfOutput({ rpId: config.rpId, webAuthnClient: createDualPrfClient({ immediate: true }) });
    openSession(r.prfOutput);
    applyKeys(takeSecondOutput());
    const f = await finishUnlock(r.credentialId, prev);
    return { restored: true, isNew: f.isNew };
  } catch (e) {
    clearSecondOutput();
    const c = classifyPasskeyError(e);
    // A cancelled sheet means the person saw an existing passkey and backed out: stop there.
    // Anything else (none on this phone, provider without the "immediate" option) → create.
    if (c.kind === "cancelled" || c.kind === "domain-not-verified") throw c;
  }
  try {
    const created = await createPasskeyWithPrfOutput({
      rp: rp(),
      user: { name: displayName || "Plans", displayName: displayName || "Plans account" },
      webAuthnClient: createDualPrfClient(),
    });
    openSession(created.prfOutput);
    applyKeys(takeSecondOutput());
    const f = await finishUnlock(created.credentialId, prev);
    return { restored: false, isNew: f.isNew };
  } catch (e) {
    clearSecondOutput();
    throw classifyPasskeyError(e);
  }
}

/** Fallback when the provider gave no `second` output: one ceremony for the keys salt alone. */
export async function unlockKeysSeparately(): Promise<void> {
  const st = identity.get();
  if (!st.credentialId) throw new LockedError();
  try {
    const r = await getPasskeyPrfOutput({
      rpId: config.rpId,
      credential: { credentialId: st.credentialId },
      prfSalt: KEYS_PRF_SALT,
      webAuthnClient: createDualPrfClient({ secondSalt: null }),
    });
    applyKeys(r.prfOutput);
    const prev = await storage.loadAccount();
    if (prev && keys) {
      await storage.saveAccount({ ...prev, x25519Public: toHex(keys.x25519Public), fingerprint: keys.fingerprint });
    }
    identity.patch({ keysPending: false, fingerprint: keys?.fingerprint, x25519Public: keys ? toHex(keys.x25519Public) : undefined });
  } catch (e) {
    throw classifyPasskeyError(e);
  }
}

export async function saveProfile(p: Profile): Promise<void> {
  const prev = await storage.loadAccount();
  if (!prev) return;
  await storage.saveAccount({ ...prev, profile: p });
  identity.patch({ profile: p });
}

export async function markKeyRegistered(): Promise<void> {
  const prev = await storage.loadAccount();
  if (!prev) return;
  await storage.saveAccount({ ...prev, keyRegistered: true });
  identity.patch({ keyRegistered: true });
}

/** Ends the signing session and wipes keys; the stored account stays (locked). */
export function lock(): void {
  session?.end();
  session = null;
  account = null;
  if (keys) wipe(keys.x25519Secret, keys.cacheKey);
  keys = null;
  const st = identity.get();
  if (st.status === "unlocked") identity.patch({ status: "locked", keysPending: false });
}

const signOutHooks = new Set<() => void>();
/** Registers cleanup to run on sign out (used by modules that hold per-account memory). */
export function onSignOut(fn: () => void): void {
  signOutHooks.add(fn);
}

/** Sign out: lock and forget this phone's account metadata (the passkey itself stays). */
export async function signOut(): Promise<void> {
  lock();
  for (const f of signOutHooks) f();
  await storage.clearAccount();
  identity.set({ status: "none", keysPending: false });
}

export { lastCeremonyDiagnostics };
