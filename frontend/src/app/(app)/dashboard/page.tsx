"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { TaskRow } from "@/components/domain/task-list";
import { LeadFormModal } from "@/components/forms/lead-form";
import { TaskFormModal } from "@/components/forms/task-form";
import { ViewingFormModal } from "@/components/forms/workflow-modals";
import { Button } from "@/components/ui/button";
import { LeadStatusBadge, ViewingStatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import {
  Card,
  EmptyState,
  ErrorState,
  Metric,
  PersonChip,
  Skeleton,
  Table,
  TableWrap,
  Td,
  Th,
  Ltr,} from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";

import { pct } from "@/lib/format";
import { useMoney, useFormat } from "@/lib/company";
import { useDashboard } from "@/lib/queries";
import type { Task } from "@/types";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useApiErrors } from "@/lib/use-api-errors";

/** The reporting periods of the filter: the value is what the API takes, the words come from the catalogue. */
const PERIODS = [
  { value: 0, key: "dashboard.periodAllTime" },
  { value: 30, key: "dashboard.periodLast30Days" },
  { value: 90, key: "dashboard.periodLast90Days" },
  { value: 365, key: "dashboard.periodLast12Months" },
] as const;

function dayPart(): "Morning" | "Afternoon" | "Evening" {
  const h = new Date().getHours();
  return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
}

