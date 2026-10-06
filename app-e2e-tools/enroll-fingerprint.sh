#!/bin/zsh
# Enroll simulated fingerprint 1 on an emulator whose screen-lock PIN is 1111.
# Usage: enroll-fingerprint.sh emulator-5582
S=$1
DIR=${0:A:h}
A=/opt/homebrew/share/android-commandlinetools/platform-tools/adb
u(){ python3 "$DIR/ui.py" "$S" "$@"; }
$A -s $S shell am start -a android.settings.FINGERPRINT_ENROLL >/dev/null
sleep 3
u tap "^Wait$" >/dev/null 2>&1 && sleep 2
if u wait "Re-enter your PIN|Enter your PIN|Confirm your PIN" 8 >/dev/null 2>&1; then
  $A -s $S shell input text 1111; $A -s $S shell input keyevent 66; sleep 3
fi
for i in 1 2 3 4 5 6; do
  u tap "^(MORE|More)$" >/dev/null 2>&1 && { sleep 1; continue; }
  u tap "^(I AGREE|I agree|AGREE|Agree|Start|START|Next|NEXT)$" >/dev/null 2>&1 && { sleep 2; }
  u wait "Touch the sensor|Put your finger|Lift|Touch and hold|sensor" 2 >/dev/null 2>&1 && break
done
for i in $(seq 1 20); do
  $A -s $S emu finger touch 1 >/dev/null; sleep 1.2
  if u wait "Fingerprint added|Fingerprint & PIN|^Done$|DONE" 1 >/dev/null 2>&1; then break; fi
done
u tap "^(Done|DONE)$" >/dev/null 2>&1
$A -s $S shell dumpsys fingerprint 2>/dev/null | grep -o '"count":[0-9]*' | head -1
