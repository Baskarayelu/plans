import "../polyfills";
import "../lib/domain/webEntry";
import { BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque/700Bold";
import { BricolageGrotesque_800ExtraBold } from "@expo-google-fonts/bricolage-grotesque/800ExtraBold";
import { Figtree_400Regular } from "@expo-google-fonts/figtree/400Regular";
import { Figtree_500Medium } from "@expo-google-fonts/figtree/500Medium";
import { Figtree_600SemiBold } from "@expo-google-fonts/figtree/600SemiBold";
import { Figtree_700Bold } from "@expo-google-fonts/figtree/700Bold";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono/500Medium";
import { IBMPlexMono_600SemiBold } from "@expo-google-fonts/ibm-plex-mono/600SemiBold";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { router, SplashScreen, Stack, useGlobalSearchParams, usePathname, useRootNavigationState } from "expo-router";
import { Platform } from "react-native";
import * as SystemUI from "expo-system-ui";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { applyEndpointOverrides } from "../config";
import { mark, markRoute } from "../lib/timing";
import { getRuntimeConfig } from "../lib/api/relayer";
import { identity, loadIdentity } from "../lib/identity/session";
import { useStore } from "../lib/state/observable";
import { queryClient } from "../lib/state/data";
import { storage } from "../lib/state/storage";
import { AppEffects } from "../lib/state/effects";
import { ThemeProvider, useColors } from "../theme/ThemeProvider";
import { NO_MOTION } from "../ui/motion";
import { AppShell } from "../ui/shell/AppShell";
import { ToastHost } from "../ui/Toast";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
mark("app_boot");

/**
 * Web: an address typed, reloaded or opened from a bookmark can land on any route. A stored but
 * locked account goes through Unlock first and comes back (`next`); no account → Welcome. Routes that
 * handle signing in themselves (invites, claims) and the public help pages stay open. Android starts
 * at "/" (src/app/index.tsx) and locks through AppEffects, so this gate is web only.
 */
const OPEN_LOCKED = /^\/(unlock|welcome|join|claim|unsupported|help|risks|error)(\/|$)/;
const OPEN_NONE = /^\/(welcome|join|claim|unsupported|help|risks|error|link)(\/|$)/;
function WebGate() {
  const path = usePathname();
  const params = useGlobalSearchParams();
  const status = useStore(identity, (s) => s.status);
  const nav = useRootNavigationState();
  useEffect(() => {
    if (Platform.OS !== "web" || !nav?.key || path === "/") return;
    // Route params (e.g. [pot], [id]) are already in the path; only real query params go after "?".
    const segs = new Set(path.split("/"));
    const q = Object.entries(params)
      .filter(([, v]) => typeof v === "string" && !segs.has(v))
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    const next = q ? `${path}?${q}` : path;
    if (status === "locked" && !OPEN_LOCKED.test(path)) router.replace({ pathname: "/unlock", params: { next } });
    else if (status === "none" && !OPEN_NONE.test(path)) router.replace({ pathname: "/welcome", params: { next } });
  }, [status, path, nav?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** PLANS_TIMING: the first time each route is shown (welcome, profile, home…). */
function RouteMarks() {
  const path = usePathname();
  useEffect(() => markRoute(path), [path]);
  return null;
}

function Nav() {
  const c = useColors();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.bg).catch(() => undefined);
  }, [c.bg]);
  return (
    <AppShell>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: NO_MOTION ? "none" : "slide_from_right" }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="welcome" options={{ animation: NO_MOTION ? "none" : "fade" }} />
        <Stack.Screen name="unlock" options={{ animation: NO_MOTION ? "none" : "fade" }} />
      </Stack>
    </AppShell>
  );
}

const FONT_WAIT_MS = 2500;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });
  // Never wait on fonts for ever: after FONT_WAIT_MS, or on a load error, render with the fallback fonts.
  const [fontWaitOver, setFontWaitOver] = React.useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontWaitOver(true), FONT_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (fontError) console.warn("fonts failed to load; using system fonts", fontError.message);
  }, [fontError]);
  const fontsSettled = fontsLoaded || !!fontError || fontWaitOver;
  // Already loaded (a remount on the web): don't blank the app or re-read storage over an open session.
  const [ready, setReady] = React.useState(identity.get().status !== "loading");

  useEffect(() => {
    void (async () => {
      const prefs = await storage.loadPrefs();
      if (prefs.endpoints) applyEndpointOverrides(prefs.endpoints);
      // Endpoints set by hand in Diagnostics win; otherwise take the indexer URL the relayer publishes.
      if (!prefs.endpoints?.graphqlUrl) {
        void getRuntimeConfig().then((rc) => {
          if (rc?.graphqlUrl) {
            applyEndpointOverrides({ graphqlUrl: rc.graphqlUrl });
            void queryClient.invalidateQueries();
          }
        });
      }
      await loadIdentity();
      mark("app_ready");
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (fontsSettled && ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsSettled, ready]);

  if (!fontsSettled || !ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <Nav />
            <RouteMarks />
            <WebGate />
            <AppEffects />
            <ToastHost />
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
