# A3 sweep guide-gap: no page teaches sessions-mode schema evolution over existing data

**Opened:** 2026-08-01
**Systems:** Guide
**Related:** LLP 0137 (A3 arm), LLP 0061, LLP 0109, demos/improvement-sweep/arms/a3-snapback-web/findings/0137-a3-f6-guide-gap-sessions-schema-evolution-path.json

Adding an optional field to a table that already has data — the most routine
operation a growing app performs — has no documented path. The
versioned-seeds page says "use a migration to evolve durable data" but
documents no migration surface; `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`
and the startup artifact-pair pin appear nowhere in guide/ (grep verified);
that the live watch reload is the ONLY working path — and its
live-subscriber caveat — is discoverable only by experiment. The A3 arm
spent its single debugging detour here (three probe scripts).

Fix shape: an "Evolving a live app" page/section per LLP 0061: additive
evolution through the running dev loop, the startup pin and its refusal
code, the live-subscriber caveat, the not-yet-supported destructive cases,
with a CI-verified snippet and a retrieval-eval row for "add a field to a
table with existing data".

**Update 2026-08-01 (between-arms fix lane):** two of the behaviors this
page must describe changed. The live-subscriber caveat is gone — watch
reload now evolves cleanly with live handles attached
(issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md) —
and the stop/regenerate/restart refusal now surfaces
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` directly with the expected/observed
deployment identities and a recovery naming the running-server evolution
path (issues/closed/20260801-0137-a3-restart-evolution-refusal-misattributed-diagnostic.md).
The page should teach the working path, not the workaround.

---

**RESOLVED 2026-08-01 (fix-wave docs sweep).** guide/getting-started/the-authoring-loop.md §"Evolve a table that already has data" teaches the working path per the between-arms update: additive evolution through the running watch reload (live handles may stay attached — the caveat is gone), SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH as the stop/restart refusal with its recovery, and the destructive/seed cases routed to LLP 0081 and versioned-seeds.
