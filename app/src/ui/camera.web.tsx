/**
 * Web QR scanning with the same API the screens use from expo-camera:
 *   - CameraView: a <video> from getUserMedia (back camera on phones), frames decoded with jsQR
 *     about 6 times a second, `onBarcodeScanned({ data })` on each code. No motion.
 *   - useCameraPermissions: [status, request] from the Permissions API / getUserMedia.
 *   - ScanFromPhoto: a file input ("Upload a photo") decoded with jsQR, for laptops without a camera.
 * Frames never leave the browser.
 */
import { decodeQrPixels } from "../lib/qr/decode";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { fonts } from "../theme/tokens";
import { Icon } from "./Icon";
import { Txt } from "./Text";

export type BarcodeScanningResult = { data: string; type: string };
type Perm = { granted: boolean; status: "granted" | "denied" | "undetermined"; canAskAgain: boolean; expires: "never" };

const perm = (status: Perm["status"]): Perm => ({ granted: status === "granted", status, canAskAgain: status !== "denied", expires: "never" });

function decodeImageData(d: ImageData): string | null {
  return decodeQrPixels(d.data, d.width, d.height);
}

/** Decodes the first QR code in an image file (exported for tests and the photo button). */
export async function decodeQrFromFile(file: Blob): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return decodeImageData(ctx.getImageData(0, 0, w, h));
}

export function useCameraPermissions(): [Perm | null, () => Promise<Perm>] {
  const [p, setP] = useState<Perm | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (alive) setP({ ...perm("denied"), canAskAgain: false });
        return;
      }
      try {
        const q = await navigator.permissions?.query({ name: "camera" as PermissionName });
        if (alive) setP(perm(q?.state === "granted" ? "granted" : q?.state === "denied" ? "denied" : "undetermined"));
      } catch {
        if (alive) setP(perm("undetermined"));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  const request = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      s.getTracks().forEach((t) => t.stop());
      const next = perm("granted");
      setP(next);
      return next;
    } catch {
      const next = { ...perm("denied"), canAskAgain: false };
      setP(next);
      return next;
    }
  }, []);
  return [p, request];
}

export function CameraView({
  style,
  onBarcodeScanned,
  testID,
}: {
  style?: StyleProp<ViewStyle>;
  facing?: "back" | "front";
  enableTorch?: boolean;
  barcodeScannerSettings?: { barcodeTypes: string[] };
  onBarcodeScanned?: (r: BarcodeScanningResult) => void;
  testID?: string;
}) {
  const host = useRef<View>(null);
  const cb = useRef(onBarcodeScanned);
  cb.current = onBarcodeScanned;
  useEffect(() => {
    const el = host.current as unknown as HTMLElement | null;
    if (!el) return;
    const video = document.createElement("video");
    video.setAttribute("playsinline", "true");
    video.muted = true;
    Object.assign(video.style, { width: "100%", height: "100%", objectFit: "cover", display: "block" });
    el.appendChild(video);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        timer = setInterval(() => {
          if (!ctx || !cb.current || video.readyState < 2 || !video.videoWidth) return;
          const scale = Math.min(1, 640 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const data = decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
          if (data) cb.current({ data, type: "qr" });
        }, 160);
      } catch {
        /* the screen shows its own "no camera" state through useCameraPermissions */
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      video.remove();
    };
  }, []);
  return <View ref={host} style={[{ overflow: "hidden", backgroundColor: "#0B0F0D" }, style]} testID={testID} />;
}

/** "Upload a photo": reads a Plans code from a picture of it. */
export function ScanFromPhoto({ onScan, onNone, dark, testID = "btn-scan-photo" }: { onScan: (data: string) => void; onNone?: () => void; dark?: boolean; testID?: string }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = "image/*";
    i.style.display = "none";
    i.setAttribute("data-testid", `${testID}-input`);
    i.onchange = async () => {
      const f = i.files?.[0];
      i.value = "";
      if (!f) return;
      setBusy(true);
      try {
        const data = await decodeQrFromFile(f);
        if (data) onScan(data);
        else onNone?.();
      } catch {
        onNone?.();
      } finally {
        setBusy(false);
      }
    };
    document.body.appendChild(i);
    input.current = i;
    return () => i.remove();
  }, [onScan, onNone, testID]);
  const fg = dark ? "#FFFFFF" : undefined;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Upload a photo"
      onPress={() => input.current?.click()}
      style={({ pressed }) => ({
        height: 52,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        backgroundColor: dark ? "rgba(255,255,255,0.12)" : "transparent",
        borderWidth: dark ? 0 : 1.5,
        borderColor: "rgba(127,127,127,0.4)",
        opacity: pressed || busy ? 0.7 : 1,
      })}
    >
      <Icon name="camera" size={20} color={fg} />
      <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 16, color: fg }}>{busy ? "Reading the photo…" : "Upload a photo"}</Txt>
    </Pressable>
  );
}
