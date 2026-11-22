from django.db import router, transaction
from django.http import FileResponse
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from core.exceptions import BusinessRuleViolation
from core.permissions import is_manager, scope_to_user

from deals import services as deal_services
from deals.models import Deal
from deals.protection import SALE_RECORD_MESSAGE

from . import services
from .models import Document
from .serializers import DocumentSerializer, DocumentUploadSerializer


class DocumentViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Access follows the deal: salespeople only see documents on their own deals."""

    serializer_class = DocumentSerializer
    parser_classes = [MultiPartParser, FormParser]
    filterset_fields = ["deal", "category"]
    search_fields = ["name", "deal__property__title", "deal__lead__first_name", "deal__lead__last_name"]
    ordering_fields = ["created_at", "name", "size", "category"]

    def get_queryset(self):
        qs = Document.objects.select_related("deal__lead", "deal__property", "uploaded_by")
        return scope_to_user(qs, self.request.user, "deal__assigned_to")

    def create(self, request, *args, **kwargs):
        serializer = DocumentUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        deal = d["deal"]
        if not is_manager(request.user) and deal.assigned_to_id != request.user.id:
            raise BusinessRuleViolation("You can only upload documents to your own deals.")
        document = services.create_document(deal, d["category"], d["file"], request.user, d.get("name", ""))
        return Response(DocumentSerializer(document).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance: Document):
        user = self.request.user
        if not (is_manager(user) or instance.uploaded_by_id == user.id):
            raise BusinessRuleViolation("Only the uploader or a manager can delete this document.")
        db = router.db_for_write(Document, instance=instance)
        with transaction.atomic(using=db):
            deal_services.lock_deal(instance.deal)  # the closing's lock order; the stage below is the current one
            if instance.deal.stage == Deal.Stage.CLOSED:
                raise BusinessRuleViolation(SALE_RECORD_MESSAGE)
            # The row first, inside the transaction; the stored file only after that transaction has committed. A failure (or a rollback)
            # before the commit therefore never costs the file, and a storage failure after it leaves an orphan file, never a document
            # whose file is gone.
            storage, name = instance.file.storage, instance.file.name
            instance.delete()
            if name:
                transaction.on_commit(lambda: services.remove_stored_file(storage, name), using=db, robust=True)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        document = self.get_object()
        response = FileResponse(document.file.open("rb"), as_attachment=True, filename=document.name)
        response["X-Content-Type-Options"] = "nosniff"
        return response
