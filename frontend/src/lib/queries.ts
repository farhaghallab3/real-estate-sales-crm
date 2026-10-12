"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import type {
  AnalyticsSummary,
  AppNotification,
  ChecklistItem,
  Commission,
  Dashboard,
  Deal,
  DealDetail,
  DocumentItem,
  Lead,
  LeadNote,
  LeadProperty,
  Activity,
  Offer,
  Paginated,
  PipelineColumn,
  Property,
  PropertyDetail,
  Task,
  User,
  Viewing,
} from "@/types";

type Params = Record<string, string | number | boolean | null | undefined>;

// ---- generic helpers -----------------------------------------------------------------------------
function useList<T>(key: string, path: string, params?: Params, enabled = true) {
  return useQuery({
    queryKey: [key, path, params ?? {}],
    queryFn: () => api<Paginated<T>>(path, { params }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

function useOne<T>(key: string, path: string, enabled = true) {
  return useQuery({ queryKey: [key, path], queryFn: () => api<T>(path), enabled });
}

/** Writes can touch many screens (dashboard, pipeline, lead timeline…); refetching active queries is cheap. */
export function useApiMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation<TResult, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
}

// ---- reads ----------------------------------------------------------------------------------------
export const useDashboard = (days: number) =>
  useQuery({ queryKey: ["dashboard", days], queryFn: () => api<Dashboard>("/dashboard/", { params: { days } }) });

export const useAnalytics = (params: Params) =>
  useQuery({
    queryKey: ["analytics", params],
    queryFn: () => api<AnalyticsSummary>("/analytics/summary/", { params }),
    placeholderData: keepPreviousData,
  });

export const useUsers = () =>
  useQuery({
    queryKey: ["users"],
    queryFn: () => api<User[]>("/users/"),
    staleTime: 5 * 60_000,
  });

export const useLeads = (params: Params, enabled = true) => useList<Lead>("leads", "/leads/", params, enabled);
export const useLead = (id: number) => useOne<Lead>("lead", `/leads/${id}/`);
export const useLeadStatusCounts = (params: Params) =>
  useQuery({
    queryKey: ["leads", "status-counts", params],
    queryFn: () => api<Record<string, number>>("/leads/status-counts/", { params }),
    placeholderData: keepPreviousData,
  });
export const useLeadNotes = (id: number) =>
  useQuery({ queryKey: ["lead-notes", id], queryFn: () => api<LeadNote[]>(`/leads/${id}/notes/`) });
export const useLeadTimeline = (id: number) =>
  useQuery({ queryKey: ["lead-timeline", id], queryFn: () => api<Activity[]>(`/leads/${id}/timeline/`) });

export const useProperties = (params: Params, enabled = true) =>
  useList<Property>("properties", "/properties/", params, enabled);
export const useProperty = (id: number) => useOne<PropertyDetail>("property", `/properties/${id}/`);

export const useCities = () =>
  useQuery({
    queryKey: ["cities"],
    queryFn: () => api<string[]>("/properties/cities/"),
    staleTime: 5 * 60_000,
  });

export const useMatches =(params: Params, enabled = true) =>
  useQuery({
    queryKey: ["matches", params],
    queryFn: () => api<LeadProperty[]>("/lead-properties/", { params }),
    enabled,
  });

export const useTasks = (params: Params, enabled = true) => useList<Task>("tasks", "/tasks/", params, enabled);
export const useViewings = (params: Params, enabled = true) =>
  useList<Viewing>("viewings", "/viewings/", params, enabled);

export const useDeals = (params: Params, enabled = true) => useList<Deal>("deals", "/deals/", params, enabled);
export const useDeal = (id: number) => useOne<DealDetail>("deal", `/deals/${id}/`);
export const usePipeline = (params: Params) =>
  useQuery({
    queryKey: ["pipeline", params],
    queryFn: () => api<{ columns: PipelineColumn[] }>("/deals/pipeline/", { params }),
    placeholderData: keepPreviousData,
  });
export const useChecklist = (dealId: number) =>
  useQuery({ queryKey: ["checklist", dealId], queryFn: () => api<ChecklistItem[]>(`/deals/${dealId}/checklist/`) });

export const useOffers = (params: Params, enabled = true) => useList<Offer>("offers", "/offers/", params, enabled);
export const useCommissions = (params: Params) => useList<Commission>("commissions", "/commissions/", params);
export const useCommissionSummary = () =>
  useQuery({
    queryKey: ["commission-summary"],
    queryFn: () => api<Record<string, { net: string; gross: string }>>("/commissions/summary/"),
  });
export const useDocuments = (params: Params, enabled = true) =>
  useList<DocumentItem>("documents", "/documents/", params, enabled);

export const useNotifications = (params: Params) =>
  useList<AppNotification>("notifications", "/notifications/", params);
export const useUnreadCount = () =>
  useQuery({
    queryKey: ["unread-count"],
    queryFn: () => api<{ count: number }>("/notifications/unread-count/"),
    refetchInterval: 60_000,
  });
