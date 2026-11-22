from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Wipe ALL data and reload the demo dataset. Only runs when DEMO_MODE=true."

    def handle(self, *args, **options):
        if not settings.DEMO_MODE:
            raise CommandError("Refusing to run: DEMO_MODE is not enabled on this instance.")
        call_command("flush", "--no-input", verbosity=0)
        call_command("seed_demo", "--force")
        self.stdout.write(self.style.SUCCESS("Demo data reset."))
