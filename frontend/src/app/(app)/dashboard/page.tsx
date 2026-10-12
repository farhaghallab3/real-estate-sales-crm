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
} from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";
import { DEAL_STAGE, LEAD_SOURCE } from "@/lib/constants";
import { formatTime, formatWhen, money, moneyCompact, pct, relative } from "@/lib/format";
import { useDashboard } from "@/lib/queries";
import type { Task } from "@/types";

const PERIODS = [
  { value: 0, label: "All time" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 365, label: "Last 12 months" },
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const { user, isManager } = useAuth();
  const [days, setDays] = useState(0);
  const { data, isLoading, error, refetch } = useDashboard(days);
  const [leadOpen, setLeadOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [viewingOpen, setViewingOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />;

  const m = data?.metrics;
  const maxPipeline = Math.max(1, ...(data?.pipeline.map((p) => p.count) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {greeting()}, {user?.first_name || user?.full_name}
          </h1>
          <p className="text-sm text-muted">
            {isManager ? "Team performance and what needs attention today." : "Your leads, tasks and deals at a glance."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-40" aria-label="Period">
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <Button onClick={() => setViewingOpen(true)}>Schedule viewing</Button>
          <Button onClick={() => setTaskOpen(true)}>New task</Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setLeadOpen(true)}>
            Add lead
          </Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {isLoading || !m ? (
          Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-[74px]" />)
        ) : (
          <>
            <Metric label="Total leads" value={m.total_leads} />
            <Metric label="New leads" value={m.new_leads} hint="Awaiting first contact" />
            <Metric label="Qualified leads" value={m.qualified_leads} />
            <Metric label="Active deals" value={m.active_deals} hint="Open in pipeline" />
            <Metric label="Viewings" value={m.viewings} />
            <Metric label="Offers" value={m.offers} />
            <Metric label="Closed deals" value={m.closed_deals} />
            <Metric label="Sales value" value={moneyCompact(m.sales_value)} accent />
            <Metric label="Commission (net)" value={money(m.commission)} accent />
            <Metric label="Conversion rate" value={pct(m.conversion_rate)} hint="Closed ÷ total leads" />
          </>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Today's tasks */}
        <Card
          title="Today's tasks"
          bodyClassName="p-0"
          padded={false}
          action={
            <Link href="/tasks" className="text-xs font-medium text-brand hover:underline">
              All tasks
            </Link>
          }
        >
          {isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : data!.todays_tasks.length === 0 ? (
            <EmptyState title="Nothing due today" description="Follow-ups you create will show up here." />
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
          title="Upcoming viewings"
          padded={false}
          action={
            <Link href="/viewings" className="text-xs font-medium text-brand hover:underline">
              Calendar
            </Link>
          }
        >
          {isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : data!.upcoming_viewings.length === 0 ? (
            <EmptyState title="No upcoming viewings" action={<Button onClick={() => setViewingOpen(true)}>Schedule one</Button>} />
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
          title="Sales pipeline"
          action={
            <Link href="/pipeline" className="text-xs font-medium text-brand hover:underline">
              Open board
            </Link>
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
                      <span className="font-medium group-hover:underline">{DEAL_STAGE[p.stage].label}</span>
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

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Recent leads */}
        <Card
          title="Recent leads"
          padded={false}
          className="xl:col-span-2"
          action={
            <Link href="/leads" className="text-xs font-medium text-brand hover:underline">
              View all
            </Link>
          }
        >
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-32" />
            </div>
          ) : data!.recent_leads.length === 0 ? (
            <EmptyState title="No leads yet" action={<Button variant="primary" onClick={() => setLeadOpen(true)}>Add lead</Button>} />
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Client</Th>
                    <Th>Source</Th>
                    <Th>Status</Th>
                    {isManager && <Th>Salesperson</Th>}
                    <Th>Added</Th>
                  </tr>
                </thead>
                <tbody>
                  {data!.recent_leads.map((l) => (
                    <tr key={l.id} className="hover:bg-canvas/70">
                      <Td>
                        <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                          {l.name}
                        </Link>
                        <div className="text-xs text-muted">{l.phone}</div>
                      </Td>
                      <Td className="text-muted">{LEAD_SOURCE[l.source]}</Td>
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
        <Card title="Recent activity" padded={false}>
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-40" />
            </div>
          ) : data!.recent_activity.length === 0 ? (
            <EmptyState title="No activity yet" />
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
                    {a.actor?.full_name ?? "System"} · {relative(a.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {isManager && data && data.team.length > 0 && (
        <Card title="Team performance" padded={false}>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Salesperson</Th>
                  <Th className="text-right">Leads</Th>
                  <Th className="text-right">Viewings</Th>
                  <Th className="text-right">Offers</Th>
                  <Th className="text-right">Closed</Th>
                  <Th className="text-right">Sales value</Th>
                  <Th className="text-right">Commission</Th>
                </tr>
              </thead>
              <tbody>
                {data.team.map((r) => (
                  <tr key={r.user_id} className="hover:bg-canvas/70">
                    <Td>
                      <PersonChip name={r.name} />
                    </Td>
                    <Td className="tabular text-right">{r.leads}</Td>
                    <Td className="tabular text-right">{r.viewings}</Td>
                    <Td className="tabular text-right">{r.offers}</Td>
                    <Td className="tabular text-right">{r.closed_deals}</Td>
                    <Td className="tabular text-right">{money(r.sales_value)}</Td>
                    <Td className="tabular text-right">{money(r.commission)}</Td>
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
