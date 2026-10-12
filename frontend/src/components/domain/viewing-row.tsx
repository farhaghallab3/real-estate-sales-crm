"use client";

import { Check, X } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ViewingStatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { formatTime, formatWhen } from "@/lib/format";
import { useApiMutation } from "@/lib/queries";
import type { Viewing } from "@/types";

export function useCancelViewing() {
  const toast = useToast();
  const cancel = useApiMutation((v: Viewing) => api(`/viewings/${v.id}/cancel/`, { method: "POST", body: {} }));
  return async (viewing: Viewing) => {
    if (!window.confirm(`Cancel the viewing with ${viewing.lead.name}?`)) return;
    try {
      await cancel.mutateAsync(viewing);
      toast.success("Viewing cancelled");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not cancel");
    }
  };
}

export function ViewingItem({
  viewing,
  onComplete,
  showClient = true,
  showProperty = true,
  showAssignee = false,
}: {
  viewing: Viewing;
  onComplete: (v: Viewing) => void;
  showClient?: boolean;
  showProperty?: boolean;
  showAssignee?: boolean;
}) {
  const cancel = useCancelViewing();
  const scheduled = viewing.status === "scheduled";
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium tabular">
            {formatWhen(viewing.start_at)} – {formatTime(viewing.end_at)}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {showClient && (
              <Link href={`/leads/${viewing.lead.id}`} className="text-brand hover:underline">
                {viewing.lead.name}
              </Link>
            )}
            {showClient && showProperty && " · "}
            {showProperty && (
              <Link href={`/properties/${viewing.property.id}`} className="hover:underline">
                {viewing.property.title}
              </Link>
            )}
            {showAssignee && viewing.assigned_to && ` · ${viewing.assigned_to.full_name}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewingStatusBadge status={viewing.status} />
          {scheduled && (
            <>
              <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={() => onComplete(viewing)}>
                Complete
              </Button>
              <Button size="sm" variant="ghost" className="px-2" onClick={() => void cancel(viewing)} aria-label="Cancel viewing">
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
      {(viewing.feedback || viewing.rating) && (
        <p className="mt-2 rounded-md bg-canvas px-2.5 py-1.5 text-xs text-muted">
          {viewing.rating ? <span className="font-medium text-ink">Interest {viewing.rating}/5 · </span> : null}
          {viewing.feedback}
        </p>
      )}
    </li>
  );
}
