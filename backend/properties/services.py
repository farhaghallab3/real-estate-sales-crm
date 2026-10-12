from decimal import Decimal

from core.models import Activity
from core.services import log_activity
from notifications.models import Notification
from notifications.services import notify

from .models import Property


def record_price_change(prop: Property, old_price: Decimal, actor) -> None:
    """Log the change and tell everyone with a stake in the property."""
    if old_price == prop.price:
        return
    log_activity(
        actor=actor,
        kind=Activity.Kind.PRICE_CHANGED,
        message=f"Price of {prop.title} changed from {old_price:,.0f} to {prop.price:,.0f}",
        property=prop,
        old_price=str(old_price),
        new_price=str(prop.price),
    )
    recipients = {prop.assigned_to} if prop.assigned_to else set()
    for match in prop.lead_matches.exclude(status__in=["rejected", "purchased"]).select_related("lead__assigned_to"):
        if match.lead.assigned_to:
            recipients.add(match.lead.assigned_to)
    notify(
        list(recipients),
        kind=Notification.Kind.PRICE_CHANGED,
        title=f"Price changed: {prop.title}",
        body=f"{old_price:,.0f} → {prop.price:,.0f}",
        link=f"/properties/{prop.pk}",
        actor=actor,
    )
