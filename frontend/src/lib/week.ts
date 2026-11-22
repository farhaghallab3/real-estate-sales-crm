import { formattingLocale } from "./format-locale";

// Week start and weekend (plan row 5, ADR-0001): defaults from the company's REGION. 0 = Sunday ... 6 = Saturday, the numbering of date-fns and Date#getDay.
// The regions of the target currencies (EG, SA, AE, QA, KW, BH, OM) follow the CLDR week data that the runtime's Intl carries (EG, QA, KW, BH, OM: week
// starts on Saturday; SA: Sunday; AE: Monday; weekend Friday-Saturday except AE, Saturday-Sunday). Every other region keeps Monday and Saturday-Sunday, the
// behaviour before Phase 5. There is no company field for an override yet (it needs a backend setting): the table is the default only.
export interface WeekSettings {
  /** The first day of the week, 0 = Sunday. */
  firstDay: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** The weekend days, 0 = Sunday. */
  weekend: number[];
}

export const DEFAULT_WEEK: WeekSettings = { firstDay: 1, weekend: [6, 0] };
const TARGET_REGIONS = ["EG", "SA", "AE", "QA", "KW", "BH", "OM"];

const to0 = (day: number) => day % 7; // Intl: 1 = Monday ... 7 = Sunday

type WeekInfo = { firstDay: number; weekend: number[] };

export function weekSettingsFor(companyLocale: string | null | undefined): WeekSettings {
  const region = formattingLocale("en", companyLocale).region;
  if (!region || !TARGET_REGIONS.includes(region)) return DEFAULT_WEEK;
  try {
    const locale = new Intl.Locale(`en-${region}`) as Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo };
    const info = typeof locale.getWeekInfo === "function" ? locale.getWeekInfo() : locale.weekInfo;
    if (!info) return DEFAULT_WEEK;
    return { firstDay: to0(info.firstDay) as WeekSettings["firstDay"], weekend: info.weekend.map(to0) };
  } catch {
    return DEFAULT_WEEK; // never an error: the old behaviour
  }
}
