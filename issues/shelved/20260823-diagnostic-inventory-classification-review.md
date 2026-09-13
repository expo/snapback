# Classification review for widening the diagnostic inventory scan

Status: Open — review complete, implementation not dispatched
Created: 2026-08-23
Related: issues/shelved/20260823-diagnostic-inventory-scan-lost-scope-after-carve.md (the diagnosis),
issues/shelved/20260821-elevated-read-trace-stale-exclusion.md,
issues/shelved/20260821-server-suite-six-pre-existing-failures.md,
issues/shelved/20260822-diagnostic-http-status-registry-gaps.md

## Why

The diagnosis established that `production_snapback_literals()` lost scope after the crate carve,
leaving 105 of 149 exclusions stale and `s5_d10_production_diagnostic_inventory_cannot_drift` --
the only red on `main` -- panicking at the second one. It also established the trap: **"Bulk-assigning
them to 500 would not constitute review."** Widening the scan without classifying what it exposes
would turn the test green while destroying the property it enforces.

This is that review.

## Result

**The 91 literals do not belong in one 500 bucket, and none of them requires a guessed status.**

- **54 are HTTP-reachable** and individually mapped: 16 × 400, 3 × 409, 1 × 422, 27 × 500, 7 × 503.
- **37 are non-HTTP**: CLI, startup, recovery-internal, successful-response metadata or warnings,
  or test-support only.

Every reachable code was classified from its producer and consumer path, not from its name. The
deliberate 500 fail-safe default stays as the fallback (`crates/snapback-server/src/server/api_error.rs:133-139`),
but it is no longer standing in for review.

## The finding nobody asked for, and the one that matters most

**A root-only fix would red the test again immediately.** The accepted direction — reuse the
canonical root list from `scripts/generate-diagnostics-registry.mjs` — is right, but the
implementation must share the generator's **source-selection policy**, not merely copy its root
strings.

The generator excludes `test`, `tests`, `fixture`, and `template` directories
(`scripts/generate-diagnostics-registry.mjs:36-49`). The Rust walker recurses into every directory
and skips only exact `#[cfg(test)]` files, not ordinary `#[test]` functions
(`crates/snapback-server/src/server/tests.rs:21757-21762`, `:21725-21729`). Retaining that recursion
surfaces three further test-only strings beyond the diagnosed 9 + 91, including
`SNAPBACK_IBEX_CLI_UNAVAILABLE`, whose production diagnostic is explicitly **retired**
(`crates/snapback-runtime/src/runtime.rs:98-103`) and which now survives only in negative test
assertions.

This is the one unresolved boundary question: share the generator's complete production-path
selector, or keep the AST walker and account for the extra strings.

## Naming correction

Six of the nine "non-HTTP" exclusions are **real `SnapbackError` diagnostics** — bench, startup,
and test-support ones. They are not non-diagnostic, they are non-HTTP. They belong in a separately
named reviewed set (e.g. `NON_HTTP_DIAGNOSTIC_LITERALS`) rather than being described as something
they are not.

## Sequencing

The widening and the classifications should land **atomically**. A staged landing leaves the test
red in between, and a partial classification is the bulk-assignment failure in slower motion.

## 1. The nine non-HTTP exclusions

All nine are clearly non-HTTP. Six are nevertheless real `SnapbackError` diagnostics used by bench, startup, or test-support APIs. They should ideally live in a separately named reviewed set such as `NON_HTTP_DIAGNOSTIC_LITERALS`, not be described as “non-diagnostic.”

