import django_filters as filters

from .models import Lead, LeadProperty


class LeadFilter(filters.FilterSet):
    status = filters.BaseInFilter(field_name="status")
    source = filters.BaseInFilter(field_name="source")
    location = filters.CharFilter(field_name="preferred_location", lookup_expr="icontains")
    budget_min = filters.NumberFilter(field_name="budget", lookup_expr="gte")
    budget_max = filters.NumberFilter(field_name="budget", lookup_expr="lte")
    created_after = filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    created_before = filters.DateFilter(field_name="created_at", lookup_expr="date__lte")
    unassigned = filters.BooleanFilter(field_name="assigned_to", lookup_expr="isnull")

    class Meta:
        model = Lead
        fields = ["status", "source", "assigned_to"]


class LeadPropertyFilter(filters.FilterSet):
    status = filters.BaseInFilter(field_name="status")

    class Meta:
        model = LeadProperty
        fields = ["lead", "property", "status"]
