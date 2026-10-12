import django_filters as filters

from .models import Viewing


class ViewingFilter(filters.FilterSet):
    status = filters.BaseInFilter(field_name="status")
    start_after = filters.IsoDateTimeFilter(field_name="start_at", lookup_expr="gte")
    start_before = filters.IsoDateTimeFilter(field_name="start_at", lookup_expr="lt")
    mine = filters.BooleanFilter(method="filter_mine")

    class Meta:
        model = Viewing
        fields = ["assigned_to", "lead", "property", "status"]

    def filter_mine(self, queryset, name, value):
        return queryset.filter(assigned_to=self.request.user) if value else queryset
