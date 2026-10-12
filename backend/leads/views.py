from django.db.models import Count, Min, Q
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.exceptions import BusinessRuleViolation
from core.models import Activity
from core.permissions import IsManagerOrAdmin, is_manager, scope_to_user
from core.serializers import ActivitySerializer

from . import services
from .filters import LeadFilter, LeadPropertyFilter
from .models import Lead, LeadProperty
from .serializers import (
    AssignSerializer,
    ChangeStatusSerializer,
    LeadNoteSerializer,
    LeadPropertySerializer,
    LeadPropertyStatusSerializer,
    LeadSerializer,
)


class LeadViewSet(viewsets.ModelViewSet):
    serializer_class = LeadSerializer
    filterset_class = LeadFilter
    search_fields = ["first_name", "last_name", "phone", "email", "preferred_location"]
    ordering_fields = [
        "created_at", "first_name", "last_name", "budget", "status", "source", "last_activity_at",
        "next_follow_up", "preferred_location",
    ]

    def get_queryset(self):
        qs = Lead.objects.select_related("assigned_to").annotate(
            next_follow_up=Min("tasks__due_at", filter=Q(tasks__status="pending"))
        )
        return scope_to_user(qs, self.request.user).order_by("-created_at", "-id")

    def get_permissions(self):
        permissions = super().get_permissions()
        if self.action == "destroy":
            permissions.append(IsManagerOrAdmin())
        return permissions

    def perform_create(self, serializer):
        user = self.request.user
        # Salespeople always own the leads they create; managers may assign anyone (or leave unassigned).
        if is_manager(user):
            lead = serializer.save()
        else:
            lead = serializer.save(assigned_to=user)
        services.after_lead_created(lead, user)

    def perform_update(self, serializer):
        lead = serializer.instance
        new_assignee = serializer.validated_data.get("assigned_to", lead.assigned_to)
        if new_assignee != lead.assigned_to and not is_manager(self.request.user):
            raise BusinessRuleViolation("Only managers can reassign leads.")
        serializer.validated_data.pop("assigned_to", None)
        serializer.save()
        if new_assignee != lead.assigned_to:
            services.assign_lead(lead, new_assignee, self.request.user)

    @action(detail=True, methods=["post"], permission_classes=[IsManagerOrAdmin])
    def assign(self, request, pk=None):
        lead = self.get_object()
        serializer = AssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.assign_lead(lead, serializer.validated_data["assigned_to"], request.user)
        return Response(self.get_serializer(self.get_queryset().get(pk=lead.pk)).data)

    @action(detail=True, methods=["post"], url_path="change-status")
    def change_status(self, request, pk=None):
        lead = self.get_object()
        serializer = ChangeStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.change_status(
            lead, serializer.validated_data["status"], request.user, serializer.validated_data.get("lost_reason", "")
        )
        return Response(self.get_serializer(self.get_queryset().get(pk=lead.pk)).data)

    @action(detail=False, methods=["get"], url_path="status-counts")
    def status_counts(self, request):
        qs = self.filter_queryset(self.get_queryset()).order_by()
        rows = qs.values("status").annotate(n=Count("id"))
        counts = {s: 0 for s, _ in Lead.Status.choices}
        counts.update({r["status"]: r["n"] for r in rows})
        counts["all"] = sum(counts.values())
        return Response(counts)

    @action(detail=True, methods=["get"])
    def timeline(self, request, pk=None):
        lead = self.get_object()
        qs = Activity.objects.filter(lead=lead).select_related("actor", "lead")[:100]
        return Response(ActivitySerializer(qs, many=True).data)

    @action(detail=True, methods=["get", "post"])
    def notes(self, request, pk=None):
        lead = self.get_object()
        if request.method == "GET":
            return Response(LeadNoteSerializer(lead.notes.select_related("author"), many=True).data)
        serializer = LeadNoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = services.add_note(lead, serializer.validated_data["body"], request.user)
        return Response(LeadNoteSerializer(note).data, status=status.HTTP_201_CREATED)


class LeadPropertyViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = LeadPropertySerializer
    filterset_class = LeadPropertyFilter
    pagination_class = None
    search_fields = ["property__title", "lead__first_name", "lead__last_name"]

    def get_queryset(self):
        qs = LeadProperty.objects.select_related("lead", "lead__assigned_to", "property", "added_by")
        return scope_to_user(qs, self.request.user, "lead__assigned_to")

    def perform_create(self, serializer):
        lead = serializer.validated_data["lead"]
        if not is_manager(self.request.user) and lead.assigned_to_id != self.request.user.id:
            raise BusinessRuleViolation("You can only match properties to your own leads.")
        serializer.instance = services.link_property(
            lead,
            serializer.validated_data["property"],
            self.request.user,
            serializer.validated_data.get("status", LeadProperty.Status.SUGGESTED),
            serializer.validated_data.get("note", ""),
        )

    @action(detail=True, methods=["post"], url_path="set-status")
    def set_status(self, request, pk=None):
        match = self.get_object()
        serializer = LeadPropertyStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.set_match_status(
            match, serializer.validated_data["status"], request.user, serializer.validated_data.get("note", "")
        )
        return Response(self.get_serializer(match).data)
