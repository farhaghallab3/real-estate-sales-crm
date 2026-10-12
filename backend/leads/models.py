from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


class Lead(TimeStampedModel):
    class Status(models.TextChoices):
        NEW = "new", "New"
        CONTACTED = "contacted", "Contacted"
        QUALIFIED = "qualified", "Qualified"
        VIEWING = "viewing", "Viewing"
        OFFER_MADE = "offer_made", "Offer Made"
        CLOSED = "closed", "Closed"
        LOST = "lost", "Lost"

    class Source(models.TextChoices):
        WEBSITE = "website", "Website"
        REFERRAL = "referral", "Referral"
        WALK_IN = "walk_in", "Walk-in"
        SOCIAL = "social", "Social media"
        PORTAL = "portal", "Listing portal"
        COLD_CALL = "cold_call", "Cold call"
        EVENT = "event", "Event"
        OTHER = "other", "Other"

    first_name = models.CharField(max_length=80)
    last_name = models.CharField(max_length=80, blank=True)
    phone = models.CharField(max_length=40)
    email = models.EmailField(blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.OTHER, db_index=True)
    budget = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    preferred_location = models.CharField(max_length=120, blank=True, db_index=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW, db_index=True)
    lost_reason = models.CharField(max_length=255, blank=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="leads"
    )
    last_activity_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    @property
    def name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    def __str__(self) -> str:
        return self.name


class LeadNote(TimeStampedModel):
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="notes")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="lead_notes"
    )
    body = models.TextField()

    class Meta:
        ordering = ["-created_at", "-id"]


class LeadProperty(TimeStampedModel):
    """Lead ↔ Property match with its own lifecycle."""

    class Status(models.TextChoices):
        SUGGESTED = "suggested", "Suggested"
        INTERESTED = "interested", "Interested"
        VIEWING_SCHEDULED = "viewing_scheduled", "Viewing Scheduled"
        REJECTED = "rejected", "Rejected"
        OFFER_MADE = "offer_made", "Offer Made"
        PURCHASED = "purchased", "Purchased"

    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="property_matches")
    property = models.ForeignKey("properties.Property", on_delete=models.CASCADE, related_name="lead_matches")
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.SUGGESTED, db_index=True)
    note = models.CharField(max_length=255, blank=True, help_text="Rejection reason or remark")
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-updated_at"]
        constraints = [models.UniqueConstraint(fields=["lead", "property"], name="uniq_lead_property")]
