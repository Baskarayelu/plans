import { CameraView, ScanFromPhoto, useCameraPermissions, type BarcodeScanningResult } from "../../ui/camera";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { countryByCode } from "../../lib/domain/currency";
import { parseLink, type ParsedLink } from "../../lib/domain/links";
import { rememberCode } from "../../lib/domain/planOps";
import { hrefForLink } from "../../lib/send/route";
import { personFor, useMe } from "../../lib/state/data";
import { dark, fonts } from "../../theme/tokens";
import { Icon, type IconName } from "../../ui/Icon";
import { Avatar } from "../../ui/kit";
import { useLayout } from "../../ui/shell/responsive";
import { Txt } from "../../ui/Text";

const C = dark;

function DarkIconBtn({ name, label, onPress, testID, on }: { name: IconName; label: string; onPress: () => void; testID: string; on?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!on }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: on ? C.accent : pressed ? "rgba(255,255,255,0.14)" : "transparent" })}
    >
      <Icon name={name} color={on ? C.onAccent : "#FFFFFF"} />
    </Pressable>
  );
}

function DarkButton({ label, icon, onPress, testID, primary }: { label: string; icon?: IconName; onPress: () => void; testID: string; primary?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ height: 56, borderRadius: 999, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: primary ? C.accent : "rgba(255,255,255,0.14)", opacity: pressed ? 0.85 : 1 })}
    >
      {icon ? <Icon name={icon} size={22} strokeWidth={2} color={primary ? C.onAccent : "#FFFFFF"} /> : null}
      <Txt style={{ fontFamily: fonts.bodyBold, fontSize: 17, color: primary ? C.onAccent : "#FFFFFF" }}>{label}</Txt>
    </Pressable>
  );
}

const corner = (pos: object) => <View style={[{ position: "absolute", width: 44, height: 44, borderColor: C.accent }, pos]} />;

