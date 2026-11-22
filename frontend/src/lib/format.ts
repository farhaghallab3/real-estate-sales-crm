import {
  format,
  formatDistanceToNowStrict,
  isThisYear,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
} from "date-fns";

import { formattingLocale } from "./format-locale";

// ONE place for every number, amount, date, time and relative time the interface shows (Phase 5, ADR-0001 2.4). Presentation only: the values, the stored
// precision and every API payload are untouched (toLocalInput/fromLocalInput keep their formats).
//  * The formatting locale follows the user's INTERFACE language; its region comes from the company locale; Latin digits and the Gregorian calendar always.
//  * The currency stays the company's one base currency; there is no conversion.
//  * English keeps its exact previous date and time output (date-fns patterns, "Today, 2:30 PM", "5 days ago"); every other language goes through Intl.
// There is NO module-level state: the formatters are built from an explicit config, so one render can never see another's settings. Components get them
// through useFormat() (lib/company.tsx).
export interface FormatConfig {
  /** The interface language (`useLocale()`). */
  language: string;
  /** The company locale (its region is used). */
  companyLocale: string;
  currency_code: string;
  /** Show the currency as its symbol (default) or its ISO code. */
  currencyDisplay?: "symbol" | "code";
}

/** The catalogue messages the date formatters need. */
export type FormatMessageKey = "ui.whenToday" | "ui.whenTomorrow" | "ui.whenYesterday" | "ui.dateTime" | "ui.relativeAgo" | "ui.relativeFromNow";
export type Translate = (key: FormatMessageKey, values: Record<string, string | number>) => string;

type Num = string | number | null | undefined;
type Iso = string | null | undefined;

const num = (v: Num): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface Formatters {
  money: (v: Num) => string;
  money2: (v: Num) => string;
  moneyCompact: (v: Num) => string;
  /** A plain number with the locale's grouping (Latin digits). */
  number: (v: Num) => string;
  formatDate: (iso: Iso) => string;
  formatTime: (iso: Iso) => string;
  formatDateTime: (iso: Iso) => string;
  /** "Today, 2:30 PM" / "Tomorrow, ..." / "Yesterday, ..." / "Mar 4, 10:00 AM" */
  formatWhen: (iso: Iso) => string;
  relative: (iso: Iso) => string;
  /** "Mar 4" and "Mar 4, 2026" for a Date the page already holds (the week header). */
  dayMonth: (d: Date) => string;
  dayMonthYear: (d: Date) => string;
  /** The short weekday name ("Mon"). */
  weekday: (d: Date) => string;
}

export function parse(iso: Iso): Date | null {
  if (!iso) return null;
  try {
    return parseISO(iso);
  } catch {
    return null;
  }
}

const RELATIVE_UNITS = ["second", "minute", "hour", "day", "month", "year"];

export function makeFormatters(cfg: FormatConfig, t: Translate): Formatters {
  const locale = formattingLocale(cfg.language, cfg.companyLocale);
  const tag = locale.toString();
  const english = locale.language === "en";

  const currencyBase = { style: "currency" as const, currency: cfg.currency_code, currencyDisplay: cfg.currencyDisplay === "code" ? ("code" as const) : ("symbol" as const) };
  const money$ = (extra: Intl.NumberFormatOptions) => {
    try {
      return new Intl.NumberFormat(tag, { ...currencyBase, ...extra });
    } catch {
      return new Intl.NumberFormat("en-US", { ...currencyBase, currency: "USD", ...extra }); // unknown locale or currency: never crash
    }
  };
  const wrap = (nf: Intl.NumberFormat) => (v: Num) => {
    const n = num(v);
    return n === null ? "—" : nf.format(n);
  };
  const plain = (() => {
    try {
      return new Intl.NumberFormat(tag);
    } catch {
      return new Intl.NumberFormat("en-US");
    }
  })();

  const dateFormat = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(tag, options);
    } catch {
      return new Intl.DateTimeFormat("en-US", options);
    }
  };
  const dayMonthF = dateFormat({ month: "short", day: "numeric" });
  const dayMonthYearF = dateFormat({ month: "short", day: "numeric", year: "numeric" });
  const timeF = dateFormat({ hour: "numeric", minute: "2-digit", hour12: true });
  const weekdayF = dateFormat({ weekday: "short" });

  const dayMonth = (d: Date) => (english ? format(d, "MMM d") : dayMonthF.format(d));
  const dayMonthYear = (d: Date) => (english ? format(d, "MMM d, yyyy") : dayMonthYearF.format(d));
  const weekday = (d: Date) => (english ? format(d, "EEE") : weekdayF.format(d));
  const clock = (d: Date) => (english ? format(d, "h:mm a") : timeF.format(d));

  const formatDate = (iso: Iso) => {
    const d = parse(iso);
    if (!d) return "—";
    return isThisYear(d) ? dayMonth(d) : dayMonthYear(d);
  };
  const formatTime = (iso: Iso) => {
    const d = parse(iso);
    return d ? clock(d) : "—";
  };
  const formatDateTime = (iso: Iso) => {
    const d = parse(iso);
    if (!d) return "—";
    return t("ui.dateTime", { date: formatDate(iso), time: clock(d) });
  };
  const formatWhen = (iso: Iso) => {
    const d = parse(iso);
    if (!d) return "—";
    if (isToday(d)) return t("ui.whenToday", { time: clock(d) });
    if (isTomorrow(d)) return t("ui.whenTomorrow", { time: clock(d) });
    if (isYesterday(d)) return t("ui.whenYesterday", { time: clock(d) });
    return formatDateTime(iso);
  };
  const relative = (iso: Iso) => {
    const d = parse(iso);
    if (!d) return "—";
    const future = d.getTime() > Date.now();
    const distance = formatDistanceToNowStrict(d); // "5 days": the count and the unit are the same in every language
    if (!english) {
      // Intl.RelativeTimeFormat gives the right grammar for the language ("قبل يومين", "بعد 3 ساعات"); the catalogue wording is the fallback
      const match = /^(\d+) (\w+?)s?$/.exec(distance);
      if (match && RELATIVE_UNITS.includes(match[2])) {
        try {
          return new Intl.RelativeTimeFormat(tag, { numeric: "always" }).format((future ? 1 : -1) * Number(match[1]), match[2] as Intl.RelativeTimeFormatUnit);
        } catch {
          // fall through to the catalogue wording
        }
      }
    }
    return t(future ? "ui.relativeFromNow" : "ui.relativeAgo", { distance });
  };

  return {
    money: wrap(money$({ maximumFractionDigits: 0 })),
    money2: wrap(money$({ minimumFractionDigits: 2 })),
    moneyCompact: wrap(money$({ notation: "compact", maximumFractionDigits: 1 })),
    number: wrap(plain),
    formatDate,
    formatTime,
    formatDateTime,
    formatWhen,
    relative,
    dayMonth,
    dayMonthYear,
    weekday,
  };
}

export function toLocalInput(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const pct = (v: number) => `${v.toFixed(1)}%`;
