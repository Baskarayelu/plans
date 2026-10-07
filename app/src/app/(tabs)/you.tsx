import * as Device from "expo-device";
import { router } from "expo-router";
import React, { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { APP_VERSION, isTestnet } from "../../config";
import { countryByCode, currencyFor, formatUsd } from "../../lib/domain/currency";
import { identity, signOut } from "../../lib/identity/session";
import { useBalance } from "../../lib/state/data";
import { useStore } from "../../lib/state/observable";
import { useColors, useTheme } from "../../theme/ThemeProvider";
import { Icon } from "../../ui/Icon";
import { thisBrowser, useInstallPrompt } from "../../ui/desk/install";
import { ComputerIcon, IconWell, KeyWhy } from "../../ui/desk/money";
import { Avatar, Btn, Btns, Card, Chip, FingerprintPill, Hr, ListItem, Row, Seg, Tile } from "../../ui/kit";
import { Screen, Sheet } from "../../ui/layout";
import { useLocal } from "../../ui/money";
import { SidePanel } from "../../ui/shell/panel";
import { useLayout } from "../../ui/shell/responsive";
import { Txt } from "../../ui/Text";

const WEB = Platform.OS === "web";

/** Browser notifications on this computer (notify.web.ts asks when something first needs you). */
function notificationsLine(): string {
  const N = (globalThis as { Notification?: { permission?: string } }).Notification;
  const p = N?.permission;
  return p === "granted" ? "Browser notifications on · approvals, money in, settle-ups" : p === "denied" ? "Browser notifications off · turn them on in the browser" : "Approvals, money in, settle-ups";
}

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
  const { desk } = useLayout();
  const browser = thisBrowser();
  const signOutSheet = (
    <Sheet visible={confirmOut} onClose={() => setConfirmOut(false)} testID="sheet-sign-out">
      <Txt v="d22">{WEB ? "Sign out of this browser?" : "Sign out of Plans?"}</Txt>
      <Txt v="t15" color="muted" style={{ marginTop: 6, marginBottom: 16 }}>
        {WEB ? "Your plans and money stay safe. Receipts reopen when you come back with the same passkey." : "Your plans and money stay safe. Come back with the same passkey and your receipts open again."}
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
  );
  const themeSeg = (
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
  );

  if (desk) return <DeskYou chev={chev} browser={browser} themeSeg={themeSeg} onSignOut={() => setConfirmOut(true)} signOutSheet={signOutSheet} />;

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
        <ListItem
          left={<Tile icon={WEB ? "key" : "phone"} />}
          title={WEB ? "Devices with your passkey" : "Phones with your passkey"}
          sub={WEB ? `${browser ?? "This browser"} (this browser)` : `${Device.modelName ?? "This phone"} (this one)`}
          right={chev}
          onPress={() => router.push("/key")}
          testID="row-phones"
        />
        <ListItem
          left={<Tile icon="eye" />}
          title="Appearance"
          sub={mode === "system" ? "Follows your phone" : mode === "dark" ? "Dark" : "Light"}
          right={themeSeg}
          testID="row-theme"
        />
        {isTestnet ? <ListItem left={<Tile icon="gift" kind="a" />} title="Get test dollars" sub="Test version only" right={chev} onPress={() => router.push("/test-dollars")} testID="row-test-dollars" /> : null}
        <ListItem left={<Tile icon="sparkle" />} title="Try a settle-up" sub="Two minutes with three demo friends" right={chev} onPress={() => router.push("/demo")} testID="row-try-settle-up" />
        <ListItem left={<Tile icon="shield" />} title="What could go wrong" sub="Lost phones, people who won't pay, outages, freezes" right={chev} onPress={() => router.push("/risks")} testID="row-what-could-go-wrong" />
        <ListItem left={<Tile icon="help" />} title="Help" right={chev} onPress={() => router.push("/help")} testID="row-help" />
        {/* No diagnostics on the web (118): problems go through Help with a reference. */}
        <Pressable onLongPress={WEB ? undefined : () => router.push("/diagnostics")} delayLongPress={700} testID="row-version" accessibilityHint={WEB ? undefined : "Long-press for diagnostics"}>
          <ListItem left={<Tile icon="info" />} title="About Plans" sub={`Version ${APP_VERSION}${isTestnet ? " · Test version" : ""}`} />
        </Pressable>
        <ListItem left={<Tile icon="logout" kind="n" />} title={<Txt v="lt" color="neg">Sign out</Txt>} onPress={() => setConfirmOut(true)} testID="row-sign-out" last />
      </View>
      <View style={{ height: 24 }} />
      {signOutSheet}
    </Screen>
  );
}

