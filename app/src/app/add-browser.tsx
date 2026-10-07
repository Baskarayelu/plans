import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { wipe } from "../lib/crypto/bytes";
import { failureKind, handlePasskeyFailure } from "../lib/identity/flows";
import { identity } from "../lib/identity/session";
import { formatCodeInput, isCompleteCode } from "../lib/link/codeInput";
import { fetchOfferByCode, labelForQrOffer, readLinkFromQr, sendAccountToBrowser, type PhoneLinkOffer } from "../lib/link/phoneLink";
import { ADD_BROWSER_SEEN } from "../lib/link/deviceOps";
import { pendingLinkQr, takePendingLinkQr } from "../lib/link/pending";
import { isLinkError, LINK_TTL_SEC } from "../lib/link/protocol";
import { SlotError } from "../lib/link/slots";
import { kvSet } from "../lib/state/kv";
import { useStore } from "../lib/state/observable";
import { useColors } from "../theme/ThemeProvider";
import { dark, fonts } from "../theme/tokens";
import { CameraView, ScanFromPhoto, useCameraPermissions, type BarcodeScanningResult } from "../ui/camera";
import { Icon, type IconName } from "../ui/Icon";
import { Banner, BigIcon, Btn, Card, Field, Row } from "../ui/kit";
import { AppBar, Screen } from "../ui/layout";
import { DeskColumn } from "../ui/desk/money";
import { clock, Fact, LinkPictures } from "../ui/link/frame";
import { useConfirmLabel, useLayout } from "../ui/shell/responsive";
import { Txt } from "../ui/Text";

const WEB = Platform.OS === "web";
const C = dark;

type Step =
  | { s: "scan" }
  | { s: "type"; error?: string }
  | { s: "check"; offer: PhoneLinkOffer; label?: string; error?: "offline" | "failed"; detail?: string }
  | { s: "sent"; label?: string; fingerprint?: string }
  | { s: "mismatch" }
  | { s: "expired" }
  | { s: "used" };

/**
 * "Add a browser" (designs 171–175): the device that has the account approves a new browser. The
 * camera opens framed for the computer's QR (always dark), or the 12-character code is typed; then
 * the three pictures are compared, and only "They match" plus a passkey confirmation sends the
 * account (lib/link/phoneLink.ts). Offered on every device with the account, the web app included
 * (lead's decision 7), so an iPhone-only person can approve from any linked browser.
 */
