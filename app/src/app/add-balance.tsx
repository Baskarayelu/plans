import { router } from "expo-router";
import React from "react";
import { View } from "react-native";
import { isTestnet } from "../config";
import { Icon } from "../ui/Icon";
import { Banner, ListItem, Tile } from "../ui/kit";
import { AppBar, Screen } from "../ui/layout";
import { TestRibbon } from "../ui/send/bits";
import { Txt } from "../ui/Text";

/** Add to your balance: money comes in from other people on Plans (no card top-up yet). */
export default function AddBalance() {
  const chev = <Icon name="chev" size={20} />;
  return (
    <Screen testID="screen-add-balance">
      {isTestnet ? <TestRibbon /> : null}
      <AppBar title="Add to your balance" />
      <Txt v="t15" color="muted" style={{ marginBottom: 8 }}>
        Money comes into Plans from other people. Ask a friend to send you some, or claim a link someone sent you.
      </Txt>
      <View style={{ marginTop: 4 }}>
        <ListItem
          left={<Tile icon="qr" kind="a" />}
          title="Share your Plans code"
          sub="Friends in any country scan it or open the link to send you money"
          right={chev}
          onPress={() => router.push("/my-code")}
          testID="row-share-your-code"
        />
        <ListItem
          left={<Tile icon="link" />}
          title="Claim a link a friend sent you"
          sub="Paste it, or open it straight from your messages"
          right={chev}
          onPress={() => router.push("/join-link")}
          testID="row-claim-a-link"
          last={!isTestnet}
        />
        {isTestnet ? (
          <ListItem left={<Tile icon="gift" kind="a" />} title="Get test dollars" sub="Test version only · free, not real money" right={chev} onPress={() => router.push("/test-dollars")} testID="row-get-test-dollars" last />
        ) : null}
      </View>
      <View style={{ marginTop: 20 }}>
        <Banner kind="mut" icon="card" title="No card or bank top-up yet" text="Adding money from a card or bank isn't available yet. We'll add it country by country." />
      </View>
    </Screen>
  );
}
