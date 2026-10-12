import django_filters as filters

from .models import Property


class PropertyFilter(filters.FilterSet):
    price_min = filters.NumberFilter(field_name="price", lookup_expr="gte")
    price_max = filters.NumberFilter(field_name="price", lookup_expr="lte")
    bedrooms_min = filters.NumberFilter(field_name="bedrooms", lookup_expr="gte")
    city = filters.CharFilter(field_name="city", lookup_expr="iexact")
    status = filters.BaseInFilter(field_name="status")
    property_type = filters.BaseInFilter(field_name="property_type")
    unassigned = filters.BooleanFilter(field_name="assigned_to", lookup_expr="isnull")

    class Meta:
        model = Property
        fields = ["assigned_to", "city", "status", "property_type"]