| Literal | Construction | What it is | Suggested adjacent justification |
|---|---|---|---|
| `SNAPBACK_AUTH_ACCEPTANCE_OVERFLOW_RECEIPT` | `crates/snapback-engine/src/local/tests/engine.rs:28717` | Acceptance-test stdout receipt marker; not a `SnapbackError` | `machine-readable overflow-sentinel receipt emitted only by the auth acceptance test; never an HTTP diagnostic` |
| `SNAPBACK_BENCH_READ_FAILED` | `crates/snapback-kernel/src/storage.rs:3392` | Genuine diagnostic from a benchmark-only result reader | `fork-promotion contention benchmark read-helper failure; benchmark harness only and never reachable from HTTP` |
| `SNAPBACK_BENCH_SETUP_FAILED` | `crates/snapback-kernel/src/storage.rs:3344` | Genuine diagnostic from benchmark setup | `fork-promotion contention benchmark setup failure; benchmark harness only and never reachable from HTTP` |
| `SNAPBACK_BENCH_WRITER_POISONED` | `crates/snapback-engine/src/bench_support.rs:102` | Genuine diagnostic for a poisoned benchmark mutex | `contention-benchmark engine-lock failure; benchmark support only and never reachable from HTTP` |
| `SNAPBACK_DEV_IDENTITY_CAPABILITY_MISSING` | `crates/snapback-auth/src/dev_identity.rs:123,128` | One-per-boot stderr warning, not a returned diagnostic | `operator-terminal warning for one accepted legacy dev-identity assertion; emitted to stderr and never returned over HTTP` |
| `SNAPBACK_DEV_IDENTITY_CONFIG_FORBIDDEN` | constant at `crates/snapback-auth/src/dev_identity.rs:22`; constructed at `:308-318` | Genuine production-startup refusal | `production startup refusal for a forbidden developer-identity sidecar; returned before serving begins and never crosses HTTP` |
| `SNAPBACK_DEV_IDENTITY_FILE_INVALID` | `crates/snapback-auth/src/dev_identity.rs:300-305`; callers `:280-289` | Genuine startup/config-file diagnostic | `developer-identity capability-file parsing failure during local startup/configuration; never crosses HTTP` |
| `SNAPBACK_TEST_SUPPORT_RUNTIME_FORBIDDEN` | `crates/snapback-engine/src/local/engine.rs:19880-19891` | Genuine refusal from the feature-gated public test-support wrapper | `test-support surface refusing a non-HostPlan runtime; feature-gated test helper only and never reachable from HTTP` |
| `SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG` | `crates/snapback-types/src/visibility_governance.rs:18` | Environment-variable name | `environment variable naming the visibility-governance target configuration; never a diagnostic code` |

None should receive an HTTP status. The three bench codes, two startup errors, and test-support refusal are genuine diagnostics despite being non-HTTP.

## 2. The 91 diagnostic literals

### A. Action-stream persistence — 2

These propagate through server action-stream persistence paths such as `crates/snapback-server/src/server.rs:25233,25268,28482`.

| # | Literal and construction | HTTP verdict | Reason |
|---:|---|---|---|
| 1 | `SNAPBACK_ACTION_STREAM_PERSISTENCE_AUTHORITY_UNAVAILABLE` — `crates/snapback-sync/src/stream_attempt.rs:503` | **500** | Entropy/MAC authority creation failed inside the server; the caller cannot repair it. |
| 2 | `SNAPBACK_ACTION_STREAM_PERSISTENCE_UNAUTHORIZED` — `crates/snapback-kernel/src/storage/settlement.rs:869,876,883` | **500** | Issuer, tag, or database binding violated an internal persistence authority invariant; this is not user authentication. |

### B. Authority profiles, projection, and generated operations — 27

The plan/backfill family is invoked from CLI authority migration commands at `crates/snapback-cli/src/cli.rs:3403,3463`; those codes do not cross HTTP. Host-glue codes propagate through ordinary function invocation.

