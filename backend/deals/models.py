import builtins

from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


class Deal(TimeStampedModel):
    class Stage(models.TextChoices):
        INTERESTED = "interested", "Interested"
        VIEWING = "viewing", "Viewing"
        OFFER_MADE = "offer_made", "Offer Made"
        NEGOTIATION = "negotiation", "Negotiation"
        UNDER_CONTRACT = "under_contract", "Under Contract"
        CLOSED = "closed", "Closed"
        LOST = "lost", "Lost"

    PIPELINE_ORDER = ["interested", "viewing", "offer_made", "negotiation", "under_contract", "closed"]
    TERMINAL_STAGES = ["closed", "lost"]

    lead = models.ForeignKey("leads.Lead", on_delete=models.CASCADE, related_name="deals")
    property = models.ForeignKey("properties.Property", on_delete=models.CASCADE, related_name="deals")
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="deals"
    )
    stage = models.CharField(max_length=20, choices=Stage.choices, default=Stage.INTERESTED, db_index=True)
    offer_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    sale_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    expected_close_date = models.DateField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    lost_reason = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["lead", "property"],
                condition=~models.Q(stage__in=["closed", "lost"]),
                name="uniq_open_deal_per_lead_property",
            )
        ]

    @builtins.property  # the `property` model field above shadows the builtin in this class body
    def is_open(self) -> bool:
        return self.stage not in self.TERMINAL_STAGES

    def __str__(self) -> str:
        return f"{self.lead} – {self.property}"


class Offer(TimeStampedModel):
    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        COUNTERED = "countered", "Countered"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        WITHDRAWN = "withdrawn", "Withdrawn"

    deal = models.ForeignKey(Deal, on_delete=models.CASCADE, related_name="offers")
    lead = models.ForeignKey("leads.Lead", on_delete=models.CASCADE, related_name="offers")
    property = models.ForeignKey("properties.Property", on_delete=models.CASCADE, related_name="offers")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUBMITTED, db_index=True)
    conditions = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="offers"
    )

    class Meta:
        ordering = ["-created_at", "-id"]
