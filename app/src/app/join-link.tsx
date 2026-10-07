/** Join with a link or code: paste an invite, claim link or Plans code, or scan its QR. */
import { CameraView, ScanFromPhoto, useCameraPermissions } from "../ui/camera";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import { Linking, View } from "react-native";
import { toBase64Url } from "../lib/crypto/bytes";
import { parseLink, type ParsedLink } from "../lib/domain/links";
import { useColors } from "../theme/ThemeProvider";
import { Banner, Btn, Field, Row, Tile } from "../ui/kit";
import { AppBar } from "../ui/layout";
import { DeskScreen } from "../ui/desk/money";
import { Txt } from "../ui/Text";

function q(o: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") out[k] = v;
  return out;
}

function openParsedLink(l: ParsedLink): void {
  const nav = (href: { pathname: string; params: Record<string, string> }) => router.replace(href);
  if (l.kind === "invite") nav({ pathname: "/join", params: q({ pot: l.pot, s: toBase64Url(l.secret), n: l.inviter }) });
  else if (l.kind === "claim") nav({ pathname: "/claim", params: q({ k: toBase64Url(l.key), n: l.sender, m: l.note, a: l.amount }) });
  else nav({ pathname: "/send/amount", params: q({ to: l.address, n: l.name, c: l.city, cc: l.country, cur: l.currency, a: l.amount }) });
}

function describe(l: ParsedLink): { icon: "users" | "gift" | "send"; title: string; sub: string } {
  if (l.kind === "invite") return { icon: "users", title: "Invite to a plan", sub: l.inviter ? `From ${l.inviter}` : "Open it to see the plan" };
  if (l.kind === "claim") return { icon: "gift", title: "Money to collect", sub: l.sender ? `From ${l.sender}` : "Open it to collect" };
  return { icon: "send", title: `Send to ${l.name ?? "this person"}`, sub: l.city ?? "Plans code" };
}

export default function JoinLink() {
  const c = useColors();
  const [text, setText] = useState("");
  const [scan, setScan] = useState(false);
  const [perm, requestPerm] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);
  const parsed = text.trim() ? parseLink(text) : null;

  const paste = async () => {
    const s = await Clipboard.getStringAsync().catch(() => "");
    if (!s) {
      setError("There's nothing to paste. Copy the link first.");
      return;
    }
    setText(s.trim());
    setError(parseLink(s) ? null : "That doesn't look like a Plans link or code.");
  };

  const open = () => {
    if (!parsed) {
      setError("That doesn't look like a Plans link or code.");
      return;
    }
    openParsedLink(parsed);
  };

  const startScan = async () => {
    setError(null);
    if (!perm?.granted) {
      const r = await requestPerm();
      if (!r.granted) {
        setError(r.canAskAgain ? "Plans needs the camera to scan a code." : "Camera is off for Plans. Turn it on in Settings to scan.");
        return;
      }
    }
    handled.current = false;
    setScan(true);
  };

  const onScanned = (data: string) => {
    if (handled.current) return;
    const l = parseLink(data);
    if (!l) {
      setError("That code isn't a Plans code.");
      return;
    }
    handled.current = true;
    setScan(false);
    openParsedLink(l);
  };

  const d = parsed ? describe(parsed) : null;

  return (
    <DeskScreen testID="screen-join-link" dock={<Btn label="Open" icon="chev" disabled={!parsed} onPress={open} testID="btn-open-link" />}>
      <AppBar title="Join with a link or code" />
      <Txt v="t15" color="muted" style={{ marginBottom: 16 }}>
        Paste an invite or a Plans link a friend sent you, or scan their code.
      </Txt>
      <Field
        label="Link"
        value={text}
        onChangeText={(t) => {
          setText(t);
          setError(null);
        }}
        placeholder="plans.0xo.in/j/…"
        testID="field-link"
        right={<Btn label="Paste" kind="sec" sm onPress={() => void paste()} style={{ height: 40 }} testID="btn-paste" />}
        inputProps={{ autoCapitalize: "none", autoCorrect: false }}
      />
      {d ? (
        <Row style={{ marginTop: 12 }} gap={12}>
          <Tile icon={d.icon} kind="p" />
          <View style={{ flex: 1 }}>
            <Txt v="lt">{d.title}</Txt>
            <Txt v="t13" color="muted">
              {d.sub}
            </Txt>
          </View>
        </Row>
      ) : null}
      {error ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title={error} testID="banner-link-error">
            {perm && !perm.granted && !perm.canAskAgain ? (
              <Btn label="Open Settings" kind="sec" sm onPress={() => void Linking.openSettings()} style={{ marginTop: 8, height: 40 }} testID="btn-open-settings" />
            ) : null}
          </Banner>
        </View>
      ) : null}

      <View style={{ marginTop: 20 }}>
        {scan ? (
          <View style={{ borderRadius: 18, overflow: "hidden", backgroundColor: "#000", height: 320 }} testID="scanner">
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(r) => onScanned(r.data)} />
            <View pointerEvents="none" style={{ position: "absolute", left: 60, right: 60, top: 60, bottom: 60, borderWidth: 3, borderColor: c.accent, borderRadius: 20 }} />
          </View>
        ) : null}
        <Btn label={scan ? "Stop scanning" : "Scan a code"} kind={scan ? "sec" : "out"} icon="scan" onPress={() => (scan ? setScan(false) : void startScan())} style={{ marginTop: scan ? 12 : 0 }} testID="btn-scan-code" />
        <View style={{ marginTop: 8 }}>
          <ScanFromPhoto onScan={onScanned} onNone={() => setError("We couldn't find a Plans code in that photo.")} />
        </View>
      </View>
    </DeskScreen>
  );
}
