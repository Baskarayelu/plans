/** QR decoding from RGBA pixels (web camera frames and uploaded photos). Pure JS (jsQR). */
import jsQR from "jsqr";

export function decodeQrPixels(rgba: Uint8ClampedArray, width: number, height: number): string | null {
  const r = jsQR(rgba, width, height, { inversionAttempts: "attemptBoth" });
  return r?.data ?? null;
}
