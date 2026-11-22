import { addDays, endOfWeek, startOfDay, startOfWeek } from "date-fns";

// The API parameters of the two viewings queries, as pure functions of their inputs (no clock inside). The page used to read the clock while building the
// "scheduled" parameters, so the query key changed on EVERY render and the list was requested again and again. The page now reads the clock once per genuine
// view change and passes it in as `now`; the same inputs always give the same parameters (src/lib/viewings-query.test.ts).
export type ViewingTab = "week" | "scheduled" | "completed" | "cancelled";

export interface WeekParamsInput {
  /** Any instant inside the week to show. */
  anchor: Date;
  /** The first day of the week, 0 = Sunday (the company's week settings). */
  firstDay: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  assigned: string;
}

export function weekRange({ anchor, firstDay }: Pick<WeekParamsInput, "anchor" | "firstDay">) {
  const weekStart = startOfWeek(anchor, { weekStartsOn: firstDay });
  const weekEnd = endOfWeek(anchor, { weekStartsOn: firstDay });
  return { weekStart, weekEnd };
}

/** The "week" tab: every viewing from the start of the week to the end of its last day. */
export function weekViewingParams({ anchor, firstDay, assigned }: WeekParamsInput, pageSize: number) {
  const { weekStart, weekEnd } = weekRange({ anchor, firstDay });
  return {
    start_after: weekStart.toISOString(),
    start_before: addDays(startOfDay(weekEnd), 1).toISOString(),
    assigned_to: assigned,
    ordering: "start_at",
    page_size: pageSize,
  };
}

export interface ListParamsInput {
  tab: ViewingTab;
  assigned: string;
  page: string;
  /** The instant "upcoming" is measured from (ISO). Only the "scheduled" tab uses it. */
  nowIso: string;
}

/** The status tabs: scheduled (upcoming, soonest first), completed and cancelled (latest first). */
export function listViewingParams({ tab, assigned, page, nowIso }: ListParamsInput, pageSize: number) {
  return {
    status: tab === "week" ? "" : tab,
    ...(tab === "scheduled" ? { start_after: nowIso } : {}),
    assigned_to: assigned,
    ordering: tab === "scheduled" ? "start_at" : "-start_at",
    page,
    page_size: pageSize,
  };
}
