# Snapback 4: retain the initiating failure of a natural S1 ownership refusal

Status: Open
Date: 2026-10-27
Scope: Postgres S-mode G6, original R0 measurement 041 and batch-controller main W5-exact/B100

The OWN investigation fixes a deterministic lifecycle bug: an uncertain G6
writer/cache epoch kept returning `E_STORE_OWNERSHIP` while the public owner
silently renewed its lease indefinitely. The fixed host logs the pause reason
and exits; a fresh process acquires after lease/read-epoch expiry. Both aborted
and durable unacknowledged writes are covered on private PG16 and PG17.

The original incidents' first warm-up error bodies and database-side initiating
failure were not retained in the supplied evidence. Their initiating event is
therefore still unproven. Do not equate a fault-injected reproduction of the
same wedged state with proof of which fault occurred in either campaign.

On the next natural occurrence, preserve the first failed warm-up response,
the new single ownership reason line, and the private cluster's relevant coded
database error/transaction outcome. Redact credentials and tokens. Distinguish
lost claim/renewal/deadline from unconfirmed data COMMIT or rollback. Keep that
attempt failed in qualification; do not replace it with a successful restart.
No campaign or harness was changed by OWN.

Evidence and reproduction: `snapback4/reports/20261027-ownership-loss/REPORT.md`.

## 2026-10-29: two natural occurrences under Stage R exact-key load

SPR9 (`9ada6771e6`, R opt-in, G6 on) exited with `E_STORE_OWNERSHIP` in two
native S1-R9 repetitions: `0564-W5-same-A-headlines-r9-2262-rep2` (6 ACKs)
and `0683-W5-same-B-headlines-r9-1600-rep2` (3 ACKs); durable counters equal,
rollback or durability recovery not confirmed. Same-binary flag-off main never
exited in the matched blocks. The fail-stop fix worked as designed; the
initiating fault is still unattributed and now has an R-specific reproduction
target (exact key, 1,600–2,262/s). See
`results-20261028-s1-r9-competitive/README.md` and `candidate-failures.json`.
