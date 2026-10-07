"use client";

// QR code drawn in the browser from the `qrcode` package (no third-party QR service, no image request).
import { useMemo } from "react";
import QRCode from "qrcode";

export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const { path, n } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    let d = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) if (qr.modules.get(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    }
    return { path: d, n: count + 8 };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="block rounded-xl bg-white"
    >
      <path d={path} fill="#10231b" />
    </svg>
  );
}
