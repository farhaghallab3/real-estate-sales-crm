from django.contrib import admin

from deals.protection import ClosedSaleDeleteGuard

from .models import Property, PropertyImage


class PropertyImageInline(admin.TabularInline):
    model = PropertyImage
    extra = 0


@admin.register(Property)
class PropertyAdmin(ClosedSaleDeleteGuard, admin.ModelAdmin):
    list_display = ("reference", "title", "city", "price", "status", "assigned_to")
    list_filter = ("status", "property_type", "city")
    search_fields = ("title", "address", "reference")
    inlines = [PropertyImageInline]

    def get_readonly_fields(self, request, obj=None):
        fields = list(super().get_readonly_fields(request, obj))
        if obj is not None and obj.deals.filter(stage="closed").exists():  # sold through a closed deal: the status only changes with the sale
            fields.append("status")
        return fields
