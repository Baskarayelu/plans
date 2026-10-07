/**
 * Browser passkey transport with react-native-passkey's shapes (base64url strings in, the
 * WebAuthn JSON form out), so `webauthnClient.ts` (the dual-PRF Mera client) is the same file on
 * Android and on the web. It mirrors Mera's own browser client (`browserWebAuthnClient`, which
 * calls navigator.credentials) and adds the `second` PRF salt: WebAuthn PRF
 * `eval: { first: <Mera's salt>, second: sha256("plans.keys.v1") }` in one ceremony.
 *
 * Errors are rejected as `{ error, message }` objects with react-native-passkey's codes so the
 * session's error mapping is shared: NotAllowedError/AbortError → UserCancelled (the browser uses
 * NotAllowedError for cancel, timeout and "no passkey"), SecurityError → BadConfiguration (wrong
 * origin for the rpId), NotSupportedError → NotSupported, InvalidStateError → InvalidState.
 */
import { fromBase64Url, toBase64Url } from "../crypto/bytes";
import { mark } from "../timing";

type B64 = string;
type PrfEvalJson = { first: B64; second?: B64 };

export type WebCreateRequest = {
  rp: { id: string; name: string };
  user: { id: B64; name: string; displayName: string };
  challenge: B64;
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  authenticatorSelection?: { residentKey?: string; requireResidentKey?: boolean; userVerification?: string; authenticatorAttachment?: string };
  attestation?: string;
  extensions?: { prf?: { eval?: PrfEvalJson } };
  timeout?: number;
  excludeCredentials?: { type: "public-key"; id: B64 }[];
  hints?: string[];
};

export type WebGetRequest = {
  rpId: string;
  challenge: B64;
  userVerification?: string;
  extensions?: { prf?: { eval?: PrfEvalJson } };
  allowCredentials?: { type: "public-key"; id: B64; transports?: string[] }[];
  timeout?: number;
  hints?: string[];
  mediation?: string;
};

const dec = (s: string): Uint8Array<ArrayBuffer> => {
  const b = fromBase64Url(s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  out.set(b);
  return out;
};
const enc = (b: ArrayBuffer | ArrayBufferView | null | undefined): string | undefined => {
  if (!b) return undefined;
  const u = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return toBase64Url(u);
};

function prfInput(e?: { prf?: { eval?: PrfEvalJson } }) {
  const ev = e?.prf?.eval;
  if (!ev) return undefined;
  return { prf: { eval: { first: dec(ev.first), ...(ev.second ? { second: dec(ev.second) } : {}) } } };
}

function prfOutput(cred: PublicKeyCredential): Record<string, unknown> {
  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer; second?: ArrayBuffer } } };
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(ext)) if (k !== "prf") out[k] = (ext as Record<string, unknown>)[k];
  if (ext.prf) {
    const r = ext.prf.results;
    out.prf = {
      ...(ext.prf.enabled !== undefined ? { enabled: ext.prf.enabled } : {}),
      ...(r ? { results: { ...(r.first ? { first: enc(r.first) } : {}), ...(r.second ? { second: enc(r.second) } : {}) } } : {}),
    };
  }
  return out;
}

export function webErrorCode(e: unknown): string {
  const name = (e as { name?: string })?.name;
  switch (name) {
    case "NotAllowedError":
    case "AbortError":
      return "UserCancelled";
    case "SecurityError":
      return "BadConfiguration";
    case "NotSupportedError":
      return "NotSupported";
    case "InvalidStateError":
      return "InvalidState";
    default:
      return "RequestFailed";
  }
}

function fail(e: unknown): never {
  throw { error: webErrorCode(e), message: (e as { message?: string })?.message ?? String(e), name: (e as { name?: string })?.name };
}

function creds(): CredentialsContainer {
  const c = globalThis.navigator?.credentials;
  if (!c || typeof globalThis.PublicKeyCredential === "undefined") throw { error: "NotSupported", message: "This browser has no passkeys (WebAuthn)." };
  return c;
}

export function isSupported(): boolean {
  return typeof globalThis.PublicKeyCredential !== "undefined" && !!globalThis.navigator?.credentials;
}

