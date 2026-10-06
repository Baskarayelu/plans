import * as Haptics from "expo-haptics";
import React from "react";
import { Pressable, View } from "react-native";
import { fonts } from "../theme/tokens";
import { Icon } from "./Icon";
import { Txt } from "./Text";

/** Number pad (design .kp). Edits a decimal string with at most `decimals` places. */
export function Keypad({ value, onChange, decimals = 2, max = 9 }: { value: string; onChange: (v: string) => void; decimals?: number; max?: number }) {
  const press = (k: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (k === "del") return onChange(value.slice(0, -1));
    if (k === ".") {
      if (decimals === 0 || value.includes(".")) return;
      return onChange((value || "0") + ".");
    }
    const [i, f] = value.split(".");
    if (f !== undefined && f.length >= decimals) return;
    if (f === undefined && i.replace(/^0+/, "").length >= max) return;
    if (value === "0") return onChange(k);
    onChange(value + k);
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -8 }}>
      {keys.map((k) => (
        <Pressable
          key={k}
          testID={`key-${k === "." ? "dot" : k}`}
          accessibilityRole="button"
          accessibilityLabel={k === "del" ? "Delete" : k === "." ? "Point" : k}
          onPress={() => press(k)}
          style={({ pressed }) => ({ width: "33.333%", height: 58, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
        >
          {k === "del" ? <Icon name="back" size={26} strokeWidth={2} /> : <Txt style={{ fontFamily: fonts.displayBold, fontSize: 26 }}>{k === "." && decimals === 0 ? "" : k}</Txt>}
        </Pressable>
      ))}
    </View>
  );
}
