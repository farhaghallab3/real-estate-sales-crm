from rest_framework import serializers

from properties.models import Property
from properties.serializers import PropertyMiniSerializer
from users.models import User
from users.serializers import UserMiniSerializer

from .models import Lead, LeadNote, LeadProperty


class LeadMiniSerializer(serializers.ModelSerializer):
    name = serializers.CharField(read_only=True)

    class Meta:
        model = Lead
        fields = ["id", "name", "phone", "email", "status"]


class LeadSerializer(serializers.ModelSerializer):
    name = serializers.CharField(read_only=True)
    assigned_to = UserMiniSerializer(read_only=True)
    assigned_to_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True), source="assigned_to", write_only=True, required=False,
        allow_null=True,
    )
    next_follow_up = serializers.DateTimeField(read_only=True, default=None)

    class Meta:
        model = Lead
        fields = [
            "id", "name", "first_name", "last_name", "phone", "email", "source", "budget", "preferred_location",
            "status", "lost_reason", "assigned_to", "assigned_to_id", "last_activity_at", "next_follow_up",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "status", "lost_reason", "last_activity_at", "created_at", "updated_at"]

    def validate_budget(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Budget cannot be negative.")
        return value


class AssignSerializer(serializers.Serializer):
    assigned_to_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True), source="assigned_to", allow_null=True
    )


class ChangeStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Lead.Status.choices)
    lost_reason = serializers.CharField(required=False, allow_blank=True, max_length=255)


class LeadNoteSerializer(serializers.ModelSerializer):
    author = UserMiniSerializer(read_only=True)

    class Meta:
        model = LeadNote
        fields = ["id", "body", "author", "created_at"]
        read_only_fields = ["id", "author", "created_at"]


class LeadPropertySerializer(serializers.ModelSerializer):
    lead = LeadMiniSerializer(read_only=True)
    property = PropertyMiniSerializer(read_only=True)
    lead_id = serializers.PrimaryKeyRelatedField(queryset=Lead.objects.all(), source="lead", write_only=True)
    property_id = serializers.PrimaryKeyRelatedField(queryset=Property.objects.all(), source="property", write_only=True)
    added_by = UserMiniSerializer(read_only=True)
    assigned_to = serializers.SerializerMethodField()

    class Meta:
        model = LeadProperty
        fields = [
            "id", "lead", "lead_id", "property", "property_id", "status", "note", "added_by", "assigned_to",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def __init__(self, *args, exclude_property: bool = False, **kwargs):
        super().__init__(*args, **kwargs)
        if exclude_property:
            self.fields.pop("property", None)

    def get_assigned_to(self, obj: LeadProperty):
        user = obj.lead.assigned_to
        return UserMiniSerializer(user).data if user else None


class LeadPropertyStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=LeadProperty.Status.choices)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)
