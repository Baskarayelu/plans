/**
 * PRF probe for the hidden Diagnostics screen (long-press the version in You).
 * One passkey ceremony asks for BOTH salts — Mera's account salt as `first`, sha256("plans.keys.v1")
 * as `second` — and reports what came back. Raw PRF outputs are never shown or logged; only their
 * sha256 fingerprints. The result is also written to logcat with tag PLANS_PRF:
 *
 *   adb logcat -s PLANS_PRF
 */
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput } from "@category-labs/mera";
import { sha256 } from "@noble/hashes/sha2.js";
import { Platform } from "react-native";
import { privateKeyToAddress } from "viem/accounts";
import { deviceInfo, logLine } from "../../../modules/plans-native";
import { config } from "../../config";
import { toHex, wipe } from "../crypto/bytes";
import { deriveAccountPrivateKey, deriveKeys } from "../crypto/keys";
import { ceremoniesSince, createDualPrfClient, describeNativeError, providerName, takeSecondOutput, type CeremonyDiagnostics } from "./webauthnClient";

export type ProbeResult = {
  mode: "get" | "create";
  ok: boolean;
  firstReturned: boolean;
  secondReturned: boolean;
  firstSha256?: string;
  secondSha256?: string;
  address?: string;
  x25519Fingerprint?: string;
  x25519Public?: string;
  credentialId?: string;
  provider?: string;
  aaguid?: string;
  ceremonies: CeremonyDiagnostics[];
  android: { sdk: number | string; release?: string; model?: string; credentialService?: string | null; autofillService?: string | null; gms?: string | null; emulator?: boolean };
  rpId: string;
  error?: string;
  at: string;
};

const fp = (b: Uint8Array) => toHex(sha256(b)).slice(0, 18);

export async function runPrfProbe(mode: "get" | "create"): Promise<ProbeResult> {
  const dev = deviceInfo();
  const result: ProbeResult = {
    mode,
    ok: false,
    firstReturned: false,
    secondReturned: false,
    ceremonies: [],
    android: {
      sdk: dev?.sdkInt ?? Platform.Version,
      release: dev?.release,
      model: dev ? `${dev.manufacturer} ${dev.model}` : undefined,
      credentialService: dev?.credentialService ?? dev?.credentialServicePrimary,
      autofillService: dev?.autofillService,
      gms: dev?.gmsVersion,
      emulator: dev?.isEmulator,
    },
    rpId: config.rpId,
    at: new Date().toISOString(),
  };
  const client = createDualPrfClient();
  const started = Date.now();
  try {
    let first: Uint8Array;
    let credentialId: string;
    if (mode === "create") {
      const r = await createPasskeyWithPrfOutput({
        rp: { id: config.rpId, name: "Plans" },
        user: { name: "Plans probe", displayName: `Plans probe ${new Date().toISOString().slice(0, 16)}` },
        webAuthnClient: client,
      });
      first = r.prfOutput;
      credentialId = r.credentialId;
    } else {
      const r = await getPasskeyPrfOutput({ rpId: config.rpId, webAuthnClient: client });
      first = r.prfOutput;
      credentialId = r.credentialId;
    }
    result.ceremonies = ceremoniesSince(started);
    const second = takeSecondOutput();
    result.firstReturned = true;
    result.firstSha256 = fp(first);
    result.credentialId = credentialId;
    const pk = deriveAccountPrivateKey(first);
    result.address = privateKeyToAddress(toHex(pk));
    wipe(pk, first);
    if (second) {
      result.secondReturned = true;
      result.secondSha256 = fp(second);
      const k = deriveKeys(second);
      result.x25519Fingerprint = k.fingerprint;
      result.x25519Public = toHex(k.x25519Public);
      wipe(k.x25519Secret, k.cacheKey, second);
    }
    result.ok = true;
  } catch (e) {
    result.ceremonies = ceremoniesSince(started);
    result.error = describeNativeError(e);
  }
  const create = result.ceremonies.find((c) => c.kind === "create");
  result.aaguid = create?.aaguid;
  result.provider = providerName(create?.aaguid) ?? result.android.credentialService ?? result.android.autofillService ?? undefined;
  logProbe(result);
  return result;
}

export function logProbe(r: ProbeResult): void {
  const line = [
    `mode=${r.mode}`,
    `ok=${r.ok}`,
    `first=${r.firstReturned ? "yes" : "no"}`,
    `second=${r.secondReturned ? "yes" : "no"}`,
    r.firstSha256 ? `firstSha=${r.firstSha256}` : "",
    r.secondSha256 ? `secondSha=${r.secondSha256}` : "",
    r.address ? `address=${r.address}` : "",
    r.x25519Fingerprint ? `keyFingerprint=${r.x25519Fingerprint}` : "",
    r.provider ? `provider=${JSON.stringify(r.provider)}` : "",
    `android=${r.android.release ?? r.android.sdk}/sdk${r.android.sdk}`,
    r.android.model ? `model=${JSON.stringify(r.android.model)}` : "",
    r.error ? `error=${JSON.stringify(r.error)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  logLine("PLANS_PRF", `PROBE ${line}`);
  logLine("PLANS_PRF", `PROBE_JSON ${JSON.stringify(r)}`);
}
