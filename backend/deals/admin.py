from django import forms
from django.contrib import admin

from .models import Deal, Offer


@admin.register(Deal)
class DealAdmin(admin.ModelAdmin):
    """The sale rules (one closed deal per property, a commission per closing, the property's sold status) live in deals.services and are
    enforced under row locks. The admin must not be a way around them: the stage and the closing figures are changed only through the API,
    and the client and property of a deal are fixed once it exists (its offers, history and commission refer to them)."""

    list_display = ("id", "lead", "property", "stage", "assigned_to")
    list_filter = ("stage",)
    readonly_fields = ("stage", "sale_price", "closed_at", "lost_reason")

    def get_readonly_fields(self, request, obj=None):
        fields = list(super().get_readonly_fields(request, obj))
        if obj is not None:
            fields += ["lead", "property"]
        if obj is not None and obj.stage == Deal.Stage.CLOSED:  # a closed deal is part of the sales record: read-only here too
            fields += [f.name for f in self.model._meta.fields if f.name not in fields]
        return fields

    def has_delete_permission(self, request, obj=None):
        if obj is not None and obj.stage == Deal.Stage.CLOSED:
            return False
        return super().has_delete_permission(request, obj)


class OfferAdminForm(forms.ModelForm):
    class Meta:
        model = Offer
        fields = "__all__"

    def clean(self):
        data = super().clean()
        deal = data.get("deal")
        if self.instance.pk or deal is None:  # existing offers keep their deal, client and property (read-only below)
            return data
        if deal.stage == Deal.Stage.CLOSED:
            raise forms.ValidationError("This deal is closed: no offer can be added to it.")
        if data.get("property") and data["property"].pk != deal.property_id:
            raise forms.ValidationError("The offer's property must be the property of its deal.")
        if data.get("lead") and data["lead"].pk != deal.lead_id:
            raise forms.ValidationError("The offer's client must be the client of its deal.")
        return data


@admin.register(Offer)
class OfferAdmin(admin.ModelAdmin):
    """Offers of a closed deal are part of the sales record: no change, no delete (single or bulk: the bulk action asks this per offer)."""

    form = OfferAdminForm
    list_display = ("id", "deal", "amount", "status")

    def get_readonly_fields(self, request, obj=None):
        return ("deal", "lead", "property") if obj is not None else ()

    @staticmethod
    def _sealed(obj) -> bool:
        return obj is not None and obj.deal.stage == Deal.Stage.CLOSED

    def has_change_permission(self, request, obj=None):
        return not self._sealed(obj) and super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        return not self._sealed(obj) and super().has_delete_permission(request, obj)
