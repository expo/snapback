# Review artifact — LLP 0226 (identity architecture) — gpt-5 family

Target: `llp/0226-identity-architecture.decision.md`
Loop: llp-super-refine 2026-08-10, independent-loop topology, orchestrated by
Claude Fable 5 (session 0f56679e); reviser = orchestrator.

## Round 1 — 2026-08-10

- Reviewer: gpt-5 family — codex exec, model gpt-5.6-sol, reasoning xhigh,
  read-only sandbox, --ignore-user-config (launch attempt 2; attempt 1 died
  mid-review with no output and is recorded as a void, never counted).
- Capsule: detached worktree at commit `1c19e047b` (structural exclusion of
  `llp/reviews/0226*` — none exist at that commit).
- Target revision: (b), sha256
  `584bcda0c9308e452e8525ad352f5b878d5a6608b68d1d4262d12922dceb6797`.
- Instructions: sr-review-r1 template, sha256
  `cddeabc21d877f2880953c1916ae3be39776d03741b41f83b99cfd131e1709c6`.
- Verdict: **NOT READY** (3 MATERIAL concerns; binds to the capsule/target
  hashes above).

### Verbatim review

## Summary

LLP 0226 chooses one coordinating identity vocabulary while leaving schema, auth, and effects implementation to their existing owners. That distributed direction is sound and matches the author’s ruling. However, the proposed vocabulary contradicts accepted row-settlement and auth models, and its source-key rules are internally inconsistent. An implementer following it could reject valid offline row IDs, bind the wrong auth identifier, or resolve a reused source key to the wrong row.

## Direction assessment

The overall architecture is right. LLP 0191 concludes that schema identity, auth binding, and settlement identity share vocabulary but have distinct trust domains, recommending one coordinating document with distributed implementation authority ([LLP 0191:371-385](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0191-scale-architecture-revisits.research.md:371)); its author ruling explicitly chooses that structure ([LLP 0191:525-530](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0191-scale-architecture-revisits.research.md:525)). LLP 0226 follows it at [lines 20-35](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:20).

The serial-column direction is also reasonable: `W-SHORTID` is a measured schema gap, and a gap-admitting successor must remain distinct from LLP 0135’s dense transactional counters ([issue:5-14](/Users/ccheever/projects/snapback-worktrees/sr-r1/issues/shelved/20260808-numeric-identity-default-columns.md:5), [LLP 0135:349-377](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:349)).

The problem is the grain of the namespace map. It collapses distinctions already load-bearing in accepted specifications: authoritative versus speculative/captured row IDs, and principals versus provider identities. Because vocabulary and conformance are this Decision’s entire authority, those are defects in the decision itself, not details that owner amendments should reinterpret.

## Concerns

1. **Row identity contradicts the accepted two-lane settlement model — MATERIAL**

   **Text at issue:** The namespace table says “Server mints `_id` at insert,” M-1 requires one mint authority, and M-2 says client-supplied row identities must refuse ([target:49](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:49), [target:108-116](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:108)). Yet the document later calls row identity client-generable ([target:65-69](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:65)), and C-1 omits the existing speculative-to-authoritative row-ID conversion ([target:75-79](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:75)).

   **Evidence:** LLP 0007 defines `_id` as client-mintable for offline clients ([LLP 0007:140-155](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0007-storage-portability.spec.md:140)). More decisively, Accepted LLP 0133 requires:

   - Lane Q to accept client-captured IDs because they are already woven into optimistic state and later queued arguments ([LLP 0133:172-189](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0133-local-settlement.spec.md:172)).
   - Lane L to rederive IDs server-side ([LLP 0133:191-199](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0133-local-settlement.spec.md:191)).
   - A normative `(mint site, occurrence)` ID map from speculative to authoritative IDs, including unmapped/cascade behavior ([LLP 0133:435-510](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0133-local-settlement.spec.md:435)).

   The implementation follows that contract. Generated local execution mints claimed IDs on the client ([generated-mutation-ir.mjs:96-117](/Users/ccheever/projects/snapback-worktrees/sr-r1/packages/snapback-client/generated-mutation-ir.mjs:96)); storage accepts replay-ledger IDs instead of minting replacements ([storage.rs:14984-15027](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage.rs:14984)); lane-L settlement constructs the exact ID map ([local.rs:1200-1244](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/local.rs:1200)). The client test codifies an optimistic row ID differing from the authoritative row ID and converging through the bridge ([generated-mutation-ir.test.mjs:95-121](/Users/ccheever/projects/snapback-worktrees/sr-r1/packages/snapback-client/generated-mutation-ir.test.mjs:95)).

   **Fix:** Model the two provenance regimes explicitly. Either separate provisional/speculative row identity from authoritative row identity, or state that the row namespace has lane-dependent mint authority. M-2 must preserve Lane Q’s accepted ledger IDs. Add the LLP 0133 ID map as a declared conversion, including its private receipt scope, exact pairing key, unmapped outcome, rewrite, and cascade rules. Add LLP 0008 and LLP 0133 to `Related`.

