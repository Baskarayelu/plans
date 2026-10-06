import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import React, { useCallback, useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { Banner, Btn, ListItem, Tile } from "../ui/kit";
import { AppBar, Screen } from "../ui/layout";
import { Txt } from "../ui/Text";

type Perm = "loading" | "granted" | "denied" | "undetermined";

/** Notifications: what Plans tells you about, and the phone's permission. */
export default function NotificationsScreen() {
  const [perm, setPerm] = useState<Perm>("loading");
  const [canAsk, setCanAsk] = useState(true);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    try {
      const p = await Notifications.getPermissionsAsync();
      setPerm(p.granted ? "granted" : p.status === "undetermined" ? "undetermined" : "denied");
      setCanAsk(p.canAskAgain);
    } catch {
      setPerm("undetermined");
    }
  }, []);

  useEffect(() => {
    void read();
    const sub = AppState.addEventListener("change", (s) => s === "active" && void read());
    return () => sub.remove();
  }, [read]);

  const allow = async () => {
    if (!canAsk) {
      void Linking.openSettings();
      return;
    }
    setBusy(true);
    try {
      const p = await Notifications.requestPermissionsAsync();
      setPerm(p.granted ? "granted" : "denied");
      setCanAsk(p.canAskAgain);
    } catch {
      /* stays as it was */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="screen-notifications"
      dock={
        perm === "granted" ? undefined : (
          <Btn label={canAsk ? "Allow notifications" : "Open phone settings"} icon="bell" onPress={() => void allow()} loading={busy} disabled={perm === "loading"} testID="btn-allow-notifications" />
        )
      }
    >
      <AppBar title="Notifications" />
      <View testID="notifications-status">
        {perm === "granted" ? (
          <Banner kind="pos" icon="check" title="Notifications are on" text="Plans can tell you when something needs you, even when it's closed." />
        ) : perm === "loading" ? null : (
          <Banner kind="mut" icon="bell" title="Notifications are off" text={canAsk ? "Turn them on so you don't miss an approval or money coming in." : "Turn them on in your phone's settings for Plans."} />
        )}
      </View>
      <Txt v="d17" style={{ marginTop: 20, marginBottom: 4 }}>
        What we tell you about
      </Txt>
      <ListItem left={<Tile icon="vote" />} title="A spend needs your OK" sub="Someone in your plan asks for money above the instant limit" />
      <ListItem left={<Tile icon="in" kind="p" />} title="Money comes in" sub="Someone sends you money, or a link you sent is claimed" />
      <ListItem left={<Tile icon="receipt" />} title="Spends in your plans" sub="Someone pays from the pot, or adds money to it" />
      <ListItem left={<Tile icon="check" kind="p" />} title="Settle-ups" sub="A plan ends and everyone is paid" last />
      <Txt v="t13" color="muted" style={{ marginTop: 12 }}>
        Notifications never include your notes or receipt photos: only people in the plan can read those.
      </Txt>
    </Screen>
  );
}
