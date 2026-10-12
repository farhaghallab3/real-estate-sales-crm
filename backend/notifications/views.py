from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Notification
from .serializers import NotificationSerializer
from .services import notify_overdue_tasks


class NotificationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = NotificationSerializer
    filterset_fields = ["kind"]

    def get_queryset(self):
        qs = Notification.objects.filter(user=self.request.user)
        unread = self.request.query_params.get("unread")
        if unread in ("1", "true"):
            qs = qs.filter(read_at__isnull=True)
        return qs

    def list(self, request, *args, **kwargs):
        notify_overdue_tasks(request.user)
        return super().list(request, *args, **kwargs)

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        notify_overdue_tasks(request.user)
        count = Notification.objects.filter(user=request.user, read_at__isnull=True).count()
        return Response({"count": count})

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=["read_at"])
        return Response(self.get_serializer(notification).data)

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        updated = Notification.objects.filter(user=request.user, read_at__isnull=True).update(read_at=timezone.now())
        return Response({"updated": updated})
