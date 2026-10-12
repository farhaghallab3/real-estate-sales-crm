from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


class Property(TimeStampedModel):
    class Type(models.TextChoices):
        APARTMENT = "apartment", "Apartment"
        VILLA = "villa", "Villa"
        TOWNHOUSE = "townhouse", "Townhouse"
        PENTHOUSE = "penthouse", "Penthouse"
        LAND = "land", "Land"
        COMMERCIAL = "commercial", "Commercial"

    class Status(models.TextChoices):
        AVAILABLE = "available", "Available"
        RESERVED = "reserved", "Reserved"
        UNDER_OFFER = "under_offer", "Under Offer"
        SOLD = "sold", "Sold"
        INACTIVE = "inactive", "Inactive"

    reference = models.CharField(max_length=20, unique=True, blank=True, editable=False)
    title = models.CharField(max_length=200)
    address = models.CharField(max_length=255)
    city = models.CharField(max_length=100, db_index=True, help_text="City / location")
    price = models.DecimalField(max_digits=14, decimal_places=2)
    property_type = models.CharField(max_length=20, choices=Type.choices, default=Type.APARTMENT, db_index=True)
    bedrooms = models.PositiveSmallIntegerField(default=0)
    bathrooms = models.PositiveSmallIntegerField(default=0)
    area_sqm = models.DecimalField(max_digits=9, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.AVAILABLE, db_index=True)
    description = models.TextField(blank=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="properties"
    )

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name_plural = "properties"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.reference:
            self.reference = f"PR-{self.pk:05d}"
            type(self).objects.filter(pk=self.pk).update(reference=self.reference)

    def __str__(self) -> str:
        return self.title


class PropertyImage(TimeStampedModel):
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="images")
    file = models.FileField(upload_to="properties/%Y/%m/", blank=True)
    url = models.URLField(blank=True, help_text="External image URL (optional)")
    caption = models.CharField(max_length=140, blank=True)

    class Meta:
        ordering = ["id"]
