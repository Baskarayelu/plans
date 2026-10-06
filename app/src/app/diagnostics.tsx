/**
 * Hidden Diagnostics (long-press the version row in You). Developer-facing, so it uses technical
 * words the rest of the app avoids; it is excluded from scripts/check-copy.mjs.
 *
 * PRF probe: one passkey ceremony requesting both salts; shows whether `first` and `second` came
 * back, their sha256 fingerprints, the derived address, the X25519 fingerprint and provider info.
 * Also logged with tag PLANS_PRF:  adb logcat -s PLANS_PRF
 */
import * as Clipboard from "expo-clipboard";
import React, { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { deviceInfo } from "../../modules/plans-native";
import { applyEndpointOverrides, config } from "../config";
import { getHealth } from "../lib/api/relayer";
import { liveStatus } from "../lib/chain/live";
import { runPrfProbe, type ProbeResult } from "../lib/identity/probe";
import { identity } from "../lib/identity/session";
import { lastCeremonyDiagnostics } from "../lib/identity/webauthnClient";
import { useStore } from "../lib/state/observable";
import { storage } from "../lib/state/storage";
import { Banner, Btn, Btns, Card, Field, Row } from "../ui/kit";
import { AppBar, Screen } from "../ui/layout";
import { Txt } from "../ui/Text";

function KV({ k, v, testID }: { k: string; v?: string | number | boolean | null; testID?: string }) {
  return (
    <Row between align="flex-start" style={{ paddingVertical: 3 }}>
      <Txt v="mono11" color="muted" style={{ width: 120 }}>
        {k}
      </Txt>
      <Txt v="mono11" style={{ flex: 1, textAlign: "right" }} selectable testID={testID}>
        {v === undefined || v === null ? "—" : String(v)}
      </Txt>
    </Row>
  );
}

export default function Diagnostics() {
  const st = useStore(identity, (s) => s);
  const live = useStore(liveStatus, (s) => s.state);
  const liveMethod = useStore(liveStatus, (s) => s.method);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [busy, setBusy] = useState<"get" | "create" | null>(null);
  const [health, setHealth] = useState<string>("not checked");
  const [relayerUrl, setRelayerUrl] = useState(config.relayerUrl);
  const [graphqlUrl, setGraphqlUrl] = useState(config.graphqlUrl);
  const [rpcUrl, setRpcUrl] = useState(config.rpcUrl);
  const [wsUrl, setWsUrl] = useState(config.wsUrl);
  const dev = deviceInfo();

  useEffect(() => {
    void getHealth().then((h) => setHealth(h.ok ? `ok (${h.ms} ms, chain ${String(h.body?.chainId ?? "?")})` : `unreachable (${h.ms} ms)`));
  }, []);

  const run = async (mode: "get" | "create") => {
    setBusy(mode);
    try {
      setProbe(await runPrfProbe(mode));
    } finally {
      setBusy(null);
    }
  };

  const saveEndpoints = async () => {
    const endpoints = { relayerUrl, graphqlUrl, rpcUrl, wsUrl };
    applyEndpointOverrides(endpoints);
    const p = await storage.loadPrefs();
    await storage.savePrefs({ ...p, endpoints });
    const h = await getHealth();
    setHealth(h.ok ? `ok (${h.ms} ms)` : `unreachable (${h.ms} ms)`);
  };

  const last = lastCeremonyDiagnostics();
  const report = JSON.stringify({ probe, identity: { status: st.status, address: st.address, fingerprint: st.fingerprint, keysPending: st.keysPending }, config, device: dev, last }, null, 2);

  return (
    <Screen testID="screen-diagnostics">
      <AppBar title="Diagnostics" sub="Hidden · for testing" />
      <Banner kind="inf" icon="key" title="Two-keys PRF probe" text="One passkey prompt asks for both salts. Raw outputs are never shown; only sha256 prefixes. Results also go to logcat (tag PLANS_PRF)." />
      <Btns style={{ marginTop: 12 }}>
        <Btn label="Probe: existing passkey" kind="pri" sm flex onPress={() => run("get")} loading={busy === "get"} disabled={!!busy} testID="btn-probe-get" />
        <Btn label="Probe: new passkey" kind="sec" sm flex onPress={() => run("create")} loading={busy === "create"} disabled={!!busy} testID="btn-probe-create" />
      </Btns>

      {probe ? (
        <Card style={{ marginTop: 12 }} testID="probe-result">
          <Txt v="d17" color={probe.ok ? (probe.secondReturned ? "pos" : "info") : "neg"} testID="probe-headline">
            {probe.ok ? (probe.secondReturned ? "Both PRF outputs returned" : "Only `first` returned") : "Probe failed"}
          </Txt>
          <View style={{ marginTop: 8 }}>
            <KV k="mode" v={probe.mode} />
            <KV k="first" v={probe.firstReturned ? "yes" : "no"} testID="probe-first" />
            <KV k="second" v={probe.secondReturned ? "yes" : "no"} testID="probe-second" />
            <KV k="sha256(first)" v={probe.firstSha256} />
            <KV k="sha256(second)" v={probe.secondSha256} />
            <KV k="address" v={probe.address} testID="probe-address" />
            <KV k="x25519 key" v={probe.x25519Fingerprint} testID="probe-fingerprint" />
            <KV k="provider" v={probe.provider} />
            <KV k="aaguid" v={probe.aaguid} />
            <KV k="credential" v={probe.credentialId ? `${probe.credentialId.slice(0, 16)}…` : undefined} />
            <KV k="ceremonies" v={probe.ceremonies.map((c) => `${c.kind}:${c.gotFirst ? "1" : "-"}${c.gotSecond ? "2" : "-"}${c.prfEnabled !== undefined ? (c.prfEnabled ? "E" : "e") : ""}`).join(" ")} />
            <KV k="ext keys" v={probe.ceremonies.map((c) => (c.extensionKeys ?? []).join("+")).join(" | ")} />
            <KV k="error" v={probe.error} />
          </View>
        </Card>
      ) : null}

      <Card style={{ marginTop: 12 }}>
        <Txt v="ov" color="muted">
          This phone
        </Txt>
        <KV k="android" v={`${dev?.release ?? Platform.Version} (sdk ${dev?.sdkInt ?? Platform.Version})`} />
        <KV k="model" v={dev ? `${dev.manufacturer} ${dev.model}` : undefined} />
        <KV k="emulator" v={dev?.isEmulator} />
        <KV k="credential svc" v={dev?.credentialService ?? dev?.credentialServicePrimary} />
        <KV k="autofill svc" v={dev?.autofillService} />
        <KV k="gms" v={dev?.gmsVersion} />
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Txt v="ov" color="muted">
          Session
        </Txt>
        <KV k="status" v={st.status} />
        <KV k="address" v={st.address} testID="diag-address" />
        <KV k="key fingerprint" v={st.fingerprint} testID="diag-fingerprint" />
        <KV k="keys pending" v={st.keysPending} />
        <KV k="key registered" v={st.keyRegistered} />
        <KV k="live feed" v={`${live}${liveMethod ? ` (${liveMethod})` : ""}`} />
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Txt v="ov" color="muted">
          Build
        </Txt>
        <KV k="network" v={`${config.network} (${config.chainId})`} />
        <KV k="rpId" v={config.rpId} />
        <KV k="deployed" v={config.deployed} />
        <KV k="ausd" v={config.contracts.ausd} />
        <KV k="factory" v={config.contracts.plansFactory} />
        <KV k="keyRegistry" v={config.contracts.keyRegistry} />
        <KV k="claimEscrow" v={config.contracts.claimEscrow} />
        <KV k="plansSend" v={config.contracts.plansSend} />
        <KV k="relayer" v={health} />
      </Card>

      <Card style={{ marginTop: 12, gap: 8 }}>
        <Txt v="ov" color="muted">
          Endpoints (saved on this phone)
        </Txt>
        <Field label="Relayer" value={relayerUrl} onChangeText={setRelayerUrl} testID="field-relayer-url" inputProps={{ autoCapitalize: "none", autoCorrect: false }} />
        <Field label="GraphQL" value={graphqlUrl} onChangeText={setGraphqlUrl} testID="field-graphql-url" inputProps={{ autoCapitalize: "none", autoCorrect: false }} />
        <Field label="RPC" value={rpcUrl} onChangeText={setRpcUrl} testID="field-rpc-url" inputProps={{ autoCapitalize: "none", autoCorrect: false }} />
        <Field label="WebSocket" value={wsUrl} onChangeText={setWsUrl} testID="field-ws-url" inputProps={{ autoCapitalize: "none", autoCorrect: false }} />
        <Btn label="Save endpoints" kind="sec" sm onPress={saveEndpoints} testID="btn-save-endpoints" />
      </Card>

      <Btn label="Copy report" kind="out" icon="copy" style={{ marginTop: 12 }} onPress={() => void Clipboard.setStringAsync(report)} testID="btn-copy-report" />
    </Screen>
  );
}
