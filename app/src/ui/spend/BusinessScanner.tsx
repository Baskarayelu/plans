/**
 * Full-screen scanner for a business's Plans code (screen 20 → camera). A Plans code link
 * (https://plans.0xo.in/p/<payee>#n=<name>…) gives the payee and its name. A pasted link works too.
 */
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Linking from "expo-linking";
import React, { useRef, useState } from "react";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { parseLink, type CodeLink } from "../../lib/domain/links";
import { useColors } from "../../theme/ThemeProvider";
import { Banner, Btn, Field, IconBtn } from "../kit";
import { Txt } from "../Text";

export function BusinessScanner({ visible, onClose, onCode }: { visible: boolean; onClose: () => void; onCode: (c: CodeLink) => void }) {
  const c = useColors();
  const ins = useSafeAreaInsets();
  const [perm, requestPerm] = useCameraPermissions();
  const [err, setErr] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const done = useRef(false);

  const handle = (text: string): boolean => {
    const l = parseLink(text);
    if (l?.kind === "code") {
      if (done.current) return true;
      done.current = true;
      onCode(l);
      setTimeout(() => (done.current = false), 1500);
      return true;
    }
    setErr(l ? "That's a Plans link, but not a business's code." : "That's not a Plans code. Ask the business to show theirs.");
    return false;
  };

  const onScan = (r: BarcodeScanningResult) => {
    if (done.current) return;
    handle(r.data);
  };

  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000" }} testID="screen-scan-business">
        {perm?.granted ? (
          <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={visible ? onScan : undefined} />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
            <Txt v="d22" color="#FFFFFF" center>
              Scan a Plans code
            </Txt>
            <Txt v="t15" color="#FFFFFF" center style={{ opacity: 0.8 }}>
              We use the camera only to read the code.
            </Txt>
            {perm && !perm.canAskAgain ? (
              <Btn label="Open settings" kind="pri" onPress={() => void Linking.openSettings()} testID="btn-open-settings" />
            ) : (
              <Btn label="Allow camera" kind="pri" icon="camera" onPress={() => void requestPerm()} testID="btn-allow-camera" />
            )}
          </View>
        )}
        {/* frame */}
        {perm?.granted ? (
          <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 240, height: 240, borderRadius: 24, borderWidth: 3, borderColor: c.accent }} />
            <Txt v="t15" color="#FFFFFF" center style={{ marginTop: 16 }}>
              Point at the business's Plans code
            </Txt>
          </View>
        ) : null}
        <View style={{ position: "absolute", top: ins.top + 8, left: 8 }}>
          <IconBtn name="x" label="Close" onPress={onClose} color="#FFFFFF" testID="btn-close-scanner" />
        </View>
        <View style={{ position: "absolute", left: 16, right: 16, bottom: ins.bottom + 16, gap: 8 }}>
          {err ? <Banner kind="neg" icon="alert" title="Try again" text={err} testID="scan-error" /> : null}
          <View style={{ backgroundColor: c.surface, borderRadius: 16, padding: 10, gap: 8 }}>
            <Field label="Or paste their code link" value={paste} onChangeText={(t) => { setPaste(t); setErr(null); }} placeholder="plans.0xo.in/p/…" testID="field-paste-code" inputProps={{ autoCapitalize: "none", autoCorrect: false }} />
            <Btn label="Use this link" kind="sec" sm disabled={!paste.trim()} onPress={() => handle(paste)} testID="btn-use-this-link" />
          </View>
        </View>
      </View>
    </Modal>
  );
}
