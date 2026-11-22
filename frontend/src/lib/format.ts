import {
  format,
  formatDistanceToNowStrict,
  isThisYear,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
} from "date-fns";

// The base currency and number locale come from the company settings (see lib/company.tsx). One base currency, no
// conversion: stored amounts are shown in that currency as they are. Latin digits are forced so the English UI stays
// consistent whatever the locale; defaults reproduce the previous USD / en-US output exactly.
// There is NO module-level state here: the formatters are built from an explicit config, so one request or render can
// never see another's settings. Components get them through useMoney() (lib/company.tsx).
export interface MoneyConfig {
  locale: string;
  currency_code: string;
}

type Num = string | number | null | undefined;

const num = (v: Num): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface MoneyFormatters {
  money: (v: Num) => string;
  money2: (v: Num) => string;
  moneyCompact: (v: Num) => string;
}

export function makeMoneyFormatters(cfg: MoneyConfig): MoneyFormatters {
  const base = { style: "currency" as const, currency: cfg.currency_code, numberingSystem: "latn" };
  const make = (extra: Intl.NumberFormatOptions) => {
    try {
      return new Intl.NumberFormat(cfg.locale, { ...base, ...extra });
    } catch {
      return new Intl.NumberFormat("en-US", { ...base, currency: "USD", ...extra }); // unknown locale/currency: never crash
    }
  };
  const whole = make({ maximumFractionDigits: 0 });
  const cents = make({ minimumFractionDigits: 2 });
  const compact = make({ notation: "compact", maximumFractionDigits: 1 });
  const wrap = (nf: Intl.NumberFormat) => (v: Num) => {
    const n = num(v);
    return n === null ? "—" : nf.format(n);
  };
  return { money: wrap(whole), money2: wrap(cents), moneyCompact: wrap(compact) };
}

export function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  try {
    return parseISO(iso);
  } catch {
    return null;
  }
}

export function formatDate(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  return format(d, isThisYear(d) ? "MMM d" : "MMM d, yyyy");
}

export function formatTime(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? format(d, "h:mm a") : "—";
}

export function formatDateTime(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

/** "Today, 2:30 PM" / "Tomorrow, 9:00 AM" / "Mar 4, 10:00 AM" */
export function formatWhen(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  if (isToday(d)) return `Today, ${formatTime(iso)}`;
  if (isTomorrow(d)) return `Tomorrow, ${formatTime(iso)}`;
  if (isYesterday(d)) return `Yesterday, ${formatTime(iso)}`;
  return formatDateTime(iso);
}

export function relative(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  return `${formatDistanceToNowStrict(d)} ${d.getTime() > Date.now() ? "from now" : "ago"}`;
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
