/**
 * "Devices with your passkey" (designs 171, 178; lead's decision 8: the same words on phones and
 * laptops): the account's devices, each linked browser with Remove, and the in-app notices other
 * devices see on their next open (decision 5). Data: lib/link/deviceOps.ts.
 */
import * as Device from "expo-device";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { failureKind, handlePasskeyFailure } from "../../lib/identity/flows";
import { identity } from "../../lib/identity/session";
import { thisBrowserLabel } from "../../lib/link/deviceLabel";
import { activeDevices, devicesStore, refreshDevices, removeDevice, syncThisDevice, takeDeviceNotices } from "../../lib/link/deviceOps";
import type { DeviceEntry } from "../../lib/link/devices";
import { useStore } from "../../lib/state/observable";
import { useColors } from "../../theme/ThemeProvider";
import { ComputerIcon, IconWell } from "../desk/money";
import { Icon } from "../Icon";
import { Btn, Chip } from "../kit";
import { useConfirmLabel } from "../shell/responsive";
import { showToast } from "../Toast";
import { Txt } from "../Text";

const WEB = Platform.OS === "web";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (unix: number) => {
  const d = new Date(unix * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/** This device's own name: "Chrome on a Mac" in a browser, the phone's model on Android. */
export function myDeviceLabel(): string {
  if (WEB) return thisBrowserLabel() ?? "This browser";
  return Device.modelName ?? "This phone";
}

/** The account's devices (not removed), this one first; refreshed when a screen showing them opens. */
export function useDevices(): { devices: DeviceEntry[] | null; myId?: string } {
  const st = useStore(devicesStore);
  const status = useStore(identity, (s) => s.status);
  const keysPending = useStore(identity, (s) => s.keysPending);
  const address = useStore(identity, (s) => s.address?.toLowerCase());
  useEffect(() => {
    if (status === "unlocked" && !keysPending) void refreshDevices().catch(() => undefined);
  }, [status, keysPending]);
  if (!st.list || st.address !== address) return { devices: null };
  return { devices: activeDevices(st.list, st.myId), myId: st.myId };
}

/** One line for a device: "This browser · Linked · its own passkey", "Your phone", … */
export function deviceSub(d: DeviceEntry, me: boolean): string {
  const own = d.linked ? "Linked · its own passkey" : d.kind === "phone" ? "Your passkey" : "Same passkey";
  if (me) return `${d.kind === "phone" ? "This phone" : "This browser"} · ${own}`;
  return d.kind === "phone" && !d.linked ? "Your phone · your passkey" : own;
}

/** A device row (178's card list and the phone list): icon, name, line, Remove for linked browsers. */
export function DeviceRow({ d, me, onRemove, highlight }: { d: DeviceEntry; me: boolean; onRemove?: () => void; highlight?: boolean }) {
  const c = useColors();
  return (
    <View
      testID={me ? "device-this" : `device-${d.id}`}
      style={[{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }, highlight ? { borderWidth: 2, borderColor: c.neg, borderRadius: 14, paddingHorizontal: 10, marginHorizontal: -10 } : null]}
    >
      <IconWell>{d.kind === "phone" ? <Icon name="phone" size={22} /> : <ComputerIcon />}</IconWell>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt v="lt" numberOfLines={1}>
          {d.label}
        </Txt>
        <Txt v="t13" color="muted">
          {me ? (
            <>
              <Txt v="t13" color="pos">
                {d.kind === "phone" ? "This phone" : "This browser"}
              </Txt>
              {` · ${deviceSub(d, false)}`}
            </>
          ) : (
            deviceSub(d, false)
          )}
        </Txt>
      </View>
      {d.linked && onRemove ? (
        <Btn label="Remove" kind="txt" sm onPress={onRemove} testID={me ? "btn-remove-this" : `btn-remove-${d.id}`} style={{ height: 36, minHeight: 36, paddingHorizontal: 4 }} />
      ) : me ? (
        <Chip label="This one" sm tone="pos" />
      ) : null}
    </View>
  );
}

/**
 * 178 "Remove this browser?": a passkey confirmation on this device, then the browser's own
 * passkey stops opening the account. In the laptop's right panel, or a sheet on phones.
 */
export function RemoveConfirm({ d, me, onCancel, onDone }: { d: DeviceEntry; me: boolean; onCancel: () => void; onDone?: () => void }) {
  const c = useColors();
  const confirmLabel = useConfirmLabel();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | undefined>();
  const go = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      const r = await removeDevice(d);
      if (r.self) router.replace({ pathname: "/welcome", params: { removed: "1" } });
      else {
        showToast({ title: `${d.label} was removed`, sub: "Its passkey no longer opens your account." });
        onDone?.();
      }
    } catch (e) {
      if (failureKind(e) === "cancelled") setMsg(undefined);
      else setMsg(handlePasskeyFailure(e, "restore").inline ?? "That didn't work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View testID="panel-remove-browser">
      <IconWell size={56}>
        <ComputerIcon size={26} color={c.neg} />
      </IconWell>
      <Txt v="d28" style={{ marginTop: 14 }} accessibilityRole="header">
        Remove this browser?
      </Txt>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: c.surface2, marginTop: 14 }}>
        <ComputerIcon />
        <View style={{ flex: 1 }}>
          <Txt v="lt">{d.label}</Txt>
          <Txt v="t13" color="muted">
            Linked {day(d.addedAt)} · its own passkey
          </Txt>
        </View>
      </View>
      <Txt v="t15" style={{ marginTop: 14 }}>
        {me ? "Only this browser stops using your account. Your phone, your plans and your money don't change." : "Only that browser stops using your account. Your plans and your money don't change, and this device stays as it is."}
      </Txt>
      <Txt v="t13" color="muted" style={{ marginTop: 8 }}>
        {me
          ? "The passkey saved here stops working for Plans. To use Plans here again, link it again from your phone."
          : "The passkey saved in that browser stops working for Plans. To use Plans there again, link it again."}
      </Txt>
      {msg ? (
        <Txt v="t13" color="neg" style={{ marginTop: 10 }} testID="remove-message">
          {msg}
        </Txt>
      ) : null}
      <View style={{ gap: 8, marginTop: 20 }}>
        <Btn label={`Remove · ${confirmLabel}`} kind="dng" icon="key" onPress={() => void go()} loading={busy} testID="btn-confirm-remove" />
        <Btn label="Cancel" kind="sec" onPress={onCancel} disabled={busy} testID="btn-cancel-remove" />
      </View>
    </View>
  );
}