| # | Literal and construction | HTTP verdict | Reason |
|---:|---|---|---|
| 3 | `SNAPBACK_AUTHORITY_BACKFILL_LEDGER_INVALID` — `crates/snapback-kernel/src/storage.rs:3886,3894,3930,3956,3989` | **Non-HTTP** | CLI backfill found a malformed or divergent historical ledger. |
| 4 | `SNAPBACK_AUTHORITY_BACKFILL_PROFILE_INVALID` — `crates/snapback-kernel/src/storage.rs:3734,3798` | **Non-HTTP** | CLI backfill was given an invalid authority profile. |
| 5 | `SNAPBACK_AUTHORITY_BACKFILL_PROFILE_MISSING` — `crates/snapback-kernel/src/storage.rs:3718` | **Non-HTTP** | CLI backfill could not locate its named profile. |
| 6 | `SNAPBACK_AUTHORITY_BACKFILL_PROJECTION_REQUIRED` — `crates/snapback-kernel/src/storage.rs:3728` | **Non-HTTP** | CLI backfill was requested for a profile without the required projection. |
| 7 | `SNAPBACK_AUTHORITY_HISTORY_PAGE_INVALID` — `crates/snapback-engine/src/runtime/host_glue.rs:3102,3135` | **400** | A handler supplied an invalid history page or cursor argument. |
| 8 | `SNAPBACK_AUTHORITY_INVITE_ALREADY_ACTIVE` — `crates/snapback-kernel/src/storage/membership_plans.rs:554` | **409** | The requested invite conflicts with an already-active membership. |
| 9 | `SNAPBACK_AUTHORITY_INVITE_ALREADY_PRESENT` — `crates/snapback-kernel/src/storage/membership_plans.rs:559` | **409** | An equivalent pending invite already exists. |
| 10 | `SNAPBACK_AUTHORITY_PLAN_MIRROR_DUPLICATE` — `crates/snapback-kernel/src/storage.rs:3592` | **Non-HTTP** | CLI planning detected duplicate mirror rows. |
| 11 | `SNAPBACK_AUTHORITY_PLAN_MIRROR_MISSING` — `crates/snapback-kernel/src/storage.rs:3502,3510` | **Non-HTTP** | CLI planning found a required mirror absent. |
| 12 | `SNAPBACK_AUTHORITY_PLAN_MIRROR_SHAPE_MISMATCH` — `crates/snapback-kernel/src/storage.rs:3535,3556,3565,3574` | **Non-HTTP** | CLI planning found a mirror whose schema/shape disagrees with the profile. |
| 13 | `SNAPBACK_AUTHORITY_PLAN_PROFILE_INVALID` — `crates/snapback-kernel/src/storage.rs:3492,3516` | **Non-HTTP** | CLI planning rejected malformed profile metadata. |
| 14 | `SNAPBACK_AUTHORITY_PLAN_PROFILE_MISSING` — `crates/snapback-kernel/src/storage.rs:3476` | **Non-HTTP** | CLI planning could not locate the requested profile. |
| 15 | `SNAPBACK_AUTHORITY_PLAN_PROJECTION_REQUIRED` — `crates/snapback-kernel/src/storage.rs:3486` | **Non-HTTP** | CLI planning requires a declared authority projection. |
| 16 | `SNAPBACK_AUTHORITY_PLAN_SERIALIZATION_FAILED` — `crates/snapback-kernel/src/storage.rs:3620` | **Non-HTTP** | CLI plan receipt serialization failed. |
| 17 | `SNAPBACK_AUTHORITY_PROFILE_INDEX_REQUIRED` — `crates/snapback-kernel/src/membership_rules.rs:1251` | **500** | The authenticated admin inspection route (`crates/snapback-server/src/admin.rs:5687-5698`) found an admitted profile missing its canonical point index. |
| 18 | `SNAPBACK_AUTHORITY_PROFILE_ROLE_LATTICE_INVALID` — `crates/snapback-kernel/src/storage.rs:11855` | **400** | Artifact activation supplied an invalid role lattice. |
| 19 | `SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_COMPOSITION_CLASS` — `crates/snapback-kernel/src/membership_rules.rs:1320` | **Non-HTTP** | It is a `refusal_code` inside a successful authority-inspection document, not a top-level error. |
| 20 | `SNAPBACK_AUTHORITY_PROJECTION_CORRUPT` — `crates/snapback-kernel/src/storage.rs:9810,9892` | **500** | Stored projection JSON or identity is corrupt. |
| 21 | `SNAPBACK_AUTHORITY_PROJECTION_FULL_PROVENANCE_REQUIRED` — `crates/snapback-kernel/src/storage.rs:3740` | **Non-HTTP** | CLI backfill requires full historical provenance. |
| 22 | `SNAPBACK_AUTHORITY_PROJECTION_REQUIRED` — `crates/snapback-engine/src/runtime/host_glue.rs:3119,3259` | **400** | A handler attempted an authority-projection operation without a declared projection. |
| 23 | `SNAPBACK_AUTHORITY_PROJECTION_ROW_INVALID` — `crates/snapback-kernel/src/storage.rs:11334,18358,18365,18373,18396` | **500** | A framework-produced or stored projection row violated the admitted projection schema. |
| 24 | `SNAPBACK_AUTHORITY_PROJECTION_SERIALIZATION_FAILED` — `crates/snapback-kernel/src/storage.rs:18443` | **500** | The server failed to serialize an internally constructed projection row. |
| 25 | `SNAPBACK_AUTHORITY_RECIPIENT_CEILING_EXCEEDED` — `crates/snapback-kernel/src/membership_rules.rs:703` | **400** | A generated authority operation exceeded its declared bounded recipient set. |
| 26 | `SNAPBACK_AUTHORITY_RECIPIENT_SINK_FROZEN` — `crates/snapback-engine/src/runtime/host_glue.rs:5373` | **400** | The handler attempted to modify or delete a frozen recipient sink field. |
| 27 | `SNAPBACK_AUTHORITY_RECIPIENT_SINK_INVALID` — `crates/snapback-engine/src/runtime/host_glue.rs:3316` | **400** | Generated handler output supplied an invalid recipient sink row. |
| 28 | `SNAPBACK_AUTHORITY_RECIPIENT_SNAPSHOT_INVALID` — `crates/snapback-engine/src/runtime/host_glue.rs:3250` | **400** | The handler supplied malformed snapshot arguments. |
| 29 | `SNAPBACK_AUTHORITY_RECIPIENT_SNAPSHOT_MUTATION_REQUIRED` — `crates/snapback-engine/src/runtime/host_glue.rs:3242` | **400** | The operation was attempted outside a mutation context. |

