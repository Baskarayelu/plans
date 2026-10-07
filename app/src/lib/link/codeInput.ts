/**
 * The phone's "Type the code" field (design 172): capitals or not, the dashes are added as you
 * type, and O/I/L become 0/1 (the code alphabet has no O or I). Characters outside the alphabet
 * are dropped. At most 12 characters, shown XXXX-XXXX-XXXX.
 */
import { CROCKFORD, LINK_CODE_LENGTH } from "./protocol";

/** The 12-or-fewer code characters in a typed value. */
export function codeChars(input: string): string {
  let out = "";
  for (const ch0 of input.toUpperCase()) {
    const ch = ch0 === "O" ? "0" : ch0 === "I" || ch0 === "L" ? "1" : ch0;
    if (CROCKFORD.includes(ch)) out += ch;
    if (out.length === LINK_CODE_LENGTH) break;
  }
  return out;
}

/** What the field shows: "K7Q2-9RXD-M4", with a dash after every four characters. */
export function formatCodeInput(input: string): string {
  const c = codeChars(input);
  return [c.slice(0, 4), c.slice(4, 8), c.slice(8, 12)].filter(Boolean).join("-");
}

export function isCompleteCode(input: string): boolean {
  return codeChars(input).length === LINK_CODE_LENGTH;
}
