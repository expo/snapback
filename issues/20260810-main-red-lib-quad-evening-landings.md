# main red: 4 lib tests fail at evening main (s5_d10 pair, capability-maturity grammar, served-http refusals)

**Status:** Open
**Systems:** Server, Manifest, Testing
**Date:** 2026-08-10
**Detected during:** lane J (LLP 0093 wire identity) full-lib verification; reproduced on pristine origin/main

Failing on a clean checkout (verified twice today, after 5ec55a8b1):

- `server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`
- `server::tests::s5_d10_all_emitted_diagnostics_have_reviewed_http_status`
- `manifest::membership_manifest_grammar_tests::capability_maturity_promotions_hold_and_admission_stays_fail_closed`
- `server::tests::served_http_refusals_project_typed_candidates_and_argument_contracts`

The s5_d10 pair red means an evening landing introduced SNAPBACK_* codes
without classifying them in the reviewed HTTP tables (same class as the
three same-day precedents, all fixed same-day). served_http_refusals is the
long-listed pre-existing red now joined by the grammar test. Attribution not
bisected here — owners of this evening's crates/snapback/src/server + manifest landings
should claim; per the 2026-08-10 sitting convention, unclaimed for 24h →
fix-forward by anyone.

## Re-observation — 2026-08-15 (supervised ticket-fix run)

The failing set has drifted since filing. At `1c05bba66` (three independent
full-lib runs today, default stack) the red set is exactly five:

- `manifest::membership_manifest_grammar_tests::capability_maturity_promotions_hold_and_admission_stays_fail_closed`
- `manifest::membership_manifest_grammar_tests::packaged_store_qualification_mode_is_public_package_only_and_manifest_honest`
- `runtime::table_visibility_runtime_tests::table_visibility_ctx_db_query_refuses_conflicting_handler_policy`
- `server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`
- `server::tests::served_http_refusals_project_typed_candidates_and_argument_contracts`

`s5_d10_all_emitted_diagnostics_have_reviewed_http_status` (from the original
quad) is green again. The current five are the MediaRef-rollout manifest-drift
family (the capability_maturity assertion diff literally shows
`MediaRefProjectionV1` present-vs-absent), owned by the in-flight LLP 0239
media lane; see `issues/closed/20260815-codegen-pretest-media-ref-capability-unsupported.md`
for the sibling package-level signature. The 2026-08-15 rehearsal-capture
stack-overflow abort that used to hide part of the suite is fixed
(`ab825e299`), so the full suite reaches its summary on default stacks —
these five are the complete red set, not a lower bound.
