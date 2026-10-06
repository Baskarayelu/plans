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
accident. Restore flow: `getPasskeyPrfOutput` with no credential → the system picker.

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
