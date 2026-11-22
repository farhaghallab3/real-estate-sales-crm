from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from core.permissions import IsAdminRole, is_manager

from .accounts import company_users
from .serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    ProfileUpdateSerializer,
    UserAdminSerializer,
    UserMiniSerializer,
    UserSerializer,
)


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_scope = "login"


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        serializer = ProfileUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(UserSerializer(request.user).data)


class ChangePasswordView(APIView):
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.set_password(serializer.validated_data["new_password"])  # revokes every token issued before now
        user.must_change_password = False
        user.save(update_fields=["password", "password_changed_at", "must_change_password"])
        # the caller's own tokens were just revoked: hand back a fresh pair so the session continues
        refresh = LoginSerializer.get_token(user)
        return Response({"access": str(refresh.access_token), "refresh": str(refresh)})


class UserViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Everyone can list active users (assignee pickers). Only admins can create/modify."""

    queryset = company_users()  # technical (staff/superuser) accounts are never part of the company-facing API
    search_fields = ["first_name", "last_name", "email"]
    filterset_fields = ["role", "is_active"]
    pagination_class = None

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update"):
            return [IsAuthenticated(), IsAdminRole()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = super().get_queryset()
        if not is_manager(self.request.user):
            qs = qs.filter(is_active=True)
        return qs

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return UserAdminSerializer
        if is_manager(self.request.user):
            return UserAdminSerializer
        return UserMiniSerializer
