import { router } from "expo-router";
import { PasskeyError, type PasskeyFailure } from "./session";

/** Where a passkey failure leads (screen 06 variants, or an inline message). */
export function handlePasskeyFailure(e: unknown): { inline?: string } {
  const kind: PasskeyFailure = e instanceof PasskeyError ? e.kind : "failed";
  const detail = e instanceof PasskeyError ? e.detail : String(e);
  switch (kind) {
    case "cancelled":
      return {};
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
      return { inline: "That didn't work. Try again." };
  }
}
