/**
 * The right-hand panel of the laptop layout (design 101, 108–118).
 *
 * A screen puts content in the panel by rendering <SidePanel kind=…>…</SidePanel> anywhere in its
 * tree. On phones and tablets SidePanel renders nothing unless `inline` is set (then its children
 * render in place), so the phone layout is untouched. Only the focused screen's panel is shown;
 * with none, the shell shows the default live panel (Needs you + Live across your plans).
 *
 *   kind "live"    the default panel content of a place (Home, Plan home). Wide only; hidden at laptop width.
 *   kind "form"    the check-and-confirm column of a form (Pay, Send). A column at laptop and wide.
 *   kind "detail"  something opened from the page (a spend, a request). A column at wide; at laptop it
 *                  covers the right of the main column and closes with Esc or ×.
 */
import { useIsFocused } from "expo-router";
import React, { useEffect, useId, useLayoutEffect } from "react";
import { Platform } from "react-native";
import { createStore, useStore } from "../../lib/state/observable";
import { useLayout } from "./responsive";

export type PanelKind = "live" | "detail" | "form";

export type PanelEntry = {
  id: string;
  kind: PanelKind;
  node: React.ReactNode;
  onClose?: () => void;
  /** Panel padding; false lets the content draw edge to edge. */
  pad: boolean;
  seq: number;
};

export const panelStore = createStore<PanelEntry[]>([]);
let seq = 0;

const useIso = Platform.OS === "web" ? useLayoutEffect : useEffect;

export function SidePanel({
  kind = "detail",
  children,
  onClose,
  inline,
  pad = true,
}: {
  kind?: PanelKind;
  children: React.ReactNode;
  onClose?: () => void;
  /** Render the children in place on phones and tablets. */
  inline?: boolean;
  pad?: boolean;
}) {
  const { desk } = useLayout();
  const focused = useIsFocused();
  const id = useId();
  const active = desk && focused;

  // Publish on every render so the panel shows the screen's current state.
  useIso(() => {
    if (!active) return;
    panelStore.set((prev) => {
      const old = prev.find((e) => e.id === id);
      const entry: PanelEntry = { id, kind, node: children, onClose, pad, seq: old?.seq ?? ++seq };
      return old ? prev.map((e) => (e.id === id ? entry : e)) : [...prev, entry];
    });
  });
  useIso(() => {
    if (!active) return;
    return () => panelStore.set((prev) => prev.filter((e) => e.id !== id));
  }, [active, id]);

  if (!desk && inline) return <>{children}</>;
  return null;
}

/** The entry the shell shows: the newest detail, else the newest form, else the newest live panel. */
export function pickPanel(entries: PanelEntry[]): PanelEntry | undefined {
  const by = (k: PanelKind) => entries.filter((e) => e.kind === k).sort((a, b) => b.seq - a.seq)[0];
  return by("detail") ?? by("form") ?? by("live");
}

export function usePanelEntry(): PanelEntry | undefined {
  return useStore(panelStore, pickPanel);
}

/** True when this screen is shown in the laptop shell (rail + main + panel). */
export function useDesk(): boolean {
  return useLayout().desk;
}
