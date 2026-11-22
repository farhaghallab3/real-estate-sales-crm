"""Structured JSON logging with redaction.

What is logged: a timestamp, level, logger, a REDACTED message, the request id, the instance name and a small allow-list of
request facts (method, path WITHOUT query string, status, duration, numeric user id). Nothing else can be added to a line.
What is never logged: request bodies, headers (Authorization, Cookie), query strings, e-mail addresses, tokens, passwords,
secret keys, credentials inside URLs, signed-URL signatures. Exceptions are logged as type + a REDACTED traceback.
"""
import contextvars
import json
import logging
import os
import re
from datetime import datetime, timezone

REDACTED = "[REDACTED]"
request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

# Order matters: credentials inside URLs must go before e-mail addresses (user:pass@host looks like one).
_PATTERNS = [
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9\-._~+/]+=*"), "Bearer " + REDACTED),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*"), "[REDACTED_JWT]"),
    (re.compile(r"([A-Za-z][A-Za-z0-9+.\-]*://)[^/\s:@]*:[^@\s/]*@"), r"\1" + REDACTED + "@"),
    (re.compile(r"(?i)\b(X-Amz-[A-Za-z-]+|signature|sig)=[^&\s\"']+"), r"\1=" + REDACTED),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[REDACTED_KEY]"),
    (re.compile(
        r"""(?i)(["']?\b(?:password|passwd|pwd|secret|secret[_-]?key|token|access[_-]?token|refresh[_-]?token|authorization|"""
        r"""api[_-]?key|access[_-]?key|cookie|csrfmiddlewaretoken|x-monitor-token)\b["']?\s*[:=]\s*)"""
        r"""(?:"[^"]*"|'[^']*'|[^\s,;&}\]]+)"""
    ), r"\1" + REDACTED),
    # query strings: "?key=value..." directly after a path-like token
    (re.compile(r"(?<=[\w/%.\-])\?[\w%.~!$&'()*+,;:@/?\-]*=[^\s\"'<>]*"), "?" + REDACTED),
    (re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"), "[REDACTED_EMAIL]"),
]
_known_secrets_regex = None


def _known_secrets() -> "re.Pattern[str] | None":
    """The exact secret VALUES of this deployment (secret key, database password, storage secret, monitor token)."""
    global _known_secrets_regex
    if _known_secrets_regex is None:
        values = {os.environ.get(k, "") for k in ("DJANGO_SECRET_KEY", "AWS_SECRET_ACCESS_KEY", "READINESS_TOKEN")}
        try:
            from django.conf import settings

            values |= {getattr(settings, "SECRET_KEY", ""), getattr(settings, "READINESS_TOKEN", "")}
            values.add(str(settings.DATABASES["default"].get("PASSWORD") or ""))
        except Exception:  # settings not configured (unit use): the env values above still apply
            pass
        values = sorted((v for v in values if len(v) >= 6), key=len, reverse=True)
        _known_secrets_regex = re.compile("|".join(re.escape(v) for v in values)) if values else re.compile(r"(?!x)x")
    return _known_secrets_regex


def reset_known_secrets() -> None:
    global _known_secrets_regex
    _known_secrets_regex = None


def redact(text: str) -> str:
    if not text:
        return text
    text = _known_secrets().sub("[REDACTED_SECRET]", text)
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


_ALLOWED_EXTRA = ("method", "path", "status", "duration_ms", "user_id")


class JsonFormatter(logging.Formatter):
    """One JSON object per line. Only the fields below can appear; anything else on the record is dropped."""

    def format(self, record: logging.LogRecord) -> str:
        try:
            message = record.getMessage()
        except Exception:
            message = str(record.msg)
        payload = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": redact(message)[:2000],
            "request_id": request_id_var.get(),
            "instance": os.environ.get("INSTANCE_SLUG", "-"),
        }
        for key in _ALLOWED_EXTRA:
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = redact(value)[:200] if isinstance(value, str) else value
        if record.exc_info and record.exc_info[0] is not None:
            payload["exc_type"] = record.exc_info[0].__name__
            payload["exc"] = redact(self.formatException(record.exc_info))[:8000]
        return json.dumps(payload, ensure_ascii=False)
