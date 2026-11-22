import os

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from core.company import CURRENCIES, LOCALES
from core.models import CompanySettings


class Command(BaseCommand):
    help = (
        "Apply COMPANY_NAME / COMPANY_CURRENCY / COMPANY_LOCALE from the instance environment ONCE, when the instance is created. "
        "After that the Company Admin's settings are the source of truth and this command never changes anything again."
    )

    def handle(self, *args, **options):
        name = (os.environ.get("COMPANY_NAME") or "").strip()
        currency = (os.environ.get("COMPANY_CURRENCY") or "").strip()
        locale = (os.environ.get("COMPANY_LOCALE") or "").strip()
        if len(name) > 120:
            raise CommandError("COMPANY_NAME is longer than 120 characters.")
        if currency and currency not in CURRENCIES:
            raise CommandError(f"COMPANY_CURRENCY '{currency}' is not a supported currency.")
        if locale and locale not in LOCALES:
            raise CommandError(f"COMPANY_LOCALE '{locale}' is not a supported locale.")

        with transaction.atomic():
            cfg = CompanySettings.objects.select_for_update().get_or_create(pk=1)[0]
            if cfg.defaults_applied_at:
                self.stdout.write("Instance defaults were already applied; nothing changed.")
                return
            pristine = (
                cfg.updated_by_id is None
                and not cfg.logo
                and (cfg.company_name, cfg.workspace_label, cfg.currency_code, cfg.locale, cfg.language)
                == ("Keystone", "Sales workspace", "USD", "en-US", "en")
            )
            if pristine:
                if name:
                    cfg.company_name = name
                if currency:
                    cfg.currency_code = currency
                if locale:
                    cfg.locale = locale
                outcome = "Instance defaults applied."
            else:
                # An instance that already existed (an admin edited the settings): never overwrite their choices.
                outcome = "Settings were already customized; defaults were NOT applied."
            cfg.defaults_applied_at = timezone.now()
            cfg.save()
        self.stdout.write(outcome)
