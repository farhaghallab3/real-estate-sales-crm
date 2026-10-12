from rest_framework import serializers

from properties.serializers import PropertyMiniSerializer
from users.serializers import UserMiniSerializer

from .models import Commission


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


class CommissionTermsSerializer(serializers.Serializer):
    commission_rate = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100, required=False)
    agent_split = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100, required=False)
    deductions = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, required=False)
