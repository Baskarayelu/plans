import { getRandomValues } from "expo-crypto";

// Hermes ships no CSPRNG; Mera, viem and @noble need crypto.getRandomValues.
// Import this module before any other application code (see src/app/_layout.tsx).
if (typeof globalThis.crypto?.getRandomValues !== "function") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { ...(globalThis.crypto ?? {}), getRandomValues },
  });
}

// Mera's signing sessions expose [Symbol.dispose]; give Hermes the well-known symbol.
const S = Symbol as unknown as { dispose?: symbol; asyncDispose?: symbol };
if (S.dispose === undefined) S.dispose = Symbol("Symbol.dispose");
if (S.asyncDispose === undefined) S.asyncDispose = Symbol("Symbol.asyncDispose");
