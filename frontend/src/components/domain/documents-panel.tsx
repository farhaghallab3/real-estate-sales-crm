"use client";

import { CheckCircle2, Circle, Download, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, downloadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";

import { fileSize } from "@/lib/format";
import { useApiMutation, useChecklist, useDocuments } from "@/lib/queries";
import type { DocumentCategory, DocumentItem } from "@/types";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useFormat } from "@/lib/company";
import { useApiErrors } from "@/lib/use-api-errors";

export function useDeleteDocument() {
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const toast = useToast();
  const del = useApiMutation((d: DocumentItem) => api(`/documents/${d.id}/`, { method: "DELETE" }));
  return async (d: DocumentItem) => {
    if (!window.confirm(t("documents.confirmDelete", { name: d.name }))) return;
    try {
      await del.mutateAsync(d);
      toast.success(t("documents.documentDeleted"));
    } catch (e) {
      toast.error(errorText(e, t("documents.couldNotDelete")));
    }
  };
}

export function useUploadDocument() {
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const toast = useToast();
  const upload = useApiMutation((v: { dealId: number; category: DocumentCategory; file: File }) => {
    const form = new FormData();
    form.append("deal", String(v.dealId));
    form.append("category", v.category);
    form.append("file", v.file);
    return api<DocumentItem>("/documents/", { method: "POST", form });
  });
  return {
    pending: upload.isPending,
    run: async (dealId: number, category: DocumentCategory, file: File) => {
      try {
        await upload.mutateAsync({ dealId, category, file });
        toast.success(t("documents.documentUploaded"));
        return true;
      } catch (e) {
        toast.error(errorText(e, t("common.uploadFailed")));
        return false;
      }
    },
  };
}

/** `failedMessage` is the (already translated) text shown when the download fails. */
export async function safeDownload(d: DocumentItem, onError: (m: string) => void, failedMessage: string) {
  try {
    await downloadFile(`/documents/${d.id}/download/`, d.name);
  } catch {
    onError(failedMessage);
  }
}

export function DocumentRow({ doc, canDelete }: { doc: DocumentItem; canDelete: boolean }) {
  const t = useTranslations();
  const { formatDate } = useFormat();
  const toast = useToast();
  const del = useDeleteDocument();
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{doc.name}</p>
        <p className="text-xs text-muted">
          {doc.category_label} · {fileSize(doc.size)} · {doc.uploaded_by?.full_name ?? t("common.unknown")} · {formatDate(doc.created_at)}
        </p>
      </div>
      <Button size="sm" variant="ghost" aria-label={t("documents.downloadName", { name: doc.name })} onClick={() => void safeDownload(doc, toast.error, t("documents.downloadFailed"))}>
        <Download className="h-4 w-4" />
      </Button>
      {canDelete && (
        <Button size="sm" variant="ghost" aria-label={t("documents.deleteName", { name: doc.name })} onClick={() => void del(doc)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </li>
  );
}

/** Required-document checklist + upload + list for one deal. */
export function DealDocuments({ dealId }: { dealId: number }) {
  const enums = useEnums();
  const t = useTranslations();
  const { user, isManager } = useAuth();
  const checklist = useChecklist(dealId);
  const docs = useDocuments({ deal: dealId, page_size: 100 });
  const uploader = useUploadDocument();
  const [category, setCategory] = useState<DocumentCategory>("contract");
  const input = useRef<HTMLInputElement>(null);

  const missing = (checklist.data ?? []).filter((c) => c.required && !c.complete);

  return (
    <div>
      <div className="border-b border-line p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("documents.requiredDocuments")}</h3>
          <span className={missing.length ? "text-xs font-medium text-warn-fg" : "text-xs font-medium text-ok-fg"}>
            {missing.length ? `${missing.length} missing` : t("common.complete")}
          </span>
        </div>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {(checklist.data ?? []).map((c) => (
            <li key={c.category} className="flex items-center gap-2 text-sm">
              {c.complete ? (
                <CheckCircle2 className="h-4 w-4 text-ok-fg" />
              ) : (
                <Circle className={`h-4 w-4 ${c.required ? "text-warn-fg" : "text-muted/50"}`} />
              )}
              <span className={c.complete ? "" : c.required ? "font-medium" : "text-muted"}>{c.label}</span>
              {!c.required && <span className="text-2xs text-muted">optional</span>}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select
            className="w-52"
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentCategory)}
            aria-label={t("documents.documentCategory")}
          >
            {enums.options("documentCategory").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Button icon={<Upload className="h-4 w-4" />} loading={uploader.pending} onClick={() => input.current?.click()}>
            {t("documents.upload")}</Button>
          <input
            ref={input}
            type="file"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) await uploader.run(dealId, category, file);
            }}
          />
          <span className="text-2xs text-muted">{t("documents.pdfOfficeImagesOrText")}</span>
        </div>
      </div>
      {(docs.data?.results.length ?? 0) === 0 ? (
        <EmptyState title={t("documents.noDocumentsUploaded")} />
      ) : (
        <ul className="divide-y divide-line">
          {docs.data!.results.map((d) => (
            <DocumentRow key={d.id} doc={d} canDelete={isManager || d.uploaded_by?.id === user?.id} />
          ))}
        </ul>
      )}
    </div>
  );
}
