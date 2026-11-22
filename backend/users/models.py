from decimal import Decimal

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    ADMIN = "admin", "Admin"
    MANAGER = "manager", "Manager"
    SALESPERSON = "salesperson", "Salesperson"


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create(self, email: str, password: str | None, **extra):
        if not email:
            raise ValueError("Email is required")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra):
        extra.setdefault("role", Role.SALESPERSON)
        return self._create(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.update(is_staff=True, is_superuser=True, role=Role.ADMIN)
        return self._create(email, password, **extra)


class User(AbstractUser):
    username = None
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.SALESPERSON, db_index=True)
    phone = models.CharField(max_length=40, blank=True)
    job_title = models.CharField(max_length=80, blank=True)
    commission_split = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("50.00"), help_text="Agent share of gross commission (%)"
    )

    must_change_password = models.BooleanField(
        default=False,
        help_text="The account must choose a new password before it can use anything else (set for temporary passwords).",
    )
    # Set whenever the password changes. Tokens carry the matching "pwv" claim, so a change revokes every older token.
    # NULL (all accounts that existed before this field) means "never changed": their current tokens stay valid.
    password_changed_at = models.DateTimeField(null=True, blank=True, editable=False)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []
    objects = UserManager()

    class Meta:
        ordering = ["first_name", "last_name"]

    def set_password(self, raw_password):
        super().set_password(raw_password)
        self.password_changed_at = timezone.now()

    def save(self, *args, **kwargs):
        fields = kwargs.get("update_fields")
        if fields is not None and "password" in fields and "password_changed_at" not in fields:
            kwargs["update_fields"] = [*fields, "password_changed_at"]
        super().save(*args, **kwargs)

    @property
    def token_version(self) -> int:
        """Value of the "pwv" token claim: 0 until the password is changed, then the change time in milliseconds."""
        return int(self.password_changed_at.timestamp() * 1000) if self.password_changed_at else 0

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or self.email

    def __str__(self) -> str:
        return self.full_name
