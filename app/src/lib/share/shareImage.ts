/**
 * Turns the on-screen share card into a PNG and hands it to Android (design 136).
 * The card is drawn on the phone with react-native-view-shot; nothing is uploaded anywhere.
 */
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { saveImageToPictures, shareImageWithText } from "../../../modules/plans-native";

export type CardShape = "story" | "wide";
export const CARD_PX: Record<CardShape, { width: number; height: number }> = {
  story: { width: 1080, height: 1350 },
  wide: { width: 1200, height: 630 },
};

/** Renders the card view to a PNG file at its real size; returns a file:// URI. */
export async function captureCard(ref: React.RefObject<View | null>, shape: CardShape): Promise<string> {
  if (!ref.current) throw new Error("The card isn't ready yet");
  const { width, height } = CARD_PX[shape];
  return captureRef(ref, { format: "png", quality: 1, result: "tmpfile", width, height, fileName: `plans-settled-${shape}` });
}

/** Share sheet with the image and the link. Falls back to the image alone on builds without the helper. */
export async function shareCard(uri: string, text: string, title: string): Promise<void> {
  try {
    const contentUri = new File(uri).contentUri;
    if (contentUri && (await shareImageWithText(contentUri, text, title))) return;
  } catch {
    /* fall through to expo-sharing */
  }
  await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: title });
}

/** Saves the card to Pictures/Plans; "shared" when this phone needs the share sheet to save it. */
export async function saveCard(uri: string, name: string): Promise<"saved" | "shared"> {
  try {
    if (await saveImageToPictures(uri, `${name}.png`)) return "saved";
  } catch {
    /* fall through */
  }
  await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Save image" });
  return "shared";
}
