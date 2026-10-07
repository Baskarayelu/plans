# Passkey checks: two keys from one prompt

Plans needs one passkey prompt to return two independent keys from the same passkey:
- `first`: Mera's default salt, which gives the account key
- `second`: salt `sha256("plans.keys.v1")`, which gives the encryption keys

Both come from the WebAuthn PRF extension, evaluated in a single ceremony. Raw outputs are never shown; only short SHA-256 prefixes are recorded.

| Platform | Passkey provider | Where tested | Result | Date |
|---|---|---|---|---|
| Android 15, Plans Test app (`in.oxo.plans.test`) | Google Password Manager (Play services 26.36) | Emulator play35-a, real domain `plans.0xo.in`, existing passkey | **PASS: first and second both returned from one prompt** | 7 Oct 2026 |
| Android Chrome, https://plans.0xo.in/probe | Google Password Manager | — | Pending | — |
| iPhone Safari, https://plans.0xo.in/probe | iCloud Keychain | Entrant's iPhone | Pending | — |
| Mac Safari, https://plans.0xo.in/probe | iCloud Keychain | Entrant's Mac | Pending | — |
| Mac Chrome, https://plans.0xo.in/probe | iCloud Keychain or Google Password Manager | Entrant's Mac | Pending | — |

**Android app result (logcat tag `PLANS_PRF`):** `mode=get ok=true first=yes second=yes firstSha=0x4787633fb5d071f9 secondSha=0x961fde0037674ce7 keyFingerprint=🦉🐤🥀 android=15/sdk35`.

**Note for new devices:** the first time a device saves a passkey to Google Password Manager, Google may ask for the screen lock of one of your other devices ("Enter your screen lock for the selected device"). This happens once per device and is Google's step, not Plans'.
