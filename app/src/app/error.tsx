import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import { View } from "react-native";
import { BigIcon, Btn, Card, Overline } from "../ui/kit";
import { AppBar, Screen } from "../ui/layout";
import { Txt } from "../ui/Text";

function whatToDo(code: string): string {
  if (code === "OFFLINE") return "Check your connection and try again. You won't be charged twice.";
  if (code === "RATE_LIMITED" || code.startsWith("HTTP_429")) return "Wait a moment, then try again.";
  if (/INSUFFICIENT|TRANSFER_FROM|ERC20/.test(code)) return "Add money to your Plans account, or try a smaller amount.";
  if (/EXPIRED|SIGNATURE/.test(code)) return "Go back and try again. It only takes a second.";
  if (code === "REVERTED_ONCHAIN") return "Something changed while we were sending it. Check the details and try again.";
  if (/^HTTP_5|UNAVAILABLE/.test(code)) return "Try again in a minute. If it keeps happening, get help.";
  return "Try again. If it keeps happening, get help and quote the reference below.";
}

/** 59 Something went wrong: what happened to the money, why, and what to do. */
export default function ErrorScreen() {
  const p = useLocalSearchParams<{ title?: string; message?: string; code?: string; context?: string }>();
  const code = p.code || "UNKNOWN";
  const ref = useMemo(() => {
    const d = new Date();
    const short = code.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase() || "ERR";
    return `PL-${short}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  }, [code]);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)"));

  return (
    <Screen
      testID="screen-error"
      dock={
        <>
          <Btn label="Try again" icon="refresh" onPress={back} testID="btn-try-again" />
          <Btn label="Get help" kind="txt" onPress={() => router.push({ pathname: "/help", params: { ref } })} testID="btn-get-help" />
        </>
      }
    >
      <AppBar icon="x" onBack={back} />
      <View style={{ flex: 1, justifyContent: "center", paddingVertical: 16 }}>
        <BigIcon icon="alert" kind="n" />
        <Txt v="d28" center style={{ marginTop: 16 }} testID="error-title">
          {p.title || "That didn't go through"}
        </Txt>
        <Txt v="t17" center style={{ marginTop: 8, marginHorizontal: 12, marginBottom: 20 }} testID="error-money">
          Your money didn't move.{p.context ? ` ${p.context}` : ""}
        </Txt>
        <Card style={{ gap: 8 }}>
          <Overline>What happened</Overline>
          <Txt v="t15" testID="error-message">
            {p.message || "Something went wrong on the way. Nothing was sent."}
          </Txt>
          <Overline style={{ marginTop: 8 }}>What to do</Overline>
          <Txt v="t15">{whatToDo(code)}</Txt>
        </Card>
        <Txt v="mono11" color="muted" center style={{ marginTop: 12 }} testID="error-ref">
          Ref {ref}
        </Txt>
      </View>
    </Screen>
  );
}
