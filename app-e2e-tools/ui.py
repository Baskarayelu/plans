#!/usr/bin/env python3
"""Tiny adb UI driver used to prepare emulators and run step-by-step flows.

  ui.py <serial> dump                 list visible text / ids / clickable nodes
  ui.py <serial> tap <regex>          tap the first node whose text, content-desc or id matches
  ui.py <serial> wait <regex> [secs]  wait until a node matches (default 20 s)
  ui.py <serial> finger [n]           simulate fingerprint touch (finger id n, default 1)
  ui.py <serial> shot <path.png>      save a screenshot
"""
import re
import subprocess
import sys
import time

ADB = "/opt/homebrew/share/android-commandlinetools/platform-tools/adb"


def adb(serial, *args, binary=False):
    out = subprocess.run([ADB, "-s", serial, *args], capture_output=True)
    return out.stdout if binary else out.stdout.decode("utf-8", "replace")


def nodes(serial):
    adb(serial, "shell", "uiautomator", "dump", "/sdcard/ui.xml")
    xml = adb(serial, "shell", "cat", "/sdcard/ui.xml")
    found = []
    for m in re.finditer(r"<node ([^>]*?)/?>", xml):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
        b = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", attrs.get("bounds", ""))
        if not b:
            continue
        x1, y1, x2, y2 = map(int, b.groups())
        attrs["cx"], attrs["cy"] = (x1 + x2) // 2, (y1 + y2) // 2
        found.append(attrs)
    return found


def match(serial, pattern):
    rx = re.compile(pattern, re.I)
    for n in nodes(serial):
        for key in ("text", "content-desc", "resource-id"):
            if n.get(key) and rx.search(n[key]):
                return n
    return None


def main():
    serial, cmd, *rest = sys.argv[1:]
    if cmd == "dump":
        for n in nodes(serial):
            label = n.get("text") or n.get("content-desc") or ""
            if label or n.get("clickable") == "true":
                print(f'{label!r:50} id={n.get("resource-id","")} click={n.get("clickable")} @({n["cx"]},{n["cy"]})')
    elif cmd == "tap":
        n = match(serial, rest[0])
        if not n:
            sys.exit(f"no node matching {rest[0]!r}")
        adb(serial, "shell", "input", "tap", str(n["cx"]), str(n["cy"]))
        print(f'tapped {n.get("text") or n.get("content-desc") or n.get("resource-id")}')
    elif cmd == "wait":
        deadline = time.time() + (float(rest[1]) if len(rest) > 1 else 20)
        while time.time() < deadline:
            if match(serial, rest[0]):
                print("found")
                return
            time.sleep(1)
        sys.exit(f"timeout waiting for {rest[0]!r}")
    elif cmd == "finger":
        adb(serial, "emu", "finger", "touch", rest[0] if rest else "1")
        print("finger touched")
    elif cmd == "shot":
        open(rest[0], "wb").write(adb(serial, "exec-out", "screencap", "-p", binary=True))
        print(rest[0])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