2. **The document conflates auth principals with provider identities — MATERIAL**

   **Text at issue:** The table defines “Auth identity (principal)” as anchored to `(issuer, subject)` and scoped to one provider installation; C-6 says the stored auth mapping key is `(issuer, subject)` ([target:50](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:50), [target:100-104](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:100)). The auth lane repeats that conflation ([target:193-207](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:193)).

   **Evidence:** Accepted LLP 0057 stores principals and provider identities in separate relations: `_auth_users.id` is the principal, while `_auth_identities` uniquely maps `(provider, subject)` to `user_id`; sessions retain both `user_id` and `identity_id` ([LLP 0057:417-463](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0057-auth-provider-protocol.spec.md:417)). It assigns distinct `usr_` and `idn_` identifiers ([LLP 0057:1785-1811](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0057-auth-provider-protocol.spec.md:1785)). The implementation likewise looks up an identity by provider/subject, then reuses or creates the separate user/principal ([provider.rs:3916-3965](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/auth/provider.rs:3916)).

   LLP 0151 preserves this distinction: external identities map to stable Snapback principals ([LLP 0151:131-141](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0151-first-party-identity-integrations.rfc.md:131)); a guest can have a real principal before any provider identity is attached ([LLP 0151:309-321](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0151-first-party-identity-integrations.rfc.md:309)); and one principal may acquire provider identities whose canonical keys are issuer/subject pairs ([LLP 0151:364-378](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0151-first-party-identity-integrations.rfc.md:364)).

   The current app-binding recipe stores `ctx.auth.userId`, not `(issuer, subject)`, and explicitly says handlers do not receive provider claims ([guide:22-48](/Users/ccheever/projects/snapback-worktrees/sr-r1/guide/auth/app-identity-binding.md:22), [guide:50-75](/Users/ccheever/projects/snapback-worktrees/sr-r1/guide/auth/app-identity-binding.md:50)). Reset can remint a new principal for the same external identity ([guide:298-313](/Users/ccheever/projects/snapback-worktrees/sr-r1/guide/auth/app-identity-binding.md:298)).

   **Fix:** Define at least two namespaces:

   - **Auth principal:** Snapback-minted `usr_…`, exposed as `ctx.auth.userId`, scoped to the auth catalog/instance, and linked to zero or more provider identities.
   - **Provider/external identity:** `idn_…` plus its immutable provider-installation/issuer/subject key and mutable claims.

   Then declare provider identity → principal as the protected auth-catalog conversion, and principal → app row as C-2’s binding conversion. C-6 must identify which key each conversion stores. Add LLP 0011, LLP 0057, and LLP 0058 to `Related`.

3. **A source key cannot simultaneously be app-mutable and C-6’s immutable conversion key — MATERIAL**

   **Text at issue:** The source-key row says mutability is “App-owned; the app decides” ([target:51](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:51)). C-3 sanctions source-key → row conversion ([target:87-90](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:87)), while C-6 prohibits mutable attributes as mapping keys and describes a declared source key as the immutable row-side member ([target:100-104](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:100)).

   **Evidence:** LLP 0007’s index contract supplies uniqueness, including unique-where-present, but no immutability or non-reuse guarantee ([LLP 0007:520-579](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0007-storage-portability.spec.md:520)). LLP 0191 recommends source keys as app-public IDs and safer local-first canonical keys ([LLP 0191:350-369](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0191-scale-architecture-revisits.research.md:350)). Current generated `Get` takes a physical row ID, so the future alternate-key operation would be the new authority for resolving this ambiguity ([index.d.mts:475-483](/Users/ccheever/projects/snapback-worktrees/sr-r1/packages/snapback-codegen/index.d.mts:475)).

   A direct consequence is an ABA failure: an offline mutation records source key `K` for row A; before settlement, A moves to `K2` and `K` is reassigned to row B; replay then resolves and mutates B while every instantaneous unique constraint remains valid.

   **Fix:** Either make declared source identity keys immutable and never reusable, while treating mutable unique fields as ordinary alternate lookup keys, or bind every queued alternate-key operation to an expected `_id` plus an appropriate generation/version and refuse on reassignment. Define rotation, deletion, reuse, not-found, and stale-queue behavior in this Decision because mutability and conversion are its authority.

4. **The serial successor lacks a mandatory reservation/transaction contract — implementation-phase**

   **Text at issue:** The Decision requires rollback-burning, gap-admitting serials, says this avoids the table write-serialization path, and promises exhaustion refusal “before the mutation tier,” while delegating physical layout and sequencing ([target:136-150](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:136), [target:166-180](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:166), [target:244-250](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:244)).

   **Evidence:** Accepted LLP 0135’s current allocator is deliberately opposite: its counter advance is buffered into the application transaction, failures leave no durable trace, and no preallocation occurs ([LLP 0135:310-340](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:310), [LLP 0135:349-377](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:349)). The code begins the application transaction after handler execution, advances counters within that transaction, and rolls everything back on discard ([storage.rs:4108-4134](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage.rs:4108), [storage.rs:4410-4420](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage.rs:4410), [storage.rs:4484-4533](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage.rs:4484)). Its existing counter table also requires a row-scoped tuple, not a table-scoped identity ([storage.rs:4666-4676](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage.rs:4666)).

   Gap-burning is feasible, but it needs a separate durable reservation boundary. Imperative handlers can make dynamic allocation decisions, and LLP 0135 explicitly notes generation cannot see through handler code ([LLP 0135:297-305](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:297)). The performance assertion is also not established: the current SQLite target serializes all writes globally, while a future multiwriter target has a real hot-counter contention point ([LLP 0135:453-464](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:453)).

   **Fix:** Require the schema-owner amendment to define reservation timing, the table/incarnation key, assignment order for multiple or conditional inserts, crash-before-commit behavior, exact-replay behavior, exhaustion timing, range allocation, and contention evidence. Clarify whether “strictly increasing” means allocation order or commit order. Replace “before the mutation tier” with the actual observable boundary, or require a predeclared bound that makes pre-execution reservation possible. Label performance as an expectation pending measurement.

