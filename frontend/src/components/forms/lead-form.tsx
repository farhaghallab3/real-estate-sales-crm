"use client";

import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LEAD_SOURCE, optionsOf } from "@/lib/constants";
import { useApiMutation } from "@/lib/queries";
import type { Lead, LeadInput } from "@/types";

import { UserSelect } from "./pickers";

const empty: LeadInput = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  source: "website",
  budget: "",
  preferred_location: "",
  assigned_to_id: null,
};

export function LeadFormModal({
  open,
  onClose,
  lead,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  lead?: Lead | null;
  onSaved?: (lead: Lead) => void;
}) {
  const { isManager, user } = useAuth();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    control,
    setError,
    formState: { errors },
  } = useForm<LeadInput>({ defaultValues: empty });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    reset(
      lead
        ? {
            first_name: lead.first_name,
            last_name: lead.last_name,
            phone: lead.phone,
            email: lead.email,
            source: lead.source,
            budget: lead.budget ?? "",
            preferred_location: lead.preferred_location,
            assigned_to_id: lead.assigned_to?.id ?? null,
          }
        : { ...empty, assigned_to_id: user?.id ?? null },
    );
  }, [open, lead, reset, user?.id]);

  const save = useApiMutation((values: LeadInput) => {
    const body = {
      ...values,
      budget: values.budget === "" ? null : values.budget,
      ...(isManager ? {} : { assigned_to_id: undefined }),
    };
    return lead
      ? api<Lead>(`/leads/${lead.id}/`, { method: "PATCH", body })
      : api<Lead>("/leads/", { method: "POST", body });
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const saved = await save.mutateAsync(values);
      toast.success(lead ? "Lead updated" : "Lead added");
      onSaved?.(saved);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = e.fieldErrors;
        for (const [k, msg] of Object.entries(fields)) setError(k as keyof LeadInput, { message: msg });
        if (Object.keys(fields).length === 0) setFormError(e.message);
      } else setFormError("Could not save the lead.");
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={lead ? "Edit lead" : "Add lead"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={onSubmit}>
            {lead ? "Save changes" : "Add lead"}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <FormError message={formError} />
        </div>
        <Field label="First name" required error={errors.first_name?.message}>
          <Input autoFocus {...register("first_name", { required: "First name is required" })} />
        </Field>
        <Field label="Last name" error={errors.last_name?.message}>
          <Input {...register("last_name")} />
        </Field>
        <Field label="Phone" required error={errors.phone?.message}>
          <Input type="tel" {...register("phone", { required: "Phone is required" })} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input
            type="email"
            {...register("email", { pattern: { value: /^\S+@\S+\.\S+$/, message: "Enter a valid email" } })}
          />
        </Field>
        <Field label="Lead source" error={errors.source?.message}>
          <Select {...register("source")}>
            {optionsOf(LEAD_SOURCE).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Budget (USD)" error={errors.budget?.message}>
          <Input
            type="number"
            min={0}
            step={1000}
            {...register("budget", { min: { value: 0, message: "Budget cannot be negative" } })}
          />
        </Field>
        <Field label="Preferred location" error={errors.preferred_location?.message}>
          <Input placeholder="e.g. Riverside" {...register("preferred_location")} />
        </Field>
        {isManager && (
          <Field label="Assigned salesperson">
            <Controller
              control={control}
              name="assigned_to_id"
              render={({ field }) => <UserSelect value={field.value} onChange={field.onChange} />}
            />
          </Field>
        )}
      </form>
    </Modal>
  );
}
