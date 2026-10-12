from django.contrib import admin

from .models import Task


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ("title", "type", "status", "due_at", "assigned_to")
    list_filter = ("type", "status")