5. **The document has conflicting status declarations — implementation-phase**

   **Text at issue:** The metadata says `Status: Review`, but the closing status says `Draft` ([target:3-10](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:3), [target:253-256](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0226-identity-architecture.decision.md:253)). The metadata also carries two separate `Revised` fields.

   **Evidence:** `./ref-check --verbose` passes with 228 LLPs, 4,772 refs, and zero errors, so the checker does not detect this semantic status conflict.

   **Fix:** Make the closing status `Review`, consolidate revision history into one metadata field, and add the governing LLPs exposed by concerns 1 and 2.

## Verifications performed

- Confirmed the distributed decision structure against LLP 0191 and the commissioning ticket ([issue:1-27](/Users/ccheever/projects/snapback-worktrees/sr-r1/issues/20260808-identity-architecture-decision.md:1)).
- Confirmed the schema proposal was expressly endorsed wholesale, including `v.serial({ start })`, server-owned values, rollback burning, and non-empty-table refusal ([issue:109-123](/Users/ccheever/projects/snapback-worktrees/sr-r1/issues/shelved/20260808-numeric-identity-default-columns.md:109)).
- Confirmed the current validator vocabulary contains `v.principal()` and `v.id()` but no `v.serial()` ([define.mjs:327-344](/Users/ccheever/projects/snapback-worktrees/sr-r1/packages/snapback-codegen/define.mjs:327)); a repository search found no competing validator/schema use of `serial`.
- Confirmed LLP 0148’s prefix grammar and per-table row-ID derivation against both the decision and implementation ([LLP 0148:102-113](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0148-prefixed-identifiers.decision.md:102), [ids.rs:382-401](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/ids.rs:382)).
- Confirmed C-2’s bypass warning and unique-index-on-every-side recipe ([guide:34-75](/Users/ccheever/projects/snapback-worktrees/sr-r1/guide/auth/app-identity-binding.md:34)).
- Confirmed the settlement identity’s digest fields, replay stability, mutation-only surface, and hosted all-null asymmetry ([LLP 0043:398-448](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0043-offline-replay-retention.rfc.md:398), [settlement tests:173-264](/Users/ccheever/projects/snapback-worktrees/sr-r1/tests/mutation_settlement_identity_v0.rs:173)).
- Confirmed stream identity rotates independently of numeric version continuation during forks and prevents cross-instance cursor comparison ([LLP 0158:719-743](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0158-instance-forking.rfc.md:719), [LLP 0158:1697-1735](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0158-instance-forking.rfc.md:1697)); storage documents rotation on reset/import/restore as well ([auth_invalidation.rs:33-44](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage/auth_invalidation.rs:33)).
- Confirmed artifact graph hashing and digest-bound runtime readiness exist, although I did not audit every individual digest constructor ([LLP 0009:994-1019](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0009-code-execution-security.rfc.md:994), [LLP 0010:228-240](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0010-agent-dx-and-acceptance.spec.md:228)).
- Confirmed the existing Zerobugs corpus names `W-MUTATION-IR`, `W-IDENTITY`, and `W-SHORTID` with concrete owners and evidence ([PLAN:714-724](/Users/ccheever/projects/snapback-worktrees/sr-r1/demos/zerobugs/control/PLAN.md:714), [zb6 gate:287-395](/Users/ccheever/projects/snapback-worktrees/sr-r1/demos/zerobugs/control/tests/acceptance/gates/zb6.mjs:287)).
- Ran `./ref-check --verbose`; it passed. I attempted the focused generated-mutation-IR test, but it could not start because `@expo/snapback-contract` is not installed in this checkout. I therefore verified that behavior from accepted specs, implementation, and test source rather than claiming a fresh test pass.
- No files were modified.

## Verdict

VERDICT: NOT READY
## Round 2 — 2026-08-10 (delta round)

- Reviewer: gpt-5 family — codex exec, model gpt-5.6-sol, reasoning xhigh,
  read-only sandbox, --ignore-user-config.
- Capsule: detached worktree at commit `0eac1d309`.
- Target revision: (c), sha256 prefix `1184ef4a79ccedaf`.
- Instructions: sr-review-r2 delta template.
- Verdict: **NOT READY** (5 MATERIAL: 4 IN-DELTA, 1 PRE-EXISTING).
- Blindness note: the reviewer self-disclosed that one broad vocabulary
  search printed snippets from unrelated existing review files (other
  targets); it attests no LLP 0226 review content was visible or used.
  Recorded as a self-attested partial-blindness disclosure; the finding
  citations are all target/spec/code-grounded.

