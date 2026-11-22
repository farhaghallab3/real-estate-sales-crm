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


class CompanySettings(models.Model):
    """The single row that describes this deployment's company: branding, base currency and formatting locale.

    Defaults reproduce the interface exactly as it was before this model existed. The base currency is locked once any financial
    data exists (see core.company.financial_data_exists): changing it would silently change what every stored amount means.
    """

    company_name = models.CharField(max_length=120, default="Keystone")
    workspace_label = models.CharField(max_length=60, default="Sales workspace")
    currency_code = models.CharField(max_length=3, default="USD")
    locale = models.CharField(max_length=10, default="en-US")
    language = models.CharField(max_length=5, default="en")
    logo = models.FileField(upload_to="company/", blank=True, default="")
    logo_content_type = models.CharField(max_length=20, blank=True, default="")
    logo_version = models.PositiveIntegerField(default=0)
    defaults_applied_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        verbose_name_plural = "company settings"
        constraints = [models.CheckConstraint(condition=models.Q(pk=1), name="company_settings_singleton")]

    @classmethod
    def load(cls) -> "CompanySettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def save(self, *args, allow_currency_change: bool = False, **kwargs):
        """allow_currency_change is reserved for a future, separate financial migration; nothing else may pass it."""
        from .company import CurrencyLocked, financial_data_exists

        self.pk = 1
        if not self._state.adding and not allow_currency_change:
            stored = CompanySettings.objects.filter(pk=1).values_list("currency_code", flat=True).first()
            if stored and stored != self.currency_code and financial_data_exists():
                raise CurrencyLocked("The base currency cannot change once financial data exists.")
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.company_name
