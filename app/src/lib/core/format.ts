/** Small, Intl-free date/number helpers for the plan screens (Hermes formats identically). */
import { NetworkError } from "../api/http";
import { friendlyError } from "../api/relayer";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");

/** "14:05" local. */
export function hhmm(sec: number): string {
  const d = new Date(sec * 1000);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** "14:05 UTC" */
export function hhmmUtc(sec: number): string {
  const d = new Date(sec * 1000);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}

/** "12 Oct" */
export function dayMonth(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}

/** "today at 14:05" / "Thu 14:05" / "12 Oct 14:05". */
export function when(sec: number, nowSec = Date.now() / 1000): string {
  const d = new Date(sec * 1000);
  const now = new Date(nowSec * 1000);
  if (d.toDateString() === now.toDateString()) return `today at ${hhmm(sec)}`;
  if (Math.abs(nowSec - sec) < 6 * 86400) return `${DOW[d.getDay()]} ${hhmm(sec)}`;
  return `${dayMonth(sec)} ${hhmm(sec)}`;
}

/** True when an error means "no connection" rather than a real failure. */
export function isOffline(e: unknown): boolean {
  if (!e) return false;
  if (e instanceof NetworkError) return true;
  return friendlyError(e).offline;
}

/** First 6 hex chars after 0x, used in test ids. */
export const addr6 = (a: string) => a.toLowerCase().slice(2, 8);
