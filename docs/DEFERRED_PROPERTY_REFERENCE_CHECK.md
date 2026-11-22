# Deferred: CHECK constraint on `Property.reference`

**Status: deferred. Not applied, not in the migration history.**

The Property reference fix (`Property.save()` allocates the id from the table's sequence and writes the row, reference included, in ONE
INSERT) ships on its own. A database CHECK `reference <> ''` was designed and tested with it, and was deliberately taken out.

## Why it is deferred

- The previous release inserts `reference=""` and then updates it. With the CHECK in place, that code cannot create a property at all.
- Our rollback (`deploy/instance`) is **code-only** and needs `--accept-schema-risk` after a schema change. Rolling back the code after the
  migration would therefore break property creation until someone reverses the migration by hand.
- With the fix alone, rollback is safe: old code simply behaves as it always did.

## What is parked

- `docs/deferred/0003_property_reference_not_blank.py.txt`: the migration (completes any empty reference as `PR-<id>`, refuses to run when
  that reference is already taken, adds the constraint; reversible). It contains the read-only audit SQL.
- `docs/deferred/property_reference_constraint_tests.py.txt`: the 6 tests that need the constraint (the database refuses `""`, plus the
  5 migration tests). Both are `.txt` so neither is collected nor picked up by `makemigrations`.

## Conditions to ship it later

1. The release that contains the fix is live and stable, so no running code can insert `""` any more.
2. The rollback procedure is updated so that a rollback to a release older than the constraint **first reverses the migration**
   (`migrate properties 0002`), or the constraint is allowed only once the oldest supported rollback target already contains the fix.
3. Run the audit SQL on the target database; apply the migration to a restored copy first.
4. Restore the file as `backend/properties/migrations/0003_property_reference_not_blank.py` and the constraint in `Property.Meta`,
   move the tests back, and run the full backend suite.

## Sequence notes (reviewed)

- Ids come from `nextval(pg_get_serial_sequence(...))`, the same sequence a plain INSERT uses, so new creations never collide with each other,
  with `bulk_create`, or with the admin.
- An INSERT with an explicit id (fixtures, data import, tests) does not advance the sequence in PostgreSQL. That hazard exists with or without
  this change; after any such import run `SELECT setval(pg_get_serial_sequence('properties_property','id'), max(id)) FROM properties_property`.
- Explicit-id creation keeps its id and gets `PR-<id>`, with no `nextval` call (covered by a test).
