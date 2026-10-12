"use client";

import { ArrowLeft, Bath, BedDouble, Building2, ImagePlus, Maximize2, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";

import { ViewingItem } from "@/components/domain/viewing-row";
import { PropertyFormModal } from "@/components/forms/property-form";
import { CompleteViewingModal, ViewingFormModal } from "@/components/forms/workflow-modals";
import {
  DealStageBadge,
  MatchStatusBadge,
  OfferStatusBadge,
  PropertyStatusBadge,
} from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, ErrorState, Kv, PersonChip, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, mediaUrl } from "@/lib/api";
import { PROPERTY_TYPE } from "@/lib/constants";
import { formatDate, formatDateTime, money } from "@/lib/format";
import { useApiMutation, useProperty } from "@/lib/queries";
import type { Viewing } from "@/types";

export default function PropertyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const toast = useToast();
  const property = useProperty(id);
  const [editOpen, setEditOpen] = useState(false);
  const [viewingOpen, setViewingOpen] = useState(false);
  const [completing, setCompleting] = useState<Viewing | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = useApiMutation(async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    await api(`/properties/${id}/images/`, { method: "POST", form });
  });
  const removeImage = useApiMutation((imageId: number) =>
    api(`/properties/${id}/images/${imageId}/`, { method: "DELETE" }),
  );

  if (property.isLoading) return <Skeleton className="h-64" />;
  if (property.error || !property.data)
    return <ErrorState message={(property.error as Error | null)?.message ?? "Property not found"} />;
  const p = property.data;

  return (
    <div className="space-y-4">
      <Link href="/properties" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Properties
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{p.title}</h1>
              <PropertyStatusBadge status={p.status} />
            </div>
            <p className="mt-1 text-sm text-muted">
              {p.address}, {p.city} · {p.reference}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5"><BedDouble className="h-4 w-4" />{p.bedrooms} beds</span>
              <span className="inline-flex items-center gap-1.5"><Bath className="h-4 w-4" />{p.bathrooms} baths</span>
              <span className="inline-flex items-center gap-1.5"><Maximize2 className="h-4 w-4" />{p.area_sqm ? `${Number(p.area_sqm)} m²` : "—"}</span>
              <span>{PROPERTY_TYPE[p.property_type]}</span>
            </div>
          </div>
          <div className="text-right">
            <p className="tabular text-2xl font-semibold">{money(p.price)}</p>
            <p className="mt-0.5 text-xs text-muted">Listed {formatDate(p.created_at)}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
          <Button size="sm" variant="primary" onClick={() => setViewingOpen(true)}>
            Schedule viewing
          </Button>
          <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button size="sm" icon={<ImagePlus className="h-3.5 w-3.5" />} loading={upload.isPending} onClick={() => fileInput.current?.click()}>
            Add image
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                await upload.mutateAsync(file);
                toast.success("Image uploaded");
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Upload failed");
              }
            }}
          />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title={`Interested leads (${p.interested_leads.length})`} padded={false}>
            {p.interested_leads.length === 0 ? (
              <EmptyState title="No leads matched yet" description="Add this property from a lead profile." />
            ) : (
              <ul className="divide-y divide-line">
                {p.interested_leads.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/leads/${m.lead.id}`} className="text-sm font-medium hover:text-brand hover:underline">
                        {m.lead.name}
                      </Link>
                      <p className="text-xs text-muted">
                        {m.lead.phone}
                        {m.assigned_to ? ` · ${m.assigned_to.full_name}` : ""}
                        {m.note ? ` · “${m.note}”` : ""}
                      </p>
                    </div>
                    <MatchStatusBadge status={m.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Viewings (${p.viewings.length})`} padded={false}>
            {p.viewings.length === 0 ? (
              <EmptyState title="No viewings" />
            ) : (
              <ul className="divide-y divide-line">
                {p.viewings.map((v) => (
                  <ViewingItem key={v.id} viewing={v} showProperty={false} showAssignee onComplete={setCompleting} />
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Offers (${p.offers.length})`} padded={false}>
            {p.offers.length === 0 ? (
              <EmptyState title="No offers" />
            ) : (
              <ul className="divide-y divide-line">
                {p.offers.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <div>
                      <p className="tabular text-sm font-semibold">{money(o.amount)}</p>
                      <Link href={`/leads/${o.lead.id}`} className="text-xs text-muted hover:underline">
                        {o.lead.name} · {formatDateTime(o.created_at)}
                      </Link>
                    </div>
                    <OfferStatusBadge status={o.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Kv label="Salesperson">
                <PersonChip name={p.assigned_to?.full_name} />
              </Kv>
              <Kv label="Type">{PROPERTY_TYPE[p.property_type]}</Kv>
              <Kv label="Location">{p.city}</Kv>
              <Kv label="Status">
                <PropertyStatusBadge status={p.status} />
              </Kv>
              <div className="col-span-2">
                <Kv label="Internal notes">{p.description}</Kv>
              </div>
            </dl>
          </Card>

          <Card title="Open deals" padded={false}>
            {p.open_deals.length === 0 ? (
              <EmptyState title="No open deals" />
            ) : (
              <ul className="divide-y divide-line">
                {p.open_deals.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <Link href={`/deals/${d.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                      {d.lead.name}
                    </Link>
                    <DealStageBadge stage={d.stage} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Images (${p.images.length})`}>
            {p.images.length === 0 ? (
              <div className="flex flex-col items-center gap-1 py-4 text-muted">
                <Building2 className="h-7 w-7 opacity-50" />
                <p className="text-xs">No images uploaded</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {p.images.map((img) => (
                  <div key={img.id} className="group relative aspect-square overflow-hidden rounded-md bg-canvas">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaUrl(img.src)} alt={img.caption || p.title} className="h-full w-full object-cover" />
                    <button
                      className="absolute right-1 top-1 hidden rounded bg-ink/70 p-1 text-white group-hover:block"
                      aria-label="Remove image"
                      onClick={() => void removeImage.mutateAsync(img.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <PropertyFormModal open={editOpen} property={p} onClose={() => setEditOpen(false)} />
      <ViewingFormModal open={viewingOpen} property={p} onClose={() => setViewingOpen(false)} />
      <CompleteViewingModal viewing={completing} onClose={() => setCompleting(null)} />
    </div>
  );
}