/** True when the browser says it can use a passkey on this computer (Touch ID, Windows Hello, screen lock). */
export async function hasPlatformAuthenticator(): Promise<boolean> {
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** The userHandle of the last assertion (base64url), for callers that need it. */
let lastUserHandle: string | undefined;
export function takeLastUserHandle(): string | undefined {
  const u = lastUserHandle;
  lastUserHandle = undefined;
  return u;
}

async function create(req: WebCreateRequest) {
  const c = creds();
  let cred: PublicKeyCredential | null;
  mark("passkey_start", { kind: "create" });
  try {
    cred = (await c.create({
      publicKey: {
        rp: req.rp,
        user: { id: dec(req.user.id), name: req.user.name, displayName: req.user.displayName },
        challenge: dec(req.challenge),
        pubKeyCredParams: req.pubKeyCredParams,
        ...(req.authenticatorSelection ? { authenticatorSelection: req.authenticatorSelection as AuthenticatorSelectionCriteria } : {}),
        ...(req.attestation ? { attestation: req.attestation as AttestationConveyancePreference } : {}),
        ...(req.timeout !== undefined ? { timeout: req.timeout } : {}),
        ...(req.excludeCredentials ? { excludeCredentials: req.excludeCredentials.map((x) => ({ type: x.type, id: dec(x.id) })) } : {}),
        ...(req.hints ? { hints: req.hints } : {}),
        extensions: prfInput(req.extensions) as AuthenticationExtensionsClientInputs,
      } as PublicKeyCredentialCreationOptions,
    })) as PublicKeyCredential | null;
  } catch (e) {
    mark("passkey_done", { kind: "create", ok: false, error: (e as { name?: string })?.name });
    fail(e);
  }
  if (!cred) fail({ name: "NotAllowedError", message: "No credential" });
  mark("passkey_done", { kind: "create", ok: true });
  const resp = cred.response as AuthenticatorAttestationResponse;
  const transports = typeof resp.getTransports === "function" ? resp.getTransports() : undefined;
  const authData = typeof resp.getAuthenticatorData === "function" ? enc(resp.getAuthenticatorData()) : undefined;
  return {
    id: cred.id,
    rawId: enc(cred.rawId)!,
    type: "public-key",
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    response: { clientDataJSON: enc(resp.clientDataJSON), attestationObject: enc(resp.attestationObject), transports, authenticatorData: authData },
    clientExtensionResults: prfOutput(cred),
  };
}

async function get(req: WebGetRequest) {
  const c = creds();
  let cred: PublicKeyCredential | null;
  mark("passkey_start", { kind: "get", discoverable: !req.allowCredentials });
  try {
    cred = (await c.get({
      ...(req.mediation ? { mediation: req.mediation as CredentialMediationRequirement } : {}),
      publicKey: {
        rpId: req.rpId,
        challenge: dec(req.challenge),
        ...(req.userVerification ? { userVerification: req.userVerification as UserVerificationRequirement } : {}),
        ...(req.timeout !== undefined ? { timeout: req.timeout } : {}),
        ...(req.allowCredentials
          ? { allowCredentials: req.allowCredentials.map((x) => ({ type: x.type, id: dec(x.id), ...(x.transports ? { transports: x.transports as AuthenticatorTransport[] } : {}) })) }
          : {}),
        ...(req.hints ? { hints: req.hints } : {}),
        extensions: prfInput(req.extensions) as AuthenticationExtensionsClientInputs,
      } as PublicKeyCredentialRequestOptions,
    })) as PublicKeyCredential | null;
  } catch (e) {
    mark("passkey_done", { kind: "get", ok: false, error: (e as { name?: string })?.name });
    fail(e);
  }
  if (!cred) fail({ name: "NotAllowedError", message: "No credential" });
  mark("passkey_done", { kind: "get", ok: true });
  const resp = cred.response as AuthenticatorAssertionResponse;
  lastUserHandle = enc(resp.userHandle);
  return {
    id: cred.id,
    rawId: enc(cred.rawId)!,
    type: "public-key",
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    response: { clientDataJSON: enc(resp.clientDataJSON), authenticatorData: enc(resp.authenticatorData), signature: enc(resp.signature), userHandle: lastUserHandle },
    clientExtensionResults: prfOutput(cred),
  };
}

export const Passkey = {
  isSupported,
  createPlatformKey: create,
  create,
  getPlatformKey: get,
  get,
  /** Browsers have no "immediately available" query that is safe to rely on yet: report none. */
  async getImmediate(_req: WebGetRequest): Promise<never> {
    throw { error: "NoCredentials", message: "Not available in browsers" };
  },
};
