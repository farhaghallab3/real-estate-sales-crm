import os
import uuid

from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


def document_path(instance: "Document", filename: str) -> str:
    # Random storage name: original filename is kept in `name`, never trusted for the path.
    ext = os.path.splitext(filename)[1].lower()
    return f"documents/deal-{instance.deal_id}/{uuid.uuid4().hex}{ext}"


class Document(TimeStampedModel):
    class Category(models.TextChoices):
        CONTRACT = "contract", "Contract"
        OFFER = "offer", "Offer"
        INSPECTION = "inspection_report", "Inspection report"
        IDENTIFICATION = "identification", "Identification"
        AGREEMENT = "agreement", "Agreement"
        DISCLOSURE = "disclosure", "Property disclosure"

    deal = models.ForeignKey("deals.Deal", on_delete=models.CASCADE, related_name="documents")
    category = models.CharField(max_length=24, choices=Category.choices, db_index=True)
    name = models.CharField(max_length=255)
    file = models.FileField(upload_to=document_path)
    size = models.PositiveIntegerField(default=0)
    content_type = models.CharField(max_length=100, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="documents"
    )

    class Meta:
        ordering = ["-created_at", "-id"]
