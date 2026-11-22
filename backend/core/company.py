"""Company settings rules: allow-lists, the base-currency lock and content-based logo validation (no Pillow needed)."""
from django.apps import apps
from django.db.models import Q

# One base currency per company. There is no conversion anywhere: amounts are stored without a currency, so the currency code
# only gives them a meaning. It therefore cannot change once any financial data exists (see financial_data_exists()).
CURRENCIES = (
    "USD", "EUR", "GBP", "EGP", "SAR", "AED", "QAR", "KWD", "BHD", "OMR", "JOD", "LBP", "MAD", "TND", "DZD", "TRY", "CAD",
    "AUD", "CHF", "INR", "PKR",
)
# Number/date formatting locales. Latin digits are always used (the UI is English); Arabic UI and RTL are a later step.
LOCALES = ("en-US", "en-GB", "ar-EG", "ar-SA", "ar-AE", "ar-KW", "ar-QA", "fr-FR", "de-DE", "es-ES", "tr-TR")
LANGUAGES = ("en",)  # the interface language; the structure (language, direction) is ready for "ar" later

LOGO_MAX_BYTES = 1024 * 1024
LOGO_MAX_DIMENSION = 4096
_FORBIDDEN_MARKUP = (b"<script", b"<svg", b"<html", b"<?xml", b"javascript:", b"<iframe", b"<object")


class CurrencyLocked(Exception):
    """The base currency cannot change once financial data exists."""


def direction_for(language: str) -> str:
    return "rtl" if language.lower().startswith(("ar", "he", "fa", "ur")) else "ltr"


def financial_data_exists() -> bool:
    """True as soon as any record carries money: a property price, a lead budget, an offer, a deal amount or a commission."""
    Property, Lead = apps.get_model("properties", "Property"), apps.get_model("leads", "Lead")
    Offer, Deal = apps.get_model("deals", "Offer"), apps.get_model("deals", "Deal")
    Commission = apps.get_model("commissions", "Commission")
    return (
        Property.objects.exists()
        or Offer.objects.exists()
        or Commission.objects.exists()
        or Deal.objects.filter(Q(offer_amount__isnull=False) | Q(sale_price__isnull=False)).exists()
        or Lead.objects.filter(budget__isnull=False).exists()
    )


class InvalidImage(ValueError):
    pass


def sniff_image(data: bytes) -> tuple[str, str, int, int]:
    """Identify a PNG, JPEG or WEBP from its ACTUAL bytes and return (mime, extension, width, height).

    The declared Content-Type and the file name are never trusted. The structure is checked (PNG IHDR/IEND, JPEG markers and
    end-of-image, WEBP RIFF size and chunk), dimensions are bounded and files containing markup are refused.
    """
    if not data:
        raise InvalidImage("The file is empty.")
    lowered = data.lower()
    if any(marker in lowered for marker in _FORBIDDEN_MARKUP):
        raise InvalidImage("The file contains markup or script content and is not a plain image.")

    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        if len(data) < 45 or data[12:16] != b"IHDR" or int.from_bytes(data[8:12], "big") != 13 or data[-8:-4] != b"IEND":
            raise InvalidImage("The PNG file is damaged.")
        width, height = int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
        mime, ext = "image/png", "png"
    elif data.startswith(b"\xff\xd8\xff"):
        if not data.rstrip(b"\x00").endswith(b"\xff\xd9"):
            raise InvalidImage("The JPEG file is damaged.")
        width = height = 0
        i = 2
        while i + 4 <= len(data):
            if data[i] != 0xFF:
                break
            marker = data[i + 1]
            if marker == 0xFF:
                i += 1
                continue
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            length = int.from_bytes(data[i + 2 : i + 4], "big")
            if marker in (0xC0, 0xC1, 0xC2):
                height, width = int.from_bytes(data[i + 5 : i + 7], "big"), int.from_bytes(data[i + 7 : i + 9], "big")
                break
            if marker == 0xDA or length < 2:
                break
            i += 2 + length
        if not width or not height:
            raise InvalidImage("The JPEG file is damaged.")
        mime, ext = "image/jpeg", "jpg"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        if int.from_bytes(data[4:8], "little") != len(data) - 8 or len(data) < 30:
            raise InvalidImage("The WEBP file is damaged.")
        chunk = data[12:16]
        if chunk == b"VP8X":
            width, height = int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1
        elif chunk == b"VP8L" and data[20] == 0x2F:
            bits = int.from_bytes(data[21:25], "little")
            width, height = (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        elif chunk == b"VP8 " and data[23:26] == b"\x9d\x01\x2a":
            width, height = int.from_bytes(data[26:28], "little") & 0x3FFF, int.from_bytes(data[28:30], "little") & 0x3FFF
        else:
            raise InvalidImage("The WEBP file is damaged.")
        mime, ext = "image/webp", "webp"
    else:
        raise InvalidImage("Only PNG, JPEG and WEBP images are accepted.")

    if not (1 <= width <= LOGO_MAX_DIMENSION and 1 <= height <= LOGO_MAX_DIMENSION):
        raise InvalidImage(f"The image must be between 1 and {LOGO_MAX_DIMENSION} pixels on each side.")
    return mime, ext, width, height
