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
import { optionsOf, TASK_TYPE } from "@/lib/constants";
import { useTasks } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import { useQuery } from "@tanstack/react-query";
import type { Task, TaskScope } from "@/types";

const PAGE_SIZE = 25;

export default function TasksPage() {
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
    { value: "all", label: "My tasks" },
    { value: "today", label: "Due today" },
    { value: "upcoming", label: "Upcoming" },
    { value: "overdue", label: "Overdue" },
    { value: "completed", label: "Completed" },
  ];

  return (
    <div>
      <PageHeader
        title="Tasks & follow-ups"
        description="Calls, emails, viewings, follow-ups and documents."
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
            New task
          </Button>
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
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={f.q} onChange={(v) => setF({ q: v })} placeholder="Search tasks, clients, properties…" />
          <Select value={f.type} onChange={(e) => setF({ type: e.target.value })} aria-label="Task type">
            <option value="">All types</option>
            {optionsOf(TASK_TYPE).map((o) => (
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
                aria-label="Scope"
              >
                <option value="mine">Assigned to me</option>
                <option value="team">Whole team</option>
              </Select>
              {teamView && (
                <UserSelect
                  value={f.assigned ? Number(f.assigned) : null}
                  onChange={(id) => setF({ assigned: id ? String(id) : "", team: "1" })}
                  emptyLabel="Any salesperson"
                />
              )}
            </>
          )}
        </div>

        {list.isLoading ? (
          <TableSkeleton cols={3} rows={6} />
        ) : list.error ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : list.data!.results.length === 0 ? (
          <EmptyState
            title={scope === "overdue" ? "Nothing overdue 🎉" : "No tasks here"}
            description={scope === "completed" ? "Completed tasks appear here." : "Create a follow-up from a client profile or here."}
            action={<Button variant="primary" onClick={() => setCreateOpen(true)}>New task</Button>}
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
