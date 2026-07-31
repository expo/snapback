# 0044 L1-13: acceptance suite, fault harness, guide page

**Status:** RESOLVED. **Authority:** LLP 0044 §Acceptance (traceability
meta-requirement); LLP 0061 (guide rules); LLP 0010 (agent-checkable).

The lifecycle-v1 acceptance suite with the traceability check (every
normative commitment → row or declared nonclaim), the fault-injection
harness for the named crash cuts, and the hostile-transfer cases in
scope for lifecycle (media processing corpus belongs to the pipeline
program). Guide: an assets page with CI-verified snippets; flip the
backend.assets capability-index GAP row to shipped-with-witness;
absorb issues/20260728-guide-gap-assets-and-notifications row (assets
half). Close-out includes the 0044 status note recording lifecycle-v1
as implemented for the local target.

Done when: the suite runs in the local proof, the guide checks pass,
and the GAP row carries a real witness.

## Resolution (2026-07-31)

Executed on branch 0044-lifecycle-v1: commit this landing. Evidence rows in
tests/acceptance/asset-lifecycle-v1-evidence.md; suites green at each
landing (asset lib, route_policy_v1, artifact_schemas_v0,
name_keying_guard, capability_v0, check-guide where touched).
