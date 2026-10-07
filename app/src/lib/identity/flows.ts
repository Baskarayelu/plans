import { router } from "expo-router";
import { PasskeyError, type PasskeyFailure } from "./session";

export type PasskeyContext = "create" | "restore" | "unlock";

/**
 * What a passkey failure means for the person, in words (designs 127–129). `action` is what the
 * main button should do next: try the same step again, open the setup steps (06), or create an
 * account instead.
 */
export type PasskeyNotice = {
  kind: PasskeyFailure | "stuck";
  tone: "mut" | "neg";
  icon: "info" | "key" | "wifioff" | "search" | "alert";
  title: string;
  text: string;
  action: "retry" | "setup" | "create";
};

export function failureKind(e: unknown): PasskeyFailure {
  return e instanceof PasskeyError ? e.kind : "failed";
}

export function passkeyNotice(kind: PasskeyFailure | "stuck", ctx: PasskeyContext): PasskeyNotice {
  switch (kind) {
    case "cancelled":
      return ctx === "create"
        ? { kind, tone: "mut", icon: "info", title: "No account was made", text: "You closed the passkey step before it finished. Nothing was saved.", action: "retry" }
        : { kind, tone: "mut", icon: "info", title: "Nothing was opened", text: "You closed the passkey step before it finished. Try again when you're ready.", action: "retry" };
    case "no-credentials":
      return { kind, tone: "mut", icon: "search", title: "No Plans passkey on this phone", text: "Create an account instead, or use a passkey saved on another device.", action: "create" };
    case "not-supported":
      return { kind, tone: "neg", icon: "key", title: "This phone needs a screen lock", text: "Set a screen lock first, then try again.", action: "setup" };
    case "no-provider":
      return { kind, tone: "neg", icon: "key", title: "This phone can't save a passkey yet", text: "Plans needs a passkey service like Google Password Manager turned on.", action: "setup" };
    case "prf-unavailable":
      return { kind, tone: "neg", icon: "key", title: "This passkey service can't be used yet", text: "Your passkey service doesn't support what Plans needs. Google Password Manager does.", action: "setup" };
    case "domain-not-verified":
      return {
        kind,
        tone: "neg",
        icon: "alert",
        title: "This copy of Plans isn't recognised",
        text: "Your phone's passkey service doesn't recognise this copy of Plans yet. Install Plans from plans.0xo.in and try again.",
        action: "retry",
      };
    case "stuck":
      return {
        kind,
        tone: "neg",
        icon: "wifioff",
        title: "The passkey step didn't open",
        text: "Your phone is taking too long to show it. Check your connection and try again. Nothing was saved.",
        action: "retry",
      };
    default:
      return {
        kind,
        tone: "neg",
        icon: "wifioff",
        title: "Couldn't finish setting up",
        text: "Check your connection and try again. If your phone saved a passkey, Plans will use the same one.",
        action: "retry",
      };
  }
}

/**
 * Where a passkey failure leads on screens that show one inline line (join, claim, unlock):
 * an inline message, or screen 06 when the phone can't use passkeys at all.
 * A cancel while unlocking stays silent (the person chose to stop); while creating or restoring it
 * says that nothing happened (B4).
 */
export function handlePasskeyFailure(e: unknown, ctx: PasskeyContext = "unlock"): { inline?: string } {
  const kind = failureKind(e);
  const detail = e instanceof PasskeyError ? e.detail : String(e);
  switch (kind) {
    case "cancelled":
      if (ctx === "unlock") return {};
      return { inline: ctx === "create" ? "No account was made. You closed the passkey step before it finished." : "You closed the passkey step before it finished. Try again when you're ready." };
    case "no-credentials":
      return { inline: "No Plans passkey found on this phone. Create an account instead, or use a passkey from another device." };
    case "not-supported":
    case "no-provider":
    case "prf-unavailable":
      router.push({ pathname: "/unsupported", params: { why: kind, detail } });
      return {};
    case "domain-not-verified":
      return { inline: "This copy of Plans isn't recognised by your phone's passkey service yet. Install Plans from plans.0xo.in and try again." };
    default:
      return { inline: ctx === "unlock" ? "That didn't work. Try again." : "Couldn't finish setting up. Check your connection and try again." };
  }
}
