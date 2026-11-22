"use client";

import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

import { useCompany } from "@/lib/company";
import { useApiMutation } from "@/lib/queries";
import type { Property, PropertyInput } from "@/types";

import { UserSelect } from "./pickers";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useApiErrors } from "@/lib/use-api-errors";

const empty: PropertyInput = {
  title: "",
  address: "",
  city: "",
  price: "",
  property_type: "apartment",
  bedrooms: 2,
  bathrooms: 1,
  area_sqm: "",
  status: "available",
  description: "",
  assigned_to_id: null,
};

export function PropertyFormModal({
  open,
  onClose,
  property,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  property?: Property | null;
  onSaved?: (p: Property) => void;
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
  } = useForm<PropertyInput>({ defaultValues: empty });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    reset(
      property
        ? {
            title: property.title,
            address: property.address,
            city: property.city,
            price: property.price,
            property_type: property.property_type,
            bedrooms: property.bedrooms,
            bathrooms: property.bathrooms,
            area_sqm: property.area_sqm ?? "",
            status: property.status,
            description: property.description,
            assigned_to_id: property.assigned_to?.id ?? null,
          }
        : { ...empty, assigned_to_id: user?.id ?? null },
    );
  }, [open, property, reset, user?.id]);

  const save = useApiMutation((values: PropertyInput) => {
    const body = {
      ...values,
      area_sqm: values.area_sqm === "" ? null : values.area_sqm,
      ...(isManager || !property ? {} : { assigned_to_id: undefined }),
    };
    return property
      ? api<Property>(`/properties/${property.id}/`, { method: "PATCH", body })
      : api<Property>("/properties/", { method: "POST", body });
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const saved = await save.mutateAsync(values);
      toast.success(property ? t("properties.propertyUpdated") : t("common.propertyAdded"));
      onSaved?.(saved);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = errorFields(e);
        for (const [k, msg] of Object.entries(fields)) setError(k as keyof PropertyInput, { message: msg });
        if (Object.keys(fields).length === 0) setFormError(errorText(e));
      } else setFormError(errorText(e, t("properties.couldNotSaveProperty")));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={property ? t("properties.editProperty") : t("common.addProperty")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={save.isPending} onClick={onSubmit}>
            {property ? t("common.saveChanges") : t("common.addProperty")}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-6" noValidate>
        <div className="sm:col-span-6">
          <FormError message={formError} />
        </div>
        <Field label={t("common.title")} required className="sm:col-span-6" error={errors.title?.message}>
          <Input autoFocus {...register("title", { required: t("common.titleRequired") })} />
        </Field>
        <Field label={t("properties.address")} required className="sm:col-span-4" error={errors.address?.message}>
          <Input {...register("address", { required: t("properties.addressRequired") })} />
        </Field>
        <Field label={t("properties.cityLocation")} required className="sm:col-span-2" error={errors.city?.message}>
          <Input {...register("city", { required: t("properties.locationRequired") })} />
        </Field>
        <Field label={t("properties.priceCurrencyCode", { currency_code })} required className="sm:col-span-2" error={errors.price?.message}>
          <Input
            type="number"
            min={1}
            step={1000}
            {...register("price", { required: t("properties.priceRequired"), min: { value: 1, message: t("common.mustAboveZero") } })}
          />
        </Field>
        <Field label={t("common.type")} className="sm:col-span-2">
          <Select {...register("property_type")}>
            {enums.options("propertyType").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("common.status")} className="sm:col-span-2">
          <Select {...register("status")}>
            {enums.options("propertyStatus").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("properties.bedrooms")} className="sm:col-span-2" error={errors.bedrooms?.message}>
          <Input type="number" min={0} {...register("bedrooms", { min: 0 })} />
        </Field>
        <Field label={t("properties.bathrooms")} className="sm:col-span-2" error={errors.bathrooms?.message}>
          <Input type="number" min={0} {...register("bathrooms", { min: 0 })} />
        </Field>
        <Field label={t("properties.areaM")} className="sm:col-span-2" error={errors.area_sqm?.message}>
          <Input type="number" min={0} step="0.1" {...register("area_sqm")} />
        </Field>
        {isManager && (
          <Field label={t("common.assignedSalesperson")} className="sm:col-span-6">
            <Controller
              control={control}
              name="assigned_to_id"
              render={({ field }) => <UserSelect value={field.value} onChange={field.onChange} />}
            />
          </Field>
        )}
        <Field label={t("properties.internalNotes")} className="sm:col-span-6">
          <Textarea {...register("description")} />
        </Field>
      </form>
    </Modal>
  );
}
