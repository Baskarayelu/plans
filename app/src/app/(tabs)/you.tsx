import * as Device from "expo-device";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { APP_VERSION, isTestnet } from "../../config";
import { countryByCode, currencyFor, formatUsd } from "../../lib/domain/currency";
import { identity, signOut } from "../../lib/identity/session";
import { useBalance } from "../../lib/state/data";
import { useStore } from "../../lib/state/observable";
import { useTheme } from "../../theme/ThemeProvider";
import { Icon } from "../../ui/Icon";
import { Avatar, Btn, Btns, Card, FingerprintPill, ListItem, Row, Seg, Tile } from "../../ui/kit";
import { Screen, Sheet } from "../../ui/layout";
import { useLocal } from "../../ui/money";
import { Txt } from "../../ui/Text";

/** 53 You: profile, key fingerprint, settings. Long-press the version row → hidden Diagnostics. */
export default function You() {
  const st = useStore(identity, (s) => s);
  const bal = useBalance();
  const local = useLocal();
  const { mode, setMode } = useTheme();
  const [confirmOut, setConfirmOut] = useState(false);
  const p = st.profile;
  const cty = countryByCode(p?.country);
  const cur = currencyFor(p?.currency);
  const chev = <Icon name="chev" size={20} />;
  return (
    <Screen testID="screen-you" bottomInset={false}>
      <View style={{ alignItems: "center", marginTop: 16 }}>
        <Avatar initial={(p?.name?.[0] ?? "?").toUpperCase()} color="#D9634B" size={80} />
        <Txt v="d28" style={{ marginTop: 12 }} testID="you-name">
          {p?.name ?? "You"}
        </Txt>
        <Txt v="t13" color="muted">
          {[p?.city, cty?.name].filter(Boolean).join(", ")} · shows {cur.symbol.trim()} {cur.code}
        </Txt>
      </View>
      <Card style={{ marginTop: 16 }} onPress={() => router.push("/key")} testID="card-key" a11y="Your key">
        <Row between>
          <FingerprintPill emoji={st.fingerprint} />
          {chev}
        </Row>
        <Txt v="t13" color="muted" style={{ marginTop: 8 }}>
          Your key fingerprint. The same on every phone you sign in to.
        </Txt>
      </Card>
      <View style={{ marginTop: 8 }}>
        <ListItem left={<Tile icon="globe" />} title="Country & money" sub={`${cty?.name ?? "—"} · ${cur.symbol.trim()} ${cur.code}`} right={chev} onPress={() => router.push({ pathname: "/profile", params: { edit: "1" } })} testID="row-country-money" />
        <ListItem
          left={<Tile icon="ticket" />}
          title="Your Plans account"
          sub={bal.data !== undefined ? [formatUsd(bal.data), local.fmt(bal.data)].filter(Boolean).join(" · ") : "…"}
          right={chev}
          onPress={() => router.push("/balance")}
          testID="row-plans-account"
        />
        <ListItem left={<Tile icon="bell" />} title="Notifications" sub="Approvals, money in, settle-ups" right={chev} onPress={() => router.push("/notifications")} testID="row-notifications" />
        <ListItem left={<Tile icon="phone" />} title="Phones with your passkey" sub={`${Device.modelName ?? "This phone"} (this one)`} right={chev} onPress={() => router.push("/key")} testID="row-phones" />
        <ListItem
          left={<Tile icon="eye" />}
          title="Appearance"
          sub={mode === "system" ? "Follows your phone" : mode === "dark" ? "Dark" : "Light"}
          right={
            <View style={{ width: 170 }}>
              <Seg
                options={[
                  { value: "system", label: "Auto" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
                value={mode}
                onChange={setMode}
                testID="seg-theme"
              />
            </View>
          }
          testID="row-theme"
        />
        {isTestnet ? <ListItem left={<Tile icon="gift" kind="a" />} title="Get test dollars" sub="Test version only" right={chev} onPress={() => router.push("/test-dollars")} testID="row-test-dollars" /> : null}
        <ListItem left={<Tile icon="sparkle" />} title="Try a settle-up" sub="Two minutes with three demo friends" right={chev} onPress={() => router.push("/demo")} testID="row-try-settle-up" />
        <ListItem left={<Tile icon="shield" />} title="What could go wrong" sub="Lost phones, people who won't pay, outages, freezes" right={chev} onPress={() => router.push("/risks")} testID="row-what-could-go-wrong" />
        <ListItem left={<Tile icon="help" />} title="Help" right={chev} onPress={() => router.push("/help")} testID="row-help" />
        <Pressable onLongPress={() => router.push("/diagnostics")} delayLongPress={700} testID="row-version" accessibilityHint="Long-press for diagnostics">
          <ListItem left={<Tile icon="info" />} title="About Plans" sub={`Version ${APP_VERSION}${isTestnet ? " · Test version" : ""}`} />
        </Pressable>
        <ListItem left={<Tile icon="logout" kind="n" />} title={<Txt v="lt" color="neg">Sign out</Txt>} onPress={() => setConfirmOut(true)} testID="row-sign-out" last />
      </View>
      <View style={{ height: 24 }} />
      <Sheet visible={confirmOut} onClose={() => setConfirmOut(false)} testID="sheet-sign-out">
        <Txt v="d22">Sign out of Plans?</Txt>
        <Txt v="t15" color="muted" style={{ marginTop: 6, marginBottom: 16 }}>
          Your plans and money stay safe. Come back with the same passkey and your receipts open again.
        </Txt>
        <Btns>
          <Btn label="Cancel" kind="sec" onPress={() => setConfirmOut(false)} />
          <Btn
            label="Sign out"
            kind="dng"
            onPress={async () => {
              setConfirmOut(false);
              await signOut();
              router.replace("/welcome");
            }}
            testID="btn-confirm-sign-out"
          />
        </Btns>
      </Sheet>
    </Screen>
  );
}