### C. Authentication, client protocol, and mutation integrity — 14

The participant codes are database-bound room/commit interlock invariants constructed at `crates/snapback-kernel/src/storage.rs:1981-2244` and `storage/room_authority.rs:424,2285-2314`.

| # | Literal and construction | HTTP verdict | Reason |
|---:|---|---|---|
| 30 | `SNAPBACK_AUTHORIZED_LEASE_CLIENT_UNSUPPORTED` — Rust registry occurrence `crates/snapback-server/src/server/api_error.rs:117`; actual producers `packages/snapback-contract/authorized-lease.mjs:240,434` | **Non-HTTP** | This is a client/contract compatibility refusal, not a server producer. |
| 31 | `SNAPBACK_AUTH_CLAIMS_AUTHORITY_INVALID` — `crates/snapback-sync/src/auth/invocation.rs:791` | **500** | The internal claims carrier does not belong to the invocation authority. |
| 32 | `SNAPBACK_AUTH_CLAIMS_CORRUPT` — `crates/snapback-kernel/src/storage/auth_identity.rs:3478,3488,3497,3547,3561` | **500** | Persisted claims cannot be decoded or satisfy their storage invariant. |
| 33 | `SNAPBACK_AUTH_INTERLOCK_RETIRED` — `crates/snapback-kernel/src/storage.rs:2244`; `storage/room_authority.rs:2314` | **500** | An internal commit participant outlived its authority interlock. |
| 34 | `SNAPBACK_AUTH_PARTICIPANT_ALREADY_TAKEN` — `crates/snapback-kernel/src/storage.rs:1981` | **500** | A take-once internal participant was claimed twice. |
| 35 | `SNAPBACK_AUTH_PARTICIPANT_DATABASE_MISMATCH` — `crates/snapback-kernel/src/storage.rs:2207`; `storage/room_authority.rs:2290` | **500** | A participant was presented to the wrong database. |
| 36 | `SNAPBACK_AUTH_PARTICIPANT_DEPENDENCY_PENDING` — `crates/snapback-kernel/src/storage/room_authority.rs:424` | **500** | Internal participant finalization ran before a required dependency settled. |
| 37 | `SNAPBACK_AUTH_PARTICIPANT_DROPPED` — `crates/snapback-kernel/src/storage.rs:2020,2230` | **500** | An internal commit participant disappeared before completion. |
| 38 | `SNAPBACK_AUTH_PARTICIPANT_GENERATION_MISMATCH` — `crates/snapback-kernel/src/storage.rs:2034,2223`; `storage/room_authority.rs:2306` | **500** | Participant and interlock generations disagree. |
| 39 | `SNAPBACK_AUTH_PARTICIPANT_NOT_PENDING` — `crates/snapback-kernel/src/storage.rs:2013,2069,2107,2165`; `storage/room_authority.rs:2285` | **500** | Internal settlement attempted an invalid participant state transition. |
| 40 | `SNAPBACK_AUTH_PARTICIPANT_REGISTRY_MISMATCH` — `crates/snapback-kernel/src/storage.rs:2214,2237`; `storage/room_authority.rs:2298` | **500** | A participant belongs to a different internal registry. |
| 41 | `SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_INVALID` — `crates/snapback-kernel/src/storage/auth_identity.rs:131` | **Non-HTTP** | Authentication-provider construction rejected invalid server configuration before serving requests. |
| 42 | `SNAPBACK_CLIENT_MUTATION_RESULT_INTEGRITY` — `crates/snapback-kernel/src/storage.rs:22552` | **500** | Persisted client-mutation settlement data failed an integrity check. |
| 43 | `SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED` — Rust registry occurrence `crates/snapback-server/src/server/api_error.rs:122`; actual producer `packages/snapback-client/index.mjs:7799` | **Non-HTTP** | Client-local seed protocol refusal; no server construction path exists. |

