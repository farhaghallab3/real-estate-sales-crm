"use client";

import clsx from "clsx";
import { CalendarClock, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { UserSelect } from "@/components/forms/pickers";
import { OfferFormModal, StageChangeModal } from "@/components/forms/workflow-modals";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { ErrorState, PageHeader, PersonChip, SearchInput, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PIPELINE_STAGES } from "@/lib/constants";
import { useMoney, useFormat } from "@/lib/company";
import { useApiMutation, usePipeline } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import type { Deal, DealStage } from "@/types";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useApiErrors } from "@/lib/use-api-errors";

const TONE_BAR: Record<DealStage, string> = {
  interested: "bg-idle-fg/40",
  viewing: "bg-accent",
  offer_made: "bg-warn-fg/60",
  negotiation: "bg-warn-fg",
  under_contract: "bg-brand",
  closed: "bg-ok-fg",
  lost: "bg-bad-fg/70",
};

export default function PipelinePage() {
  const enums = useEnums();
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const { money, moneyCompact } = useMoney();
  const { formatDate } = useFormat();
  const { isManager } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [f, setF] = useUrlState({ q: "", assigned: "", mine: "" });
  const board = usePipeline({ search: f.q, assigned_to: f.assigned, mine: f.mine });
  const [dragId, setDragId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<DealStage | null>(null);
  const [pending, setPending] = useState<{ deal: Deal; stage: DealStage } | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);

  const move = useApiMutation((v: { deal: Deal; stage: DealStage }) =>
    api(`/deals/${v.deal.id}/move/`, { method: "POST", body: { stage: v.stage } }),
  );

  const requestMove = async (deal: Deal, stage: DealStage) => {
    if (deal.stage === stage) return;
    if (deal.stage === "closed") {
      toast.error(t("pipeline.closedDealsCanTMoved"));
      return;
    }
    if (stage === "lost" || stage === "closed") {
      setPending({ deal, stage });
      return;
    }
    try {
      await move.mutateAsync({ deal, stage });
      toast.success(t("pipeline.movedLabel", { label: enums.label("dealStage", stage) }));
    } catch (e) {
      toast.error(errorText(e, t("common.couldNotMoveDeal")));
    }
  };

  const columns = board.data?.columns ?? [];
  const byStage = new Map(columns.map((c) => [c.stage, c]));
  const allDeals = columns.flatMap((c) => c.deals);

  return (
    <div>
      <PageHeader
        title={t("common.salesPipeline")}
        description={t("pipeline.dragDealBetweenStagesOr")}
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOfferOpen(true)}>
            {t("common.createOffer")}</Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={f.q} onChange={(v) => setF({ q: v })} placeholder={t("common.searchClientOrProperty")} className="w-72 max-w-full" />
        {isManager && (
          <UserSelect
            className="w-48"
            value={f.assigned ? Number(f.assigned) : null}
            onChange={(id) => setF({ assigned: id ? String(id) : "" })}
            emptyLabel={t("common.allSalespeople")}
            aria-label={t("common.salesperson")}
          />
        )}
      </div>

      {board.error ? (
        <ErrorState message={errorText(board.error)} onRetry={() => void board.refetch()} />
      ) : board.isLoading ? (
        <div className="flex gap-3 overflow-x-auto">
          {PIPELINE_STAGES.map((s) => (
            <Skeleton key={s} className="h-80 w-72 shrink-0" />
          ))}
        </div>
      ) : (
        <div className="scrollbar-thin -mx-4 flex gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
          {PIPELINE_STAGES.map((stage) => {
            const col = byStage.get(stage);
            return (
              <section
                key={stage}
                aria-label={enums.label("dealStage", stage)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverStage(stage);
                }}
                onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverStage(null);
                  const deal = allDeals.find((d) => d.id === dragId);
                  setDragId(null);
                  if (deal) void requestMove(deal, stage);
                }}
                className={clsx(
                  "flex w-[17.5rem] shrink-0 flex-col rounded-lg border bg-brand-50 transition-colors",
                  overStage === stage ? "border-brand bg-brand-50" : "border-line",
                )}
              >
                <header className="px-3 pb-2 pt-3">
                  <div className="flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      <span className={clsx("h-2 w-2 rounded-full", TONE_BAR[stage])} />
                      {enums.label("dealStage", stage)}
                    </h2>
                    <span className="tabular rounded-full bg-surface px-2 text-xs text-muted">{col?.count ?? 0}</span>
                  </div>
                  <p className="tabular mt-0.5 text-xs text-muted">{moneyCompact(col?.value ?? 0)}</p>
                </header>
                <div className="flex min-h-[8rem] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {col?.deals.length === 0 && (
                    <p className="px-1 py-6 text-center text-xs text-muted/70">{t("pipeline.noDeals")}</p>
                  )}
                  {col?.deals.map((d) => (
                    <article
                      key={d.id}
                      draggable
                      onDragStart={() => setDragId(d.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStage(null);
                      }}
                      onClick={() => router.push(`/deals/${d.id}`)}
                      className={clsx(
                        "cursor-pointer rounded-md border border-line bg-surface p-2.5 shadow-card transition-shadow hover:shadow-pop",
                        dragId === d.id && "opacity-50",
                      )}
                    >
                      <p className="truncate text-sm font-medium">{d.lead.name}</p>
                      <Link
                        href={`/properties/${d.property.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate text-xs text-muted hover:underline"
                      >
                        {d.property.title}
                      </Link>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="tabular text-sm font-semibold">
                          {d.offer_amount ? money(d.offer_amount) : <span className="font-normal text-muted">{money(d.property.price)} ask</span>}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="min-w-0 truncate">
                          <PersonChip name={d.assigned_to?.full_name} />
                        </span>
                        {d.expected_close_date && (
                          <span className="inline-flex shrink-0 items-center gap-1" title={t("common.expectedClose")}>
                            <CalendarClock className="h-3 w-3" />
                            {formatDate(d.expected_close_date)}
                          </span>
                        )}
                      </div>
                      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={d.stage}
                          onChange={(e) => void requestMove(d, e.target.value as DealStage)}
                          disabled={d.stage === "closed"}
                          className="h-7 text-xs"
                          aria-label={t("pipeline.stageName", { name: d.lead.name })}
                        >
                          {PIPELINE_STAGES.map((s) => (
                            <option key={s} value={s}>
                              {enums.label("dealStage", s)}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </article>
                  ))}
                  {col && col.count > col.deals.length && (
                    <Link href={`/deals?stage=${stage}`} className="px-1 py-1 text-center text-xs text-brand hover:underline">
                      {t("pipeline.valueMore", { value: col.count - col.deals.length })}</Link>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <StageChangeModal deal={pending?.deal ?? null} stage={pending?.stage ?? null} onClose={() => setPending(null)} />
      <OfferFormModal open={offerOpen} onClose={() => setOfferOpen(false)} />
    </div>
  );
}
