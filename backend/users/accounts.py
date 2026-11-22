"""Who counts as a company user and who is a technical (provider) account.

A technical account is a Django staff or superuser account: the product owner's own tooling. It is never exposed to,
managed by or assignable through the company-facing API. Company Admins are role=admin accounts that are not technical.
"""
from .models import User


def is_technical(user) -> bool:
    return bool(user.is_superuser or user.is_staff)


def company_users():
    """Every account a company may see and manage."""
    return User.objects.filter(is_superuser=False, is_staff=False)


def assignable_users():
    """Accounts that work (leads, deals, tasks, viewings, properties) can be handed to."""
    return company_users().filter(is_active=True)
