from rest_framework import serializers

from deals.models import Deal
from leads.models import Lead
from leads.serializers import LeadMiniSerializer
from properties.models import Property
from properties.serializers import PropertyMiniSerializer
from users.models import User
from users.serializers import UserMiniSerializer

from .models import Task


class TaskSerializer(serializers.ModelSerializer):
    assigned_to = UserMiniSerializer(read_only=True)
    assigned_to_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True), source="assigned_to", write_only=True, required=False
    )
    lead = LeadMiniSerializer(read_only=True)
    lead_id = serializers.PrimaryKeyRelatedField(
        queryset=Lead.objects.all(), source="lead", write_only=True, required=False, allow_null=True
    )
    property = PropertyMiniSerializer(read_only=True)
    property_id = serializers.PrimaryKeyRelatedField(
        queryset=Property.objects.all(), source="property", write_only=True, required=False, allow_null=True
    )
    deal_id = serializers.PrimaryKeyRelatedField(
        queryset=Deal.objects.all(), source="deal", required=False, allow_null=True
    )
    is_overdue = serializers.BooleanField(read_only=True)

    class Meta:
        model = Task
        fields = [
            "id", "title", "description", "type", "status", "due_at", "completed_at", "is_overdue",
            "assigned_to", "assigned_to_id", "lead", "lead_id", "property", "property_id", "deal_id",
            "created_at",
        ]
        read_only_fields = ["id", "status", "completed_at", "created_at"]
