/**
 * Web version of the share-card image (design 136): the on-screen card is drawn to a canvas in
 * the browser (html2canvas, the renderer react-native-view-shot uses on the web) at its real
 * pixel size, then shared with the Web Share API (image + link) when the browser can share
 * files, or downloaded with the link copied to the clipboard. Nothing is uploaded anywhere.
 */
import type { View } from "react-native";

export type CardShape = "story" | "wide";
export const CARD_PX: Record<CardShape, { width: number; height: number }> = {
  story: { width: 1080, height: 1350 },
  wide: { width: 1200, height: 630 },
};

const blobs = new Map<string, Blob>();

/** Renders the card's DOM node to a PNG; returns a blob: URL. */
export async function captureCard(ref: React.RefObject<View | null>, shape: CardShape): Promise<string> {
  const node = ref.current as unknown as HTMLElement | null;
  if (!node) throw new Error("The card isn't ready yet");
  const { width } = CARD_PX[shape];
  const html2canvas = (await import("html2canvas")).default;
  const rect = node.getBoundingClientRect();
  const canvas = await html2canvas(node, { backgroundColor: null, scale: rect.width > 0 ? width / rect.width : 1, logging: false, useCORS: true });
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No image"))), "image/png"));
  const url = URL.createObjectURL(blob);
  blobs.set(url, blob);
  return url;
}

function download(url: string, name: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Web Share with the image and text; otherwise download the image and copy the text. */
export async function shareCard(uri: string, text: string, title: string): Promise<void> {
  const blob = blobs.get(uri);
  const nav = globalThis.navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (blob && typeof nav.share === "function") {
    const file = new File([blob], "plans-settled.png", { type: "image/png" });
    const data: ShareData = { files: [file], text, title };
    if (!nav.canShare || nav.canShare(data)) {
      try {
        await nav.share(data);
        return;
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
      }
    }
  }
  download(uri, "plans-settled.png");
  try {
    await nav.clipboard?.writeText(text);
  } catch {
    /* ignore */
  }
}

/** Downloads the image (browsers save to Downloads). */
export async function saveCard(uri: string, name: string): Promise<"saved" | "shared"> {
  download(uri, `${name}.png`);
  return "saved";
}
