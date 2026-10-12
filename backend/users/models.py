from decimal import Decimal

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


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

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []
    objects = UserManager()

    class Meta:
        ordering = ["first_name", "last_name"]

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or self.email

    def __str__(self) -> str:
        return self.full_name
