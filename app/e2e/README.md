# Maestro flows

```bash
export PATH="$HOME/.maestro/bin:$PATH" JAVA_HOME=/opt/homebrew/opt/openjdk@17
COMMON="-e APP_ID=in.oxo.plans.test -e PIN=<emulator screen-lock PIN>"
maestro --device emulator-5582 test $COMMON -e NAME=Sam -e COUNTRY=US -e COUNTRY_NAME="United States" e2e/01_install_create.yaml
maestro --device emulator-5584 test $COMMON -e NAME=Leah -e COUNTRY=GB -e COUNTRY_NAME="United Kingdom" -e INVITE_URL='<invite link>' e2e/02_join_invite.yaml
```

| Flow | What it checks | Needs |
|---|---|---|
| 01_install_create | fresh install → Create account (one prompt) → profile → home | PIN, NAME, COUNTRY, COUNTRY_NAME |
| 02_join_invite | invite App Link → join with ONE prompt → "You're in!" → plan | INVITE_URL (+ profile vars) |
| 03_claim_link | claim link → claim (new or existing user) → balance | CLAIM_URL |
| 04_instant_spend | Pay → $0.10 → "Goes through now" → Paid + Settled in + Proof | inside a plan; MEMBER_NAME |
| 05_approval_spend | $0.40 → "Needs 1 more approval" → demo approval | judges' plan with demo members |
| 06_cross_border_send | Plans code link → £1 → confirm → Sent receipt | CODE_URL of the other phone |
| 07_dispute | question a spend → vote screen | start on a spend detail |
| 08_settle_demo | Try a settle-up → end → one-tap settle → All settled | relayer demo enabled |
| 09_clear_storage_restore | clear storage → restore → same fingerprint | FINGERPRINT |
| 10_encrypted_receipt_second_device | second phone, same passkey → note decrypts | PLAN_NAME, NOTE |

The passkey sheet is Android's (Google Password Manager); `subflows/passkey.yaml` taps
Continue/Create and types the screen-lock PIN. The emulator must be signed in to Google with a
screen lock set, and `plans.0xo.in/.well-known/assetlinks.json` must list the package and
certificate (see ../README.md).
