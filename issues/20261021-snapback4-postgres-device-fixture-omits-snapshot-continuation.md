# Snapback 4: Postgres device fixture omits snapshot continuation

**Status:** Open
**Date:** 2026-10-21
**Systems:** Snapback 4, PostgreSQL evaluation/device fixture
**Found by:** P1-RQ fix round 1 required private-cluster run

`bash snapback4/scripts/test-postgres.sh` passes all 18 experiment conformance
cases, then fails
`postgres_snapshot_offline_queue_reopen_retry_stream_and_revocation_on_existing_device`
at `experiments/postgres/tests/device.rs:26` with
`Generation("snapshot continuation does not match the expected page; restart at its first page")`.

The fixture's snapshot envelope includes `next` but omits `after`, even on
continuation pages. `snapback4-device/src/device/snapshot.rs::continuation`
requires a non-first snapshot's `after` to equal the staged expected cursor.
Update this fixture to drive the current continuation/ownership protocol,
retaining the offline queue, reopen, replay and revocation assertions.

The fixture, device continuation validation and Postgres snapshot code are
unchanged from lane base `6db797f530`; this round changes no snapshot or device
behavior. The observation is from the candidate run; no separate base build
was performed. Evidence is in `/tmp/p1rq-postgres-final.log` on expo-build-1000.
The runner stopped its owned private PostgreSQL 16 cluster on exit.

The request lane changes the runner to collect failure status across all
three stages, so this earlier failure cannot prevent gated request-family
contracts or the corpus from executing. It still exits nonzero on failure.
