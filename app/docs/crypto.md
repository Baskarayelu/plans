# Plans app: cryptography

Every construction the app uses, exactly. Code: `src/lib/crypto/*`, `src/lib/identity/*`,
`src/lib/chain/eip712.ts`, `src/lib/chain/nonces.ts`. Tests: `src/__tests__/*` (vectors checked
against `node:crypto`, viem, the contract sources and Foundry's `cast`).

Libraries: `@noble/hashes` 2.4 (SHA-256, HKDF), `@noble/curves` 2.4 (X25519, secp256k1 via Mera),
`@noble/ciphers` 2.4 (XChaCha20-Poly1305, XChaCha20), `@scure/bip39`/`@scure/bip32` 2.4, `viem`
(EIP-712, ABI encoding, keccak). Hermes has no `crypto.subtle`; `crypto.getRandomValues` comes from
`expo-crypto` (`src/polyfills.ts`).

## 1. One passkey, two namespaces

The passkey (rpId `plans.0xo.in`, discoverable, user verification required) is evaluated with the
WebAuthn PRF extension for **two salts in one ceremony**:

| Slot | Salt (32 bytes) | Use |
|---|---|---|
| `first` | `SHA-256("mera.prf.salt.v1")` (Mera's default) | the account |
| `second` | `SHA-256("plans.keys.v1")` | the Plans keys namespace |

`src/lib/identity/webauthnClient.ts` is a Mera `WebAuthnClient` around react-native-passkey that
sends `extensions.prf.eval = { first: <Mera's salt>, second: <keys salt> }`. Mera receives `first`
exactly as from its own client; `second` is kept in memory for the keys module and then wiped.
If the provider returns no `second`, joining still takes one prompt; the first time encrypted
content is needed the app runs one more ceremony for the keys salt alone ("Unlock receipts").

Create flow: before creating, the app asks for an existing Plans passkey with Android's
"immediately available" flag (no UI when there is none), so nobody makes a second account by
accident. Restore flow: `getPasskeyPrfOutput` with no credential → the system picker, then the vault lookup
for that credential (§9.6), so a browser passkey made for linking opens the linked account.

Nothing derived from the passkey is stored. The PRF outputs, the signing key, the X25519 secret
and the cache key live in memory and are re-derived at every unlock (one fingerprint per app
launch; the session locks after 10 minutes in the background).

## 2. Account (Mera's documented recipe)

```
entropy  = PRF first output (32 bytes)
mnemonic = BIP-39(entropy, English)            (24 words)
seed     = BIP-39 seed(mnemonic, passphrase "") (PBKDF2-HMAC-SHA512, 2048 rounds)
key      = BIP-32(seed) at m/44'/60'/0'/0/0
session  = Mera createSecp256k1SigningSession({ privateKey: key }); account = toViemAccount(session)
```

The intermediate buffers are zeroed after the session is created (the session keeps its own copy).

## 3. Plans keys

```
x25519Secret = HKDF-SHA256(ikm = PRF second output, salt = "" , info = "plans/v1/x25519", L = 32)
cacheKey     = HKDF-SHA256(ikm = PRF second output, salt = "" , info = "plans/v1/cache",  L = 32)
x25519Public = X25519(x25519Secret, 9)          (RFC 7748; clamping inside X25519)
```

`x25519Public` is registered in `KeyRegistry` (`RegisterKey(address account,bytes32 pubKey,uint256 deadline)`),
bundled into `createPot`/`join` (`keyReg`) or sent alone after sign-in.

### Key fingerprint

```
d = SHA-256(x25519Public)
fingerprint = EMOJI[d[0]] ‖ EMOJI[d[1]] ‖ EMOJI[d[2]]
```

`EMOJI` is the fixed 256-entry table in `src/lib/crypto/fingerprint.ts`: 256 distinct single
code point emoji with default emoji presentation, all from Emoji 11.0 or earlier (so Android 9+
renders them), in a fixed order (index = byte value). The same passkey gives the same three emoji
on every phone. Vector: an all-zero key gives `EMOJI[0x66] EMOJI[0x68] EMOJI[0x7a]`.

## 4. Sealed box (to an X25519 public key)

Used for group-key wraps.

```
eph      ← random X25519 key pair
shared   = X25519(ephSecret, recipientPub)
key      = HKDF-SHA256(ikm = shared, salt = ephPub ‖ recipientPub, info = "plans/v1/seal", L = 32)
nonce    ← 24 random bytes
ct       = XChaCha20-Poly1305(key, nonce, plaintext, aad = UTF-8("plans/v1/seal|" + context))
sealed   = 0x01 ‖ ephPub (32) ‖ nonce (24) ‖ ct
```

For a group key, `context = "groupkey|" + pot` (lowercase hex address), binding the wrap to its
plan. A wrapped 32-byte group key is 105 bytes.

## 5. Group key and group box

Each plan has a random 32-byte group key, created by the creator's phone. It reaches members as:

| How | Bytes in `KeyWrapped(member, by, wrap)` |
|---|---|
| creator's own wrap (`CreatePotParams.creatorKeyWrap`) | `seal(creatorPub, groupKey)` |
| invite wrap (`CreatePotParams.inviteKeyWrap`) | `seal(invitePub, groupKey)` |
| re-wrap after a join (`postKeyWraps`) | `seal(memberPub, groupKey)` |

The invite key pair comes from the invite secret in the link:
`inviteX25519Secret = HKDF-SHA256(ikm = inviteSecret, salt = "", info = "plans/v1/invite-x25519", 32)`.
The invite secret is also the secp256k1 key whose address is the pot's `inviteSigner` (it signs
`Invite(address member)`). A joiner can read the plan before joining with the invite wrap; after
joining their phone posts a wrap to its own key (so another phone with the same passkey can read
it) and any member's phone that sees `MemberJoined` / `KeyRegistered` for someone without a wrap
posts one for them (with a random 2.5–7.5 s delay so phones don't all post the same wrap).

Content encrypted with the group key:

```
box = 0x01 ‖ nonce (24) ‖ XChaCha20-Poly1305(groupKey, nonce, plaintext, aad = UTF-8("plans/v1/" + kind + "|" + pot))
```

| kind | Where | Plaintext |
|---|---|---|
| `meta` | `CreatePotParams.meta` | `{"v":1,"name","emoji","color"}` |
| `memo` | `propose(..., memo)` | `{"v":1,"t": note}` |
| `dispute` | `openDispute(..., memo)` | `{"v":1,"t": note,"r": reason}` |
| `profile` | `postKeyWraps` entry for oneself: `0x50 ‖ box` | `{"v":1,"n": name,"c": city,"cc": country,"cur": currency}` |
| `receipt` | photo ciphertext (off-chain) | JPEG bytes |

Meta starting with `0x00` is plaintext JSON (the relayer's demo plans). `receiptHash` onchain is
`SHA-256(receipt box)`. The ciphertext is stored on the phone and uploaded to the relayer's blob
store at `PUT /v1/blob/<hash>` when that endpoint exists (it doesn't yet; see the lead's notes).

New invite links: "Make a new link" rotates the invite signer to a fresh invite key and posts
`seal(newInvitePub, groupKey)` as a `KeyWrapped` entry whose `member` is the new signer's address
(`postKeyWraps` doesn't restrict the wrapped address). A phone opening the link looks for the
`createPot` invite wrap and for wraps addressed to `address(inviteSecret)`. Known limit: the old
invite wrap stays readable by anyone holding an old link (they can read the plan's name and notes
but can no longer join).

## 6. Send note (PlansSend)

`PlansSend.SendMeta.salt` (32 bytes, bound into the AUSD authorisation nonce) carries a short
private note from sender to receiver, so the receiver sees "+$1.35 from Leah, London":

```
k     = HKDF-SHA256(ikm = X25519(mySecret, theirPub), salt = "", info = "plans/v1/send-note|" + from + "|" + to, 32)
r     ← 7 random bytes
pt    = 0x01 ‖ UTF-8(name + 0x1F + city + 0x1F + note) cut to 24 bytes on a character boundary, zero padded
salt  = r ‖ (pt XOR XChaCha20(k, nonce = r ‖ 0^17))     (32 bytes)
```

Both sides derive `k` from their KeyRegistry keys. There is no tag: the salt is already bound to the
sender's signature through the ERC-3009 nonce (`keccak256(abi.encode(meta))`), and a receiver
rejects anything that doesn't decode to the version byte and valid UTF-8. Without a recipient key
the salt is 32 random bytes.

## 7. Local cache

```
file = 0x01 ‖ nonce (24) ‖ XChaCha20-Poly1305(cacheKey, nonce, JSON, aad = UTF-8("plans/v1/cache|" + name))
```

Holds group keys, invite secrets (to re-share links), contacts, pay-link claim keys. Unreadable
without the passkey. SecureStore holds only non-secret metadata (address, credential id, X25519
public key, profile) and the nonce allocator state.

## 8. Signed messages

EIP-712 builders for every type in `contracts/src/interfaces` (`Plans Pot`, `Plans Factory`,
`Plans Keys`, `Plans Claims` domains, each `{name, version "1", chainId, verifyingContract}`) and
AUSD's `{name "Agora Dollar", version "1", chainId, verifyingContract AUSD}`
(`ReceiveWithAuthorization`, `Permit`). Tests compare every type string with the `keccak256("…")`
constants in the contract sources and every digest with a hand-built PlansSigs-style encoding.

ERC-3009 nonce binding:

- `ClaimEscrow.createWithAuthorization`: `nonce = keccak256(abi.encode(claimSigner, expiry, fromCountry, salt))`
- `PlansSend.send`: `nonce = keccak256(abi.encode(meta))` (static tuple, no offset word)

Checked against Foundry `cast abi-encode` in `src/__tests__/eip712.test.ts`.

### Pot nonces (gas)

Pots store used nonces as a bitmap: nonces that share their upper 248 bits share one storage word
(`contracts/GAS.md`). The app keeps, per device and account, a random 248-bit prefix and counts up
in the low byte (persisted in SecureStore), so a new storage word (~17,000 gas of state growth plus
a page write on Monad) is paid once per 256 actions instead of on every action. After 256 actions,
or when the relayer reports a used nonce, a new random prefix is drawn and the action is retried
once. Different phones draw different prefixes, so they never collide.

Claim links (`/c/…#k=<claim key>`), invite links (`/j/<pot>#s=<invite secret>`) keep their secret
in the URL fragment, which browsers never send to a server.

## 9. Linking a browser

A person whose passkey lives in one password manager (say Google Password Manager on their Android
phone) opens the web app (`https://plans.0xo.in/app`) in a browser that uses another (say iCloud
Keychain). PRF outputs are per credential, so a new passkey there would be a **different account**.
Instead the browser makes its own passkey, and the phone sends it the account, end to end
encrypted, through the relayer. Code: `src/lib/link/protocol.ts` (pure constructions),
`browserLink.ts`, `phoneLink.ts`, `slots.ts`, and `openFromBundle` / vault-aware
`unlockStored` / `restoreWithPasskey` in `src/lib/identity/session.ts`. Tests:
`src/__tests__/link.test.ts` (vectors checked against `node:crypto`) and `linkSession.test.ts`.

Notation: HKDF = HKDF-SHA256, AEAD = XChaCha20-Poly1305, b64u = base64url without padding, `‖` =
concatenation, strings are UTF-8, `hex` is lowercase without `0x`.

### 9.1 Link code, secret and slots

```
code      = 12 characters of Crockford base32 "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
            (the first 60 bits of 8 random bytes, 5 bits per character, big-endian),
            shown "XXXX-XXXX-XXXX"
typed     → uppercase, drop spaces and dashes, I/L → 1, O → 0; U or any other character is invalid
s         = HKDF(ikm = code (12 normalised chars), salt = "plans/v1/link", info = "plans/v1/link-secret", L = 32)
offerSlot = hex(SHA-256("plans/v1/link-offer|" ‖ s))
replySlot = hex(SHA-256("plans/v1/link-reply|" ‖ s))
```

Vector: code `0123456789AB` → `s = f52ea686…47058128`, offerSlot `bd8296e5…0a1614ca`, replySlot
`16a77a31…bc44e7e3` (full values in the tests).

### 9.2 Browser: one-time key, offer and QR

```
(linkSecret, linkPub) ← random X25519 key pair     (memory only; wiped on success, expiry, error or cancel)
exp      = now + 600                                (unix seconds; the link lives 10 minutes)
offerKey = HKDF(ikm = s, salt = "", info = "plans/v1/link-offer", 32)
pt       = {"v":1,"k":b64u(linkPub),"e":exp,"d":deviceLabel}
offer    = 0x01 ‖ nonce(24) ‖ AEAD(offerKey, nonce, pt, aad = "plans/v1/link-offer")
PUT /v1/slots/<offerSlot> {data: b64u(offer), ttl: 600}
QR       = https://plans.0xo.in/app/link#c=<code>&k=<b64u(linkPub)>&e=<exp>   (host = config.linkHost)
```

The offer exists only for the typed-code path; a phone that scans the QR has everything it needs
and fetches nothing.

### 9.3 Fingerprint

```
d  = SHA-256("plans/v1/link-fp" ‖ s ‖ linkPub)
fp = EMOJI[d[0]] ‖ EMOJI[d[1]] ‖ EMOJI[d[2]]       (the table of §3, emojiFromDigest)
```

Both screens show these three emoji and the person checks they match before the phone sends.

### 9.4 Phone: account bundle and reply

At send time the phone runs a **fresh** passkey ceremony pinned to its stored credential, asking
for both salts in one prompt (a second keys-only prompt only if the provider ignores the `second`
salt). The unlocked session can't be used: it wipes the PRF outputs after deriving. The phone
refuses to send if the address derived from this ceremony isn't the stored account's.

```
bundle = {"v":1,
          "a":   hex(deriveAccountPrivateKey(PRF first)),    32 bytes (§2), never the PRF output or mnemonic
          "k":   hex(PRF second),                            32 bytes, the IKM of §3
          "addr":"0x…" checksummed address of a,
          "fp":  key fingerprint (§3) of deriveKeys(k).x25519Public,
          "p":   profile {name, country, currency, city?} or absent,
          "t":   now (unix seconds)}
reply  = seal(linkPub, bundle, context = "link|" + hex(s) + "|" + exp)    (§4: aad "plans/v1/seal|" + context)
PUT /v1/slots/<replySlot> {data: b64u(reply), ttl: min(600, exp − now + 60), at least 60}   (no auth: write-once)
```

The account private key is sent rather than the PRF `first` output or the mnemonic (least
privilege: it is what the browser needs to sign, and nothing that derives other accounts). Every
buffer (PRF outputs, key, plaintext) is zeroed after use; JSON strings can't be zeroed in
JavaScript and are dropped as soon as possible. A device that is itself a linked browser sends the
bundle from its vault (§9.6). On the phone a link counts as expired only after `exp + 60` (clock
differences); the browser's clock decides.

### 9.5 Browser: receive and verify

The browser polls `GET /v1/slots/<replySlot>` every 2 s until `exp` (network errors are retried
until then), then:

```
reject "expired"       if now > exp
pt = open(linkSecret, reply, "link|" + hex(s) + "|" + exp)    → "tampered" if it fails
reject "expired"       if t ∉ [now − 660, now + 60]
reject "wrong-account" if address(a) ≠ addr, or keyFingerprint(deriveKeys(k).x25519Public) ≠ fp
wipe linkSecret
```

A reply that fails to open ends the link (the reply slot is write-once, so no second reply can
arrive).

### 9.6 Vault: keeping the account in this browser

The browser's own passkey (rpId `plans.0xo.in`, created for linking with both salts; its user
handle is `"plans-link/v1:" ‖ 18 random bytes` so the web app can recognise it) gives `b2`, its
keys-namespace PRF output:

```
vaultKey  = HKDF(ikm = b2, salt = "", info = "plans/v1/vault", 32)
vaultAuth = HKDF(ikm = b2, salt = "", info = "plans/v1/vault-auth", 32)
vaultId   = hex(SHA-256(raw credential id bytes))
pt        = the bundle JSON with "t" replaced by "linkedAt"
box       = 0x01 ‖ nonce(24) ‖ AEAD(vaultKey, nonce, pt, aad = "plans/v1/vault|" + vaultId)
PUT /v1/slots/<vaultId> {data: b64u(box), auth: hex(vaultAuth)}           (permanent)
```

The vault is saved before the session opens; the StoredAccount then holds the browser's
credential id and `vault: true` (nothing secret is stored locally). The browser's PRF `first`
output is never used.

- **Unlock** (`unlockStored`, vault account): GET the vault (no prompt if it's gone or the network is
  down), one ceremony pinned to the browser's passkey → `b2` (keys-only second prompt if the
  provider ignores `second`), decrypt, open the Mera session from `a` and the keys from `k`. A
  missing or undecryptable vault is an error ("link this browser again"); it never falls back to
  the passkey's own PRF account.
- **Restore** (`restoreWithPasskey` / `findExistingAccount`, any browser where that passkey is
  synced): discoverable ceremony → credential id → **always** GET `vaultId`. Found → decrypt with
  `b2` → the linked account. 404 → the passkey's own account from PRF `first` (§2), unless the web
  bridge reports the link user handle, in which case it's an error. Any other failure of the
  lookup (offline, 5xx) or a vault that doesn't decrypt is an error, never a silent fallback to a
  different account.
- On the web, a hybrid ("use a phone") sign-in whose provider returns no PRF output fails as
  `prf-unavailable`, which is when the app offers linking.

### 9.7 Threat model

- **The relayer is untrusted.** It sees slot ids (SHA-256 of secrets it doesn't know), ciphertext,
  sizes, timing and IP addresses. It never sees `s`, `linkSecret`, `b2` or `vaultAuth` (only
  `SHA-256(vaultAuth)` is stored). It can't forge an offer (it needs `s` for the AEAD key) or a reply
  (the sealed box's AAD binds `s` and `exp`, so a box sealed by someone who only knows `linkPub`
  doesn't open). It can withhold, delay or delete records: that makes a link fail, never succeed
  with the wrong account.
- **Code path brute force.** The code has 60 bits. Online, a guess needs a GET per candidate code,
  rate-limited, inside a 10-minute window. Offline, someone holding an offer box (the relayer) must
  run HKDF + AEAD per guess: 2⁶⁰ guesses in 10 minutes is about 2·10¹⁵ per second. Even a guessed
  code only reveals `linkPub`, not the account: the account goes only to `linkPub`. A guesser could
  at most answer the link first with *their own* account (the real phone would then get
  `used`), which is why the browser should show the received account's name and
  key fingerprint (`p`, `fp`) for the person to recognise before using it.
- **Why the fingerprint must be compared.** It covers the cases the cryptography can't: a QR or code
  read from the wrong screen (someone else's link shown to you), or a code typed into the phone
  that belongs to an attacker who is racing to get your account. If the three emoji on the phone
  aren't the three on the browser in front of you, don't send.
- **One-time key, 10-minute expiry.** `linkSecret` exists only in that browser tab's memory and is
  wiped when the link settles. Offer and reply slots expire after at most 10 minutes (the relayer
  deletes them lazily on read and in an hourly sweep). The reply slot is write-once, so a link can
  be answered once.
- **Vault overwrite needs `vaultAuth`.** Only the holder of that browser passkey can replace its
  vault. Anyone who knows the credential id can read the ciphertext; it opens only with `b2`.
- **If the relayer loses a vault**, that browser can no longer open the account: it must be linked
  again from the phone. The phone's account is never affected: it still comes from the phone's own
  passkey, and the account, its plans and its money are onchain.
- **Compromise of a linked browser's passkey** gives the account key, the same as compromise of the
  phone's passkey. Linking adds one more device that can sign for the account; there is no
  "unlink" that revokes the key (it is the same account), only deleting the browser passkey.

### 9.8 Relayer slots API

`PUT /v1/slots/<64 hex>` with JSON `{"data": b64u (≤ 8192 bytes decoded), "ttl"?: 60–600 (omitted =
permanent), "auth"?: 64 hex}`. No slot, or an expired one → 201 created. An unexpired slot is
overwritten (200) only if it was created with `auth` and `sha256(auth)` matches; otherwise 409
`SLOT_TAKEN`. `GET /v1/slots/<id>` → 200 `{"data", "expiresAt": unix | null}` with
`Cache-Control: no-store`, or 404 `NOT_FOUND` (missing or expired). Also 400 bad id/body, 413 over
8192 bytes, 429 over 60 writes per IP per hour, 507 storage full (shared with blobs), 404
`SLOTS_DISABLED`. Files: `<BLOB_DIR>/slots/<aa>/<id>`, written atomically. See `relayer/README.md`.
