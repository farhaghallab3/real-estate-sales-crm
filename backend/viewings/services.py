from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from core.exceptions import BusinessRuleViolation
from core.models import Activity
from core.services import log_activity
from notifications.models import Notification
from notifications.services import notify

from .models import Viewing


def find_conflicts(start, end, assigned_to_id=None, property_id=None, exclude_id=None) -> list[dict]:
    """Scheduled viewings that overlap [start, end) for the same salesperson or the same property."""
    who = Q()
    if assigned_to_id:
        who |= Q(assigned_to_id=assigned_to_id)
    if property_id:
        who |= Q(property_id=property_id)
    if not who:
        return []
    qs = (
        Viewing.objects.filter(who, status=Viewing.Status.SCHEDULED, start_at__lt=end, end_at__gt=start)
        .select_related("lead", "property", "assigned_to")
        .order_by("start_at")
    )
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    conflicts = []
    for v in qs:
        reasons = []
        if assigned_to_id and v.assigned_to_id == assigned_to_id:
            reasons.append("salesperson")
        if property_id and v.property_id == property_id:
            reasons.append("property")
        conflicts.append(
            {
                "id": v.pk,
                "start_at": v.start_at,
                "end_at": v.end_at,
                "lead": v.lead.name,
                "property": v.property.title,
                "assigned_to": v.assigned_to.full_name if v.assigned_to else None,
                "reasons": reasons,
            }
        )
    return conflicts


def after_viewing_scheduled(viewing: Viewing, actor) -> None:
    from deals import services as deal_services
    from leads import services as lead_services
    from leads.models import Lead, LeadProperty

    when = timezone.localtime(viewing.start_at)
    log_activity(
        actor=actor,
        kind=Activity.Kind.VIEWING_SCHEDULED,
        message=f"Viewing scheduled: {viewing.lead.name} at {viewing.property.title} on {when:%b %d, %H:%M}",
        lead=viewing.lead,
        property=viewing.property,
    )
    # Keep the match, lead funnel and pipeline in sync with the new viewing.
    match, _ = LeadProperty.objects.get_or_create(
        lead=viewing.lead, property=viewing.property, defaults={"added_by": actor}
    )
    if match.status in (LeadProperty.Status.SUGGESTED, LeadProperty.Status.INTERESTED, LeadProperty.Status.REJECTED):
        lead_services.set_match_status(match, LeadProperty.Status.VIEWING_SCHEDULED, actor)
    lead_services.advance_lead_status(viewing.lead, Lead.Status.VIEWING, actor)
    deal_services.on_viewing_scheduled(viewing, actor)
    notify(
        [viewing.assigned_to],
        kind=Notification.Kind.VIEWING_CREATED,
        title=f"Viewing scheduled: {viewing.property.title}",
        body=f"{viewing.lead.name} · {when:%b %d, %H:%M}",
        link="/viewings",
        actor=actor,
    )


def complete_viewing(viewing: Viewing, actor, feedback: str = "", rating: int | None = None) -> Viewing:
    if viewing.status != Viewing.Status.SCHEDULED:
        raise BusinessRuleViolation("Only scheduled viewings can be completed.")
    viewing.status = Viewing.Status.COMPLETED
    viewing.feedback = feedback
    viewing.rating = rating
    viewing.save(update_fields=["status", "feedback", "rating", "updated_at"])
    log_activity(
        actor=actor,
        kind=Activity.Kind.VIEWING_COMPLETED,
        message=f"Viewing completed: {viewing.lead.name} at {viewing.property.title}",
        lead=viewing.lead,
        property=viewing.property,
    )
    if settings.VIEWING_AUTO_FOLLOWUP:
        create_followup_task(viewing, actor)
    return viewing


def create_followup_task(viewing: Viewing, actor):
    """Post-viewing hook: a follow-up call is due the next day."""
    from tasks.models import Task

    return Task.objects.create(
        title=f"Follow up after viewing: {viewing.property.title}",
        description=f"Collect feedback from {viewing.lead.name} and discuss next steps.",
        type=Task.Type.FOLLOW_UP,
        due_at=timezone.now() + timedelta(days=1),
        assigned_to=viewing.assigned_to or actor,
        created_by=actor,
        lead=viewing.lead,
        property=viewing.property,
    )


def cancel_viewing(viewing: Viewing, actor, reason: str = "") -> Viewing:
    if viewing.status != Viewing.Status.SCHEDULED:
        raise BusinessRuleViolation("Only scheduled viewings can be cancelled.")
    viewing.status = Viewing.Status.CANCELLED
    viewing.feedback = reason
    viewing.save(update_fields=["status", "feedback", "updated_at"])
    log_activity(
        actor=actor,
        kind=Activity.Kind.VIEWING_CANCELLED,
        message=f"Viewing cancelled: {viewing.lead.name} at {viewing.property.title}",
        lead=viewing.lead,
        property=viewing.property,
    )
    return viewing
