"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, setUnauthorizedHandler, tokens } from "@/lib/api";
import type { User } from "@/types";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  user: User | null;
  status: Status;
  isManager: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const queryClient = useQueryClient();
  const router = useRouter();

  const logout = useCallback(() => {
    tokens.clear();
    setUser(null);
    setStatus("anonymous");
    queryClient.clear();
    router.replace("/login");
  }, [queryClient, router]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!tokens.access && !tokens.refresh) {
        setStatus("anonymous");
        return;
      }
      try {
        const me = await api<User>("/auth/me/");
        if (!cancelled) {
          setUser(me);
          setStatus("authenticated");
        }
      } catch {
        if (!cancelled) setStatus("anonymous");
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ access: string; refresh: string; user: User }>("/auth/login/", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    tokens.set(data.access, data.refresh);
    setUser(data.user);
    setStatus("authenticated");
  }, []);

  const refreshUser = useCallback(async () => {
    setUser(await api<User>("/auth/me/"));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isManager: user?.role === "admin" || user?.role === "manager",
      login,
      logout,
      refreshUser,
    }),
    [user, status, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
