import { Redirect } from "expo-router";
import React from "react";
import { identity } from "../lib/identity/session";
import { useStore } from "../lib/state/observable";

/** Entry gate: no account → Welcome; stored account → Unlock (one fingerprint); unlocked → Home. */
export default function Index() {
  const status = useStore(identity, (s) => s.status);
  const hasProfile = useStore(identity, (s) => !!s.profile);
  if (status === "loading") return null;
  if (status === "none") return <Redirect href="/welcome" />;
  if (status === "locked") return <Redirect href="/unlock" />;
  if (!hasProfile) return <Redirect href="/profile" />;
  return <Redirect href="/(tabs)" />;
}
