from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Sum
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.exceptions import BusinessRuleViolation
from core.permissions import is_manager, scope_to_user

from . import services
from .protection import SALE_RECORD_MESSAGE
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
        self._ensure_no_open_duplicate(lead, prop)
        assignee = serializer.validated_data.get("assigned_to") or lead.assigned_to or user
        if not is_manager(user):
            assignee = user
        deal = serializer.save(assigned_to=assignee)
        services.log_activity(
            actor=user, kind="deal_created", message=f"Deal opened: {lead.name} · {prop.title}", deal=deal
        )

    @staticmethod
    def _ensure_no_open_duplicate(lead, prop, exclude_pk=None):
        open_deals = Deal.objects.filter(lead=lead, property=prop).exclude(stage__in=Deal.TERMINAL_STAGES)
        if exclude_pk is not None:
            open_deals = open_deals.exclude(pk=exclude_pk)
        if open_deals.exists():
            raise BusinessRuleViolation("There is already an open deal for this lead and property.")

    def perform_update(self, serializer):
        deal, user, data = serializer.instance, self.request.user, serializer.validated_data
        # One transaction under the sale-related locks (property rows, then the deal row): a closing that finishes first is seen here, so a
        # stale copy of the deal can never be written back over it (the full save below would otherwise reopen a just-closed deal).
        with transaction.atomic():
            services.lock_deal(deal, extra_property_ids=[data["property"].pk] if "property" in data else [])
            self._update_locked(serializer, deal, user, data)

    def _update_locked(self, serializer, deal, user, data):
        if not deal.is_open:
            raise BusinessRuleViolation("Closed or lost deals can no longer be edited.")
        new_assignee = data.get("assigned_to", deal.assigned_to)
        if new_assignee != deal.assigned_to and not is_manager(user):
            raise BusinessRuleViolation("Only managers can reassign deals.")
        lead, prop = data.get("lead", deal.lead), data.get("property", deal.property)
        if lead.pk != deal.lead_id and not is_manager(user) and lead.assigned_to_id != user.id:
            raise BusinessRuleViolation("You can only link a deal to your own leads.")
        if (lead.pk, prop.pk) != (deal.lead_id, deal.property_id):
            # Offers record what was offered by this client on this property: they are never re-pointed, so a deal that has offers keeps
            # its client and property. (Read under the deal's lock; submit_offer takes the same lock before it inserts an offer.)
            if deal.offers.exists():
                raise BusinessRuleViolation(
                    "This deal already has offers, so its client and property can no longer be changed. Open a new deal instead."
                )
            self._ensure_no_open_duplicate(lead, prop, exclude_pk=deal.pk)
        if prop.pk != deal.property_id and deal.stage in services.SALE_STAGES and services.sold_in_another_deal(prop):
            raise BusinessRuleViolation(services.SOLD_MESSAGE)  # a deal already in the sale stages cannot be moved onto a sold property
        serializer.save()

    def perform_destroy(self, instance):
        with transaction.atomic():
            services.lock_deal(instance)
            if instance.stage == Deal.Stage.CLOSED:
                raise BusinessRuleViolation(SALE_RECORD_MESSAGE)
            instance.delete()

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
            if services.sold_in_another_deal(data["property"]):
                # Refuse before a deal is opened: submit_offer would refuse it anyway, but only after a stray deal had been created.
                raise BusinessRuleViolation(services.SOLD_MESSAGE + " No new offers can be recorded on it.")
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
