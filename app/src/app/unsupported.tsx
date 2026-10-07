import * as IntentLauncher from "expo-intent-launcher";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Platform, View } from "react-native";
import { BigIcon, Btn, Card, Step } from "../ui/kit";
import { DOWNLOAD_URL, EntryHeader, EntrySplit, useEntryRoomy } from "../ui/desk/entry";
import { AppBar, Screen } from "../ui/layout";
import { useLayout } from "../ui/shell/responsive";
import { Txt } from "../ui/Text";

/** In a browser (102 states): 06's copy for a browser without passkeys, with "Use the Android app instead". */
function WebUnsupported({ why }: { why?: string }) {
  const { desk } = useLayout();
  const roomy = useEntryRoomy();
  const retry = () => (router.canGoBack() ? router.back() : router.replace("/welcome"));
  const title = "This browser can't save a passkey";
  const text =
    why === "prf-unavailable"
      ? "Your passkey service doesn't support what Plans needs. Chrome, Edge and Safari with a recent update do."
      : "Plans uses a passkey instead of a password. This browser doesn't support passkeys, or they're turned off.";
  const steps = (
    <Card style={{ gap: 12 }}>
      <Step n={1}>Update this browser, or open Plans in Chrome, Edge or Safari.</Step>
      <Step n={2}>Check this computer has a screen lock, PIN or fingerprint set up.</Step>
      <Step n={3}>
        <Txt v="t15">
          Come back here and choose <Txt weight="bold">Try again</Txt>.
        </Txt>
      </Step>
    </Card>
  );
  const buttons = (
    <>
      <Btn label="Use the Android app instead" icon="phone" onPress={() => void Linking.openURL(DOWNLOAD_URL)} testID="btn-use-android-app" />
      <Btn label="Try again" kind="sec" onPress={retry} style={{ marginTop: 8 }} testID="btn-try-again" />
    </>
  );
  if (desk) {
    return (
      <Screen testID="screen-unsupported" pad={false} scroll={false} bottomInset={false}>
        <EntrySplit>
          <View style={{ flex: 1, paddingTop: 56, paddingBottom: 40, paddingHorizontal: roomy ? 88 : 56, minHeight: 640 }}>
            <EntryHeader />
            <View style={{ flex: 1, minHeight: 32 }} />
            <View style={{ alignSelf: "flex-start" }}>
              <BigIcon icon="key" kind="n" />
            </View>
            <Txt v="d44" style={{ marginTop: 20, maxWidth: 560 }} accessibilityRole="header">
              {title}
            </Txt>
            <Txt v="t17" color="muted" style={{ marginTop: 10, marginBottom: 20, maxWidth: 520 }}>
              {text}
            </Txt>
            <View style={{ maxWidth: 520 }}>{steps}</View>
            <View style={{ width: 400, maxWidth: "100%", marginTop: 24 }}>{buttons}</View>
            <View style={{ flex: 1, minHeight: 32 }} />
          </View>
        </EntrySplit>
      </Screen>
    );
  }
  return (
    <Screen testID="screen-unsupported" dock={buttons}>
      <AppBar icon="x" onBack={retry} />
      <View style={{ marginTop: 8 }}>
        <BigIcon icon="key" kind="n" />
      </View>
      <Txt v="d28" center style={{ marginTop: 16 }}>
        {title}
      </Txt>
      <Txt v="t15" color="muted" center style={{ marginTop: 8, marginHorizontal: 8, marginBottom: 24 }}>
        {text}
      </Txt>
      {steps}
    </Screen>
  );
}

/** 06 Passkey not supported: no passkey service, no screen lock, or an Android too old. */
export default function Unsupported() {
  const { why } = useLocalSearchParams<{ why?: string; detail?: string }>();
  if (Platform.OS === "web") return <WebUnsupported why={why} />;
  const old = Platform.OS === "android" && Number(Platform.Version) < 28;
  const noLock = why === "not-supported";
  const openSettings = () => {
    void IntentLauncher.startActivityAsync(noLock ? "android.settings.SECURITY_SETTINGS" : "android.settings.SETTINGS").catch(() => undefined);
  };
  return (
    <Screen
      testID="screen-unsupported"
      dock={
        <>
          {!old ? <Btn label="Open settings" onPress={openSettings} testID="btn-open-settings" /> : null}
          <Btn label="Try again" kind="sec" onPress={() => router.back()} testID="btn-try-again" />
        </>
      }
    >
      <AppBar icon="x" />
      <View style={{ marginTop: 8 }}>
        <BigIcon icon="key" kind="n" />
      </View>
      <Txt v="d28" center style={{ marginTop: 16 }}>
        {old ? "This phone is too old for Plans" : noLock ? "Set a screen lock first" : "This phone can't save a passkey yet"}
      </Txt>
      <Txt v="t15" color="muted" center style={{ marginTop: 8, marginHorizontal: 8 }}>
        {why === "prf-unavailable"
          ? "Your passkey service doesn't support what Plans needs. Google Password Manager does."
          : "Plans uses a passkey instead of a password. Your phone needs its passkey service turned on."}
      </Txt>
      {!old ? (
        <Card style={{ marginTop: 24, gap: 12 }}>
          <Step n={1}>
            <Txt v="t15">
              Open <Txt weight="bold">Settings</Txt>, then <Txt weight="bold">Passwords & accounts</Txt>.
            </Txt>
          </Step>
          <Step n={2}>
            <Txt v="t15">
              Under <Txt weight="bold">Preferred service</Txt>, choose <Txt weight="bold">Google Password Manager</Txt>.
            </Txt>
          </Step>
          <Step n={3}>Check you have a screen lock or fingerprint set up.</Step>
          <Step n={4}>
            <Txt v="t15">
              Come back here and tap <Txt weight="bold">Try again</Txt>.
            </Txt>
          </Step>
        </Card>
      ) : null}
      <Txt v="t13" color="muted" center style={{ marginTop: 12 }}>
        Needs Android 9 or newer with Google Play services.
      </Txt>
    </Screen>
  );
}
