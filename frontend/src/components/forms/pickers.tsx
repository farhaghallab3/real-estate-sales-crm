"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useUsers } from "@/lib/queries";
import type { Lead, LeadMini, Paginated, Property, PropertyMini } from "@/types";

import { Input, Select } from "../ui/field";

function Combobox<T extends { id: number }>({
  queryKey,
  fetcher,
  render,
  onSelect,
  selectedLabel,
  placeholder,
  disabled,
  invalid,
}: {
  queryKey: string;
  fetcher: (q: string) => Promise<T[]>;
  render: (item: T) => { primary: string; secondary?: string };
  onSelect: (item: T | null) => void;
  selectedLabel: string | null;
  placeholder: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // The list is positioned with `fixed` so it is never clipped by a scrolling modal body.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const results = useQuery({
    queryKey: ["combo", queryKey, debounced],
    queryFn: () => fetcher(debounced),
    enabled: open,
  });

  return (
    <div ref={box} className="relative">
      {selectedLabel && !open ? (
        <div
          className={clsx(
            "flex h-9 items-center justify-between rounded-md border bg-surface px-3 text-sm",
            invalid ? "border-bad-fg" : "border-line",
          )}
        >
          <span className="truncate">{selectedLabel}</span>
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setOpen(true);
              }}
              className="ml-2 text-muted hover:text-ink"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <Input
            value={q}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            placeholder={placeholder}
            className={clsx(invalid && "border-bad-fg")}
          />
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        </div>
      )}
      {open && rect && (
        <ul
          role="listbox"
          style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width }}
          className="z-[70] max-h-60 overflow-auto rounded-md border border-line bg-surface py-1 shadow-pop"
        >
          {results.isLoading && <li className="px-3 py-2 text-xs text-muted">Searching…</li>}
          {results.data?.length === 0 && <li className="px-3 py-2 text-xs text-muted">No matches</li>}
          {results.data?.map((item) => {
            const r = render(item);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-brand-50"
                  onClick={() => {
                    onSelect(item);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span className="text-sm">{r.primary}</span>
                  {r.secondary && <span className="text-2xs text-muted">{r.secondary}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function LeadPicker({
  label,
  onChange,
  disabled,
  invalid,
  placeholder = "Search lead by name or phone…",
}: {
  label: string | null;
  onChange: (lead: (Lead | LeadMini) | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <Combobox<Lead>
      queryKey="lead"
      fetcher={async (q) => (await api<Paginated<Lead>>("/leads/", { params: { search: q, page_size: 8 } })).results}
      render={(l) => ({ primary: l.name, secondary: `${l.phone} · ${l.preferred_location || "No location"}` })}
      onSelect={onChange}
      selectedLabel={label}
      placeholder={placeholder}
      disabled={disabled}
      invalid={invalid}
    />
  );
}

export function PropertyPicker({
  label,
  onChange,
  disabled,
  invalid,
  placeholder = "Search property by title or address…",
}: {
  label: string | null;
  onChange: (property: (Property | PropertyMini) | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <Combobox<Property>
      queryKey="property"
      fetcher={async (q) =>
        (await api<Paginated<Property>>("/properties/", { params: { search: q, page_size: 8, status: "available,reserved,under_offer" } })).results
      }
      render={(p) => ({ primary: p.title, secondary: `${p.city} · ${money(p.price)} · ${p.reference}` })}
      onSelect={onChange}
      selectedLabel={label}
      placeholder={placeholder}
      disabled={disabled}
      invalid={invalid}
    />
  );
}

export function UserSelect({
  value,
  onChange,
  allowEmpty = true,
  emptyLabel = "Unassigned",
  className,
  ...rest
}: {
  value: number | "" | null | undefined;
  onChange: (id: number | null) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  const users = useUsers();
  const list = (users.data ?? []).filter((u) => (u as { is_active?: boolean }).is_active !== false);
  return (
    <Select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={className}
      {...rest}
    >
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {list.map((u) => (
        <option key={u.id} value={u.id}>
          {u.full_name}
        </option>
      ))}
    </Select>
  );
}
