from rest_framework import serializers

from properties.serializers import PropertyMiniSerializer
from users.serializers import UserMiniSerializer

from users.models import Role

from .models import Commission

# Money breakdown that only the Company Admin sees. commission_rate and agent_commission are included on purpose:
# with the sale price (visible) they would reveal gross and deductions by simple arithmetic.
ADMIN_ONLY_FIELDS = ("commission_rate", "gross_commission", "agent_commission", "deductions")


class CommissionSerializer(serializers.ModelSerializer):
    property = PropertyMiniSerializer(source="deal.property", read_only=True)
    client = serializers.CharField(source="deal.lead.name", read_only=True)
    lead_id = serializers.IntegerField(source="deal.lead_id", read_only=True)
    salesperson = UserMiniSerializer(read_only=True)

    class Meta:
        model = Commission
        fields = [
            "id", "deal", "property", "client", "lead_id", "salesperson", "sale_price", "commission_rate",
            "gross_commission", "agent_split", "agent_commission", "deductions", "net_commission", "status",
            "approved_at", "paid_at", "created_at",
        ]
        read_only_fields = fields

    def to_representation(self, instance):
        """Role-based view of one commission. Default-deny: without a request the narrowest view is returned.

        Admin: everything. Manager: status and net value only. Salesperson: the same plus their own agent_split.
        """
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = request.user if request and request.user.is_authenticated else None
        role = user.role if user else None
        if role == Role.ADMIN:
            return data
        for field in ADMIN_ONLY_FIELDS:
            data.pop(field, None)
        if not (role == Role.SALESPERSON and instance.salesperson_id == user.id):
            data.pop("agent_split", None)
        return data


class CommissionTermsSerializer(serializers.Serializer):
    commission_rate = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100, required=False)
    agent_split = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100, required=False)
    deductions = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, required=False)
