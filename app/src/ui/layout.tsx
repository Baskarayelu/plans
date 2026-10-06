import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { KeyboardAvoidingView, Modal, Pressable, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "../theme/ThemeProvider";
import { fonts } from "../theme/tokens";
import type { IconName } from "./Icon";
import { IconBtn } from "./kit";
import { Txt } from "./Text";

/**
 * A screen: safe-area aware, themed background, 16 px gutters. `scroll` screens put `dock`
 * outside the scroll view so primary actions stay on screen.
 */
export function Screen({
  children,
  scroll = true,
  dock,
  pad = true,
  bg,
  testID,
  refreshing,
  onRefresh,
  bottomInset = true,
  dark,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  dock?: React.ReactNode;
  pad?: boolean;
  bg?: string;
  testID?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  bottomInset?: boolean;
  dark?: boolean;
}) {
  const c = useColors();
  const ins = useSafeAreaInsets();
  const padStyle: ViewStyle = pad ? { paddingHorizontal: 16, paddingBottom: 16 } : {};
  return (
    <KeyboardAvoidingView behavior="height" style={{ flex: 1, backgroundColor: bg ?? c.bg }} testID={testID}>
      <StatusBar style={dark || c.dark ? "light" : "dark"} />
      <View style={{ height: ins.top }} />
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[{ flexGrow: 1 }, padStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.ink} colors={[c.ink]} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, padStyle]}>{children}</View>
      )}
      {dock ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 + (bottomInset ? ins.bottom : 0), backgroundColor: bg ?? c.bg, borderTopWidth: 1, borderTopColor: c.line, gap: 8 }}>{dock}</View>
      ) : bottomInset ? (
        <View style={{ height: ins.bottom }} />
      ) : null}
    </KeyboardAvoidingView>
  );
}

export function AppBar({
  title,
  sub,
  icon = "back",
  onBack,
  right,
  noBack,
  testID,
}: {
  title?: React.ReactNode;
  sub?: string;
  icon?: IconName;
  onBack?: () => void;
  right?: React.ReactNode;
  noBack?: boolean;
  testID?: string;
}) {
  return (
    <View style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 4, marginHorizontal: -8 }} testID={testID}>
      {noBack ? (
        <View style={{ width: 8 }} />
      ) : (
        <IconBtn
          name={icon}
          label={icon === "x" ? "Close" : "Back"}
          testID={icon === "x" ? "btn-close" : "btn-back"}
          onPress={() => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace("/"))}
        />
      )}
      <View style={{ flex: 1, marginLeft: 4 }}>
        {typeof title === "string" ? (
          <Txt numberOfLines={1} style={{ fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 22, letterSpacing: -0.2 }}>
            {title}
          </Txt>
        ) : (
          title
        )}
        {sub ? (
          <Txt v="t13" color="muted" weight="medium" numberOfLines={1}>
            {sub}
          </Txt>
        ) : null}
      </View>
      {right ? <View style={{ flexDirection: "row", alignItems: "center" }}>{right}</View> : null}
    </View>
  );
}

/** Full-bleed child inside a padded screen. */
export function Bleed({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ marginHorizontal: -16 }, style]}>{children}</View>;
}

/** Bottom sheet over a scrim (app sheets, not the system passkey sheet). */
export function Sheet({ visible, onClose, children, testID }: { visible: boolean; onClose: () => void; children: React.ReactNode; testID?: string }) {
  const c = useColors();
  const ins = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: c.scrim }} onPress={onClose} accessibilityLabel="Close" testID="sheet-scrim" />
        <View testID={testID} style={{ backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, paddingHorizontal: 16, paddingBottom: 24 + ins.bottom }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.muted, opacity: 0.45, alignSelf: "center", marginBottom: 18 }} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
