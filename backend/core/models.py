from django.conf import settings
from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Activity(models.Model):
    """Append-only business event log. Drives lead timelines and the dashboard feed."""

    class Kind(models.TextChoices):
        LEAD_CREATED = "lead_created", "Lead created"
        LEAD_ASSIGNED = "lead_assigned", "Lead assigned"
        STATUS_CHANGED = "status_changed", "Status changed"
        NOTE_ADDED = "note_added", "Note added"
        PROPERTY_LINKED = "property_linked", "Property linked"
        MATCH_CHANGED = "match_changed", "Property match updated"
        TASK_CREATED = "task_created", "Task created"
        TASK_COMPLETED = "task_completed", "Task completed"
        VIEWING_SCHEDULED = "viewing_scheduled", "Viewing scheduled"
        VIEWING_COMPLETED = "viewing_completed", "Viewing completed"
        VIEWING_CANCELLED = "viewing_cancelled", "Viewing cancelled"
        OFFER_SUBMITTED = "offer_submitted", "Offer submitted"
        DEAL_CREATED = "deal_created", "Deal created"
        DEAL_MOVED = "deal_moved", "Deal moved"
        DEAL_CLOSED = "deal_closed", "Deal closed"
        DEAL_LOST = "deal_lost", "Deal lost"
        DOCUMENT_UPLOADED = "document_uploaded", "Document uploaded"
        PRICE_CHANGED = "price_changed", "Price changed"
        COMMISSION = "commission", "Commission updated"

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="activities"
    )
    kind = models.CharField(max_length=32, choices=Kind.choices, db_index=True)
    message = models.CharField(max_length=500)
    lead = models.ForeignKey("leads.Lead", null=True, blank=True, on_delete=models.CASCADE, related_name="activities")
    property = models.ForeignKey(
        "properties.Property", null=True, blank=True, on_delete=models.CASCADE, related_name="activities"
    )
    deal = models.ForeignKey("deals.Deal", null=True, blank=True, on_delete=models.CASCADE, related_name="activities")
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name_plural = "activities"

    def __str__(self) -> str:
        return f"{self.kind}: {self.message}"