### Verbatim review

## 1. Summary

The overall direction is sound: identity should be a coordinated vocabulary spanning several trust domains, with implementation retained by subsystem owners. Revision (c) improves the document substantially, but four in-delta contradictions and one pre-existing settlement-identity error remain material. The document is not ready for acceptance.

## 2. Direction assessment

The distributed architecture is the right choice. Principal identity, provider identity, row identity, source keys, serial values, and settlement identity have different authorities and lifecycle rules; centralizing their implementations would blur security boundaries. The source-key grading, principal-first app binding, Lane Q/L distinction, gap-admitting serial semantics, and server-derived settlement key are all good directions consistent with LLP 0191.

The remaining problems arise where the new vocabulary does not match Snapback’s actual lifetime and provenance model. In particular, `_id` is currently a reusable row address rather than a lifetime identity, `_auth_identities.id` is not the provider subject it records, and the mint rules do not accommodate the two accepted settlement lanes.

## 3. Concerns

1. **MATERIAL · IN-DELTA — “never reused” contradicts the accepted row-incarnation architecture.**

   Exact text: authoritative row identity is declared “Immutable; never reused,” while C-3 requires queued mutable-key references to bind an expected `_id` “and an appropriate generation” ([target lines 51–55](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0226-identity-architecture.decision.md:51), [lines 95–106](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0226-identity-architecture.decision.md:95)).

   Snapback deliberately permits delete/recreate using the same `_id`: accepted LLP 0110 says reuse creates a fresh incarnation ([LLP 0110 lines 1017–1022](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0110-bounded-children-and-activity-patterns.spec.md:1017)); the central writer deactivates the old incarnation and creates a new one ([storage lines 13309–13330](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/storage.rs:13309)); and the test deletes and reinserts `parent-1`, asserting a distinct incarnation ([test lines 3983–4050](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/storage/tests.rs:3983)).

   Consequently, bare `_id` is not a row-lifetime identity. This also makes C-3’s undefined “appropriate generation” load-bearing, and none of the three owner lanes owns this row/storage reconciliation.

   Fix shape: either define authoritative row identity as `(_id, rowIncarnation)` and specify how bindings and queued operations capture that protected generation, or prohibit historical `_id` reuse through a durable retired-ID mechanism and amend LLP 0110. Add an explicit row/storage owner amendment either way.

2. **MATERIAL · IN-DELTA — M-1/M-2 and the claimed row-ID encoding contradict C-7 and LLP 0133.**

   Exact text: M-1 requires “Exactly one component” to mint each namespace; M-2 says a client-supplied Lane L row identity “refuses”; yet C-7 says Lane Q accepts client-minted IDs and Lane L receives speculative IDs and publishes their authoritative mapping ([target lines 123–143](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0226-identity-architecture.decision.md:123)). The namespace table also describes committed row IDs as LLP 0148-prefixed values ([line 51](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0226-identity-architecture.decision.md:51)).

   LLP 0133 normatively requires Lane L claims to carry client-captured IDs for server re-derivation ([LLP 0133 lines 191–199](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0133-local-settlement.spec.md:191)) and defines their id-map rewrite ([lines 445–483](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0133-local-settlement.spec.md:445)). The executable wire test supplies such an ID and receives a mapped authoritative replacement rather than a refusal ([test lines 225–244](/Users/ccheever/projects/snapback-worktrees/sr-r2/tests/offline_replay_v0.rs:225)). Lane Q replay also consumes the client ledger value directly ([storage lines 14992–15027](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/storage.rs:14992)), under a broad opaque-ID grammar rather than guaranteed table-prefix encoding ([manifest lines 9480–9484](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/manifest.rs:9480)).

   Fix shape: scope M-2 to application/handler attempts to override a server-owned field, explicitly excluding C-7’s protocol claim channel. Either exempt Lane Q row IDs from M-1 or define the narrower authority invariant it actually satisfies. Also distinguish “framework-minted IDs use LLP 0148” from the wider Lane Q server-admission grammar.

3. **MATERIAL · IN-DELTA — “Provider identity (credential)” collapses three different identities and contradicts the auth substrate.**

   Exact text: the provider’s `(issuer, subject)` is said to be recorded as an `idn_…` row, email is “never identity,” and auth-substrate conversion always keys on `(issuer, subject)` ([target lines 53–55](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0226-identity-architecture.decision.md:53), [lines 116–122](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0226-identity-architecture.decision.md:116)).

   In the repository:

   - Snapback, not the provider, mints the `idn_` row ID ([provider lines 2736–2753](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/auth/provider.rs:2736)).
   - The durable mapping is `(provider, subject) → user_id`, independently of the `idn_` key ([auth schema lines 318–328](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/storage/auth.rs:318), [index lines 400–418](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/storage/auth.rs:400)).
   - The implemented email-code provider stores the email address as its subject ([provider lines 3951–3977](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/auth/provider.rs:3951)).
   - LLP 0151 distinguishes identities from credentials, includes verified email/phone identities, and says only OIDC is canonically `(issuer, subject)` ([LLP 0151 lines 364–378](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0151-first-party-identity-integrations.rfc.md:364)).

   An implementer cannot tell whether revision (c) supersedes email-code identity, requires migration to immutable provider subjects, or merely intends to prohibit email as an app-side binding key.

   Fix shape: split provider-subject identity from the Snapback-minted auth-link row ID, and keep authenticators/credentials separate. Define canonical subject keys per provider installation. Narrow the email prohibition to durable app-side identity bindings, or explicitly supersede the current auth model and commission its migration.

