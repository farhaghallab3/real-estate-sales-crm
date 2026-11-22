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
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCompany, useMoney, useFormat } from "@/lib/company";
import { useApiMutation, useCommissions, useCommissionSummary } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import type { Commission } from "@/types";
import { useTranslations } from "next-intl";
import { useApiErrors } from "@/lib/use-api-errors";

const PAGE_SIZE = 20;

function TermsModal({ commission, onClose }: { commission: Commission | null; onClose: () => void }) {
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const toast = useToast();
  const { currency_code } = useCompany();
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
        commission_rate: commission.commission_rate ?? "",
        agent_split: commission.agent_split ?? "",
        deductions: commission.deductions ?? "",
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
      title={t("commissions.commissionTerms")}
      description={commission ? `${commission.property.title} · ${commission.client}` : undefined}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={handleSubmit(async (v) => {
              try {
                await save.mutateAsync(v);
                toast.success(t("commissions.commissionRecalculated"));
                onClose();
              } catch (e) {
                setError(errorText(e, t("common.couldNotUpdate")));
              }
            })}
          >
            {t("commissions.saveRecalculate")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label={t("commissions.commissionRateSalePrice")}>
          <Input type="number" step="0.01" min={0} max={100} {...register("commission_rate")} />
        </Field>
        <Field label={t("commissions.agentSplitGross")}>
          <Input type="number" step="0.01" min={0} max={100} {...register("agent_split")} />
        </Field>
        <Field label={t("commissions.deductionsCurrencyCode", { currency_code })}>
          <Input type="number" step="0.01" min={0} {...register("deductions")} />
        </Field>
        <p className="text-xs text-muted">{t("commissions.amountsCalculatedStoredByServer")}</p>
      </div>
    </Modal>
  );
}

export default function CommissionsPage() {
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const { money2 } = useMoney();
  const { formatDate } = useFormat();
  const { isManager, isAdmin } = useAuth();
  const showSplit = isAdmin || !isManager; // admins and salespeople (their own); never managers
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
      toast.success(action === "approve" ? t("commissions.commissionApproved") : t("commissions.markedAsPaid"));
    } catch (e) {
      toast.error(errorText(e, t("commissions.actionFailed")));
    }
  };

  const s = summary.data;
  return (
    <div>
      <PageHeader
        title={t("common.commissions")}
        description={
          isAdmin
            ? t("commissions.teamCommissionsApprovePayOut")
            : isManager
              ? t("commissions.teamCommissionsStatusNetValue")
              : t("commissions.commissionsFromClosedDeals")
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label={t("commissions.pendingNet")} value={money2(s?.pending.net ?? 0)} />
        <Metric label={t("commissions.approvedNet")} value={money2(s?.approved.net ?? 0)} />
        <Metric label={t("commissions.paidNet")} value={money2(s?.paid.net ?? 0)} accent />
        {isAdmin ? (
          <Metric
            label={t("commissions.totalGross")}
            value={money2(Number(s?.pending.gross ?? 0) + Number(s?.approved.gross ?? 0) + Number(s?.paid.gross ?? 0))}
          />
        ) : (
          <Metric
            label={t("commissions.totalNet")}
            value={money2(Number(s?.pending.net ?? 0) + Number(s?.approved.net ?? 0) + Number(s?.paid.net ?? 0))}
          />
        )}
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Pills
            value={f.status}
            onChange={(v) => setF({ status: v })}
            options={[
              { value: "", label: t("common.all") },
              { value: "pending", label: t("commissions.pending") },
              { value: "approved", label: t("commissions.approved") },
              { value: "paid", label: t("commissions.paid") },
            ]}
          />
          {isManager && (
            <UserSelect
              className="ms-auto w-48"
              value={f.assigned ? Number(f.assigned) : null}
              onChange={(id) => setF({ assigned: id ? String(id) : "" })}
              emptyLabel={t("common.allSalespeople")}
              aria-label={t("common.salesperson")}
            />
          )}
        </div>
        {list.isLoading ? (
          <TableSkeleton cols={8} />
        ) : list.error ? (
          <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
        ) : list.data!.results.length === 0 ? (
          <EmptyState title={t("commissions.noCommissionsYet")} description={t("commissions.commissionGeneratedAutomaticallyWhenDeal")} />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{t("common.property")}</Th>
                  <Th>{t("common.client")}</Th>
                  {isManager && <Th>{t("common.salesperson")}</Th>}
                  <Th className="text-end">{t("common.salePrice")}</Th>
                  {isAdmin && <Th className="text-end">{t("commissions.rate")}</Th>}
                  {isAdmin && <Th className="text-end">{t("commissions.gross")}</Th>}
                  {showSplit && <Th className="text-end">{t("common.split")}</Th>}
                  {isAdmin && <Th className="text-end">{t("commissions.agent")}</Th>}
                  {isAdmin && <Th className="text-end">{t("commissions.deductions")}</Th>}
                  <Th className="text-end">{t("commissions.net")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th>{t("common.closed")}</Th>
                  {isAdmin && <Th />}
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
                    <Td className="tabular text-end">{money2(c.sale_price)}</Td>
                    {isAdmin && <Td className="tabular text-end">{Number(c.commission_rate)}%</Td>}
                    {isAdmin && <Td className="tabular text-end">{money2(c.gross_commission)}</Td>}
                    {showSplit && <Td className="tabular text-end">{Number(c.agent_split)}%</Td>}
                    {isAdmin && <Td className="tabular text-end">{money2(c.agent_commission)}</Td>}
                    {isAdmin && <Td className="tabular text-end">{money2(c.deductions)}</Td>}
                    <Td className="tabular text-end font-semibold">{money2(c.net_commission)}</Td>
                    <Td>
                      <CommissionStatusBadge status={c.status} />
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(c.created_at)}</Td>
                    {isAdmin && (
                      <Td>
                        <div className="flex justify-end gap-1.5">
                          {c.status !== "paid" && (
                            <Button size="sm" onClick={() => setEditing(c)}>
                              {t("commissions.terms")}</Button>
                          )}
                          {c.status === "pending" && (
                            <Button size="sm" variant="primary" onClick={() => void run(c.id, "approve")}>
                              {t("commissions.approve")}</Button>
                          )}
                          {c.status === "approved" && (
                            <Button size="sm" variant="primary" onClick={() => void run(c.id, "mark-paid")}>
                              {t("commissions.markPaid")}</Button>
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
