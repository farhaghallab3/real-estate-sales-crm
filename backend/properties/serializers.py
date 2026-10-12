from rest_framework import serializers

from users.models import User
from users.serializers import UserMiniSerializer

from .models import Property, PropertyImage


class PropertyImageSerializer(serializers.ModelSerializer):
    src = serializers.SerializerMethodField()

    class Meta:
        model = PropertyImage
        fields = ["id", "src", "caption"]

    def get_src(self, obj: PropertyImage) -> str:
        if obj.file:
            return obj.file.url
        return obj.url


class PropertyMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = Property
        fields = ["id", "reference", "title", "address", "city", "price", "status", "property_type"]


class PropertySerializer(serializers.ModelSerializer):
    assigned_to = UserMiniSerializer(read_only=True)
    assigned_to_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True), source="assigned_to", write_only=True, required=False,
        allow_null=True,
    )
    cover_image = serializers.SerializerMethodField()
    image_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Property
        fields = [
            "id", "reference", "title", "address", "city", "price", "property_type", "bedrooms", "bathrooms",
            "area_sqm", "status", "description", "assigned_to", "assigned_to_id", "cover_image", "image_count",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "reference", "created_at", "updated_at"]

    def get_cover_image(self, obj: Property) -> str | None:
        images = list(obj.images.all())
        if not images:
            return None
        return PropertyImageSerializer(images[0]).data["src"] or None

    def validate_price(self, value):
        if value <= 0:
            raise serializers.ValidationError("Price must be greater than zero.")
        return value


class PropertyDetailSerializer(PropertySerializer):
    images = PropertyImageSerializer(many=True, read_only=True)
    interested_leads = serializers.SerializerMethodField()
    viewings = serializers.SerializerMethodField()
    offers = serializers.SerializerMethodField()
    open_deals = serializers.SerializerMethodField()

    class Meta(PropertySerializer.Meta):
        fields = PropertySerializer.Meta.fields + ["images", "interested_leads", "viewings", "offers", "open_deals"]

    # Lazy imports keep module dependency one-directional (leads/deals/viewings import properties).
    # Salespeople only see related records of their own leads/deals; managers see everything.
    def _scoped(self, qs, field: str):
        from core.permissions import scope_to_user

        request = self.context.get("request")
        return scope_to_user(qs, request.user, field) if request else qs

    def get_interested_leads(self, obj: Property):
        from leads.serializers import LeadPropertySerializer

        qs = self._scoped(obj.lead_matches.all(), "lead__assigned_to")
        qs = qs.select_related("lead", "lead__assigned_to", "property").order_by("-updated_at")
        return LeadPropertySerializer(qs, many=True, context=self.context, exclude_property=True).data

    def get_viewings(self, obj: Property):
        from viewings.serializers import ViewingSerializer

        qs = self._scoped(obj.viewings.all(), "assigned_to")
        qs = qs.select_related("lead", "property", "assigned_to").order_by("-start_at")[:20]
        return ViewingSerializer(qs, many=True, context=self.context).data

    def get_offers(self, obj: Property):
        from deals.serializers import OfferSerializer

        qs = self._scoped(obj.offers.all(), "deal__assigned_to")
        qs = qs.select_related("lead", "property", "submitted_by").order_by("-created_at")[:20]
        return OfferSerializer(qs, many=True, context=self.context).data

    def get_open_deals(self, obj: Property):
        from deals.models import Deal
        from deals.serializers import DealSerializer

        qs = self._scoped(obj.deals.exclude(stage__in=Deal.TERMINAL_STAGES), "assigned_to")
        return DealSerializer(qs.select_related("lead", "property", "assigned_to"), many=True, context=self.context).data
