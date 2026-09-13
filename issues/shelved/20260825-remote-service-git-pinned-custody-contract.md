# Reconcile remote-service gitPinnedCheckout with generated-artifact custody

**Status:** Open · **Opened:** 2026-08-25 · **Owner needed:** remote-service publication contract

The remote-service profile and the generated-artifact custody policy currently
make incompatible delivery promises:

- `RemoteServiceProfile.publication.kind` is generated as
  `"gitPinnedCheckout"` with `addressing: "commitSha"`
  (`packages/snapback-codegen/index.mjs`, `buildRemoteServicePublication`).
- The owning contract says a consumer pins the containing Snapback commit and
  verifies every referenced artifact before constructing a transport
  (`crates/snapback-types/src/service_profile.rs:1-6`; LLP 0051
  §remote-service-publication).
- The custody registry places the output at
  `scripts/generated-artifact-policy.mjs:56` in `REVIEW_CACHE_ROOTS`, while
  `.gitignore:50` ignores the complete directory before selectively restoring
  only the review manifest and consumer-committed review projections.
- `demos/todo-v2/snapback/codegen.policy.json:3-5` commits only the schema and
  function manifests in addition to the review/governance leaves. The profile,
  capability manifest, auth/data capability manifests, and operation schemas
  referenced by the profile remain absent from a clean pinned checkout.

The schema fix lane deliberately does not re-commit the large closure and does
not reinterpret or hand-edit any digest.

## Decision required

The contract owner must choose and document one coherent channel:

1. Make `gitPinnedCheckout` mean that the profile and every referenced
   generated leaf are present in the selected commit, then change custody and
   publication gates accordingly; or
2. Keep the leaves as regenerable caches, replace/clarify the publication kind
   and consumer protocol, and specify how a consumer deterministically
   materializes and verifies the closure from pinned committed inputs.

## Acceptance

- The profile field, Rust contract, LLP 0051 text, generated-artifact policy,
  ignore rules, and consumer instructions agree on one delivery model.
- A clean checkout at a selected commit can execute the documented consumer
  flow without relying on pre-existing ignored files.
- Tests prove the chosen closure and digest behavior without writing tracked
  generated trees.
