from __future__ import annotations

import os

from django.conf import settings

from core.exceptions import BusinessRuleViolation
from core.models import Activity
from core.services import log_activity

from .models import Document


def validate_upload(upload) -> None:
    ext = os.path.splitext(upload.name)[1].lower()
    if ext not in settings.ALLOWED_UPLOAD_EXTENSIONS:
        allowed = ", ".join(sorted(settings.ALLOWED_UPLOAD_EXTENSIONS))
        raise BusinessRuleViolation(f"File type '{ext or 'unknown'}' is not allowed. Allowed: {allowed}.")
    if upload.size > settings.MAX_UPLOAD_BYTES:
        raise BusinessRuleViolation(f"File exceeds the {settings.MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.")
    if upload.size == 0:
        raise BusinessRuleViolation("File is empty.")


def create_document(deal, category: str, upload, actor, name: str = "") -> Document:
    validate_upload(upload)
    document = Document.objects.create(
        deal=deal,
        category=category,
        name=(name or upload.name)[:255],
        file=upload,
        size=upload.size,
        content_type=getattr(upload, "content_type", "") or "",
        uploaded_by=actor,
    )
    log_activity(
        actor=actor,
        kind=Activity.Kind.DOCUMENT_UPLOADED,
        message=f"{document.get_category_display()} uploaded: {document.name}",
        deal=deal,
    )
    return document


def checklist_for(deal) -> list[dict]:
    labels = dict(Document.Category.choices)
    present: dict[str, int] = {}
    for category in deal.documents.values_list("category", flat=True):
        present[category] = present.get(category, 0) + 1
    return [
        {
            "category": category,
            "label": labels.get(category, category),
            "required": category in settings.REQUIRED_DEAL_DOCUMENT_CATEGORIES,
            "count": present.get(category, 0),
            "complete": present.get(category, 0) > 0,
        }
        for category in [c for c, _ in Document.Category.choices]
    ]


def missing_categories(deal) -> list[tuple[str, str]]:
    return [(i["category"], i["label"]) for i in checklist_for(deal) if i["required"] and not i["complete"]]
