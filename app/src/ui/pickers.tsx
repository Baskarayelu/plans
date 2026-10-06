import React, { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { COUNTRIES, CURRENCIES, type Country } from "../lib/domain/currency";
import { useColors } from "../theme/ThemeProvider";
import { Field, Radio } from "./kit";
import { Sheet } from "./layout";
import { Txt } from "./Text";

export function CountrySheet({ visible, onClose, value, onPick }: { visible: boolean; onClose: () => void; value?: string; onPick: (c: Country) => void }) {
  const c = useColors();
  const [q, setQ] = useState("");
  const list = useMemo(() => COUNTRIES.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()) || x.code.toLowerCase() === q.toLowerCase()), [q]);
  return (
    <Sheet visible={visible} onClose={onClose} testID="sheet-country">
      <Txt v="d22">Where do you live?</Txt>
      <View style={{ marginTop: 12 }}>
        <Field label="Search" value={q} onChangeText={setQ} placeholder="Country" testID="field-country-search" />
      </View>
      <FlatList
        style={{ maxHeight: 380, marginTop: 8 }}
        data={list}
        keyExtractor={(x) => x.code}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            testID={`country-${item.code}`}
            accessibilityRole="button"
            accessibilityLabel={item.name}
            onPress={() => {
              onPick(item);
              onClose();
            }}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderBottomWidth: 1, borderBottomColor: c.line }}
          >
            <Txt style={{ fontSize: 22 }}>{item.flag}</Txt>
            <Txt v="lt" style={{ flex: 1 }}>
              {item.name}
            </Txt>
            <Radio on={item.code === value} />
          </Pressable>
        )}
      />
    </Sheet>
  );
}

export function CurrencySheet({ visible, onClose, value, onPick }: { visible: boolean; onClose: () => void; value?: string; onPick: (code: string) => void }) {
  const c = useColors();
  const list = Object.values(CURRENCIES);
  return (
    <Sheet visible={visible} onClose={onClose} testID="sheet-currency">
      <Txt v="d22">Show money in</Txt>
      <Txt v="t13" color="muted" style={{ marginTop: 4 }}>
        Dollars always come first. This is the money shown next to them.
      </Txt>
      <FlatList
        style={{ maxHeight: 420, marginTop: 8 }}
        data={list}
        keyExtractor={(x) => x.code}
        renderItem={({ item }) => (
          <Pressable
            testID={`currency-${item.code}`}
            accessibilityRole="button"
            accessibilityLabel={item.name}
            onPress={() => {
              onPick(item.code);
              onClose();
            }}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderBottomWidth: 1, borderBottomColor: c.line }}
          >
            <Txt v="lt" style={{ width: 48 }}>
              {item.symbol.trim()}
            </Txt>
            <Txt v="t15" style={{ flex: 1 }}>
              {item.name} ({item.code})
            </Txt>
            <Radio on={item.code === value} />
          </Pressable>
        )}
      />
    </Sheet>
  );
}