### D. Commit capsule and uncertain-retention internals — 7

| # | Literal and construction | HTTP verdict | Reason |
|---:|---|---|---|
| 44 | `SNAPBACK_COMMIT_CAPSULE_DESTINATION_MISMATCH` — `crates/snapback-server/src/server/commit_capsule.rs:82`; lower producers `crates/snapback-engine/src/local/engine.rs:3349`, `crates/snapback-kernel/src/storage/commit_capsule_prototype.rs:217,238` | **500** | A server-created capsule or authority was used against the wrong destination/database. |
| 45 | `SNAPBACK_COMMIT_INTENDED_ROWS_ABSENT` — `crates/snapback-server/src/server/commit_capsule.rs:949` | **Non-HTTP** | It is a nested `causeCode` carried by the outer uncertain diagnostic, not the top-level `ApiError` code. |
| 46 | `SNAPBACK_COMMIT_RECONCILIATION_WITNESS_MISMATCH` — `crates/snapback-kernel/src/storage.rs:907` | **500** | The exact-row reconciliation witness belongs to another database or operation. |
| 47 | `SNAPBACK_COMMIT_UNCERTAIN_RETENTION_ACTIVE` — `crates/snapback-server/src/server/commit_capsule.rs:415` | **Non-HTTP** | Private retention-registry API refusal; no route or external caller exists. |
| 48 | `SNAPBACK_COMMIT_UNCERTAIN_RETENTION_IDENTITY_MISMATCH` — `crates/snapback-server/src/server/commit_capsule.rs:449` | **Non-HTTP** | Private retained-capsule identity check; never converted to `ApiError`. |
| 49 | `SNAPBACK_COMMIT_UNCERTAIN_RETENTION_NOT_FOUND` — `crates/snapback-server/src/server/commit_capsule.rs:441` | **Non-HTTP** | Private recovery lookup miss with no route consumer. |
| 50 | `SNAPBACK_COMMIT_UNCERTAIN_RETENTION_TYPE_MISMATCH` — `crates/snapback-server/src/server/commit_capsule.rs:384,423` | **Non-HTTP** | Private type-erased retention-registry invariant; no HTTP consumer. |

### E. Effect, runtime, fork, invocation, and kernel authority — 8

| # | Literal and construction | HTTP verdict | Reason |
|---:|---|---|---|
| 51 | `SNAPBACK_EFFECT_AUTHORITY_INVALID` — `crates/snapback-kernel/src/storage/pending_effects.rs:281` | **500** | An internally minted pending-effect authority belongs to the wrong database. |
| 52 | `SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED` — `crates/snapback-types/src/manifest/types.rs:4706` | **400** | Artifact activation declared an elevated-read use without the required capability. |
| 53 | `SNAPBACK_FAMILIAR_RUNMUTATION_REF_REQUIRED` — passthrough at `crates/snapback-engine/src/runtime/host_glue.rs:7142`; actual generated producer `packages/snapback-codegen/index.mjs:19069` | **400** | Application code passed a non-generated or wrong-generation mutation reference. |
| 54 | `SNAPBACK_FORK_READ_HANDLE_REQUIRED` — `crates/snapback-services/src/instance_fork/service.rs:42` | **Non-HTTP** | Native instance-fork/CLI service was opened without its required read handle. |
| 55 | `SNAPBACK_FORK_STAGING_INVALID` — `crates/snapback-kernel/src/instance_fork.rs:54,61,79,87,95,814,843,962,969` | **Non-HTTP** | Local filesystem staging/recovery invariant used by the native fork CLI, not an HTTP route. |
| 56 | `SNAPBACK_INVOCATION_AUTHORITY_INVALID` — `crates/snapback-engine/src/local/engine.rs:6146,7843,32167`; server guard `crates/snapback-server/src/server.rs:11307` | **500** | A server-created invocation authority belongs to another engine/database. |
| 57 | `SNAPBACK_KERNEL_COMMIT_AUTHORITY_ALREADY_CLAIMED` — `crates/snapback-kernel/src/storage.rs:1645` | **500** | Kernel commit authority was taken more than once. |
| 58 | `SNAPBACK_KERNEL_COMMIT_AUTHORITY_INVALID` — `crates/snapback-kernel/src/storage.rs:975,982,3305,3328,3357,3377,3403` | **500** | Commit authority identity or database binding failed an internal invariant. |

