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
import { DOCUMENT_CATEGORY, optionsOf } from "@/lib/constants";
import { useDeals, useDocuments } from "@/lib/queries";
import { useUrlState } from "@/lib/use-url-state";
import type { DocumentCategory } from "@/types";

const PAGE_SIZE = 25;

function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const deals = useDeals({ page_size: 200, ordering: "-updated_at" }, open);
  const uploader = useUploadDocument();
  const [dealId, setDealId] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("contract");
  const file = useRef<HTMLInputElement>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload document"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
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
            Choose file & upload
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Deal" required>
          <Select value={dealId} onChange={(e) => setDealId(e.target.value)}>
            <option value="">Select a deal…</option>
            {deals.data?.results.map((d) => (
              <option key={d.id} value={d.id}>
                {d.lead.name} — {d.property.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
            {optionsOf(DOCUMENT_CATEGORY).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="File" hint="PDF, Word, Excel, image or text · max 10 MB">
          <input ref={file} type="file" className="block w-full text-sm" />
        </Field>
      </div>
    </Modal>
  );
}

export default function DocumentsPage() {
  const { user, isManager } = useAuth();
  const [f, setF] = useUrlState({ q: "", category: "", page: "1" });
  const [uploadOpen, setUploadOpen] = useState(false);
  const list = useDocuments({ search: f.q, category: f.category, page: f.page, page_size: PAGE_SIZE });

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Transaction documents across your deals. Open a deal to see its required-document checklist."
        actions={
          <Button variant="primary" icon={<Upload className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>
            Upload
          </Button>
        }
      />
      <Card padded={false}>
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={f.q} onChange={(v) => setF({ q: v })} placeholder="Search file, client or property…" />
          <Select value={f.category} onChange={(e) => setF({ category: e.target.value })} aria-label="Category">
            <option value="">All categories</option>
            {optionsOf(DOCUMENT_CATEGORY).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <TableSkeleton cols={3} rows={6} />
        ) : list.error ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : list.data!.results.length === 0 ? (
          <EmptyState title="No documents" description="Upload contracts, offers and IDs against a deal." />
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
