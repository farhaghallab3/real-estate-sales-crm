"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, setPasswordChangeHandler, setUnauthorizedHandler, tokens } from "@/lib/api";
import type { User } from "@/types";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  user: User | null;
  status: Status;
  isManager: boolean;
  isAdmin: boolean;
  /** Signs in and returns the user, so the caller can send a temporary-password account to the change screen. */
  login: (email: string, password: string) => Promise<User>;
  changePassword: (current: string, next: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

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

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const data = await api<{ access: string; refresh: string; user: User }>("/auth/login/", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    tokens.set(data.access, data.refresh);
    setUser(data.user);
    setStatus("authenticated");
    return data.user;
  }, []);

  const refreshUser = useCallback(async () => {
    setUser(await api<User>("/auth/me/"));
  }, []);

  // Changing the password revokes every older token on the server; it answers with a fresh pair for this session.
  const changePassword = useCallback(
    async (current: string, next: string) => {
      const pair = await api<{ access: string; refresh: string }>("/auth/change-password/", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      tokens.set(pair.access, pair.refresh);
      await refreshUser();
    },
    [refreshUser],
  );

  // A temporary-password account may only use the change-password screen: the server enforces it, this just routes.
  useEffect(() => {
    setPasswordChangeHandler(() => void refreshUser().catch(() => undefined));
    return () => setPasswordChangeHandler(null);
  }, [refreshUser]);

  useEffect(() => {
    if (status === "authenticated" && user?.must_change_password && pathname !== "/change-password") {
      router.replace("/change-password");
    }
  }, [status, user?.must_change_password, pathname, router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isManager: user?.role === "admin" || user?.role === "manager",
      isAdmin: user?.role === "admin",
      login,
      changePassword,
      logout,
      refreshUser,
    }),
    [user, status, login, changePassword, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
