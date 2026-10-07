/**
 * Browser side of "Link this browser" (docs/crypto.md §9). No UI here.
 *
 *   const link = await startBrowserLink({ b2, credentialId, deviceLabel });
 *   show link.displayCode, link.qrUrl (as a QR), link.fingerprint, a countdown to link.exp
 *   const bundle = await link.wait(signal);   // verified; vault already saved when b2 was given
 *   await openFromBundle(bundle, credentialId); // session.ts
 *
 * The one-time X25519 key lives only in this closure and is wiped when wait() settles (success,
 * expiry, error or abort) or on cancel().
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { config } from "../../config";
import { fromBase64Url, wipe } from "../crypto/bytes";
import {
  formatCode,
  LINK_TTL_SEC,
  LinkError,
  linkFingerprint,
  linkQrUrl,
  linkSecretFromCode,
  makeOffer,
  newLinkCode,
  nowSec,
  openReply,
  openVault,
  sealVault,
  slotIds,
  vaultId,
  wipeBundle,
  type AccountBundle,
} from "./protocol";
import { getSlot, putSlot, SlotError } from "./slots";

export type BrowserLink = {
  /** 12 characters, unformatted (what goes into the QR). */
  code: string;
  /** "XXXX-XXXX-XXXX" for the screen. */
  displayCode: string;
  qrUrl: string;
  /** Three emoji; the phone shows the same three before sending. */
  fingerprint: string;
  /** Unix seconds; the link stops working after this. */
  exp: number;
  /**
   * Polls the reply slot every 2 s until a reply arrives or the link expires. Resolves with the
   * verified bundle (saving the vault first when `b2` and `credentialId` were given). Rejects with
   * LinkError ("expired", "tampered", "wrong-account"), SlotError (vault save failed) or the
   * signal's abort reason. Single use: the link is dead once it settles.
   */
  wait(signal?: AbortSignal): Promise<AccountBundle>;
  /** Stops the link and wipes its key. */
  cancel(): void;
};

export type StartBrowserLinkOptions = {
  /** The browser passkey's keys-namespace PRF output (from createLinkPasskey). Copied; the caller wipes its own. */
  b2?: Uint8Array;
  /** The browser passkey's credential id (base64url, from createLinkPasskey). */
  credentialId?: string;
  /** Shown on the phone, e.g. "Safari on Mac". */
  deviceLabel?: string;
  /** Poll interval (tests). */
  pollMs?: number;
  /** Clock in unix seconds (tests). */
  now?: () => number;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Starts a link: new code and one-time key, offer uploaded for the typed-code path. */
export async function startBrowserLink(opts: StartBrowserLinkOptions = {}): Promise<BrowserLink> {
  const clock = opts.now ?? nowSec;
  const pollMs = opts.pollMs ?? 2000;
  const b2 = opts.b2 ? new Uint8Array(opts.b2) : null;
  const credIdBytes = opts.credentialId ? fromBase64Url(opts.credentialId) : null;

  let code = "";
  let s: Uint8Array = new Uint8Array();
  const linkSecret = x25519.utils.randomSecretKey();
  const linkPub = x25519.getPublicKey(linkSecret);
  const exp = clock() + LINK_TTL_SEC;
  // A taken offer slot means a code collision (60 bits; practically never): draw a new code.
  for (let attempt = 0; ; attempt++) {
    code = newLinkCode();
    s = linkSecretFromCode(code);
    try {
      await putSlot(slotIds(s).offer, makeOffer(s, linkPub, exp, opts.deviceLabel), { ttl: LINK_TTL_SEC });
      break;
    } catch (e) {
      wipe(s);
      if (!(e instanceof SlotError && e.kind === "taken") || attempt >= 2) {
        wipe(linkSecret, b2);
        throw e;
      }
    }
  }

  let dead = false;
  const kill = () => {
    dead = true;
    wipe(linkSecret, s, b2);
  };

  const replySlot = slotIds(s).reply;

  return {
    code,
    displayCode: formatCode(code),
    qrUrl: linkQrUrl(code, linkPub, exp, config.linkHost),
    fingerprint: linkFingerprint(s, linkPub),
    exp,
    cancel: kill,
    async wait(signal?: AbortSignal): Promise<AccountBundle> {
      if (dead) throw new LinkError("expired", "link already finished");
      try {
        for (;;) {
          if (signal?.aborted) throw signal.reason ?? new Error("aborted");
          if (dead) throw new LinkError("expired", "cancelled");
          if (clock() > exp) throw new LinkError("expired", "no reply in time");
          let reply: Uint8Array | null = null;
          try {
            reply = await getSlot(replySlot);
          } catch (e) {
            // Keep polling through brief network trouble; the expiry ends it.
            if (!(e instanceof SlotError) || (e.kind !== "offline" && e.kind !== "rate-limited")) throw e;
          }
          if (dead) throw new LinkError("expired", "cancelled");
          if (reply) {
            // The reply slot is write-once, so a reply that doesn't open ends this link.
            const bundle = openReply(linkSecret, s, exp, reply, clock());
            if (b2 && credIdBytes) {
              try {
                await saveVault(bundle, b2, credIdBytes);
              } catch (e) {
                wipeBundle(bundle);
                throw e;
              }
            }
            return bundle;
          }
          await sleep(pollMs, signal);
        }
      } finally {
        kill();
      }
    },
  };
}

/**
 * Saves the account for this browser's passkey: PUT /v1/slots/<vaultId> {data, auth} (permanent;
 * overwritable only with the same auth). The bundle's `t` is stored as linkedAt.
 */
export async function saveVault(bundle: AccountBundle, b2: Uint8Array, credentialIdBytes: Uint8Array): Promise<void> {
  const v = sealVault(b2, credentialIdBytes, bundle);
  await putSlot(v.id, v.box, { auth: v.auth });
}

/** The vault ciphertext for a credential, or null when there is none (404). Throws SlotError on network trouble. */
export async function fetchVaultBox(credentialIdBytes: Uint8Array): Promise<Uint8Array | null> {
  return getSlot(vaultId(credentialIdBytes));
}

/**
 * Loads the account linked to this browser's passkey: null when no vault exists. Throws SlotError
 * on network trouble and LinkError("tampered" / "wrong-account") when it doesn't open.
 */
export async function loadVault(b2: Uint8Array, credentialIdBytes: Uint8Array): Promise<AccountBundle | null> {
  const box = await fetchVaultBox(credentialIdBytes);
  return box ? openVault(b2, credentialIdBytes, box) : null;
}
