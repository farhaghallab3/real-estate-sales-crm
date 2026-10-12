"use client";

import clsx from "clsx";
import {
  BadgeDollarSign,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CheckSquare,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Handshake,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/constants";
import { useUnreadCount } from "@/lib/queries";

import { Avatar } from "../ui/primitives";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads / Clients", icon: Users },
  { href: "/properties", label: "Properties", icon: Building2 },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/viewings", label: "Viewings", icon: CalendarDays },
  { href: "/deals", label: "Deals", icon: Handshake },
  { href: "/commissions", label: "Commissions", icon: BadgeDollarSign },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Profile / Settings", icon: Settings },
] as const;

const COLLAPSE_KEY = "crm.sidebar.collapsed";

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/dashboard" className="flex h-14 shrink-0 items-center gap-2.5 px-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-active">
        <Building2 className="h-[18px] w-[18px] text-accent" />
      </span>
      {!collapsed && (
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight text-white">Keystone</span>
          <span className="block text-2xs text-sidebar-text">Sales workspace</span>
        </span>
      )}
    </Link>
  );
}

function NavList({
  collapsed,
  unread,
  onNavigate,
}: {
  collapsed: boolean;
  unread: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-active text-white"
                : "text-sidebar-text hover:bg-sidebar-hover hover:text-white",
              collapsed && "justify-center px-0",
            )}
          >
            <Icon className={clsx("h-[18px] w-[18px] shrink-0", active ? "text-accent" : "opacity-80")} />
            {!collapsed && <span className="flex-1 truncate">{label}</span>}
            {href === "/notifications" && unread > 0 && (
              <span
                className={clsx(
                  "rounded-full bg-accent px-1.5 text-2xs font-semibold text-sidebar tabular",
                  collapsed && "absolute ml-5 -mt-4",
                )}
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const unread = useUnreadCount().data?.count ?? 0;

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const toggleCollapse = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-30 hidden flex-col bg-sidebar transition-[width] duration-150 md:flex",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <Brand collapsed={collapsed} />
        <NavList collapsed={collapsed} unread={unread} />
        <button
          onClick={toggleCollapse}
          className="m-2.5 flex h-9 items-center justify-center gap-2 rounded-md border border-sidebar-line text-xs text-sidebar-text hover:bg-sidebar-hover hover:text-white"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-sidebar shadow-pop">
            <div className="flex items-center justify-between pr-2">
              <Brand collapsed={false} />
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-2 text-sidebar-text hover:bg-sidebar-hover"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList collapsed={false} unread={unread} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className={clsx("transition-[padding] duration-150", collapsed ? "md:pl-16" : "md:pl-60")}>
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur">
          <button
            className="rounded-md p-2 text-muted hover:bg-brand/5 md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden text-xs text-muted md:block">
            {user ? ROLE_LABEL[user.role] : ""} workspace
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href="/notifications"
              className="relative rounded-md p-2 text-muted hover:bg-brand/5 hover:text-ink"
              aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
            >
              <Bell className="h-[18px] w-[18px]" />
              {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-canvas" />}
            </Link>
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-brand/5"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <Avatar name={user?.full_name ?? "?"} size={28} />
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block text-xs font-medium">{user?.full_name}</span>
                  <span className="block text-2xs text-muted">{user ? ROLE_LABEL[user.role] : ""}</span>
                </span>
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1 w-52 rounded-lg border border-line bg-surface p-1 shadow-pop"
                >
                  <div className="px-2.5 py-2 text-xs text-muted">{user?.email}</div>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-canvas"
                    onClick={() => {
                      setMenuOpen(false);
                      router.push("/settings");
                    }}
                  >
                    <Settings className="h-4 w-4 text-muted" /> Profile & settings
                  </button>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-canvas"
                    onClick={logout}
                  >
                    <LogOut className="h-4 w-4 text-muted" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] px-4 py-5 md:px-6">{children}</main>
      </div>
    </div>
  );
}
