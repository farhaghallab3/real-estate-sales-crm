"use client";

import { addDays, addHours, setMinutes } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DEAL_STAGE, optionsOf } from "@/lib/constants";
import { formatDateTime, fromLocalInput, money, toLocalInput } from "@/lib/format";
import { useApiMutation } from "@/lib/queries";
import type { Deal, DealStage, LeadMini, PropertyMini, Viewing, ViewingConflict } from "@/types";

import { LeadPicker, PropertyPicker, UserSelect } from "./pickers";

interface Ref {
  id: number;
  label: string;
}

const refOf = (l?: LeadMini | null): Ref | null => (l ? { id: l.id, label: l.name } : null);
const refOfProp = (p?: PropertyMini | null): Ref | null => (p ? { id: p.id, label: p.title } : null);

// ---- Schedule viewing -------------------------------------------------------------------------------
interface ViewingValues {
  start_at: string;
  duration: number;
  assigned_to_id: number | null;
}

export function ViewingFormModal({
  open,
  onClose,
  lead: presetLead,
  property: presetProperty,
  start,
}: {
  open: boolean;
  onClose: () => void;
  lead?: LeadMini | null;
  property?: PropertyMini | null;
  start?: Date;
}) {
  const { isManager, user } = useAuth();
  const toast = useToast();
  const [lead, setLead] = useState<Ref | null>(null);
  const [property, setProperty] = useState<Ref | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [missing, setMissing] = useState<{ lead?: boolean; property?: boolean }>({});
  const [conflicts, setConflicts] = useState<ViewingConflict[]>([]);
  const { register, handleSubmit, reset, control, watch } = useForm<ViewingValues>();

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setMissing({});
    setConflicts([]);
    setLead(refOf(presetLead));
    setProperty(refOfProp(presetProperty));
    reset({
      start_at: toLocalInput(start ?? setMinutes(addHours(new Date(), 2), 0)),
      duration: 60,
      assigned_to_id: user?.id ?? null,
    });
  }, [open, presetLead, presetProperty, start, reset, user?.id]);

  const startAt = watch("start_at");
  const duration = Number(watch("duration"));
  const assignee = watch("assigned_to_id");

  const range = (): { start_at: string; end_at: string } | null => {
    if (!startAt) return null;
    const s = new Date(startAt);
    if (Number.isNaN(s.getTime())) return null;
    return { start_at: s.toISOString(), end_at: new Date(s.getTime() + duration * 60_000).toISOString() };
  };

  // Live conflict preview (debounced).
  useEffect(() => {
    if (!open) return;
    const r = range();
    if (!r) return;
    const t = setTimeout(async () => {
      try {
        const res = await api<{ conflicts: ViewingConflict[] }>("/viewings/check-conflicts/", {
          method: "POST",
          body: { ...r, property_id: property?.id ?? null, assigned_to_id: (isManager ? assignee : user?.id) ?? null },
        });
        setConflicts(res.conflicts);
      } catch {
        /* preview only */
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startAt, duration, assignee, property?.id]);

  const create = useApiMutation((acknowledge: boolean) => {
    const r = range();
    if (!r || !lead || !property) throw new ApiError(400, { detail: "Missing fields" });
    return api<Viewing>("/viewings/", {
      method: "POST",
      body: {
        lead_id: lead.id,
        property_id: property.id,
        ...r,
        ...(isManager && assignee ? { assigned_to_id: assignee } : {}),
        acknowledge_conflicts: acknowledge,
      },
    });
  });

  const submit = (acknowledge: boolean) =>
    handleSubmit(async () => {
      setFormError(null);
      const m = { lead: !lead, property: !property };
      setMissing(m);
      if (m.lead || m.property) return;
      try {
        await create.mutateAsync(acknowledge);
        toast.success("Viewing scheduled");
        onClose();
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const data = e.data as { conflicts?: ViewingConflict[] };
          setConflicts(data.conflicts ?? []);
          setFormError("This time conflicts with another viewing. Review below or schedule anyway.");
        } else {
          setFormError(e instanceof ApiError ? e.message : "Could not schedule the viewing.");
        }
      }
    })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule viewing"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {conflicts.length > 0 ? (
            <Button variant="primary" loading={create.isPending} onClick={() => void submit(true)}>
              Schedule anyway
            </Button>
          ) : (
            <Button variant="primary" loading={create.isPending} onClick={() => void submit(false)}>
              Schedule viewing
            </Button>
          )}
        </>
      }
    >
      <form onSubmit={(e) => e.preventDefault()} className="grid gap-3 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <FormError message={formError} />
        </div>
        <Field label="Client" required className="sm:col-span-2" error={missing.lead ? "Select a client" : undefined}>
          <LeadPicker
            label={lead?.label ?? null}
            disabled={Boolean(presetLead)}
            invalid={missing.lead}
            onChange={(l) => setLead(l ? { id: l.id, label: l.name } : null)}
          />
        </Field>
        <Field label="Property" required className="sm:col-span-2" error={missing.property ? "Select a property" : undefined}>
          <PropertyPicker
            label={property?.label ?? null}
            disabled={Boolean(presetProperty)}
            invalid={missing.property}
            onChange={(p) => setProperty(p ? { id: p.id, label: p.title } : null)}
          />
        </Field>
        <Field label="Start" required>
          <Input type="datetime-local" {...register("start_at", { required: true })} />
        </Field>
        <Field label="Duration">
          <Select {...register("duration", { valueAsNumber: true })}>
            {[30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </Select>
        </Field>
        {isManager && (
          <Field label="Salesperson" className="sm:col-span-2">
            <Controller
              control={control}
              name="assigned_to_id"
              render={({ field }) => <UserSelect value={field.value} onChange={field.onChange} allowEmpty={false} />}
            />
          </Field>
        )}
        {conflicts.length > 0 && (
          <div className="rounded-md border border-warn-fg/25 bg-warn-bg p-3 text-xs text-warn-fg sm:col-span-2">
            <p className="mb-1 flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4" /> Scheduling conflict
            </p>
            <ul className="space-y-0.5">
              {conflicts.map((c) => (
                <li key={c.id}>
                  {formatDateTime(c.start_at)} — {c.lead} @ {c.property}
                  {c.assigned_to ? ` (${c.assigned_to})` : ""} ·{" "}
                  {c.reasons.map((r) => (r === "salesperson" ? "salesperson busy" : "property booked")).join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Modal>
  );
}

// ---- Complete viewing -----------------------------------------------------------------------------
export function CompleteViewingModal({
  viewing,
  onClose,
}: {
  viewing: Viewing | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [feedback, setFeedback] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFeedback("");
    setRating(null);
    setError(null);
  }, [viewing?.id]);

  const complete = useApiMutation(() =>
    api<Viewing>(`/viewings/${viewing!.id}/complete/`, { method: "POST", body: { feedback, rating } }),
  );

  return (
    <Modal
      open={Boolean(viewing)}
      onClose={onClose}
      title="Complete viewing"
      description={viewing ? `${viewing.lead.name} · ${viewing.property.title}` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={complete.isPending}
            onClick={async () => {
              try {
                await complete.mutateAsync();
                toast.success("Viewing completed — follow-up task created");
                onClose();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Failed to complete viewing");
              }
            }}
          >
            Mark completed
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label="Client interest">
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                aria-pressed={rating === n}
                className={`h-8 w-8 rounded-md border text-sm font-medium ${
                  rating === n ? "border-brand bg-brand text-white" : "border-line hover:bg-canvas"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Client feedback">
          <Textarea
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What did the client think? Objections, next steps…"
          />
        </Field>
        <p className="text-xs text-muted">A follow-up task is created automatically for tomorrow.</p>
      </div>
    </Modal>
  );
}

// ---- Create offer ---------------------------------------------------------------------------------
interface OfferValues {
  amount: string;
  conditions: string;
  expected_close_date: string;
  notes: string;
}

export function OfferFormModal({
  open,
  onClose,
  lead: presetLead,
  property: presetProperty,
}: {
  open: boolean;
  onClose: () => void;
  lead?: LeadMini | null;
  property?: PropertyMini | null;
}) {
  const toast = useToast();
  const [lead, setLead] = useState<Ref | null>(null);
  const [property, setProperty] = useState<Ref | null>(null);
  const [missing, setMissing] = useState<{ lead?: boolean; property?: boolean }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<OfferValues>();

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setMissing({});
    setLead(refOf(presetLead));
    setProperty(refOfProp(presetProperty));
    reset({
      amount: presetProperty ? String(Number(presetProperty.price)) : "",
      conditions: "",
      notes: "",
      expected_close_date: toLocalInput(addDays(new Date(), 45)).slice(0, 10),
    });
  }, [open, presetLead, presetProperty, reset]);

  const create = useApiMutation((v: OfferValues) =>
    api("/offers/", {
      method: "POST",
      body: {
        lead_id: lead!.id,
        property_id: property!.id,
        amount: v.amount,
        conditions: v.conditions,
        notes: v.notes,
        expected_close_date: v.expected_close_date || null,
      },
    }),
  );

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const m = { lead: !lead, property: !property };
    setMissing(m);
    if (m.lead || m.property) return;
    try {
      await create.mutateAsync(v);
      toast.success("Offer recorded — deal moved to Offer Made");
      onClose();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Could not record the offer.");
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create offer"
      description="Opens (or updates) the deal and moves it to Offer Made."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={onSubmit}>
            Record offer
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <FormError message={formError} />
        </div>
        <Field label="Client" required className="sm:col-span-2" error={missing.lead ? "Select a client" : undefined}>
          <LeadPicker
            label={lead?.label ?? null}
            disabled={Boolean(presetLead)}
            invalid={missing.lead}
            onChange={(l) => setLead(l ? { id: l.id, label: l.name } : null)}
          />
        </Field>
        <Field label="Property" required className="sm:col-span-2" error={missing.property ? "Select a property" : undefined}>
          <PropertyPicker
            label={property?.label ?? null}
            disabled={Boolean(presetProperty)}
            invalid={missing.property}
            onChange={(p) => setProperty(p ? { id: p.id, label: p.title } : null)}
          />
        </Field>
        <Field label="Offer amount (USD)" required error={errors.amount?.message}>
          <Input
            type="number"
            min={1}
            step={1000}
            {...register("amount", { required: "Amount is required", min: { value: 1, message: "Must be above zero" } })}
          />
        </Field>
        <Field label="Expected close date">
          <Input type="date" {...register("expected_close_date")} />
        </Field>
        <Field label="Conditions" className="sm:col-span-2">
          <Input placeholder="e.g. Subject to financing" {...register("conditions")} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} {...register("notes")} />
        </Field>
      </form>
    </Modal>
  );
}

// ---- Link property to a lead ------------------------------------------------------------------------
export function LinkPropertyModal({
  open,
  onClose,
  lead,
}: {
  open: boolean;
  onClose: () => void;
  lead: LeadMini;
}) {
  const toast = useToast();
  const [property, setProperty] = useState<Ref | null>(null);
  const [status, setStatus] = useState("suggested");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setProperty(null);
      setStatus("suggested");
      setNote("");
      setError(null);
    }
  }, [open]);

  const link = useApiMutation(() =>
    api("/lead-properties/", {
      method: "POST",
      body: { lead_id: lead.id, property_id: property!.id, status, note },
    }),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add property to client"
      description={`Match a property with ${lead.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!property}
            loading={link.isPending}
            onClick={async () => {
              try {
                await link.mutateAsync();
                toast.success("Property added");
                onClose();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Could not link the property.");
              }
            }}
          >
            Add property
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label="Property" required>
          <PropertyPicker
            label={property?.label ?? null}
            onChange={(p) => setProperty(p ? { id: p.id, label: p.title } : null)}
          />
        </Field>
        <Field label="Initial status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="suggested">Suggested</option>
            <option value="interested">Interested</option>
          </Select>
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  );
}

// ---- Deal stage change (lost reason / sale price) ---------------------------------------------------
export function StageChangeModal({
  deal,
  stage,
  onClose,
}: {
  deal: Deal | null;
  stage: DealStage | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason("");
    setPrice(deal?.offer_amount ? String(Number(deal.offer_amount)) : "");
    setError(null);
  }, [deal?.id, stage, deal?.offer_amount]);

  const move = useApiMutation(() =>
    api(`/deals/${deal!.id}/move/`, {
      method: "POST",
      body: {
        stage,
        ...(stage === "lost" ? { lost_reason: reason } : {}),
        ...(stage === "closed" ? { sale_price: price || null } : {}),
      },
    }),
  );

  const open = Boolean(deal && stage);
  const isLost = stage === "lost";
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={isLost ? "Mark deal as lost" : "Close deal"}
      description={deal ? `${deal.lead.name} · ${deal.property.title}` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={isLost ? "danger" : "primary"}
            loading={move.isPending}
            disabled={isLost ? !reason.trim() : !price}
            onClick={async () => {
              try {
                await move.mutateAsync();
                toast.success(isLost ? "Deal marked as lost" : "Deal closed — commission generated");
                onClose();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Could not move the deal.");
              }
            }}
          >
            {isLost ? "Mark lost" : "Close deal"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        {isLost ? (
          <Field label="Reason" required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        ) : (
          <>
            <Field label="Final sale price (USD)" required hint={deal?.offer_amount ? `Accepted offer: ${money(deal.offer_amount)}` : undefined}>
              <Input type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <p className="text-xs text-muted">
              Closing marks the property as sold, the client as closed and generates the commission.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

export function StageSelect({
  value,
  onChange,
  disabled,
}: {
  value: DealStage;
  onChange: (stage: DealStage) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as DealStage)} disabled={disabled} aria-label="Deal stage">
      {optionsOf(DEAL_STAGE).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
