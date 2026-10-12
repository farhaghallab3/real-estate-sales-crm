from django.core.management.base import BaseCommand

from notifications.services import notify_overdue_tasks


class Command(BaseCommand):
    help = "Create in-app notifications for overdue tasks (idempotent). Schedule via cron/Celery beat."

    def handle(self, *args, **options):
        count = notify_overdue_tasks()
        self.stdout.write(self.style.SUCCESS(f"Created {count} overdue notifications"))
