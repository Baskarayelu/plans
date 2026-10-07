/**
 * Responsive layout modes for the web app (design 101). Android is always "phone".
 *
 *   phone   < 760 px      the approved phone screens 01–60, unchanged (tab bar)
 *   tablet  760–1023 px   the phone layout at full width (tab bar); detail panels open as sheets
 *   laptop  1024–1439 px  72 px icon rail · main · panel (form panels in a column, detail panels over the main column)
 *   wide    ≥ 1440 px     248 px rail · main · 400 px panel
 *
 * `useLayout()` is the single source of truth; `PHONE_MAX`, `TABLET_MAX`, `LAPTOP_MAX` are exported
 * for tests and docs.
 */
import { Platform, useWindowDimensions } from "react-native";

export type LayoutMode = "phone" | "tablet" | "laptop" | "wide";

export const PHONE_MAX = 759;
export const TABLET_MAX = 1023;
export const LAPTOP_MAX = 1439;

export const RAIL_WIDE = 248;
export const RAIL_ICONS = 72;
export const PANEL_WIDE = 400;
export const PANEL_LAPTOP = 360;

export function modeForWidth(width: number, os: string = Platform.OS): LayoutMode {
  if (os !== "web") return "phone";
  if (width <= PHONE_MAX) return "phone";
  if (width <= TABLET_MAX) return "tablet";
  if (width <= LAPTOP_MAX) return "laptop";
  return "wide";
}

export type Layout = {
  mode: LayoutMode;
  width: number;
  /** Laptop or wide: the rail/main/panel shell is on. */
  desk: boolean;
  /** Running in a browser (any width). */
  web: boolean;
};

export function useLayout(): Layout {
  const { width } = useWindowDimensions();
  const mode = modeForWidth(width);
  return { mode, width, desk: mode === "laptop" || mode === "wide", web: Platform.OS === "web" };
}

/** "Confirm with passkey" on computers (they may use a face, PIN or phone); "Confirm with fingerprint" on phones (design 110). */
export function useConfirmLabel(): string {
  const { desk, mode } = useLayout();
  return desk || mode === "tablet" ? "Confirm with passkey" : "Confirm with fingerprint";
}

export function confirmLabelFor(mode: LayoutMode): string {
  return mode === "phone" ? "Confirm with fingerprint" : "Confirm with passkey";
}
