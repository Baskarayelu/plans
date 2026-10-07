/**
 * 136 Share sheet: choose the shape, decide about the plan name (off by default), then copy the
 * link, save the image, or share both. The preview is the real card; the image is drawn on this
 * phone. Photos are never part of it, and the name, if shown, travels only in the link's "#" part.
 */
import * as Clipboard from "expo-clipboard";
import React, { useMemo, useRef, useState } from "react";
import { PixelRatio, View } from "react-native";
import { config } from "../../config";
import { settleCard, shareMessage } from "../../lib/share/settleCard";
import { captureCard, CARD_PX, saveCard, shareCard, type CardShape } from "../../lib/share/shareImage";
import type { PlanVM } from "../../lib/state/data";
import { useColors } from "../../theme/ThemeProvider";
import { Banner, Btn, Btns, Card, Row, Seg, Toggle } from "../kit";
import { Sheet } from "../layout";
import { Txt } from "../Text";
import { showToast } from "../Toast";
import { SettleCardView } from "./SettleCardView";

export function SettleShareSheet({ visible, onClose, plan, paidOut, settleMs }: { visible: boolean; onClose: () => void; plan: PlanVM; paidOut: bigint; settleMs?: number }) {
  const c = useColors();
  const [shape, setShape] = useState<CardShape>("story");
  const [showName, setShowName] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<"share" | "save" | null>(null);
  const [failed, setFailed] = useState(false);
  const shot = useRef<View>(null);
  const raw = plan.raw;

  const card = useMemo(() => {
    const totalIn = raw.totalContributed !== undefined && raw.totalContributed !== null ? BigInt(raw.totalContributed) : raw.members.reduce((a, m) => a + BigInt(m.contributed ?? "0"), 0n);
    const settledAt = Number(raw.settledAt ?? raw.settlements[0]?.timestamp ?? 0) || undefined;
    return settleCard({
      pot: plan.pot,
      members: raw.members.map((m) => ({ country: m.country })),
      totalIn,
      paidOut,
      settleMs,
      spendCount: raw.spendCount !== undefined && raw.spendCount !== null ? Number(raw.spendCount) : undefined,
      settledAt,
      planName: plan.meta.name,
      showName,
      host: config.linkHost,
    });
  }, [raw, plan.pot, plan.meta.name, paidOut, settleMs, showName]);

  const px = CARD_PX[shape];
  const captureWidth = px.width / PixelRatio.get();
  const friendsWord = `${card.friends} ${card.friends === 1 ? "friend" : "friends"}`;

  const onToggleName = (on: boolean) => {
    if (on) setAsking(true);
    else setShowName(false);
  };

  const withImage = async (kind: "share" | "save") => {
    setFailed(false);
    setBusy(kind);
    try {
      const uri = await captureCard(shot, shape);
      if (kind === "share") await shareCard(uri, shareMessage(card), "Share how it went");
      else {
        const r = await saveCard(uri, `plans-${plan.pot.slice(2, 8)}-${shape}`);
        if (r === "saved") showToast({ title: "Image saved", sub: "In Pictures › Plans" });
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    await Clipboard.setStringAsync(card.url);
    showToast({ title: "Link copied" });
  };

  return (
    <Sheet visible={visible} onClose={onClose} testID="sheet-share-settle">
      {/* Full-size copy for the image, drawn off screen and hidden from accessibility. */}
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ position: "absolute", left: -10000, top: 0 }}>
        <View ref={shot} collapsable={false} testID="share-card-capture">
          <SettleCardView card={card} shape={shape} width={captureWidth} />
        </View>
      </View>

      <Txt v="d22">Share how it went</Txt>
      <Txt v="t13" color="muted" style={{ marginTop: 4, marginBottom: 12 }}>
        Counts, countries and amounts. Names, notes, receipts and photos are never on it.
      </Txt>
      <View style={{ alignItems: "center" }} testID="share-card-preview">
        <View style={{ borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: c.line }}>
          <SettleCardView card={card} shape={shape} width={shape === "story" ? 168 : 300} />
        </View>
      </View>
      <View style={{ marginTop: 12 }}>
        <Seg
          options={[
            { value: "story", label: "Story" },
            { value: "wide", label: "Wide" },
          ]}
          value={shape}
          onChange={setShape}
          testID="seg-share-shape"
        />
      </View>
      <Row between style={{ marginTop: 8, minHeight: 56 }}>
        <View style={{ flex: 1 }}>
          <Txt v="lt">Show the plan name</Txt>
          <Txt v="t13" color="muted">
            {showName ? `Everyone with the link sees “${plan.meta.name}”` : `Off: says “${friendsWord}”`}
          </Txt>
        </View>
        <Toggle on={showName || asking} onChange={onToggleName} label="Show the plan name" testID="toggle-show-plan-name" />
      </Row>
      {asking ? (
        <Banner kind="acc" icon="eye" title="Everyone with the link will see the plan name" text="Only your link shows it. Other people's links stay private." testID="banner-confirm-name">
          <Btns style={{ marginTop: 8 }}>
            <Btn label="Keep it hidden" kind="sec" sm onPress={() => setAsking(false)} testID="btn-keep-name-hidden" />
            <Btn label="Show the name" sm onPress={() => (setShowName(true), setAsking(false))} testID="btn-show-name" />
          </Btns>
        </Banner>
      ) : null}
      <Card tint p={12} style={{ marginTop: 8 }} testID="share-link">
        <Txt v="mono13" numberOfLines={1}>
          {card.displayUrl}
        </Txt>
      </Card>
      {failed ? (
        <View style={{ marginTop: 8 }}>
          <Banner kind="neg" icon="alert" title="Couldn't make the image" text="Try again, or copy the link instead." testID="banner-share-failed" />
        </View>
      ) : null}
      <Btns style={{ marginTop: 12 }}>
        <Btn label="Copy link" kind="sec" icon="copy" sm flex onPress={() => void copy()} testID="btn-copy-share-link" />
        <Btn label="Save image" kind="sec" icon="download" sm flex loading={busy === "save"} disabled={!!busy} onPress={() => void withImage("save")} testID="btn-save-image" />
      </Btns>
      <Btn label="Share…" icon="share" loading={busy === "share"} disabled={!!busy} onPress={() => void withImage("share")} style={{ marginTop: 8 }} testID="btn-share-card" />
    </Sheet>
  );
}
