# snapback4: live PostgreSQL qualification of the shared-baseline additions

**Status:** Open · **Filed:** 2026-09-25 · **Systems:** `snapback4-core` Postgres adapter (`engine/postgres/`) · **Source:** every landing review of LLP 3000.015's lanes (2026-09-25)

## What

All six landing reviews and the integration qualified the three additions on memory and SQLite; the Postgres-feature **unit** tests pass and the integration lane ran the adapter's key-only endpoint tests against a private socket cluster, but the live-service tests (for example `sequence_by_is_transactional_shared_and_durable`, `postgres/tests.rs`) are `#[ignore]` and were not run by any reviewer. Grok's B2 landing review named a mutation the blocking suite would miss for exactly this reason: replacing Postgres `set_sequence` with `Ok(())` reuses ordinals and only the ignored live test catches it. The row-keyed view refuses on Postgres by design (`E_VIEW_KEY` before open); `written by` and `sequence by` claim Postgres parity without live evidence.

## Done when

The ignored live Postgres tests for `sequence by` and `written by` run green against a real cluster in the local proof (or a scheduled backstop), and the guide's Postgres statements for the three features cite that run.
