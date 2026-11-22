"use client";

import { addDays, addWeeks, format, isSameDay, setHours, startOfDay, subWeeks } from "date-fns";
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
import { useViewings } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import { listViewingParams, weekRange, weekViewingParams } from "@/lib/viewings-query";
import { useFormat, useWeek } from "@/lib/company";
import type { Viewing } from "@/types";
import { useTranslations } from "next-intl";
import { useApiErrors } from "@/lib/use-api-errors";

type Tab = "week" | "scheduled" | "completed" | "cancelled";
const PAGE_SIZE = 20;

export default function ViewingsPage() {
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const { formatTime, dayMonth, dayMonthYear, weekday } = useFormat();
  const { firstDay } = useWeek();
  const { isManager } = useAuth();
  const [f, setF] = useUrlState({ tab: "week", week: "", assigned: "", page: "1" });
  const tab = f.tab as Tab;
  const [scheduleAt, setScheduleAt] = useState<Date | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [completing, setCompleting] = useState<Viewing | null>(null);

  const anchor = f.week ? new Date(f.week) : new Date();
  const { weekStart, weekEnd } = weekRange({ anchor, firstDay });
  const weekStartMs = weekStart.getTime();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(new Date(weekStartMs), i)), [weekStartMs]);

  // "Upcoming" is measured from the moment the view was opened or last changed. The clock is read here, once per genuine change (tab, filter, page), and NOT
  // while building the parameters: a new Date() on every render gave a new query key on every render and the list was requested again and again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nowIso = useMemo(() => new Date().toISOString(), [tab, f.assigned, f.page]);

  const weekQuery = useViewings(weekViewingParams({ anchor, firstDay, assigned: f.assigned }, 200), tab === "week");
  const listQuery = useViewings(listViewingParams({ tab, assigned: f.assigned, page: f.page, nowIso }, PAGE_SIZE), tab !== "week");

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
        title={t("common.viewings")}
        description={t("viewings.weeklyScheduleCompletedViewingsClient")}
        actions={
          <>
            {isManager && (
              <UserSelect
                className="w-44"
                value={f.assigned ? Number(f.assigned) : null}
                onChange={(id) => setF({ assigned: id ? String(id) : "" })}
                emptyLabel={t("common.allSalespeople")}
                aria-label={t("common.salesperson")}
              />
            )}
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openSchedule()}>
              {t("common.scheduleViewing")}</Button>
          </>
        }
      />

      <Card padded={false}>
        <Tabs
          className="px-2"
          value={tab}
          onChange={(v) => setF({ tab: v })}
          tabs={[
            { value: "week", label: t("viewings.week") },
            { value: "scheduled", label: t("common.upcoming") },
            { value: "completed", label: t("common.completed") },
            { value: "cancelled", label: t("viewings.cancelled") },
          ]}
        />

        {tab === "week" ? (
          <>
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Button size="sm" onClick={() => shiftWeek(-1)} aria-label={t("viewings.previousWeek")}>
                  <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" />
                </Button>
                <Button size="sm" onClick={() => shiftWeek(0)}>
                  {t("viewings.today")}</Button>
                <Button size="sm" onClick={() => shiftWeek(1)} aria-label={t("viewings.nextWeek")}>
                  <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
                </Button>
              </div>
              <p className="text-sm font-medium tabular">
                {dayMonth(weekStart)} – {dayMonthYear(weekEnd)}
              </p>
            </div>
            {weekQuery.error ? (
              <ErrorState message={errorText(weekQuery.error)} onRetry={() => void weekQuery.refetch()} />
            ) : (
              <div className="scrollbar-thin overflow-x-auto">
                <div className="grid min-w-[880px] grid-cols-7 divide-x rtl:divide-x-reverse divide-line">
                  {days.map((day) => {
                    const items = weekViewings.filter((v) => isSameDay(new Date(v.start_at), day));
                    const today = isSameDay(day, new Date());
                    return (
                      <div key={day.toISOString()} className="min-h-[22rem]">
                        <button
                          onClick={() => openSchedule(day)}
                          className={clsx(
                            "group flex w-full items-center justify-between border-b border-line px-2.5 py-2 text-start hover:bg-canvas",
                            today && "bg-brand-50",
                          )}
                          title={t("viewings.scheduleViewingDay")}
                        >
                          <span>
                            <span className="block text-2xs font-semibold uppercase text-muted">{weekday(day)}</span>
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
                                    {t("common.complete")}</button>
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
          <ErrorState message={errorText(listQuery.error)} onRetry={() => void listQuery.refetch()} />
        ) : listQuery.data!.results.length === 0 ? (
          <EmptyState
            title={t("viewings.noValueViewings", { value: tab === "scheduled" ? "upcoming" : tab })}
            action={
              tab === "scheduled" ? (
                <Button variant="primary" onClick={() => openSchedule()}>
                  {t("common.scheduleViewing")}</Button>
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
