from __future__ import annotations

from typing import Any

from django.utils import timezone

from .models import Activity


def log_activity(
    *,
    actor,
    kind: str,
    message: str,
    lead=None,
    property=None,  # noqa: A002 - mirrors the model field name
    deal=None,
    **metadata: Any,
) -> Activity:
    """Record a business event. Deal events inherit lead/property so every timeline stays complete."""
    if deal is not None:
        lead = lead or deal.lead
        property = property or deal.property
    activity = Activity.objects.create(
        actor=actor if getattr(actor, "pk", None) else None,
        kind=kind,
        message=message[:500],
        lead=lead,
        property=property,
        deal=deal,
        metadata=metadata,
    )
    if lead is not None:
        type(lead).objects.filter(pk=lead.pk).update(last_activity_at=timezone.now())
    return activity
