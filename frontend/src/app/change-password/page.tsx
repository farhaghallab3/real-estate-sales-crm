"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

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
      setError(e instanceof ApiError ? e.message : "Could not change the password. Please try again.");
    }
  });

  if (status !== "authenticated" || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted" aria-busy>
        Loading…
      </div>
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
            <h1 className="text-xl font-semibold">Choose a new password</h1>
            <p className="mt-1 text-sm text-muted">
              Your account ({user.email}) was set up with a temporary password. For your security you must choose your own
              before you can use the workspace.
            </p>
          </div>
        </div>

        <FormError message={error} />
        <Field label="Temporary password" error={errors.current?.message}>
          <Input
            type="password"
            autoComplete="current-password"
            autoFocus
            {...register("current", { required: "Enter the temporary password you were given" })}
          />
        </Field>
        <Field
          label="New password"
          hint="At least 8 characters. Avoid common passwords and your name or email."
          error={errors.next?.message}
        >
          <Input
            type="password"
            autoComplete="new-password"
            {...register("next", {
              required: "Choose a new password",
              minLength: { value: 8, message: "At least 8 characters" },
              validate: (v) => v !== getValues("current") || "The new password must be different from the temporary one",
            })}
          />
        </Field>
        <Field label="Confirm new password" error={errors.confirm?.message}>
          <Input
            type="password"
            autoComplete="new-password"
            {...register("confirm", { validate: (v) => v === getValues("next") || "The passwords do not match" })}
          />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={isSubmitting || done}>
          {done ? "Opening workspace…" : "Set new password and continue"}
        </Button>
        <button type="button" onClick={logout} className="w-full text-center text-xs text-muted hover:underline">
          Sign out
        </button>
      </form>
    </main>
  );
}
