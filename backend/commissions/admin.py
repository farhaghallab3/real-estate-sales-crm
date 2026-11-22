from django.contrib import admin

from .models import Commission


@admin.register(Commission)
class CommissionAdmin(admin.ModelAdmin):
    """A commission is created by closing a deal and managed through the API (approve, mark paid, terms, with the existing role checks). The
    admin only shows it: no add, no change, no delete (single or bulk), so it can neither be edited nor lost from here."""

    list_display = ("id", "deal", "salesperson", "sale_price", "net_commission", "status")
    list_filter = ("status",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
