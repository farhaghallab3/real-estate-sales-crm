"use client";

import { Bath, BedDouble, Building2, LayoutGrid, Maximize2, Plus, Rows3 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PropertyFormModal } from "@/components/forms/property-form";
import { UserSelect } from "@/components/forms/pickers";
import { PropertyStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  PersonChip,
  Pills,
  SearchInput,
  Table,
  TableSkeleton,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";

import { useMoney, useFormat } from "@/lib/company";
import { mediaUrl } from "@/lib/api";
import { useCities, useProperties } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import type { Property } from "@/types";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useApiErrors } from "@/lib/use-api-errors";

const DEFAULTS = {
  q: "",
  status: "",
  type: "",
  city: "",
  beds: "",
  min: "",
  max: "",
  assigned: "",
  sort: "-created_at",
  view: "table",
  page: "1",
};

export default function PropertiesPage() {
  const enums = useEnums();
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const { money } = useMoney();
  const { formatDate } = useFormat();
  const { isManager } = useAuth();
  const [f, setF] = useUrlState(DEFAULTS);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const cities = useCities();
  const pageSize = f.view === "grid" ? 24 : 20;

  const list = useProperties({
    search: f.q,
    status: f.status,
    property_type: f.type,
    city: f.city,
    bedrooms_min: f.beds,
    price_min: f.min,
    price_max: f.max,
    assigned_to: f.assigned,
    ordering: f.sort,
    page: f.page,
    page_size: pageSize,
  });

  const onSort = (key: string) => setF({ sort: f.sort === key ? `-${key}` : key });
  const anyFilter = Boolean(f.q || f.status || f.type || f.city || f.beds || f.min || f.max || f.assigned);
  const clear = () => setF({ q: "", status: "", type: "", city: "", beds: "", min: "", max: "", assigned: "" });

  return (
    <div>
      <PageHeader
        title={t("properties.properties")}
        description={t("properties.internalInventoryWhatWeCan")}
        actions={
          <>
            <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
              {(
                [
                  ["table", Rows3, t("properties.tableView")],
                  ["grid", LayoutGrid, t("properties.gridView")],
                ] as const
              ).map(([v, Icon, label]) => (
                <button
                  key={v}
                  aria-label={label}
                  aria-pressed={f.view === v}
                  onClick={() => setF({ view: v }, false)}
                  className={`flex h-8 w-8 items-center justify-center rounded ${
                    f.view === v ? "bg-brand text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
              {t("common.addProperty")}</Button>
          </>
        }
      />

      <Card padded={false}>
        <div className="space-y-3 border-b border-line p-3">
          <Pills
            value={f.status}
            onChange={(v) => setF({ status: v })}
            options={[{ value: "", label: t("common.all") }, ...enums.options("propertyStatus")]}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <SearchInput value={f.q} onChange={(v) => setF({ q: v })} placeholder={t("properties.searchTitleAddressRef")} className="lg:col-span-2" />
            <Select value={f.city} onChange={(e) => setF({ city: e.target.value })} aria-label={t("common.location")}>
              <option value="">{t("common.allLocations")}</option>
              {cities.data?.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select value={f.type} onChange={(e) => setF({ type: e.target.value })} aria-label={t("common.type")}>
              <option value="">{t("common.allTypes")}</option>
              {enums.options("propertyType").map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select value={f.beds} onChange={(e) => setF({ beds: e.target.value })} aria-label={t("properties.bedrooms")}>
              <option value="">{t("properties.anyBeds")}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {t("properties.nBeds", { n })}</option>
              ))}
            </Select>
            {isManager ? (
              <UserSelect
                value={f.assigned ? Number(f.assigned) : null}
                onChange={(id) => setF({ assigned: id ? String(id) : "" })}
                emptyLabel={t("common.allSalespeople")}
                aria-label={t("common.salesperson")}
              />
            ) : (
              <span />
            )}
            <Input
              type="number"
              placeholder={t("properties.minPrice")}
              defaultValue={f.min}
              key={`min-${f.min}`}
              onBlur={(e) => e.target.value !== f.min && setF({ min: e.target.value })}
              aria-label={t("properties.minimumPrice")}
            />
            <Input
              type="number"
              placeholder={t("properties.maxPrice")}
              defaultValue={f.max}
              key={`max-${f.max}`}
              onBlur={(e) => e.target.value !== f.max && setF({ max: e.target.value })}
              aria-label={t("properties.maximumPrice")}
            />
            {anyFilter && (
              <Button variant="ghost" onClick={clear}>
                {t("common.clearFilters")}</Button>
            )}
          </div>
        </div>

        {list.isLoading ? (
          <TableSkeleton cols={7} />
        ) : list.error ? (
          <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
        ) : list.data!.results.length === 0 ? (
          <EmptyState
            title={anyFilter ? t("properties.noPropertiesMatchTheseFilters") : t("properties.noPropertiesYet")}
            action={
              anyFilter ? (
                <Button onClick={clear}>{t("common.clearFilters")}</Button>
              ) : (
                <Button variant="primary" onClick={() => setAddOpen(true)}>
                  {t("common.addProperty")}</Button>
              )
            }
          />
        ) : f.view === "grid" ? (
          <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {list.data!.results.map((p) => (
              <Link
                key={p.id}
                href={`/properties/${p.id}`}
                className="group overflow-hidden rounded-lg border border-line bg-surface transition-shadow hover:shadow-pop"
              >
                <div className="relative flex h-24 items-center justify-center bg-brand-50 text-brand/40">
                  {p.cover_image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaUrl(p.cover_image)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Building2 className="h-8 w-8" />
                  )}
                  <span className="absolute start-2 top-2">
                    <PropertyStatusBadge status={p.status} />
                  </span>
                </div>
                <div className="space-y-1 p-3">
                  <p className="truncate text-sm font-medium group-hover:text-brand">{p.title}</p>
                  <p className="truncate text-xs text-muted">
                    {p.address}, {p.city}
                  </p>
                  <p className="tabular text-base font-semibold">{money(p.price)}</p>
                  <div className="flex items-center gap-3 text-xs text-muted">
                    <span className="inline-flex items-center gap-1"><BedDouble className="h-3.5 w-3.5" />{p.bedrooms}</span>
                    <span className="inline-flex items-center gap-1"><Bath className="h-3.5 w-3.5" />{p.bathrooms}</span>
                    <span className="inline-flex items-center gap-1"><Maximize2 className="h-3.5 w-3.5" />{p.area_sqm ? t("properties.valueM", { value: Number(p.area_sqm) }) : "—"}</span>
                  </div>
                  <p className="truncate text-xs text-muted">{p.assigned_to?.full_name ?? t("common.unassigned")}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th sortKey="title" sort={f.sort} onSort={onSort}>{t("common.property")}</Th>
                  <Th>{t("properties.address")}</Th>
                  <Th sortKey="city" sort={f.sort} onSort={onSort}>{t("common.location")}</Th>
                  <Th>{t("common.type")}</Th>
                  <Th sortKey="price" sort={f.sort} onSort={onSort} className="text-end">{t("properties.price")}</Th>
                  <Th sortKey="bedrooms" sort={f.sort} onSort={onSort} className="text-end">{t("properties.beds")}</Th>
                  <Th className="text-end">{t("properties.baths")}</Th>
                  <Th sortKey="area_sqm" sort={f.sort} onSort={onSort} className="text-end">{t("properties.area")}</Th>
                  <Th sortKey="status" sort={f.sort} onSort={onSort}>{t("common.status")}</Th>
                  <Th>{t("common.salesperson")}</Th>
                  <Th>{t("properties.images")}</Th>
                  <Th sortKey="created_at" sort={f.sort} onSort={onSort}>{t("common.created")}</Th>
                </tr>
              </thead>
              <tbody>
                {list.data!.results.map((p) => (
                  <tr key={p.id} className="hover:bg-canvas/70">
                    <Td>
                      <Link href={`/properties/${p.id}`} className="font-medium hover:text-brand hover:underline">
                        {p.title}
                      </Link>
                      <div className="text-2xs text-muted">{p.reference}</div>
                    </Td>
                    <Td className="max-w-[220px] truncate text-muted">{p.address}</Td>
                    <Td className="whitespace-nowrap">{p.city}</Td>
                    <Td className="whitespace-nowrap text-muted">{enums.label("propertyType", p.property_type)}</Td>
                    <Td className="tabular whitespace-nowrap text-end font-medium">{money(p.price)}</Td>
                    <Td className="tabular text-end">{p.bedrooms || "—"}</Td>
                    <Td className="tabular text-end">{p.bathrooms || "—"}</Td>
                    <Td className="tabular whitespace-nowrap text-end">{p.area_sqm ? t("properties.valueM", { value: Number(p.area_sqm) }) : "—"}</Td>
                    <Td>
                      <PropertyStatusBadge status={p.status} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <PersonChip name={p.assigned_to?.full_name} />
                    </Td>
                    <Td className="tabular text-muted">{p.image_count}</Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(p.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
        {list.data && list.data.count > 0 && (
          <Pagination page={Number(f.page)} pageSize={pageSize} count={list.data.count} onPage={(p) => setF({ page: String(p) }, false)} />
        )}
      </Card>

      <PropertyFormModal
        open={addOpen || Boolean(editing)}
        property={editing}
        onClose={() => {
          setAddOpen(false);
          setEditing(null);
        }}
      />
    </div>
  );
}
