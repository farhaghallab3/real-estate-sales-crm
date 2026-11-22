"use client";

import { useState } from "react";

import { PropertyPicker, UserSelect } from "@/components/forms/pickers";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import {
  Card,
  EmptyState,
  ErrorState,
  Metric,
  PageHeader,
  PersonChip,
  Skeleton,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";

import { pct } from "@/lib/format";
import { useMoney } from "@/lib/company";
import { useAnalytics, useCities } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import type { LeadStatus } from "@/types";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useApiErrors } from "@/lib/use-api-errors";

const FUNNEL: LeadStatus[] = ["new", "contacted", "qualified", "viewing", "offer_made", "closed"];

export default function ReportsPage() {
  const enums = useEnums();
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const { money, moneyCompact } = useMoney();
  const [f, setF] = useUrlState({
    from: "",
    to: "",
    sp: "",
    prop: "",
    source: "",
    location: "",
    deal_status: "",
  });
  const [propLabel, setPropLabel] = useState<string | null>(null);
  const cities = useCities();
  const q = useAnalytics({
    date_from: f.from,
    date_to: f.to,
    salesperson: f.sp,
    property: f.prop,
    source: f.source,
    location: f.location,
    deal_status: f.deal_status,
  });
  const d = q.data;
  const anyFilter = Object.values(f).some(Boolean);
  const maxFunnel = Math.max(1, ...FUNNEL.map((s) => d?.funnel[s] ?? 0));
  const maxMonthly = Math.max(1, ...(d?.monthly.map((m) => Number(m.sales_value)) ?? [1]));
  const maxLeads = Math.max(1, ...(d?.monthly.map((m) => m.leads) ?? [1]));

  return (
    <div className="space-y-4">
      <PageHeader title={t("reports.reports")} description={t("reports.salesPerformanceAcrossFunnelMetrics")} />

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Field label={t("reports.from")}>
            <Input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} />
          </Field>
          <Field label={t("reports.to")}>
            <Input type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} />
          </Field>
          <Field label={t("common.salesperson")}>
            <UserSelect
              value={f.sp ? Number(f.sp) : null}
              onChange={(id) => setF({ sp: id ? String(id) : "" })}
              emptyLabel={t("reports.everyone")}
            />
          </Field>
          <Field label={t("common.leadSource")}>
            <Select value={f.source} onChange={(e) => setF({ source: e.target.value })}>
              <option value="">{t("common.allSources")}</option>
              {enums.options("leadSource").map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("common.location")}>
            <Select value={f.location} onChange={(e) => setF({ location: e.target.value })}>
              <option value="">{t("common.allLocations")}</option>
              {cities.data?.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("reports.dealStatus")}>
            <Select value={f.deal_status} onChange={(e) => setF({ deal_status: e.target.value })}>
              <option value="">{t("reports.any")}</option>
              <option value="open">{t("reports.open")}</option>
              {enums.options("dealStage").map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("common.property")}>
            <PropertyPicker
              label={propLabel}
              placeholder={t("reports.anyProperty")}
              onChange={(p) => {
                setPropLabel(p?.title ?? null);
                setF({ prop: p ? String(p.id) : "" });
              }}
            />
          </Field>
        </div>
        {anyFilter && (
          <div className="mt-3">
            <Button
              size="sm"
              onClick={() => {
                setPropLabel(null);
                setF({ from: "", to: "", sp: "", prop: "", source: "", location: "", deal_status: "" });
              }}
            >
              {t("reports.resetFilters")}</Button>
          </div>
        )}
      </Card>

      {q.error ? (
        <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            {!d
              ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[74px]" />)
              : (
                <>
                  <Metric label={t("common.leads")} value={d.metrics.total_leads} />
                  <Metric label={t("reports.qualified")} value={d.metrics.qualified_leads} />
                  <Metric label={t("common.viewings")} value={d.metrics.viewings} />
                  <Metric label={t("common.offers")} value={d.metrics.offers} />
                  <Metric label={t("common.closedDeals")} value={d.metrics.closed_deals} />
                  <Metric label={t("common.salesValue")} value={moneyCompact(d.metrics.sales_value)} accent />
                  <Metric label={t("common.commissions")} value={moneyCompact(d.metrics.commission)} accent />
                  <Metric label={t("reports.conversion")} value={pct(d.metrics.conversion_rate)} />
                </>
              )}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title={t("reports.leadFunnel")} padded>
              {!d ? (
                <Skeleton className="h-44" />
              ) : (
                <ul className="space-y-2.5">
                  {FUNNEL.map((s) => {
                    const n = d.funnel[s] ?? 0;
                    return (
                      <li key={s} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm">
                        <span className="text-muted">{enums.label("leadStatus", s)}</span>
                        <div className="h-5 overflow-hidden rounded bg-canvas">
                          <div className="h-full rounded bg-brand" style={{ width: `${(n / maxFunnel) * 100}%`, minWidth: n ? 4 : 0 }} />
                        </div>
                        <span className="tabular text-end font-medium">{n}</span>
                      </li>
                    );
                  })}
                  <li className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm">
                    <span className="text-muted">{t("reports.lost")}</span>
                    <div className="h-5 overflow-hidden rounded bg-canvas">
                      <div className="h-full rounded bg-bad-fg/60" style={{ width: `${((d.funnel.lost ?? 0) / maxFunnel) * 100}%` }} />
                    </div>
                    <span className="tabular text-end font-medium">{d.funnel.lost ?? 0}</span>
                  </li>
                </ul>
              )}
            </Card>

            <Card title={t("reports.monthlyLeadsSalesValue")}>
              {!d ? (
                <Skeleton className="h-44" />
              ) : d.monthly.length === 0 ? (
                <EmptyState title={t("reports.noDataPeriod")} />
              ) : (
                <div>
                  <div className="flex h-40 items-end gap-3">
                    {d.monthly.map((m) => (
                      <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
                        <div className="flex flex-1 items-end justify-center gap-1">
                          <div
                            className="w-3 rounded-t bg-brand/30"
                            style={{ height: `${(m.leads / maxLeads) * 100}%` }}
                            title={`${m.leads} leads`}
                          />
                          <div
                            className="w-3 rounded-t bg-accent"
                            style={{ height: `${(Number(m.sales_value) / maxMonthly) * 100}%` }}
                            title={`${money(m.sales_value)} sales`}
                          />
                        </div>
                        <span className="truncate text-center text-2xs text-muted">{m.month.slice(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-4 text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-brand/30" /> {" "}{t("common.leads")}</span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> {" "}{t("common.salesValue")}</span>
                  </div>
                </div>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card title={t("reports.leadsBySource")} padded={false} className="xl:col-span-1">
              {!d ? (
                <div className="p-4">
                  <Skeleton className="h-40" />
                </div>
              ) : (
                <TableWrap>
                  <Table>
                    <thead>
                      <tr>
                        <Th>{t("common.source")}</Th>
                        <Th className="text-end">{t("common.leads")}</Th>
                        <Th className="text-end">{t("common.closed")}</Th>
                        <Th className="text-end">{t("reports.conv")}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.sources
                        .filter((s) => s.leads > 0)
                        .sort((a, b) => b.leads - a.leads)
                        .map((s) => (
                          <tr key={s.source}>
                            <Td>{s.label}</Td>
                            <Td className="tabular text-end">{s.leads}</Td>
                            <Td className="tabular text-end">{s.closed}</Td>
                            <Td className="tabular text-end text-muted">{s.leads ? pct((s.closed / s.leads) * 100) : "—"}</Td>
                          </tr>
                        ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </Card>

            <Card title={t("reports.salespersonPerformance")} padded={false} className="xl:col-span-2">
              {!d ? (
                <div className="p-4">
                  <Skeleton className="h-40" />
                </div>
              ) : d.team.length === 0 ? (
                <EmptyState title={t("reports.noData")} />
              ) : (
                <TableWrap>
                  <Table>
                    <thead>
                      <tr>
                        <Th>{t("common.salesperson")}</Th>
                        <Th className="text-end">{t("common.leads")}</Th>
                        <Th className="text-end">{t("common.viewings")}</Th>
                        <Th className="text-end">{t("common.offers")}</Th>
                        <Th className="text-end">{t("common.closed")}</Th>
                        <Th className="text-end">{t("common.salesValue")}</Th>
                        <Th className="text-end">{t("common.commission")}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.team.map((r) => (
                        <tr key={r.user_id}>
                          <Td>
                            <PersonChip name={r.name} />
                          </Td>
                          <Td className="tabular text-end">{r.leads}</Td>
                          <Td className="tabular text-end">{r.viewings}</Td>
                          <Td className="tabular text-end">{r.offers}</Td>
                          <Td className="tabular text-end">{r.closed_deals}</Td>
                          <Td className="tabular text-end">{money(r.sales_value)}</Td>
                          <Td className="tabular text-end">{money(r.commission)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