4. **MATERIAL · IN-DELTA — M-3 imports a row-scoped incarnation prefix into a table-wide serial identity without preserving its stated uniqueness.**

   Exact text: a serial is unique within one table/store lifetime and is suitable for permalinks, but M-3 requires an “equivalent prefix carrier” that the successor profile may define ([target lines 56–57](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0226-identity-architecture.decision.md:56), [lines 144–151](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0226-identity-architecture.decision.md:144)).

   LLP 0135’s prefix has different semantics: a row-scoped counter intentionally restarts when its parent is recreated, and duplicate numeric values remain safe only because old child rows are unreachable under `(scopeId, relationIncarnation)` ([LLP 0135 lines 254–271](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:254), [lines 970–973](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:970)). Table-wide serial rows have no parent scope that makes predecessor values unreachable. A hidden composite prefix would therefore permit two visible rows with the same numeric permalink; an app-visible prefix would mean the identity is not the promised numeric `v.serial` value.

   Fix shape: decide at this Decision’s level that the table counter never restarts within a store lifetime and its high-water mark survives restart/fork/restore, or redefine the public serial identity as a composite and change the surface accordingly. The successor profile should choose mechanics, not the observable uniqueness contract.

5. **MATERIAL · PRE-EXISTING — the settlement digest formula and app-scope explanation are not the formula implemented by the repository.**

   Exact text: settlement identity is a digest over `{authFingerprint, authorityInstanceId, clientMutationId, function, inputFingerprint[, operationIssuance]}`, and the D5 lane says `authFingerprint` supplies the app namespace ([target lines 57–58](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0226-identity-architecture.decision.md:57), [lines 262–269](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0226-identity-architecture.decision.md:262)).

   Issuance-bearing operations also include `artifactGenerationDigest` in the actual digest preimage ([storage lines 972–1002](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/storage.rs:972)), as required by LLP 0163’s complete selected-artifact binding ([LLP 0163 lines 669–675](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0163-operation-identity-and-commit-envelope.spec.md:669)). Separately, `authFingerprint` hashes only principal/session/user fields; it contains no app identity ([manifest lines 9573–9592](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/manifest.rs:9573)).

   A second target following this Decision literally would derive a different effect key for issuance-bearing operations, while the stated app-namespacing rationale is factually wrong.

   Fix shape: enumerate the versioned legacy and issuance-bearing preimages exactly, add LLP 0163 to Related, and describe the real scoping mechanism. If explicit app/instance domain separation is required, introduce it through a versioned compatibility decision rather than claiming `authFingerprint` already supplies it.

6. **implementation-phase · IN-DELTA — the new mandatory schema question list still omits durable counter-key and `start` grammar decisions.**

   Exact text: the amendment “must answer, explicitly” several allocation questions, while the surface is fixed as `v.serial({ start })` and the substrate only as a “table-scoped counter identity” ([target lines 219–230](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0226-identity-architecture.decision.md:219)).

   LLP 0135’s existing identity includes `counterName`, and its numeric contract fixes first value 1 with no authored start ([LLP 0135 lines 225–281](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:225)). Clearing “authored start” does not say whether `start` is required, its signed/range domain, whether multiple serial fields are permitted per table, whether the field name participates in durable counter identity, or what rename means.

   Fix shape: add these questions to the schema-owner amendment’s mandatory list before implementation. This is implementation-phase because the document already assigns that mechanism to the successor profile.

## 4. Verifications performed

- Read revision (c)’s authoritative delta enumeration first, then the complete target.
- Checked the relevant sections of LLPs 0000, 0004, 0007, 0008, 0011, 0043, 0057, 0058, 0081, 0110, 0129, 0133, 0135, 0148, 0151, 0158, 0163, and 0191, plus the three commissioning tickets and the app-identity-binding guide.
- Inspected row insertion/deletion/incarnation code and tests, replay-ledger and id-map behavior, auth catalog schema/provider writes, and settlement-digest construction.
- Confirmed positive claims including C-2’s binding-bypass rationale, LLP 0135’s current in-transaction exhaustion behavior, the two fences being cleared, and the absence of a validator/schema `v.serial` conflict.
- Ran `./ref-check --verbose`: 228 LLP documents, 4,785 refs, 0 errors, 0 unchecked. `git status --short` remained empty; no files were modified.
- Disclosure: one broad vocabulary search used an ineffective exclusion glob and printed snippets from unrelated existing review files. No LLP 0226 review content was visible or used; every finding above is grounded in the target, governing documents, code, and tests cited directly.

## 5. Verdict

VERDICT: NOT READY
## Round 3 — 2026-08-10 (delta round; final budgeted round)

