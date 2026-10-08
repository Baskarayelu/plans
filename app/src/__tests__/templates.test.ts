/** Trip templates (Group 2): template → plan draft (budgets, presets, dates, names). */
import { addDays, dayOf, draftRules, planTimes, MAX_PLAN_SEC, type Draft } from "../lib/core/draft";
import { ONE_DOLLAR } from "../lib/domain/currency";
import { CATEGORIES, PRESETS } from "../lib/domain/rules";
import {
  applyTemplate,
  budgetTotal,
  clampPeople,
  clearTemplate,
  draftTemplateBudgets,
  followTemplate,
  MAX_PEOPLE,
  MIN_PEOPLE,
  spanDays,
  templateBudgets,
  templateDates,
  templateOf,
  TEMPLATES,
} from "../lib/domain/templates";
import { WRISTBANDS } from "../theme/tokens";

// Wed 14 Oct 2026, local midnight
const WED = dayOf(new Date(2026, 9, 14, 15, 30).getTime());

function blank(today = WED): Draft {
  return { name: "", emoji: "🌊", color: "lagoon", startDay: today, endDay: addDays(today, 5), preset: "balanced", customBase: "balanced" };
}
const draftFrom = (id: (typeof TEMPLATES)[number]["id"], today = WED, people?: number): Draft => ({ ...blank(today), ...applyTemplate(templateOf(id), today, people) });
const dollars = (n: number) => BigInt(n) * ONE_DOLLAR;

describe("template definitions", () => {
  it("ids are unique and every template has a visible, non-pilot preset", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) {
      const p = PRESETS[t.preset];
      expect(p).toBeDefined();
      expect(p.hidden).toBeFalsy();
      expect(p.durationSec).toBeUndefined();
    }
  });

  it("colours are wristbands, categories exist, amounts are positive, people in range", () => {
    for (const t of TEMPLATES) {
      expect(Object.keys(WRISTBANDS)).toContain(t.color);
      for (const m of [t.once, t.daily]) {
        for (const [k, v] of Object.entries(m)) {
          expect(CATEGORIES.map((c) => c.id)).toContain(Number(k));
          expect(v).toBeGreaterThan(0);
        }
      }
      expect(t.people).toBeGreaterThanOrEqual(MIN_PEOPLE);
      expect(t.people).toBeLessThanOrEqual(MAX_PEOPLE);
      expect(t.days * 86400).toBeLessThanOrEqual(MAX_PLAN_SEC);
    }
  });
});

describe("dates", () => {
  it("weekend city break: the next Friday to Sunday", () => {
    const { startDay, endDay } = templateDates(templateOf("city-break"), WED);
    expect(new Date(startDay).getDay()).toBe(5);
    expect(startDay).toBe(addDays(WED, 2));
    expect(new Date(endDay).getDay()).toBe(0);
    expect(spanDays(startDay, endDay)).toBe(3);
  });

  it("starts today when today is the start day", () => {
    const fri = addDays(WED, 2);
    expect(templateDates(templateOf("city-break"), fri).startDay).toBe(fri);
  });

  it("festival Thursday–Sunday, ski week Saturday to Saturday, house share from today for a month", () => {
    const f = templateDates(templateOf("festival"), WED);
    expect([new Date(f.startDay).getDay(), new Date(f.endDay).getDay(), spanDays(f.startDay, f.endDay)]).toEqual([4, 0, 4]);
    const s = templateDates(templateOf("ski-week"), WED);
    expect([new Date(s.startDay).getDay(), new Date(s.endDay).getDay(), spanDays(s.startDay, s.endDay)]).toEqual([6, 6, 8]);
    const h = templateDates(templateOf("house-share"), WED);
    expect(h.startDay).toBe(WED);
    expect(spanDays(h.startDay, h.endDay)).toBe(30);
  });

  it("never starts before today and the plan times are valid", () => {
    for (const t of TEMPLATES) {
      for (let i = 0; i < 7; i++) {
        const today = addDays(WED, i);
        const d = draftFrom(t.id, today);
        expect(d.startDay).toBeGreaterThanOrEqual(today);
        expect(d.startDay - today).toBeLessThan(7 * 86_400_000);
        const now = today + 10 * 3600_000;
        const { startTime, endTime, fixed } = planTimes(d, now);
        expect(fixed).toBe(false);
        expect(endTime).toBeGreaterThan(startTime);
        expect(endTime - startTime).toBeLessThanOrEqual(MAX_PLAN_SEC);
      }
    }
  });
});

describe("budgets", () => {
  it("city break for 4 over 3 days: exact numbers", () => {
    const b = templateBudgets(templateOf("city-break"), 4, 3);
    // Stay 60×3×4, Travel 120×4, Getting around 10×3×4, Food 45×3×4, Tickets 20×3×4
    expect(b).toEqual([dollars(720), dollars(480), dollars(120), dollars(540), dollars(240), 0n, 0n, 0n]);
    expect(budgetTotal(b)).toBe(dollars(2100));
  });

  it("every budget is the per-person amounts × people × days, rounded up to $10, and the total is their sum", () => {
    for (const t of TEMPLATES) {
      for (const people of [2, 3, 7, 20]) {
        for (const days of [1, 3, 8, 30]) {
          const b = templateBudgets(t, people, days);
          expect(b).toHaveLength(8);
          let sum = 0n;
          for (const c of CATEGORIES) {
            const exact = ((t.once[c.id] ?? 0) + (t.daily[c.id] ?? 0) * days) * people;
            const got = Number(b[c.id] / ONE_DOLLAR);
            expect(b[c.id] % (10n * ONE_DOLLAR)).toBe(0n);
            expect(got).toBeGreaterThanOrEqual(exact);
            expect(got).toBeLessThan(exact + 10);
            if (exact === 0) expect(b[c.id]).toBe(0n);
            sum += b[c.id];
          }
          expect(budgetTotal(b)).toBe(sum);
        }
      }
    }
  });

  it("budgets grow with people and days", () => {
    const t = templateOf("ski-week");
    expect(budgetTotal(templateBudgets(t, 7, 8))).toBeGreaterThan(budgetTotal(templateBudgets(t, 6, 8)));
    expect(budgetTotal(templateBudgets(t, 6, 9))).toBeGreaterThan(budgetTotal(templateBudgets(t, 6, 8)));
  });

  it("people are kept between 2 and 20", () => {
    expect(clampPeople(0)).toBe(2);
    expect(clampPeople(99)).toBe(20);
    expect(templateBudgets(templateOf("festival"), 1, 4)).toEqual(templateBudgets(templateOf("festival"), 2, 4));
  });
});

