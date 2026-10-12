import builtins

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import TimeStampedModel


class Task(TimeStampedModel):
    class Type(models.TextChoices):
        CALL = "call", "Call"
        EMAIL = "email", "Email"
        VIEWING = "viewing", "Viewing"
        FOLLOW_UP = "follow_up", "Follow-up"
        DOCUMENT = "document", "Document"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETED = "completed", "Completed"

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    type = models.CharField(max_length=20, choices=Type.choices, default=Type.FOLLOW_UP, db_index=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    due_at = models.DateTimeField(db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="tasks"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_tasks"
    )
    lead = models.ForeignKey("leads.Lead", null=True, blank=True, on_delete=models.CASCADE, related_name="tasks")
    property = models.ForeignKey(
        "properties.Property", null=True, blank=True, on_delete=models.CASCADE, related_name="tasks"
    )
    deal = models.ForeignKey("deals.Deal", null=True, blank=True, on_delete=models.CASCADE, related_name="tasks")

    class Meta:
        ordering = ["due_at", "id"]

    @builtins.property  # the `property` model field above shadows the builtin in this class body
    def is_overdue(self) -> bool:
        return self.status == self.Status.PENDING and self.due_at < timezone.now()

    def __str__(self) -> str:
        return self.title
