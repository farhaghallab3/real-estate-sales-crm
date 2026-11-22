"""One closed deal per property, enforced by PostgreSQL (a partial unique index on `property` where stage = 'closed').

BEFORE a real (production) migration: run `python manage.py check_sales_integrity` on the same data and get a clean result for A (see
docs/SALES_INTEGRITY.md). B and C are not what this index looks at, but they need a human look first as well.

Preflight (this migration, read-only): if a property already has more than one closed deal the index cannot be built. The migration then STOPS
before changing anything and names the properties. It never deletes, edits or "repairs" a deal; a person decides which sale is the real one,
then the migration is run again.

Rollback: reversing this migration drops the index and nothing else, no row is touched. Running older code with the index in place is
harmless: the older code never needs two closed deals on a property (at worst a racing second closing gets an IntegrityError instead of
creating a second sale).

Cost: building the index takes a short write lock on deals_deal; the table is small.
"""
from django.db import migrations, models
from django.db.models import Count


def refuse_duplicates(apps, schema_editor):
    """Read-only: SELECTs only."""
    Deal = apps.get_model("deals", "Deal")
    crowded = Deal.objects.filter(stage="closed").values("property_id").annotate(n=Count("id")).filter(n__gt=1).order_by("property_id")
    total = crowded.count()
    if total:
        shown = ", ".join(f"property {row['property_id']} ({row['n']} closed deals)" for row in crowded[:20])
        more = f" ... and {total - 20} more" if total > 20 else ""
        raise RuntimeError(
            f"Cannot add the one-closed-deal-per-property index: {total} propert{'y has' if total == 1 else 'ies have'} more than one closed deal: "
            f"{shown}{more}. Nothing was changed. Run `python manage.py check_sales_integrity`, review these sales by hand, then migrate again."
        )


class Migration(migrations.Migration):
    dependencies = [("deals", "0002_initial")]

    operations = [
        migrations.RunPython(refuse_duplicates, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="deal",
            constraint=models.UniqueConstraint(
                fields=("property",), condition=models.Q(("stage", "closed")), name="uniq_closed_deal_per_property"
            ),
        ),
    ]