- Reviewer: gpt-5 family — codex exec, model gpt-5.6-sol, reasoning xhigh,
  read-only sandbox, --ignore-user-config.
- Capsule: detached worktree at commit `ceb7803c4`.
- Target revision: (d), sha256 prefix `96f78dc9af17aeb8`.
- Instructions: sr-review-r3 delta template.
- Verdict: **NOT READY** (4 MATERIAL: 3 IN-DELTA, 1 PRE-EXISTING).

### Verbatim review

## 1. Summary

The overall identity architecture is well-directed: distinct namespaces, explicit conversions, and distributed implementation ownership are the right shape. However, three revision-(d) changes leave contradictory or incomplete observable contracts, and one pre-existing counter scope is incorrect across forks. These MATERIAL concerns block readiness.

## 2. Direction assessment

The core direction is right. In particular, separating principal from provider identity, authoritative from speculative row identity, serial identity from canonical relationship keys, and raw mutation IDs from server-derived settlement IDs resolves real trust-domain conflation.

The blocker is not the architecture’s organizing idea. It is that several boundaries currently permit mutually incompatible implementations—especially provider-to-app bootstrap and serial lifecycle behavior.

## 3. Concerns

1. **MATERIAL · IN-DELTA — The principal-only rule makes the verified-claims auth branch unusable and contradicts the cited conforming recipe.**

   Exact text at issue:

   - “**app-side conversions key on the principal, never on `(issuer, subject)`**” (`llp/0226-identity-architecture.decision.md:69-73`).
   - C-6 says app-side bindings key “on the principal, never on the credential” (`:118-128`).
   - Yet the auth lane leaves exposing verified provider claims as an implementation option and says the guide’s broker recipe remains conforming (`:272-279`).

   The commissioned alternative explicitly called for a verified principal-claim surface bound to immutable provider `(issuer, subject)`, or privileged provisioning (`issues/20260808-identity-architecture-decision.md:14-18`). The current recipe necessarily performs that bootstrap conversion: it stores and uniquely indexes provider identity in the app binding (`guide/recipes/browser-auth.md:41-56`; `demos/browser-auth/snapback/schema.mjs:9-24`) and uses it to find the app user before any principal binding exists (`demos/browser-auth/snapback/functions.mjs:88-109`).

   Under C-1 and revised C-6, the “expose verified claims” branch has no declared way to convert an unbound provider identity into an app row. Only privileged provisioning remains viable, despite the document presenting both choices.

   Fix shape: decide explicitly between:

   - permitting a narrowly scoped, verified bootstrap conversion `provider identity → app row`, while requiring all steady-state handler access and durable principal bindings to key on principal; or
   - selecting privileged provisioning exclusively, moving provider-to-app mapping outside app data, removing the claim-exposure alternative, and updating the guide/demo conformance statement.

2. **MATERIAL · IN-DELTA — “Store lineage” does not decide reset/clear behavior for serial high-water.**

   Exact text at issue: serial counters “never restart” and survive “restart, fork, and restore” (`llp/0226-identity-architecture.decision.md:57`, `:161-167`), while the amendment question list mentions fork/restore but not reset or clear (`:235-248`).

   Current destructive reset deletes `_snapback_sequence_counters_v1` and rotates the data stream (`src/storage/schema_seed.rs:93-105`; preview mirrors this at `:391-400`). LLP 0109 defines `resetInstall` and `clear` as stream-rotating destructive operations (`llp/0109-versioned-seed-evolution.spec.md:1289-1308`). Because restore also rotates the stream yet must preserve serial high-water, stream rotation alone cannot tell an implementer whether reset starts a new “store lineage.”

   Fix shape: define the store-lineage boundary and explicitly rule on `resetInstall`, `clear`, legacy reset, import, and restore. Add those cases to the schema amendment’s mandatory lifecycle matrix.

3. **MATERIAL · IN-DELTA — The schema lane still points at an incarnation prefix after revision (d) chose bare serial values.**

   Exact conflicting text:

   - M-3: table-scoped serial counters have “the public serial value … bare numeric with no prefix” (`llp/0226-identity-architecture.decision.md:161-167`).
   - Schema lane: “the successor profile’s incarnation-prefix carrier applies where a constraint stores allocated values” (`:231-234`).

   LLP 0135’s prefix belongs specifically to row-scoped counters that restart with a recreated scope (`llp/0135-sequence-allocation-and-snapshot-batch.spec.md:254-270`). The source ticket preserved that qualification—only when a value is stored under a constraint on an incarnation-scoped table (`issues/shelved/20260808-numeric-identity-default-columns.md:79-81`). The Decision’s current wording no longer distinguishes that case from the primary unique index over a serial column.

   Fix shape: state that a serial column and its ordinary unique index use the bare numeric alone. Retain `(scopeId, relationIncarnation)` only for independently row-scoped LLP 0135 relationships that copy/store such a value.

