/**
 * What backs the digital dollar: the balance-screen card (140), the AUSD pill that opens
 * "About digital dollars" (141), and that sheet. The live Agora figure is optional; when it can't
 * be fetched it's simply left out and the attestation line (bundled) stays.
 */
import { router } from "expo-router";
import * as Linking from "expo-linking";
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { AGORA_DATA_DOCS_URL, ATTESTATION, attestationLine, formatAsOf, formatSupply } from "../../lib/agora/backing";
import { useMonadSupply } from "../../lib/agora/useBacking";
import { useColors } from "../../theme/ThemeProvider";
import { fonts } from "../../theme/tokens";
import { Icon } from "../Icon";
import { Btn, Btns, Card, Hr, Row, Tile } from "../kit";
import { Sheet } from "../layout";
import { Txt } from "../Text";

function Line({ k, v, testID }: { k: string; v: string; testID?: string }) {
  return (
    <Row between align="flex-start" gap={12}>
      <Txt v="t13" color="muted">
        {k}
      </Txt>
      <Txt v="t13" weight="bold" style={{ flex: 1, textAlign: "right" }} testID={testID}>
        {v}
      </Txt>
    </Row>
  );
}

function OutLink({ label, url, testID }: { label: string; url: string; testID: string }) {
  const c = useColors();
  return (
    <Pressable testID={testID} accessibilityRole="link" accessibilityLabel={label} hitSlop={8} onPress={() => void Linking.openURL(url)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 13, color: c.info, textDecorationLine: "underline" }}>{label}</Txt>
      <Icon name="out" size={14} strokeWidth={2.2} color={c.info} />
    </Pressable>
  );
}

/** 140: who issues it, what backs it, the latest attestation and Agora's live Monad figures. */
export function BackingCard() {
  const supply = useMonadSupply();
  const live = supply.data;
  return (
    <Card style={{ marginTop: 16 }} testID="card-backing">
      <Row align="flex-start">
        <Tile icon="shieldok" kind="p" />
        <View style={{ flex: 1 }}>
          <Txt v="lt">Backed 1:1 by cash and short-term US Treasuries</Txt>
          <Txt v="t13" color="muted">
            Digital dollars (AUSD) are issued by Agora. Each one is backed by a dollar held in cash or short-term US Treasuries.
          </Txt>
        </View>
      </Row>
      <Hr />
      <View style={{ gap: 8 }}>
        <Line k="Reserves report" v={attestationLine()} testID="backing-attested" />
        {live ? (
          <>
            <Line k="In use on Monad" v={`${formatSupply(live.circulating)} of ${formatSupply(live.total)} issued`} testID="backing-supply" />
            {live.asOf ? <Line k="As of" v={`${formatAsOf(live.asOf)} · agora.finance`} testID="backing-as-of" /> : null}
          </>
        ) : null}
      </View>
      <Row between wrap style={{ marginTop: 12, rowGap: 8 }}>
        <OutLink label="See the report" url={ATTESTATION.url} testID="link-see-the-report" />
        <OutLink label="Agora's figures" url={AGORA_DATA_DOCS_URL} testID="link-agora-figures" />
        <Pressable testID="link-backing-what-could-go-wrong" accessibilityRole="button" hitSlop={8} onPress={() => router.push({ pathname: "/risks/[topic]", params: { topic: "frozen" } })}>
          <Txt v="t13" color="muted" weight="semi">
            What could go wrong
          </Txt>
        </Pressable>
      </Row>
    </Card>
  );
}

/** 141: four plain questions, with the uncomfortable one answered honestly. */
export function AboutDollarsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const supply = useMonadSupply();
  const qa: [string, string][] = [
    ["What is it?", "A digital dollar. Plans holds your money as AUSD so friends in any country share one currency."],
    ["Who issues it?", "Agora, a company that issues AUSD and publishes reports on its reserves."],
    ["What backs it?", "Cash and short-term US Treasuries, one dollar for each digital dollar, according to Agora's reserves report."],
    ["Can anything go wrong?", "Agora can freeze an account or pause transfers. Plans can't override that."],
  ];
  return (
    <Sheet visible={visible} onClose={onClose} testID="sheet-about-digital-dollars">
      <Txt v="d22">About digital dollars</Txt>
      {qa.map(([q, a]) => (
        <View key={q} style={{ marginTop: 12 }}>
          <Txt v="lt">{q}</Txt>
          <Txt v="t15" color="muted" style={{ marginTop: 2 }}>
            {a}
          </Txt>
        </View>
      ))}
      <Card tint p={12} style={{ marginTop: 16 }} testID="about-dollars-source">
        <Txt v="mono11">{`Source: Agora · reserves report ${attestationLine().replace(/^Attested/, "attested")}`}</Txt>
        {supply.data?.asOf ? <Txt v="mono11">{`Live figures as of ${formatAsOf(supply.data.asOf)}`}</Txt> : null}
      </Card>
      <Btns style={{ marginTop: 16 }}>
        <Btn
          label="What could go wrong"
          kind="sec"
          icon="shield"
          sm
          flex
          onPress={() => {
            onClose();
            router.push({ pathname: "/risks/[topic]", params: { topic: "frozen" } });
          }}
          testID="btn-about-what-could-go-wrong"
        />
        <Btn label="Got it" sm flex onPress={onClose} testID="btn-about-got-it" />
      </Btns>
    </Sheet>
  );
}

/** The "Digital dollars (AUSD)" pill; tapping it opens 141. */
export function AusdPill({ align = "center", testID = "pill-ausd" }: { align?: "center" | "flex-start" | "flex-end"; testID?: string }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ alignItems: align }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel="Digital dollars (AUSD)"
        accessibilityHint="Explains what backs it"
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.surface2 }}
      >
        <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 12 }}>Digital dollars (AUSD)</Txt>
        <Icon name="info" size={15} strokeWidth={2} />
      </Pressable>
      <AboutDollarsSheet visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}
