from __future__ import annotations

from typing import Iterable

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.module_loading import import_string

from .models import Notification


def _channels():
    return [import_string(path)() for path in settings.NOTIFICATION_CHANNELS]


def notify(
    recipients,
    *,
    kind: str,
    title: str,
    body: str = "",
    link: str = "",
    actor=None,
    dedupe_key: str | None = None,
) -> list[Notification]:
    """Create a notification per distinct recipient (never for the actor) and fan out to channels."""
    if recipients is None:
        return []
    if not isinstance(recipients, Iterable):
        recipients = [recipients]
    seen: set[int] = set()
    created: list[Notification] = []
    for user in recipients:
        if user is None or user.pk in seen or (actor is not None and user.pk == actor.pk):
            continue
        seen.add(user.pk)
        if dedupe_key and Notification.objects.filter(user=user, dedupe_key=dedupe_key).exists():
            continue  # cheap pre-check; the unique constraint below only guards against races
        try:
            with transaction.atomic():
                notification = Notification.objects.create(
                    user=user, kind=kind, title=title[:200], body=body[:500], link=link, dedupe_key=dedupe_key
                )
        except IntegrityError:
            continue  # already notified for this dedupe key
        for channel in _channels():
            channel.deliver(notification)
        created.append(notification)
    return created


def notify_overdue_tasks(user=None) -> int:
    """Create (once per task) overdue notifications. Called from a management command today,
    and from a Celery beat schedule later."""
    from tasks.models import Task

    qs = Task.objects.filter(status=Task.Status.PENDING, due_at__lt=timezone.now()).select_related("assigned_to")
    if user is not None:
        qs = qs.filter(assigned_to=user)
    count = 0
    for task in qs:
        if task.assigned_to is None:
            continue
        created = notify(
            [task.assigned_to],
            kind=Notification.Kind.TASK_OVERDUE,
            title=f"Overdue: {task.title}",
            body=f"Was due {timezone.localtime(task.due_at):%b %d, %H:%M}",
            link="/tasks?scope=overdue",
            dedupe_key=f"task-overdue-{task.pk}",
        )
        count += len(created)
    return count
