/**
 * A Mera WebAuthnClient around react-native-passkey that evaluates TWO PRF salts in one ceremony.
 *
 * Mera asks for one salt (`request.prfSalt`, the account namespace). We pass WebAuthn PRF
 * `eval: { first: request.prfSalt, second: KEYS_PRF_SALT }`. Mera receives `first` exactly as with
 * its own client; the `second` output (keys namespace "plans.keys.v1") is stashed here, in memory,
 * for the keys module to pick up with `takeSecondOutput()`. If the provider returns no `second`,
 * the app later asks for the keys salt alone in a separate ceremony ("Unlock receipts").
 *
 * Mirrors @category-labs/mera's react-native-webauthn-client-internal.ts (0.2.0), which is not
 * exported from the package.
 */
import type { WebAuthnClient } from "@category-labs/mera";
import { Passkey } from "./passkeyBridge";
import { fromBase64Url, toBase64Url } from "../crypto/bytes";
import { KEYS_PRF_SALT } from "../crypto/keys";

type CeremonyKind = "create" | "get";

export type CeremonyDiagnostics = {
  kind: CeremonyKind;
  at: number;
  requestedSecond: boolean;
  gotFirst: boolean;
  gotSecond: boolean;
  prfEnabled?: boolean;
  credentialId?: string;
  authenticatorAttachment?: string;
  aaguid?: string;
  transports?: string[];
  extensionKeys?: string[];
  error?: string;
};

type PrfValue = string | ArrayLike<number> | Record<string, number> | undefined;

let stashedSecond: Uint8Array | null = null;
let lastDiagnostics: CeremonyDiagnostics | null = null;
const history: CeremonyDiagnostics[] = [];

function record(d: CeremonyDiagnostics): void {
  lastDiagnostics = d;
  history.push(d);
  if (history.length > 20) history.shift();
}

/** Ceremonies started at or after `since` (ms), oldest first. */
export function ceremoniesSince(since: number): CeremonyDiagnostics[] {
  return history.filter((d) => d.at >= since);
}

/** Returns and clears the `second` PRF output of the most recent ceremony (keys namespace). */
export function takeSecondOutput(): Uint8Array | null {
  const s = stashedSecond;
  stashedSecond = null;
  return s;
}

export function clearSecondOutput(): void {
  stashedSecond?.fill(0);
  stashedSecond = null;
}

export function lastCeremonyDiagnostics(): CeremonyDiagnostics | null {
  return lastDiagnostics;
}

function decodeB64(value: string): Uint8Array {
  return fromBase64Url(value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
}

function readPrf(value: PrfValue): Uint8Array | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return decodeB64(value);
  if (Array.isArray(value) || ArrayBuffer.isView(value as unknown as ArrayBufferView)) return new Uint8Array(value as ArrayLike<number>);
  const entries = Object.entries(value as Record<string, number>).filter(([k]) => /^\d+$/.test(k));
  if (entries.length === 0) return undefined;
  return new Uint8Array(entries.sort(([a], [b]) => Number(a) - Number(b)).map(([, v]) => v));
}

