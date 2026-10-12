from rest_framework import serializers

from leads.models import Lead
from leads.serializers import LeadMiniSerializer
from properties.models import Property
from properties.serializers import PropertyMiniSerializer
from users.models import User
from users.serializers import UserMiniSerializer

from .models import Deal, Offer


class DealSerializer(serializers.ModelSerializer):
    lead = LeadMiniSerializer(read_only=True)
    property = PropertyMiniSerializer(read_only=True)
    assigned_to = UserMiniSerializer(read_only=True)
    lead_id = serializers.PrimaryKeyRelatedField(queryset=Lead.objects.all(), source="lead", write_only=True)
    property_id = serializers.PrimaryKeyRelatedField(
        queryset=Property.objects.all(), source="property", write_only=True
    )
    assigned_to_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True), source="assigned_to", write_only=True, required=False
    )
    stage_label = serializers.CharField(source="get_stage_display", read_only=True)

    class Meta:
        model = Deal
        fields = [
            "id", "lead", "lead_id", "property", "property_id", "assigned_to", "assigned_to_id", "stage",
            "stage_label", "offer_amount", "sale_price", "expected_close_date", "closed_at", "lost_reason",
            "notes", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "stage", "sale_price", "closed_at", "lost_reason", "created_at", "updated_at"]

    def validate_offer_amount(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("Offer amount must be greater than zero.")
        return value


class DealDetailSerializer(DealSerializer):
    offers = serializers.SerializerMethodField()
    commission = serializers.SerializerMethodField()

    class Meta(DealSerializer.Meta):
        fields = DealSerializer.Meta.fields + ["offers", "commission"]

    def get_offers(self, obj: Deal):
        return OfferSerializer(obj.offers.select_related("lead", "property", "submitted_by"), many=True).data

    def get_commission(self, obj: Deal):
        from commissions.serializers import CommissionSerializer

        commission = getattr(obj, "commission", None)
        return CommissionSerializer(commission).data if commission else None


class MoveStageSerializer(serializers.Serializer):
    stage = serializers.ChoiceField(choices=Deal.Stage.choices)
    lost_reason = serializers.CharField(required=False, allow_blank=True, max_length=255)
    sale_price = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)


class OfferSerializer(serializers.ModelSerializer):
    lead = LeadMiniSerializer(read_only=True)
    property = PropertyMiniSerializer(read_only=True)
    submitted_by = UserMiniSerializer(read_only=True)
    deal_id = serializers.PrimaryKeyRelatedField(queryset=Deal.objects.all(), source="deal", write_only=True)
    deal = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Offer
        fields = [
            "id", "deal", "deal_id", "lead", "property", "amount", "status", "conditions", "notes",
            "submitted_by", "created_at",
        ]
        read_only_fields = ["id", "status", "created_at"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Offer amount must be greater than zero.")
        return value


class OfferStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Offer.Status.choices)


class OfferCreateSerializer(serializers.Serializer):
    """Create an offer from a lead + property; the deal is opened automatically if needed."""

    lead_id = serializers.PrimaryKeyRelatedField(queryset=Lead.objects.all(), source="lead")
    property_id = serializers.PrimaryKeyRelatedField(queryset=Property.objects.all(), source="property")
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=1)
    conditions = serializers.CharField(required=False, allow_blank=True, max_length=255)
    notes = serializers.CharField(required=False, allow_blank=True)
    expected_close_date = serializers.DateField(required=False, allow_null=True)