### F. Media projection — 7

| # | Literal and construction | HTTP verdict | Reason |
|---:|---|---|---|
| 59 | `SNAPBACK_MEDIA_ASSET_NOT_FINALIZED` — `crates/snapback-kernel/src/storage.rs:17717,19715` | **409** | The requested mutation conflicts with the asset’s current unfinished state. |
| 60 | `SNAPBACK_MEDIA_KIND_NOT_ADMITTED` — `crates/snapback-kernel/src/storage.rs:17746,19744` | **422** | The finalized asset is valid, but its semantic media kind cannot satisfy the declared field. |
| 61 | `SNAPBACK_MEDIA_PROJECTION_INTEGRITY` — `crates/snapback-engine/src/runtime/host_glue.rs:1767`; `crates/snapback-kernel/src/assets.rs:1937` | **500** | Framework/stored media projection facts violate internal integrity. |
| 62 | `SNAPBACK_MEDIA_PROJECTION_SNAPSHOT_UNAVAILABLE` — `crates/snapback-types/src/manifest/types.rs:4468` | **400** | An Action artifact requested media projection without the required result snapshot contract. |
| 63 | `SNAPBACK_MEDIA_PROJECTION_TOKEN_EXHAUSTED` — `crates/snapback-engine/src/runtime/host_glue.rs:1813` | **500** | Internal projection-token allocation exhausted its integer domain. |
| 64 | `SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED` — `crates/snapback-engine/src/local/engine.rs:2014`; `runtime/host_glue.rs:578,1203,1221`; `crates/snapback-kernel/src/storage.rs:20805,20816,20828` | **400** | Handler output introduced or returned a projected media reference without the required source-asset provenance. |
| 65 | `SNAPBACK_MEDIA_WRITE_FORGED_KIND` — `crates/snapback-kernel/src/storage.rs:21644` | **400** | Mutation input supplied a projected `MediaRef`/kind instead of the admitted asset identity. |

### G. Test-support promotion, query ceilings, push, and manifest composition — 13

The seven promoted-effect settlement functions are explicitly `#[cfg(any(test, feature = "test-support"))]` at `crates/snapback-kernel/src/fork_promotion.rs:3302-3320,3382-3389`.

| # | Literal and construction | HTTP verdict | Reason |
|---:|---|---|---|
| 66 | `SNAPBACK_OPERATION_COVERAGE_INVALID` — `crates/snapback-kernel/src/storage.rs:4350` | **Non-HTTP** | Feature-gated `install_operation_coverage_for_test` manifest-version overflow. |
| 67 | `SNAPBACK_PROMOTION_EFFECT_AUTHORITY_DENIED` — `crates/snapback-kernel/src/fork_promotion.rs:3344` | **Non-HTTP** | Test-support-only promoted-effect settlement authority refusal. |
| 68 | `SNAPBACK_PROMOTION_EFFECT_NOT_PENDING` — `crates/snapback-kernel/src/fork_promotion.rs:3357` | **Non-HTTP** | Test-support-only effect was not in the required pending state. |
| 69 | `SNAPBACK_PROMOTION_EFFECT_FENCE_LOST` — `crates/snapback-kernel/src/fork_promotion.rs:3369` | **Non-HTTP** | Test-support-only settlement lost its canonical initiation fence. |
| 70 | `SNAPBACK_PROMOTION_EFFECT_RESULT_INVALID` — `crates/snapback-kernel/src/fork_promotion.rs:3393` | **Non-HTTP** | Test-support-only settlement received a noncanonical terminal digest. |
| 71 | `SNAPBACK_PROMOTION_EFFECT_RESULT_DIVERGED` — `crates/snapback-kernel/src/fork_promotion.rs:3414` | **Non-HTTP** | Test-support-only retry disagreed with the stored terminal provider fact. |
| 72 | `SNAPBACK_PROMOTION_EFFECT_NOT_INITIATED` — `crates/snapback-kernel/src/fork_promotion.rs:3420` | **Non-HTTP** | Test-support-only settlement attempted completion before durable initiation. |
| 73 | `SNAPBACK_PROMOTION_EFFECT_AMBIGUOUS` — `crates/snapback-kernel/src/fork_promotion.rs:3428` | **Non-HTTP** | Test-support-only inherently ambiguous effect attempted to manufacture a definitive result. |
| 74 | `SNAPBACK_PUSH_AUTHORITY_INVALID` — `crates/snapback-engine/src/local/engine.rs:7154`; `crates/snapback-kernel/src/storage/push_registry.rs:129` | **500** | Push admission carrier has the wrong trigger mode or database binding. |
| 75 | `SNAPBACK_SEMIJOIN_ACTOR_CEILING_EXCEEDED` — `crates/snapback-engine/src/runtime/host_glue.rs:3433` | **400** | Handler-generated semijoin input exceeded the declared actor ceiling. |
| 76 | `SNAPBACK_SERVICE_AUTHORITY_UNAVAILABLE` — `crates/snapback-kernel/src/auth/service_fence.rs:80`; `storage/auth.rs:1813` | **500** | Required internal service commit authority/interlock is absent or belongs to another database. |
| 77 | `SNAPBACK_SET_AGGREGATE_ROW_CEILING_EXCEEDED` — `crates/snapback-engine/src/runtime/host_glue.rs:3452` | **400** | Handler-generated aggregate input exceeded its declared bounded row set. |
| 78 | `SNAPBACK_STANDARD_PATTERN_COMPOSITION_INVALID` — `crates/snapback-types/src/manifest/types.rs:3589,3602` | **400** | Artifact activation supplied an invalid standard-pattern composition. |