/**
 * Mounted once at the root: when the account is open with its keys, this device takes its place
 * in the list, and changes made elsewhere ("Chrome on a Mac can now use your account", "… was
 * removed") show once as a notice (lead's decision 5: in the app on next open, no push).
 */
export function DeviceWatch() {
  const status = useStore(identity, (s) => s.status);
  const keysPending = useStore(identity, (s) => s.keysPending);
  const address = useStore(identity, (s) => s.address?.toLowerCase());
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "unlocked" || keysPending || !address || done.current === address) return;
    done.current = address;
    void (async () => {
      try {
        const list = await syncThisDevice({ kind: WEB ? "browser" : "phone", label: myDeviceLabel() });
        const myId = devicesStore.get().myId;
        if (!list || !myId) return;
        const events = await takeDeviceNotices(list, address, myId);
        // One notice: the newest change, and how many more there are (the list has them all).
        const e = events[events.length - 1];
        if (!e) return;
        const more = events.length > 1 ? ` ${events.length - 1} more ${events.length === 2 ? "change" : "changes"} in You → Devices with your passkey.` : "";
        showToast(
          e.kind === "added"
            ? { title: `${e.label} can now use your account`, sub: `Not you? Remove it in You → Devices with your passkey.${more}`, onPress: () => router.push("/devices") }
            : { title: `${e.label} was removed from your account`, sub: `Its own passkey no longer opens Plans.${more}`, onPress: () => router.push("/devices") },
        );
      } catch {
        done.current = null; // try again at the next unlock
      }
    })();
  }, [status, keysPending, address]);
  return null;
}

/** "Pixel 8 (this one) · Chrome on a Mac" for the You row; null when the list isn't open yet. */
export function devicesLine(devices: DeviceEntry[] | null, myId: string | undefined): string | null {
  if (!devices || devices.length === 0) return null;
  return devices
    .slice(0, 3)
    .map((d) => (d.id === myId ? `${d.label} (${d.kind === "phone" ? "this one" : d.linked ? "this browser, linked" : "this browser"})` : d.label))
    .join(" · ");
}

/**
 * 178's list inside the laptop You page's key card: every device with Remove for linked browsers,
 * then "+ Link another browser" (lead's decision 7: any device with the account can approve one).
 * `fallback` is shown while the list isn't available (keys not unlocked, offline).
 */
export function DeskDeviceList({ onRemove, removingId, fallback }: { onRemove: (d: DeviceEntry, me: boolean) => void; removingId?: string; fallback: React.ReactNode }) {
  const { devices, myId } = useDevices();
  return (
    <View testID="device-list">
      {devices && devices.length > 0 ? devices.map((d) => <DeviceRow key={d.id} d={d} me={d.id === myId} onRemove={() => onRemove(d, d.id === myId)} highlight={removingId === d.id} />) : fallback}
      <Btn
        label="+ Link another browser"
        kind="txt"
        sm
        onPress={() => router.push("/add-browser")}
        testID="btn-link-another-browser"
        style={{ alignSelf: "flex-start", height: 36, minHeight: 36, paddingHorizontal: 0, marginTop: 6 }}
      />
    </View>
  );
}
