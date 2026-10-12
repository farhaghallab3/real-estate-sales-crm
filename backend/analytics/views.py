from django.db.models import Min, Q
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Activity
from core.permissions import is_manager
from core.serializers import ActivitySerializer
from leads.serializers import LeadSerializer
from notifications.services import notify_overdue_tasks
from tasks.filters import day_bounds
from tasks.models import Task
from tasks.serializers import TaskSerializer
from viewings.models import Viewing
from viewings.serializers import ViewingSerializer

from . import services


def _int(value):
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _date(value):
    from datetime import date

    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


class DashboardView(APIView):
    def get(self, request):
        user = request.user
        notify_overdue_tasks(user)
        days = _int(request.query_params.get("days")) or 0
        f = services.period_filters(days)
        qs = services.querysets(user, f)
        now = timezone.now()
        _, end_of_today = day_bounds()

        tasks = (
            qs_tasks(user).filter(status=Task.Status.PENDING, due_at__lt=end_of_today)
            .select_related("assigned_to", "lead", "property").order_by("due_at")[:8]
        )
        viewings = (
            qs["viewings"].filter(status=Viewing.Status.SCHEDULED, end_at__gte=now)
            .select_related("lead", "property", "assigned_to").order_by("start_at")[:6]
        )
        leads = qs["leads"].select_related("assigned_to").annotate(
            next_follow_up=Min("tasks__due_at", filter=Q(tasks__status="pending"))
        ).order_by("-created_at")[:6]
        activity = Activity.objects.select_related("actor", "lead")
        if not is_manager(user):
            activity = activity.filter(
                Q(actor=user) | Q(lead__assigned_to=user) | Q(deal__assigned_to=user)
            )

        payload = {
            "scope": "team" if is_manager(user) else "personal",
            "period_days": days,
            "metrics": services.metrics(qs, f),
            "todays_tasks": TaskSerializer(tasks, many=True).data,
            "upcoming_viewings": ViewingSerializer(viewings, many=True).data,
            "recent_leads": LeadSerializer(leads, many=True).data,
            "pipeline": services.pipeline_overview(qs["deals"]),
            "recent_activity": ActivitySerializer(activity[:12], many=True).data,
            "team": services.leaderboard(qs, f, user) if is_manager(user) else [],
        }
        return Response(payload)


def qs_tasks(user):
    """The dashboard task list is always personal, even for managers."""
    return Task.objects.filter(assigned_to=user)


class AnalyticsSummaryView(APIView):
    def get(self, request):
        p = request.query_params
        f = services.Filters(
            date_from=_date(p.get("date_from")),
            date_to=_date(p.get("date_to")),
            salesperson=_int(p.get("salesperson")),
            property=_int(p.get("property")),
            source=p.get("source") or None,
            location=p.get("location") or None,
            deal_status=p.get("deal_status") or None,
        )
        qs = services.querysets(request.user, f)
        return Response(
            {
                "metrics": services.metrics(qs, f),
                "pipeline": services.pipeline_overview(qs["deals"]),
                "team": services.leaderboard(qs, f, request.user),
                **services.series(qs, f),
            }
        )
