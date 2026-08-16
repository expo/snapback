# Committed schema and generated-demo output drift is red in CI

**Filed:** 2026-08-15 · **Source:** supervised multi-lane ticket-fix run
(Lane B, auth lifecycle) · **Systems:** Generated artifacts, Proof/CI

**Status:** Open. Generated-artifact drift is independently confirmed on
current `main`; the original `artifact_schemas_v0` failing set still needs its
clean-main rerun described below.

## Problem

While verifying the auth-lifecycle work, the lane ran `artifact_schemas_v0` and
observed **27 passed, 8 failed**, attributing the failures to
"unrelated committed-schema/demo-output drift" rather than to its own change.
That attribution is plausible — the lane's diff was confined to the auth path
and the guide projections — but it was not verified against a clean base, and
the run's supervisor did not re-run this gate independently because doing so
needs a full Rust build.

Two other lanes in the same run independently reported broad pre-existing
drift in adjacent generated surfaces:

- `./scripts/check-generated-artifacts` reported stale committed demo review
  manifests / policy projections (Lane G, deliberately reverted rather than
  mass-regenerated to avoid cross-lane conflicts).
- `cargo fmt --all -- --check` reported ~2,029 lines of repository-wide
  formatter drift across untouched files (Lanes B, D, G) — already tracked
  separately as `issues/20260810-main-rustfmt-drift-under-1-9-0.md`.

So the surrounding evidence is consistent with genuine committed-output drift on
`main` rather than a lane regression, but this ticket should not be treated as
established until someone confirms it.

## CI confirmation — 2026-08-15

GitHub Actions independently reproduced the generated-output half of this
ticket at `main` revision `a93a11235f94ac40077c8f8f3c6d420f40a9bde7`:

- Push and scheduled `local-proof` runs
  ([push](https://github.com/expo/snapback/actions/runs/31918029861),
  [scheduled](https://github.com/expo/snapback/actions/runs/31918612068))
  ended with `[check-generated-artifacts] FAIL: committed review manifests or
  policy projections are stale` and showed drift across demo and React fixture
  outputs.
- `required-surface-builds`
  ([run](https://github.com/expo/snapback/actions/runs/31918029823)) refused the
  All Aboard surface because its committed review manifest is stale.
- `all-aboard-cold-clone`
  ([run](https://github.com/expo/snapback/actions/runs/31918029835)) regenerated
  a different All Aboard codegen graph and review manifest.
- `deployment-identity`
  ([run](https://github.com/expo/snapback/actions/runs/31918029870)) stopped
  while materializing the same stale All Aboard inputs, before deployment
  identity recomputation.
- The latest telemetry candidate on the preceding `main` revision
  ([run](https://github.com/expo/snapback/actions/runs/31917697439)) failed with
  `SNAPBACK_TELEMETRY_PHASE1_GENERATED_FIXTURE_DRIFT`.

This confirms a real current-main generated-artifact failure; it does not by
itself confirm that all eight originally reported `artifact_schemas_v0`
failures have the same root. LLP 0189 D-1 requires distinct signatures to stay
separate if the clean-main schema test reveals structural failures beyond this
regeneration drift.

## Suggested fix

1. Run `artifact_schemas_v0` on a clean `main` checkout and record the actual
   failing set. The generated-artifact drift is already confirmed; split out
   any structurally distinct schema failures rather than coalescing them.
2. Regenerate the committed schema/demo outputs that drifted, in one focused
   landing rather than piecemeal inside feature lanes — several lanes correctly
   declined to do it precisely because it would have created cross-lane
   conflicts, which means nobody does it.
3. If the drift is structural rather than stale output, say so and open the
   governing design question instead of regenerating.

## Acceptance

- `scripts/check-generated-artifacts` passes from a clean checkout.
- All Aboard regeneration leaves its committed review manifest unchanged.
- The affected `local-proof`, `required-surface-builds`,
  `all-aboard-cold-clone`, and `deployment-identity` checks pass for the repaired
  semantic inputs.
- `artifact_schemas_v0` is rerun independently; any different root signature
  gets its own LLP 0189 D-1 ticket.

## Related

- `issues/20260815-check-guide-masks-later-checks-without-node-modules.md` —
  same underlying problem of shared generated state being hard to attribute from
  inside a single lane.
- `issues/20260810-main-rustfmt-drift-under-1-9-0.md`
