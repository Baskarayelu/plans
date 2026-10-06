/**
 * The create-plan draft carried between screens 10 → 11 → 12 (nothing is saved until "Create
 * plan"). Dates are kept as local calendar days; `planTimes` turns them into onchain seconds.
 */
import type { Rules } from "../chain/eip712";
import { PRESETS, type PresetId } from "../domain/rules";
import { createStore } from "../state/observable";
import { WRISTBANDS } from "../../theme/tokens";

export const EMOJIS = ["🌊", "🎪", "🏔️", "🎂", "🏖️", "🍜", "🚐"] as const;
export type WristbandName = keyof typeof WRISTBANDS;

export const DAY_MS = 86_400_000;
export const MAX_PLAN_SEC = 365 * 86_400;

/** Local midnight (ms) of the day containing `ms`. */
export function dayOf(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(dayMs: number, n: number): number {
  const d = new Date(dayMs);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export type Draft = {
  name: string;
  emoji: string;
  color: WristbandName;
  /** Local midnight (ms) of the first day. Today means "starts now". */
  startDay: number;
  /** Local midnight (ms) of the last day; the plan ends at the end of that day. */
  endDay: number;
  preset: PresetId | "custom";
  /** Rules saved from screen 12 (when preset is "custom"). */
  custom?: Rules;
  /** The preset the custom rules started from (review window and Pilot dates follow it). */
  customBase: Exclude<PresetId, "demo">;
};

function fresh(): Draft {
  const today = dayOf(Date.now());
  return { name: "", emoji: EMOJIS[0], color: "lagoon", startDay: today, endDay: addDays(today, 5), preset: "balanced", customBase: "balanced" };
}

export const draft = createStore<Draft>(fresh());

export function resetDraft(): void {
  draft.set(fresh());
}

export function draftRules(d: Draft): Rules {
  if (d.preset === "custom" && d.custom) return d.custom;
  return PRESETS[d.preset === "custom" ? d.customBase : d.preset].rules;
}

/** The preset that decides the review window and whether dates are fixed. */
export function draftBase(d: Draft): Exclude<PresetId, "demo"> {
  if (d.preset === "custom") return d.customBase;
  return d.preset === "demo" ? "balanced" : d.preset;
}

/** Onchain start/end (seconds). Pilot fixes now → +48 h. */
export function planTimes(d: Draft, nowMs = Date.now()): { startTime: number; endTime: number; fixed: boolean } {
  const base = PRESETS[draftBase(d)];
  const now = Math.floor(nowMs / 1000);
  if (base.durationSec) return { startTime: now, endTime: now + base.durationSec, fixed: true };
  const today = dayOf(nowMs);
  const startTime = d.startDay <= today ? now : Math.floor(d.startDay / 1000);
  let endTime = Math.floor(addDays(d.endDay, 1) / 1000) - 1;
  if (endTime < startTime) endTime = startTime;
  if (endTime - startTime > MAX_PLAN_SEC) endTime = startTime + MAX_PLAN_SEC;
  return { startTime, endTime, fixed: false };
}

/** Invite links of plans created in this session (backup when the encrypted cache is unavailable). */
const createdInvites = new Map<string, string>();
export function rememberCreatedInvite(pot: string, url: string): void {
  createdInvites.set(pot.toLowerCase(), url);
}
export function createdInviteFor(pot: string): string | undefined {
  return createdInvites.get(pot.toLowerCase());
}