/** 44 Scan a Plans code. Always dark (it is a camera). */
export default function Scan() {
  const ins = useSafeAreaInsets();
  const { desk } = useLayout();
  const { address } = useMe();
  const [perm, requestPerm] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [found, setFound] = useState<ParsedLink | null>(null);
  const [notPlans, setNotPlans] = useState(false);
  const last = useRef<string>("");
  const clearT = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clearT.current) clearTimeout(clearT.current);
  }, []);

  // First time: ask straight away, so the camera opens into scanning.
  useEffect(() => {
    if (perm && !perm.granted && perm.status === "undetermined" && perm.canAskAgain) void requestPerm();
  }, [perm?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/send"));

  const onScan = (r: BarcodeScanningResult) => {
    const data = r.data ?? "";
    if (!data || data === last.current) return;
    last.current = data;
    const link = parseLink(data);
    if (clearT.current) clearTimeout(clearT.current);
    if (!link) {
      setFound(null);
      setNotPlans(true);
      clearT.current = setTimeout(() => {
        setNotPlans(false);
        last.current = "";
      }, 3000);
      return;
    }
    setNotPlans(false);
    setFound(link);
    void Haptics.selectionAsync().catch(() => undefined);
  };

  const open = () => {
    if (!found) return;
    if (found.kind === "code") {
      if (address && found.address === address.toLowerCase()) return;
      rememberCode(found.address, { name: found.name, city: found.city, country: found.country, currency: found.currency });
    }
    router.replace(hrefForLink(found) as never);
  };

  const granted = perm?.granted;
  let chipText = "";
  let chipSub = "";
  let chipInitial = "P";
  let chipColor = "#3C78B8";
  if (found?.kind === "code") {
    const p = personFor(found.address);
    const name = found.name || p.name;
    const place = found.city || p.city || countryByCode(found.country ?? p.country)?.name;
    chipText = address && found.address === address.toLowerCase() ? "That's your own code" : `${name}${place ? ` · ${place}` : ""}`;
    chipInitial = (name[0] ?? "?").toUpperCase();
    chipColor = p.color;
  } else if (found?.kind === "claim") {
    chipText = found.sender ? `Money from ${found.sender}` : "A Plans money link";
    chipSub = "Tap to claim it";
  } else if (found?.kind === "invite") {
    chipText = found.inviter ? `Invite from ${found.inviter}` : "A Plans invite";
    chipSub = "Tap to see the plan";
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0B0F0D" }} testID="screen-scan">
      <StatusBar style="light" />
      {granted ? (
        <CameraView
          testID="scanner"
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onScan}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "#141B17" }]} />
      )}

      <View style={{ position: "absolute", left: 0, right: 0, top: ins.top, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", minHeight: 64 }}>
        <DarkIconBtn name="x" label="Close" onPress={close} testID="btn-close" />
        <Txt style={{ flex: 1, marginLeft: 4, fontFamily: fonts.displayBold, fontSize: 18, color: "#FFFFFF" }}>Scan a Plans code</Txt>
        {granted ? <DarkIconBtn name="torch" label={torch ? "Light off" : "Light on"} onPress={() => setTorch((t) => !t)} testID="btn-torch" on={torch} /> : null}
      </View>

      {granted ? (
        <>
          <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: "26%", alignItems: "center" }}>
            <View style={{ width: 240, height: 240 }}>
              {corner({ left: 0, top: 0, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 18 })}
              {corner({ right: 0, top: 0, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 18 })}
              {corner({ left: 0, bottom: 0, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 18 })}
              {corner({ right: 0, bottom: 0, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 18 })}
            </View>
          </View>
          <View style={{ position: "absolute", left: 16, right: 16, top: "62%", alignItems: "center" }}>
            {found ? (
              <Pressable
                testID="scanned-chip"
                accessibilityRole="button"
                accessibilityLabel={chipText}
                onPress={open}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFFFFF", borderRadius: 999, paddingVertical: 6, paddingLeft: 6, paddingRight: 14, opacity: pressed ? 0.85 : 1 })}
              >
                {found.kind === "code" ? <Avatar initial={chipInitial} color={chipColor} size={36} /> : <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" }}><Icon name={found.kind === "claim" ? "gift" : "ticket"} size={20} color="#10231B" /></View>}
                <View>
                  <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 15, color: "#10231B" }}>{chipText}</Txt>
                  {chipSub ? <Txt style={{ fontFamily: fonts.body, fontSize: 12, color: "#5A6B62" }}>{chipSub}</Txt> : null}
                </View>
                <Icon name="chev" size={18} strokeWidth={2.4} color="#10231B" />
              </Pressable>
            ) : notPlans ? (
              <View testID="scan-not-plans" style={{ backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 }}>
                <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 15, color: "#FFFFFF" }}>That code isn't a Plans code</Txt>
              </View>
            ) : null}
            <Txt v="t13" center style={{ marginTop: 14, color: "#FFFFFF", opacity: 0.75 }}>
              Point at a friend's Plans code
            </Txt>
          </View>
        </>
      ) : (
        <View style={{ position: "absolute", left: 24, right: 24, top: "30%", alignItems: "center", gap: 12 }} testID="scan-no-permission">
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" }}>
            <Icon name="camera" size={34} color="#FFFFFF" />
          </View>
          <Txt v="d22" center style={{ color: "#FFFFFF" }}>
            {perm === null ? "Opening the camera…" : "Plans needs the camera to scan codes"}
          </Txt>
          <Txt v="t15" center style={{ color: "#FFFFFF", opacity: 0.75 }}>
            The camera is only used while this screen is open.
          </Txt>
        </View>
      )}

      <View style={[{ position: "absolute", left: 16, right: 16, bottom: 24 + ins.bottom, gap: 8 }, desk ? { left: "50%", right: undefined, width: 400, marginLeft: -200 } : null]}>
        {!granted && perm ? (
          <DarkButton
            primary
            label="Allow camera"
            icon="camera"
            testID="btn-allow-camera"
            onPress={() => {
              if (perm.canAskAgain) void requestPerm();
              else void Linking.openSettings();
            }}
          />
        ) : null}
        <ScanFromPhoto dark onScan={(data) => onScan({ data, type: "qr" } as BarcodeScanningResult)} onNone={() => setNotPlans(true)} />
        <DarkButton label="Show my code" icon="qr" testID="btn-show-my-code" onPress={() => router.push("/my-code")} />
      </View>
    </View>
  );
}
