import { router } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { handlePasskeyFailure } from "../lib/identity/flows";
import { unlockKeysSeparately } from "../lib/identity/session";
import { queryClient } from "../lib/state/data";
import { BigIcon, Btn } from "../ui/kit";
import { AppBar, Screen } from "../ui/layout";
import { Txt } from "../ui/Text";

/**
 * "Unlock receipts": fallback when this phone's passkey service returned only one PRF output in
 * the sign-in ceremony. One more fingerprint evaluates the keys salt (plans.keys.v1) alone.
 */
export default function UnlockKeys() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | undefined>();
  const go = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      await unlockKeysSeparately();
      void queryClient.invalidateQueries();
      router.back();
    } catch (e) {
      setMsg(handlePasskeyFailure(e).inline);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen testID="screen-unlock-keys" dock={<Btn label="Unlock receipts" icon="fp" onPress={go} loading={busy} testID="btn-unlock-receipts-confirm" />}>
      <AppBar icon="x" />
      <View style={{ marginTop: 24 }}>
        <BigIcon icon="lock" kind="i" />
      </View>
      <Txt v="d28" center style={{ marginTop: 16 }}>
        Unlock receipts on this phone
      </Txt>
      <Txt v="t15" color="muted" center style={{ marginTop: 8, marginHorizontal: 16 }}>
        Plan names, notes and photos are locked to your key. Your phone needs one more fingerprint to open them here. You only do this once each time you unlock Plans.
      </Txt>
      {msg ? (
        <Txt v="t13" color="neg" center style={{ marginTop: 12 }}>
          {msg}
        </Txt>
      ) : null}
    </Screen>
  );
}
