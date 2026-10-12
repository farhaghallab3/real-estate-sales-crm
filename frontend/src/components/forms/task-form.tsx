"use client";

import { addHours, setMinutes } from "date-fns";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { optionsOf, TASK_TYPE } from "@/lib/constants";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { useApiMutation } from "@/lib/queries";
import type { LeadMini, PropertyMini, Task, TaskType } from "@/types";

import { LeadPicker, PropertyPicker, UserSelect } from "./pickers";

interface Preset {
  lead?: LeadMini | null;
  property?: PropertyMini | null;
  dealId?: number | null;
  type?: TaskType;
  title?: string;
}

interface FormValues {
  title: string;
  type: TaskType;
  due_at: string;
  description: string;
  assigned_to_id: number | null;
}

function defaultDue(): string {
  return toLocalInput(setMinutes(addHours(new Date(), 1), 0));
}

export function TaskFormModal({
  open,
  onClose,
  preset,
  task,
}: {
  open: boolean;
  onClose: () => void;
  preset?: Preset;
  task?: Task | null;
}) {
  const { isManager, user } = useAuth();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const [lead, setLead] = useState<{ id: number; name: string } | null>(null);
  const [property, setProperty] = useState<{ id: number; title: string } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<FormValues>();

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    const l = task?.lead ?? preset?.lead ?? null;
    const p = task?.property ?? preset?.property ?? null;
    setLead(l ? { id: l.id, name: l.name } : null);
    setProperty(p ? { id: p.id, title: p.title } : null);
    reset({
      title: task?.title ?? preset?.title ?? "",
      type: task?.type ?? preset?.type ?? "follow_up",
      due_at: task ? toLocalInput(new Date(task.due_at)) : defaultDue(),
      description: task?.description ?? "",
      assigned_to_id: task?.assigned_to?.id ?? user?.id ?? null,
    });
  }, [open, task, preset, reset, user?.id]);

  const save = useApiMutation((v: FormValues) => {
    const body = {
      title: v.title,
      type: v.type,
      description: v.description,
      due_at: fromLocalInput(v.due_at),
      lead_id: lead?.id ?? null,
      property_id: property?.id ?? null,
      deal_id: preset?.dealId ?? task?.deal_id ?? null,
      ...(isManager ? { assigned_to_id: v.assigned_to_id } : {}),
    };
    return task ? api<Task>(`/tasks/${task.id}/`, { method: "PATCH", body }) : api<Task>("/tasks/", { method: "POST", body });
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await save.mutateAsync(v);
      toast.success(task ? "Task updated" : "Task created");
      onClose();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Could not save the task.");
    }
  });

  const presetLead = Boolean(preset?.lead);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? "Edit task" : "Create task"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={onSubmit}>
            {task ? "Save" : "Create task"}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <FormError message={formError} />
        </div>
        <Field label="Title" required className="sm:col-span-2" error={errors.title?.message}>
          <Input autoFocus placeholder="e.g. Call back about pricing" {...register("title", { required: "Title is required" })} />
        </Field>
        <Field label="Type">
          <Select {...register("type")}>
            {optionsOf(TASK_TYPE).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due" required error={errors.due_at?.message}>
          <Input type="datetime-local" {...register("due_at", { required: "Due date is required" })} />
        </Field>
        <Field label="Client / lead" className="sm:col-span-2">
          <LeadPicker
            label={lead?.name ?? null}
            disabled={presetLead}
            onChange={(l) => setLead(l ? { id: l.id, name: l.name } : null)}
          />
        </Field>
        <Field label="Property" className="sm:col-span-2">
          <PropertyPicker
            label={property?.title ?? null}
            onChange={(p) => setProperty(p ? { id: p.id, title: p.title } : null)}
          />
        </Field>
        {isManager && (
          <Field label="Assigned to" className="sm:col-span-2">
            <Controller
              control={control}
              name="assigned_to_id"
              render={({ field }) => <UserSelect value={field.value} onChange={field.onChange} allowEmpty={false} />}
            />
          </Field>
        )}
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} {...register("description")} />
        </Field>
      </form>
    </Modal>
  );
}
