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
  type WebAuthnClient,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { LocalAccount } from "viem";
import { config } from "../../config";
import { concatBytes, equalBytes, fromBase64Url, randomBytes, toHex, utf8, wipe } from "../crypto/bytes";
import { deriveAccountPrivateKey, deriveKeys, KEYS_PRF_SALT, type PlansKeys } from "../crypto/keys";
import { fetchVaultBox } from "../link/browserLink";
import { devicesRootFrom, isRemovedVault } from "../link/devices";
import { LinkError, openVault, wipeBundle, type AccountBundle } from "../link/protocol";
import { SlotError } from "../link/slots";
import { createStore } from "../state/observable";
import { storage, type Profile, type StoredAccount } from "../state/storage";
import { guardAccount } from "./guard";
import * as passkeyBridge from "./passkeyBridge";
import {
  clearSecondOutput,
  createDualPrfClient,
  describeNativeError,
  lastCeremonyDiagnostics,
  nativeErrorCode,
  takeSecondOutput,
  type DualClientOptions,
} from "./webauthnClient";

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
/** The root of the account's device list key (lib/link/devices.ts), from the same PRF output as `keys`. Memory only. */
let devicesRoot: Uint8Array | null = null;

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
/** Root of the "Devices with your passkey" list key, while unlocked with keys (null otherwise). Don't keep it. */
export function currentDevicesRoot(): Uint8Array | null {
  return devicesRoot;
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

/**
 * A linked browser whose account can't be opened any more (docs/crypto.md §9.6, §9.9):
 *   "removed" its vault was overwritten by "Remove" on one of the account's devices (design 177/178)
 *   "gone"    no vault for this passkey (lost, or never saved): link this browser again (166)
 */
export class LinkedBrowserError extends PasskeyError {
  constructor(
    public reason: "removed" | "gone",
    detail: string,
  ) {
    super("failed", detail);
  }
}

export const isLinkedBrowserError = (e: unknown): e is LinkedBrowserError => e instanceof LinkedBrowserError;

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

/** Opens the Mera signing session from an account private key, then wipes the key. */
function openSessionFromKey(pk: Uint8Array): void {
  try {
    session?.end();
    session = createSecp256k1SigningSession({ privateKey: pk });
    // Every signature first runs the before-sensitive check (a removed linked browser locks instead).
    account = guardAccount(toViemAccount(session) as unknown as LocalAccount);
  } finally {
    wipe(pk);
  }
}

function openSession(prfFirst: Uint8Array): void {
  try {
    openSessionFromKey(deriveAccountPrivateKey(prfFirst));
  } finally {
    wipe(prfFirst);
  }
}

function applyKeys(prfSecond: Uint8Array | null): void {
  if (!prfSecond) return;
  try {
    if (keys) wipe(keys.x25519Secret, keys.cacheKey);
    keys = deriveKeys(prfSecond);
    if (devicesRoot) wipe(devicesRoot);
    devicesRoot = devicesRootFrom(prfSecond);
  } finally {
    wipe(prfSecond);
  }
}

async function finishUnlock(
  credentialId: string,
  prev: StoredAccount | null,
  extra: { vault?: boolean; profile?: Profile } = {},
): Promise<{ isNew: boolean; switched: boolean }> {
  const address = account!.address as `0x${string}`;
  const switched = !!prev && prev.address.toLowerCase() !== address.toLowerCase();
  const stored: StoredAccount = {
    v: 1,
    address,
    credentialId,
    x25519Public: keys ? toHex(keys.x25519Public) : switched ? undefined : prev?.x25519Public,
    fingerprint: keys ? keys.fingerprint : switched ? undefined : prev?.fingerprint,
    profile: (switched ? undefined : prev?.profile) ?? extra.profile,
    createdAt: switched || !prev ? Date.now() : prev.createdAt,
    keyRegistered: switched ? false : prev?.keyRegistered,
    ...(extra.vault ? { vault: true } : {}),
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
  // A remount of the root layout (web history navigation, fast refresh) must not lock an open session.
  if (identity.get().status === "unlocked" && account) return;
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

// ─────────────── linked browsers (docs/crypto.md §9) ───────────────

/**
 * A browser's own link passkey carries a recognisable user handle (web only can read it back):
 * UTF-8("plans-link/v1:") ‖ 18 random bytes. It lets a discoverable sign-in that picked a link
 * passkey whose vault is gone fail loudly instead of opening a different, empty account.
 */
const LINK_HANDLE_PREFIX = utf8("plans-link/v1:");

function linkHandle(): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(32);
  out.set(concatBytes(LINK_HANDLE_PREFIX, randomBytes(32 - LINK_HANDLE_PREFIX.length)));
  return out;
}

/** The userHandle of the last assertion, where the transport exposes it (the web bridge does). */
function takeAssertionUserHandle(): Uint8Array | null {
  const take = (passkeyBridge as unknown as { takeLastUserHandle?: () => string | undefined }).takeLastUserHandle;
  const h = typeof take === "function" ? take() : undefined;
  if (!h) return null;
  try {
    return fromBase64Url(h);
  } catch {
    return null;
  }
}

function isLinkHandle(h: Uint8Array | null): boolean {
  return !!h && h.length >= LINK_HANDLE_PREFIX.length && equalBytes(h.slice(0, LINK_HANDLE_PREFIX.length), LINK_HANDLE_PREFIX);
}

function withUserHandle(base: WebAuthnClient, handle: Uint8Array<ArrayBuffer>): WebAuthnClient {
  return {
    createCredential: (req) => base.createCredential({ ...req, user: { ...req.user, id: handle } }),
    getCredential: (req) => base.getCredential(req),
  };
}

function vaultFailure(detail: string): PasskeyError {
  return new PasskeyError("failed", detail);
}

/** GET the vault ciphertext; a network problem is an error, never "no vault". */
async function lookupVault(credentialIdBytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    return await fetchVaultBox(credentialIdBytes);
  } catch (e) {
    const why = e instanceof SlotError ? `${e.kind} (${e.status} ${e.code})` : String(e);
    throw vaultFailure(`Couldn't check this passkey's linked account: ${why}`);
  }
}

function openVaultOrFail(b2: Uint8Array, credentialIdBytes: Uint8Array, box: Uint8Array): AccountBundle {
  try {
    return openVault(b2, credentialIdBytes, box);
  } catch (e) {
    const kind = e instanceof LinkError ? `${e.kind}: ${e.detail}` : String(e);
    throw vaultFailure(`This browser's linked account couldn't be opened (${kind}). Link this browser again from your phone.`);
  }
}

/** One ceremony pinned to `credentialId` asking for the keys salt alone (no `second` support). */
async function keysOnlyCeremony(credentialId: string): Promise<Uint8Array> {
  const r = await getPasskeyPrfOutput({
    rpId: config.rpId,
    credential: { credentialId },
    prfSalt: KEYS_PRF_SALT,
    webAuthnClient: createDualPrfClient({ secondSalt: null }),
  });
  return r.prfOutput;
}

/**
 * A fresh ceremony pinned to the stored credential, returning both PRF outputs (one prompt; a
 * second, keys-only prompt only when the provider ignores the `second` salt). The caller wipes
 * both. Errors are classified PasskeyErrors.
 */
export async function freshPrfOutputs(credentialId: string): Promise<{ credentialId: string; first: Uint8Array; second: Uint8Array }> {
  try {
    const r = await getPasskeyPrfOutput({ rpId: config.rpId, credential: { credentialId }, webAuthnClient: createDualPrfClient() });
    const second = takeSecondOutput() ?? (await keysOnlyCeremony(r.credentialId));
    return { credentialId: r.credentialId, first: r.prfOutput, second };
  } catch (e) {
    clearSecondOutput();
    throw classifyPasskeyError(e);
  }
}

/**
 * Opens the session from an account bundle (a linked browser): the Mera session from the account
 * private key, the Plans keys from `k`, and saves the StoredAccount with THIS browser's credential
 * id and `vault: true`. Consumes the bundle (its key bytes are wiped). The vault must already be
 * saved (browserLink's wait() does it when given b2) or the next unlock can't find the account.
 */
export async function openFromBundle(
  bundle: AccountBundle,
  credentialId: string,
  opts: { vault?: boolean } = {},
): Promise<{ isNew: boolean; switched: boolean }> {
  const prev = await storage.loadAccount();
  try {
    const keysIkm = new Uint8Array(bundle.keysIkm);
    openSessionFromKey(new Uint8Array(bundle.accountKey));
    applyKeys(keysIkm);
    if (account!.address.toLowerCase() !== bundle.address.toLowerCase()) {
      lock();
      throw new PasskeyError("failed", "The linked account doesn't match its own key.");
    }
    if (keys && keys.fingerprint !== bundle.fingerprint) {
      lock();
      throw new PasskeyError("failed", "The linked account's keys don't match.");
    }
    return await finishUnlock(credentialId, prev, { vault: opts.vault ?? true, profile: bundle.profile });
  } finally {
    wipeBundle(bundle);
  }
}

/**
 * The discoverable sign-in shared by restore and findExistingAccount. After the ceremony the vault
 * for the returned credential is always looked up: found → the linked account; not found → the
 * account from PRF first. A failed lookup (not a 404) throws instead of falling back.
 */
export type SignInOptions = {
  hints?: string[];
  /**
   * Refuse an answer without the keys-namespace PRF output instead of opening the account half-way
   * (design 176a: "the person isn't let in half-way"). `true` always; "cross-device" only when the
   * passkey came from another device over the browser's QR ("Use a phone or tablet"), where a
   * second, keys-only ceremony would mean scanning again.
   */
  requireKeys?: boolean | "cross-device";
};

async function discoverableSignIn(opts: SignInOptions = {}): Promise<{ isNew: boolean; linked: boolean }> {
  const prev = await storage.loadAccount();
  let r: Awaited<ReturnType<typeof getPasskeyPrfOutput>>;
  let second: Uint8Array | null;
  try {
    r = await getPasskeyPrfOutput({ rpId: config.rpId, webAuthnClient: createDualPrfClient(opts.hints ? { hints: opts.hints } : {}) });
    second = takeSecondOutput();
  } catch (e) {
    clearSecondOutput();
    throw classifyPasskeyError(e);
  }
  const handle = takeAssertionUserHandle();
  const first = r.prfOutput;
  try {
    // NEEDS A REAL-DEVICE TEST (lead's decision 4): whether Chrome and Safari on macOS / Windows hand
    // back PRF results when the passkey lives on an Android phone reached through the browser's QR
    // (hybrid). The CDP virtual authenticator can't model hybrid. When the answer has no keys output
    // we stop here (nothing saved) and the choice screen offers "Link with a code" (176a).
    const crossDevice = lastCeremonyDiagnostics()?.authenticatorAttachment === "cross-platform";
    if (!second && (opts.requireKeys === true || (opts.requireKeys === "cross-device" && crossDevice))) {
      throw new PasskeyError("prf-unavailable", "The passkey answered without the keys output Plans needs in this browser.");
    }
    const credIdBytes = fromBase64Url(r.credentialId);
    const box = await lookupVault(credIdBytes);
    if (box && isRemovedVault(box)) throw new LinkedBrowserError("removed", "This browser was removed from the account.");
    if (box) {
      wipe(first);
      let b2: Uint8Array;
      if (second) b2 = second;
      else {
        try {
          b2 = second = await keysOnlyCeremony(r.credentialId);
        } catch (e) {
          throw classifyPasskeyError(e);
        }
      }
      const bundle = openVaultOrFail(b2, credIdBytes, box);
      const f = await openFromBundle(bundle, r.credentialId);
      return { isNew: f.isNew, linked: true };
    }
    if (isLinkHandle(handle)) {
      throw new LinkedBrowserError("gone", "This browser passkey was made for linking, and its linked account is no longer stored. Link this browser again from your phone.");
    }
    openSession(first);
    applyKeys(second);
    second = null;
    const f = await finishUnlock(r.credentialId, prev);
    return { isNew: f.isNew, linked: false };
  } finally {
    wipe(first, second);
  }
}

/** "I already use Plans": the system picker lists every Plans passkey (incl. other devices). Vault-aware. */
export async function restoreWithPasskey(opts: SignInOptions = {}): Promise<{ isNew: boolean; linked: boolean }> {
  return discoverableSignIn(opts);
}

/**
 * Web create flow, step 1: a discoverable sign-in with UI (no allowCredentials), e.g. hints
 * ["hybrid"] to lead with "use a phone". Resolves when an existing account answered; throws a
 * classified PasskeyError otherwise ("cancelled", "no-credentials", and "prf-unavailable" when
 * the phone's passkey gave no PRF over hybrid, which is when the UI should offer linking).
 */
export async function findExistingAccount(opts: SignInOptions = {}): Promise<{ kind: "restored"; isNew: boolean; linked: boolean }> {
  const r = await discoverableSignIn(opts);
  return { kind: "restored", ...r };
}

/** Unlock the stored account: pinned to its credential, so the sheet goes straight to the fingerprint. */
export async function unlockStored(): Promise<void> {
  const prev = await storage.loadAccount();
  if (!prev) throw new PasskeyError("no-credentials", "no stored account");
  if (prev.vault) return unlockVault(prev);
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
 * Linked browser: the vault is fetched first (no prompt if it's gone or offline), then one
 * ceremony pinned to the browser's passkey gives b2 (a keys-only second prompt only if the
 * provider ignores the `second` salt; the PRF first output is not used), and the account opens
 * from the decrypted bundle.
 */
async function unlockVault(prev: StoredAccount): Promise<void> {
  const credIdBytes = fromBase64Url(prev.credentialId);
  const box = await lookupVault(credIdBytes);
  if (!box) throw new LinkedBrowserError("gone", "This browser's linked account is no longer stored. Link this browser again from your phone.");
  if (isRemovedVault(box)) throw new LinkedBrowserError("removed", "This browser was removed from the account.");
  const out = await freshPrfOutputs(prev.credentialId);
  wipe(out.first);
  try {
    const bundle = openVaultOrFail(out.second, credIdBytes, box);
    await openFromBundle(bundle, out.credentialId);
  } finally {
    wipe(out.second);
  }
}

/** Create a new passkey and account (no lookup first). Web step 2 when nothing was found. */
export async function createNewAccount(displayName: string): Promise<{ isNew: boolean }> {
  const prev = await storage.loadAccount();
  try {
    const created = await createPasskeyWithPrfOutput({
      rp: rp(),
      user: { name: displayName || "Plans", displayName: displayName || "Plans account" },
      webAuthnClient: createDualPrfClient(),
    });
    openSession(created.prfOutput);
    applyKeys(takeSecondOutput());
    const f = await finishUnlock(created.credentialId, prev);
    return { isNew: f.isNew };
  } catch (e) {
    clearSecondOutput();
    throw classifyPasskeyError(e);
  }
}

/**
 * Create this browser's own passkey for linking (dual salt). Returns its credential id and the
 * keys-namespace output b2 WITHOUT opening any session; the caller passes them to
 * startBrowserLink and then openFromBundle, and wipes b2. If create gives no `second` output, one
 * get pinned to the new passkey asks for both salts. The passkey's user handle is marked as a
 * link passkey (see LINK_HANDLE_PREFIX).
 */
export async function createLinkPasskey(
  displayName: string,
  opts: Pick<DualClientOptions, "hints"> = {},
): Promise<{ credentialId: string; credentialIdBytes: Uint8Array; b2: Uint8Array }> {
  try {
    const created = await createPasskeyWithPrfOutput({
      rp: rp(),
      user: { name: displayName || "Plans", displayName: displayName || "Plans account" },
      webAuthnClient: withUserHandle(createDualPrfClient(opts.hints ? { hints: opts.hints } : {}), linkHandle()),
    });
    wipe(created.prfOutput);
    let b2 = takeSecondOutput();
    if (!b2) {
      const r = await getPasskeyPrfOutput({ rpId: config.rpId, credential: { credentialId: created.credentialId }, webAuthnClient: createDualPrfClient() });
      wipe(r.prfOutput);
      b2 = takeSecondOutput();
    }
    if (!b2) throw new PasskeyError("prf-unavailable", "This passkey provider returned no keys output.");
    return { credentialId: created.credentialId, credentialIdBytes: fromBase64Url(created.credentialId), b2 };
  } catch (e) {
    clearSecondOutput();
    throw classifyPasskeyError(e);
  }
}

/**
 * Android "Create account": first look for a Plans passkey already on this phone (no UI when there
 * is none), so nobody makes a second account by accident; only then create a new passkey.
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
  const f = await createNewAccount(displayName);
  return { restored: false, isNew: f.isNew };
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
  if (devicesRoot) wipe(devicesRoot);
  devicesRoot = null;
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
