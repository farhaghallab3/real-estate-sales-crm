# Sales integrity check

`python manage.py check_sales_integrity [--limit N] [--json] [--timeout SECONDS]`

**Read-only. There is no automatic handling of the data**: the command never changes, repairs, deletes or "fixes" anything.
The whole check runs in one transaction that PostgreSQL itself holds read-only (`SET LOCAL transaction_read_only`), with a statement
timeout (`set_config('statement_timeout', ..., true)`); both settings are local to that transaction, which is rolled back at the end.
Nothing is left on the connection and no PostgreSQL setting is changed permanently. The output contains record ids only (no names, phones
or e-mail addresses).

Run it on a local or restored copy first. It is the pre-flight of the partial unique index on closed deals (one closed deal per property),
which is a separate, later step.

## Checks

| Check | Meaning | Severity |
|---|---|---|
| A | a property with more than one closed deal | **critical** (exit code 1) |
| B | a closed deal without a commission | **critical** (exit code 1) |
| C | a commission whose deal is not closed | **critical** (exit code 1) |
| D1 | a property with a closed deal whose status is not `sold` | info |
| D2 | a property marked `sold` with no closed deal | info |
| E1 | an offer whose property differs from its deal's property | info |
| E2 | an offer whose lead differs from its deal's lead | info |

A, B and C are the **critical violations of the Sales Integrity Preflight**: any one of them fails the preflight.

* **A is the one that blocks the partial unique index directly.** The index is on `property` where `stage = 'closed'`; a property with two
  closed deals is exactly a duplicate, so the migration cannot be created until A is 0.
* **B and C need a human review before the index, even though they would not stop it technically.** The index does not look at commissions;
  a closed deal without a commission, or a commission on a deal that is not closed, means the sales records disagree with each other, and
  building a constraint on top of records nobody has reviewed hides that.
* D and E are reported but never change the exit code: a status set by hand, or a record created before today's rules, can explain them.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | no critical finding (D and E may still be listed) |
| `1` | at least one critical finding (A, B or C); the totals are on stderr |
| `2` | the check could not be completed: timed out, or a database error. **An incomplete check is never "clean".** |

`--timeout` (seconds, default 60, `0` = none) is the statement timeout for every query of the check. On a timeout the command says so
clearly and exits with `2`; nothing was changed. Run it again on a quieter copy, or raise `--timeout`.

`--json` prints a machine-readable report in every case, including failures:

* success or findings: `{"ok": true|false, "checks": [{"code", "severity", "title", "count", "examples"}, ...]}`
* incomplete: `{"ok": false, "error": "incomplete", "message": "..."}`

`--limit N` (default 20) limits only the **examples** listed per check; `count` (and the totals on stderr) are always the real totals, and the
text report says "... and K more".

## When something is found

Nothing is repaired automatically. A human decides, per record:

* **A**: decide which sale is the real one (closing date, commission status, documents). The other closed deal is a data error to
  correct by hand; a commission that is already `paid` is a finance decision, not a technical one.
* **B**: a closed deal needs its commission; create it through the normal service, not by editing rows.
* **C**: a commission must belong to a closed deal.
* **D / E**: review; correct the property status or leave it if it was set on purpose.

## Before any production migration: the audit is part of the release

The migration `deals.0003_uniq_closed_deal_per_property` adds a partial unique index (one closed deal per property). **Run this audit on the
database that will be migrated before every real migration, and keep the result with the release notes.**

1. `python manage.py check_sales_integrity` on the target data (or on a restored copy of it). Exit code `0` is required; check **A must be 0**,
   and B and C need a person's review (see above).
2. Only then apply the migration. If A was missed, the migration itself is the second line of defence: it stops **before** building the index,
   changes nothing, and names the properties (`property 12 (2 closed deals)`), then it can simply be run again after a person has decided.
   On a host that migrates on start (`docs/DEPLOYMENT.md`) that failure stops the container from starting, which is why the audit comes first.

What the migration does to a deployment:

* It never deletes or edits data. The preflight is read-only; the only change is `CREATE UNIQUE INDEX ... WHERE stage = 'closed'`, which takes
  a short write lock on `deals_deal` while it builds (the table is small).
* **Code rollback is safe with the index in place**: older code never needs two closed deals on one property. At worst, a racing second closing
  gets an `IntegrityError` instead of creating a second sale. Reverting the migration (`migrate deals 0002`) drops the index and nothing else.
  (This is the opposite of a CHECK constraint on `Property.reference`, which would have broken older code and is still deferred.)
* A restored backup that predates the fix may contain duplicates: run the audit on the restored copy before migrating it.
* After the index exists, check A cannot be produced by the application any more; the audit stays useful for restored or imported data.
* A future "cancel sale" must move the deal out of `closed`, otherwise the index (correctly) forbids selling the property again.
