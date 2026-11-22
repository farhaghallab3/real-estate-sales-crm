"use client";

import clsx from "clsx";
import {
  AlertTriangle,
  BadgeDollarSign,
  Bell,
  CalendarPlus,
  FileWarning,
  Handshake,
  ListChecks,
  Tag,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Pills, TableSkeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useApiMutation, useNotifications } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import { useFormat } from "@/lib/company";
import type { AppNotification } from "@/types";
import { useTranslations } from "next-intl";
import { useApiErrors } from "@/lib/use-api-errors";

const PAGE_SIZE = 25;

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  lead_assigned: UserPlus,
  task_overdue: AlertTriangle,
  task_assigned: ListChecks,
  viewing_created: CalendarPlus,
  deal_status: Handshake,
  price_changed: Tag,
  document_missing: FileWarning,
  commission: BadgeDollarSign,
};

export default function NotificationsPage() {
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const { relative } = useFormat();
  const router = useRouter();
  const [f, setF] = useUrlState({ filter: "all", page: "1" });
  const list = useNotifications({
    unread: f.filter === "unread" ? "1" : "",
    page: f.page,
    page_size: PAGE_SIZE,
  });
  const markRead = useApiMutation((id: number) => api(`/notifications/${id}/mark-read/`, { method: "POST" }));
  const markAll = useApiMutation(() => api("/notifications/mark-all-read/", { method: "POST" }));

  const open = async (n: AppNotification) => {
    if (!n.is_read) await markRead.mutateAsync(n.id);
    if (n.link) router.push(n.link);
  };

  return (
    <div>
      <PageHeader
        title={t("notifications.notifications")}
        description={t("notifications.assignmentsRemindersDealChanges")}
        actions={
          <Button onClick={() => void markAll.mutateAsync(undefined)} loading={markAll.isPending}>
            {t("notifications.markAllAsRead")}</Button>
        }
      />
      <Card padded={false}>
        <div className="border-b border-line p-3">
          <Pills
            value={f.filter}
            onChange={(v) => setF({ filter: v })}
            options={[
              { value: "all", label: t("common.all") },
              { value: "unread", label: t("notifications.unread") },
            ]}
          />
        </div>
        {list.isLoading ? (
          <TableSkeleton cols={2} rows={6} />
        ) : list.error ? (
          <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
        ) : list.data!.results.length === 0 ? (
          <EmptyState title={t("notifications.reAllCaughtUp")} icon={<Bell className="h-7 w-7" />} />
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.results.map((n) => {
              const Icon = ICONS[n.kind] ?? Bell;
              return (
                <li key={n.id}>
                  <button
                    onClick={() => void open(n)}
                    className={clsx(
                      "flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-canvas",
                      !n.is_read && "bg-brand-50/50",
                    )}
                  >
                    <span
                      className={clsx(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                        n.kind === "task_overdue" ? "bg-bad-bg text-bad-fg" : "bg-brand-100 text-brand",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={clsx("block text-sm", !n.is_read && "font-semibold")}>{n.title}</span>
                      {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                      {relative(n.created_at)}
                      {!n.is_read && <span className="h-2 w-2 rounded-full bg-accent" aria-label={t("notifications.unread")} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {list.data && list.data.count > 0 && (
          <Pagination page={Number(f.page)} pageSize={PAGE_SIZE} count={list.data.count} onPage={(p) => setF({ page: String(p) }, false)} />
        )}
      </Card>
    </div>
  );
}
