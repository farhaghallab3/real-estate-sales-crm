from django.contrib import admin

from deals.models import Deal

from .models import Document


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    """Documents of a closed deal (the contract, identification, ...) are part of the sales record: no change and no delete here (single or
    bulk: the bulk action asks the same per-document permission). A document keeps its deal: it cannot be re-linked to another one."""

    list_display = ("id", "name", "deal", "category")

    def get_readonly_fields(self, request, obj=None):
        return ("deal",) if obj is not None else ()

    @staticmethod
    def _sealed(obj) -> bool:
        return obj is not None and obj.deal.stage == Deal.Stage.CLOSED

    def has_change_permission(self, request, obj=None):
        return not self._sealed(obj) and super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        return not self._sealed(obj) and super().has_delete_permission(request, obj)