4. **MATERIAL · PRE-EXISTING — Counter identity is scoped to the logical app, but forks create divergent copies within the same app.**

   Exact text at issue: Counter identity’s uniqueness scope is “The declaring app” (`llp/0226-identity-architecture.decision.md:61`).

   LLP 0158 defines a fork as the same `appId` but an independent instance and stream (`llp/0158-instance-forking.rfc.md:491-500`, `:719-743`). Fork custody copies `_snapback_sequence_counters_v1` (`src/instance_fork.rs:500-509`). Parent and fork can therefore contain the same `(counterName, scopeTable, scopeRowId, scopeIncarnation)` tuple and advance it independently.

   Fix shape: scope counter identity to one app instance/store lineage, not the declaring logical app. The physical tuple may remain sufficient inside one database, but the semantic namespace must include the instance/lineage boundary.

5. **implementation-phase · IN-DELTA — `authFingerprint` alone is not always the actual caller identity.**

   Exact text at issue: “`authFingerprint` hashes principal/session/user, i.e. the *caller*” (`llp/0226-identity-architecture.decision.md:58`; repeated at `:287-290`).

   The hash does cover only `principal`, `session_id`, and `user_id` (`src/manifest.rs:9573-9593`). For delegated service authority, `user_id` becomes the effective user while actor/grant attribution is excluded (`src/auth/invocation.rs:599-623`). The separate `authorityInstanceId` carries actor/credential/grant distinction (`src/auth/descriptor.rs:43-67`).

   Fix shape: say the complete settlement preimage is caller-scoped collectively; `authFingerprint` hashes the projected auth context, while `authorityInstanceId` supplies the remaining authority-instance distinction.

6. **implementation-phase · IN-DELTA — The D5 owner document has not absorbed revision (d)’s corrected digest.**

   The Decision says the LLP 0043 landing “already conforms,” including `artifactGenerationDigest` (`llp/0226-identity-architecture.decision.md:283-292`). The code does include both `artifactGenerationDigest` and `operationIssuance` for issuance-bearing identities (`src/storage.rs:975-1002`), but LLP 0043 and its resolution ticket still enumerate only optional `operationIssuance` (`llp/0043-offline-replay-retention.rfc.md:470-475`; `issues/closed/20260808-handler-settlement-identity-surface.md:31-37`).

   Fix shape: add the promised dated LLP 0043 owner amendment and reconcile the resolution record. The implementation itself matches revision (d).

## 4. Verifications performed

- Read revision (d)’s authoritative delta enumeration first, then the complete target.
- Verified row-mint and reconciliation semantics against LLP 0133, LLP 0148, and `src/storage.rs`.
- Verified relation-incarnation lifecycle against LLP 0110, `src/contract_types.rs`, and `src/storage.rs`.
- Verified counter identity, gap, exhaustion, and fork custody against LLP 0135, LLP 0158, `src/storage.rs`, and `src/instance_fork.rs`.
- Verified principal/provider storage against LLP 0151, `_auth_users`/`_auth_identities` schema, provider code, and the auth guide/demo.
- Verified settlement preimages and hosted/local surfaces against LLP 0043, LLP 0163, `src/storage.rs`, runtime/harness code, and Cloudflare host ops.
- Searched the corpus and packages for conflicting `v.serial` usage; none was found.
- Did not run tests because the review was required to make no filesystem changes. Final `git status --short` was empty. Nothing under `llp/reviews/` was read.

## 5. Verdict

VERDICT: NOT READY
## Round 6 — 2026-08-10 (delta round; final extension round)

- Reviewer: gpt-5 family — codex exec, model gpt-5.6-sol, reasoning xhigh,
  read-only sandbox, --ignore-user-config.
- Capsule: bare `git archive` export of commit `4f37cdd10` (sr-r6b).
- Target revision: (h), sha256 prefix `ea8056b79b1dffcd`.
- Verdict: **NOT READY** (3 MATERIAL: 2 IN-DELTA, 1 PRE-EXISTING). Loop
  terminal at budget exhaustion; sustained asymmetry stands (claude READY
  at revisions d, f, g, h — four consecutive; gpt-5 NOT READY at all six
  rounds).

### Verbatim review

## 1. Summary

The overall direction is sound: explicit identity namespaces, declared conversions, and a separate serial identity preserve Snapback’s local-first model while supporting relational migrations. Revision (h), however, introduces two material inconsistencies, and the existing document omits one identity namespace that directly participates in settlement. The decision is not yet implementation-safe.

## 2. Direction assessment

The central idea is right. Keeping `_id` as the canonical client-generable relationship key while making serials server-owned display/permalink identities agrees with the portable ID contract in [LLP 0007](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/llp/0007-storage-portability.spec.md:140) and Lane Q’s accepted client-generated IDs in [LLP 0133](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/llp/0133-local-settlement.spec.md:177). Treating conversions as trust boundaries and assigning amendments to existing owner LLPs is also the right architectural shape.

The failures are boundary-definition problems, not a reason to abandon the direction.

## 3. Concerns

