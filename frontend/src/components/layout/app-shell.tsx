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

import { BrandMark } from "@/components/ui/brand";
import { useAuth } from "@/lib/auth";
import { useCompany } from "@/lib/company";

import { useUnreadCount } from "@/lib/queries";

import { Avatar, Ltr } from "../ui/primitives";
import { LanguageSwitcher } from "./language-switcher";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";

const NAV = [
  { href: "/dashboard", labelKey: "shell.navDashboard", icon: LayoutDashboard },
  { href: "/leads", labelKey: "shell.navLeads", icon: Users },
  { href: "/properties", labelKey: "shell.navProperties", icon: Building2 },
  { href: "/pipeline", labelKey: "shell.navPipeline", icon: KanbanSquare },
  { href: "/tasks", labelKey: "shell.navTasks", icon: CheckSquare },
  { href: "/viewings", labelKey: "shell.navViewings", icon: CalendarDays },
  { href: "/deals", labelKey: "shell.navDeals", icon: Handshake },
  { href: "/commissions", labelKey: "shell.navCommissions", icon: BadgeDollarSign },
  { href: "/documents", labelKey: "shell.navDocuments", icon: FileText },
  { href: "/reports", labelKey: "shell.navReports", icon: BarChart3 },
  { href: "/notifications", labelKey: "shell.navNotifications", icon: Bell },
  { href: "/settings", labelKey: "shell.navSettings", icon: Settings },
] as const;

const COLLAPSE_KEY = "crm.sidebar.collapsed";

function Brand({ collapsed }: { collapsed: boolean }) {
  const { company_name, workspace_label } = useCompany();
  return (
    <Link href="/dashboard" className="flex h-14 shrink-0 items-center gap-2.5 px-4">
      <BrandMark className="h-8 w-8 rounded-lg bg-sidebar-active" iconClassName="h-[18px] w-[18px] text-accent" />
      {!collapsed && (
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight text-white">{company_name}</span>
          <span className="block text-2xs text-sidebar-text">{workspace_label}</span>
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
  const t = useTranslations();
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2" aria-label={t("shell.main")}>
      {NAV.map(({ href, labelKey, icon: Icon }) => {
        const label = t(labelKey);
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "group flex min-h-9 items-center gap-3 rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-active text-white"
                : "text-sidebar-text hover:bg-sidebar-hover hover:text-white",
              collapsed && "justify-center px-0",
            )}
          >
            <Icon className={clsx("h-[18px] w-[18px] shrink-0", active ? "text-accent" : "opacity-80")} />
            {!collapsed && <span className="min-w-0 flex-1 break-words">{label}</span>}
            {href === "/notifications" && unread > 0 && (
              <span
                className={clsx(
                  "rounded-full bg-accent px-1.5 text-2xs font-semibold text-sidebar tabular",
                  collapsed && "absolute ms-5 -mt-4",
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
  const enums = useEnums();
  const t = useTranslations();
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
          "fixed inset-y-0 start-0 z-30 hidden flex-col bg-sidebar transition-[width] duration-150 md:flex",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <Brand collapsed={collapsed} />
        <NavList collapsed={collapsed} unread={unread} />
        <button
          onClick={toggleCollapse}
          className="m-2.5 flex h-9 items-center justify-center gap-2 rounded-md border border-sidebar-line text-xs text-sidebar-text hover:bg-sidebar-hover hover:text-white"
          aria-label={collapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4 rtl:-scale-x-100" /> : <><ChevronsLeft className="h-4 w-4 rtl:-scale-x-100" /> {" "}{t("shell.collapse")}</>}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 start-0 flex w-64 flex-col bg-sidebar shadow-pop">
            <div className="flex items-center justify-between pe-2">
              <Brand collapsed={false} />
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-2 text-sidebar-text hover:bg-sidebar-hover"
                aria-label={t("shell.closeMenu")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList collapsed={false} unread={unread} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className={clsx("transition-[padding] duration-150", collapsed ? "md:ps-16" : "md:ps-60")}>
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur">
          <button
            className="rounded-md p-2 text-muted hover:bg-brand/5 md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label={t("shell.openMenu")}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden text-xs text-muted md:block">
            {user ? enums.label("role", user.role) : ""} workspace
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href="/notifications"
              className="relative rounded-md p-2 text-muted hover:bg-brand/5 hover:text-ink"
              aria-label={unread ? t("shell.notificationsUnread", { unread }) : t("shell.navNotifications")}
            >
              <Bell className="h-[18px] w-[18px]" />
              {unread > 0 && <span className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-canvas" />}
            </Link>
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-md py-1 ps-1 pe-2 hover:bg-brand/5"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <Avatar name={user?.full_name ?? "?"} size={28} />
                <span className="hidden text-start leading-tight sm:block">
                  <span className="block text-xs font-medium">{user?.full_name}</span>
                  <span className="block text-2xs text-muted">{user ? enums.label("role", user.role) : ""}</span>
                </span>
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute end-0 mt-1 w-52 rounded-lg border border-line bg-surface p-1 shadow-pop"
                >
                  <div className="px-2.5 py-2 text-xs text-muted"><Ltr>{user?.email}</Ltr></div>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-canvas"
                    onClick={() => {
                      setMenuOpen(false);
                      router.push("/settings");
                    }}
                  >
                    <Settings className="h-4 w-4 text-muted" /> {" "}{t("common.profileSettings")}</button>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-canvas"
                    onClick={logout}
                  >
                    <LogOut className="h-4 w-4 text-muted" /> {" "}{t("common.signOut")}</button>
                  <LanguageSwitcher variant="menu" onChosen={() => setMenuOpen(false)} />
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
