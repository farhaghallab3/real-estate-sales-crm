from django.conf import settings
from django.db.models import Count
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import SAFE_METHODS, BasePermission, IsAuthenticated
from rest_framework.response import Response

from core.exceptions import BusinessRuleViolation
from core.permissions import is_manager

from .filters import PropertyFilter
from .models import Property, PropertyImage
from .serializers import PropertyDetailSerializer, PropertyImageSerializer, PropertySerializer
from .services import record_price_change


class CanEditProperty(BasePermission):
    def has_object_permission(self, request, view, obj: Property) -> bool:
        if request.method in SAFE_METHODS:
            return True
        if request.method == "DELETE":
            return is_manager(request.user)
        return is_manager(request.user) or obj.assigned_to_id in (None, request.user.id)


class PropertyViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, CanEditProperty]
    filterset_class = PropertyFilter
    search_fields = ["title", "address", "city", "reference"]
    ordering_fields = ["created_at", "price", "title", "bedrooms", "area_sqm", "status", "city"]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def get_queryset(self):
        return (
            Property.objects.select_related("assigned_to")
            .prefetch_related("images")
            .annotate(image_count=Count("images", distinct=True))
            .order_by("-created_at", "-id")
        )

    def get_serializer_class(self):
        return PropertyDetailSerializer if self.action == "retrieve" else PropertySerializer

    def perform_create(self, serializer):
        extra = {}
        if not is_manager(self.request.user) and "assigned_to" not in serializer.validated_data:
            extra["assigned_to"] = self.request.user
        serializer.save(**extra)

    def perform_update(self, serializer):
        old_price = serializer.instance.price
        prop = serializer.save()
        record_price_change(prop, old_price, self.request.user)

    @action(detail=False, methods=["get"])
    def cities(self, request):
        """Distinct locations for filter dropdowns."""
        names = Property.objects.order_by("city").values_list("city", flat=True).distinct()
        return Response(list(names))

    @action(detail=True, methods=["post"], url_path="images")
    def add_image(self, request, pk=None):
        prop = self.get_object()
        upload = request.FILES.get("file")
        url = request.data.get("url", "")
        if not upload and not url:
            raise BusinessRuleViolation("Provide an image file or a url.")
        if upload:
            ext = "." + upload.name.rsplit(".", 1)[-1].lower() if "." in upload.name else ""
            if ext not in {".png", ".jpg", ".jpeg", ".webp"}:
                raise BusinessRuleViolation("Images must be PNG, JPG or WEBP.")
            if upload.size > settings.MAX_UPLOAD_BYTES:
                raise BusinessRuleViolation("Image is too large.")
        image = PropertyImage.objects.create(
            property=prop, file=upload or "", url="" if upload else url, caption=request.data.get("caption", "")
        )
        return Response(PropertyImageSerializer(image).data, status=201)

    @action(detail=True, methods=["delete"], url_path=r"images/(?P<image_id>\d+)")
    def remove_image(self, request, pk=None, image_id=None):
        prop = self.get_object()
        prop.images.filter(pk=image_id).delete()
        return Response(status=204)
