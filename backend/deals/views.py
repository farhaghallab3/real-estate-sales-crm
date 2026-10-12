from decimal import Decimal

from django.db.models import Count, Sum
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.exceptions import BusinessRuleViolation
from core.permissions import is_manager, scope_to_user

from . import services
from .filters import DealFilter, OfferFilter
from .models import Deal, Offer
from .serializers import (
    DealDetailSerializer,
    DealSerializer,
    MoveStageSerializer,
    OfferCreateSerializer,
    OfferSerializer,
    OfferStatusSerializer,
)


class DealViewSet(viewsets.ModelViewSet):
    filterset_class = DealFilter
    search_fields = ["lead__first_name", "lead__last_name", "property__title", "property__address"]
    ordering_fields = ["updated_at", "created_at", "offer_amount", "expected_close_date", "stage"]

    def get_queryset(self):
        qs = Deal.objects.select_related("lead", "property", "assigned_to", "commission")
        return scope_to_user(qs, self.request.user)

    def get_serializer_class(self):
        return DealDetailSerializer if self.action == "retrieve" else DealSerializer

    def get_permissions(self):
        permissions = super().get_permissions()
        if self.action == "destroy":
            from core.permissions import IsManagerOrAdmin

            permissions.append(IsManagerOrAdmin())
        return permissions

    def perform_create(self, serializer):
        user = self.request.user
        lead = serializer.validated_data["lead"]
        if not is_manager(user) and lead.assigned_to_id != user.id:
            raise BusinessRuleViolation("You can only open deals for your own leads.")
        prop = serializer.validated_data["property"]
        if Deal.objects.filter(lead=lead, property=prop).exclude(stage__in=Deal.TERMINAL_STAGES).exists():
            raise BusinessRuleViolation("There is already an open deal for this lead and property.")
        assignee = serializer.validated_data.get("assigned_to") or lead.assigned_to or user
        if not is_manager(user):
            assignee = user
        deal = serializer.save(assigned_to=assignee)
        services.log_activity(
            actor=user, kind="deal_created", message=f"Deal opened: {lead.name} · {prop.title}", deal=deal
        )

    def perform_update(self, serializer):
        if not serializer.instance.is_open:
            raise BusinessRuleViolation("Closed or lost deals can no longer be edited.")
        serializer.save()

    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        deal = self.get_object()
        serializer = MoveStageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        services.move_stage(
            deal, d["stage"], request.user, lost_reason=d.get("lost_reason", ""), sale_price=d.get("sale_price")
        )
        deal.refresh_from_db()
        return Response(DealDetailSerializer(deal, context={"request": request}).data)

    @action(detail=False, methods=["get"])
    def pipeline(self, request):
        """Kanban payload: every stage with its count, total value and cards (closed limited to recent)."""
        qs = self.filter_queryset(self.get_queryset()).order_by("-updated_at")
        columns = []
        for stage in Deal.PIPELINE_ORDER + ["lost"]:
            stage_qs = qs.filter(stage=stage)
            agg = stage_qs.aggregate(n=Count("id"), value=Sum("offer_amount"))
            cards = stage_qs[:50]
            columns.append(
                {
                    "stage": stage,
                    "label": Deal.Stage(stage).label,
                    "count": agg["n"] or 0,
                    "value": agg["value"] or Decimal("0"),
                    "deals": DealSerializer(cards, many=True, context={"request": request}).data,
                }
            )
        return Response({"columns": columns})

    @action(detail=True, methods=["get"])
    def checklist(self, request, pk=None):
        from documents.services import checklist_for

        return Response(checklist_for(self.get_object()))


class OfferViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    serializer_class = OfferSerializer
    filterset_class = OfferFilter
    ordering_fields = ["created_at", "amount"]

    def get_queryset(self):
        qs = Offer.objects.select_related("lead", "property", "submitted_by")
        return scope_to_user(qs, self.request.user, "deal__assigned_to")

    def create(self, request, *args, **kwargs):
        """Accepts lead_id + property_id (deal is found or opened) or deal_id."""
        if "deal_id" in request.data:
            serializer = OfferSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            deal = serializer.validated_data["deal"]
            if not is_manager(request.user) and deal.assigned_to_id != request.user.id:
                raise BusinessRuleViolation("You can only record offers on your own deals.")
            data = serializer.validated_data
        else:
            serializer = OfferCreateSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
            lead = data["lead"]
            if not is_manager(request.user) and lead.assigned_to_id != request.user.id:
                raise BusinessRuleViolation("You can only record offers for your own leads.")
            deal, _ = services.get_or_create_open_deal(lead, data["property"], request.user)
            if data.get("expected_close_date"):
                deal.expected_close_date = data["expected_close_date"]
                deal.save(update_fields=["expected_close_date", "updated_at"])
        offer = services.submit_offer(
            deal, data["amount"], request.user, data.get("conditions", ""), data.get("notes", "")
        )
        return Response(OfferSerializer(offer).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="set-status")
    def set_status(self, request, pk=None):
        serializer = OfferStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        offer = services.set_offer_status(self.get_object(), serializer.validated_data["status"], request.user)
        return Response(OfferSerializer(offer).data)
