/**
 * 166 "Use Plans on your phone already?" — the fork that prevents a silent second account — and
 * 176a, the same screen when the phone's passkey answered without what Plans needs here.
 *
 * Laptop order: phone's passkey, link this browser, I'm new. Phone browsers put "Link this
 * browser" first (lead's decision 2): on a phone, the browser's QR would need a second device.
 */
import { router } from "expo-router";
import React from "react";
import { View } from "react-native";
import { useColors } from "../../theme/ThemeProvider";
import { Icon } from "../Icon";
import { Banner, Btn } from "../kit";
import { useLayout } from "../shell/responsive";
import { Txt } from "../Text";
import { LinkFrame, OptionCard, useOtherPhone } from "./frame";

export type ChoiceBusy = "phone" | "new" | null;

export function LinkChoice({
  onPhone,
  onNew,
  onBack,
  busy,
  prfMissing,
  notice,
}: {
  onPhone: () => void;
  onNew: () => void;
  onBack: () => void;
  busy: ChoiceBusy;
  /** 176a: the phone's passkey couldn't be used here; suggest linking. */
  prfMissing?: boolean;
  /** Any other notice (a closed dialog, a failure), shown above the options. */
  notice?: React.ReactNode;
}) {
  const c = useColors();
  const { desk } = useLayout();
  const other = useOtherPhone();
  const link = () => router.push("/link");
  const phoneCard = (
    <OptionCard
      key="phone"
      icon="qr"
      accent
      title="Use your phone's passkey"
      sub="Your browser shows a code; scan it with your phone."
      onPress={onPhone}
      disabled={!!busy}
      testID="btn-use-phone"
    />
  );
  const linkCard = (
    <OptionCard
      key="link"
      icon="link"
      accent
      title="Link this browser to your account"
      sub="For when your phone's passkey can't be used here. Takes a minute."
      onPress={link}
      disabled={!!busy}
      outlined={prfMissing}
      testID="btn-link-browser"
    />
  );
  const newCard = (
    <OptionCard key="new" icon="plus" title="I'm new to Plans" sub="Make a new account with a passkey saved in this browser." onPress={onNew} disabled={!!busy} testID="btn-new-to-plans" />
  );
  const cards = other ? [linkCard, phoneCard, newCard] : [phoneCard, linkCard, newCard];

  return (
    <LinkFrame testID="screen-link-choice" dock={desk ? undefined : <Btn label="Back" kind="txt" onPress={onBack} testID="btn-back" />}>
      {/* testID kept from the interim choice that this screen replaces */}
      <Txt v={desk ? "d44" : "d28"} accessibilityRole="header" style={{ marginTop: desk ? 0 : 8 }} testID="welcome-choice">
        {other ? "Use Plans on another phone already?" : "Use Plans on your phone already?"}
      </Txt>
      <Txt v={desk ? "t17" : "t15"} color="muted" style={{ marginTop: 10, marginBottom: 20 }}>
        {other
          ? "This browser has no Plans passkey. If your account is on another phone, bring it here instead of starting again."
          : "This browser has no Plans passkey. If your account is on your phone, bring it here instead of starting again."}
      </Txt>
      {prfMissing ? (
        <View style={{ marginBottom: 12 }}>
          <Banner
            kind="neg"
            icon="key"
            title="Your phone's passkey couldn't be used here"
            text="This browser didn't give Plans what it needs from a phone's passkey. Your account is fine. Link this browser instead; it takes a minute."
            testID="link-choice-prf-missing"
          >
            <Btn label="Link with a code" kind="txt" sm onPress={link} testID="btn-link-with-code" style={{ height: 36, minHeight: 36, paddingHorizontal: 0, marginTop: 2 }} />
          </Banner>
        </View>
      ) : null}
      {notice ? <View style={{ marginBottom: 12 }}>{notice}</View> : null}
      <View style={{ gap: 10 }}>{cards}</View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 }}>
        <Icon name="shieldok" size={18} color={c.ink} />
        <Txt v="t13" weight="semi">
          Plans never makes a second account without asking.
        </Txt>
      </View>
      {busy ? (
        <Txt v="t13" color="muted" style={{ marginTop: 10 }} testID="link-choice-busy">
          {busy === "phone" ? "Waiting for your browser's passkey step…" : "Your browser is getting the passkey ready."}
        </Txt>
      ) : null}
      {desk ? (
        <View style={{ marginTop: 28 }}>
          <Btn label="Back" kind="txt" icon="back" sm onPress={onBack} testID="btn-back" style={{ paddingHorizontal: 0 }} />
        </View>
      ) : null}
    </LinkFrame>
  );
}
