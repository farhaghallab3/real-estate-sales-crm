"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { BrandMark } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api";
import { describeError } from "@/lib/api-errors";
import { useApiErrors } from "@/lib/use-api-errors";
import { useAuth } from "@/lib/auth";
import { useCompany } from "@/lib/company";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

// Public portfolio demo only (NEXT_PUBLIC_DEMO_MODE=true on the demo deployment). The demo password is public
// by design and protects nothing but disposable sample data.
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "";
const DEMO_ACCOUNTS = [
  { labelKey: "auth.demoManager", email: "manager@crm.local" },
  { labelKey: "auth.demoSalesperson", email: "sofia@crm.local" },
] as const;

interface LoginForm {
  email: string;
  password: string;
}

export default function LoginPage() {
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const { login, status, user } = useAuth();
  const { company_name } = useCompany();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>();

  useEffect(() => {
    router.prefetch("/dashboard");
  }, [router]);

  useEffect(() => {
    if (status === "authenticated") {
      setRedirecting(true); // keep the button busy: the first dev-mode compile of /dashboard can take a while
      router.replace(user?.must_change_password ? "/change-password" : "/dashboard");
    }
  }, [status, user?.must_change_password, router]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const signedIn = await login(values.email.trim(), values.password);
      setRedirecting(true);
      router.replace(signedIn.must_change_password ? "/change-password" : "/dashboard");
    } catch (e) {
      // wrong credentials, too many attempts (429) and no connection each have their own message; anything else keeps the generic sign-in message
      const known = describeError(e).kind;
      setError(
        e instanceof ApiError && e.status === 401
          ? t("auth.incorrectEmailOrPassword")
          : known === "rateLimited" || known === "network"
            ? errorText(e)
            : t("auth.unableSignRightNowPlease"),
      );
    }
  });

  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_28rem]">
      <section className="relative hidden flex-col justify-between bg-sidebar p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-9 w-9 rounded-lg bg-sidebar-active" iconClassName="h-5 w-5 text-accent" />
          <span className="text-lg font-semibold tracking-tight">{company_name}</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">{t("auth.salesOperationsOneWorkspace")}</h1>
          <p className="mt-3 text-sm leading-relaxed text-sidebar-text">
            {t("auth.leadsInventoryViewingsOffersCommissions")}</p>
        </div>
        <p className="text-xs text-sidebar-text">{t("auth.internalUseOnlyActivityLogged")}</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4" noValidate>
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <BrandMark className="h-9 w-9 rounded-lg bg-brand" iconClassName="h-5 w-5 text-accent" />
            <span className="text-lg font-semibold tracking-tight">{company_name}</span>
          </div>
          <div>
            <h2 className="text-xl font-semibold">{t("auth.signIn")}</h2>
            <p className="mt-1 text-sm text-muted">{t("auth.useCompanyAccountContinue")}</p>
          </div>
          {DEMO_MODE && (
            <div className="rounded-md border border-line bg-surface p-3 text-xs text-muted">
              <p className="mb-2 font-medium text-ink">{t("auth.publicDemoSampleDataResets")}</p>
              <div className="flex flex-wrap gap-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <Button
                    key={a.email}
                    size="sm"
                    onClick={() => {
                      setValue("email", a.email);
                      setValue("password", DEMO_PASSWORD);
                    }}
                  >
                    {t("auth.useLabel", { label: t(a.labelKey) })}</Button>
                ))}
              </div>
            </div>
          )}
          <FormError message={error} />
          <Field label={t("common.email")} error={errors.email?.message}>
            <Input
              type="email"
              autoComplete="username"
              autoFocus
              {...register("email", { required: t("auth.emailRequired") })}
            />
          </Field>
          <Field label={t("common.password")} error={errors.password?.message}>
            <Input
              type="password"
              autoComplete="current-password"
              {...register("password", { required: t("auth.passwordRequired") })}
            />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={isSubmitting || redirecting}>
            {redirecting ? t("auth.openingWorkspace") : t("auth.signIn")}
          </Button>
          <LanguageSwitcher variant="inline" />
        </form>
      </section>
    </main>
  );
}
