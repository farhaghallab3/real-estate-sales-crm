"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { LEAD_STATUS, optionsOf } from "@/lib/constants";
import { useApiMutation } from "@/lib/queries";
import type { Lead, LeadMini, LeadProperty, LeadStatus, MatchStatus } from "@/types";

import { UserSelect } from "./pickers";

export function ChangeStatusModal({
  lead,
  onClose,
}: {
  lead: Pick<Lead, "id" | "name" | "status"> | null;
  onClose: () => void;
}) {
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
      title="Change status"
      description={lead?.name}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={lead?.status === status}
            onClick={async () => {
              try {
                await save.mutateAsync();
                toast.success("Status updated");
                onClose();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Could not update status");
              }
            }}
          >
            Update
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)}>
            {optionsOf(LEAD_STATUS).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {status === "lost" && (
          <Field label="Lost reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bought elsewhere" />
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
      title="Assign salesperson"
      description={lead?.name}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync();
                toast.success("Lead assigned");
                onClose();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Could not assign lead");
              }
            }}
          >
            Assign
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label="Salesperson">
          <UserSelect value={assignee} onChange={setAssignee} />
        </Field>
        <p className="text-xs text-muted">The new owner is notified and sees the lead in their workspace.</p>
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
      title="Add note"
      description={lead.name}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!body.trim()}
            onClick={async () => {
              try {
                await save.mutateAsync();
                toast.success("Note added");
                onClose();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Could not save note");
              }
            }}
          >
            Save note
          </Button>
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
          placeholder="Call summary, preferences, objections…"
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
      title="Reject property"
      description={match?.property.title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync();
                toast.success("Property marked as rejected");
                onClose();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Could not update");
              }
            }}
          >
            Reject
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label="Why did the client reject it?">
          <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Too expensive" />
        </Field>
      </div>
    </Modal>
  );
}
