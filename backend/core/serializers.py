from rest_framework import serializers

from users.serializers import UserMiniSerializer

from .models import Activity


class ActivitySerializer(serializers.ModelSerializer):
    actor = UserMiniSerializer(read_only=True)
    lead_name = serializers.SerializerMethodField()

    class Meta:
        model = Activity
        fields = ["id", "kind", "message", "actor", "lead", "lead_name", "property", "deal", "created_at"]

    def get_lead_name(self, obj: Activity) -> str | None:
        return obj.lead.name if obj.lead_id else None
