from rest_framework import mixins, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from core.permissions import IsAdminRole, is_manager

from .models import User
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
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Everyone can list active users (assignee pickers). Only admins can create/modify."""

    queryset = User.objects.all()
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
