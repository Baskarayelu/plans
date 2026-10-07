import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { handlePasskeyFailure } from "../lib/identity/flows";
import { identity, signOut, unlockStored } from "../lib/identity/session";
import { useStore } from "../lib/state/observable";
import { Avatar, Btn, FingerprintPill, Logo } from "../ui/kit";
import { EntryHeader, EntrySplit, useEntryRoomy } from "../ui/desk/entry";
import { Screen } from "../ui/layout";
import { useLayout } from "../ui/shell/responsive";
import { Txt } from "../ui/Text";

/**
 * Lock screen: one fingerprint per app launch opens the signing session and the keys. The
 * ceremony is pinned to the stored passkey, so Android goes straight to the fingerprint.
 */
export default function Unlock() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const st = useStore(identity, (s) => s);
  const { desk } = useLayout();
  const roomy = useEntryRoomy();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | undefined>();
  const tried = useRef(false);

  const unlock = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      await unlockStored();
      if (!identity.get().profile) router.replace({ pathname: "/profile", params: next ? { next } : {} });
      else router.replace((next as never) ?? "/(tabs)");
    } catch (e) {
      setMsg(handlePasskeyFailure(e).inline);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!tried.current && st.status === "locked") {
      tried.current = true;
      void unlock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const name = st.profile?.name;
  const different = async () => {
    await signOut();
    router.replace("/welcome");
  };

  if (desk) {
    // On a laptop: the welcome split (102) with the unlock on the right.
    return (
      <Screen testID="screen-unlock" pad={false} scroll={false} bottomInset={false}>
        <EntrySplit>
          <View style={{ flex: 1, paddingTop: 56, paddingBottom: 40, paddingHorizontal: roomy ? 88 : 56, minHeight: 600 }}>
            <EntryHeader />
            <View style={{ flex: 1, minHeight: 32 }} />
            <Avatar initial={(name?.[0] ?? "P").toUpperCase()} color="#D9634B" size={80} />
            <Txt v="d56" style={{ marginTop: 20 }} accessibilityRole="header">
              {name ? `Welcome back, ${name}` : "Welcome back"}
            </Txt>
            <Txt v="t17" color="muted" style={{ fontSize: 19, lineHeight: 27, marginTop: 12, marginBottom: 20, maxWidth: 520 }}>
              Confirm it's you to open your plans. Your passkey unlocks with your fingerprint, face or screen lock.
            </Txt>
            {st.fingerprint ? <FingerprintPill emoji={st.fingerprint} /> : null}
            {msg ? (
              <Txt v="t15" color="neg" style={{ marginTop: 16, maxWidth: 520 }} testID="unlock-message">
                {msg}
              </Txt>
            ) : null}
            <View style={{ width: 400, maxWidth: "100%", marginTop: 24, gap: 8 }}>
              <Btn label="Unlock with passkey" icon="key" onPress={unlock} loading={busy} testID="btn-unlock" />
              <Btn label="Use a different account" kind="sec" onPress={() => void different()} testID="btn-different-account" />
            </View>
            <View style={{ flex: 1, minHeight: 32 }} />
          </View>
        </EntrySplit>
      </Screen>
    );
  }

  return (
    <Screen
      testID="screen-unlock"
      dock={
        <>
          <Btn label="Unlock with fingerprint" icon="fp" onPress={unlock} loading={busy} testID="btn-unlock" />
          <Btn
            label="Use a different account"
            kind="txt"
            onPress={() => void different()}
            testID="btn-different-account"
          />
        </>
      }
    >
      <View style={{ height: 52, justifyContent: "center" }}>
        <Logo size={22} />
      </View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
        <Avatar initial={(name?.[0] ?? "P").toUpperCase()} color="#D9634B" size={80} />
        <Txt v="d28" center>
          {name ? `Hi ${name}` : "Welcome back"}
        </Txt>
        <Txt v="t15" color="muted" center style={{ marginHorizontal: 24 }}>
          Confirm it's you to open your plans. Your fingerprint is your key.
        </Txt>
        {st.fingerprint ? <FingerprintPill emoji={st.fingerprint} /> : null}
        {msg ? (
          <Txt v="t13" color="neg" center testID="unlock-message">
            {msg}
          </Txt>
        ) : null}
      </View>
    </Screen>
  );
}