function aaguidFromAuthData(authData?: string): string | undefined {
  if (!authData) return undefined;
  try {
    const b = decodeB64(authData);
    // rpIdHash(32) flags(1) signCount(4) then attestedCredentialData: aaguid(16)
    if (b.length < 53 || (b[32] & 0x40) === 0) return undefined;
    const h = Array.from(b.slice(37, 53), (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } catch {
    return undefined;
  }
}

const KNOWN_AAGUIDS: Record<string, string> = {
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "NordPass",
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
};

export function providerName(aaguid?: string): string | undefined {
  if (!aaguid) return undefined;
  if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(aaguid)) return "hidden by provider";
  return KNOWN_AAGUIDS[aaguid] ?? `unknown (${aaguid})`;
}

export type DualClientOptions = {
  /** Second PRF salt to request alongside Mera's; null asks for the first salt only. */
  secondSalt?: Uint8Array | null;
  /** Only offer passkeys already on this phone, without UI when there are none (Android flag). */
  immediate?: boolean;
  /** WebAuthn L3 client hints (web only), e.g. ["hybrid"] to lead with "use a phone or tablet". */
  hints?: string[];
};

export function createDualPrfClient(opts: DualClientOptions = {}): WebAuthnClient {
  const second = opts.secondSalt === undefined ? KEYS_PRF_SALT : opts.secondSalt;

  const prfEval = (first: Uint8Array) => ({
    prf: { eval: second ? { first: toBase64Url(first), second: toBase64Url(second) } : { first: toBase64Url(first) } },
  });

  return {
    async createCredential(request) {
      clearSecondOutput();
      const diag: CeremonyDiagnostics = { kind: "create", at: Date.now(), requestedSecond: !!second, gotFirst: false, gotSecond: false };
      record(diag);
      try {
        const created = await Passkey.createPlatformKey({
          rp: request.rp,
          user: { id: toBase64Url(request.user.id), name: request.user.name, displayName: request.user.displayName },
          challenge: toBase64Url(request.challenge),
          pubKeyCredParams: request.algorithms.map((alg) => ({ type: "public-key" as const, alg })),
          authenticatorSelection: {
            residentKey: request.residentKey,
            requireResidentKey: true,
            userVerification: request.userVerification,
          },
          attestation: request.attestation,
          extensions: prfEval(request.prfSalt) as never,
          ...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
          ...(opts.hints ? ({ hints: opts.hints } as object) : {}),
        });
        const ext = (created as { clientExtensionResults?: Record<string, unknown> }).clientExtensionResults ?? {};
        const prf = ext.prf as { enabled?: boolean; results?: { first?: PrfValue; second?: PrfValue } } | undefined;
        const first = readPrf(prf?.results?.first);
        const sec = readPrf(prf?.results?.second);
        const resp = (created as { response?: { transports?: string[]; authenticatorData?: string } }).response;
        diag.prfEnabled = prf?.enabled === true;
        diag.gotFirst = !!first;
        diag.gotSecond = !!sec;
        diag.extensionKeys = Object.keys(ext);
        diag.transports = resp?.transports;
        diag.aaguid = aaguidFromAuthData(resp?.authenticatorData);
        diag.authenticatorAttachment = (created as { authenticatorAttachment?: string }).authenticatorAttachment;
        const rawId = (created as { rawId?: string; id?: string }).rawId ?? (created as { id: string }).id;
        diag.credentialId = rawId;
        if (sec && sec.length === 32) stashedSecond = sec;
        return {
          credentialId: decodeB64(rawId),
          ...(resp?.transports ? { transports: resp.transports } : {}),
          prfEnabled: prf?.enabled === true,
          ...(first ? { prfOutput: first } : {}),
        };
      } catch (e) {
        diag.error = describeNativeError(e);
        throw e;
      }
    },

    async getCredential(request) {
      clearSecondOutput();
      const diag: CeremonyDiagnostics = { kind: "get", at: Date.now(), requestedSecond: !!second, gotFirst: false, gotSecond: false };
      record(diag);
      const { allowCredential } = request;
      const native = {
        rpId: request.rpId,
        challenge: toBase64Url(request.challenge),
        userVerification: request.userVerification,
        extensions: prfEval(request.prfSalt) as never,
        ...(allowCredential
          ? {
              allowCredentials: [
                {
                  type: "public-key" as const,
                  id: toBase64Url(allowCredential.credentialId),
                  ...(allowCredential.transports ? { transports: [...allowCredential.transports] as never } : {}),
                },
              ],
            }
          : {}),
        ...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
        ...(opts.hints ? { hints: opts.hints } : {}),
      };
      try {
        const asserted = opts.immediate ? await Passkey.getImmediate(native) : await Passkey.getPlatformKey(native);
        const ext = (asserted as { clientExtensionResults?: Record<string, unknown> }).clientExtensionResults ?? {};
        const prf = ext.prf as { results?: { first?: PrfValue; second?: PrfValue } } | undefined;
        const first = readPrf(prf?.results?.first);
        const sec = readPrf(prf?.results?.second);
        diag.gotFirst = !!first;
        diag.gotSecond = !!sec;
        diag.extensionKeys = Object.keys(ext);
        diag.authenticatorAttachment = (asserted as { authenticatorAttachment?: string }).authenticatorAttachment;
        const rawId = (asserted as { rawId?: string }).rawId ?? (asserted as { id: string }).id;
        diag.credentialId = rawId;
        if (sec && sec.length === 32) stashedSecond = sec;
        return { credentialId: decodeB64(rawId), ...(first ? { prfOutput: first } : {}) };
      } catch (e) {
        diag.error = describeNativeError(e);
        throw e;
      }
    },
  };
}

/** react-native-passkey rejects with { error, message } objects, not Error. */
export function nativeErrorCode(e: unknown): string | undefined {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const o = cur as { error?: unknown; code?: unknown; cause?: unknown };
    if (typeof o.error === "string") return o.error;
    if (typeof o.code === "string" && !["PASSKEY_OPERATION_FAILED", "PRF_UNAVAILABLE"].includes(o.code)) return o.code;
    cur = o.cause;
  }
  return undefined;
}

export function describeNativeError(e: unknown): string {
  const code = nativeErrorCode(e);
  const msg = (e as { message?: unknown })?.message;
  return [code, typeof msg === "string" ? msg : undefined].filter(Boolean).join(": ") || String(e);
}
