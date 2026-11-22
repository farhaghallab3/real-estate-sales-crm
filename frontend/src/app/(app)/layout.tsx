"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  // A temporary-password account is routed to /change-password by the auth provider; never render the shell for it.
  if (status !== "authenticated" || user?.must_change_password) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted" aria-busy>
        Loading workspace…
      </div>
    );
  }
  return (
    <AppShell>
      <Suspense fallback={<div className="py-10 text-center text-sm text-muted">Loading…</div>}>{children}</Suspense>
    </AppShell>
  );
}