### H. Visibility governance — 8

These are reachable from authenticated provisioning/function-load routes at `crates/snapback-server/src/server.rs:20871-20880,23088-23098,28644-28654`, through `preflight_auth_artifacts` at `crates/snapback-engine/src/local/engine.rs:8173-8177,9587`.

| # | Literal and construction | HTTP verdict | Reason |
|---:|---|---|---|
| 79 | `SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH` — `crates/snapback-types/src/visibility_governance.rs:300,311,368` | **503** | Target-owned governance identity is not usable for the requested deployment; the target cannot presently activate it. |
| 80 | `SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION` — `crates/snapback-types/src/visibility_governance.rs:100,143,149,170,199,207,240,339,554,572,582` | **503** | The target’s signed governance verdict is stale, red, or otherwise unusable, making activation unavailable. |
| 81 | `SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE` — `crates/snapback-types/src/visibility_governance.rs:109,116,122,132,162,178,184,191,256,265`; engine `crates/snapback-engine/src/local/engine.rs:8516` | **503** | Required target-owned remote signing/key custody is unavailable. |
| 82 | `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID` — `crates/snapback-types/src/visibility_governance.rs:451,457,481,590,596,604,610,618` | **503** | Target governance approval cannot currently establish usable authority because its time facts are invalid. |
| 83 | `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRED` — `crates/snapback-types/src/visibility_governance.rs:472` | **503** | The target’s temporary activation authority has expired. |
| 84 | `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRING` — `crates/snapback-types/src/visibility_governance.rs:490` | **Non-HTTP** | `Diagnostic::warning` returned alongside successful activation; it is response metadata under success, not a top-level `ApiError`. |
| 85 | `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY` — `crates/snapback-types/src/visibility_governance.rs:232,508,525` | **503** | The configured authority is a repository-local fixture that cannot make this protected target ready. |
| 86 | `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_NOT_YET_VALID` — `crates/snapback-types/src/visibility_governance.rs:463` | **503** | Target governance authority exists but is not yet usable. |

### I. Test-only diagnostics — 5

| # | Literal and construction | HTTP verdict | Reason |
|---:|---|---|---|
| 87 | `SNAPBACK_TEST_FIXTURE_INVALID` — `crates/snapback-kernel/src/storage.rs:4270,4277,4293,4382` | **Non-HTTP** | Bounded owner-crate/test-support fixture refusal; the engine’s other producers are exact `#[cfg(test)]` at `crates/snapback-engine/src/local/engine.rs:29193-29202`. |
| 88 | `SNAPBACK_CRON_TEST_FAILURE` — `crates/snapback-engine/src/local/tests/engine.rs:15878` | **Non-HTTP** | Synthetic cron failure used solely by a unit-test fixture. |
| 89 | `SNAPBACK_JOB_TEST_FAILURE` — `crates/snapback-engine/src/local/tests/engine.rs:33290` | **Non-HTTP** | Synthetic job failure used solely by a unit-test fixture. |
| 90 | `SNAPBACK_TEST_MAINTENANCE_CAUSE` — `crates/snapback-engine/src/local/tests/engine.rs:3549` | **Non-HTTP** | Synthetic nested maintenance `causeCode` in a unit test. |
| 91 | `SNAPBACK_WATCH_TEST_FAILURE` — `crates/snapback-engine/src/local/admission_fence_tests.rs:891` | **Non-HTTP** | Test-injected watch failure in an inherited test-only module. |

