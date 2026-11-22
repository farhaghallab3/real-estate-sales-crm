"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { UserSelect } from "@/components/forms/pickers";
import { OfferFormModal } from "@/components/forms/workflow-modals";
import { DealStageBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  PersonChip,
  Pills,
  SearchInput,
  Table,
  TableSkeleton,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";

import { useMoney, useFormat } from "@/lib/company";
import { useDeals } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useApiErrors } from "@/lib/use-api-errors";

const PAGE_SIZE = 20;

export default function DealsPage() {
  const enums = useEnums();
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const { money } = useMoney();
  const { formatDate, relative } = useFormat();
  const { isManager } = useAuth();
  const [f, setF] = useUrlState({ q: "", state: "open", stage: "", assigned: "", sort: "-updated_at", page: "1" });
  const [offerOpen, setOfferOpen] = useState(false);
  const list = useDeals({
    search: f.q,
    state: f.state === "all" ? "" : f.state,
    stage: f.stage,
    assigned_to: f.assigned,
    ordering: f.sort,
    page: f.page,
    page_size: PAGE_SIZE,
  });
  const onSort = (key: string) => setF({ sort: f.sort === key ? `-${key}` : key });

  return (
    <div>
      <PageHeader
        title={t("deals.deals")}
        description={t("deals.everyOpportunityFromFirstInterest")}
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOfferOpen(true)}>
            {t("common.createOffer")}</Button>
        }
      />
      <Card padded={false}>
        <div className="space-y-3 border-b border-line p-3">
          <Pills
            value={f.state}
            onChange={(v) => setF({ state: v, stage: "" })}
            options={[
              { value: "open", label: t("reports.open") },
              { value: "closed", label: t("common.closed") },
              { value: "lost", label: t("reports.lost") },
              { value: "all", label: t("common.all") },
            ]}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SearchInput value={f.q} onChange={(v) => setF({ q: v })} placeholder={t("common.searchClientOrProperty")} />
            <Select value={f.stage} onChange={(e) => setF({ stage: e.target.value })} aria-label={t("deals.stage")}>
              <option value="">{t("deals.allStages")}</option>
              {enums.options("dealStage").map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {isManager && (
              <UserSelect
                value={f.assigned ? Number(f.assigned) : null}
                onChange={(id) => setF({ assigned: id ? String(id) : "" })}
                emptyLabel={t("common.allSalespeople")}
                aria-label={t("common.salesperson")}
              />
            )}
          </div>
        </div>
        {list.isLoading ? (
          <TableSkeleton cols={7} />
        ) : list.error ? (
          <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
        ) : list.data!.results.length === 0 ? (
          <EmptyState title={t("deals.noDealsFound")} description={t("deals.dealsAppearWhenClientShows")} />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{t("common.client")}</Th>
                  <Th>{t("common.property")}</Th>
                  <Th>{t("deals.stage")}</Th>
                  <Th sortKey="offer_amount" sort={f.sort} onSort={onSort} className="text-end">{t("common.offer")}</Th>
                  <Th className="text-end">{t("common.salePrice")}</Th>
                  <Th sortKey="expected_close_date" sort={f.sort} onSort={onSort}>{t("common.expectedClose")}</Th>
                  <Th>{t("common.salesperson")}</Th>
                  <Th sortKey="updated_at" sort={f.sort} onSort={onSort}>{t("deals.updated")}</Th>
                </tr>
              </thead>
              <tbody>
                {list.data!.results.map((d) => (
                  <tr key={d.id} className="hover:bg-canvas/70">
                    <Td>
                      <Link href={`/deals/${d.id}`} className="font-medium hover:text-brand hover:underline">
                        {d.lead.name}
                      </Link>
                    </Td>
                    <Td className="max-w-[260px] truncate">{d.property.title}</Td>
                    <Td>
                      <DealStageBadge stage={d.stage} />
                    </Td>
                    <Td className="tabular text-end">{money(d.offer_amount)}</Td>
                    <Td className="tabular text-end">{money(d.sale_price)}</Td>
                    <Td className="whitespace-nowrap text-muted">{d.expected_close_date ? formatDate(d.expected_close_date) : "—"}</Td>
                    <Td className="whitespace-nowrap">
                      <PersonChip name={d.assigned_to?.full_name} />
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{relative(d.updated_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
        {list.data && list.data.count > 0 && (
          <Pagination page={Number(f.page)} pageSize={PAGE_SIZE} count={list.data.count} onPage={(p) => setF({ page: String(p) }, false)} />
        )}
      </Card>
      <OfferFormModal open={offerOpen} onClose={() => setOfferOpen(false)} />
    </div>
  );
}
