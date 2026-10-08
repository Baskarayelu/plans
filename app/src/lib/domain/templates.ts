/**
 * Trip templates (Group 2, A4): a starting point for a new plan. A template fills the name, emoji,
 * wristband colour, dates, rules preset and category budgets scaled to the people going and the days;
 * the person can change any of it before "Create plan". Nothing here reaches the contract except
 * through the normal Rules (categoryBudgets are the existing rule field).
 */
import type { Rules } from "../chain/eip712";
import { addDays, DAY_MS, MAX_PLAN_SEC, type Draft, type WristbandName } from "../core/draft";
import { ONE_DOLLAR } from "./currency";
import { CATEGORIES, PRESETS, type PresetId } from "./rules";

export type TemplateId = "city-break" | "festival" | "ski-week" | "house-share";
type CategoryId = (typeof CATEGORIES)[number]["id"];

export type Template = {
  id: TemplateId;
  title: string;
  /** The plan's name to start with (the wristband adds the dates). */
  short: string;
  emoji: string;
  color: WristbandName;
  preset: Exclude<PresetId, "demo" | "pilot">;
  /** Usual group size. */
  people: number;
  /** Days, first to last, inclusive. */
  days: number;
  /** Day of the week it starts on (0 Sunday … 6 Saturday), the next one from today; none = today. */
  startDow?: number;
  /** Dollars per person, once (travel there, a festival ticket). */
  once: Partial<Record<CategoryId, number>>;
  /** Dollars per person per day. */
  daily: Partial<Record<CategoryId, number>>;
};

const NO_BUDGETS = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as unknown as Rules["categoryBudgets"];

export const MIN_PEOPLE = 2;
export const MAX_PEOPLE = 20;
const MAX_DAYS = Math.floor(MAX_PLAN_SEC / 86400);

export const TEMPLATES: readonly Template[] = [
  {
    id: "city-break",
    title: "City break",
    short: "City break",
    emoji: "🏙️",
    color: "iris",
    preset: "balanced",
    people: 4,
    days: 3,
    startDow: 5,
    once: { 1: 120 },
    daily: { 0: 60, 2: 10, 3: 45, 4: 20 },
  },
  {
    id: "festival",
    title: "Festival",
    short: "Festival",
    emoji: "🎪",
    color: "orchid",
    preset: "easygoing",
    people: 6,
    days: 4,
    startDow: 4,
    once: { 1: 40, 4: 250 },
    daily: { 3: 40, 5: 15 },
  },
  {
    id: "ski-week",
    title: "Ski week",
    short: "Ski week",
    emoji: "🏔️",
    color: "lime",
    preset: "balanced",
    people: 6,
    days: 8,
    startDow: 6,
    once: { 1: 150, 2: 40 },
    daily: { 0: 70, 3: 50, 4: 70, 5: 15 },
  },
  {
    id: "house-share",
    title: "House share",
    short: "House share",
    emoji: "🏠",
    color: "coral",
    preset: "strict",
    people: 4,
    days: 30,
    once: { 6: 30 },
    daily: { 5: 5, 7: 3 },
  },
];

export function templateOf(id: TemplateId): Template {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`unknown template ${id}`);
  return t;
}

export const clampPeople = (n: number) => Math.max(MIN_PEOPLE, Math.min(MAX_PEOPLE, Math.round(n)));

/** Days from first to last, inclusive (DST-safe). */
export function spanDays(startDay: number, endDay: number): number {
  return Math.round((endDay - startDay) / DAY_MS) + 1;
}

/** The next start day on or after today, and the last day. */
export function templateDates(t: Template, today: number): { startDay: number; endDay: number } {
  const dow = new Date(today).getDay();
  const startDay = t.startDow === undefined ? today : addDays(today, (t.startDow - dow + 7) % 7);
  return { startDay, endDay: addDays(startDay, Math.min(t.days, MAX_DAYS) - 1) };
}

/** Dollars for a category, before rounding. */
function exact(t: Template, cat: CategoryId, people: number, days: number): number {
  return ((t.once[cat] ?? 0) + (t.daily[cat] ?? 0) * days) * people;
}

/** Category budgets in AUSD units, each rounded up to the next $10. Categories the template skips stay at none (0). */
export function templateBudgets(t: Template, people: number, days: number): Rules["categoryBudgets"] {
  const n = clampPeople(people);
  const dd = Math.max(1, Math.min(days, MAX_DAYS));
  return CATEGORIES.map((c) => {
    const d = exact(t, c.id, n, dd);
    return d > 0 ? BigInt(Math.ceil(d / 10) * 10) * ONE_DOLLAR : 0n;
  }) as unknown as Rules["categoryBudgets"];
}

export function budgetTotal(b: readonly bigint[]): bigint {
  return b.reduce((a, x) => a + x, 0n);
}

export function templateName(t: Template): string {
  return t.short.slice(0, 40);
}

/** Everything a template puts into the draft (screen 10). */
export function applyTemplate(t: Template, today: number, people = t.people): Partial<Draft> {
  const { startDay, endDay } = templateDates(t, today);
  const name = templateName(t);
  const n = clampPeople(people);
  return {
    name,
    autoName: name,
    emoji: t.emoji,
    color: t.color,
    startDay,
    endDay,
    preset: t.preset,
    customBase: t.preset,
    custom: undefined,
    budgets: templateBudgets(t, n, spanDays(startDay, endDay)),
    template: { id: t.id, people: n, edited: false },
  };
}

/** Back to a blank plan: the template's budgets go, and its name if the person didn't change it. */
export function clearTemplate(d: Draft): Partial<Draft> {
  return {
    template: undefined,
    budgets: undefined,
    // custom rules keep only budgets the person set themselves
    custom: d.custom && d.template && !d.template.edited ? { ...d.custom, categoryBudgets: NO_BUDGETS } : d.custom,
    autoName: undefined,
    name: d.autoName !== undefined && d.name === d.autoName ? "" : d.name,
  };
}

/**
 * A change to the draft's people or dates, plus what follows from it: budgets rescale until someone
 * edits them on screen 12.
 */
export function followTemplate(d: Draft, patch: Partial<Draft>): Partial<Draft> {
  const next = { ...d, ...patch };
  if (!next.template || next.template.edited) return patch;
  return { ...patch, budgets: templateBudgets(templateOf(next.template.id), next.template.people, spanDays(next.startDay, next.endDay)) };
}

/** The budgets a template would give for this draft now (screen 12's Reset). */
export function draftTemplateBudgets(d: Draft): Rules["categoryBudgets"] | undefined {
  if (!d.template) return undefined;
  return templateBudgets(templateOf(d.template.id), d.template.people, spanDays(d.startDay, d.endDay));
}

/** "3 days · Balanced" for a template card. */
export function templateSub(t: Template): string {
  return `${t.days === 30 ? "A month" : `${t.days} days`} · ${PRESETS[t.preset].title}`;
}
