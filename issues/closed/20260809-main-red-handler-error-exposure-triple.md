# main red: a8787cb53 (handler-error enrichment) leaves three lib tests failing

- **Status:** Closed
- **Date:** 2026-08-09
- **Systems:** runtime, testing
- **Detected during:** LLP 0204 S2 Landing A pre-landing verification

Commit `a8787cb53` ("fix(runtime): enrich SNAPBACK_HANDLER_FAILED with the
underlying JS error under managed dev") leaves main red on three lib tests:

1. `server::tests::s5_d10_production_diagnostic_inventory_cannot_drift` —
   the new env-var constant `SNAPBACK_HANDLER_ERROR_EXPOSURE`
   (src/runtime.rs:2911) matches the s5_d10 SNAPBACK_* scanner and is
   unclassified. Either classify it or rename the env var out of the
   scanner's namespace (precedent: the agent-skill curl placeholders were
   renamed to $APP_* for exactly this reason).
2. `local::tests::detached_mutation_binds_schema_and_app_generation_across_reload`
   — `readNewTable` now fails with SNAPBACK_HANDLER_FAILED where the staged
   schema was previously used.
3. `runtime::membership_bridge_tests::sequence_abort_disclosure_channels_leave_no_durable_or_result_trace`
   — tentative sequence disclosure now Null where "tentative:1" was
   expected.

All three reproduce at origin/main tips after a8787cb53 with unrelated
working-tree changes absent. Owner: the handler-error-exposure landing's
author. (The pre-existing implementationScope red is tracked separately in
issues/20260809-main-red-agent-safe-derived-chain-implementationscope.md.)

**Addendum (S4 Landing A verification):**
`action_stream_envelope_v0::staged_secret_values_are_scrubbed_from_stream_error_envelopes`
shows the same signature (generic SNAPBACK_HANDLER_FAILED where the enriched
scrubbed detail is expected) and reproduces with the pre-a8787cb53 harness
bootstrap, so it belongs to this family too. Same owner.

## Author ruling — 2026-08-10

**Author-routing released: any session may fix this forward now.** General
convention adopted at the same sitting: a main-red ticket unclaimed by its
landing's author for 24 hours converts to fix-forward-by-anyone. Guidance:
rename `SNAPBACK_HANDLER_ERROR_EXPOSURE` out of the scanner namespace (or
classify it) per the `$APP_*` precedent; treat the three behavioral failures
as regressions in the enrichment landing to fix or partially revert — the
scrubbed-detail addendum indicates a real gap in the enrichment, not stale
tests.

## Resolution — 2026-08-10

Fixed forward without weakening the four expectations.

1. The s5_d10 inventory classifies HTTP diagnostic codes, not every
   production-relevant environment variable. `SNAPBACK_HANDLER_ERROR_EXPOSURE`
   is a legitimate process setting and not an HTTP diagnostic, so the existing
   explicit `NON_DIAGNOSTIC_SNAPBACK_LITERALS` classification added in
   `339e9fed3` is the correct resolution; renaming the setting as a dev-only
   placeholder would misstate its production redaction role.
2. The enrichment projected a generic redacted handler error before the
   staged-mutation caller could observe the trusted host-built
   `SNAPBACK_UNKNOWN_TABLE` diagnostic. The shared host-call seam now records
   the trusted failure out of band, and result assembly restores it only when
   the handler's raw final code claim matches that witness. A forged code with
   no matching witness remains `SNAPBACK_HANDLER_FAILED`. The same raw-claim
   join is carried through the workerd twin so the engine paths cannot drift.
3. The sequence test is specifically proving the LLP 0135 app-authored
   throw/console disclosure channel, not the production-default error
   projection. `13ab8037c` had already pinned that invocation to development
   exposure while retaining the original `"tentative:1"` expectation and the
   no-durable/no-result-trace assertions; this lane preserved and reverified
   that correction.
4. In redacted mode the secret scrubber changed the private failure carrier,
   but the public generic projection had already discarded its message, so
   there was no observable proof that scrubbing occurred. Generic handler
   errors now add the literal value-free `"[REDACTED]"` detail only when the
   invocation-lifetime redactor actually changed private message or stack
   data. Secret bytes remain absent.

The four named tests and their complete containing modules pass. The full lib
suite was also run; its remaining failures are outside this family and are
recorded in `LANE_REPORT.md`.
