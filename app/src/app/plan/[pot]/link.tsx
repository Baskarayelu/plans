/**
 * 26 Pay link created (LINK spend). Shows the claim link once the spend has executed, its live
 * status (not claimed / claimed / expired / back in the pot) and the honest ways to undo it:
 * withdraw while it's still a request, or send it back to the pot after it runs out.
 */
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Share, View } from "react-native";
import type { Address } from "viem";
import * as A from "../../../lib/chain/actions";
import { formatUsd } from "../../../lib/domain/currency";
import { contactFor } from "../../../lib/domain/groups";
import { displayLink } from "../../../lib/domain/links";
import { payLinkFor } from "../../../lib/domain/planOps";
import { categoryOf } from "../../../lib/domain/rules";
import { memoText, refreshSpend, useSpendDetail, type SpendDetail } from "../../../lib/spend/hooks";
import { fmtClock, fmtDay, inText, joinNames } from "../../../lib/spend/logic";
import { identity } from "../../../lib/identity/session";
import { usePlan, type PlanVM } from "../../../lib/state/data";
import { useAction } from "../../../lib/state/useAction";
import { useColors } from "../../../theme/ThemeProvider";
import { fonts } from "../../../theme/tokens";
import { Icon } from "../../../ui/Icon";
import { Banner, BigIcon, Btn, Card, Chip, Hr, IconBtn, Row, Tile } from "../../../ui/kit";
import { AppBar, Screen, Sheet } from "../../../ui/layout";
import { useMoney } from "../../../ui/plan/common";
import { ErrorScreen, LoadingScreen, PlanGate } from "../../../ui/spend/parts";
import { Txt } from "../../../ui/Text";
import { showToast } from "../../../ui/Toast";

export default function PayLink() {
  const { pot, id } = useLocalSearchParams<{ pot: string; id: string; tx?: string }>();
  const q = usePlan(pot);
  return (
    <PlanGate q={q} testID="screen-pay-link">
      {(plan) => <LinkLoader plan={plan} id={id} />}
    </PlanGate>
  );
}

function LinkLoader({ plan, id }: { plan: PlanVM; id: string }) {
  const s = useSpendDetail(plan.pot, id, 4000);
  if (s.isLoading) return <LoadingScreen testID="screen-pay-link" />;
  if (s.isError && !s.data) return <ErrorScreen onRetry={() => void s.refetch()} testID="screen-pay-link" />;
  if (!s.data) return <LoadingScreen testID="screen-pay-link" />;
  return <LinkBody plan={plan} s={s.data} />;
}

