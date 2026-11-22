"""Read-only operational report: database region/latency, migration state, row counts and storage backend.

Safe to run against production: it issues SELECT statements only, never writes, and never prints credentials,
hostnames' identifying parts, or object contents.
"""
import re
import statistics
import time

from django.conf import settings
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


class Command(BaseCommand):
    help = "Read-only report: database region and latency, pending migrations, row counts, storage backend."

    def add_arguments(self, parser):
        parser.add_argument("--rounds", type=int, default=10, help="SELECT 1 round trips to time")

    def handle(self, *args, **opts):
        self._database(opts["rounds"])
        self._migrations()
        self._counts()
        self._storage()

    def _database(self, rounds: int) -> None:
        cfg = connection.settings_dict
        host = cfg.get("HOST") or ""
        match = re.search(r"\.([a-z0-9-]+)\.aws\.neon\.tech$", host)
        self.stdout.write("== Database ==")
        self.stdout.write(f"engine: {connection.vendor} | neon region: {match.group(1) if match else 'n/a'} "
                          f"| pooled endpoint: {'-pooler' in host} | sslmode: {cfg.get('OPTIONS', {}).get('sslmode', '-')}")
        connection.close()
        started = time.perf_counter()
        connection.ensure_connection()
        connect_ms = (time.perf_counter() - started) * 1000
        times = []
        with connection.cursor() as cur:
            cur.execute("select version()")
            self.stdout.write("server: " + cur.fetchone()[0].split(",")[0])
            for _ in range(rounds):
                t = time.perf_counter()
                cur.execute("select 1")
                cur.fetchone()
                times.append((time.perf_counter() - t) * 1000)
        self.stdout.write(f"connect (TCP+TLS+auth): {connect_ms:.0f} ms | round trip median {statistics.median(times):.0f} ms, "
                          f"min {min(times):.0f} ms, max {max(times):.0f} ms over {rounds} queries")

    def _migrations(self) -> None:
        executor = MigrationExecutor(connection)
        plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
        self.stdout.write("== Migrations ==")
        if plan:
            self.stdout.write(f"PENDING ({len(plan)}): " + ", ".join(f"{m.app_label}.{m.name}" for m, _ in plan))
        else:
            self.stdout.write("none pending - schema is up to date")

    def _counts(self) -> None:
        from django.apps import apps

        self.stdout.write("== Row counts ==")
        parts = []
        for label in ("users.User", "leads.Lead", "properties.Property", "properties.PropertyImage",
                      "deals.Deal", "documents.Document"):
            try:
                parts.append(f"{label.split('.')[1]}={apps.get_model(label).objects.count()}")
            except Exception as exc:  # table missing before first migration
                parts.append(f"{label.split('.')[1]}=unavailable({type(exc).__name__})")
        self.stdout.write(" | ".join(parts))

    def _storage(self) -> None:
        self.stdout.write("== File storage ==")
        backend = settings.STORAGES["default"]["BACKEND"]
        self.stdout.write(f"backend: {backend.rsplit('.', 1)[-1]} | bucket: {getattr(default_storage, 'bucket_name', 'n/a (local disk)')}")
        if "S3" not in backend:
            self.stdout.write("WARNING: uploads go to the container disk, not object storage.")
            return
        try:
            for prefix in ("properties/", "documents/"):
                dirs, files = default_storage.listdir(prefix)
                self.stdout.write(f"{prefix}: {len(dirs)} sub-folders, {len(files)} top-level files (read-only listing)")
        except Exception as exc:
            self.stdout.write(f"STORAGE ERROR: {type(exc).__name__} (check bucket name, endpoint, region=auto, token scope)")
