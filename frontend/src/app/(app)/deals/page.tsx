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
import { DEAL_STAGE, optionsOf } from "@/lib/constants";
import { formatDate, money, relative } from "@/lib/format";
import { useDeals } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";

const PAGE_SIZE = 20;

export default function DealsPage() {
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
        title="Deals"
        description="Every opportunity from first interest to closing."
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOfferOpen(true)}>
            Create offer
          </Button>
        }
      />
      <Card padded={false}>
        <div className="space-y-3 border-b border-line p-3">
          <Pills
            value={f.state}
            onChange={(v) => setF({ state: v, stage: "" })}
            options={[
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
              { value: "lost", label: "Lost" },
              { value: "all", label: "All" },
            ]}
          />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SearchInput value={f.q} onChange={(v) => setF({ q: v })} placeholder="Search client or property…" />
            <Select value={f.stage} onChange={(e) => setF({ stage: e.target.value })} aria-label="Stage">
              <option value="">All stages</option>
              {optionsOf(DEAL_STAGE).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {isManager && (
              <UserSelect
                value={f.assigned ? Number(f.assigned) : null}
                onChange={(id) => setF({ assigned: id ? String(id) : "" })}
                emptyLabel="All salespeople"
              />
            )}
          </div>
        </div>
        {list.isLoading ? (
          <TableSkeleton cols={7} />
        ) : list.error ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : list.data!.results.length === 0 ? (
          <EmptyState title="No deals found" description="Deals appear when a client shows interest in a property." />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Client</Th>
                  <Th>Property</Th>
                  <Th>Stage</Th>
                  <Th sortKey="offer_amount" sort={f.sort} onSort={onSort} className="text-right">Offer</Th>
                  <Th className="text-right">Sale price</Th>
                  <Th sortKey="expected_close_date" sort={f.sort} onSort={onSort}>Expected close</Th>
                  <Th>Salesperson</Th>
                  <Th sortKey="updated_at" sort={f.sort} onSort={onSort}>Updated</Th>
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
                    <Td className="tabular text-right">{money(d.offer_amount)}</Td>
                    <Td className="tabular text-right">{money(d.sale_price)}</Td>
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