/** 118 on a laptop: profile, key fingerprint and devices, settings; "Your key" in the panel. */
function DeskYou({ chev, browser, themeSeg, onSignOut, signOutSheet }: { chev: React.ReactNode; browser: string | null; themeSeg: React.ReactNode; onSignOut: () => void; signOutSheet: React.ReactNode }) {
  const c = useColors();
  const st = useStore(identity, (s) => s);
  const bal = useBalance();
  const local = useLocal();
  const { mode } = useTheme();
  const install = useInstallPrompt();
  const [another, setAnother] = useState(false);
  const p = st.profile;
  const cty = countryByCode(p?.country);
  const cur = currencyFor(p?.currency);
  const parts = st.fingerprint ? Array.from(st.fingerprint) : ["·", "·", "·"];
  const name = p?.name ?? "You";
  const row = (props: React.ComponentProps<typeof ListItem>) => <ListItem right={chev} {...props} />;
  return (
    <Screen testID="screen-you" bottomInset={false}>
      <Row style={{ marginTop: 8, marginBottom: 20 }} gap={16}>
        <Avatar initial={(name[0] ?? "?").toUpperCase()} color="#D9634B" size={72} flag={cty?.flag} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="d44" numberOfLines={1} testID="you-name">
            {name}
          </Txt>
          <Txt v="t15" color="muted">
            {[p?.city, cty?.name].filter(Boolean).join(", ")} · shows {cur.symbol.trim()} {cur.code}
          </Txt>
        </View>
        <Btn label="Edit profile" kind="sec" icon="edit" sm onPress={() => router.push({ pathname: "/profile", params: { edit: "1" } })} testID="btn-edit-profile" />
      </Row>
      <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-start" }}>
        <Card style={{ width: 300, padding: 20 }} testID="card-key">
          <Txt v="ov" color="muted" center>
            Your key fingerprint
          </Txt>
          <View style={{ flexDirection: "row", gap: 12, alignSelf: "center", marginTop: 12, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 999, backgroundColor: c.surface2 }}>
            {parts.map((e, i) => (
              <Txt key={i} style={{ fontSize: 36, lineHeight: 44 }} testID={`key-emoji-${i}`}>
                {e}
              </Txt>
            ))}
          </View>
          <Txt v="t13" color="muted" center style={{ marginTop: 12 }}>
            The same on every device you use Plans on. Friends see these three next to your name.
          </Txt>
          <Hr m={14} />
          <Txt v="ov" color="muted">
            Devices with your passkey
          </Txt>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 }} testID="device-this">
            <IconWell>
              <ComputerIcon />
            </IconWell>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt v="lt">This browser</Txt>
              <Txt v="t13" color="muted">
                {browser ?? "This computer"}
              </Txt>
            </View>
            <Chip label="This one" sm tone="pos" />
          </View>
          <Hr m={12} />
          <Btn label="+ Save a passkey on another device" kind="txt" sm onPress={() => setAnother(true)} testID="btn-save-passkey-another" style={{ alignSelf: "flex-start", height: 36, minHeight: 36, paddingHorizontal: 0 }} />
        </Card>
        <Card style={{ flex: 1, paddingVertical: 4 }} testID="card-settings">
          {row({ left: <Tile icon="globe" />, title: "Country & money", sub: `${cty?.name ?? "—"} · ${cur.symbol.trim()} ${cur.code}`, onPress: () => router.push({ pathname: "/profile", params: { edit: "1" } }), testID: "row-country-money" })}
          {row({
            left: <Tile icon="ticket" />,
            title: "Your Plans account",
            sub: bal.data !== undefined ? [formatUsd(bal.data), local.fmt(bal.data)].filter(Boolean).join(" · ") : "…",
            onPress: () => router.push("/balance"),
            testID: "row-plans-account",
          })}
          {row({ left: <Tile icon="bell" />, title: "Notifications", sub: notificationsLine(), onPress: () => router.push("/notifications"), testID: "row-notifications" })}
          {row({ left: <Tile icon="key" />, title: "Devices with your passkey", sub: `${browser ?? "This browser"} (this browser)`, onPress: () => router.push("/key"), testID: "row-phones" })}
          <ListItem left={<Tile icon="eye" />} title="Appearance" sub={mode === "system" ? "Follows this computer" : mode === "dark" ? "Dark" : "Light"} right={themeSeg} testID="row-theme" />
          {row({ left: <Tile icon="shield" />, title: "What could go wrong", sub: "Lost phone, someone who won't pay, outages, freezes", onPress: () => router.push("/risks"), testID: "row-what-could-go-wrong" })}
          {isTestnet ? row({ left: <Tile icon="gift" kind="a" />, title: "Get test dollars", sub: "Test version only", onPress: () => router.push("/test-dollars"), testID: "row-test-dollars" }) : null}
          {row({ left: <Tile icon="help" />, title: "Help", onPress: () => router.push("/help"), testID: "row-help" })}
          <View testID="row-version">
            <ListItem left={<Tile icon="info" />} title="About Plans" sub={`Version ${APP_VERSION}${isTestnet ? " · Test version" : ""}`} />
          </View>
          <ListItem left={<Tile icon="logout" kind="n" />} title={<Txt v="lt" color="neg">Sign out of this browser</Txt>} onPress={onSignOut} testID="row-sign-out" last />
        </Card>
      </View>
      <View style={{ height: 24 }} />
      <SidePanel kind="live">
        <View style={{ flex: 1 }} testID="panel-your-key">
          <Txt v="d22" style={{ marginBottom: 14 }}>
            Your key
          </Txt>
          <KeyWhy compact />
          <Card tint style={{ marginTop: 20 }}>
            <Txt v="ov" color="muted">
              How friends see you
            </Txt>
            <Row style={{ marginTop: 8 }}>
              <Avatar initial={(name[0] ?? "?").toUpperCase()} color="#D9634B" size={36} flag={cty?.flag} />
              <Txt v="lt" style={{ flex: 1 }}>
                {name}
              </Txt>
              <Txt style={{ fontSize: 15, letterSpacing: 3 }}>{st.fingerprint ?? "· · ·"}</Txt>
            </Row>
          </Card>
          <View style={{ flex: 1, minHeight: 24 }} />
          {install.available ? (
            <Card tint testID="card-install">
              <Row align="flex-start">
                <Tile icon="download" kind="a" />
                <View style={{ flex: 1 }}>
                  <Txt v="lt">Install Plans on this computer</Txt>
                  <Txt v="t13" color="muted">
                    Opens in its own window, like an app.
                  </Txt>
                </View>
              </Row>
              <Btn label="Install" kind="txt" icon="download" sm onPress={() => void install.install()} testID="btn-install" style={{ alignSelf: "flex-start", marginTop: 4 }} />
            </Card>
          ) : null}
        </View>
      </SidePanel>
      <Sheet visible={another} onClose={() => setAnother(false)} testID="sheet-another-device">
        <Txt v="d22">Use Plans on another device</Txt>
        <View style={{ gap: 12, marginTop: 12 }}>
          <Txt v="t15">
            On the other device, open plans.0xo.in/app and choose <Txt weight="bold">I already use Plans</Txt>.
          </Txt>
          <Txt v="t15" color="muted">
            If your passkey is saved in Google Password Manager or iCloud Keychain, it's already there. If not, choose to use a phone in the browser's dialog and confirm on the phone that has it.
          </Txt>
          <Txt v="t15" color="muted">
            Either way you get the same key, so the same three pictures, and your receipts open there too.
          </Txt>
        </View>
        <Btn label="Got it" onPress={() => setAnother(false)} style={{ marginTop: 16 }} testID="btn-another-got-it" />
      </Sheet>
      {signOutSheet}
    </Screen>
  );
}
