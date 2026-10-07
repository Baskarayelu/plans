import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { countryByCode, currencyFor, formatUsd } from "../lib/domain/currency";
import { wipe } from "../lib/crypto/bytes";
import { failureKind, passkeyNotice } from "../lib/identity/flows";
import { createLinkPasskey, identity, openFromBundle } from "../lib/identity/session";
import { startBrowserLink, type BrowserLink } from "../lib/link/browserLink";
import { thisBrowserLabel } from "../lib/link/deviceLabel";
import { syncThisDevice, vaultRef } from "../lib/link/deviceOps";
import { isLinkError } from "../lib/link/protocol";
import { SlotError } from "../lib/link/slots";
import { useMyPlans } from "../lib/state/data";
import { useStore } from "../lib/state/observable";
import { storage } from "../lib/state/storage";
import { useColors } from "../theme/ThemeProvider";
import { Icon } from "../ui/Icon";
import { Avatar, Banner, BigIcon, Btn, Chip, EmojiTile, FingerprintPill, ListItem, Row, Skel, Step, Tile } from "../ui/kit";
import { clock, CodeLetters, Fact, LinkFrame, LinkPictures, useOtherPhone } from "../ui/link/frame";
import { useLocal } from "../ui/money";
import { useLayout } from "../ui/shell/responsive";
import { Txt } from "../ui/Text";

type Phase = "intro" | "saving" | "code" | "linked";
type CodeState = "starting" | "waiting" | "offline" | "expired" | "failed";

/**
 * "Link this browser" on the computer (designs 168–170, 176b/c). Step 1 saves this browser's own
 * passkey ("Plans", lead's decision 3); step 2 shows a QR, the same code in letters and three
 * pictures, and waits for the phone; step 3 shows the account that arrived. The one-time link key
 * lives in lib/link/browserLink.ts; the code and this passkey's keys output (b2, kept here only to
 * make a new code and to list this browser) stay in memory and are wiped when the screen goes.
 * Nothing about the code ever goes in the address bar or a log.
 */
