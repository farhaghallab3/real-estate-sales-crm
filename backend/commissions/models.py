from decimal import Decimal

from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


class Commission(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        PAID = "paid", "Paid"

    deal = models.OneToOneField("deals.Deal", on_delete=models.CASCADE, related_name="commission")
    salesperson = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="commissions"
    )
    sale_price = models.DecimalField(max_digits=14, decimal_places=2)
    commission_rate = models.DecimalField(max_digits=5, decimal_places=2, help_text="% of sale price")
    gross_commission = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    agent_split = models.DecimalField(max_digits=5, decimal_places=2, help_text="% of gross to the agent")
    agent_commission = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    deductions = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    net_commission = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
