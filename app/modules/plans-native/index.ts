import { requireOptionalNativeModule } from "expo-modules-core";

export type DeviceInfo = {
  sdkInt: number;
  release: string;
  model: string;
  manufacturer: string;
  fingerprint: string;
  credentialService: string | null;
  credentialServicePrimary: string | null;
  autofillService: string | null;
  gmsVersion: string | null;
  isEmulator: boolean;
};

type PlansNativeModule = {
  logLine(tag: string, message: string): boolean;
  deviceInfo(): DeviceInfo;
};

const native = requireOptionalNativeModule<PlansNativeModule>("PlansNative");

/** Writes one line to logcat under `tag` (falls back to console when the native module is absent). */
export function logLine(tag: string, message: string): void {
  if (native) native.logLine(tag, message);
  else console.log(`[${tag}] ${message}`);
}

export function deviceInfo(): DeviceInfo | null {
  try {
    return native ? native.deviceInfo() : null;
  } catch {
    return null;
  }
}
