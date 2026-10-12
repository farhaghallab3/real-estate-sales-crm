"use client";

import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface LoginForm {
  email: string;
  password: string;
}

export default function LoginPage() {
  const { login, status } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>();

  useEffect(() => {
    router.prefetch("/dashboard");
  }, [router]);

  useEffect(() => {
    if (status === "authenticated") {
      setRedirecting(true); // keep the button busy: the first dev-mode compile of /dashboard can take a while
      router.replace("/dashboard");
    }
  }, [status, router]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.email.trim(), values.password);
      setRedirecting(true);
      router.replace("/dashboard");
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? "Incorrect email or password."
          : "Unable to sign in right now. Please try again.",
      );
    }
  });

  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_28rem]">
      <section className="relative hidden flex-col justify-between bg-sidebar p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-active">
            <Building2 className="h-5 w-5 text-accent" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Keystone</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">Sales operations, in one workspace.</h1>
          <p className="mt-3 text-sm leading-relaxed text-sidebar-text">
            Leads, inventory, viewings, offers and commissions — from first call to closed deal.
          </p>
        </div>
        <p className="text-xs text-sidebar-text">Internal use only. Activity is logged.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4" noValidate>
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand">
              <Building2 className="h-5 w-5 text-accent" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Keystone</span>
          </div>
          <div>
            <h2 className="text-xl font-semibold">Sign in</h2>
            <p className="mt-1 text-sm text-muted">Use your company account to continue.</p>
          </div>
          <FormError message={error} />
          <Field label="Email" error={errors.email?.message}>
            <Input
              type="email"
              autoComplete="username"
              autoFocus
              {...register("email", { required: "Email is required" })}
            />
          </Field>
          <Field label="Password" error={errors.password?.message}>
            <Input
              type="password"
              autoComplete="current-password"
              {...register("password", { required: "Password is required" })}
            />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={isSubmitting || redirecting}>
            {redirecting ? "Opening workspace…" : "Sign in"}
          </Button>
        </form>
      </section>
    </main>
  );
}
