# Snapback 4 Postgres adapter DDL occasionally fails with a missing function cache entry

Status: Open
Date: 2026-10-23
Scope: private PG16 adapter test isolation; no demonstrated product identity defect

Lane PH's second complete `bash scripts/test-postgres.sh` attempt, on
`sb4-pg/plan-hygiene`, reports 235 adapter tests passed and one failed:
`engine::postgres::tests::identity::identity_attach_refuses_incompatible_existing_tables`.
At `tests/identity.rs:412`, reopen returned the generic `E_STORE` message
instead of the required `SNAPBACK_IDENTITY_SCHEMA: <table>:` refusal.
This test and identity implementation are unchanged by PH. The first complete
attempt passed this identity case (that attempt failed other stages).

The owned PG16.15 log records, at 2026-10-23 22:20:18 CEST, backend 1946866:

- Error: `cache lookup failed for function 894294`.
- Statement: `CREATE TABLE IF NOT EXISTS _sequences (parent TEXT NOT NULL, id TEXT NOT NULL, value BIGINT NOT NULL, PRIMARY KEY(parent, id));`.

A possible interaction is the database-wide event trigger in
`engine/postgres/tests/release.rs`'s preparation witness, which creates and
removes its function while other tests execute DDL. That attribution is an
inference, not an established cause. The PH performance witness already uses
its own database and its tables are independent of this identity namespace.

Retain the failed attempt; do not weaken the expected refusal or raise a
timeout. Investigate concurrent event-trigger installation/removal and isolate
such fixtures if the causal interleaving is confirmed. Serial outer-test
scheduling is a qualification comparison, not a repair of the parallel runner.

Raw evidence remains outside Git under
`/tmp/claude-1000/-home-ccheever-projects-snapback/3d04fc0c-0698-42a7-917c-2880afdea35c/scratchpad/ph/`:
`postgres-suite-2.log`, its run receipt and `pg-running.log`.

Serial outer-test comparison: all 236 adapter cases, including this identity
case, pass unchanged. This does not repair the parallel test-isolation issue.
The serial full runner separately fails binary-test linking; nonincremental
rebuild plus all 71 affected binary rechecks pass. See the PH journal entry.
