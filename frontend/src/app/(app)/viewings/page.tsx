"use client";

import { addDays, addWeeks, endOfWeek, format, isSameDay, setHours, startOfDay, startOfWeek, subWeeks } from "date-fns";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ViewingItem } from "@/components/domain/viewing-row";
import { UserSelect } from "@/components/forms/pickers";
import { CompleteViewingModal, ViewingFormModal } from "@/components/forms/workflow-modals";
import { ViewingStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Tabs, TableSkeleton } from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";
import { formatTime } from "@/lib/format";
import { useViewings } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import type { Viewing } from "@/types";

type Tab = "week" | "scheduled" | "completed" | "cancelled";
const PAGE_SIZE = 20;

export default function ViewingsPage() {
  const { isManager } = useAuth();
  const [f, setF] = useUrlState({ tab: "week", week: "", assigned: "", page: "1" });
  const tab = f.tab as Tab;
  const [scheduleAt, setScheduleAt] = useState<Date | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [completing, setCompleting] = useState<Viewing | null>(null);

  const anchor = f.week ? new Date(f.week) : new Date();
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = addDays(endOfWeek(anchor, { weekStartsOn: 1 }), 0);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart.getTime()]);

  const weekQuery = useViewings(
    {
      start_after: weekStart.toISOString(),
      start_before: addDays(startOfDay(weekEnd), 1).toISOString(),
      assigned_to: f.assigned,
      ordering: "start_at",
      page_size: 200,
    },
    tab === "week",
  );
  const listQuery = useViewings(
    {
      status: tab === "week" ? "" : tab,
      ...(tab === "scheduled" ? { start_after: new Date().toISOString() } : {}),
      assigned_to: f.assigned,
      ordering: tab === "scheduled" ? "start_at" : "-start_at",
      page: f.page,
      page_size: PAGE_SIZE,
    },
    tab !== "week",
  );

  const shiftWeek = (dir: -1 | 0 | 1) =>
    setF({ week: dir === 0 ? "" : (dir === 1 ? addWeeks(anchor, 1) : subWeeks(anchor, 1)).toISOString() }, false);

  const openSchedule = (day?: Date) => {
    setScheduleAt(day ? setHours(startOfDay(day), 10) : null);
    setScheduleOpen(true);
  };

  const weekViewings = weekQuery.data?.results ?? [];

  return (
    <div>
      <PageHeader
        title="Viewings"
        description="Weekly schedule, completed viewings and client feedback."
        actions={
          <>
            {isManager && (
              <UserSelect
                className="w-44"
                value={f.assigned ? Number(f.assigned) : null}
                onChange={(id) => setF({ assigned: id ? String(id) : "" })}
                emptyLabel="All salespeople"
                aria-label="Salesperson"
              />
            )}
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openSchedule()}>
              Schedule viewing
            </Button>
          </>
        }
      />

      <Card padded={false}>
        <Tabs
          className="px-2"
          value={tab}
          onChange={(v) => setF({ tab: v })}
          tabs={[
            { value: "week", label: "Week" },
            { value: "scheduled", label: "Upcoming" },
            { value: "completed", label: "Completed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />

        {tab === "week" ? (
          <>
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Button size="sm" onClick={() => shiftWeek(-1)} aria-label="Previous week">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" onClick={() => shiftWeek(0)}>
                  Today
                </Button>
                <Button size="sm" onClick={() => shiftWeek(1)} aria-label="Next week">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm font-medium tabular">
                {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
              </p>
            </div>
            {weekQuery.error ? (
              <ErrorState message={(weekQuery.error as Error).message} onRetry={() => void weekQuery.refetch()} />
            ) : (
              <div className="scrollbar-thin overflow-x-auto">
                <div className="grid min-w-[880px] grid-cols-7 divide-x divide-line">
                  {days.map((day) => {
                    const items = weekViewings.filter((v) => isSameDay(new Date(v.start_at), day));
                    const today = isSameDay(day, new Date());
                    return (
                      <div key={day.toISOString()} className="min-h-[22rem]">
                        <button
                          onClick={() => openSchedule(day)}
                          className={clsx(
                            "group flex w-full items-center justify-between border-b border-line px-2.5 py-2 text-left hover:bg-canvas",
                            today && "bg-brand-50",
                          )}
                          title="Schedule a viewing on this day"
                        >
                          <span>
                            <span className="block text-2xs font-semibold uppercase text-muted">{format(day, "EEE")}</span>
                            <span className={clsx("text-sm font-semibold", today && "text-brand")}>{format(day, "d")}</span>
                          </span>
                          <Plus className="h-3.5 w-3.5 text-muted opacity-0 group-hover:opacity-100" />
                        </button>
                        <div className="space-y-1.5 p-1.5">
                          {weekQuery.isLoading && <div className="h-10 animate-pulse rounded bg-line/60" />}
                          {items.map((v) => (
                            <div
                              key={v.id}
                              className={clsx(
                                "rounded-md border px-2 py-1.5 text-xs",
                                v.status === "scheduled" && "border-brand/20 bg-brand-50",
                                v.status === "completed" && "border-ok-fg/20 bg-ok-bg/60",
                                v.status === "cancelled" && "border-line bg-canvas text-muted line-through",
                              )}
                            >
                              <p className="tabular font-semibold">
                                {formatTime(v.start_at)} – {formatTime(v.end_at)}
                              </p>
                              <Link href={`/leads/${v.lead.id}`} className="block truncate font-medium hover:underline">
                                {v.lead.name}
                              </Link>
                              <Link href={`/properties/${v.property.id}`} className="block truncate text-muted hover:underline">
                                {v.property.title}
                              </Link>
                              {isManager && v.assigned_to && <p className="truncate text-muted">{v.assigned_to.full_name}</p>}
                              <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
                                <ViewingStatusBadge status={v.status} />
                                {v.status === "scheduled" && (
                                  <button
                                    onClick={() => setCompleting(v)}
                                    className="text-2xs font-medium text-brand hover:underline"
                                  >
                                    Complete
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : listQuery.isLoading ? (
          <TableSkeleton cols={3} rows={5} />
        ) : listQuery.error ? (
          <ErrorState message={(listQuery.error as Error).message} onRetry={() => void listQuery.refetch()} />
        ) : listQuery.data!.results.length === 0 ? (
          <EmptyState
            title={`No ${tab === "scheduled" ? "upcoming" : tab} viewings`}
            action={
              tab === "scheduled" ? (
                <Button variant="primary" onClick={() => openSchedule()}>
                  Schedule viewing
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {listQuery.data!.results.map((v) => (
                <ViewingItem key={v.id} viewing={v} showAssignee={isManager} onComplete={setCompleting} />
              ))}
            </ul>
            <Pagination page={Number(f.page)} pageSize={PAGE_SIZE} count={listQuery.data!.count} onPage={(p) => setF({ page: String(p) }, false)} />
          </>
        )}
      </Card>

      <ViewingFormModal open={scheduleOpen} start={scheduleAt ?? undefined} onClose={() => setScheduleOpen(false)} />
      <CompleteViewingModal viewing={completing} onClose={() => setCompleting(null)} />
    </div>
  );
}
