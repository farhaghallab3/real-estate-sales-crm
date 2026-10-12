from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.exceptions import BusinessRuleViolation
from core.permissions import is_manager, scope_to_user

from . import services
from .filters import TaskFilter, day_bounds
from .models import Task
from .serializers import TaskSerializer


class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    filterset_class = TaskFilter
    search_fields = ["title", "lead__first_name", "lead__last_name", "property__title"]
    ordering_fields = ["due_at", "created_at", "type", "status"]

    def get_queryset(self):
        qs = Task.objects.select_related("assigned_to", "lead", "property")
        return scope_to_user(qs, self.request.user)

    def perform_create(self, serializer):
        user = self.request.user
        assignee = serializer.validated_data.get("assigned_to")
        lead = serializer.validated_data.get("lead")
        if not is_manager(user):
            assignee = user  # salespeople create tasks for themselves
            if lead is not None and lead.assigned_to_id != user.id:
                raise BusinessRuleViolation("You can only create tasks for your own leads.")
        elif assignee is None:
            assignee = (lead.assigned_to if lead else None) or user
        task = serializer.save(assigned_to=assignee, created_by=user)
        services.after_task_created(task, user)

    def perform_update(self, serializer):
        if not is_manager(self.request.user) and "assigned_to" in serializer.validated_data:
            if serializer.validated_data["assigned_to"] != self.request.user:
                raise BusinessRuleViolation("Only managers can reassign tasks.")
        serializer.save()

    @action(detail=False, methods=["get"])
    def counts(self, request):
        """Tab badges: pending / due today / upcoming / overdue / completed for the current filters."""
        base = self.filter_queryset(self.get_queryset()).order_by()
        start, end = day_bounds()
        pending = base.filter(status=Task.Status.PENDING)
        return Response(
            {
                "all": pending.count(),
                "today": pending.filter(due_at__gte=start, due_at__lt=end).count(),
                "upcoming": pending.filter(due_at__gte=end).count(),
                "overdue": pending.filter(due_at__lt=start).count(),
                "completed": base.filter(status=Task.Status.COMPLETED).count(),
            }
        )

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        task = services.complete_task(self.get_object(), request.user)
        return Response(self.get_serializer(task).data)

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        task = services.reopen_task(self.get_object())
        return Response(self.get_serializer(task).data)
