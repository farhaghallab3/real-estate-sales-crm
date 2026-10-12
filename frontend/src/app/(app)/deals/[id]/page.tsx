"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { DealDocuments } from "@/components/domain/documents-panel";
import { TaskRow } from "@/components/domain/task-list";
import { TaskFormModal } from "@/components/forms/task-form";
import { OfferFormModal, StageChangeModal, StageSelect } from "@/components/forms/workflow-modals";
import { CommissionStatusBadge, DealStageBadge, OfferStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Card, EmptyState, ErrorState, Kv, PersonChip, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { OFFER_STATUS, optionsOf } from "@/lib/constants";
import { formatDate, formatDateTime, money, money2 } from "@/lib/format";
import { useApiMutation, useDeal, useTasks } from "@/lib/queries";
import type { DealStage, Task } from "@/types";

export default function DealDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const toast = useToast();
  const deal = useDeal(id);
  const tasks = useTasks({ deal: id, page_size: 50, ordering: "due_at" });
  const [target, setTarget] = useState<DealStage | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const { register, handleSubmit, reset } = useForm<{ expected_close_date: string; notes: string }>();

  useEffect(() => {
    if (deal.data) reset({ expected_close_date: deal.data.expected_close_date ?? "", notes: deal.data.notes });
  }, [deal.data, reset]);

  const move = useApiMutation((stage: DealStage) => api(`/deals/${id}/move/`, { method: "POST", body: { stage } }));
  const save = useApiMutation((v: { expected_close_date: string; notes: string }) =>
    api(`/deals/${id}/`, {
      method: "PATCH",
      body: { expected_close_date: v.expected_close_date || null, notes: v.notes },
    }),
  );
  const setOffer = useApiMutation((v: { offerId: number; status: string }) =>
    api(`/offers/${v.offerId}/set-status/`, { method: "POST", body: { status: v.status } }),
  );

  if (deal.isLoading) return <Skeleton className="h-64" />;
  if (deal.error || !deal.data) return <ErrorState message={(deal.error as Error | null)?.message ?? "Deal not found"} />;
  const d = deal.data;
  const open = d.stage !== "closed" && d.stage !== "lost";

  const changeStage = async (stage: DealStage) => {
    if (stage === d.stage) return;
    if (stage === "lost" || stage === "closed") return setTarget(stage);
    try {
      await move.mutateAsync(stage);
      toast.success("Stage updated");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not move deal");
    }
  };

  return (
    <div className="space-y-4">
      <Link href="/pipeline" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Pipeline
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">
                <Link href={`/leads/${d.lead.id}`} className="hover:text-brand hover:underline">
                  {d.lead.name}
                </Link>
              </h1>
              <DealStageBadge stage={d.stage} />
            </div>
            <p className="mt-1 text-sm">
              <Link href={`/properties/${d.property.id}`} className="text-muted hover:text-brand hover:underline">
                {d.property.title} · {d.property.address}, {d.property.city}
              </Link>
            </p>
          </div>
          <div className="w-full sm:w-52">
            <Field label="Move to stage">
              <StageSelect value={d.stage} onChange={(s) => void changeStage(s)} disabled={d.stage === "closed"} />
            </Field>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-5">
          <Kv label="Asking price">{money(d.property.price)}</Kv>
          <Kv label="Offer amount">{money(d.offer_amount)}</Kv>
          <Kv label="Sale price">{money(d.sale_price)}</Kv>
          <Kv label="Expected close">{d.expected_close_date ? formatDate(d.expected_close_date) : ""}</Kv>
          <Kv label="Salesperson">
            <PersonChip name={d.assigned_to?.full_name} />
          </Kv>
        </dl>
        {d.stage === "lost" && d.lost_reason && (
          <p className="mt-3 rounded-md bg-bad-bg px-3 py-2 text-sm text-bad-fg">Lost: {d.lost_reason}</p>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card
            title="Offers"
            padded={false}
            action={
              open && (
                <Button size="sm" variant="primary" onClick={() => setOfferOpen(true)}>
                  Add offer
                </Button>
              )
            }
          >
            {d.offers.length === 0 ? (
              <EmptyState title="No offers yet" />
            ) : (
              <ul className="divide-y divide-line">
                {d.offers.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="tabular text-sm font-semibold">{money(o.amount)}</p>
                      <p className="text-xs text-muted">
                        {formatDateTime(o.created_at)} · {o.submitted_by?.full_name}
                        {o.conditions ? ` · ${o.conditions}` : ""}
                      </p>
                    </div>
                    <OfferStatusBadge status={o.status} />
                    {open && (
                      <Select
                        className="h-8 w-36 text-xs"
                        value={o.status}
                        aria-label="Offer status"
                        onChange={async (e) => {
                          try {
                            await setOffer.mutateAsync({ offerId: o.id, status: e.target.value });
                            toast.success("Offer updated");
                          } catch (err) {
                            toast.error(err instanceof ApiError ? err.message : "Could not update offer");
                          }
                        }}
                      >
                        {optionsOf(OFFER_STATUS).map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Documents" padded={false}>
            <DealDocuments dealId={id} />
          </Card>

          <Card
            title="Tasks"
            padded={false}
            action={
              <Button size="sm" onClick={() => setTaskOpen(true)}>
                Add task
              </Button>
            }
          >
            {(tasks.data?.results.length ?? 0) === 0 ? (
              <EmptyState title="No tasks on this deal" />
            ) : (
              <ul className="divide-y divide-line">
                {tasks.data!.results.map((t) => (
                  <TaskRow key={t.id} task={t} onEdit={setEditTask} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Commission">
            {d.commission ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Status</span>
                  <CommissionStatusBadge status={d.commission.status} />
                </div>
                {(
                  [
                    ["Sale price", money2(d.commission.sale_price)],
                    [`Rate (${Number(d.commission.commission_rate)}%)`, money2(d.commission.gross_commission)],
                    [`Agent split (${Number(d.commission.agent_split)}%)`, money2(d.commission.agent_commission)],
                    ["Deductions", `− ${money2(d.commission.deductions)}`],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between">
                    <span className="text-muted">{k}</span>
                    <span className="tabular">{v}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-line pt-2 text-base font-semibold">
                  <span>Net commission</span>
                  <span className="tabular">{money2(d.commission.net_commission)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Generated automatically when the deal is closed.</p>
            )}
          </Card>

          <Card title="Deal notes">
            <form
              className="space-y-3"
              onSubmit={handleSubmit(async (v) => {
                try {
                  await save.mutateAsync(v);
                  toast.success("Deal updated");
                } catch (e) {
                  toast.error(e instanceof ApiError ? e.message : "Could not save");
                }
              })}
            >
              <Field label="Expected close date">
                <Input type="date" disabled={!open} {...register("expected_close_date")} />
              </Field>
              <Field label="Notes">
                <Textarea rows={4} disabled={!open} {...register("notes")} />
              </Field>
              {open && (
                <Button type="submit" size="sm" loading={save.isPending}>
                  Save
                </Button>
              )}
            </form>
          </Card>
        </div>
      </div>

      <StageChangeModal deal={target ? d : null} stage={target} onClose={() => setTarget(null)} />
      <OfferFormModal open={offerOpen} lead={d.lead} property={d.property} onClose={() => setOfferOpen(false)} />
      <TaskFormModal
        open={taskOpen || Boolean(editTask)}
        task={editTask}
        preset={{ lead: d.lead, property: d.property, dealId: d.id }}
        onClose={() => {
          setTaskOpen(false);
          setEditTask(null);
        }}
      />
    </div>
  );
}
