"use client";

import {
  ArrowLeft,
  Building2,
  CalendarPlus,
  FilePlus2,
  ListPlus,
  MapPin,
  Pencil,
  Phone,
  StickyNote,
  Wallet,
  Mail,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { TaskRow } from "@/components/domain/task-list";
import { ViewingItem } from "@/components/domain/viewing-row";
import { AddNoteModal, AssignModal, ChangeStatusModal, MatchStatusModal } from "@/components/forms/lead-actions";
import { LeadFormModal } from "@/components/forms/lead-form";
import { TaskFormModal } from "@/components/forms/task-form";
import {
  CompleteViewingModal,
  LinkPropertyModal,
  OfferFormModal,
  ViewingFormModal,
} from "@/components/forms/workflow-modals";
import {
  DealStageBadge,
  LeadStatusBadge,
  MatchStatusBadge,
  OfferStatusBadge,
  PropertyStatusBadge,
} from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import {
  Avatar,
  Card,
  EmptyState,
  ErrorState,
  Kv,
  PersonChip,
  Skeleton,
  Tabs,
  Ltr,} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

import { useMoney, useFormat } from "@/lib/company";
import {
  useApiMutation,
  useDeals,
  useLead,
  useLeadNotes,
  useLeadTimeline,
  useMatches,
  useOffers,
  useTasks,
  useViewings,
} from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import type { LeadProperty, MatchStatus, Task, Viewing } from "@/types";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useApiErrors } from "@/lib/use-api-errors";

type Tab =
  | "overview" | "interested" | "rejected" | "viewings" | "offers" | "tasks" | "notes" | "timeline";

