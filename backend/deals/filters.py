import django_filters as filters

from .models import Deal, Offer


class DealFilter(filters.FilterSet):
    stage = filters.BaseInFilter(field_name="stage")
    state = filters.ChoiceFilter(
        choices=[("open", "Open"), ("closed", "Closed"), ("lost", "Lost")], method="filter_state"
    )
    expected_after = filters.DateFilter(field_name="expected_close_date", lookup_expr="gte")
    expected_before = filters.DateFilter(field_name="expected_close_date", lookup_expr="lte")
    mine = filters.BooleanFilter(method="filter_mine")

    class Meta:
        model = Deal
        fields = ["assigned_to", "lead", "property", "stage"]

    def filter_state(self, queryset, name, value):
        if value == "open":
            return queryset.exclude(stage__in=Deal.TERMINAL_STAGES)
        return queryset.filter(stage=value)

    def filter_mine(self, queryset, name, value):
        return queryset.filter(assigned_to=self.request.user) if value else queryset


class OfferFilter(filters.FilterSet):
    class Meta:
        model = Offer
        fields = ["lead", "property", "deal", "status"]
