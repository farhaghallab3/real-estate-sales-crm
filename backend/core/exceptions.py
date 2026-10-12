from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.views import exception_handler


class BusinessRuleViolation(APIException):
    """Raised by services when a domain rule is broken (400)."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This action is not allowed."
    default_code = "business_rule"


class Conflict(APIException):
    """409 with a structured payload, e.g. viewing schedule conflicts."""

    status_code = status.HTTP_409_CONFLICT
    default_detail = "Conflict."
    default_code = "conflict"


def api_exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = ValidationError(detail=exc.message_dict if hasattr(exc, "error_dict") else exc.messages)
    return exception_handler(exc, context)
