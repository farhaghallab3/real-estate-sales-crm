from datetime import datetime, time, timedelta

import django_filters as filters
from django.utils import timezone

from .models import Task


def day_bounds(now=None):
    now = timezone.localtime(now or timezone.now())
    start = timezone.make_aware(datetime.combine(now.date(), time.min))
    return start, start + timedelta(days=1)


class TaskFilter(filters.FilterSet):
    SCOPES = [
        ("all", "All"), ("today", "Due today"), ("upcoming", "Upcoming"), ("overdue", "Overdue"),
        ("completed", "Completed"),
    ]
    scope = filters.ChoiceFilter(choices=SCOPES, method="filter_scope")
    mine = filters.BooleanFilter(method="filter_mine")
    type = filters.BaseInFilter(field_name="type")
    due_after = filters.IsoDateTimeFilter(field_name="due_at", lookup_expr="gte")
    due_before = filters.IsoDateTimeFilter(field_name="due_at", lookup_expr="lte")

    class Meta:
        model = Task
        fields = ["assigned_to", "lead", "property", "deal", "status", "type"]

    def filter_mine(self, queryset, name, value):
        return queryset.filter(assigned_to=self.request.user) if value else queryset

    def filter_scope(self, queryset, name, value):
        start, end = day_bounds()
        pending = queryset.filter(status=Task.Status.PENDING)
        if value == "today":
            return pending.filter(due_at__gte=start, due_at__lt=end)
        if value == "upcoming":
            return pending.filter(due_at__gte=end)
        if value == "overdue":
            return pending.filter(due_at__lt=start)
        if value == "completed":
            return queryset.filter(status=Task.Status.COMPLETED)
        return queryset
