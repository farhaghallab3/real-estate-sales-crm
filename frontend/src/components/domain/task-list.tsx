"use client";

import clsx from "clsx";
import { Calendar, FileText, Mail, Phone, Repeat, Check } from "lucide-react";
import Link from "next/link";

import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { TASK_TYPE } from "@/lib/constants";
import { formatWhen } from "@/lib/format";
import { useApiMutation } from "@/lib/queries";
import type { Task, TaskType } from "@/types";

const ICONS: Record<TaskType, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  viewing: Calendar,
  follow_up: Repeat,
  document: FileText,
};

export function TaskTypeIcon({ type, className }: { type: TaskType; className?: string }) {
  const Icon = ICONS[type] ?? Repeat;
  return <Icon className={className} />;
}

export function useToggleTask() {
  const toast = useToast();
  const complete = useApiMutation((t: Task) =>
    api<Task>(`/tasks/${t.id}/${t.status === "completed" ? "reopen" : "complete"}/`, { method: "POST" }),
  );
  return async (task: Task) => {
    try {
      await complete.mutateAsync(task);
      if (task.status === "pending") toast.success("Task completed");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update task");
    }
  };
}

export function TaskRow({
  task,
  showAssignee,
  onEdit,
}: {
  task: Task;
  showAssignee?: boolean;
  onEdit?: (t: Task) => void;
}) {
  const toggle = useToggleTask();
  const done = task.status === "completed";
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <button
        onClick={() => void toggle(task)}
        aria-label={done ? "Reopen task" : "Mark task complete"}
        className={clsx(
          "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border transition-colors",
          done ? "border-brand bg-brand text-white" : "border-line hover:border-brand",
        )}
      >
        {done && <Check className="h-3 w-3" />}
      </button>
      <div className="min-w-0 flex-1">
        <button
          onClick={() => onEdit?.(task)}
          className={clsx("block max-w-full truncate text-left text-sm font-medium", done && "text-muted line-through")}
        >
          {task.title}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <TaskTypeIcon type={task.type} className="h-3 w-3" /> {TASK_TYPE[task.type]}
          </span>
          {task.lead && (
            <Link href={`/leads/${task.lead.id}`} className="text-brand hover:underline">
              {task.lead.name}
            </Link>
          )}
          {task.property && (
            <Link href={`/properties/${task.property.id}`} className="truncate hover:underline">
              {task.property.title}
            </Link>
          )}
          {showAssignee && task.assigned_to && <span>· {task.assigned_to.full_name}</span>}
        </div>
      </div>
      <span
        className={clsx(
          "shrink-0 text-xs tabular",
          task.is_overdue ? "font-medium text-bad-fg" : "text-muted",
        )}
      >
        {done ? "Done" : formatWhen(task.due_at)}
      </span>
    </li>
  );
}
