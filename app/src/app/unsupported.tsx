import * as IntentLauncher from "expo-intent-launcher";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Platform, View } from "react-native";
import { BigIcon, Btn, Card, Step } from "../ui/kit";
import { AppBar, Screen } from "../ui/layout";
import { Txt } from "../ui/Text";

/** 06 Passkey not supported: no passkey service, no screen lock, or an Android too old. */
export default function Unsupported() {
  const { why } = useLocalSearchParams<{ why?: string; detail?: string }>();
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
