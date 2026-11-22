"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { useAuth } from "@/lib/auth";
import { useTranslations } from "next-intl";
import { useApiErrors } from "@/lib/use-api-errors";

interface Values {
  current: string;
  next: string;
  confirm: string;
}

/**
 * Mandatory screen for an account that was given a temporary password. The API refuses every other request until the
 * password is changed (see users/authentication.py); this page is just where the user does it.
 */
export default function ChangePasswordPage() {
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const { status, user, changePassword, logout } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
    // Someone who does not need to change anything has no business here.
    if (status === "authenticated" && user && !user.must_change_password && !done) router.replace("/dashboard");
  }, [status, user, done, router]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await changePassword(values.current, values.next);
      setDone(true);
      router.replace("/dashboard");
    } catch (e) {
      setError(errorText(e, t("auth.couldNotChangePasswordPlease")));
    }
  });

  if (status !== "authenticated" || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted" aria-busy>
        {t("common.loading")}</div>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <form onSubmit={onSubmit} className="w-full max-w-md space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm" noValidate>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand">
            <KeyRound className="h-5 w-5 text-accent" />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{t("auth.chooseNewPassword")}</h1>
            <p className="mt-1 text-sm text-muted">
              {t("auth.accountEmailWasSetUp", { email: user.email })}</p>
          </div>
        </div>

        <FormError message={error} />
        <Field label={t("auth.temporaryPassword")} error={errors.current?.message}>
          <Input
            type="password"
            autoComplete="current-password"
            autoFocus
            {...register("current", { required: t("auth.enterTemporaryPasswordWereGiven") })}
          />
        </Field>
        <Field
          label={t("common.newPassword")}
          hint={t("auth.atLeastCharactersAvoidCommon")}
          error={errors.next?.message}
        >
          <Input
            type="password"
            autoComplete="new-password"
            {...register("next", {
              required: t("auth.chooseNewPassword"),
              minLength: { value: 8, message: t("common.atLeastCharacters") },
              validate: (v) => v !== getValues("current") || t("auth.newPasswordMustDiffer"),
            })}
          />
        </Field>
        <Field label={t("common.confirmNewPassword")} error={errors.confirm?.message}>
          <Input
            type="password"
            autoComplete="new-password"
            {...register("confirm", { validate: (v) => v === getValues("next") || t("auth.passwordsDoNotMatch") })}
          />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={isSubmitting || done}>
          {done ? t("auth.openingWorkspace") : t("auth.setNewPasswordContinue")}
        </Button>
        <button type="button" onClick={logout} className="w-full text-center text-xs text-muted hover:underline">
          {t("common.signOut")}</button>
      </form>
    </main>
  );
}
