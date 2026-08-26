# Cached schema policy has a broad second-handle review surface

- Status: open
- Created: 2026-08-26
- Area: schema freshness; resource-derived policy; authorization chokepoints
- Found by: the F182 sibling survey
- Related: LLP 0303, F182, the authorization denominator/seam map, LLP 0313 chokepoint design

## Size and meaning

A direct lexical survey of cached `LocalDatabase` schema consumption under
`crates/snapback-kernel/src`, `crates/snapback-engine/src`, and `crates/snapback-server/src` found
**300 sites across 31 Rust files**. Grouping those sites by the resource policy or effect they serve
produces **13 sibling families**.

This is an intentionally broad candidate census, including observation paths, derived runtime
caches, and cfg/test-support variants. It is **not** a claim that 300 vulnerabilities are open. Each
family needs an executed two-handle schedule and an ownership decision. The shared question is
whether a long-lived handle uses `LocalDatabase::schema` after another handle has durably published
a successor manifest, and whether the consequence reaches an effect without an in-transaction
resource-derived re-read.

F182 fixes only the shared agent-registration transaction. No sibling below was changed in that
lane.

## Thirteen families

1. **Agent and integration credential lifecycle.** Registration now re-reads durably, but invitation,
   revocation, recredentialing, and integration retirement callers must be checked as complete
   effect families (`storage/auth_agents.rs`, `storage/auth_agent_credentials.rs`).
2. **Auth-mode, same-mode deployment, and auth restore.** Transition validation and publication use
   cached predecessor manifests in several paths (`storage/auth_mode.rs`, `storage/auth.rs`).
3. **Membership and authority changes.** Membership insert/remove/role/transfer/bootstrap/teardown
   plans, last-holder guards, and authority profiles clone or inspect the cached schema
   (`storage/membership_plans.rs`, `membership_rules.rs`).
4. **General mutation admission.** Host-plan authority preflight, authorization-event
   classification, lifecycle writes, and detached mutation bindings consume the cached schema
   (`storage.rs`, `snapback-engine/src/local/engine.rs`, `runtime/host_glue.rs`).
5. **External API and capability-link policy.** API enabled state, per-function exposure, anonymous
   use, origins, and route validation are interpreted from the handle's schema
   (`snapback-engine/src/local/engine.rs`).
6. **OAuth, Ask, and integration scopes.** OAuth bundle scope requests and the served OAuth/Ask
   manifests are cached-schema derived (`storage/auth_integrations.rs`,
   `snapback-engine/src/local/engine.rs`).
7. **Query, graph, search, live, and read visibility.** Table shape, permission predicates, result
   contracts, live matching, and search/vector read policy use the handle or detached read view's
   schema (`storage/query_reads.rs`, `live_matcher.rs`, `graph_evaluator.rs`, `search/sqlite.rs`).
8. **Push policy and custody.** Registry presence, token registration, send reservation, trigger
   policy, and auth-GC integration use the cached push seam (`storage/push_registry.rs`, `push.rs`,
   `snapback-engine/src/local/engine.rs`).
9. **Asset policy.** Inspection, delivery, signed URLs, strict reads, and import/export cuts clone
   the cached schema (`storage/asset_reads.rs`, `snapback-engine/src/local/engine.rs`).
10. **History, checkpoints, and protected erasure.** History policy, checkpoint cuts, and protected
    record deletion interpret the cached schema (`storage/versions.rs`, `storage/checkpoints.rs`).
11. **Function generations, sequences, transcripts, and ephemeral declarations.** Activation and
    runtime registration use cached relations, Ask, sequence, table, and auth-mode declarations
    (`storage/generation_commit.rs`, `storage/stream_transcripts.rs`,
    `snapback-engine/src/local/generation_host.rs`, `local/engine.rs`).
12. **Seed, migration, and schema transitions.** Reset/seed authorization, migration predecessor and
    barrier selection, rollback/release, and cleanup have cached-schema consumers
    (`storage/schema_seed.rs`, `storage/migration_executor.rs`, `storage/schema_transition.rs`).
13. **Projection, vector, and derived runtime caches.** Projection/vector rebuilds, quarantine gates,
    order bounds, runtime cost identities, and detached snapshots derive state from the cached
    schema (`storage/projection_rebuild.rs`, `storage.rs`, `snapback-engine/src/local/engine.rs`).

## Priority for executable follow-up

The first witness wave should target families 3 through 6 and 8 through 10: they make direct allow,
deny, scope, visibility, custody, or destructive-retention decisions. For each family, publish a
restrictive successor through handle B, act through stale handle A, and confirm the effect through a
fresh handle C. Reverse-direction schedules are equally important: a stale restrictive view must not
spuriously refuse a newer valid policy.

The remaining families should be evaluated as concurrency and consistency work, not dismissed:
schema publication, migrations, and derived runtime caches can turn a security refusal into a stall,
misclassification, or split policy even where they do not directly grant authority.

The likely architectural answer is the LLP 0313 shape: make committing chokepoints own one
transaction-scoped active-manifest view and require policy consumers to derive from it. Applying
one-off refreshes at the 300 lexical sites would make freshness inconsistent and would be difficult
to verify as a closed consumer set.
