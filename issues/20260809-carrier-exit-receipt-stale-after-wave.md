# local-store carrier-exit receipt stale after the S4/replication waves

**Opened:** 2026-08-09

`node tests/acceptance/local-store-carrier-exit-v1.mjs` fails a digest
assertion (expected 7090ed1b…, actual 3f3a2e55…) at 41b8318a0 — BEFORE the
0199 slice-14 landing (stash-checkout verified), so this is pre-existing
drift, not the extraction's. The receipt was last requalified at 1980f41b7
("requalify triage-graph/fleet/carrier-exit receipts … after the wire-schema
rotation"); one of the subsequent landings (S4 ask wave, diagnostics-registry
codegen a827683d2, or the LLP 0188 replication lane) rotated the pinned
surface again without re-running the carrier-exit leg.

Requalification needs the standards-real runner (Chrome/CDP owner +
SIGKILL-first process-death leg per LLP 0155/0166) — the rotating session
owns it. The pre-push drift tier reports it as ALLOWED-pre-existing for
unrelated pushes; the 0199 slice-14 bypass verification surfaced it.
