"""Company settings API: a public branding endpoint and an admin-only management endpoint."""
import logging
import uuid

from django.core.files.base import ContentFile
from django.db import transaction
from django.http import Http404, HttpResponse
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .company import (
    CURRENCIES,
    LANGUAGES,
    LOCALES,
    LOGO_MAX_BYTES,
    CurrencyLocked,
    InvalidImage,
    direction_for,
    financial_data_exists,
    sniff_image,
)
from .models import CompanySettings
from .permissions import IsAdminRole

logger = logging.getLogger("crm.company")

LOCKED_MESSAGE = "The base currency cannot be changed once the company has financial data."


def logo_url(cfg: CompanySettings):
    return f"/api/config/logo/?v={cfg.logo_version}" if cfg.logo else None


def public_payload(cfg: CompanySettings) -> dict:
    """Branding only. Nothing operational (hosts, versions, counts, user data, storage details) may ever be added here."""
    return {
        "company_name": cfg.company_name,
        "workspace_label": cfg.workspace_label,
        "currency_code": cfg.currency_code,
        "locale": cfg.locale,
        "language": cfg.language,
        "direction": direction_for(cfg.language),
        "logo_url": logo_url(cfg),
    }


class PublicConfigView(APIView):
    """Read by the login page before anyone signs in, so it is public and returns the branding fields above and nothing else."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "public_config"

    def get(self, request):
        response = Response(public_payload(CompanySettings.load()))
        response["Cache-Control"] = "public, max-age=60"
        return response


class PublicLogoView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "public_config"

    def get(self, request):
        cfg = CompanySettings.load()
        if not cfg.logo:
            raise Http404
        try:
            with cfg.logo.open("rb") as handle:
                data = handle.read(LOGO_MAX_BYTES + 1)
        except Exception:
            logger.warning("logo file could not be read")
            raise Http404
        response = HttpResponse(data, content_type=cfg.logo_content_type or "application/octet-stream")
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        response["Cache-Control"] = "public, max-age=86400"
        return response


class CompanySettingsSerializer(serializers.Serializer):
    company_name = serializers.CharField(max_length=120)
    workspace_label = serializers.CharField(max_length=60)
    currency_code = serializers.ChoiceField(choices=CURRENCIES)
    locale = serializers.ChoiceField(choices=LOCALES)
    language = serializers.ChoiceField(choices=LANGUAGES)

    def _clean(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("This field cannot be empty.")
        return value

    def validate_company_name(self, value):
        return self._clean(value)

    def validate_workspace_label(self, value):
        return self._clean(value)


def admin_payload(cfg: CompanySettings) -> dict:
    return {
        **public_payload(cfg),
        "currency_locked": financial_data_exists(),
        "currencies": list(CURRENCIES),
        "locales": list(LOCALES),
        "languages": list(LANGUAGES),
        "updated_at": cfg.updated_at,
    }


class CompanySettingsView(APIView):
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request):
        return Response(admin_payload(CompanySettings.load()))

    def patch(self, request):
        serializer = CompanySettingsSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            cfg = CompanySettings.objects.select_for_update().get_or_create(pk=1)[0]
            new_currency = data.get("currency_code")
            if new_currency and new_currency != cfg.currency_code and financial_data_exists():
                return Response({"currency_code": [LOCKED_MESSAGE]}, status=status.HTTP_400_BAD_REQUEST)
            for field, value in data.items():
                setattr(cfg, field, value)
            cfg.updated_by = request.user
            try:
                cfg.save()
            except CurrencyLocked:  # the model enforces the same rule, whoever calls it
                return Response({"currency_code": [LOCKED_MESSAGE]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(admin_payload(cfg))


class CompanyLogoView(APIView):
    permission_classes = [IsAuthenticated, IsAdminRole]

    def post(self, request):
        upload = request.FILES.get("logo")
        if upload is None:
            return Response({"logo": ["No file was sent."]}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > LOGO_MAX_BYTES:
            return Response({"logo": ["The logo must be 1 MB or smaller."]}, status=status.HTTP_400_BAD_REQUEST)
        data = upload.read(LOGO_MAX_BYTES + 1)
        try:
            mime, ext, _width, _height = sniff_image(data)
        except InvalidImage as exc:
            return Response({"logo": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            cfg = CompanySettings.objects.select_for_update().get_or_create(pk=1)[0]
            old = cfg.logo.name if cfg.logo else ""
            # The stored name is generated here; the uploaded file name is never used.
            cfg.logo.save(f"logo-{uuid.uuid4().hex}.{ext}", ContentFile(data), save=False)
            cfg.logo_content_type = mime
            cfg.logo_version += 1
            cfg.updated_by = request.user
            cfg.save()
        if old and old != cfg.logo.name:
            try:
                cfg.logo.storage.delete(old)
            except Exception:
                logger.warning("previous logo could not be deleted")
        return Response(admin_payload(cfg), status=status.HTTP_201_CREATED)

    def delete(self, request):
        with transaction.atomic():
            cfg = CompanySettings.objects.select_for_update().get_or_create(pk=1)[0]
            old = cfg.logo.name if cfg.logo else ""
            cfg.logo = ""
            cfg.logo_content_type = ""
            cfg.logo_version += 1
            cfg.updated_by = request.user
            cfg.save()
        if old:
            try:
                cfg.logo.storage.delete(old)
            except Exception:
                logger.warning("logo file could not be deleted")
        return Response(admin_payload(cfg))
