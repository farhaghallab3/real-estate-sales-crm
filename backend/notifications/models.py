from django.conf import settings
from django.db import models


class Notification(models.Model):
    class Kind(models.TextChoices):
        LEAD_ASSIGNED = "lead_assigned", "New lead assigned"
        TASK_OVERDUE = "task_overdue", "Task overdue"
        TASK_ASSIGNED = "task_assigned", "Task assigned"
        VIEWING_CREATED = "viewing_created", "Viewing created"
        DEAL_STATUS = "deal_status", "Deal status changed"
        PRICE_CHANGED = "price_changed", "Property price changed"
        DOCUMENT_MISSING = "document_missing", "Required document missing"
        COMMISSION = "commission", "Commission update"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    kind = models.CharField(max_length=32, choices=Kind.choices)
    title = models.CharField(max_length=200)
    body = models.CharField(max_length=500, blank=True)
    link = models.CharField(max_length=200, blank=True, help_text="Frontend path to open")
    dedupe_key = models.CharField(max_length=120, null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "dedupe_key"],
                condition=models.Q(dedupe_key__isnull=False),
                name="uniq_notification_dedupe",
            )
        ]

    def __str__(self) -> str:
        return f"{self.kind} → {self.user_id}"
