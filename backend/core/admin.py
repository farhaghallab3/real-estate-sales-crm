from django.contrib import admin

from .models import Activity


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display = ("created_at", "kind", "message", "actor")
    list_filter = ("kind",)
