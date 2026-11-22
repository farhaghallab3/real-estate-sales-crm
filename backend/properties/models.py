from django.conf import settings
from django.db import connections, models, router

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
        # No CHECK (reference <> '') on purpose, for now: the previous release inserts reference="" and a code-only rollback would then fail
        # every creation. See docs/DEFERRED_PROPERTY_REFERENCE_CHECK.md.

    @staticmethod
    def reference_for(pk: int) -> str:
        """The reference of a property: PR- and its id, at least five digits (PR-00042, PR-100000). Never changes for an existing row."""
        return f"PR-{pk:05d}"

    @classmethod
    def _allocate_pk(cls, using: str | None = None) -> int:
        """Take the next id from the table's own PostgreSQL sequence: the same sequence, and the same call, the database itself would make
        for a plain INSERT, so ids handed out here and ids handed out by any other INSERT can never collide."""
        opts = cls._meta
        with connections[using or router.db_for_write(cls)].cursor() as cursor:
            cursor.execute("SELECT nextval(pg_get_serial_sequence(%s, %s))", [opts.db_table, opts.pk.column])
            value = cursor.fetchone()[0]
        if value is None:
            raise RuntimeError(f"{opts.db_table}.{opts.pk.column} has no sequence: cannot allocate a property id")
        return value

    def save(self, *args, **kwargs):
        # A new property gets its id AND its reference before the INSERT and is written by ONE statement: there is no moment in which a
        # row exists without its reference, and no second UPDATE. (The old way inserted reference="" and updated it afterwards: two
        # simultaneous creations collided on the unique index, and a crash in between left an empty reference that failed every later
        # creation.) An existing property is never given a new reference: only rows that are being inserted are touched here.
        if self._state.adding and not self.reference:
            if self.pk is None:
                self.pk = self._allocate_pk(kwargs.get("using"))
            self.reference = self.reference_for(self.pk)
            if not args:
                kwargs["force_insert"] = True  # we know it is an INSERT: skip Django's UPDATE-then-INSERT probe for an id that is set
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.title


class PropertyImage(TimeStampedModel):
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="images")
    file = models.FileField(upload_to="properties/%Y/%m/", blank=True)
    url = models.URLField(blank=True, help_text="External image URL (optional)")
    caption = models.CharField(max_length=140, blank=True)

    class Meta:
        ordering = ["id"]
