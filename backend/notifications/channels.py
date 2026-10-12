"""Delivery channels. In-app is persisted by the service itself; email/SMS channels can be added
here later (and run from a Celery task) by implementing `deliver` and listing them in
settings.NOTIFICATION_CHANNELS."""
from __future__ import annotations

from .models import Notification


class BaseChannel:
    def deliver(self, notification: Notification) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class InAppChannel(BaseChannel):
    def deliver(self, notification: Notification) -> None:
        # Already stored in the database and surfaced by the notifications API.
        return None
