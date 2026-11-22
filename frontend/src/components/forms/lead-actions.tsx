"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";

import { useApiMutation } from "@/lib/queries";
import type { Lead, LeadMini, LeadProperty, LeadStatus, MatchStatus } from "@/types";

import { UserSelect } from "./pickers";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useApiErrors } from "@/lib/use-api-errors";

export function ChangeStatusModal({
  lead,
  onClose,
}: {
  lead: Pick<Lead, "id" | "name" | "status"> | null;
  onClose: () => void;
}) {
  const enums = useEnums();
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const toast = useToast();
  const [status, setStatus] = useState<LeadStatus>("new");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lead) {
      setStatus(lead.status);
      setReason("");
      setError(null);
    }
  }, [lead]);

  const save = useApiMutation(() =>
    api(`/leads/${lead!.id}/change-status/`, {
      method: "POST",
      body: { status, lost_reason: status === "lost" ? reason : "" },
    }),
  );

  return (
    <Modal
      open={Boolean(lead)}
      onClose={onClose}
      size="sm"
      title={t("leads.changeStatus")}
      description={lead?.name}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={lead?.status === status}
            onClick={async () => {
              try {
                await save.mutateAsync();
                toast.success(t("leads.statusUpdated"));
                onClose();
              } catch (e) {
                setError(errorText(e, t("leads.couldNotUpdateStatus")));
              }
            }}
          >
            {t("leads.update")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label={t("common.status")}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)}>
            {enums.options("leadStatus").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {status === "lost" && (
          <Field label={t("leads.lostReason")}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("leads.eGBoughtElsewhere")} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

export function AssignModal({
  lead,
  onClose,
}: {
  lead: Pick<Lead, "id" | "name" | "assigned_to"> | null;
  onClose: () => void;
}) {
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const toast = useToast();
  const [assignee, setAssignee] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lead) {
      setAssignee(lead.assigned_to?.id ?? null);
      setError(null);
    }
  }, [lead]);

  const save = useApiMutation(() =>
    api(`/leads/${lead!.id}/assign/`, { method: "POST", body: { assigned_to_id: assignee } }),
  );

  return (
    <Modal
      open={Boolean(lead)}
      onClose={onClose}
      size="sm"
      title={t("leads.assignSalesperson")}
      description={lead?.name}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync();
                toast.success(t("leads.leadAssigned"));
                onClose();
              } catch (e) {
                setError(errorText(e, t("leads.couldNotAssignLead")));
              }
            }}
          >
            {t("leads.assign")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label={t("common.salesperson")}>
          <UserSelect value={assignee} onChange={setAssignee} />
        </Field>
        <p className="text-xs text-muted">{t("leads.newOwnerNotifiedSeesLead")}</p>
      </div>
    </Modal>
  );
}

export function AddNoteModal({
  lead,
  open,
  onClose,
}: {
  lead: LeadMini;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBody("");
      setError(null);
    }
  }, [open]);

  const save = useApiMutation(() => api(`/leads/${lead.id}/notes/`, { method: "POST", body: { body } }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("leads.addNote")}
      description={lead.name}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!body.trim()}
            onClick={async () => {
              try {
                await save.mutateAsync();
                toast.success(t("leads.noteAdded"));
                onClose();
              } catch (e) {
                setError(errorText(e, t("leads.couldNotSaveNote")));
              }
            }}
          >
            {t("leads.saveNote")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Textarea
          autoFocus
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("leads.callSummaryPreferencesObjections")}
        />
      </div>
    </Modal>
  );
}

/** Change a lead↔property match status; rejection asks for a reason. */
export function MatchStatusModal({
  match,
  status,
  onClose,
}: {
  match: LeadProperty | null;
  status: MatchStatus | null;
  onClose: () => void;
}) {
  const t = useTranslations();
  const { errorText } = useApiErrors();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote("");
    setError(null);
  }, [match?.id, status]);

  const save = useApiMutation(() =>
    api(`/lead-properties/${match!.id}/set-status/`, { method: "POST", body: { status, note } }),
  );

  return (
    <Modal
      open={Boolean(match && status)}
      onClose={onClose}
      size="sm"
      title={t("leads.rejectProperty")}
      description={match?.property.title}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            loading={save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync();
                toast.success(t("leads.propertyMarkedAsRejected"));
                onClose();
              } catch (e) {
                setError(errorText(e, t("common.couldNotUpdate")));
              }
            }}
          >
            {t("leads.reject")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label={t("leads.whyDidClientRejectIt")}>
          <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("leads.eGTooExpensive")} />
        </Field>
      </div>
    </Modal>
  );
}
