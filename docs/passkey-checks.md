# Passkey checks: two keys from one prompt

Plans needs one passkey prompt to return two independent keys from the same passkey:
- `first`: Mera's default salt, which gives the account key
- `second`: salt `sha256("plans.keys.v1")`, which gives the encryption keys

Both come from the WebAuthn PRF extension, evaluated in a single ceremony. Raw outputs are never shown; only short SHA-256 prefixes are recorded.

| Platform | Passkey provider | Where tested | Result | Date |
|---|---|---|---|---|
| Android 15, Plans Test app (`in.oxo.plans.test`) | Google Password Manager (Play services 26.36) | Emulator play35-a, real domain `plans.0xo.in`, existing passkey | **PASS: first and second both returned from one prompt** | 7 Oct 2026 |
| Android Chrome, https://plans.0xo.in/probe | Google Password Manager | — | Pending (the Android app result above uses the same provider) | — |
| Mac Chrome (AppleWebKit/537.36), https://plans.0xo.in/probe | Platform passkey (platform attachment) | Entrant's Mac | **PASS: both keys from one prompt**; PRF enabled; same values at create and get (first `5dc78cb8`, second `14c90513`, credential `7d15931d`) | 7 Oct 2026, 09:01 UTC |
| Mac Safari 26.6.2, https://plans.0xo.in/probe | iCloud Keychain (platform attachment) | Entrant's Mac | **PASS: both keys from one prompt**; PRF enabled; same values at create and get (first `9e6614e6`, second `ff7f2f10`, credential `4f7d710d`) | 7 Oct 2026, 09:12 UTC |
| iPhone Chrome (CriOS/154, iOS 26.6.1), https://plans.0xo.in/probe | Platform passkey (platform attachment) | Entrant's iPhone | **PASS: both keys from one prompt**; PRF enabled; same values at create and get (first `2815754e`, second `b8a870a5`, credential `e4bb138a`) | 7 Oct 2026, 09:16 UTC |
| iPhone Safari 26.6.1, https://plans.0xo.in/probe | iCloud Keychain (platform attachment) | Entrant's iPhone | **PASS: both keys from one prompt**; PRF enabled; same values at create and get (first `363befae`, second `8ab403dc`, credential `473c380d`) | 7 Oct 2026, 09:27 UTC |

**Android app result (logcat tag `PLANS_PRF`):** `mode=get ok=true first=yes second=yes firstSha=0x4787633fb5d071f9 secondSha=0x961fde0037674ce7 keyFingerprint=🦉🐤🥀 android=15/sdk35`.

**Note for new devices:** the first time a device saves a passkey to Google Password Manager, Google may ask for the screen lock of one of your other devices ("Enter your screen lock for the selected device"). This happens once per device and is Google's step, not Plans'.

**Different password managers give different passkeys.** Each browser above created its own passkey, so each produced different keys. A passkey in Google Password Manager and one in iCloud Keychain are separate accounts unless the user brings the account across. The web app handles this: it always offers the existing account first, and never silently creates a second one.
