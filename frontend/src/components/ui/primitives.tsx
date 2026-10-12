"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight, Inbox, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { initials } from "@/lib/format";

import { Button } from "./button";
import { Input } from "./field";

// ---- Card -----------------------------------------------------------------------------------------
export function Card({
  title,
  action,
  children,
  className,
  bodyClassName,
  padded = true,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
}) {
  return (
    <section className={clsx("rounded-lg border border-line bg-surface shadow-card", className)}>
      {(title || action) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={clsx(padded && "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

// ---- Page header ----------------------------------------------------------------------------------
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="truncate text-xl font-semibold">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---- Avatar ---------------------------------------------------------------------------------------
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function PersonChip({ name }: { name?: string | null }) {
  if (!name) return <span className="text-muted">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={name} size={20} />
      <span className="truncate">{name}</span>
    </span>
  );
}

// ---- Empty / loading ------------------------------------------------------------------------------
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
      <div className="mb-1 text-muted/60">{icon ?? <Inbox className="h-7 w-7" />}</div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded bg-line/70", className)} />;
}

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      title="Something went wrong"
      description={message}
      action={onRetry && <Button onClick={onRetry}>Try again</Button>}
    />
  );
}

// ---- Tabs -----------------------------------------------------------------------------------------
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={clsx("scrollbar-thin flex gap-0.5 overflow-x-auto border-b border-line", className)}
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={clsx(
            "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            t.value === value
              ? "border-brand text-brand"
              : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span
              className={clsx(
                "rounded-full px-1.5 text-2xs tabular",
                t.value === value ? "bg-brand-100 text-brand" : "bg-idle-bg text-muted",
              )}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Pill-style filter used for status quick filters. */
export function Pills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="scrollbar-thin flex gap-1.5 overflow-x-auto pb-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={clsx(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-muted hover:border-muted hover:text-ink",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={clsx("tabular", active ? "text-white/70" : "text-muted/80")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---- Pagination -----------------------------------------------------------------------------------
export function Pagination({
  page,
  pageSize,
  count,
  onPage,
}: {
  page: number;
  pageSize: number;
  count: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const from = count === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, count);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-muted">
      <span className="tabular">
        {from}–{to} of {count}
      </span>
      <div className="flex items-center gap-1.5">
        <span className="tabular">
          Page {page} / {pages}
        </span>
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---- Search input with debounce -------------------------------------------------------------------
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChange(local), 300);
    return () => clearTimeout(t);
  }, [local, value, onChange]);
  return (
    <div className={clsx("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <Input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
        aria-label={placeholder}
      />
    </div>
  );
}

// ---- Table ----------------------------------------------------------------------------------------
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="scrollbar-thin overflow-x-auto">{children}</div>;
}

export function Table({ children }: { children: React.ReactNode }) {
  return <table className="w-full min-w-max border-collapse text-left text-sm">{children}</table>;
}

export function Th({
  children,
  sortKey,
  sort,
  onSort,
  className,
}: {
  children?: React.ReactNode;
  sortKey?: string;
  sort?: string;
  onSort?: (key: string) => void;
  className?: string;
}) {
  const active = sortKey && (sort === sortKey || sort === `-${sortKey}`);
  const desc = sort === `-${sortKey}`;
  return (
    <th
      scope="col"
      className={clsx(
        "whitespace-nowrap border-b border-line bg-canvas/70 px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-muted",
        className,
      )}
    >
      {sortKey && onSort ? (
        <button
          onClick={() => onSort(sortKey)}
          className={clsx("inline-flex items-center gap-1 uppercase hover:text-ink", active && "text-ink")}
        >
          {children}
          <span aria-hidden className="text-[9px]">
            {active ? (desc ? "▼" : "▲") : "↕"}
          </span>
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={clsx("border-b border-line/70 px-3 py-2.5 align-middle", className)}>{children}</td>;
}

// ---- Metric tile ----------------------------------------------------------------------------------
export function Metric({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-lg border bg-surface px-3.5 py-3 shadow-card",
        accent ? "border-accent/40" : "border-line",
      )}
    >
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="tabular mt-1 text-xl font-semibold leading-none">{value}</div>
      {hint && <div className="mt-1.5 text-2xs text-muted">{hint}</div>}
    </div>
  );
}

export function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}
