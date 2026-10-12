from django.contrib import admin

from .models import Property, PropertyImage


class PropertyImageInline(admin.TabularInline):
    model = PropertyImage
    extra = 0


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = ("reference", "title", "city", "price", "status", "assigned_to")
    list_filter = ("status", "property_type", "city")
    search_fields = ("title", "address", "reference")
    inlines = [PropertyImageInline]
