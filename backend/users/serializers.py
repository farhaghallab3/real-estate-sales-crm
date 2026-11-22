from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .accounts import assignable_users, company_users, is_technical
from .authentication import TOKEN_VERSION_CLAIM
from .models import Role, User


class AssignableUserField(serializers.PrimaryKeyRelatedField):
    """Pick a user to hand work to: active company accounts only, never a technical (provider) account.

    A record that is ALREADY assigned to a technical account (legacy data) can still be saved with that same value
    re-sent unchanged, so old records stay editable; choosing a technical account as a new assignee is refused.
    """

    def __init__(self, **kwargs):
        kwargs.setdefault("queryset", assignable_users())
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        try:
            return super().to_internal_value(data)
        except serializers.ValidationError:
            current = self._current_assignee()
            if current is not None and str(data) == str(current.pk):
                return current
            raise

    def _current_assignee(self):
        instance = getattr(self.parent, "instance", None)
        if instance is None or not hasattr(instance, "pk") or not self.source:
            return None
        value = getattr(instance, self.source, None)
        return value if value is not None and value.is_active and is_technical(value) else None


class UserMiniSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "full_name", "role"]


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "email", "first_name", "last_name", "full_name", "role", "phone", "job_title",
            "commission_split", "is_active", "must_change_password", "date_joined",
        ]
        read_only_fields = [
            "id", "email", "role", "commission_split", "is_active", "must_change_password", "date_joined",
        ]

    def to_representation(self, instance):
        # Own profile only (/auth/me/ and the login response). commission_split is Admin-only data.
        data = super().to_representation(instance)
        if instance.role != Role.ADMIN:
            data.pop("commission_split", None)
        return data


class ProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["first_name", "last_name", "phone", "job_title"]


class UserAdminSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, min_length=8)
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "email", "first_name", "last_name", "full_name", "role", "phone", "job_title",
            "commission_split", "is_active", "must_change_password", "password", "date_joined",
        ]
        read_only_fields = ["id", "date_joined"]

    def to_representation(self, instance):
        # commission_split is Admin-only: removed here, so it never leaves the API for managers (list and detail).
        data = super().to_representation(instance)
        request = self.context.get("request")
        if not (request and request.user.is_authenticated and request.user.role == Role.ADMIN):
            data.pop("commission_split", None)
        return data

    def validate_commission_split(self, value):
        if not 0 <= value <= 100:
            raise serializers.ValidationError("Split must be between 0 and 100.")
        return value

    def validate_email(self, value: str) -> str:
        # The default unique check is case-sensitive; emails are stored lower-cased, so compare case-insensitively.
        value = value.strip().lower()
        clash = User.objects.filter(email__iexact=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate(self, attrs):
        if self.instance is None and not attrs.get("password"):
            raise serializers.ValidationError({"password": "Password is required."})
        if attrs.get("password"):
            validate_password(attrs["password"])
        self._protect_last_admin(attrs)
        return attrs

    def _protect_last_admin(self, attrs):
        """A company must always keep at least one active Company Admin.

        Only company accounts count: a technical (staff/superuser) account never stands in for a Company Admin.
        """
        user = self.instance
        if user is None or is_technical(user) or user.role != Role.ADMIN or not user.is_active:
            return
        demoted = attrs.get("role", user.role) != Role.ADMIN
        deactivated = not attrs.get("is_active", user.is_active)
        if not (demoted or deactivated):
            return
        if not company_users().filter(role=Role.ADMIN, is_active=True).exclude(pk=user.pk).exists():
            field = "role" if demoted else "is_active"
            raise serializers.ValidationError({field: "At least one active Company Admin must remain."})

    def create(self, validated_data):
        password = validated_data.pop("password")
        validated_data.setdefault("role", Role.SALESPERSON)
        validated_data.setdefault("must_change_password", True)  # the admin chose a temporary password
        return User.objects.create_user(password=password, **validated_data)

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)  # also revokes every token issued before now
            if "must_change_password" not in validated_data:
                request = self.context.get("request")
                # an admin resetting someone else's password hands over a temporary one; resetting your own is a choice
                instance.must_change_password = not (request and request.user.pk == instance.pk)
        # is_staff / is_superuser (Django admin access) are never touched here: technical accounts only.
        instance.save()
        return instance


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        validate_password(value, self.context["request"].user)
        return value

    def validate(self, attrs):
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError({"new_password": "Choose a password different from the current one."})
        return attrs


class LoginSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token[TOKEN_VERSION_CLAIM] = user.token_version  # a password change makes every older token invalid
        return token

    def validate(self, attrs):
        # Emails are stored lowercased; make login tolerant of case and stray whitespace.
        attrs[self.username_field] = str(attrs.get(self.username_field, "")).strip().lower()
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data
