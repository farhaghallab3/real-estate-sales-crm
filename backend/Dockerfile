FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
RUN chmod +x /app/entrypoint.sh \
    && adduser --disabled-password --gecos "" appuser \
    && mkdir -p /app/media /app/staticfiles \
    && chown -R appuser:appuser /app

USER appuser
EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]

# ---- development: auto-reload dev server -----------------------------------------------------
FROM base AS dev
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

# ---- production: gunicorn -----------------------------------------------------------------------
FROM base AS prod
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "60"]
