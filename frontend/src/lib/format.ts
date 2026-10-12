import {
  format,
  formatDistanceToNowStrict,
  isThisYear,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
} from "date-fns";

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

type Num = string | number | null | undefined;

const num = (v: Num): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function money(v: Num): string {
  const n = num(v);
  return n === null ? "—" : usd0.format(n);
}

export function money2(v: Num): string {
  const n = num(v);
  return n === null ? "—" : usd2.format(n);
}

export function moneyCompact(v: Num): string {
  const n = num(v);
  return n === null ? "—" : compact.format(n);
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