describe("template → draft", () => {
  it("fills name, emoji, colour, dates, preset and budgets", () => {
    const d = draftFrom("ski-week");
    const t = templateOf("ski-week");
    expect(d.emoji).toBe(t.emoji);
    expect(d.color).toBe(t.color);
    expect(d.preset).toBe("balanced");
    expect(d.customBase).toBe("balanced");
    expect(d.name).toBe("Ski week");
    expect(d.name.length).toBeLessThanOrEqual(40);
    expect(d.template).toEqual({ id: "ski-week", people: 6, edited: false });
    expect(d.budgets).toEqual(templateBudgets(t, 6, 8));
  });

  it("the rules sent to the contract are the preset's, with the template's budgets", () => {
    const d = draftFrom("house-share");
    const r = draftRules(d);
    const { categoryBudgets, ...rest } = r;
    const { categoryBudgets: _none, ...presetRest } = PRESETS.strict.rules;
    expect(rest).toEqual(presetRest);
    expect(categoryBudgets).toEqual(d.budgets);
    expect(r.proposalTtl).toBeGreaterThan(0);
  });

  it("choosing another preset keeps the budgets", () => {
    const d = { ...draftFrom("festival"), preset: "strict" as const, customBase: "strict" as const };
    expect(draftRules(d).instantMax).toBe(PRESETS.strict.rules.instantMax);
    expect(draftRules(d).categoryBudgets).toEqual(d.budgets);
  });

  it("more people or longer dates rescale the budgets; the name stays", () => {
    const d = draftFrom("city-break");
    const more = { ...d, ...followTemplate(d, { template: { ...d.template!, people: 6 } }) };
    expect(more.budgets).toEqual(templateBudgets(templateOf("city-break"), 6, 3));
    const longer = { ...more, ...followTemplate(more, { endDay: addDays(more.endDay, 1) }) };
    expect(longer.budgets).toEqual(templateBudgets(templateOf("city-break"), 6, 4));
    expect(longer.name).toBe("City break");
    expect(draftTemplateBudgets(longer)).toEqual(longer.budgets);
  });

  it("budgets the person edited stay", () => {
    const d = draftFrom("city-break");
    const mine = [...d.budgets!] as bigint[];
    mine[0] = dollars(999);
    const edited: Draft = { ...d, budgets: mine as unknown as Draft["budgets"], template: { ...d.template!, edited: true } };
    const after = { ...edited, ...followTemplate(edited, { template: { ...edited.template!, people: 10 } }) };
    expect(after.budgets![0]).toBe(dollars(999));
  });

  it("no template: changes pass straight through", () => {
    const d = blank();
    expect(followTemplate(d, { endDay: addDays(d.endDay, 1) })).toEqual({ endDay: addDays(d.endDay, 1) });
    expect(draftRules(d)).toBe(PRESETS.balanced.rules);
  });

  it("blank again: budgets and the template's name go, a typed name stays", () => {
    const d = draftFrom("festival");
    const cleared = { ...d, ...clearTemplate(d) };
    expect(cleared.template).toBeUndefined();
    expect(cleared.budgets).toBeUndefined();
    expect(cleared.name).toBe("");
    expect(draftRules(cleared).categoryBudgets).toEqual(PRESETS.easygoing.rules.categoryBudgets);
    const typed = { ...d, name: "Glasto" };
    expect({ ...typed, ...clearTemplate(typed) }.name).toBe("Glasto");
  });
});

describe("with screen 12's custom rules", () => {
  it("unedited template budgets keep following people; the custom limits stay", () => {
    const d = draftFrom("city-break");
    const custom = { ...draftRules(d), instantMax: dollars(40) };
    const saved: Draft = { ...d, preset: "custom", custom, budgets: custom.categoryBudgets };
    const more = { ...saved, ...followTemplate(saved, { template: { ...saved.template!, people: 8 } }) };
    expect(draftRules(more).instantMax).toBe(dollars(40));
    expect(draftRules(more).categoryBudgets).toEqual(templateBudgets(templateOf("city-break"), 8, 3));
  });

  it("blank again drops unedited template budgets from custom rules too", () => {
    const d = draftFrom("festival");
    const custom = { ...draftRules(d), instantMax: dollars(40) };
    const saved: Draft = { ...d, preset: "custom", custom, budgets: custom.categoryBudgets };
    const cleared = { ...saved, ...clearTemplate(saved) };
    expect(draftRules(cleared).instantMax).toBe(dollars(40));
    expect(draftRules(cleared).categoryBudgets.every((b) => b === 0n)).toBe(true);
  });
});