export default function AddBrowser() {
  const status = useStore(identity, (s) => s.status);
  const { desk } = useLayout();
  const [step, setStep] = useState<Step>(() => (desk ? { s: "type" } : { s: "scan" }));
  const offerRef = useRef<PhoneLinkOffer | null>(null);

  useEffect(() => {
    void kvSet(ADD_BROWSER_SEEN, "1");
    return () => {
      if (offerRef.current) wipe(offerRef.current.s);
    };
  }, []);
  // A link QR opened as an address (a phone's camera app): straight to the pictures once the account
  // is open (the page load locks it, so Unlock comes first). The web may mount this screen more than
  // once around Unlock, so the code is only read here and forgotten when the person finishes or leaves.
  useEffect(() => {
    if (status !== "unlocked") return;
    const qr = pendingLinkQr.get();
    if (qr) void openQr(qr);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    takePendingLinkQr();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/you");
  };
  const toCheck = (offer: PhoneLinkOffer, label?: string) => {
    if (offerRef.current && offerRef.current !== offer) wipe(offerRef.current.s);
    offerRef.current = offer;
    setStep({ s: "check", offer, label });
  };
  const dropOffer = () => {
    if (offerRef.current) wipe(offerRef.current.s);
    offerRef.current = null;
    takePendingLinkQr();
  };

  async function openQr(text: string): Promise<boolean> {
    try {
      const offer = readLinkFromQr(text);
      const label = await labelForQrOffer(offer);
      toCheck(offer, label);
      return true;
    } catch (e) {
      if (isLinkError(e) && e.kind === "expired") {
        takePendingLinkQr();
        setStep({ s: "expired" });
      }
      return false;
    }
  }

  if (status === "none")
    return (
      <Screen testID="screen-add-browser-none">
        <AppBar icon="x" onBack={() => router.replace("/welcome")} title="Add a browser" />
        <DeskColumn>
          <Banner
            kind="inf"
            icon="info"
            title="Your Plans account isn't in this browser"
            text="Open Plans on the phone or browser that has your account, choose You → Add a browser, and scan the code there."
            testID="add-browser-no-account"
          />
        </DeskColumn>
      </Screen>
    );

  switch (step.s) {
    case "scan":
      return (
        <ScanStep
          onClose={close}
          onType={() => setStep({ s: "type" })}
          onQr={openQr}
          noCamera={<TypeStep onBack={close} allowCamera={() => void Linking.openSettings()} onOffer={toCheck} onExpired={() => setStep({ s: "expired" })} />}
        />
      );
    case "type":
      return <TypeStep error={step.error} onBack={() => (desk ? close() : setStep({ s: "scan" }))} onScan={desk ? () => setStep({ s: "scan" }) : undefined} onOffer={toCheck} onExpired={() => setStep({ s: "expired" })} />;
    case "check":
      return (
        <CheckStep
          step={step}
          onClose={() => {
            dropOffer();
            setStep(desk ? { s: "type" } : { s: "scan" });
          }}
          onMismatch={() => {
            dropOffer();
            setStep({ s: "mismatch" });
          }}
          onResult={(next) => {
            if (next.s !== "check") dropOffer(); // sent (already wiped) or dead
            setStep(next);
          }}
        />
      );
    case "sent":
      return <SentStep label={step.label} fingerprint={step.fingerprint} onDone={close} />;
    default:
      return <ProblemStep kind={step.s} onDone={close} onScanAgain={() => setStep(desk ? { s: "type" } : { s: "scan" })} />;
  }
}

// ─────────────── 172 scan ───────────────

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

function ScanStep({ onClose, onType, onQr, noCamera }: { onClose: () => void; onType: () => void; onQr: (text: string) => Promise<boolean>; noCamera: React.ReactNode }) {
  const ins = useSafeAreaInsets();
  const { desk } = useLayout();
  const [perm, requestPerm] = useCameraPermissions();
  const [notLink, setNotLink] = useState(false);
  const last = useRef("");
  const busy = useRef(false);

  useEffect(() => {
    if (perm && !perm.granted && perm.status === "undetermined" && perm.canAskAgain) void requestPerm();
  }, [perm?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScan = async (r: BarcodeScanningResult) => {
    const data = r.data ?? "";
    if (!data || data === last.current || busy.current) return;
    last.current = data;
    busy.current = true;
    const ok = await onQr(data);
    busy.current = false;
    if (ok) void Haptics.selectionAsync().catch(() => undefined);
    else {
      setNotLink(true);
      setTimeout(() => {
        setNotLink(false);
        last.current = "";
      }, 3000);
    }
  };

  const granted = perm?.granted;
  // No camera: the type-in screen with "Allow camera" above it (172 states).
  if (perm && !granted && !perm.canAskAgain && !WEB) return <>{noCamera}</>;

  return (
    <View style={{ flex: 1, backgroundColor: "#0B0F0D" }} testID="screen-add-browser-scan">
      <StatusBar style="light" />
      {granted ? (
        <CameraView testID="scanner" style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(r) => void onScan(r)} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "#141B17" }]} />
      )}
      <View style={{ position: "absolute", left: 0, right: 0, top: ins.top, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", minHeight: 64 }}>
        <Pressable testID="btn-close" accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={6} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
          <Icon name="x" color="#FFFFFF" />
        </Pressable>
        <Txt style={{ flex: 1, marginLeft: 4, fontFamily: fonts.displayBold, fontSize: 18, color: "#FFFFFF" }}>Add a browser</Txt>
      </View>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: "22%", alignItems: "center" }}>
        <View style={{ width: 240, height: 240 }}>
          {corner({ left: 0, top: 0, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 18 })}
          {corner({ right: 0, top: 0, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 18 })}
          {corner({ left: 0, bottom: 0, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 18 })}
          {corner({ right: 0, bottom: 0, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 18 })}
        </View>
      </View>
      <View style={{ position: "absolute", left: 24, right: 24, top: "58%", alignItems: "center", gap: 8 }}>
        {notLink ? (
          <View testID="scan-not-link" style={{ backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, marginBottom: 6 }}>
            <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 15, color: "#FFFFFF" }}>That isn't a code for linking a browser</Txt>
          </View>
        ) : null}
        {granted || !perm ? (
          <>
            <Txt style={{ fontFamily: fonts.bodySemi, fontSize: 17, color: "#FFFFFF", textAlign: "center" }}>Point at the code on the computer's screen</Txt>
            <Txt v="t13" center style={{ color: "#FFFFFF", opacity: 0.8 }}>
              On the computer, open plans.0xo.in/app and choose “Link this browser to your account”.
            </Txt>
          </>
        ) : (
          <Txt v="d22" center style={{ color: "#FFFFFF" }}>
            Plans needs the camera to scan the code
          </Txt>
        )}
        <Row gap={8} style={{ marginTop: 6 }} align="flex-start">
          <Icon name="shield" size={16} color="#FFFFFF" />
          <Txt v="t13" style={{ color: "#FFFFFF", opacity: 0.8, flexShrink: 1 }}>
            Only scan a code on a computer you're using right now.
          </Txt>
        </Row>
      </View>
      <View style={[{ position: "absolute", left: 16, right: 16, bottom: 24 + ins.bottom, gap: 8 }, desk ? { left: "50%", right: undefined, width: 400, marginLeft: -200 } : null]}>
        {!granted && perm ? (
          <DarkButton primary label="Allow camera" icon="camera" testID="btn-allow-camera" onPress={() => (perm.canAskAgain ? void requestPerm() : void Linking.openSettings())} />
        ) : null}
        <ScanFromPhoto dark onScan={(data) => void onScan({ data, type: "qr" } as BarcodeScanningResult)} onNone={() => setNotLink(true)} />
        <DarkButton label="Type the code instead" icon="edit" testID="btn-type-code" onPress={onType} />
      </View>
    </View>
  );
}