export default function DashboardPage() {
  const enums = useEnums();
  const tr = useTranslations();
  const { errorText } = useApiErrors();
  const { money, moneyCompact } = useMoney();
  const { formatTime, formatWhen, relative } = useFormat();
  const { user, isManager } = useAuth();
  const [days, setDays] = useState(0);
  const { data, isLoading, error, refetch } = useDashboard(days);
  const [leadOpen, setLeadOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [viewingOpen, setViewingOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);

  if (error) return <ErrorState message={errorText(error)} onRetry={() => void refetch()} />;

  const m = data?.metrics;
  const maxPipeline = Math.max(1, ...(data?.pipeline.map((p) => p.count) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {tr(`dashboard.greeting${dayPart()}`)}, {user?.first_name || user?.full_name}
          </h1>
          <p className="text-sm text-muted">
            {isManager ? tr("dashboard.teamPerformanceWhatNeedsAttention") : tr("dashboard.leadsTasksDealsAtGlance")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-40" aria-label={tr("dashboard.period")}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {tr(p.key)}
              </option>
            ))}
          </Select>
          <Button onClick={() => setViewingOpen(true)}>{tr("common.scheduleViewing")}</Button>
          <Button onClick={() => setTaskOpen(true)}>{tr("common.newTask")}</Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setLeadOpen(true)}>
            {tr("common.addLead")}</Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {isLoading || !m ? (
          Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-[74px]" />)
        ) : (
          <>
            <Metric label={tr("dashboard.totalLeads")} value={m.total_leads} />
            <Metric label={tr("dashboard.newLeads")} value={m.new_leads} hint={tr("dashboard.awaitingFirstContact")} />
            <Metric label={tr("dashboard.qualifiedLeads")} value={m.qualified_leads} />
            <Metric label={tr("common.activeDeals")} value={m.active_deals} hint={tr("dashboard.openPipeline")} />
            <Metric label={tr("common.viewings")} value={m.viewings} />
            <Metric label={tr("common.offers")} value={m.offers} />
            <Metric label={tr("common.closedDeals")} value={m.closed_deals} />
            <Metric label={tr("common.salesValue")} value={moneyCompact(m.sales_value)} accent />
            <Metric label={tr("dashboard.commissionNet")} value={money(m.commission)} accent />
            <Metric label={tr("dashboard.conversionRate")} value={pct(m.conversion_rate)} hint={tr("dashboard.closedTotalLeads")} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Today's tasks */}
        <Card
          title={tr("dashboard.todaysTasks")}
          bodyClassName="p-0"
          padded={false}
          action={
            <Link href="/tasks" className="text-xs font-medium text-brand hover:underline">
              {tr("dashboard.allTasks")}</Link>
          }
        >
          {isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : data!.todays_tasks.length === 0 ? (
            <EmptyState title={tr("dashboard.nothingDueToday")} description={tr("dashboard.followUpsCreateWillShow")} />
          ) : (
            <ul className="divide-y divide-line">
              {data!.todays_tasks.map((t) => (
                <TaskRow key={t.id} task={t} onEdit={setEditTask} />
              ))}
            </ul>
          )}
        </Card>

        {/* Upcoming viewings */}
        <Card
          title={tr("dashboard.upcomingViewings")}
          padded={false}
          action={
            <Link href="/viewings" className="text-xs font-medium text-brand hover:underline">
              {tr("dashboard.calendar")}</Link>
          }
        >
          {isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : data!.upcoming_viewings.length === 0 ? (
            <EmptyState title={tr("dashboard.noUpcomingViewings")} action={<Button onClick={() => setViewingOpen(true)}>{tr("dashboard.scheduleOne")}</Button>} />
          ) : (
            <ul className="divide-y divide-line">
              {data!.upcoming_viewings.map((v) => (
                <li key={v.id} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/leads/${v.lead.id}`} className="block truncate text-sm font-medium hover:underline">
                        {v.lead.name}
                      </Link>
                      <Link href={`/properties/${v.property.id}`} className="block truncate text-xs text-muted hover:underline">
                        {v.property.title}
                      </Link>
                    </div>
                    <ViewingStatusBadge status={v.status} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted">
                    <span className="tabular">
                      {formatWhen(v.start_at)} – {formatTime(v.end_at)}
                    </span>
                    {isManager && <span>{v.assigned_to?.full_name}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Pipeline */}
        <Card
          title={tr("common.salesPipeline")}
          action={
            <Link href="/pipeline" className="text-xs font-medium text-brand hover:underline">
              {tr("dashboard.openBoard")}</Link>
          }
        >
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <ul className="space-y-2.5">
              {data!.pipeline.map((p) => (
                <li key={p.stage}>
                  <Link href="/pipeline" className="group block">
                    <div className="mb-1 flex items-baseline justify-between text-xs">
                      <span className="font-medium group-hover:underline">{enums.label("dealStage", p.stage)}</span>
                      <span className="tabular text-muted">
                        {p.count} · {moneyCompact(p.value)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-line">
                      <div
                        className={
                          p.stage === "lost" ? "h-full bg-bad-fg/60" : p.stage === "closed" ? "h-full bg-accent" : "h-full bg-brand"
                        }
                        style={{ width: `${(p.count / maxPipeline) * 100}%` }}
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Recent leads */}
        <Card
          title={tr("dashboard.recentLeads")}
          padded={false}
          className="xl:col-span-2"
          action={
            <Link href="/leads" className="text-xs font-medium text-brand hover:underline">
              {tr("dashboard.viewAll")}</Link>
          }
        >
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-32" />
            </div>
          ) : data!.recent_leads.length === 0 ? (
            <EmptyState title={tr("common.noLeadsYet")} action={<Button variant="primary" onClick={() => setLeadOpen(true)}>{tr("common.addLead")}</Button>} />
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>{tr("common.client")}</Th>
                    <Th>{tr("common.source")}</Th>
                    <Th>{tr("common.status")}</Th>
                    {isManager && <Th>{tr("common.salesperson")}</Th>}
                    <Th>{tr("dashboard.added")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {data!.recent_leads.map((l) => (
                    <tr key={l.id} className="hover:bg-canvas/70">
                      <Td>
                        <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                          {l.name}
                        </Link>
                        <div className="text-xs text-muted"><Ltr>{l.phone}</Ltr></div>
                      </Td>
                      <Td className="text-muted">{enums.label("leadSource", l.source)}</Td>
                      <Td>
                        <LeadStatusBadge status={l.status} />
                      </Td>
                      {isManager && (
                        <Td>
                          <PersonChip name={l.assigned_to?.full_name} />
                        </Td>
                      )}
                      <Td className="text-muted">{relative(l.created_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        {/* Activity */}
        <Card title={tr("dashboard.recentActivity")} padded={false}>
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-40" />
            </div>
          ) : data!.recent_activity.length === 0 ? (
            <EmptyState title={tr("common.noActivityYet")} />
          ) : (
            <ul className="divide-y divide-line">
              {data!.recent_activity.map((a) => (
                <li key={a.id} className="px-4 py-2.5">
                  <p className="text-sm leading-snug">
                    {a.lead ? (
                      <Link href={`/leads/${a.lead}`} className="hover:underline">
                        {a.message}
                      </Link>
                    ) : (
                      a.message
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {a.actor?.full_name ?? tr("common.system")} · {relative(a.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {isManager && data && data.team.length > 0 && (
        <Card title={tr("dashboard.teamPerformance")} padded={false}>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{tr("common.salesperson")}</Th>
                  <Th className="text-end">{tr("common.leads")}</Th>
                  <Th className="text-end">{tr("common.viewings")}</Th>
                  <Th className="text-end">{tr("common.offers")}</Th>
                  <Th className="text-end">{tr("common.closed")}</Th>
                  <Th className="text-end">{tr("common.salesValue")}</Th>
                  <Th className="text-end">{tr("common.commission")}</Th>
                </tr>
              </thead>
              <tbody>
                {data.team.map((r) => (
                  <tr key={r.user_id} className="hover:bg-canvas/70">
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
        </Card>
      )}

      <LeadFormModal open={leadOpen} onClose={() => setLeadOpen(false)} />
      <TaskFormModal open={taskOpen || Boolean(editTask)} task={editTask} onClose={() => { setTaskOpen(false); setEditTask(null); }} />
      <ViewingFormModal open={viewingOpen} onClose={() => setViewingOpen(false)} />
    </div>
  );
}
