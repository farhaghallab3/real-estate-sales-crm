# Permission tests

Run (needs Docker; uses a disposable PostgreSQL, never a real database):

```bash
bash backend/core/tests/run.sh                    # known gaps are expected failures
RUN_KNOWN_GAPS=1 bash backend/core/tests/run.sh   # known gaps run as ordinary tests: shows the raw failures
```

- `__init__.py` refuses to load unless the configured database host is local/`crm-test-db`.
- `@known_gap` tests assert the **desired** behaviour of a gap that exists today (expected failure). When a gap is fixed
  its test "unexpectedly succeeds" and the runner fails until the marker is removed.
- `test_CHARACTERIZATION_*` tests only record today's behaviour for an open decision; change them when it is decided.
- The matrix these tests encode is in `docs/PERMISSIONS.md`.
