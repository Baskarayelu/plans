#!/usr/bin/env python3
"""Recount every portal field in docs/submission.md and fail if one is over its limit.

Each field is written as:

    <!-- field: Description | limit: 8000 -->
    Characters: 1234 / 8000
    ```text
    ...field text...
    ```

The "Characters" line is rewritten in place. Length is counted in UTF-16 code
units, the way a browser counts a text field, so emoji count as two.
"""
import pathlib
import re
import sys

PATH = pathlib.Path(__file__).resolve().parent.parent / "docs" / "submission.md"
FIELD = re.compile(
    r"<!-- field: (?P<name>[^|]+?) \| limit: (?P<limit>\d+) -->\n"
    r"Characters: [^\n]*\n"
    r"```text\n(?P<body>.*?)\n```",
    re.S,
)


def utf16_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def main() -> int:
    src = PATH.read_text(encoding="utf-8")
    over = []

    def fix(m: re.Match) -> str:
        name, limit, body = m["name"], int(m["limit"]), m["body"]
        n = utf16_len(body)
        flag = "" if n <= limit else "  ← OVER LIMIT"
        if n > limit:
            over.append(f"{name}: {n} > {limit}")
        print(f"{n:>5} / {limit:<5} {name}{flag}")
        return (
            f"<!-- field: {name} | limit: {limit} -->\n"
            f"Characters: {n} / {limit}\n"
            f"```text\n{body}\n```"
        )

    out = FIELD.sub(fix, src)
    PATH.write_text(out, encoding="utf-8")
    if over:
        print("Over limit:\n  " + "\n  ".join(over), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