function LinkBody({ plan, s }: { plan: PlanVM; s: SpendDetail }) {
  const c = useColors();
  const m = useMoney();
  const [copied, setCopied] = useState(false);
  const [cancelInfo, setCancelInfo] = useState(false);
  const now = Math.floor(Date.now() / 1000);
  const amount = BigInt(s.amount);
  const note = memoText(plan, s.memo);
  const cat = categoryOf(s.category);
  const mine = plan.me === s.proposer_id.toLowerCase();
  const claim = s.claims?.[0];
  const expiry = claim?.expiry ? Number(claim.expiry) : 0;
  const url = useMemo(
    () => (s.status === "Executed" ? payLinkFor(plan.pot, s.spendId, { sender: identity.get().profile?.name, note: note ?? undefined, amount: s.amount }) : null),
    [plan.pot, s.spendId, s.status, s.amount, note],
  );
  const pending = s.status === "Pending" || s.status === "Approved";
  const ranOut = pending && Number(s.expiresAt) < now;
  const others = plan.raw.members
    .filter((x) => x.status === "Active" && x.address.toLowerCase() !== plan.me)
    .map((x) => plan.people[x.address.toLowerCase()]?.name ?? "Friend");

  const cancel = useAction(() => A.cancelSpend(plan.pot as Address, BigInt(s.spendId)));
  const exec = useAction(() => A.execute(plan.pot as Address, BigInt(s.spendId)));
  const refund = useAction(() => A.claimRefund(BigInt(claim!.claimId)));
  const err = cancel.error ?? exec.error ?? refund.error;

  const home = () => router.dismissTo({ pathname: "/plan/[pot]", params: { pot: plan.pot } });

  let icon: "link" | "clock" | "x" | "check" | "refresh" = "link";
  let tone: "p" | "i" | "m" = "p";
  let title = "Pay link ready";
  let text = "Send it to them. They claim it in their own money. No app needed to start.";
  let status: { label: string; tone?: "pos" | "neg" | "inf" } | null = null;
  if (s.status === "Cancelled") {
    icon = "x";
    tone = "m";
    title = "Pay link cancelled";
    text = s.cancelReason === 2 ? "The request ran out before enough people said OK. Nothing left the pot." : s.cancelReason === 1 ? "The group said no. Nothing left the pot." : "It was withdrawn. Nothing left the pot.";
  } else if (ranOut) {
    icon = "clock";
    tone = "m";
    title = "This request ran out";
    text = "Not enough people said OK in time. Nothing left the pot. You can ask again.";
  } else if (pending) {
    icon = "clock";
    tone = "i";
    title = s.status === "Approved" ? "Approved — waiting for money in the pot" : "Waiting for OKs";
    text = s.status === "Approved" ? "Everyone needed said OK, but the pot couldn't pay it yet. Add money or try again." : `The link is ready once approved.${others.length ? ` We asked ${joinNames(others)}.` : ""}`;
  } else if (claim?.status === "Claimed") {
    icon = "check";
    title = "Claimed";
    const who = claim.recipient_id ? plan.people[claim.recipient_id.toLowerCase()]?.name ?? contactFor(claim.recipient_id)?.name : undefined;
    text = `${who ?? "They"} claimed ${formatUsd(amount)}${claim.claimedAt ? ` at ${fmtClock(claim.claimedAt)}` : ""}.`;
    status = { label: `Claimed${who ? ` by ${who}` : ""}${claim.claimedAt ? ` · ${fmtClock(claim.claimedAt)}` : ""}`, tone: "pos" };
  } else if (claim?.status === "Refunded" || BigInt(s.refunded ?? "0") > 0n) {
    icon = "refresh";
    tone = "m";
    title = "Back in the pot";
    text = `Nobody claimed it, so ${formatUsd(amount)} is back in the pot.`;
    status = { label: "Back in the pot" };
  } else if (claim && expiry && expiry < now) {
    icon = "clock";
    tone = "m";
    title = "This link ran out";
    text = `Nobody claimed it. Send the ${formatUsd(amount)} back to the pot.`;
    status = { label: "Expired", tone: "neg" };
  } else if (claim) {
    status = { label: "Not claimed yet" };
  } else if (s.status === "Executed") {
    status = { label: "Not claimed yet" };
  }

  const copy = async () => {
    if (!url) return;
    await Clipboard.setStringAsync(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const share = () => {
    if (!url) return;
    void Share.share({ message: `${identity.get().profile?.name ?? "A friend"} sent you ${formatUsd(amount)}${note ? ` for ${note}` : ""}. Claim it in your own money: ${url}` }).catch(() => undefined);
  };

  const backInPot = claim?.status === "Refunded" || BigInt(s.refunded ?? "0") > 0n;
  const live = s.status === "Executed" && !backInPot && (!claim || (claim.status === "Open" && (!expiry || expiry >= now)));
  const dock = (
    <>
      {live && url ? <Btn label="Share link" icon="share" onPress={share} testID="btn-share-link" /> : null}
      {claim?.status === "Open" && expiry && expiry < now ? (
        <Btn
          label={`Send ${formatUsd(amount)} back to the pot`}
          icon="refresh"
          loading={refund.busy}
          onPress={async () => {
            const r = await refund.run();
            if (r) {
              refreshSpend(plan.pot, s.spendId);
              showToast({ title: "Back in the pot", sub: `${formatUsd(amount)} returned`, emoji: plan.meta.emoji });
            }
          }}
          testID="btn-refund-link"
        />
      ) : null}
      {pending && !ranOut && s.status === "Approved" ? (
        <Btn
          label="Try paying now"
          loading={exec.busy}
          onPress={async () => {
            const r = await exec.run();
            if (r) refreshSpend(plan.pot, s.spendId);
          }}
          testID="btn-try-paying-now"
        />
      ) : null}
      {pending && !ranOut && mine ? (
        <Btn
          label="Cancel request"
          kind="dngo"
          loading={cancel.busy}
          onPress={async () => {
            const r = await cancel.run();
            if (r) {
              refreshSpend(plan.pot, s.spendId);
              showToast({ title: "Request withdrawn", sub: "Nothing left the pot", emoji: plan.meta.emoji });
            }
          }}
          testID="btn-cancel-link"
        />
      ) : null}
      {live && mine ? <Btn label="Cancel link" kind="txt" onPress={() => setCancelInfo(true)} testID="btn-cancel-link" /> : null}
      {!live && !pending ? <Btn label="Done" kind="sec" onPress={home} testID="btn-done" /> : null}
    </>
  );

  return (
    <Screen testID="screen-pay-link" dock={dock}>
      <AppBar icon="x" onBack={home} />
      <View style={{ alignItems: "center" }}>
        <BigIcon icon={icon} kind={tone} />
        <Txt v="d28" center style={{ marginTop: 12 }} testID="link-title">
          {title}
        </Txt>
        <Txt v="t15" color="muted" center style={{ marginTop: 6, marginHorizontal: 16, marginBottom: 20 }}>
          {text}
        </Txt>
      </View>
      <Card>
        <Row>
          <Tile icon="link" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt v="lt" numberOfLines={1}>
              {note ?? "Pay link"}
            </Txt>
            <Txt v="t13" color="muted">
              {cat.emoji} {cat.name}
            </Txt>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Txt v="d22" tnum testID="link-amount">
              {formatUsd(amount)}
            </Txt>
            {m.local(amount) ? (
              <Txt v="t13" color="muted">
                {m.local(amount)}
              </Txt>
            ) : null}
          </View>
        </Row>
        {s.status === "Executed" ? (
          <>
            <Hr />
            {url ? (
              <Row between>
                <Txt style={{ fontFamily: fonts.mono, fontSize: 13, flexShrink: 1 }} numberOfLines={1} testID="link-url">
                  {displayLink(url)}
                </Txt>
                <IconBtn name={copied ? "check" : "copy"} label="Copy link" filled size={40} onPress={() => void copy()} testID="btn-copy-link" />
              </Row>
            ) : (
              <Txt v="t13" color="muted" testID="link-elsewhere">
                {mine ? "This link was made on another phone. Share it from there." : "Only the person who made this link can share it."}
              </Txt>
            )}
            <Row between style={{ marginTop: 8 }} wrap>
              {expiry ? (
                <Row gap={6}>
                  <Icon name="clock" size={16} color={c.muted} />
                  <Txt v="t13" color="muted">
                    {expiry >= now ? `Expires in ${inText(expiry - now)} · ${fmtDay(expiry)}` : `Ran out ${fmtDay(expiry)}`}
                  </Txt>
                </Row>
              ) : (
                <View />
              )}
              {status ? <Chip sm label={status.label} tone={status.tone} /> : null}
            </Row>
          </>
        ) : null}
      </Card>
      {live ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="mut" icon="info" title={`Not claimed by ${expiry ? fmtDay(expiry) : "the time it runs out"}?`} text={`Then anyone in the plan can send the ${formatUsd(amount)} back to the pot.`} />
        </View>
      ) : null}
      {copied ? (
        <Txt v="t13" color="pos" center style={{ marginTop: 8 }}>
          Link copied
        </Txt>
      ) : null}
      {err ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="neg" icon="alert" title={err.title} text={err.message} testID="banner-action-error" />
        </View>
      ) : null}
      <Sheet visible={cancelInfo} onClose={() => setCancelInfo(false)} testID="sheet-cancel-link">
        <Txt v="d22">This link is already live</Txt>
        <Txt v="t15" color="muted" style={{ marginTop: 8 }}>
          {`The ${formatUsd(amount)} is held for whoever opens the link, so it can't be pulled back now. If nobody claims it${expiry ? ` by ${fmtDay(expiry)}` : ""}, anyone in the plan can send it back to the pot. Only share the link with the person it's for.`}
        </Txt>
        <Btn label="Got it" kind="sec" onPress={() => setCancelInfo(false)} style={{ marginTop: 16 }} testID="btn-got-it" />
      </Sheet>
    </Screen>
  );
}
