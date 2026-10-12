from __future__ import annotations

from core.exceptions import BusinessRuleViolation
from core.models import Activity
from core.services import log_activity
from notifications.models import Notification
from notifications.services import notify

from .models import Lead, LeadNote, LeadProperty


def after_lead_created(lead: Lead, actor) -> None:
    log_activity(
        actor=actor, kind=Activity.Kind.LEAD_CREATED, message=f"Lead {lead.name} was added", lead=lead,
    )
    if lead.assigned_to:
        notify_assignment(lead, actor)


def notify_assignment(lead: Lead, actor) -> None:
    notify(
        [lead.assigned_to],
        kind=Notification.Kind.LEAD_ASSIGNED,
        title=f"New lead assigned: {lead.name}",
        body=f"{lead.get_source_display()} · {lead.preferred_location or 'no location'}",
        link=f"/leads/{lead.pk}",
        actor=actor,
    )


def assign_lead(lead: Lead, assignee, actor) -> Lead:
    if lead.assigned_to_id == getattr(assignee, "pk", None):
        return lead
    lead.assigned_to = assignee
    lead.save(update_fields=["assigned_to", "updated_at"])
    target = assignee.full_name if assignee else "nobody"
    log_activity(
        actor=actor, kind=Activity.Kind.LEAD_ASSIGNED, message=f"{lead.name} assigned to {target}", lead=lead
    )
    if assignee:
        notify_assignment(lead, actor)
    return lead


def change_status(lead: Lead, status: str, actor, lost_reason: str = "") -> Lead:
    if lead.status == status:
        return lead
    old = lead.get_status_display()
    lead.status = status
    lead.lost_reason = lost_reason if status == Lead.Status.LOST else ""
    lead.save(update_fields=["status", "lost_reason", "updated_at"])
    log_activity(
        actor=actor,
        kind=Activity.Kind.STATUS_CHANGED,
        message=f"{lead.name} moved from {old} to {lead.get_status_display()}",
        lead=lead,
    )
    return lead


def advance_lead_status(lead: Lead, status: str, actor) -> None:
    """Move a lead forward through the funnel only (never backwards, never out of closed/lost)."""
    order = [s for s, _ in Lead.Status.choices if s not in (Lead.Status.CLOSED, Lead.Status.LOST)]
    if lead.status not in order or status not in order:
        return
    if order.index(status) > order.index(lead.status):
        change_status(lead, status, actor)


def add_note(lead: Lead, body: str, actor) -> LeadNote:
    note = LeadNote.objects.create(lead=lead, author=actor, body=body)
    log_activity(actor=actor, kind=Activity.Kind.NOTE_ADDED, message=f"Note added: {body[:120]}", lead=lead)
    return note


def link_property(lead: Lead, prop, actor, status: str = LeadProperty.Status.SUGGESTED, note: str = "") -> LeadProperty:
    if LeadProperty.objects.filter(lead=lead, property=prop).exists():
        raise BusinessRuleViolation("This property is already linked to the lead.")
    match = LeadProperty.objects.create(lead=lead, property=prop, status=status, note=note, added_by=actor)
    log_activity(
        actor=actor,
        kind=Activity.Kind.PROPERTY_LINKED,
        message=f"{prop.title} suggested to {lead.name}",
        lead=lead,
        property=prop,
    )
    return match


def set_match_status(match: LeadProperty, status: str, actor, note: str = "") -> LeadProperty:
    old = match.get_status_display()
    match.status = status
    if note or status == LeadProperty.Status.REJECTED:
        match.note = note
    match.save(update_fields=["status", "note", "updated_at"])
    log_activity(
        actor=actor,
        kind=Activity.Kind.MATCH_CHANGED,
        message=f"{match.property.title}: {old} → {match.get_status_display()} for {match.lead.name}",
        lead=match.lead,
        property=match.property,
    )
    return match
