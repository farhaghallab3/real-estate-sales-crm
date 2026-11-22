"""Read-only check of the sales records: closed deals, their commissions, property status and offers.

    python manage.py check_sales_integrity [--limit N] [--json] [--timeout SECONDS]

It never changes anything and never repairs anything: the whole check runs in ONE transaction that is read-only at the database level
(SET LOCAL transaction_read_only) with a statement timeout (set_config(..., is_local=true)); both last only for that transaction, which is
rolled back at the end, so nothing is left on the connection and no PostgreSQL setting is changed permanently. It prints record ids only (no
names, phones or other personal data).

Exit code: 0 no critical finding | 1 at least one critical finding (A, B, C) | 2 the check could not be completed (timeout or database error).

  CRITICAL (exit code 1)
    A  a property with more than one closed deal
    B  a closed deal without a commission
    C  a commission whose deal is not closed
  INFO (reported, never changes the exit code; a manual status or an older record can explain them)
    D1 a property with a closed deal whose status is not "sold"
    D2 a property marked "sold" that has no closed deal
    E1 an offer whose property differs from its deal's property
    E2 an offer whose lead differs from its deal's lead
"""
import json

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection, transaction
from django.db.models import Count, F

from commissions.models import Commission
from deals.models import Deal, Offer
from properties.models import Property

CLOSED = Deal.Stage.CLOSED

CHECKS = [
    ("A", "critical", "properties with more than one closed deal"),
    ("B", "critical", "closed deals without a commission"),
    ("C", "critical", "commissions whose deal is not closed"),
    ("D1", "info", "properties with a closed deal whose status is not 'sold'"),
    ("D2", "info", "properties marked 'sold' that have no closed deal"),
    ("E1", "info", "offers whose property differs from their deal's property"),
    ("E2", "info", "offers whose lead differs from their deal's lead"),
]


class Command(BaseCommand):
    help = "Read-only check of closed deals, commissions, property status and offers. Exit code 1 on a critical finding (A, B, C)."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=20, help="how many example records to list per check (default 20)")
        parser.add_argument("--json", action="store_true", help="print the report as JSON (also when it fails: {\"ok\": false, ...})")
        parser.add_argument("--timeout", type=float, default=60, help="statement timeout in seconds for every query of the check (default 60; 0 = none)")

    def handle(self, *args, **opts):
        limit, timeout_ms = max(0, opts["limit"]), max(0, int(opts["timeout"] * 1000))
        try:
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute("SET LOCAL transaction_read_only = on")  # the database itself refuses any write from here on
                    cursor.execute("SELECT set_config('statement_timeout', %s, true)", [str(timeout_ms)])  # local to this transaction only
                results = self.collect(limit)
                transaction.set_rollback(True)  # nothing was written; leave no trace and release both settings
        except DatabaseError as e:
            self.incomplete(e, opts)
        critical = {r["code"]: r["count"] for r in results if r["severity"] == "critical" and r["count"]}
        if opts["json"]:
            self.stdout.write(json.dumps({"ok": not critical, "checks": results}, indent=2))
        else:
            self.render(results, critical)
        if critical:
            summary = ", ".join(f"{code}={count}" for code, count in critical.items())
            raise CommandError(f"Critical sales integrity violations found ({summary}). Nothing was changed.", returncode=1)

    def incomplete(self, error, opts):
        """The check could not run to the end: say so clearly (exit code 2), never pretend it was clean."""
        cause = getattr(error, "__cause__", None)
        if getattr(cause, "sqlstate", None) == "57014" or "statement timeout" in str(error):
            message = f"The check timed out after {opts['timeout']:g} s and is incomplete. Nothing was changed. Run it on a quieter copy or raise --timeout."
        else:
            message = f"The check could not be completed ({type(error).__name__}). Nothing was changed."
        if opts["json"]:
            self.stdout.write(json.dumps({"ok": False, "error": "incomplete", "message": message}, indent=2))
        raise CommandError(message, returncode=2) from None

    # ---- the checks (SELECT only) -----------------------------------------------------------------------------------------
    def collect(self, limit: int) -> list[dict]:
        found = {
            "A": self.more_than_one_closed_deal(limit),
            "B": self.rows(Deal.objects.filter(stage=CLOSED, commission__isnull=True).order_by("pk"), limit, lambda d: {"deal_id": d.pk, "property_id": d.property_id}),
            "C": self.rows(
                Commission.objects.exclude(deal__stage=CLOSED).select_related("deal").order_by("pk"), limit,
                lambda c: {"commission_id": c.pk, "deal_id": c.deal_id, "deal_stage": c.deal.stage},
            ),
            "D1": self.rows(
                Property.objects.filter(deals__stage=CLOSED).exclude(status=Property.Status.SOLD).distinct().order_by("pk"), limit,
                lambda p: {"property_id": p.pk, "status": p.status},
            ),
            "D2": self.rows(
                Property.objects.filter(status=Property.Status.SOLD).exclude(deals__stage=CLOSED).order_by("pk"), limit,
                lambda p: {"property_id": p.pk},
            ),
            "E1": self.rows(Offer.objects.exclude(property_id=F("deal__property_id")).order_by("pk"), limit, lambda o: {"offer_id": o.pk, "deal_id": o.deal_id}),
            "E2": self.rows(Offer.objects.exclude(lead_id=F("deal__lead_id")).order_by("pk"), limit, lambda o: {"offer_id": o.pk, "deal_id": o.deal_id}),
        }
        return [{"code": code, "severity": severity, "title": title, **found[code]} for code, severity, title in CHECKS]

    @staticmethod
    def rows(queryset, limit, describe) -> dict:
        return {"count": queryset.count(), "examples": [describe(row) for row in queryset[:limit]]}

    @staticmethod
    def more_than_one_closed_deal(limit: int) -> dict:
        crowded = (
            Deal.objects.filter(stage=CLOSED).values("property_id").annotate(n=Count("pk")).filter(n__gt=1).order_by("property_id")
        )
        examples = [
            {"property_id": row["property_id"], "closed_deal_ids": list(Deal.objects.filter(property_id=row["property_id"], stage=CLOSED).order_by("pk").values_list("pk", flat=True))}
            for row in crowded[:limit]
        ]
        return {"count": crowded.count(), "examples": examples}

    # ---- output --------------------------------------------------------------------------------------------------------------
    def render(self, results: list[dict], critical: dict) -> None:
        self.stdout.write("Sales integrity check (read-only: nothing is changed, nothing is repaired)")
        for severity, heading in (("critical", "CRITICAL (any finding makes the exit code 1)"), ("info", "INFO (never changes the exit code)")):
            self.stdout.write(f"\n{heading}")
            for r in (r for r in results if r["severity"] == severity):
                self.stdout.write(f"  {r['code']:<3} {r['title']}: {r['count']}" + ("  OK" if not r["count"] else ""))
                for example in r["examples"]:
                    self.stdout.write("        " + ", ".join(f"{key}={value}" for key, value in example.items()))
                if r["count"] > len(r["examples"]):
                    self.stdout.write(f"        ... and {r['count'] - len(r['examples'])} more (use --limit)")
        self.stdout.write("\nRESULT: " + ("CRITICAL findings, see above" if critical else "OK, no critical findings"))
