import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { APP_VERSION, config, isTestnet } from "../config";
import { useColors } from "../theme/ThemeProvider";
import { Icon } from "../ui/Icon";
import { Btn, Card, Row } from "../ui/kit";
import { AppBar, Screen } from "../ui/layout";
import { Txt } from "../ui/Text";

type QA = { q: string; a: React.ReactNode; id: string };

function Item({ qa, open, onToggle }: { qa: QA; open: boolean; onToggle: () => void }) {
  const c = useColors();
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.line }}>
      <Pressable testID={`help-${qa.id}`} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 10 }}>
        <Txt v="lt" style={{ flex: 1 }}>
          {qa.q}
        </Txt>
        <Icon name={open ? "down" : "chev"} size={20} />
      </Pressable>
      {open ? <View style={{ paddingBottom: 14, gap: 8 }}>{typeof qa.a === "string" ? <Txt v="t15" color="muted">{qa.a}</Txt> : qa.a}</View> : null}
    </View>
  );
}

/** Help: plain answers to the questions people actually ask. */
export default function Help() {
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  const [open, setOpen] = useState<string | null>(ref ? "contact" : null);
  const [copied, setCopied] = useState(false);
  const support = `Plans ${APP_VERSION}${isTestnet ? " (test version)" : ""}${ref ? ` · Ref ${ref}` : ""}`;

  const items: QA[] = [
    {
      id: "passkey",
      q: "It says “Passkey not supported”",
      a: (
        <>
          <Txt v="t15" color="muted">
            Plans keeps your account in a passkey, saved by your phone's password manager. Some password managers can't do what Plans needs yet.
          </Txt>
          <Txt v="t15" color="muted">
            Make Google Password Manager the one your phone uses: open Android Settings, then Passwords and accounts (on some phones: Passwords, passkeys and autofill), and pick Google. Then open Plans and try again.
          </Txt>
          <Txt v="t15" color="muted">Your phone also needs a screen lock (PIN, fingerprint or face).</Txt>
        </>
      ),
    },
    {
      id: "links",
      q: "A link opened in my browser instead of Plans",
      a: (
        <>
          <Txt v="t15" color="muted">
            On the web page, tap Open in Plans. Or copy the link and paste it into Plans: Plans tab, then Join.
          </Txt>
          <Btn label="Paste a link" kind="sec" icon="link" sm onPress={() => router.push("/join-link")} testID="btn-help-paste-link" />
        </>
      ),
    },
    {
      id: "money",
      q: "How does the money work?",
      a: (
        <>
          <Txt v="t15" color="muted">
            Plans keeps money in dollars. Everyone sees the same dollar amount, with their own money next to it.
          </Txt>
          <Txt v="t15" color="muted">
            Your own money is shown at a reference rate (from the European Central Bank) so you know roughly what it's worth. It moves a little each day; the dollars don't change.
          </Txt>
          <Txt v="t15" color="muted">Sending to anyone on Plans is free and usually arrives in under a second.</Txt>
        </>
      ),
    },
    {
      id: "add",
      q: "How do I add money?",
      a: (
        <>
          <Txt v="t15" color="muted">
            For now, money comes in from other people: share your Plans code, or claim a link a friend sent you. Card and bank top-ups aren't available yet.
          </Txt>
          <Btn label="Add to your balance" kind="sec" icon="plus" sm onPress={() => router.push("/add-balance")} testID="btn-help-add" />
        </>
      ),
    },
    {
      id: "link-back",
      q: "I sent a link and no one claimed it",
      a: "When the link runs out, open Activity and tap Get it back on that link. The money returns to your Plans account.",
    },
    {
      id: "phone",
      q: "I got a new phone",
      a: "Install Plans, tap I already use Plans and confirm with your screen lock. Your passkey brings back your account, your plans and your receipts.",
    },
    {
      id: "demo",
      q: "Can I try it without real friends?",
      a: (
        <>
          <Txt v="t15" color="muted">Try a settle-up runs a short plan with three demo friends, clearly labelled Demo. It takes about two minutes.</Txt>
          <Btn label="Try a settle-up" kind="sec" icon="sparkle" sm onPress={() => router.push("/demo")} testID="btn-help-demo" />
        </>
      ),
    },
    {
      id: "contact",
      q: "Still stuck?",
      a: (
        <>
          <Txt v="t15" color="muted">
            Write to us at help@{config.linkHost} with what you tapped and what you saw. Include this line so we can find it:
          </Txt>
          <Card tint p={12}>
            <Row between>
              <Txt v="mono11" style={{ flex: 1 }} testID="help-ref">
                {support}
              </Txt>
              <Btn
                label={copied ? "Copied" : "Copy"}
                kind="txt"
                sm
                onPress={() => void Clipboard.setStringAsync(support).then(() => setCopied(true)).catch(() => undefined)}
                testID="btn-copy-ref"
              />
            </Row>
          </Card>
        </>
      ),
    },
  ];

  return (
    <Screen testID="screen-help">
      <AppBar title="Help" />
      {items.map((qa) => (
        <Item key={qa.id} qa={qa} open={open === qa.id} onToggle={() => setOpen(open === qa.id ? null : qa.id)} />
      ))}
      <View style={{ height: 24 }} />
    </Screen>
  );
}
