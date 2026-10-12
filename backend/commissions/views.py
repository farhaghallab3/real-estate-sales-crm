from django.db.models import Sum
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.permissions import IsManagerOrAdmin, scope_to_user

from . import services
from .models import Commission
from .serializers import CommissionSerializer, CommissionTermsSerializer


class CommissionViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = CommissionSerializer
    filterset_fields = ["status", "salesperson", "deal"]
    search_fields = ["deal__property__title", "deal__lead__first_name", "deal__lead__last_name"]
    ordering_fields = ["created_at", "sale_price", "net_commission", "status"]

    def get_queryset(self):
        qs = Commission.objects.select_related("deal__property", "deal__lead", "salesperson")
        return scope_to_user(qs, self.request.user, "salesperson")

    @action(detail=False, methods=["get"])
    def summary(self, request):
        qs = self.filter_queryset(self.get_queryset()).order_by()
        totals = {}
        for status in Commission.Status.values:
            agg = qs.filter(status=status).aggregate(net=Sum("net_commission"), gross=Sum("gross_commission"))
            totals[status] = {"net": agg["net"] or 0, "gross": agg["gross"] or 0}
        return Response(totals)

    @action(detail=True, methods=["post"], permission_classes=[IsManagerOrAdmin])
    def approve(self, request, pk=None):
        return Response(self.get_serializer(services.approve(self.get_object(), request.user)).data)

    @action(detail=True, methods=["post"], url_path="mark-paid", permission_classes=[IsManagerOrAdmin])
    def mark_paid(self, request, pk=None):
        return Response(self.get_serializer(services.mark_paid(self.get_object(), request.user)).data)

    @action(detail=True, methods=["patch"], url_path="terms", permission_classes=[IsManagerOrAdmin])
    def terms(self, request, pk=None):
        serializer = CommissionTermsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        commission = services.update_terms(self.get_object(), request.user, **serializer.validated_data)
        return Response(self.get_serializer(commission).data)
