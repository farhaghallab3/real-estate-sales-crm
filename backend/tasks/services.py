from django.utils import timezone

from core.models import Activity
from core.services import log_activity
from notifications.models import Notification
from notifications.services import notify

from .models import Task


def after_task_created(task: Task, actor) -> None:
    log_activity(
        actor=actor,
        kind=Activity.Kind.TASK_CREATED,
        message=f"Task created: {task.title}",
        lead=task.lead,
        property=task.property,
        deal=task.deal,
    )
    if task.assigned_to:
        notify(
            [task.assigned_to],
            kind=Notification.Kind.TASK_ASSIGNED,
            title=f"Task assigned: {task.title}",
            body=f"Due {timezone.localtime(task.due_at):%b %d, %H:%M}",
            link="/tasks",
            actor=actor,
        )


def complete_task(task: Task, actor) -> Task:
    if task.status == Task.Status.COMPLETED:
        return task
    task.status = Task.Status.COMPLETED
    task.completed_at = timezone.now()
    task.save(update_fields=["status", "completed_at", "updated_at"])
    log_activity(
        actor=actor,
        kind=Activity.Kind.TASK_COMPLETED,
        message=f"Task completed: {task.title}",
        lead=task.lead,
        property=task.property,
        deal=task.deal,
    )
    return task


def reopen_task(task: Task) -> Task:
    task.status = Task.Status.PENDING
    task.completed_at = None
    task.save(update_fields=["status", "completed_at", "updated_at"])
    return task
