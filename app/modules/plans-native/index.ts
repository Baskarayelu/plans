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
  shareImage?(contentUri: string, text: string, title: string): Promise<boolean>;
  saveImage?(path: string, name: string): Promise<boolean>;
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

/**
 * Opens the Android share sheet with an image (a content:// URI) and a line of text.
 * Returns false when this build has no native helper, so the caller can fall back.
 */
export async function shareImageWithText(contentUri: string, text: string, title: string): Promise<boolean> {
  if (!native?.shareImage) return false;
  return native.shareImage(contentUri, text, title);
}

/** Saves a PNG file into Pictures/Plans. False when not possible here (old Android or old build). */
export async function saveImageToPictures(path: string, name: string): Promise<boolean> {
  if (!native?.saveImage) return false;
  return native.saveImage(path, name);
}