// ─────────────── 172 type / 175 wrong code ───────────────

function TypeStep({
  error: error0,
  onBack,
  onScan,
  onOffer,
  onExpired,
  allowCamera,
}: {
  error?: string;
  onBack: () => void;
  onScan?: () => void;
  onOffer: (o: PhoneLinkOffer, label?: string) => void;
  onExpired?: () => void;
  allowCamera?: () => void;
}) {
  const c = useColors();
  const [value, setValue] = useState("");
  const [error, setError] = useState(error0);
  const [busy, setBusy] = useState(false);
  const complete = isCompleteCode(value);
  const go = async () => {
    if (!complete || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const o = await fetchOfferByCode(value);
      onOffer(o, o.deviceLabel);
    } catch (e) {
      if (isLinkError(e) && e.kind === "expired") onExpired?.();
      else if (e instanceof SlotError && (e.kind === "offline" || e.kind === "rate-limited")) setError(e.friendly);
      else setError("That code doesn't match. Check it against the computer's screen and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen testID="screen-add-browser-type" dock={<Btn label="Continue" onPress={() => void go()} disabled={!complete} loading={busy} testID="btn-continue" />}>
      <AppBar title="Type the code" onBack={onBack} />
      <DeskColumn>
        {allowCamera ? (
          <View style={{ marginBottom: 12 }}>
            <Banner kind="mut" icon="camera" title="Plans can't use the camera" text="Type the code instead, or allow the camera in settings.">
              <Btn label="Allow camera" kind="txt" sm onPress={allowCamera} testID="btn-allow-camera" style={{ height: 36, minHeight: 36, paddingHorizontal: 0 }} />
            </Banner>
          </View>
        ) : null}
        <Txt v="t15" color="muted" style={{ marginBottom: 12 }}>
          You'll find it on the computer, under the square code.
        </Txt>
        <Field
          label="Code"
          value={value}
          onChangeText={(t) => {
            setValue(formatCodeInput(t));
            setError(undefined);
          }}
          placeholder="XXXX-XXXX-XXXX"
          autoFocus
          testID="field-link-code"
          inputProps={{
            autoCapitalize: "characters",
            autoCorrect: false,
            spellCheck: false,
            autoComplete: "off",
            onSubmitEditing: () => void go(),
            style: { fontFamily: fonts.monoSemi, fontSize: 22, letterSpacing: 1.5, color: c.ink, padding: 0, margin: 0 },
          }}
        />
        {error ? (
          <Row gap={6} align="flex-start" style={{ marginTop: 6 }}>
            <Icon name="alert" size={16} color={c.neg} />
            <Txt v="t13" color="neg" style={{ flex: 1 }} testID="add-browser-code-error">
              {error}
            </Txt>
          </Row>
        ) : (
          <Txt v="t13" color="muted" style={{ marginTop: 6 }}>
            12 letters and numbers. Capitals or not, it doesn't matter. We add the dashes.
          </Txt>
        )}
        <Card tint style={{ marginTop: 16 }}>
          <Txt v="t13" color="muted">
            Looks like
          </Txt>
          <Txt style={{ fontFamily: fonts.monoSemi, fontSize: 18, letterSpacing: 1.5, marginTop: 4 }}>XXXX-XXXX-XXXX</Txt>
          <Txt v="t13" color="muted" style={{ marginTop: 4 }}>
            No O or I, so 0 and 1 are always numbers.
          </Txt>
        </Card>
        {onScan ? <Btn label="Scan the code with this camera" kind="txt" icon="scan" sm onPress={onScan} testID="btn-scan-code" style={{ marginTop: 12, paddingHorizontal: 0 }} /> : null}
        {WEB ? (
          <Txt v="t13" color="muted" style={{ marginTop: 16 }}>
            On the other browser, open plans.0xo.in/app and choose “Link this browser to your account”.
          </Txt>
        ) : null}
      </DeskColumn>
    </Screen>
  );
}

// ─────────────── 173 check the pictures ───────────────

function CheckStep({ step, onClose, onMismatch, onResult }: { step: Extract<Step, { s: "check" }>; onClose: () => void; onMismatch: () => void; onResult: (s: Step) => void }) {
  const c = useColors();
  const confirmLabel = useConfirmLabel();
  const [busy, setBusy] = useState(false);
  const [inline, setInline] = useState<string | undefined>();
  const profile = useStore(identity, (s) => s.profile);
  const madeAt = clock(step.offer.exp - LINK_TTL_SEC);
  const until = clock(step.offer.exp);

  const send = async () => {
    setBusy(true);
    setInline(undefined);
    try {
      const r = await sendAccountToBrowser(step.offer, profile);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      onResult({ s: "sent", label: step.label, fingerprint: r.fingerprint });
    } catch (e) {
      if (isLinkError(e)) {
        if (e.kind === "expired") return onResult({ s: "expired" });
        if (e.kind === "used") return onResult({ s: "used" });
        return onResult({ ...step, error: "failed", detail: e.kind === "wrong-account" ? "This passkey belongs to a different account than the one here. Nothing was sent." : "Nothing was sent. Make a new code on the computer and try again." });
      }
      if (e instanceof SlotError) return onResult({ ...step, error: "offline" });
      // A closed passkey step: nothing was sent, stay here.
      if (failureKind(e) !== "cancelled") setInline(handlePasskeyFailure(e, "restore").inline);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="screen-add-browser-check"
      dock={
        step.error === "offline" ? (
          <>
            <Btn label="Try again" icon="refresh" onPress={() => void send()} loading={busy} testID="btn-try-again" />
            <Btn label="Cancel" kind="sec" onPress={onClose} testID="btn-cancel" />
          </>
        ) : (
          <>
            <Btn label={`They match · ${confirmLabel}`} icon={confirmLabel.endsWith("fingerprint") ? "fp" : "key"} onPress={() => void send()} loading={busy} testID="btn-they-match" style={{ paddingHorizontal: 10 }} />
            <Btn label="They don't match" kind="sec" onPress={onMismatch} disabled={busy} testID="btn-they-dont-match" />
          </>
        )
      }
    >
      <AppBar icon="x" onBack={onClose} title="Check the pictures" />
      <DeskColumn width={520}>
        <Txt v="ov" color="muted" center style={{ marginTop: 8 }}>
          Pictures for this link
        </Txt>
        <View style={{ marginTop: 10 }}>
          <LinkPictures emoji={step.offer.fingerprint} big testID="add-browser-pictures" />
        </View>
        <Txt v="d28" center style={{ marginTop: 18 }} accessibilityRole="header">
          Do these match the screen you're linking?
        </Txt>
        <Txt v="t13" color="muted" center style={{ marginTop: 6 }}>
          Same three, same order. If even one is different, it's not your computer.
        </Txt>
        <Card style={{ marginTop: 16 }} testID="add-browser-device">
          <Row align="flex-start">
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
              <Icon name="globe" size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt v="lt">{step.label ? `Says it's ${step.label}` : "A browser"}</Txt>
              <Txt v="t13" color="muted">
                Wants to use your account · code made at {madeAt}
              </Txt>
            </View>
          </Row>
        </Card>
        {step.error === "offline" ? (
          <View style={{ marginTop: 16 }}>
            <Banner kind="neg" icon="wifioff" title="Couldn't reach Plans" text={`Nothing was sent. Check your connection and try again. The code works until ${until}.`} testID="add-browser-offline" />
          </View>
        ) : step.error === "failed" ? (
          <View style={{ marginTop: 16 }}>
            <Banner kind="neg" icon="alert" title="This link didn't work" text={step.detail} testID="add-browser-failed" />
          </View>
        ) : (
          <Txt v="t13" color="muted" style={{ marginTop: 16 }}>
            {WEB
              ? "If they match, this browser gives the new one what it needs to use your account. It gets its own passkey; the one here stays here."
              : "If they match, your phone gives this browser what it needs to use your account. It gets its own passkey; yours stays on this phone."}
          </Txt>
        )}
        {inline ? (
          <Txt v="t13" color="neg" style={{ marginTop: 10 }} testID="add-browser-message">
            {inline}
          </Txt>
        ) : null}
      </DeskColumn>
    </Screen>
  );
}

// ─────────────── 174 sent ───────────────

function SentStep({ label, fingerprint, onDone }: { label?: string; fingerprint?: string; onDone: () => void }) {
  const name = label ?? "This browser";
  const here = WEB ? "This browser's passkey stays here." : "Your phone's passkey stays on your phone.";
  return (
    <Screen testID="screen-add-browser-sent" dock={<Btn label="Done" onPress={onDone} testID="btn-done" />}>
      <DeskColumn width={520}>
        <View style={{ marginTop: 40 }}>
          <BigIcon icon="check" kind="p" />
        </View>
        <Txt v="d28" center style={{ marginTop: 16 }} accessibilityRole="header">
          {name} can now use your account
        </Txt>
        <Txt v="t15" color="muted" center style={{ marginTop: 8 }}>
          It has its own passkey. {here}
        </Txt>
        <View style={{ gap: 18, marginTop: 24 }}>
          <Fact icon="user" title="Same account" text={`Same plans, same money, same key fingerprint${fingerprint ? ` ${fingerprint}` : ""}.`} />
          <Fact icon="key" title="Listed under Devices with your passkey" text={`${name} · Linked · its own passkey. Remove it there any time.`} />
          <Fact icon="bell" title="We'll tell you" text="You get a notice here whenever a browser is added or removed." />
        </View>
      </DeskColumn>
    </Screen>
  );
}

// ─────────────── 175 problems ───────────────

function ProblemStep({ kind, onDone, onScanAgain }: { kind: "mismatch" | "expired" | "used"; onDone: () => void; onScanAgain: () => void }) {
  const c = useColors();
  const { desk } = useLayout();
  const again = desk ? "Type a new code" : "Scan a new code";
  const content =
    kind === "mismatch"
      ? { icon: "ban" as IconName, tone: "n" as const, title: "Stop. Don't link it.", text: "Nothing was sent. Make a new code on the computer and try again." }
      : kind === "expired"
        ? { icon: "clock" as IconName, tone: "m" as const, title: "This code ran out", text: "This code ran out. Make a new one on the computer." }
        : { icon: "link" as IconName, tone: "m" as const, title: "This code was already used", text: "Each code works once. Make a new one on the computer and scan that." };
  return (
    <Screen
      testID={`screen-add-browser-${kind}`}
      dock={
        kind === "mismatch" ? (
          <Btn label="Done" onPress={onDone} testID="btn-done" />
        ) : (
          <>
            <Btn label={again} icon="scan" onPress={onScanAgain} testID="btn-scan-new-code" />
            <Btn label="Done" kind="sec" onPress={onDone} testID="btn-done" />
          </>
        )
      }
    >
      <AppBar icon="x" onBack={onDone} />
      <DeskColumn width={520}>
        <View style={{ flex: 1, justifyContent: "center", paddingVertical: 24 }}>
          <BigIcon icon={content.icon} kind={content.tone} />
          <Txt v="d28" center style={{ marginTop: 16 }} accessibilityRole="header">
            {content.title}
          </Txt>
          <Txt v="t15" color="muted" center style={{ marginTop: 8 }}>
            {content.text}
          </Txt>
          {kind === "expired" ? (
            <Txt v="t13" color="muted" center style={{ marginTop: 8 }}>
              Codes work for 10 minutes, once.
            </Txt>
          ) : null}
          {kind === "used" ? (
            <Txt v="t13" color="muted" center style={{ marginTop: 8 }}>
              If you didn't use it, look in You → Devices with your passkey for anything you don't recognise.
            </Txt>
          ) : null}
          {kind === "mismatch" ? (
            <View style={{ flexDirection: "row", gap: 10, padding: 14, borderRadius: 14, backgroundColor: c.surface2, marginTop: 20 }} testID="add-browser-not-you">
              <Icon name="shield" size={20} color={c.ink} />
              <View style={{ flex: 1 }}>
                <Txt v="lt">Didn't start this yourself?</Txt>
                <Txt v="t13" color="muted">
                  Someone may have shown you their code. Your account hasn't changed and there's nothing else to do.
                </Txt>
              </View>
            </View>
          ) : null}
        </View>
      </DeskColumn>
    </Screen>
  );
}
