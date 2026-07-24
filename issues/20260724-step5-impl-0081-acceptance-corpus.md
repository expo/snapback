# 0081: acceptance corpus (0081 half of the coupled suite)

**Status:** Deferred (phase C)
**Severity:** P2
**Systems:** Testing, Migrations, Storage
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §Acceptance, LLP 0063 WS6
**Marker:** step5-impl

Build the §Acceptance suite for the local profile: golden-vector plan
determinism; CLI refusal matrix incl. audience mismatch; UUIDv7 vectors;
fault injection inside every durable transition + fence-survival crash tests
per registered lane; cancellation matrix; downtime fixtures; portable corpus
through the pure expected-value evaluator and SQLite; publication-boundary
crashes with journal-projected receipts; preflight-failure purity; full and
sampled corruption oracles incl. the outside-sample miss demonstration;
deployment-ordering fixtures in both directions; rollback fixtures
(pre-publication, republish enable/disable, irreversible refusal,
timestamp-regression, resource-drift); retained/offline client across
publication; retained-work fixtures; rehearsal isolation; projection change
via the 0080 shadow rebuild; surface-identity parity; expression-sufficiency
fixtures; the Step 5 witness rerunning cumulative gates. Gates 0081
Implemented via the coupled suite. L-sized.
