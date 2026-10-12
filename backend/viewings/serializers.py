from rest_framework import serializers

from leads.models import Lead
from leads.serializers import LeadMiniSerializer
from properties.models import Property
from properties.serializers import PropertyMiniSerializer
from users.models import User
from users.serializers import UserMiniSerializer

from .models import Viewing


class ViewingSerializer(serializers.ModelSerializer):
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

    class Meta:
        model = Viewing
        fields = [
            "id", "lead", "lead_id", "property", "property_id", "assigned_to", "assigned_to_id", "start_at",
            "end_at", "status", "feedback", "rating", "created_at",
        ]
        read_only_fields = ["id", "status", "feedback", "rating", "created_at"]

    def validate(self, attrs):
        start = attrs.get("start_at", getattr(self.instance, "start_at", None))
        end = attrs.get("end_at", getattr(self.instance, "end_at", None))
        if start and end and end <= start:
            raise serializers.ValidationError({"end_at": "End time must be after the start time."})
        return attrs


class CompleteViewingSerializer(serializers.Serializer):
    feedback = serializers.CharField(required=False, allow_blank=True)
    rating = serializers.IntegerField(required=False, min_value=1, max_value=5, allow_null=True)


class CancelViewingSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, max_length=255)


class ConflictCheckSerializer(serializers.Serializer):
    start_at = serializers.DateTimeField()
    end_at = serializers.DateTimeField()
    assigned_to_id = serializers.IntegerField(required=False, allow_null=True)
    property_id = serializers.IntegerField(required=False, allow_null=True)
    exclude_id = serializers.IntegerField(required=False, allow_null=True)
