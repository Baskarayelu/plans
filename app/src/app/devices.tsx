import { router } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { identity } from "../lib/identity/session";
import type { DeviceEntry } from "../lib/link/devices";
import { useStore } from "../lib/state/observable";
import { Banner, Btn, Card, Skel } from "../ui/kit";
import { AppBar, Screen, Sheet } from "../ui/layout";
import { DeskColumn } from "../ui/desk/money";
import { DeviceRow, RemoveConfirm, useDevices } from "../ui/link/devices";
import { SidePanel } from "../ui/shell/panel";
import { useLayout } from "../ui/shell/responsive";
import { Txt } from "../ui/Text";

/**
 * "Devices with your passkey" as its own page (171 → the list; 178 on a laptop opens Remove in the
 * right panel). Each linked browser can be removed from here, from any device with the account,
 * with a passkey confirmation on this device (lead's decision 5).
 */
export default function Devices() {
  const { desk } = useLayout();
  const { devices, myId } = useDevices();
  const keysPending = useStore(identity, (s) => s.keysPending);
  const [removing, setRemoving] = useState<DeviceEntry | null>(null);
  const confirm = removing ? <RemoveConfirm d={removing} me={removing.id === myId} onCancel={() => setRemoving(null)} onDone={() => setRemoving(null)} /> : null;
  return (
    <Screen testID="screen-devices" dock={<Btn label="Add a browser" icon="plus" onPress={() => router.push("/add-browser")} testID="btn-add-browser" />}>
      <AppBar title="Devices with your passkey" />
      <DeskColumn>
        <Txt v="t15" color="muted" style={{ marginBottom: 12 }}>
          Every device that can use your account. A linked browser has its own passkey; removing it only stops that browser.
        </Txt>
        <Card style={{ paddingVertical: 6 }} testID="devices-list">
          {devices === null ? (
            <View style={{ gap: 12, paddingVertical: 10 }}>
              <Skel w="70%" h={14} />
              <Skel w="50%" h={12} />
            </View>
          ) : devices.length === 0 ? (
            <Txt v="t15" color="muted" style={{ paddingVertical: 12 }}>
              Only this device so far.
            </Txt>
          ) : (
            devices.map((d) => <DeviceRow key={d.id} d={d} me={d.id === myId} onRemove={() => setRemoving(d)} highlight={removing?.id === d.id} />)
          )}
        </Card>
        {devices === null && keysPending ? (
          <View style={{ marginTop: 12 }}>
            <Banner kind="mut" icon="info" title="The list opens with your key" text="It appears once your receipts are unlocked on this device." />
          </View>
        ) : null}
      </DeskColumn>
      {desk ? (
        removing ? (
          <SidePanel kind="detail" onClose={() => setRemoving(null)}>
            {confirm}
          </SidePanel>
        ) : null
      ) : (
        <Sheet visible={!!removing} onClose={() => setRemoving(null)} testID="sheet-remove-browser">
          {confirm}
        </Sheet>
      )}
    </Screen>
  );
}
