import * as Linking from "expo-linking";
import React, { useCallback, useEffect, useState } from "react";
import { AppState, Platform, View } from "react-native";
import { currentAccountOrNull } from "../lib/identity/session";
import { getNotifyPermission, requestNotifyPermission } from "../lib/state/notify";
import { disableWebPush, enableWebPush, readWebPush, type WebNotifyState } from "../lib/state/webPush";
import { Banner, Btn, ListItem, Step, Tile } from "../ui/kit";
import { AppBar } from "../ui/layout";
import { DeskScreen } from "../ui/desk/money";
import { Txt } from "../ui/Text";

type Perm = "loading" | "granted" | "denied" | "undetermined";
const web = Platform.OS === "web";

/** Notifications: what Plans tells you about, and the phone's (or the browser's) permission. */
export default function NotificationsScreen() {
  return web ? <WebNotifications /> : <PhoneNotifications />;
}

function WhatWeTell() {
  return (
    <>
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
    </>
  );
}

/** Android: the phone's notification permission (Expo push is registered in effects.tsx). */
function PhoneNotifications() {
  const [perm, setPerm] = useState<Perm>("loading");
  const [canAsk, setCanAsk] = useState(true);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    try {
      const p = await getNotifyPermission();
      setPerm(p.status);
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
      const p = await requestNotifyPermission();
      setPerm(p.status === "granted" ? "granted" : "denied");
      setCanAsk(p.canAskAgain);
    } catch {
      /* stays as it was */
    } finally {
      setBusy(false);
    }
  };

  return (
    <DeskScreen
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
      <WhatWeTell />
    </DeskScreen>
  );
}

/**
 * Web: notifications with Plans closed (Web Push) where the browser allows it. The browser's
 * prompt only ever comes from the button below (never on load). On an iPhone or iPad in a
 * browser tab, push can't work at all, so we explain Add to Home Screen instead of a button.
 */
function WebNotifications() {
  const [state, setState] = useState<WebNotifyState | "loading">("loading");
  const [mobile, setMobile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const read = useCallback(async () => {
    try {
      const r = await readWebPush();
      setState(r.state);
      setMobile(r.mobile);
    } catch {
      setState("unsupported");
    }
  }, []);

  useEffect(() => {
    void read();
    const sub = AppState.addEventListener("change", (s) => s === "active" && void read());
    return () => sub.remove();
  }, [read]);

  // Called straight from the tap, with no await before it: browsers only prompt for a user gesture.
  const turnOn = () => {
    setBusy(true);
    setFailed(false);
    enableWebPush(currentAccountOrNull())
      .then((s) => {
        setState(s);
        // Allowed, yet no subscription: a private window, or the network failed on the way.
        setFailed(s === "off");
      })
      .catch(() => void read())
      .finally(() => setBusy(false));
  };
  const turnOff = () => {
    setBusy(true);
    disableWebPush()
      .then(setState)
      .catch(() => void read())
      .finally(() => setBusy(false));
  };

  const dock =
    state === "ask" || state === "off" ? (
      <Btn label="Turn on notifications" icon="bell" onPress={turnOn} loading={busy} testID="btn-allow-notifications" />
    ) : state === "on" ? (
      <Btn label="Turn off notifications" kind="out" onPress={turnOff} loading={busy} testID="btn-disable-notifications" />
    ) : undefined;

  return (
    <DeskScreen testID="screen-notifications" dock={dock}>
      <AppBar title="Notifications" />
      <View testID="notifications-status">
        {state === "loading" ? null : state === "on" ? (
          <Banner
            testID="notifications-on"
            kind="pos"
            icon="check"
            title="Notifications are on"
            text={mobile ? "Plans tells you when something needs you, even when it's closed." : "Plans tells you when something needs you, even with its tab closed, as long as your browser is open."}
          />
        ) : state === "ask" || state === "off" ? (
          <Banner
            testID="notifications-off"
            kind="mut"
            icon="bell"
            title="Notifications are off"
            text={state === "ask" ? "Turn them on so you don't miss an approval or money coming in. Your browser will ask you first." : "Turn them on so you don't miss an approval or money coming in."}
          />
        ) : state === "blocked" ? (
          <Banner
            testID="notifications-blocked"
            kind="neg"
            icon="ban"
            title="Blocked by your browser"
            text="Your browser is set to block notifications from plans.0xo.in. Allow them in the browser's site settings, then come back here."
          />
        ) : state === "install" ? (
          <Banner testID="notifications-install" kind="inf" icon="phone" title="Add Plans to your Home Screen to get notifications" text="On iPhone and iPad, only Plans opened from the Home Screen can send notifications (iOS 16.4 or later). A browser tab can't." />
        ) : state === "tab" ? (
          <Banner testID="notifications-tab" kind="pos" icon="check" title="On while Plans is open" text="This browser can only tell you while Plans is open in a tab, even if you're in another one." />
        ) : (
          <Banner testID="notifications-unsupported" kind="mut" icon="info" title="Not available in this browser" text="This browser can't show notifications. Plans shows what's new when you open it." />
        )}
      </View>
      {failed && state === "off" ? (
        <Txt testID="notifications-error" v="t13" color="muted" style={{ marginTop: 10 }}>
          That didn't work. Check your connection and try again. Private windows can't get notifications.
        </Txt>
      ) : null}
      {state === "install" ? (
        <View testID="notifications-install-steps" style={{ gap: 12, marginTop: 16 }}>
          <Step n={1}>Tap Share: the square with an arrow pointing up. In newer Safari, tap the ••• button first.</Step>
          <Step n={2}>Scroll down and tap Add to Home Screen, then Add.</Step>
          <Step n={3}>Open Plans from your Home Screen, unlock with your passkey, then turn notifications on here.</Step>
        </View>
      ) : null}
      <WhatWeTell />
    </DeskScreen>
  );
}
