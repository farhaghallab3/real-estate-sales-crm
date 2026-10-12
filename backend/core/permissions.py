from rest_framework.permissions import SAFE_METHODS, BasePermission


def is_manager(user) -> bool:
    return bool(user and user.is_authenticated and user.role in ("admin", "manager"))


def is_admin(user) -> bool:
    return bool(user and user.is_authenticated and user.role == "admin")


def scope_to_user(queryset, user, field: str = "assigned_to"):
    """Salespeople only see rows assigned to them; managers and admins see all."""
    if is_manager(user):
        return queryset
    return queryset.filter(**{field: user})


class IsManagerOrAdmin(BasePermission):
    message = "Manager or admin access required."

    def has_permission(self, request, view) -> bool:
        return is_manager(request.user)


class IsAdminRole(BasePermission):
    message = "Admin access required."

    def has_permission(self, request, view) -> bool:
        return is_admin(request.user)


class IsManagerOrReadOnly(BasePermission):
    def has_permission(self, request, view) -> bool:
        return request.method in SAFE_METHODS or is_manager(request.user)
