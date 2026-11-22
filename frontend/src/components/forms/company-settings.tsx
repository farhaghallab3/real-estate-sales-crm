"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { BrandMark } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { Card } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useCompany, type CompanyConfig } from "@/lib/company";
import { useTranslations } from "next-intl";
import { useApiErrors } from "@/lib/use-api-errors";

interface AdminSettings extends CompanyConfig {
  currency_locked: boolean;
  currencies: string[];
  locales: string[];
}

type Form = Pick<CompanyConfig, "company_name" | "workspace_label" | "currency_code" | "locale">;

const MAX_LOGO = 1024 * 1024;

/** Company Admin only: name, currency, number format and logo of THIS company. Changes show for everyone straight away. */
export function CompanySettingsCard() {
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const { setCompany } = useCompany();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const settings = useQuery({ queryKey: ["company-settings"], queryFn: () => api<AdminSettings>("/company/settings/") });
  const form = useForm<Form>();
  useEffect(() => {
    if (settings.data) {
      const { company_name, workspace_label, currency_code, locale } = settings.data;
      form.reset({ company_name, workspace_label, currency_code, locale });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  const applied = (data: AdminSettings) => {
    qc.setQueryData(["company-settings"], data);
    setCompany({
      company_name: data.company_name,
      workspace_label: data.workspace_label,
      currency_code: data.currency_code,
      locale: data.locale,
      language: data.language,
      direction: data.direction,
      logo_url: data.logo_url,
    });
    router.refresh(); // page title and <html lang/dir> come from the server
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "company-settings" });
  };

  const save = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const body: Partial<Form> = { ...values };
      if (settings.data?.currency_locked) delete body.currency_code;
      applied(await api<AdminSettings>("/company/settings/", { method: "PATCH", body }));
      toast.success(t("settings.companySettingsSaved"));
    } catch (e) {
      setError(errorText(e, t("common.couldNotSave")));
    }
  });

  const uploadLogo = async (file: File | undefined) => {
    setLogoError(null);
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setLogoError(t("settings.usePngJpgOrWebp"));
    if (file.size > MAX_LOGO) return setLogoError(t("settings.logoMustMbOrSmaller"));
    setBusy(true);
    try {
      const body = new FormData();
      body.append("logo", file);
      applied(await api<AdminSettings>("/company/settings/logo/", { method: "POST", form: body }));
      toast.success(t("settings.logoUpdated"));
    } catch (e) {
      setLogoError(errorText(e, t("settings.couldNotUploadLogo")));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeLogo = async () => {
    setLogoError(null);
    setBusy(true);
    try {
      applied(await api<AdminSettings>("/company/settings/logo/", { method: "DELETE" }));
      toast.success(t("settings.logoRemoved"));
    } catch (e) {
      setLogoError(errorText(e, t("settings.couldNotRemoveLogo")));
    } finally {
      setBusy(false);
    }
  };

  const data = settings.data;
  return (
    <Card title={t("settings.company")}>
      {settings.isLoading && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {settings.isError && <FormError message={t("settings.couldNotLoadCompanySettings")} />}
      {data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-4">
            <BrandMark className="h-14 w-14 rounded-xl bg-brand" iconClassName="h-7 w-7 text-accent" />
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  aria-label={t("settings.companyLogoFile")}
                  onChange={(e) => void uploadLogo(e.target.files?.[0])}
                />
                <Button size="sm" loading={busy} onClick={() => fileInput.current?.click()}>
                  {data.logo_url ? t("settings.replaceLogo") : t("settings.uploadLogo")}
                </Button>
                {data.logo_url && (
                  <Button size="sm" disabled={busy} onClick={() => void removeLogo()}>
                    {t("settings.removeLogo")}</Button>
                )}
              </div>
              <p className="text-xs text-muted">{t("settings.pngJpgOrWebpUp")}</p>
              <FormError message={logoError} />
            </div>
          </div>

          <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={save}>
            <div className="sm:col-span-2">
              <FormError message={error} />
            </div>
            <Field label={t("settings.companyName")} required error={form.formState.errors.company_name?.message}>
              <Input maxLength={120} {...form.register("company_name", { required: t("settings.required") })} />
            </Field>
            <Field label={t("settings.workspaceLabel")} required error={form.formState.errors.workspace_label?.message}>
              <Input maxLength={60} {...form.register("workspace_label", { required: t("settings.required") })} />
            </Field>
            <Field
              label={t("settings.baseCurrency")}
              hint={
                data.currency_locked
                  ? t("settings.lockedCompanyAlreadyHasPrices")
                  : t("settings.everyAmountShownOneCurrency")
              }
            >
              <Select disabled={data.currency_locked} {...form.register("currency_code")}>
                {data.currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("settings.numberDateFormat")} hint={t("settings.onlyChangesHowNumbersWritten")}>
              <Select {...form.register("locale")}>
                {data.locales.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
                {t("settings.saveCompanySettings")}</Button>
            </div>
          </form>
        </div>
      )}
    </Card>
  );
}
