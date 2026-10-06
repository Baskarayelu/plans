import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { storage } from "../lib/state/storage";
import { dark, light, type Palette } from "./tokens";

export type ThemeMode = "system" | "light" | "dark";

type Ctx = { c: Palette; mode: ThemeMode; setMode: (m: ThemeMode) => void };

const ThemeCtx = createContext<Ctx>({ c: light, mode: "system", setMode: () => undefined });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  useEffect(() => {
    void storage.loadPrefs().then((p) => p.theme && setModeState(p.theme));
  }, []);
  const setMode = (m: ThemeMode) => {
    setModeState(m);
    void storage.loadPrefs().then((p) => storage.savePrefs({ ...p, theme: m }));
  };
  const isDark = mode === "dark" || (mode === "system" && scheme === "dark");
  const value = useMemo(() => ({ c: isDark ? dark : light, mode, setMode }), [isDark, mode]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  return useContext(ThemeCtx);
}

export function useColors(): Palette {
  return useContext(ThemeCtx).c;
}
