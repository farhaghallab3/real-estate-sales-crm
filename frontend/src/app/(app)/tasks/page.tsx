"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { TaskRow } from "@/components/domain/task-list";
import { TaskFormModal } from "@/components/forms/task-form";
import { UserSelect } from "@/components/forms/pickers";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  TableSkeleton,
  Tabs,
} from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

import { useTasks } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import { useQuery } from "@tanstack/react-query";
import type { Task, TaskScope } from "@/types";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useApiErrors } from "@/lib/use-api-errors";

const PAGE_SIZE = 25;

export default function TasksPage() {
  const enums = useEnums();
  const tr = useTranslations();
  const { errorText } = useApiErrors();
  const { isManager } = useAuth();
  const [f, setF] = useUrlState({ scope: "all", q: "", type: "", assigned: "", team: "", page: "1" });
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const teamView = isManager && (f.team === "1" || Boolean(f.assigned));
  const base = {
    mine: teamView ? "" : "true",
    assigned_to: f.assigned,
    type: f.type,
    search: f.q,
  };
  const scope = f.scope as TaskScope;
  const list = useTasks({
    ...base,
    scope,
    status: scope === "all" ? "pending" : "",
    ordering: scope === "completed" ? "-completed_at" : "due_at",
    page: f.page,
    page_size: PAGE_SIZE,
  });
  const counts = useQuery({
    queryKey: ["task-counts", base],
    queryFn: () => api<Record<TaskScope, number>>("/tasks/counts/", { params: base }),
  });

  const tabs: { value: TaskScope; label: string }[] = [
    { value: "all", label: tr("tasks.myTasks") },
    { value: "today", label: tr("tasks.dueToday") },
    { value: "upcoming", label: tr("common.upcoming") },
    { value: "overdue", label: tr("tasks.overdue") },
    { value: "completed", label: tr("common.completed") },
  ];

  return (
    <div>
      <PageHeader
        title={tr("tasks.tasksFollowUps")}
        description={tr("tasks.callsEmailsViewingsFollowUps")}
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
            {tr("common.newTask")}</Button>
        }
      />
      <Card padded={false}>
        <Tabs
          className="px-2"
          value={scope}
          onChange={(v) => setF({ scope: v })}
          tabs={tabs.map((t) => ({
            ...t,
            count: counts.data?.[t.value],
          }))}
        />
        <div className="grid grid-cols-1 gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={f.q} onChange={(v) => setF({ q: v })} placeholder={tr("tasks.searchTasksClientsProperties")} />
          <Select value={f.type} onChange={(e) => setF({ type: e.target.value })} aria-label={tr("tasks.taskType")}>
            <option value="">{tr("common.allTypes")}</option>
            {enums.options("taskType").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {isManager && (
            <>
              <Select
                value={teamView ? "team" : "mine"}
                onChange={(e) => setF({ team: e.target.value === "team" ? "1" : "", assigned: "" })}
                aria-label={tr("tasks.scope")}
              >
                <option value="mine">{tr("tasks.assignedMe")}</option>
                <option value="team">{tr("tasks.wholeTeam")}</option>
              </Select>
              {teamView && (
                <UserSelect
                  value={f.assigned ? Number(f.assigned) : null}
                  onChange={(id) => setF({ assigned: id ? String(id) : "", team: "1" })}
                  emptyLabel={tr("tasks.anySalesperson")}
                />
              )}
            </>
          )}
        </div>

        {list.isLoading ? (
          <TableSkeleton cols={3} rows={6} />
        ) : list.error ? (
          <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
        ) : list.data!.results.length === 0 ? (
          <EmptyState
            title={scope === "overdue" ? tr("tasks.nothingOverdue") : tr("tasks.noTasksHere")}
            description={scope === "completed" ? tr("tasks.completedTasksAppearHere") : tr("tasks.createFollowUpFromClient")}
            action={<Button variant="primary" onClick={() => setCreateOpen(true)}>{tr("common.newTask")}</Button>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.results.map((t) => (
              <TaskRow key={t.id} task={t} showAssignee={teamView} onEdit={setEditing} />
            ))}
          </ul>
        )}
        {list.data && list.data.count > 0 && (
          <Pagination page={Number(f.page)} pageSize={PAGE_SIZE} count={list.data.count} onPage={(p) => setF({ page: String(p) }, false)} />
        )}
      </Card>

      <TaskFormModal
        open={createOpen || Boolean(editing)}
        task={editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
      />
    </div>
  );
}
