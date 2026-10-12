from rest_framework import serializers

from deals.models import Deal
from users.serializers import UserMiniSerializer

from .models import Document


class DocumentSerializer(serializers.ModelSerializer):
    uploaded_by = UserMiniSerializer(read_only=True)
    category_label = serializers.CharField(source="get_category_display", read_only=True)
    deal_label = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            "id", "deal", "deal_label", "category", "category_label", "name", "size", "content_type",
            "uploaded_by", "created_at",
        ]
        read_only_fields = fields

    def get_deal_label(self, obj: Document) -> str:
        return f"{obj.deal.lead.name} · {obj.deal.property.title}"


class DocumentUploadSerializer(serializers.Serializer):
    deal = serializers.PrimaryKeyRelatedField(queryset=Deal.objects.all())
    category = serializers.ChoiceField(choices=Document.Category.choices)
    file = serializers.FileField()
    name = serializers.CharField(required=False, allow_blank=True, max_length=255)