## 3. Ordering and landing atomicity

The semantic repair should be **atomic**.

The forcing test first requires every exclusion to exist, then requires exact equality between emitted and reviewed status codes at `crates/snapback-server/src/server/tests.rs:24494-24534`. Consequently:

- Adding classifications before widening makes them stale expected rows.
- Adding new exclusions before widening makes them stale exclusions.
- Widening one or two crates still leaves exclusions stale in the other carved roots.
- The 105 currently invisible exclusions span runtime, engine, CLI, sync, activation, types, kernel, services, tools, and conformance (`issues/shelved/20260823-diagnostic-inventory-scan-lost-scope-after-carve.md:77-88`).
- Enabling the generator’s fail-closed root assertion simultaneously requires every carved root (`scripts/generate-diagnostics-registry.mjs:94-120`).

A no-behavior refactor that centralizes the source-selection helper could land separately. The patch that switches the active scan, adds non-HTTP records, and adds HTTP status rows cannot be usefully subdivided while keeping the test green.

## 4. Risk assessment

### Runtime behavior

The source widening itself is test-only and has no production effect, as the issue records at `issues/shelved/20260823-diagnostic-inventory-scan-lost-scope-after-carve.md:100-106`.

The 54 status mappings do change observable HTTP behavior for codes currently falling through to 500:

- 400/409/422 classifications tell clients not to treat caller- or state-specific failures as opaque server faults.
- 503 governance classifications may activate retry/backoff behavior.
- Explicit 500 rows preserve the current status but turn accidental fall-through into a reviewed invariant.

Tests and clients that assumed 500 for these codes may need adjustment.

### Lower crates legitimately contain non-HTTP diagnostics

Yes. CLI migration, startup configuration, local fork management, private recovery registries, warning metadata, benchmark support, and feature-gated test helpers legitimately never cross an HTTP boundary.

Widening makes the **source inventory stronger**, because carved crates can no longer evade review. It makes the HTTP invariant stronger only if the implementation records explicit non-HTTP verdicts separately.

Putting every such code in the HTTP 500 table would make the invariant weaker and misleading: “present in production Rust” would be mistaken for “can become an HTTP response.” The preferable model is:

- true non-diagnostic literals;
- reviewed non-HTTP diagnostics;
- reviewed route-reachable diagnostics with status.

### Other risks

- Sharing roots without sharing directory/file acceptance rules can pull test markers and assertions into the production set; see the source-selection caveat above.
- `MEDIA_PROJECTION_UNPROVENANCED` has several producers. They are equivalent here because each denotes handler-result provenance failure; future internal-only uses could make a single global 400 inappropriate.
- Status classification remains code-global rather than route-aware. The independent route-aware manifest work is still necessary.
- Parsing and scanning changes may alter generated inventory digests and client unions even when runtime semantics are unchanged.
- Full-root AST scanning adds test cost, though the file set is bounded and deterministic.

## 5. Ticket disposition

| Ticket | Disposition after the repair lands green |
|---|---|
| `issues/shelved/20260821-elevated-read-trace-stale-exclusion.md` | **Close**, after correcting its diagnosis. The trace still emits; the scanner lost its crate (`issues/shelved/20260823-diagnostic-inventory-scan-lost-scope-after-carve.md:17-25,94`). |
| `issues/shelved/20260821-server-suite-six-pre-existing-failures.md` | **Close** once this is genuinely the last red and the suite is green. Its neutral-carrier concern is independently tracked by `issues/shelved/20260821-neutral-carrier-not-installed.md`; the old combined statement is stale (`issues/shelved/20260823-diagnostic-inventory-scan-lost-scope-after-carve.md:95`). |
| `issues/shelved/20260822-diagnostic-http-status-registry-gaps.md` | **Keep open.** This review discharges its 91-code classification portion, but not the 558-code/35% parser undercount or the required route-aware status/client-union manifest (`issues/shelved/20260822-diagnostic-http-status-registry-gaps.md:53-73`). |

The newly diagnosed scanner-scope ticket itself can close only after the full-root test passes with the source-selection ambiguity resolved.