1. **MATERIAL — IN-DELTA: `store export` is classified as a fork-like sibling without reconciling the implemented export identity contract.**

   Exact text at issue: “A booted `snapback store export` copy … begins a **divergent sibling lineage**” and is “classified with fork” ([target](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/llp/0226-identity-architecture.decision.md:188), lines 188–191).

   Repository evidence conflicts with an unqualified fork classification:

   - LLP 0192 defines export as a “faithful copy” carrying the “same sessions, same tokens, same admin authority” ([LLP 0192](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/llp/0192-store-durable-state-set.decision.md:121), lines 121–142).
   - The operating guide says fork—not export—owns “lineage, scrubbing, and TTL,” and distinguishes export’s preserved identities from a fork’s rotated identities ([backup guide](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/guide/operating/backup-and-copy.md:195), lines 195–211).
   - Export writes a descriptive manifest but performs no identity rotation ([store_state.rs](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/src/store_state.rs:476), lines 476–495). A targeted search found no startup path consuming that manifest to mint a new lineage.
   - The actual fork path rotates both authorization and data-version streams ([instance_fork.rs](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/src/instance_fork.rs:1714), lines 1714–1764).

   As written, one implementer could preserve all identities according to LLP 0192, while another could rotate them according to the new “classified with fork” language. Those produce materially different cursor, authority, settlement, and credential behavior.

   Fix shape: either state explicitly that this is a **serial-comparison rule only**, with export retaining LLP 0192’s identities, or amend LLP 0192 and the export/start implementation with the exact identities, credentials, streams, and custody state that rotate. Do not use an unqualified fork classification for both products.

2. **MATERIAL — IN-DELTA: bare row ID is incorrectly recommended as restore-immutable identity.**

   Exact text at issue: “Apps that need external references immutable **across restores** use an identity-grade source key or the row id” ([target](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/llp/0226-identity-architecture.decision.md:181), lines 181–187).

   The same document says `_id` is only a row address and that delete/recreate with the same value creates a new incarnation; lifetime-sensitive references require `(_id, rowIncarnation)` ([target](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/llp/0226-identity-architecture.decision.md:58), line 58; lines 102–114). LLP 0110 likewise requires a new incarnation whenever an application ID is reused and preserves that distinction through its registry ([LLP 0110](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/llp/0110-bounded-children-and-activity-patterns.spec.md:1002), lines 1002–1037; [lifecycle](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/llp/0110-bounded-children-and-activity-patterns.spec.md:1160), lines 1160–1178). Moreover, `_id` is client-mintable, and Lane Q accepts client-supplied values ([LLP 0007](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/llp/0007-storage-portability.spec.md:140), lines 140–155; [LLP 0133](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/llp/0133-local-settlement.spec.md:177), lines 177–189).

   Restoring an earlier snapshot can therefore lose a later incarnation and permit the same `_id` to designate a fresh lifetime. Bare `_id` can retarget across restore just as the serial can.

   Fix shape: require `(_id, rowIncarnation)` for lifetime- and restore-immutable references, or an identity-grade source key whose non-reuse authority explicitly survives Snapback restore. Clarify that a unique index in the restored snapshot alone cannot establish across-restore non-reuse.

3. **MATERIAL — PRE-EXISTING: `authorityInstanceId` is a load-bearing identity namespace but is absent from the namespace model.**

   Exact text at issue: the settlement row includes `authorityInstanceId` in its digest ([target](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/llp/0226-identity-architecture.decision.md:64), line 64), while the table claims to answer provenance, uniqueness, mutability, and surface for the identity architecture (lines 52–67), and M-1 requires one admitting authority for “each namespace” (lines 153–158). No authority-instance row exists.

   This identity is not equivalent to the document’s data `versionStream`. Its provenance varies by authority class: stored session/revalidated authority ID, a derived service-authority ID, or the authorization-stream incarnation for anonymous/dev/admin/system authority ([descriptor.rs](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/src/auth/descriptor.rs:15), lines 15–82). Service authority uses a distinct derived `aut_…` identity ([LLP 0148](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/llp/0148-prefixed-identifiers.decision.md:286), lines 286–293). LLP 0043 makes the authority-instance descriptor the owner of queued mutations and specifies its rotation behavior ([LLP 0043](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/llp/0043-offline-replay-retention.rfc.md:524), lines 524–531).

   This omission leaves implementers guessing whether authority identity is principal, session, stream, instance, or settlement identity—a plausible wrong guess with replay consequences.

   Fix shape: add an **invocation-authority identity** row defining its variant-specific provenance, scope, stability/rotation rules, opaque surface, and relationship to principal, authorization stream, data stream, and settlement identity. Then apply M-1 and the export/fork/restore rules to it explicitly.

## 4. Verifications performed

- Read the complete target, including revision (h)’s authoritative delta enumeration and surrounding pre-existing decisions.
- Checked the root architecture and governing LLPs for portable IDs, settlement lanes, row incarnations, sequence allocation, prefixed identifiers, forking, export, and offline replay.
- Inspected the implemented export, fork, restore-stream rotation, authority-descriptor, and settlement identity paths.
- Confirmed destructive restore rotates the authorization and data-version streams in one transaction ([storage/auth.rs](/Users/ccheever/projects/snapback-worktrees/sr-r6b-capsule/src/storage/auth.rs:1367), lines 1367–1384).
- This was a static, read-only review. I did not build, run tests, modify files, or open review artifacts. The future serial-schema successor is not implemented, so its mechanics could only be checked for internal completeness and consistency with existing owner contracts.

VERDICT: NOT READY