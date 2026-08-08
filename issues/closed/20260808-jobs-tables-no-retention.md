# Durable jobs tables have no retention — terminal rows and full args kept forever

**Opened:** 2026-08-08 · **Severity:** P2 (unbounded SQLite growth; retains user-data args indefinitely, contradicting LLP 0070) · **Area:** jobs

## What

`src/jobs.rs`

`_snapback_jobs_v1` / `_snapback_job_attempts_v1` (~303-356) are only ever
INSERTed/UPDATEd. `rg 'DELETE FROM _snapback_job'` across `src/` has zero hits.
Succeeded / dead / cancelled rows keep `args_json` (up to 64KB each) forever.

## Failure scenario

An app that enqueues jobs steadily grows its SQLite file without bound;
`pending_job_count`-style scans and the idempotency unique index degrade over
time; and canonical argument payloads — potentially user data — are retained
indefinitely, contradicting LLP 0070's retention section ("Retention deletes
canonical args and result bodies only after the declared terminal window…").

## Fix

Add a bounded terminal-row sweep that retains only the idempotency tombstone +
digest per LLP 0070, or at minimum an admin purge op mirroring
`purge_client_mutation_settlements`.

## Confidence

High that no purge exists; medium on severity — the module header narrows v1
("First slice as shipped"), so this is a known Draft narrowing rather than a
regression. But peer subsystems (operation ledger, client-mutation settlements)
already ship purges, and nothing currently tracks this gap. Part of the "every
registry names its retention bound" theme.

## Resolution (2026-08-08)
Fixed on main (Lane J). Verified: cargo build; stream-attempt 8 pass, jobs 9 pass, production diagnostic inventory + reviewed-HTTP families pass, fork custody test pass; ref-check clean.