export default function LeadDetailPage() {
  const enums = useEnums();
  const tr = useTranslations();
  const { errorText } = useApiErrors();
  const { money } = useMoney();
  const { formatDate, formatDateTime, formatWhen, relative } = useFormat();
  const params = useParams<{ id: string }>();
  const leadId = Number(params.id);
  const { isManager } = useAuth();
  const toast = useToast();
  const [state, setState] = useUrlState({ tab: "overview" });
  const tab = state.tab as Tab;

  const leadQ = useLead(leadId);
  const matches = useMatches({ lead: leadId });
  const viewings = useViewings({ lead: leadId, page_size: 100, ordering: "-start_at" });
  const offers = useOffers({ lead: leadId, page_size: 100 });
  const tasks = useTasks({ lead: leadId, page_size: 100, ordering: "due_at" });
  const notes = useLeadNotes(leadId);
  const timeline = useLeadTimeline(leadId);
  const deals = useDeals({ lead: leadId, page_size: 50 });

  const [modal, setModal] = useState<
    "edit" | "status" | "assign" | "note" | "task" | "viewing" | "property" | "offer" | null
  >(null);
  const [viewingProperty, setViewingProperty] = useState<LeadProperty["property"] | null>(null);
  const [offerProperty, setOfferProperty] = useState<LeadProperty["property"] | null>(null);
  const [completing, setCompleting] = useState<Viewing | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [reject, setReject] = useState<LeadProperty | null>(null);

  const setMatch = useApiMutation((v: { id: number; status: MatchStatus; note?: string }) =>
    api(`/lead-properties/${v.id}/set-status/`, { method: "POST", body: { status: v.status, note: v.note ?? "" } }),
  );
  const unlink = useApiMutation((id: number) => api(`/lead-properties/${id}/`, { method: "DELETE" }));

  if (leadQ.isLoading) return <Skeleton className="h-64" />;
  if (leadQ.error || !leadQ.data)
    return <ErrorState message={errorText(leadQ.error, tr("leads.leadNotFound"))} />;
  const lead = leadQ.data;

  const all = matches.data ?? [];
  const interested = all.filter((m) => m.status !== "rejected");
  const rejected = all.filter((m) => m.status === "rejected");
  const openTasks = (tasks.data?.results ?? []).filter((t) => t.status === "pending");
  const nextViewing = (viewings.data?.results ?? [])
    .filter((v) => v.status === "scheduled")
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
  const activeDeals = (deals.data?.results ?? []).filter((d) => d.stage !== "closed" && d.stage !== "lost");

  const changeMatch = async (m: LeadProperty, status: MatchStatus) => {
    if (status === "rejected") return setReject(m);
    try {
      await setMatch.mutateAsync({ id: m.id, status });
      toast.success(tr("leads.propertyStatusUpdated"));
    } catch (e) {
      toast.error(errorText(e, tr("common.couldNotUpdate")));
    }
  };

  const MatchList = ({ items, emptyTitle }: { items: LeadProperty[]; emptyTitle: string }) =>
    {
  const tr = useTranslations();
  return items.length === 0 ? (
      <EmptyState
        title={emptyTitle}
        action={
          <Button variant="primary" icon={<ListPlus className="h-4 w-4" />} onClick={() => setModal("property")}>
            {tr("common.addProperty")}</Button>
        }
      />
    ) : (
      <ul className="divide-y divide-line">
        {items.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link href={`/properties/${m.property.id}`} className="block truncate text-sm font-medium hover:text-brand hover:underline">
                {m.property.title}
              </Link>
              <p className="mt-0.5 text-xs text-muted">
                {m.property.city} · {money(m.property.price)} · <PropertyStatusBadge status={m.property.status} />
              </p>
              {m.note && <p className="mt-1 text-xs text-muted">“{m.note}”</p>}
            </div>
            <MatchStatusBadge status={m.status} />
            <Select
              className="h-8 w-40 text-xs"
              value={m.status}
              onChange={(e) => void changeMatch(m, e.target.value as MatchStatus)}
              aria-label={tr("leads.matchStatus")}
            >
              {enums.options("matchStatus").map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {m.status !== "rejected" && m.status !== "purchased" && (
              <>
                <Button size="sm" onClick={() => { setViewingProperty(m.property); setModal("viewing"); }}>
                  {tr("leads.viewing")}</Button>
                <Button size="sm" onClick={() => { setOfferProperty(m.property); setModal("offer"); }}>
                  {tr("common.offer")}</Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (window.confirm(tr("leads.confirmRemoveProperty"))) await unlink.mutateAsync(m.id);
              }}
            >
              {tr("leads.remove")}</Button>
          </li>
        ))}
      </ul>
    );
};

  return (
    <div className="space-y-4">
      <Link href="/leads" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" /> {" "}{tr("common.leads")}</Link>

      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar name={lead.name} size={48} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold">{lead.name}</h1>
                <button onClick={() => setModal("status")} title={tr("leads.changeStatus")} className="rounded-full">
                  <LeadStatusBadge status={lead.status} />
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                  <Phone className="h-3.5 w-3.5" /> <Ltr>{lead.phone}</Ltr>
                </a>
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                    <Mail className="h-3.5 w-3.5" /> <Ltr>{lead.email}</Ltr>
                  </a>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5" /> {money(lead.budget)}
                </span>
                {lead.preferred_location && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> {lead.preferred_location}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-end text-xs text-muted">
            <p>{tr("common.salesperson")}</p>
            <button
              className="mt-0.5 text-sm text-ink hover:underline disabled:no-underline"
              disabled={!isManager}
              onClick={() => setModal("assign")}
            >
              <PersonChip name={lead.assigned_to?.full_name} />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
          <a
            href={`tel:${lead.phone}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-medium hover:bg-canvas"
          >
            <Phone className="h-3.5 w-3.5" /> {" "}{tr("leads.call")}</a>
          <Button size="sm" icon={<StickyNote className="h-3.5 w-3.5" />} onClick={() => setModal("note")}>
            {tr("leads.addNote")}</Button>
          <Button size="sm" icon={<ListPlus className="h-3.5 w-3.5" />} onClick={() => setModal("task")}>
            {tr("common.createTask")}</Button>
          <Button size="sm" icon={<CalendarPlus className="h-3.5 w-3.5" />} onClick={() => { setViewingProperty(null); setModal("viewing"); }}>
            {tr("common.scheduleViewing")}</Button>
          <Button size="sm" icon={<Building2 className="h-3.5 w-3.5" />} onClick={() => setModal("property")}>
            {tr("common.addProperty")}</Button>
          <Button size="sm" icon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={() => { setOfferProperty(null); setModal("offer"); }}>
            {tr("common.createOffer")}</Button>
          <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setModal("edit")}>
            {tr("common.edit")}</Button>
        </div>
      </Card>

      <Card padded={false}>
        <Tabs
          className="px-2"
          value={tab}
          onChange={(v) => setState({ tab: v })}
          tabs={[
            { value: "overview", label: tr("leads.overview") },
            { value: "interested", label: tr("leads.interestedProperties"), count: interested.length },
            { value: "rejected", label: tr("leads.rejected"), count: rejected.length },
            { value: "viewings", label: tr("common.viewings"), count: viewings.data?.count },
            { value: "offers", label: tr("common.offers"), count: offers.data?.count },
            { value: "tasks", label: tr("deals.tasks"), count: openTasks.length },
            { value: "notes", label: tr("common.notes"), count: notes.data?.length },
            { value: "timeline", label: tr("leads.timeline") },
          ]}
        />

        {tab === "overview" && (
          <div className="grid grid-cols-1 gap-6 p-4 lg:grid-cols-3">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:col-span-2">
              <Kv label={tr("common.leadSource")}>{enums.label("leadSource", lead.source)}</Kv>
              <Kv label={tr("leads.budget")}>{money(lead.budget)}</Kv>
              <Kv label={tr("leads.preferredLocation")}>{lead.preferred_location}</Kv>
              <Kv label={tr("common.status")}>
                <LeadStatusBadge status={lead.status} />
              </Kv>
              <Kv label={tr("common.assignedSalesperson")}>{lead.assigned_to?.full_name}</Kv>
              <Kv label={tr("common.created")}>{formatDate(lead.created_at)}</Kv>
              <Kv label={tr("leads.lastActivity")}>{lead.last_activity_at ? relative(lead.last_activity_at) : ""}</Kv>
              <Kv label={tr("leads.nextFollowUp")}>{lead.next_follow_up ? formatWhen(lead.next_follow_up) : ""}</Kv>
              {lead.status === "lost" && <Kv label={tr("leads.lostReason")}>{lead.lost_reason}</Kv>}
              <div className="col-span-2">
                <dt className="text-xs text-muted">{tr("leads.latestNote")}</dt>
                <dd className="mt-0.5 text-sm">
                  {notes.data?.[0] ? (
                    <>
                      {notes.data[0].body}{" "}
                      <span className="text-xs text-muted">
                        — {notes.data[0].author?.full_name}, {relative(notes.data[0].created_at)}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
            <div className="space-y-3 rounded-lg bg-canvas p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("leads.whereThingsStand")}</h3>
              <div className="text-sm">
                <p className="text-xs text-muted">{tr("common.activeDeals")}</p>
                {activeDeals.length === 0 ? (
                  <p className="text-muted">{tr("leads.noneYet")}</p>
                ) : (
                  activeDeals.map((d) => (
                    <Link key={d.id} href={`/deals/${d.id}`} className="mt-1 flex items-center justify-between gap-2 hover:underline">
                      <span className="truncate">{d.property.title}</span>
                      <DealStageBadge stage={d.stage} />
                    </Link>
                  ))
                )}
              </div>
              <div className="text-sm">
                <p className="text-xs text-muted">{tr("leads.nextViewing")}</p>
                <p>{nextViewing ? `${formatWhen(nextViewing.start_at)} · ${nextViewing.property.title}` : tr("leads.noneScheduled")}</p>
              </div>
              <div className="text-sm">
                <p className="text-xs text-muted">{tr("leads.openTasks")}</p>
                <p>{openTasks.length === 0 ? tr("leads.allClear") : `${openTasks.length} open`}</p>
              </div>
              <div className="text-sm">
                <p className="text-xs text-muted">{tr("leads.matchedProperties")}</p>
                <p>
                  {tr("leads.activeAndRejectedCounts", { active: interested.length, rejected: rejected.length })}</p>
              </div>
            </div>
          </div>
        )}

        {tab === "interested" && <MatchList items={interested} emptyTitle={tr("leads.noPropertiesSuggestedYet")} />}
        {tab === "rejected" && <MatchList items={rejected} emptyTitle={tr("leads.noRejectedProperties")} />}

        {tab === "viewings" &&
          ((viewings.data?.results.length ?? 0) === 0 ? (
            <EmptyState
              title={tr("leads.noViewingsYet")}
              action={<Button variant="primary" onClick={() => { setViewingProperty(null); setModal("viewing"); }}>{tr("common.scheduleViewing")}</Button>}
            />
          ) : (
            <ul className="divide-y divide-line">
              {viewings.data!.results.map((v) => (
                <ViewingItem key={v.id} viewing={v} showClient={false} showAssignee onComplete={setCompleting} />
              ))}
            </ul>
          ))}

        {tab === "offers" &&
          ((offers.data?.results.length ?? 0) === 0 ? (
            <EmptyState
              title={tr("leads.noOffersRecorded")}
              action={<Button variant="primary" onClick={() => { setOfferProperty(null); setModal("offer"); }}>{tr("common.createOffer")}</Button>}
            />
          ) : (
            <ul className="divide-y divide-line">
              {offers.data!.results.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="tabular text-sm font-semibold">{money(o.amount)}</p>
                    <Link href={`/deals/${o.deal}`} className="text-xs text-muted hover:underline">
                      {o.property.title} · {formatDateTime(o.created_at)}
                    </Link>
                    {o.conditions && <p className="text-xs text-muted">{o.conditions}</p>}
                  </div>
                  <OfferStatusBadge status={o.status} />
                </li>
              ))}
            </ul>
          ))}

        {tab === "tasks" &&
          ((tasks.data?.results.length ?? 0) === 0 ? (
            <EmptyState title={tr("leads.noTasks")} action={<Button variant="primary" onClick={() => setModal("task")}>{tr("common.createTask")}</Button>} />
          ) : (
            <ul className="divide-y divide-line">
              {tasks.data!.results
                .slice()
                .sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed"))
                .map((t) => (
                  <TaskRow key={t.id} task={t} onEdit={setEditTask} />
                ))}
            </ul>
          ))}

        {tab === "notes" && (
          <div>
            <div className="border-b border-line p-3">
              <Button size="sm" icon={<StickyNote className="h-3.5 w-3.5" />} onClick={() => setModal("note")}>
                {tr("leads.addNote")}</Button>
            </div>
            {(notes.data?.length ?? 0) === 0 ? (
              <EmptyState title={tr("leads.noNotesYet")} description={tr("leads.captureCallSummariesPreferencesHere")} />
            ) : (
              <ul className="divide-y divide-line">
                {notes.data!.map((n) => (
                  <li key={n.id} className="px-4 py-3">
                    <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                    <p className="mt-1 text-xs text-muted">
                      {n.author?.full_name ?? tr("common.unknown")} · {formatDateTime(n.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "timeline" &&
          ((timeline.data?.length ?? 0) === 0 ? (
            <EmptyState title={tr("common.noActivityYet")} />
          ) : (
            <ol className="relative space-y-0 px-4 py-3">
              {timeline.data!.map((a, i) => (
                <li key={a.id} className="relative flex gap-3 pb-4">
                  {i < timeline.data!.length - 1 && <span className="absolute start-[5px] top-3 h-full w-px bg-line" aria-hidden />}
                  <span className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-brand bg-surface" />
                  <div>
                    <p className="text-sm">{a.message}</p>
                    <p className="text-xs text-muted">
                      {a.actor?.full_name ?? tr("common.system")} · {formatDateTime(a.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ))}
      </Card>

      <LeadFormModal open={modal === "edit"} lead={lead} onClose={() => setModal(null)} />
      <ChangeStatusModal lead={modal === "status" ? lead : null} onClose={() => setModal(null)} />
      <AssignModal lead={modal === "assign" ? lead : null} onClose={() => setModal(null)} />
      <AddNoteModal lead={lead} open={modal === "note"} onClose={() => setModal(null)} />
      <TaskFormModal
        open={modal === "task" || Boolean(editTask)}
        task={editTask}
        preset={{ lead }}
        onClose={() => {
          setModal(null);
          setEditTask(null);
        }}
      />
      <ViewingFormModal
        open={modal === "viewing"}
        lead={lead}
        property={viewingProperty}
        onClose={() => setModal(null)}
      />
      <OfferFormModal open={modal === "offer"} lead={lead} property={offerProperty} onClose={() => setModal(null)} />
      <LinkPropertyModal open={modal === "property"} lead={lead} onClose={() => setModal(null)} />
      <CompleteViewingModal viewing={completing} onClose={() => setCompleting(null)} />
      <MatchStatusModal match={reject} status={reject ? "rejected" : null} onClose={() => setReject(null)} />
    </div>
  );
}
