"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
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
