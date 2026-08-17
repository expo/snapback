# `artifact_schemas_v0` reports 8 failures from committed-schema/demo-output drift

**Filed:** 2026-08-15 · **Source:** supervised multi-lane ticket-fix run
(Lane B, auth lifecycle) · **Systems:** Generated artifacts, Proof/CI

**Status:** reported, not independently confirmed by the filer — see below.

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

## Suggested fix

1. Run `artifact_schemas_v0` on a clean `main` checkout and record the actual
   failing set. If it reproduces, the failures are inherited and this becomes an
   ordinary regeneration task.
2. Regenerate the committed schema/demo outputs that drifted, in one focused
   landing rather than piecemeal inside feature lanes — several lanes correctly
   declined to do it precisely because it would have created cross-lane
   conflicts, which means nobody does it.
3. If the drift is structural rather than stale output, say so and open the
   governing design question instead of regenerating.

## Related

- `issues/20260815-check-guide-masks-later-checks-without-node-modules.md` —
  same underlying problem of shared generated state being hard to attribute from
  inside a single lane.
- `issues/20260810-main-rustfmt-drift-under-1-9-0.md`

## Corroboration (2026-08-15, LLP 0257 implementation lane)

An independent lane (LLP 0257 activity-presence implementation, landed
`ee34395b5`) hit the same family from the JS side: the repository-wide
`scripts/check-generated-artifacts` refused with
`[check-generated-artifacts] FAIL: committed review manifests or policy
projections are stale` on a tree whose diff was confined to
`packages/snapback-react`, `packages/snapback-expo`, the guide, and the
messaging demo. The lane restored the check's unrelated tracked rewrites
and landed only its own regenerated diagnostic/reference/guide outputs;
its own scoped checks (guide-check 18/0, check-inventories PASS 290,
ref-check 0) were green. This upgrades the original report from
"attributed, unverified" to corroborated-by-a-second-independent-lane on
the same day; the stale committed projections predate both lanes.


## Update 2026-08-17 (slice-2 lane, ephemeral-membership program)

The suite stopped compiling at ce30ee99e (LLP 0240 D3, 2026-08-16, which
added `MutationResponse.authority_transitions`;
`tests/artifact_schemas_v0.rs:3152` was not updated), so the drift above
was masked by a compile error. The slice-2 landing fixes the initializer
(one field, `authority_transitions: Vec::new()`). With the suite compiling
again the current state is **35 passed, 1 failed**:

- `dk7_representative_values_validate_against_committed_schemas` —
  schemars/serde mismatch: `/schema: "identityBindingTables" is a required
  property` and `/schema: "assetCollections" is a required property`
  against the committed `inspect.public.schema.json`. Pre-existing content
  red (reproduces with the compile fix alone on the c19c3f3a6 base).
  Regeneration alone will NOT fix it: `dk7_committed_schemas_match_rust_types`
  passes, so the committed schema matches schemars. The defect is the
  serde/schemars contract on `PublicSchemaManifest` (src/manifest.rs:~1690):
  empty vecs are omitted during serialization while the generated schema
  marks `identityBindingTables`/`assetCollections` required. Reconcile the
  Rust serde/schemars contract (serialize empty arrays, or mark the fields
  optional in schemars) — owned by the inspect-surface lane.