export default function LinkBrowser() {
  const { desk } = useLayout();
  const other = useOtherPhone();
  const phone = other ? "your other phone" : "your phone";
  const [phase, setPhase] = useState<Phase>("intro");
  const [introNotice, setIntroNotice] = useState<{ title: string; text: string; kind: string } | null>(null);
  const [link, setLink] = useState<BrowserLink | null>(null);
  const [codeState, setCodeState] = useState<CodeState>("starting");
  const [failText, setFailText] = useState("");
  const pk = useRef<{ credentialId: string; b2: Uint8Array } | null>(null);
  const live = useRef<{ link: BrowserLink | null; abort: AbortController | null }>({ link: null, abort: null });
  const mounted = useRef(true);
  const label = thisBrowserLabel() ?? "This browser";

  const stopLink = () => {
    live.current.abort?.abort();
    live.current.link?.cancel();
    live.current = { link: null, abort: null };
  };
  const forget = () => {
    stopLink();
    if (pk.current) wipe(pk.current.b2);
    pk.current = null;
  };
  useEffect(() => {
    mounted.current = true;
    // Already linked here (a reload of this page after step 3): nothing to link; open the account instead.
    void storage.loadAccount().then((a) => {
      if (!a?.vault || !mounted.current || pk.current) return;
      router.replace(identity.get().status === "unlocked" ? "/(tabs)" : "/unlock");
    });
    return () => {
      mounted.current = false;
      forget();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Back / Cancel → where the person came from (166, or 107 after the phone's passkey); a fresh tab → 166.
  const leave = () => {
    forget();
    if (router.canGoBack()) router.back();
    else if (identity.get().status === "unlocked") router.replace("/(tabs)");
    else router.replace({ pathname: "/welcome", params: { choose: "1" } });
  };

  const startCode = async () => {
    const key = pk.current;
    if (!key) return;
    stopLink();
    setLink(null);
    setCodeState("starting");
    setPhase("code");
    let l: BrowserLink;
    try {
      l = await startBrowserLink({ b2: key.b2, credentialId: key.credentialId, deviceLabel: label });
    } catch (e) {
      if (!mounted.current) return;
      setCodeState(e instanceof SlotError && (e.kind === "offline" || e.kind === "rate-limited") ? "offline" : "failed");
      setFailText(e instanceof SlotError ? e.friendly : "Something went wrong. Make a new code and try again.");
      return;
    }
    if (!mounted.current) return l.cancel();
    const abort = new AbortController();
    live.current = { link: l, abort };
    setLink(l);
    setCodeState("waiting");
    try {
      const bundle = await l.wait(abort.signal, (net) => {
        if (mounted.current && live.current.link === l) setCodeState((s) => (s === "waiting" || s === "offline" ? (net === "offline" ? "offline" : "waiting") : s));
      });
      // The vault is saved (wait() did it with b2); open the account here with this browser's passkey.
      await openFromBundle(bundle, key.credentialId);
      // List this browser on the account (the other devices get a notice). Best effort: linking worked either way.
      try {
        await syncThisDevice({ kind: "browser", label, vault: vaultRef(key.b2, key.credentialId) });
      } catch {
        /* the list catches up at the next unlock */
      }
      forget();
      if (mounted.current) setPhase("linked");
    } catch (e) {
      if (!mounted.current || abort.signal.aborted) return;
      if (isLinkError(e) && e.kind === "expired") setCodeState("expired");
      else if (e instanceof SlotError && e.kind === "offline") {
        setCodeState("failed");
        setFailText("Couldn't save this browser's link. Check this computer's connection and make a new code.");
      } else {
        setCodeState("failed");
        setFailText("That answer couldn't be used, so nothing was saved. Make a new code and try again.");
      }
    }
  };

  const save = async () => {
    setIntroNotice(null);
    setPhase("saving");
    try {
      const r = await createLinkPasskey("Plans");
      if (!mounted.current) return wipe(r.b2);
      pk.current = { credentialId: r.credentialId, b2: r.b2 };
      await startCode();
    } catch (e) {
      if (!mounted.current) return;
      const kind = failureKind(e);
      setPhase("intro");
      if (kind === "cancelled") setIntroNotice({ kind, title: "No passkey was saved", text: "You closed the passkey step before it finished. Nothing was saved." });
      else {
        const n = passkeyNotice(kind, "create");
        setIntroNotice({ kind, title: n.title, text: n.text });
      }
    }
  };

  if (phase === "linked") return <Linked other={other} />;

  if (phase === "intro" || phase === "saving") {
    const saving = phase === "saving";
    return (
      <LinkFrame
        step={1}
        testID="screen-link-save"
        dock={
          <>
            <Btn label={saving ? "Opening passkey…" : "Save a passkey here"} icon="key" loading={saving} disabled={saving} onPress={() => void save()} testID="btn-save-passkey-here" />
            <Btn label="Back" kind="txt" onPress={leave} disabled={saving} testID="btn-back" />
          </>
        }
      >
        <Txt v={desk ? "d44" : "d28"} accessibilityRole="header" style={{ marginTop: desk ? 0 : 8 }}>
          Save a passkey for this browser
        </Txt>
        <Txt v={desk ? "t17" : "t15"} color="muted" style={{ marginTop: 10, marginBottom: 20 }}>
          This browser gets its own passkey. Your account stays the same.
        </Txt>
        {introNotice ? (
          <View style={{ marginBottom: 16 }}>
            <Banner kind="mut" icon="info" title={introNotice.title} text={introNotice.text} testID={`link-notice-${introNotice.kind}`} />
          </View>
        ) : null}
        <View style={{ gap: 18 }}>
          <Fact
            icon="key"
            title="A new passkey, just for this browser"
            text={other ? "Saved where this browser keeps its passkeys. The passkey on your other phone stays there." : "Saved where this browser keeps its passkeys. Your phone's passkey stays on your phone."}
          />
          <Fact
            icon="phone"
            title={other ? "Your other phone says yes" : "Your phone says yes"}
            text={`Next you'll open Plans on ${phone} and scan a code. Nothing is shared until you confirm there.`}
          />
          <Fact icon="user" title="Still one account" text="Same plans, same money, same key fingerprint. Nothing new is made." />
        </View>
      </LinkFrame>
    );
  }

  return <CodeStep link={link} state={codeState} failText={failText} other={other} onNewCode={() => void startCode()} onRetry={() => (link ? setCodeState("waiting") : void startCode())} onCancel={leave} />;
}

/** 169 and its failures 176b (code ran out) / 176c (no connection). */
function CodeStep({
  link,
  state,
  failText,
  other,
  onNewCode,
  onRetry,
  onCancel,
}: {
  link: BrowserLink | null;
  state: CodeState;
  failText: string;
  other: boolean;
  onNewCode: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const c = useColors();
  const { desk } = useLayout();
  const dead = state === "expired" || state === "failed";
  const until = link ? clock(link.exp) : "";
  const qr = (
    <View
      style={{ padding: 12, backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: c.line, alignSelf: desk ? "flex-start" : "center", opacity: dead ? 0.25 : 1 }}
      accessibilityLabel={dead ? "This code ran out" : "Code to scan with your phone"}
      testID="link-qr"
    >
      {link ? <QRCode value={link.qrUrl} size={desk ? 168 : 200} color="#10231B" backgroundColor="#FFFFFF" ecl="M" quietZone={0} /> : <Skel w={desk ? 168 : 200} h={desk ? 168 : 200} r={8} />}
    </View>
  );
  const letters = (
    <View style={{ gap: 6, alignItems: desk ? "flex-start" : "center" }}>
      <Txt v="ov" color="muted">
        Or type this code
      </Txt>
      {link ? <CodeLetters code={link.displayCode} size={desk ? 28 : 24} dim={dead} center={!desk} /> : <Skel w={220} h={30} />}
      <Txt v="ov" color="muted" style={{ marginTop: 12 }} center={!desk}>
        {other ? "Check these match on your other phone" : "Check these match on your phone"}
      </Txt>
      {link ? <LinkPictures emoji={link.fingerprint} dim={dead} /> : <Skel w={140} h={44} r={22} />}
    </View>
  );
  let banner: React.ReactNode = null;
  if (state === "expired")
    banner = <Banner kind="neg" icon="clock" title="This code ran out" text="Codes work for 10 minutes. Make a new one, then scan it with your phone." testID="link-notice-expired" />;
  else if (state === "offline")
    banner = (
      <Banner
        kind="neg"
        icon="wifioff"
        title="Can't reach Plans right now"
        text={link ? `Your phone can still scan this code. Check this computer's connection, then try again. The code works until ${until}.` : "Check this computer's connection, then try again."}
        testID="link-notice-offline"
      />
    );
  else if (state === "failed") banner = <Banner kind="neg" icon="alert" title="This link didn't work" text={failText} testID="link-notice-failed" />;

  const buttons =
    state === "expired" || state === "failed" ? (
      <>
        <Btn label="Make a new code" icon="refresh" onPress={onNewCode} testID="btn-make-new-code" />
        <Btn label="Cancel" kind="txt" onPress={onCancel} testID="btn-cancel" />
      </>
    ) : state === "offline" ? (
      <>
        <Btn label="Try again" icon="refresh" onPress={onRetry} testID="btn-try-again" />
        <Btn label="Cancel" kind="txt" onPress={onCancel} testID="btn-cancel" />
      </>
    ) : (
      <Btn label="Cancel" kind="txt" onPress={onCancel} testID="btn-cancel" style={desk ? { alignSelf: "flex-start", paddingHorizontal: 0 } : undefined} />
    );

  const steps =
    state === "waiting" || state === "starting" ? (
      <View style={{ gap: 10, marginTop: 20 }}>
        <Step n={1}>
          <Txt v="t15">
            {other ? "On your other phone: " : "On your phone: "}
            <Txt v="t15" weight="bold">
              You → Add a browser
            </Txt>
          </Txt>
        </Step>
        <Step n={2}>Scan this code, or type it in</Step>
        <Step n={3}>{other ? "Check the three pictures match, then confirm" : "Check the three pictures match, then confirm with your fingerprint"}</Step>
      </View>
    ) : null;

  const waiting =
    state === "waiting" || state === "starting" ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, backgroundColor: c.surface2, marginTop: 20 }} testID="link-waiting">
        <Icon name="phone" size={20} color={c.ink} />
        <View style={{ flex: 1 }}>
          <Txt v="lt">{state === "starting" ? "Making a code…" : "Waiting for your phone…"}</Txt>
          {link ? (
            <Txt v="t13" color="muted">
              Expires at {until} · one use only
            </Txt>
          ) : null}
        </View>
      </View>
    ) : null;

  return (
    <LinkFrame step={2} testID="screen-link-code" dock={desk ? undefined : buttons}>
      <Txt v={desk ? "d44" : "d28"} accessibilityRole="header" style={{ marginTop: desk ? 0 : 8 }}>
        {other ? "Open Plans on your other phone" : "Open Plans on your phone"}
      </Txt>
      {desk ? (
        <Txt v="t17" color="muted" style={{ marginTop: 10 }}>
          Your phone confirms it's you. Then this browser can use your account.
        </Txt>
      ) : null}
      {banner ? <View style={{ marginTop: 16 }}>{banner}</View> : null}
      {desk ? (
        <Row align="center" gap={28} style={{ marginTop: 20 }}>
          {qr}
          <View style={{ flex: 1 }}>{letters}</View>
        </Row>
      ) : (
        <View style={{ gap: 18, marginTop: 16, alignItems: "center" }}>
          {qr}
          {letters}
        </View>
      )}
      {steps}
      {waiting}
      {desk ? <View style={{ marginTop: 16, width: 400, maxWidth: "100%", gap: 8 }}>{buttons}</View> : null}
    </LinkFrame>
  );
}

/** 170 This browser is linked: the same account, its key fingerprint, its plans. */
function Linked({ other }: { other: boolean }) {
  const st = useStore(identity, (s) => s);
  const plans = useMyPlans();
  const local = useLocal();
  const { desk } = useLayout();
  const p = st.profile;
  const cty = countryByCode(p?.country);
  const cur = currencyFor(p?.currency);
  const name = p?.name;
  const go = () => {
    if (!identity.get().profile) router.replace("/profile");
    else router.replace("/(tabs)");
  };
  const list = plans.data ?? [];
  return (
    <LinkFrame
      card
      testID="screen-link-done"
      step={desk ? undefined : 3}
      dock={<Btn label={name ? "Go to my plans" : "Continue"} onPress={go} testID="btn-go-to-my-plans" />}
    >
      <View style={{ alignSelf: "flex-start" }}>
        <BigIcon icon="check" kind="p" />
      </View>
      <Txt v={desk ? "d34" : "d28"} style={{ marginTop: 16 }} accessibilityRole="header">
        This browser is linked
      </Txt>
      <Row style={{ marginTop: 14 }}>
        <Avatar initial={(name?.[0] ?? "?").toUpperCase()} color="#D9634B" size={52} flag={cty?.flag} />
        <View style={{ flex: 1 }}>
          <Txt v="d22" testID="link-done-name">
            {name ?? "Your account"}
          </Txt>
          {p ? (
            <Txt v="t13" color="muted">
              {[p.city, `${cur.symbol.trim()} ${cur.code}`].filter(Boolean).join(" · ")}
            </Txt>
          ) : null}
        </View>
      </Row>
      <Row wrap style={{ marginTop: 14 }} gap={10}>
        <FingerprintPill emoji={st.fingerprint} />
        <Chip label={other ? "Same as on your other phone" : "Same as on your phone"} tone="pos" icon="check" sm />
      </Row>
      <View style={{ marginTop: 8 }} testID="link-done-plans">
        {plans.isLoading ? (
          [0, 1].map((i) => (
            <Row key={i} style={{ minHeight: 60 }}>
              <Skel w={40} h={40} r={12} />
              <View style={{ flex: 1, gap: 8 }}>
                <Skel w="60%" h={12} />
                <Skel w="35%" h={10} />
              </View>
            </Row>
          ))
        ) : plans.isError ? (
          <ListItem left={<Tile icon="refresh" />} title="Couldn't load your plans" sub="Try again" onPress={() => void plans.refetch()} testID="link-done-retry" last />
        ) : (
          list.slice(0, 3).map((pl, i) => (
            <ListItem
              key={pl.pot}
              left={<EmojiTile emoji={pl.meta.emoji} color={pl.meta.color} size={40} />}
              title={pl.meta.name}
              sub={`${pl.status === "Settled" ? "Ended" : "Active"} · ${pl.memberCount} people`}
              right={
                pl.myNet === 0n ? (
                  <Txt v="lt" color="muted">
                    All square
                  </Txt>
                ) : (
                  <Txt v="lt" color={pl.myNet > 0n ? "pos" : "neg"}>
                    {local.fmt(pl.myNet, { sign: true }) ?? formatUsd(pl.myNet, { sign: true })}
                  </Txt>
                )
              }
              rsub={pl.myNet === 0n ? undefined : pl.myNet > 0n ? "owed to you" : "you owe"}
              last={i === Math.min(list.length, 3) - 1}
            />
          ))
        )}
      </View>
      <View style={{ marginTop: 12 }}>
        <Banner kind="mut" icon="key" title="Next time, just use the passkey saved here." text={other ? "You won't need your other phone." : "You won't need your phone."} testID="link-done-next-time" />
      </View>
    </LinkFrame>
  );
}
