# main red: a8787cb53 (handler-error enrichment) leaves three lib tests failing

- **Status:** Open
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
