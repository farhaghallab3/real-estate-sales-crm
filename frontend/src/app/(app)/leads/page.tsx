"use client";

import { Plus, UserCog, ArrowRightLeft, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ChangeStatusModal, AssignModal } from "@/components/forms/lead-actions";
import { LeadFormModal } from "@/components/forms/lead-form";
import { UserSelect } from "@/components/forms/pickers";
import { Button } from "@/components/ui/button";
import { LeadStatusBadge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PersonChip,
  Pagination,
  Pills,
  SearchInput,
  Table,
  TableSkeleton,
  TableWrap,
  Td,
  Th,
  Ltr,} from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";

import { useMoney, useFormat } from "@/lib/company";
import { useLeads, useLeadStatusCounts } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import type { Lead } from "@/types";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useApiErrors } from "@/lib/use-api-errors";

const PAGE_SIZE = 20;
const DEFAULTS = {
  q: "",
  status: "",
  source: "",
  assigned: "",
  location: "",
  sort: "-created_at",
  page: "1",
};

export default function LeadsPage() {
  const enums = useEnums();
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const { money } = useMoney();
  const { formatDate, formatWhen, relative } = useFormat();
  const { isManager } = useAuth();
  const [f, setF] = useUrlState(DEFAULTS);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [statusFor, setStatusFor] = useState<Lead | null>(null);
  const [assignFor, setAssignFor] = useState<Lead | null>(null);

  const base = { search: f.q, source: f.source, assigned_to: f.assigned, location: f.location };
  const leads = useLeads({ ...base, status: f.status, ordering: f.sort, page: f.page, page_size: PAGE_SIZE });
  const counts = useLeadStatusCounts(base);

  const onSort = (key: string) => setF({ sort: f.sort === key ? `-${key}` : key });
  const anyFilter = Boolean(f.q || f.status || f.source || f.assigned || f.location);

  const pillOptions = [
    { value: "", label: t("common.all"), count: counts.data?.all },
    ...enums.options("leadStatus").map((o) => ({ ...o, count: counts.data?.[o.value] })),
  ];

  return (
    <div>
      <PageHeader
        title={t("leads.leadsClients")}
        description={isManager ? t("leads.allLeadsAcrossTeam") : t("leads.leadsAssigned")}
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
            {t("common.addLead")}</Button>
        }
      />

      <Card padded={false}>
        <div className="space-y-3 border-b border-line p-3">
          <Pills options={pillOptions} value={f.status} onChange={(v) => setF({ status: v })} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <SearchInput
              value={f.q}
              onChange={(v) => setF({ q: v })}
              placeholder={t("leads.searchNamePhoneEmail")}
              className="lg:col-span-2"
            />
            <Select value={f.source} onChange={(e) => setF({ source: e.target.value })} aria-label={t("common.source")}>
              <option value="">{t("common.allSources")}</option>
              {enums.options("leadSource").map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
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
              placeholder={t("common.location")}
              defaultValue={f.location}
              onBlur={(e) => e.target.value !== f.location && setF({ location: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && setF({ location: e.currentTarget.value })}
              aria-label={t("common.location")}
            />
          </div>
        </div>

        {leads.isLoading ? (
          <TableSkeleton cols={8} />
        ) : leads.error ? (
          <ErrorState message={errorText(leads.error)} onRetry={() => void leads.refetch()} />
        ) : leads.data!.results.length === 0 ? (
          <EmptyState
            title={anyFilter ? t("leads.noLeadsMatchTheseFilters") : t("common.noLeadsYet")}
            description={anyFilter ? t("leads.tryClearingFilter") : t("leads.addFirstLeadStartWorkflow")}
            action={
              anyFilter ? (
                <Button onClick={() => setF({ q: "", status: "", source: "", assigned: "", location: "" })}>{t("common.clearFilters")}</Button>
              ) : (
                <Button variant="primary" onClick={() => setAddOpen(true)}>
                  {t("common.addLead")}</Button>
              )
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th sortKey="first_name" sort={f.sort} onSort={onSort}>{t("common.client")}</Th>
                  <Th>{t("common.phone")}</Th>
                  <Th>{t("common.email")}</Th>
                  <Th sortKey="source" sort={f.sort} onSort={onSort}>{t("common.source")}</Th>
                  <Th sortKey="budget" sort={f.sort} onSort={onSort} className="text-end">{t("leads.budget")}</Th>
                  <Th sortKey="preferred_location" sort={f.sort} onSort={onSort}>{t("common.location")}</Th>
                  <Th sortKey="status" sort={f.sort} onSort={onSort}>{t("common.status")}</Th>
                  <Th>{t("common.salesperson")}</Th>
                  <Th sortKey="last_activity_at" sort={f.sort} onSort={onSort}>{t("leads.lastActivity")}</Th>
                  <Th sortKey="next_follow_up" sort={f.sort} onSort={onSort}>{t("leads.nextFollowUp")}</Th>
                  <Th sortKey="created_at" sort={f.sort} onSort={onSort}>{t("common.created")}</Th>
                  <Th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {leads.data!.results.map((l) => {
                  const overdue = l.next_follow_up && new Date(l.next_follow_up).getTime() < Date.now();
                  return (
                    <tr key={l.id} className="group hover:bg-canvas/70">
                      <Td>
                        <Link href={`/leads/${l.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                          {l.name}
                        </Link>
                      </Td>
                      <Td className="tabular whitespace-nowrap"><Ltr>{l.phone}</Ltr></Td>
                      <Td className="max-w-[200px] truncate text-muted">{l.email ? <Ltr>{l.email}</Ltr> : "—"}</Td>
                      <Td className="whitespace-nowrap text-muted">{enums.label("leadSource", l.source)}</Td>
                      <Td className="tabular text-end">{money(l.budget)}</Td>
                      <Td className="whitespace-nowrap">{l.preferred_location || "—"}</Td>
                      <Td>
                        <LeadStatusBadge status={l.status} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        <PersonChip name={l.assigned_to?.full_name} />
                      </Td>
                      <Td className="whitespace-nowrap text-muted">{l.last_activity_at ? relative(l.last_activity_at) : "—"}</Td>
                      <Td className={`whitespace-nowrap ${overdue ? "font-medium text-bad-fg" : "text-muted"}`}>
                        {l.next_follow_up ? formatWhen(l.next_follow_up) : "—"}
                      </Td>
                      <Td className="whitespace-nowrap text-muted">{formatDate(l.created_at)}</Td>
                      <Td>
                        <div className="flex justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                          <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={() => setEditing(l)} aria-label={t("leads.editName", { name: l.name })} title={t("common.edit")}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={() => setStatusFor(l)} aria-label={t("leads.changeStatusName", { name: l.name })} title={t("leads.changeStatus")}>
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                          </Button>
                          {isManager && (
                            <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={() => setAssignFor(l)} aria-label={t("leads.assignName", { name: l.name })} title={t("leads.assign")}>
                              <UserCog className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
        {leads.data && leads.data.count > 0 && (
          <Pagination page={Number(f.page)} pageSize={PAGE_SIZE} count={leads.data.count} onPage={(p) => setF({ page: String(p) }, false)} />
        )}
      </Card>

      <LeadFormModal open={addOpen || Boolean(editing)} lead={editing} onClose={() => { setAddOpen(false); setEditing(null); }} />
      <ChangeStatusModal lead={statusFor} onClose={() => setStatusFor(null)} />
      <AssignModal lead={assignFor} onClose={() => setAssignFor(null)} />
    </div>
  );
}
