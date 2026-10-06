import { getLocales } from "expo-localization";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { countryByCode, currencyFor, formatUsd } from "../lib/domain/currency";
import { identity, saveProfile } from "../lib/identity/session";
import { useStore } from "../lib/state/observable";
import { Avatar, Banner, Btn, Card, Field, Row } from "../ui/kit";
import { AppBar, Screen } from "../ui/layout";
import { useLocal } from "../ui/money";
import { CountrySheet, CurrencySheet } from "../ui/pickers";
import { Txt } from "../ui/Text";
import { Icon } from "../ui/Icon";

/** 03 Name, country, currency — the only form in sign-up. Also reused from You → Country & money (edit=1). */
export default function ProfileSetup() {
  const { next, edit } = useLocalSearchParams<{ next?: string; edit?: string }>();
  const existing = useStore(identity, (s) => s.profile);
  const guess = useMemo(() => {
    const l = getLocales()[0];
    return countryByCode(l?.regionCode ?? undefined)?.code ?? "GB";
  }, []);
  const [name, setName] = useState(existing?.name ?? "");
  const [country, setCountry] = useState(existing?.country ?? guess);
  const [city, setCity] = useState(existing?.city ?? "");
  const [currency, setCurrency] = useState(existing?.currency ?? countryByCode(existing?.country ?? guess)?.currency ?? "USD");
  const [pick, setPick] = useState<"country" | "currency" | null>(null);
  const [saving, setSaving] = useState(false);
  const cty = countryByCode(country);
  const cur = currencyFor(currency);
  const local = useLocal(currency);
  const valid = name.trim().length >= 1 && name.trim().length <= 30;

  const save = async () => {
    setSaving(true);
    await saveProfile({ name: name.trim(), country, currency, city: city.trim() || undefined });
    setSaving(false);
    if (edit) router.back();
    else router.replace((next as never) ?? "/(tabs)");
  };

  return (
    <Screen testID="screen-profile" dock={<Btn label={edit ? "Save" : "Continue"} onPress={save} disabled={!valid} loading={saving} testID="btn-continue" />}>
      <AppBar noBack={!edit} right={!edit ? <Txt v="t13" color="muted" style={{ marginRight: 12 }}>Step 2 of 2</Txt> : undefined} title={edit ? "Country & money" : undefined} />
      {!edit ? <Banner kind="pos" icon="shieldok" title="Your Plans account is ready" text="Your fingerprint is the key. There is no password to forget." /> : null}
      <Txt v="d28" style={{ marginTop: 24 }}>
        {edit ? "How friends see you" : "What should friends call you?"}
      </Txt>
      <View style={{ gap: 12, marginTop: 16 }}>
        <Field label="Your name" value={name} onChangeText={setName} maxLength={30} autoFocus={!edit} testID="field-name" />
        <Field label="Country" value={cty ? `${cty.flag} ${cty.name}` : country} onPress={() => setPick("country")} right={<Icon name="down" size={20} />} testID="field-country" />
        <Field label="Town or city (optional)" value={city} onChangeText={setCity} maxLength={40} testID="field-city" />
        <Field
          label="Your money"
          value={`${cur.symbol.trim()} ${cur.name} (${cur.code})`}
          onPress={() => setPick("currency")}
          right="Change"
          hint={`We show ${cur.plural} next to dollars. Friends see their own money.`}
          testID="field-currency"
        />
      </View>
      <Card tint style={{ marginTop: 16 }}>
        <Txt v="ov" color="muted">
          How friends will see you
        </Txt>
        <Row style={{ marginTop: 8 }}>
          <Avatar initial={(name.trim()[0] ?? "?").toUpperCase()} color="#D9634B" size={44} flag={cty?.flag} />
          <View style={{ flex: 1 }}>
            <Txt v="lt">{name.trim() || "Your name"}</Txt>
            <Txt v="t13" color="muted">
              {city.trim() || cty?.name}
            </Txt>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Txt v="lt">{formatUsd(40_000_000n)}</Txt>
            {local.fmt(40_000_000n) ? (
              <Txt v="t13" color="muted">
                {local.fmt(40_000_000n)}
              </Txt>
            ) : null}
          </View>
        </Row>
      </Card>
      <CountrySheet
        visible={pick === "country"}
        onClose={() => setPick(null)}
        value={country}
        onPick={(c) => {
          setCountry(c.code);
          setCurrency(c.currency);
        }}
      />
      <CurrencySheet visible={pick === "currency"} onClose={() => setPick(null)} value={currency} onPick={setCurrency} />
    </Screen>
  );
}
