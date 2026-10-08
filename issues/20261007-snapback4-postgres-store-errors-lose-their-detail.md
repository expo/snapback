# Snapback 4 Postgres store errors lose their detail

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 4
**Confidence:** 5
**Systems:** Snapback 4, Postgres store, refusals
**Date:** 2026-10-07
**Related:** LLP 3000.035 §5.1

When a Postgres statement fails, the engine's public query and mutation
results carry only `E_STORE: db error`. The SQLSTATE, message, detail, hint
and statement are dropped when the driver error becomes a refusal.

During the differential store pilot, two workers died after about two hours
with exactly that text. The cause was the engine's own 5 s
`statement_timeout` firing on `CREATE TABLE IF NOT EXISTS _read_sessions …`
and on the commit `UPDATE _head …` under catalog churn. It was visible only
in the server log. An operator running Snapback 4 on Postgres would face the
same blind error.

To diagnose its own failures, the harness now carries a 302-line local wire
relay (`snapback4-difftest/src/pg_diagnostics.rs`). It observes Postgres
`ErrorResponse` messages before the engine discards them.

**Fix.** Keep the driver's error chain (SQLSTATE, message, detail, statement
kind) on `E_STORE` refusals, or at least in the server's log line for them.
Then delete the relay and use the refusal directly in `store_database.rs`.
