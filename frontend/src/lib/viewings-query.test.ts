import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listViewingParams, weekRange, weekViewingParams } from "./viewings-query";

// Regression for the viewings "Scheduled" tab that requested its list again and again: the parameters must be a pure function of their inputs. The clock is
// an INPUT (`nowIso`), read once by the page per genuine view change; nothing here may read it.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 17, 10, 0, 0));
});
afterEach(() => vi.useRealTimers());

const NOW = "2026-06-17T07:00:00.000Z";
const list = (over: Partial<Parameters<typeof listViewingParams>[0]> = {}) => listViewingParams({ tab: "scheduled", assigned: "", page: "1", nowIso: NOW, ...over }, 20);

describe("the status tabs' parameters", () => {
  it("are identical for identical inputs, even when the clock moves between the calls (no clock inside)", () => {
    const first = list();
    vi.setSystemTime(new Date(2026, 5, 17, 10, 0, 7));
    const second = list();
    vi.advanceTimersByTime(60_000);
    const third = list();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(third)).toBe(JSON.stringify(first));
    expect(first.start_after).toBe(NOW);
  });

  it("only the scheduled tab asks for upcoming viewings, soonest first; the others are latest first without a start filter", () => {
    expect(list()).toEqual({ status: "scheduled", start_after: NOW, assigned_to: "", ordering: "start_at", page: "1", page_size: 20 });
    for (const tab of ["completed", "cancelled"] as const) {
      const params = list({ tab });
      expect(params).toEqual({ status: tab, assigned_to: "", ordering: "-start_at", page: "1", page_size: 20 });
      expect("start_after" in params).toBe(false);
    }
  });

  it("a genuine change of the filter, the page, the tab or the moment gives different parameters (so the list is requested again)", () => {
    const base = JSON.stringify(list());
    expect(JSON.stringify(list({ assigned: "3" }))).not.toBe(base);
    expect(JSON.stringify(list({ page: "2" }))).not.toBe(base);
    expect(JSON.stringify(list({ tab: "completed" }))).not.toBe(base);
    expect(JSON.stringify(list({ nowIso: "2026-06-17T07:05:00.000Z" }))).not.toBe(base);
  });

  it("the moment does not matter outside the scheduled tab (changing it must not refetch the completed list)", () => {
    expect(JSON.stringify(list({ tab: "completed", nowIso: "2030-01-01T00:00:00.000Z" }))).toBe(JSON.stringify(list({ tab: "completed" })));
  });
});

describe("the week tab's parameters", () => {
  const anchor = new Date(2026, 5, 17, 15, 30, 12); // Wednesday 17 June 2026
  const week = (firstDay: 0 | 1 | 6, assigned = "") => weekViewingParams({ anchor, firstDay, assigned }, 200);

  it("are the same all day long (day-granular, so a moving clock never changes the key)", () => {
    const first = JSON.stringify(week(1));
    vi.setSystemTime(new Date(2026, 5, 17, 23, 59, 59));
    expect(JSON.stringify(weekViewingParams({ anchor: new Date(), firstDay: 1, assigned: "" }, 200))).toBe(first);
  });

  it("cover the whole week from the company's first day, to the end of the last day", () => {
    const monday = weekRange({ anchor, firstDay: 1 });
    expect(monday.weekStart.getDay()).toBe(1);
    expect(monday.weekStart.getDate()).toBe(15);
    expect(monday.weekEnd.getDate()).toBe(21);
    const saturday = weekRange({ anchor, firstDay: 6 });
    expect(saturday.weekStart.getDay()).toBe(6);
    expect(saturday.weekStart.getDate()).toBe(13);
    expect(new Date(week(1).start_before).getTime() - new Date(week(1).start_after).getTime()).toBe(7 * 86400000);
  });

  it("a different first day or filter gives different parameters; the page size and ordering are as before", () => {
    expect(JSON.stringify(week(6))).not.toBe(JSON.stringify(week(1)));
    expect(JSON.stringify(week(1, "3"))).not.toBe(JSON.stringify(week(1)));
    expect(week(1)).toMatchObject({ ordering: "start_at", page_size: 200, assigned_to: "" });
  });
});

describe("the page", () => {
  const page = readFileSync(path.resolve(__dirname, "../app/(app)/viewings/page.tsx"), "utf8");

  it("never reads the clock while building query parameters; it reads it once per view change in a memo", () => {
    expect(page).not.toMatch(/start_after\s*:\s*new Date/);
    expect(page).toMatch(/useMemo\(\(\) => new Date\(\)\.toISOString\(\), \[tab, f\.assigned, f\.page\]\)/);
    expect(page).toMatch(/listViewingParams\(\{ tab, assigned: f\.assigned, page: f\.page, nowIso \}, PAGE_SIZE\)/);
  });
});
