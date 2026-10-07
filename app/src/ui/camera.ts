/**
 * Camera for scanning Plans codes. Android: expo-camera. Web: camera.web.tsx (getUserMedia + a
 * JS QR decoder, plus "Upload a photo" for computers without a camera).
 */
export { CameraView, useCameraPermissions } from "expo-camera";
export type { BarcodeScanningResult } from "expo-camera";

/** Web only: a button that reads a Plans code from a photo. Nothing on Android (the camera is always there). */
export function ScanFromPhoto(_props: { onScan: (data: string) => void; onNone?: () => void; dark?: boolean; testID?: string }): null {
  return null;
}
