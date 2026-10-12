from django.contrib import admin

from .models import Lead, LeadNote, LeadProperty


@admin.register(Lead)
class LeadAdmin(admin.ModelAdmin):
    list_display = ("name", "phone", "status", "source", "assigned_to", "created_at")
    list_filter = ("status", "source")
    search_fields = ("first_name", "last_name", "phone", "email")


admin.site.register(LeadNote)
admin.site.register(LeadProperty)
