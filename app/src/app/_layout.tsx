import "../polyfills";
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
import { SplashScreen, Stack } from "expo-router";
import * as SystemUI from "expo-system-ui";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { applyEndpointOverrides } from "../config";
import { getRuntimeConfig } from "../lib/api/relayer";
import { loadIdentity } from "../lib/identity/session";
import { queryClient } from "../lib/state/data";
import { storage } from "../lib/state/storage";
import { AppEffects } from "../lib/state/effects";
import { ThemeProvider, useColors } from "../theme/ThemeProvider";
import { ToastHost } from "../ui/Toast";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Nav() {
  const c = useColors();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.bg).catch(() => undefined);
  }, [c.bg]);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: "slide_from_right" }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="welcome" options={{ animation: "fade" }} />
      <Stack.Screen name="unlock" options={{ animation: "fade" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });
  const [ready, setReady] = React.useState(false);

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
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (fontsLoaded && ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded, ready]);

  if (!fontsLoaded || !ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <Nav />
            <AppEffects />
            <ToastHost />
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
