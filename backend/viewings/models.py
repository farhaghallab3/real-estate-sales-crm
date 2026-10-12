from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


class Viewing(TimeStampedModel):
    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    lead = models.ForeignKey("leads.Lead", on_delete=models.CASCADE, related_name="viewings")
    property = models.ForeignKey("properties.Property", on_delete=models.CASCADE, related_name="viewings")
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="viewings"
    )
    start_at = models.DateTimeField(db_index=True)
    end_at = models.DateTimeField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED, db_index=True)
    feedback = models.TextField(blank=True)
    rating = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["start_at"]
