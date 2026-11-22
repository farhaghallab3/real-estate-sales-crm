"use client";

import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

import { useCompany } from "@/lib/company";
import { useApiMutation } from "@/lib/queries";
import type { Lead, LeadInput } from "@/types";

import { UserSelect } from "./pickers";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useApiErrors } from "@/lib/use-api-errors";

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
  const enums = useEnums();
  const t = useTranslations();
  const { errorFields, errorText } = useApiErrors();
  const { isManager, user } = useAuth();
  const { currency_code } = useCompany();
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
      toast.success(lead ? t("leads.leadUpdated") : t("leads.leadAdded"));
      onSaved?.(saved);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = errorFields(e);
        for (const [k, msg] of Object.entries(fields)) setError(k as keyof LeadInput, { message: msg });
        if (Object.keys(fields).length === 0) setFormError(errorText(e));
      } else setFormError(errorText(e, t("leads.couldNotSaveLead")));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={lead ? t("leads.editLead") : t("common.addLead")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={save.isPending} onClick={onSubmit}>
            {lead ? t("common.saveChanges") : t("common.addLead")}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <FormError message={formError} />
        </div>
        <Field label={t("common.firstName")} required error={errors.first_name?.message}>
          <Input autoFocus {...register("first_name", { required: t("leads.firstNameRequired") })} />
        </Field>
        <Field label={t("common.lastName")} error={errors.last_name?.message}>
          <Input {...register("last_name")} />
        </Field>
        <Field label={t("common.phone")} required error={errors.phone?.message}>
          <Input type="tel" {...register("phone", { required: t("leads.phoneRequired") })} />
        </Field>
        <Field label={t("common.email")} error={errors.email?.message}>
          <Input
            type="email"
            {...register("email", { pattern: { value: /^\S+@\S+\.\S+$/, message: t("leads.enterValidEmail") } })}
          />
        </Field>
        <Field label={t("common.leadSource")} error={errors.source?.message}>
          <Select {...register("source")}>
            {enums.options("leadSource").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("leads.budgetCurrencyCode", { currency_code })} error={errors.budget?.message}>
          <Input
            type="number"
            min={0}
            step={1000}
            {...register("budget", { min: { value: 0, message: t("leads.budgetCannotNegative") } })}
          />
        </Field>
        <Field label={t("leads.preferredLocation")} error={errors.preferred_location?.message}>
          <Input placeholder={t("leads.eGRiverside")} {...register("preferred_location")} />
        </Field>
        {isManager && (
          <Field label={t("common.assignedSalesperson")}>
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
