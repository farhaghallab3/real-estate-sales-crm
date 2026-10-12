from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.exceptions import BusinessRuleViolation, Conflict
from core.permissions import is_manager, scope_to_user

from . import services
from .filters import ViewingFilter
from .models import Viewing
from .serializers import (
    CancelViewingSerializer,
    CompleteViewingSerializer,
    ConflictCheckSerializer,
    ViewingSerializer,
)


class ViewingViewSet(viewsets.ModelViewSet):
    serializer_class = ViewingSerializer
    filterset_class = ViewingFilter
    search_fields = ["lead__first_name", "lead__last_name", "property__title"]
    ordering_fields = ["start_at", "created_at", "status"]

    def get_queryset(self):
        qs = Viewing.objects.select_related("lead", "property", "assigned_to")
        return scope_to_user(qs, self.request.user)

    def _guard_conflicts(self, serializer, instance=None):
        data = serializer.validated_data
        start = data.get("start_at", getattr(instance, "start_at", None))
        end = data.get("end_at", getattr(instance, "end_at", None))
        assignee = data.get("assigned_to", getattr(instance, "assigned_to", None))
        prop = data.get("property", getattr(instance, "property", None))
        acknowledged = str(self.request.data.get("acknowledge_conflicts", "")).lower() in ("1", "true", "yes")
        conflicts = services.find_conflicts(
            start, end, assignee.pk if assignee else None, prop.pk if prop else None,
            exclude_id=instance.pk if instance else None,
        )
        if conflicts and not acknowledged:
            raise Conflict(
                detail={
                    "detail": "This time overlaps with another scheduled viewing.",
                    "code": "scheduling_conflict",
                    "conflicts": conflicts,
                }
            )

    def perform_create(self, serializer):
        user = self.request.user
        lead = serializer.validated_data["lead"]
        if not is_manager(user) and lead.assigned_to_id != user.id:
            raise BusinessRuleViolation("You can only schedule viewings for your own leads.")
        assignee = serializer.validated_data.get("assigned_to") or lead.assigned_to or user
        if not is_manager(user):
            assignee = user
        serializer.validated_data["assigned_to"] = assignee
        self._guard_conflicts(serializer)
        viewing = serializer.save()
        services.after_viewing_scheduled(viewing, user)

    def perform_update(self, serializer):
        if serializer.instance.status != Viewing.Status.SCHEDULED:
            raise BusinessRuleViolation("Only scheduled viewings can be rescheduled.")
        self._guard_conflicts(serializer, serializer.instance)
        serializer.save()

    @action(detail=False, methods=["post"], url_path="check-conflicts")
    def check_conflicts(self, request):
        serializer = ConflictCheckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        conflicts = services.find_conflicts(
            d["start_at"], d["end_at"], d.get("assigned_to_id"), d.get("property_id"), d.get("exclude_id")
        )
        return Response({"conflicts": conflicts})

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        serializer = CompleteViewingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        viewing = services.complete_viewing(
            self.get_object(), request.user, serializer.validated_data.get("feedback", ""),
            serializer.validated_data.get("rating"),
        )
        return Response(self.get_serializer(viewing).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        serializer = CancelViewingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        viewing = services.cancel_viewing(
            self.get_object(), request.user, serializer.validated_data.get("reason", "")
        )
        return Response(self.get_serializer(viewing).data)
