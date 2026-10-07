/**
 * A link QR opened as an address (https://plans.0xo.in/app/link#c=…&k=…&e=…), e.g. by a phone's
 * camera app. public/index.html takes the "#" part out of the address bar before the router runs;
 * webEntry.web.ts puts the QR text here, in memory only, for the "Add a browser" screen to read
 * once. It never goes into the address bar, storage or a log.
 */
import { createStore } from "../state/observable";

export const pendingLinkQr = createStore<string | null>(null);

/** Reads and clears the pending link QR. */
export function takePendingLinkQr(): string | null {
  const v = pendingLinkQr.get();
  if (v) pendingLinkQr.set(null);
  return v;
}
