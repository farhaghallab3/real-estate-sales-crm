"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { UserSelect } from "@/components/forms/pickers";
import { CommissionStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import {
  Card,
  EmptyState,
  ErrorState,
  Metric,
  PageHeader,
  Pagination,
  PersonChip,
  Pills,
  Table,
  TableSkeleton,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, money2 } from "@/lib/format";
import { useApiMutation, useCommissions, useCommissionSummary } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import type { Commission } from "@/types";

const PAGE_SIZE = 20;

function TermsModal({ commission, onClose }: { commission: Commission | null; onClose: () => void }) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset } = useForm<{
    commission_rate: string;
    agent_split: string;
    deductions: string;
  }>();
  useEffect(() => {
    if (commission) {
      setError(null);
      reset({
        commission_rate: commission.commission_rate,
        agent_split: commission.agent_split,
        deductions: commission.deductions,
      });
    }
  }, [commission, reset]);
  const save = useApiMutation((v: { commission_rate: string; agent_split: string; deductions: string }) =>
    api(`/commissions/${commission!.id}/terms/`, { method: "PATCH", body: v }),
  );
  return (
    <Modal
      open={Boolean(commission)}
      onClose={onClose}
      size="sm"
      title="Commission terms"
      description={commission ? `${commission.property.title} · ${commission.client}` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={handleSubmit(async (v) => {
              try {
                await save.mutateAsync(v);
                toast.success("Commission recalculated");
                onClose();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Could not update");
              }
            })}
          >
            Save & recalculate
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label="Commission rate (% of sale price)">
          <Input type="number" step="0.01" min={0} max={100} {...register("commission_rate")} />
        </Field>
        <Field label="Agent split (% of gross)">
          <Input type="number" step="0.01" min={0} max={100} {...register("agent_split")} />
        </Field>
        <Field label="Deductions (USD)">
          <Input type="number" step="0.01" min={0} {...register("deductions")} />
        </Field>
        <p className="text-xs text-muted">Amounts are calculated and stored by the server.</p>
      </div>
    </Modal>
  );
}

export default function CommissionsPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [f, setF] = useUrlState({ status: "", assigned: "", page: "1" });
  const [editing, setEditing] = useState<Commission | null>(null);
  const list = useCommissions({ status: f.status, salesperson: f.assigned, page: f.page, page_size: PAGE_SIZE });
  const summary = useCommissionSummary();

  const act = useApiMutation((v: { id: number; action: "approve" | "mark-paid" }) =>
    api(`/commissions/${v.id}/${v.action}/`, { method: "POST" }),
  );
  const run = async (id: number, action: "approve" | "mark-paid") => {
    try {
      await act.mutateAsync({ id, action });
      toast.success(action === "approve" ? "Commission approved" : "Marked as paid");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed");
    }
  };

  const s = summary.data;
  return (
    <div>
      <PageHeader
        title="Commissions"
        description={isManager ? "Team commissions — approve and pay out." : "Your commissions from closed deals."}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Pending (net)" value={money2(s?.pending.net ?? 0)} />
        <Metric label="Approved (net)" value={money2(s?.approved.net ?? 0)} />
        <Metric label="Paid (net)" value={money2(s?.paid.net ?? 0)} accent />
        <Metric
          label="Total gross"
          value={money2(Number(s?.pending.gross ?? 0) + Number(s?.approved.gross ?? 0) + Number(s?.paid.gross ?? 0))}
        />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Pills
            value={f.status}
            onChange={(v) => setF({ status: v })}
            options={[
              { value: "", label: "All" },
              { value: "pending", label: "Pending" },
              { value: "approved", label: "Approved" },
              { value: "paid", label: "Paid" },
            ]}
          />
          {isManager && (
            <UserSelect
              className="ml-auto w-48"
              value={f.assigned ? Number(f.assigned) : null}
              onChange={(id) => setF({ assigned: id ? String(id) : "" })}
              emptyLabel="All salespeople"
            />
          )}
        </div>
        {list.isLoading ? (
          <TableSkeleton cols={8} />
        ) : list.error ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : list.data!.results.length === 0 ? (
          <EmptyState title="No commissions yet" description="A commission is generated automatically when a deal is closed." />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Property</Th>
                  <Th>Client</Th>
                  {isManager && <Th>Salesperson</Th>}
                  <Th className="text-right">Sale price</Th>
                  <Th className="text-right">Rate</Th>
                  <Th className="text-right">Gross</Th>
                  <Th className="text-right">Split</Th>
                  <Th className="text-right">Agent</Th>
                  <Th className="text-right">Deductions</Th>
                  <Th className="text-right">Net</Th>
                  <Th>Status</Th>
                  <Th>Closed</Th>
                  {isManager && <Th />}
                </tr>
              </thead>
              <tbody>
                {list.data!.results.map((c) => (
                  <tr key={c.id} className="hover:bg-canvas/70">
                    <Td className="max-w-[220px] truncate">
                      <Link href={`/deals/${c.deal}`} className="font-medium hover:text-brand hover:underline">
                        {c.property.title}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Link href={`/leads/${c.lead_id}`} className="hover:underline">
                        {c.client}
                      </Link>
                    </Td>
                    {isManager && (
                      <Td className="whitespace-nowrap">
                        <PersonChip name={c.salesperson?.full_name} />
                      </Td>
                    )}
                    <Td className="tabular text-right">{money2(c.sale_price)}</Td>
                    <Td className="tabular text-right">{Number(c.commission_rate)}%</Td>
                    <Td className="tabular text-right">{money2(c.gross_commission)}</Td>
                    <Td className="tabular text-right">{Number(c.agent_split)}%</Td>
                    <Td className="tabular text-right">{money2(c.agent_commission)}</Td>
                    <Td className="tabular text-right">{money2(c.deductions)}</Td>
                    <Td className="tabular text-right font-semibold">{money2(c.net_commission)}</Td>
                    <Td>
                      <CommissionStatusBadge status={c.status} />
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(c.created_at)}</Td>
                    {isManager && (
                      <Td>
                        <div className="flex justify-end gap-1.5">
                          {c.status !== "paid" && (
                            <Button size="sm" onClick={() => setEditing(c)}>
                              Terms
                            </Button>
                          )}
                          {c.status === "pending" && (
                            <Button size="sm" variant="primary" onClick={() => void run(c.id, "approve")}>
                              Approve
                            </Button>
                          )}
                          {c.status === "approved" && (
                            <Button size="sm" variant="primary" onClick={() => void run(c.id, "mark-paid")}>
                              Mark paid
                            </Button>
                          )}
                        </div>
                      </Td>
                    )}
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
      <TermsModal commission={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
