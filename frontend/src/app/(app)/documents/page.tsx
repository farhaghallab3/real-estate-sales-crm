"use client";

import { Upload } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { DocumentRow, useUploadDocument } from "@/components/domain/documents-panel";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  TableSkeleton,
} from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";

import { useDeals, useDocuments } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import type { DocumentCategory } from "@/types";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useApiErrors } from "@/lib/use-api-errors";

const PAGE_SIZE = 25;

function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const enums = useEnums();
  const t = useTranslations();
  const deals = useDeals({ page_size: 200, ordering: "-updated_at" }, open);
  const uploader = useUploadDocument();
  const [dealId, setDealId] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("contract");
  const file = useRef<HTMLInputElement>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("documents.uploadDocument")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={uploader.pending}
            disabled={!dealId}
            onClick={async () => {
              const selected = file.current?.files?.[0];
              if (!selected) return file.current?.click();
              if (await uploader.run(Number(dealId), category, selected)) onClose();
            }}
          >
            {t("documents.chooseFileUpload")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("documents.deal")} required>
          <Select value={dealId} onChange={(e) => setDealId(e.target.value)}>
            <option value="">{t("documents.selectDeal")}</option>
            {deals.data?.results.map((d) => (
              <option key={d.id} value={d.id}>
                {d.lead.name} — {d.property.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("documents.category")}>
          <Select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
            {enums.options("documentCategory").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("documents.file")} hint={t("documents.pdfWordExcelImageOr")}>
          <input ref={file} type="file" className="block w-full text-sm" />
        </Field>
      </div>
    </Modal>
  );
}

export default function DocumentsPage() {
  const enums = useEnums();
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const { user, isManager } = useAuth();
  const [f, setF] = useUrlState({ q: "", category: "", page: "1" });
  const [uploadOpen, setUploadOpen] = useState(false);
  const list = useDocuments({ search: f.q, category: f.category, page: f.page, page_size: PAGE_SIZE });

  return (
    <div>
      <PageHeader
        title={t("common.documents")}
        description={t("documents.transactionDocumentsAcrossDealsOpen")}
        actions={
          <Button variant="primary" icon={<Upload className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>
            {t("documents.upload")}</Button>
        }
      />
      <Card padded={false}>
        <div className="grid grid-cols-1 gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={f.q} onChange={(v) => setF({ q: v })} placeholder={t("documents.searchFileClientOrProperty")} />
          <Select value={f.category} onChange={(e) => setF({ category: e.target.value })} aria-label={t("documents.category")}>
            <option value="">{t("documents.allCategories")}</option>
            {enums.options("documentCategory").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <TableSkeleton cols={3} rows={6} />
        ) : list.error ? (
          <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
        ) : list.data!.results.length === 0 ? (
          <EmptyState title={t("documents.noDocuments")} description={t("documents.uploadContractsOffersIdsAgainst")} />
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.results.map((d) => (
              <div key={d.id}>
                <DocumentRow doc={d} canDelete={isManager || d.uploaded_by?.id === user?.id} />
                <p className="-mt-2 px-4 pb-2.5 text-xs">
                  <Link href={`/deals/${d.deal}`} className="text-brand hover:underline">
                    {d.deal_label}
                  </Link>
                </p>
              </div>
            ))}
          </ul>
        )}
        {list.data && list.data.count > 0 && (
          <Pagination page={Number(f.page)} pageSize={PAGE_SIZE} count={list.data.count} onPage={(p) => setF({ page: String(p) }, false)} />
        )}
      </Card>
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
