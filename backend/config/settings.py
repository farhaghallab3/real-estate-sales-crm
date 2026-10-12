import os
from datetime import timedelta
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def env_bool(key: str, default: bool = False) -> bool:
    return env(key, str(default)).strip().lower() in ("1", "true", "yes", "on")


def env_list(key: str, default: str = "") -> list[str]:
    return [v.strip() for v in env(key, default).split(",") if v.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = env("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "insecure-development-key-do-not-use-in-production"
    else:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is false.")

# Local-development defaults exist only when DEBUG is on. Production must set everything explicitly.
_DEV_HOSTS = "localhost,127.0.0.1,backend" if DEBUG else ""
_DEV_ORIGINS = "http://localhost:3000" if DEBUG else ""

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", _DEV_HOSTS)
if not DEBUG and not ALLOWED_HOSTS:
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must be set when DJANGO_DEBUG is false.")

# Browser origins allowed to call the API (the Vercel frontend), e.g. https://crm.example.com
CORS_ALLOWED_ORIGINS = env_list("DJANGO_CORS_ALLOWED_ORIGINS", _DEV_ORIGINS)
# Optional regex for Vercel preview deployments, e.g. ^https://crm-[a-z0-9-]+-myteam\.vercel\.app$
CORS_ALLOWED_ORIGIN_REGEXES = env_list("DJANGO_CORS_ALLOWED_ORIGIN_REGEXES")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", _DEV_ORIGINS)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "django_filters",
    "corsheaders",
    # domain apps
    "core",
    "users",
    "leads",
    "properties",
    "tasks",
    "viewings",
    "deals",
    "commissions",
    "documents",
    "notifications",
    "analytics",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

# PostgreSQL only. Production (e.g. Neon) is configured through DATABASE_URL, which must include
# `?sslmode=require`. Docker Compose development may instead use the discrete POSTGRES_* variables.
_database_url = env("DATABASE_URL")
if _database_url:
    DATABASES = {
        "default": dj_database_url.parse(
            _database_url,
            conn_max_age=int(env("DB_CONN_MAX_AGE", "60")),
            conn_health_checks=True,
        )
    }
    if not DATABASES["default"]["ENGINE"].endswith("postgresql"):
        raise ImproperlyConfigured("DATABASE_URL must be a PostgreSQL URL (postgres://...).")
    # Compatible with pgbouncer-style poolers such as Neon's pooled endpoint.
    DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True
elif DEBUG:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("POSTGRES_DB", "crm"),
            "USER": env("POSTGRES_USER", "crm"),
            "PASSWORD": env("POSTGRES_PASSWORD"),
            "HOST": env("POSTGRES_HOST", "db"),
            "PORT": env("POSTGRES_PORT", "5432"),
        }
    }
else:
    raise ImproperlyConfigured("DATABASE_URL must be set when DJANGO_DEBUG is false.")

AUTH_USER_MODEL = "users.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = env("DJANGO_TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "/django-static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT", str(BASE_DIR / "media")))

# Uploaded files (property photos, deal documents).
#  - Local/Docker development: filesystem under MEDIA_ROOT (a Docker volume).
#  - Production: most Django hosts have an ephemeral disk, so set AWS_STORAGE_BUCKET_NAME to use any
#    S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, …). The bucket must stay PRIVATE: files
#    are returned as short-lived signed URLs and documents are streamed through the authenticated API.
if env("AWS_STORAGE_BUCKET_NAME"):
    _default_storage = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": env("AWS_STORAGE_BUCKET_NAME"),
            "access_key": env("AWS_ACCESS_KEY_ID"),
            "secret_key": env("AWS_SECRET_ACCESS_KEY"),
            "region_name": env("AWS_S3_REGION_NAME") or None,
            "endpoint_url": env("AWS_S3_ENDPOINT_URL") or None,
            "querystring_auth": True,
            "querystring_expire": int(env("AWS_QUERYSTRING_EXPIRE", "3600")),
            "default_acl": None,
            "file_overwrite": False,
        },
    }
else:
    _default_storage = {"BACKEND": "django.core.files.storage.FileSystemStorage"}
    if not DEBUG:
        import warnings

        warnings.warn(
            "AWS_STORAGE_BUCKET_NAME is not set: uploads use the local filesystem, which is ephemeral on most "
            "production hosts. Configure an S3-compatible bucket.",
            stacklevel=1,
        )

STORAGES = {
    "default": _default_storage,
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "core.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "EXCEPTION_HANDLER": "core.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"login": "20/min"},
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(env("JWT_ACCESS_MINUTES", "30"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(env("JWT_REFRESH_DAYS", "7"))),
    "ROTATE_REFRESH_TOKENS": False,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# ---- CRM business settings ----
DEFAULT_COMMISSION_RATE = env("DEFAULT_COMMISSION_RATE", "2.5")
MAX_UPLOAD_BYTES = int(env("MAX_UPLOAD_MB", "10")) * 1024 * 1024
ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".txt"}
REQUIRED_DEAL_DOCUMENT_CATEGORIES = ["contract", "offer", "identification", "agreement"]
VIEWING_AUTO_FOLLOWUP = env_bool("VIEWING_AUTO_FOLLOWUP", True)
# Notification channels, dotted paths. Add email/SMS channels here later.
NOTIFICATION_CHANNELS = ["notifications.channels.InAppChannel"]

DATA_UPLOAD_MAX_MEMORY_SIZE = MAX_UPLOAD_BYTES
FILE_UPLOAD_MAX_MEMORY_SIZE = MAX_UPLOAD_BYTES

# ---- Production hardening (everything below only applies when DJANGO_DEBUG=false) ----
if not DEBUG:
    # The app sits behind the host's TLS-terminating proxy.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    USE_X_FORWARDED_HOST = True
    # Set DJANGO_SECURE_SSL_REDIRECT=false only for a plain-HTTP local test of the production image.
    SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = SECURE_SSL_REDIRECT
    CSRF_COOKIE_SECURE = SECURE_SSL_REDIRECT
    SECURE_HSTS_SECONDS = int(env("DJANGO_HSTS_SECONDS", "31536000")) if SECURE_SSL_REDIRECT else 0
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("DJANGO_HSTS_INCLUDE_SUBDOMAINS", False)
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"
    X_FRAME_OPTIONS = "DENY"
    # Exempt the platform health check from the HTTPS redirect (it is called over plain HTTP internally).
    SECURE_REDIRECT_EXEMPT = [r"^api/health/$"]
