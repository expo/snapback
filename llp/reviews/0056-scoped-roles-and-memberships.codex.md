**Reviewer family:** GPT (OpenAI Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.3 (`codex exec`), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, session id 019f5efa-b4a0-7e30-99ca-9ca669e4af2d; orchestrated by /llp-super-refine
**Date:** 2026-07-13
**Redacted:** no redaction applied — no secrets in the reviewed material; reviewer instructed not to read `.agent-local-secrets.md`, credential files, or llp/reviews/. Sent to OpenAI under explicit human invocation of /llp-super-refine.
**Method:** cli-runner

# LLP 0056 reviews — GPT family

## Round 1 — 2026-07-13

**Revision under review:** `llp/0056-scoped-roles-and-memberships.rfc.md`, sha256 `582b1841d0f2d4a869716c778fad4f972c592eafe846ae80334e6efa61ccf99a` (untracked working-tree file; repo HEAD `c804284`)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

The core proposal is strong: “roles are app data, in a system-recognized shape” is the right level of abstraction for Snapback. Flat, resource-scoped memberships fit the reference applications, preserve portability, avoid stale session claims, and give the runtime enough structure to connect authorization with sync and diagnostics.

The RFC is not ready, however. Several load-bearing claims currently contradict LLP 0053, and the matcher/compiler path described as “correct by construction” does not yet have a defined semantic representation. The current implementation reinforces that gap: `QueryPlan` is single-table, `ValueExpr` cannot express relationship existence, membership metadata and uniqueness do not exist in `TableManifest`, and no `ctx.permissions` host surface exists.

The proposal needs another revision that pins the semantic IR, dependency capture, storage invariants, trusted-denial envelope, policy-evaluation rules, and landing gates. Exact TypeScript spelling can remain with LLP 0004, but the security semantics cannot remain illustrative.

## 2. Strengths

- The “app data in a system-recognized shape” decision is an excellent middle ground between opaque application convention and a separate policy database (§Summary).

- Keeping real-session roles out of `ctx.auth.roles` correctly preserves LLP 0039’s pin and avoids credential staleness (§Summary; §What stays out of the session).

- Ordinary app-table behavior—queryability, exportability, client types, and app-controlled visibility—is coherent with LLP 0011’s protected-core/app-data split (§Declaring a membership table).

- Flat facts, explicit accepted-role lists, and no hierarchy or inheritance in v1 are appropriately conservative and analyzable (§Non-Goals).

- Separating app-level global roles from `AdminRead`, `AdminWrite`, `AdminSecretRead`, and `ImpersonationCapability` is a necessary and well-stated security boundary (§Global roles).

- The effective-principal plus grant-scope composition is directionally consistent with LLP 0055: delegation narrows invocation authority and does not mint new memberships (§Agents).

- The validation requirements correctly identify several essential outcomes: live revocation, two-sided writes, fail-closed unauthenticated access, and operator-plane separation (§Validation Requirements).

## 3. Concerns

1. **Severity: MATERIAL — The invalidation classification contradicts LLP 0053.**

   **Evidence:** §Invalidation presents ordinary membership writes as matcher-only, then says bulk paths treat membership writes as permission-backing; the validation list checks authorization-version advancement only for bulk import. LLP 0053 §Two orthogonal declarations and §The authorization-event universe instead require every committed write to a `permissionBacking` table to advance the authorization version, except a known update proved disjoint from `permissionFields`. Its card-game fixture explicitly says a membership kick advances the global epoch in addition to waking the joined query. Reset/import are separate boundary events, with incarnation semantics, not merely bulk table writes.

   **Resolution criterion:** State that every membership declaration emits `permissionBacking: true`, with `permissionFields` derived from the principal, resource, and role fields. Inserts, deletes, unknown-field updates, and updates intersecting those fields must transactionally advance the authorization version. Known updates to unrelated extra fields may be suppressed. Schema activation must follow event 2; reset/import/restore must follow event 3 and its incarnation rules. Add ordinary insert/update/delete tests, not only bulk-import coverage.

2. **Severity: MATERIAL — The helper-to-join compilation contract is undefined and cannot be expressed by the current IR.**

   **Evidence:** §Rule helpers says `memberOf(resourceRef)` and `hasRole(resourceRef, …)` compile to matcher-observable joins, but neither helper identifies which membership declaration to use. Multiple membership tables can target the same resource type, and §Declaring explicitly recommends a second table for multi-role assignment. `hasGlobalRole("admin")` is likewise ambiguous if more than one app-scoped membership table exists.

   The current implementation has no implicit solution: `src/manifest.rs::QueryPlan` names one table and scalar filters; `ValueExpr` has no relationship/exists form; `TableManifest` has no reference or membership metadata; `packages/snapback-codegen/define.mjs` emits single-table plans and does not implement `v.id`. LLP 0004 and LLP 0008 still describe joins as outside the current syncable subset. `src/live_matcher.rs` wakes only from represented captured dependencies, while `compute_live_delta` considers only `plan.table`.

   **Resolution criterion:** Pin a semantic, declaration-bound relation operator—regardless of final TypeScript spelling—that includes a stable membership declaration id, membership table, principal/resource/role fields, accepted roles, and resource expression. Define how it lowers into SQL/evaluation, generated read summaries, captured dependencies, room dependencies, and doctor traces. Membership-table changes must conservatively force full re-query/`live_replace` unless equivalence is proved; they must never ride the primary-table delta path. Either require helpers to be table-bound, such as `eventMembers.hasRole(...)`, or forbid ambiguous multiple declarations. Define an auth-principal-id type rather than assuming an ordinary app `users` table.

3. **Severity: MATERIAL — `ctx.permissions.requireRole` lacks the database-capture and commit-validation semantics required for correctness.**

   **Evidence:** §Rule helpers specifies the imperative check but does not say that a successful check records the membership lookup in the query’s captured dependency set. Without that, a live query can publish rows after a successful check and never wake when the membership is deleted. For mutations, a role can be revoked after the check but before commit unless the permission fact participates in commit-time read-set validation. LLP 0053 §The authorization-event universe classifies protected-query host operations as `DatabaseCaptured` or terminal authorization; LLP 0004 §Write Semantics requires auth/permission facts read before commit to be validated. The current handler context in `packages/snapback-harness/ctx-bootstrap.js` has no `ctx.permissions` surface.

   **Resolution criterion:** Define `requireRole` as a database-captured host operation on success and a terminal authorization operation on denial. Its membership read must be snapshot-bound, included in complete live/retained read summaries, and validated at mutation commit. Add tests for membership removal after a successful live snapshot and for revocation racing between a mutation check and commit.

4. **Severity: MATERIAL — The proposed denial code and payload contradict LLP 0053’s trusted-denial contract.**

   **Evidence:** §Rule helpers introduces `SNAPBACK_AUTH_ROLE_DENIED` and says the client-visible denial carries absent-versus-wrong-role state. LLP 0053 §Dispositions, with producers and meanings recognizes `SNAPBACK_AUTH_PERMISSION_DENIED` as the trusted terminal outcome and requires that it “never echo private permission facts to the client.” A new application-facing code is not automatically trusted proof for `delete`.

   **Resolution criterion:** Use `SNAPBACK_AUTH_PERMISSION_DENIED` as the unforgeable outer outcome, with an internal/gated reason kind such as `role`. Keep actual membership state and policy traces on a privileged doctor/audit surface; define a separately redacted public payload. If a distinct trusted wire code is genuinely required, amend LLP 0053 explicitly. Validation must prove that catching the local exception cannot recover handler output and that thrown/forged role codes remain untyped.

5. **Severity: MATERIAL — The storage invariants and central role-cardinality decision are not specified.**

   **Evidence:** §Declaring normatively requires a closed vocabulary and one row per `(principal, resource)`, but §Open Questions still asks whether that one-role model holds. The suggested second-table workaround changes helper resolution and policy meaning. Current `TableManifest`/`IndexManifest` supports neither enums nor unique constraints, so the promised invariant is not presently enforceable atomically.

   The RFC also does not define what happens when an existing table is newly declared as a membership table, a role is removed from the vocabulary, duplicate pairs already exist, or concurrent writers insert the same pair.

   **Resolution criterion:** Decide scalar-role versus set-valued-role cardinality before readiness. Define the corresponding database constraint—unique `(principal, resource)` or unique `(principal, resource, role)`—and generated lookup index. Enforce required field types, non-nullness, role vocabulary, and uniqueness in the central storage/write path for handlers, HostPlan, seed, admin edits, import, and future adapters. Schema activation must reject incompatible existing data or require an explicit atomic migration. Add concurrency and schema-evolution fixtures.

6. **Severity: MATERIAL — Self-referential membership RLS and two-sided write evaluation are undefined.**

   **Evidence:** §Declaring says a membership table’s own visibility rules may use membership helpers, and §Rule helpers says a host-only write rule can use the same table. A naive implementation recursively applies the membership table’s RLS while trying to read the membership fact needed to decide that RLS. Conversely, an unrestricted lookup needs a carefully bounded trusted-policy context. The RFC also does not say whether referenced membership facts for an update are evaluated against the pre-write snapshot, the post-merge transaction view, or both—observable for self-demotion, host transfer, and multi-row writes.

   **Resolution criterion:** Pin a non-recursive policy-evaluation model. For example, the trusted evaluator may read raw membership facts solely to produce a boolean/terminal denial, without exposing those rows or recursively applying result visibility. Define transaction/snapshot semantics for pre- and post-state checks, including self-role changes and multi-row mutations, and explain how the first privileged membership is bootstrapped. Add a roster-table fixture where the ACL table is also the result table.

7. **Severity: MATERIAL — The LLP 0055 “human-only” composition claim is wrong for delegated agents.**

   **Evidence:** §Agents says `auth.kind` lets an app express “humans only may be host.” LLP 0055 §Resolved authority defines `auth.kind` as the effective principal’s kind and explicitly says code asking “was this actually the person?” checks `ctx.auth.actor`. A delegated agent acting for a human therefore has `auth.kind === "human"` and would pass the proposed check. LLP 0053’s sealed `ctx.auth` profile also does not presently contain `kind` or `actor`; LLP 0055 is proposing that later extension.

   **Resolution criterion:** Distinguish effective-principal restrictions from actor restrictions. Human-actor-only rules must inspect an analyzable `auth.actor`/`auth.actorKind` dimension or require `actor == null`, not merely `auth.kind`. Make this conditional on LLP 0055 landing and coordinating the sealed-projection amendment. Add a delegated-agent negative test with a human effective principal.

8. **Severity: MATERIAL — The status and validation plan treat accepted designs as shipped machinery.**

   **Evidence:** §Motivation says “LLP 0053 built the machinery,” and §What stays out of the session says `--as-role` “keeps working.” LLP 0039 says roleful impersonation and role checks are unbuilt, auth-scoped live is refused until landing item 6, and retained reads remain refused until item 8. The root ledger likewise says LLP 0053 acceptance does not claim implementation. Current `src/local.rs` still uses process-local permission epochs, best-effort `resync_required`, and the failure path that LLP 0053 supersedes; there are no persistent obligations, canonical trusted-denial host operation, membership manifest fields, or role helpers.

   The proposed validation list also omits the critical integration seams: lost removal/ACK, imperative-check revocation, a membership table that is both ACL and result, protected-room commit races, retained lease behavior, schema activation, concurrent duplicate insertion, and ordinary membership-write version advancement.

   **Resolution criterion:** Correct the as-built language and add an explicit landing/capability matrix. Finite role checks may land independently, but no role-gated live surface may activate before LLP 0039 item 6 and protocol negotiation; no retained role-gated result may activate before item 8; `--as-role` remains pending until its host-ops implementation and `ImpersonationCapability` gate exist. Add an integration validation matrix covering the seams above, reusing LLP 0053’s adversarial schedules rather than merely asserting inheritance.

9. **Severity: NON-BLOCKING — Unauthenticated helper behavior is described two ways.**

   **Evidence:** §Rule helpers says a null principal matches no membership rows, while §Validation Requirements says an unauthenticated client is rejected. LLP 0011 requires an auth-filtered unauthenticated subscription to be rejected immediately, not silently returned as an empty authorized result.

   **Resolution criterion:** State that null-match semantics are internal fail-closed evaluation behavior, while an unauthenticated auth-dependent subscription receives the parent contract’s typed rejection.

## 4. Suggestions

- Generate a table-bound “membership relation” object whose single descriptor produces the SQL predicate, captured dependency, `permissionBacking` metadata, role union type, room dependency, and doctor explanation. That would make drift between five separate implementations structurally difficult.

- Generate role literals as TypeScript unions and reject unknown literal roles during codegen as well as at runtime.

- Automatically generate the composite uniqueness/lookup index and report it in query-plan diagnostics.

- Add one complete worked example covering a protected resource query, the self-gated member list, host-controlled writes, a global role, a protected room, and a delegated agent.

- Report global authorization-version churn and quarantine time for membership-heavy workloads. LLP 0053 knowingly accepts coarse v1 blast radius; this primitive will make that cost common and should feed shadow-mode targeting priorities.

- Add LLP 0013, LLP 0024, and LLP 0037 to `Related`, since the RFC relies on each normatively.

## 5. Open questions

- Is a membership exactly one scalar role, or a set of independent roles? What real application validates that choice?

- How is a helper bound to one declaration when several membership tables target the same resource type or app singleton?

- Is the principal field a dedicated Snapback principal id, an app-table reference, or both? What happens when no app profile row exists?

- Do trusted policy lookups bypass the membership table’s own visibility policy, and how is that privilege prevented from leaking rows?

- What pre/post transaction view governs self-demotion, host transfer, and multi-row role updates?

- What is the schema-evolution rule for removing or renaming a role that existing rows still contain?

- Are membership-gated queries initially online `live_replace` only, or can a specific multi-table form qualify for retained sync? What is the proof on each target?

- Which role-denial facts are safe for an ordinary caller, and which are available only through privileged doctor/audit surfaces?

- Should `--as-role` identify a particular global membership declaration, and how are same-named roles across declarations handled?

- For delegated agents, which rules constrain the effective principal and which constrain the actual actor?

## 6. Readiness verdict

The central idea is good and worth pursuing, but the current draft has unresolved contradictions with LLP 0053, an undefined matcher/compiler contract, incomplete storage and denial semantics, and an incorrect delegated-agent check. Those are correctness and security issues, not editorial polish.

VERDICT: NOT READY
### Orchestrator verification notes — round 1 (not part of the received review)

Decisive factual claims spot-checked against the repository by the orchestrating session; the verbatim body above is unaltered:

- LLP 0053 event 1 ("a committed write to a `permissionBacking` table"; inserts/deletes always fire; `permissionFields` narrows known updates only) confirmed (`llp/0053:336-347`, `:365-366`); the card-game kick fixture confirmed (`:1388`).
- "Never echo private permission facts to the client" confirmed (`llp/0053:975-977`).
- `QueryPlan` single-table (`src/manifest.rs:1143-1144`); no exists/relationship form in `src/value_expr.rs`; no membership metadata in `TableManifest`.
- No `ctx.permissions` surface in `packages/snapback-harness/ctx-bootstrap.js` (grep, 2026-07-13).
- `src/local.rs` still carries process-local `permission_epochs` / `resync_required` (`src/local.rs:349-548`) — the superseded pre-0053 machinery.
- LLP 0055 defines `kind` as the effective principal's kind (`llp/0055` §Resolved authority), so the "humans only may be host" example in the target is satisfiable by a delegated agent — the cross-document inconsistency is real.
- LLP 0008 single-table syncable subset confirmed (`llp/0008:166-180`).

## Round 2 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3 (`codex exec`), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session id 019f5f14-3948-7c10-aff8-c21fa9a16660; method cli-runner; no redaction needed; reviewer barred from llp/reviews/.
**Revision under review:** `llp/0056-scoped-roles-and-memberships.rfc.md`, sha256 `a75c777327d8fe95e7525bc20ffb21094639c975434f6617182bcc611b737c3c` (post-round-1 revision)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

The core proposal is a good idea. Modeling roles as current application data in a schema-recognized membership table fits LLP 0011’s structured-rule model, preserves LLP 0039’s empty `ctx.auth.roles` contract for real sessions, and composes naturally with LLP 0053’s separation between result dependence and authorization dependence. The conservative `live_replace` lane is also an appropriate first implementation.

The draft is commendably honest about the unbuilt substrate. The implementation supports its inventory: `QueryPlan` is single-table, `ValueExpr` has only `AuthUserId`, `TableManifest` has no membership or unique-index metadata, the authoring package has neither `v.principal()` nor `.membership()`, and the runtime has no `ctx.permissions` operation.

It is not ready, however. Several load-bearing contracts remain ambiguous or contradict governing documents: the imperative helper is not declaration-bound, its captured-read representation is unspecified at a seam where the current matcher can silently miss changes, derived `permissionFields` are unsafe for an extensible ordinary table, denial details expose unclassified policy information, the subject-scoped narrowing claim lacks usage-side closure, the human-actor example is wrong under LLP 0055, and scoped dev impersonation has no coherent resource semantics. Some validation rows could pass through LLP 0053’s coarse event path while the matcher path remains broken.

## 2. Strengths

- **Schema-recognized application data.** `§Declaring a membership table` gives roles an inspectable, migratable representation without turning them into stale session claims.

- **Strong central invariants.** `§Declaring a membership table` correctly requires closed vocabularies, uniqueness, fail-closed activation over existing data, and enforcement through the common write path.

- **Safe default visibility.** `§Declaring a membership table` treats membership rows as sensitive social-graph data and requires explicit read/sync authorization.

- **Implementation honesty.** `§What exists, what this adds` accurately distinguishes shipped machinery from proposed manifest, IR, validator, uniqueness, and host surfaces.

- **Correct staging of write authorization.** `§Write-side enforcement, v1 vs. later` respects LLP 0039’s handler-only v1 pin while preserving LLP 0011’s future insert/update-pre-and-post/delete semantics.

- **Correct invalidation decomposition.** `§Invalidation: the LLP 0053 mapping` recognizes that membership tables can participate independently in matcher result dependence and global authorization-version dependence.

- **Owned operational cost.** `§The v1 cost, owned` clearly states the global quarantine/resnapshot blast radius instead of presenting membership churn as cheap.

- **Session-role discipline.** `§What stays out of the session` preserves LLP 0039’s rule that real sessions carry `roles: []`.

- **Broad validation outline.** `§Validation Requirements` covers activation, writer coverage, live revocation, room suspension, retained results, agents, impersonation, and blast-radius measurement.

## 3. Concerns

1. **MATERIAL — The imperative helper is not declaration-bound.**

   **Evidence:** `§Rule helpers` says helpers are generated per declaration and that a global resolver would be an “authorization bug factory” because two membership tables may target the same resource type. The proposed imperative API is nevertheless `ctx.permissions.requireRole(eventId, "host", "cohost")`, which names neither a declaration nor a membership table. Resource type cannot resolve the ambiguity the section explicitly permits. In addition, LLP 0053 requires every runtime host operation to have exactly one admission class; `requireRole` combines a database-derived success fact with terminal denial, but the RFC does not classify or split it.

   **Resolution criterion:** Specify a declaration-bound generated API, such as `eventMembers.requireRole(ctx, eventId, ...)` or `ctx.permissions.eventMembers.requireRole(...)`, backed by a stable manifest declaration ID. Define whether it lowers into a `DatabaseCaptured` lookup plus the existing `TerminalAuthorization` denial, or amend LLP 0053 if it truly needs a new indivisible host operation. Add an acceptance case with two declarations over the same resource type and overlapping role names.

2. **MATERIAL — The captured-read contract is too vague for the actual matcher and commit validator.**

   **Evidence:** `§What exists, what this adds`, `§Rule helpers`, and `§Invalidation` alternate between “captured dependencies” and “read summary” as if they were interchangeable. They are not. `src/live_matcher.rs:121-125` gives captured dependencies precedence over the static summary; `src/live_matcher.rs:173-220` ignores `CapturedReadKind::Permission` and can return `Some(false)` after considering only ordinary query dependencies. Thus, once the primary query has captured a `Query`, merely adding the membership table to the static summary—or recording an intuitive `Permission` dependency—does not wake it. `src/storage.rs:3233-3234` likewise ignores `Permission` during commit-time read-set validation. The existing `Permission` kind represents epoch scopes in `src/local.rs:5080-5108`, not database membership facts.

   The proposed live revocation test is insufficient because every membership write is also authorization event 1; the coarse authorization-version path could resnapshot successfully while membership matcher capture is completely broken.

   **Resolution criterion:** Pin the exact representation: either a normal snapshot-bound `Query`/`Row`/`MissingRow` dependency recognized by both current paths, or a defined extension that makes a new dependency kind participate in both `live_matcher` and storage read-set validation. Add direct tests that independently prove matcher wake-up on membership insert/update/delete and mutation conflict on revocation, without allowing the global event-1 path to satisfy the assertion.

3. **MATERIAL — Deriving `permissionFields` only from principal, resource, and role is not safe for an ordinary extensible table.**

   **Evidence:** `§Invalidation` declares only those three columns permission-relevant and explicitly suppresses known updates to auxiliary fields. LLP 0053 instead presents fields such as `expiresAt` as permission-relevant and permits suppression only when the declared set is complete. Nothing in LLP 0056 prevents an application from adding `active`, `expiresAt`, `bannedAt`, or another field and consulting it in a function-level authorization check. Membership tables remain ordinary app tables, and LLP 0011 explicitly permits function-level checks. A known update to such a field would be classified as disjoint, so it would not advance the authorization version or trigger protected-room reauthorization.

   **Resolution criterion:** Default a membership table to all columns being permission-relevant. Permit narrowing only through an explicit, validated contract that accounts for every authorization use, or require non-authoritative metadata such as notification preferences to live in a companion table. Add validation where an auxiliary authorization field changes and must advance the version and suspend any affected room.

4. **MATERIAL — The client-visible denial payload conflicts with the stated redaction boundary.**

   **Evidence:** `§Rule helpers` makes `{ resource, requiredRoles, callerState }` client-visible, then says rule and policy traces belong only on doctor/audit surfaces. `requiredRoles` is policy structure, not a fact about the caller, and `resource` is not necessarily safe to echo when derived server-side. LLP 0053 `§Dispositions, with producers and meanings` requires the terminal producer never to echo private permission facts. LLP 0011 requires explainable diagnostics, not unrestricted client disclosure. The validation requirement checks only that another principal’s membership is absent; it does not test policy or resource enumeration.

   **Resolution criterion:** Define separate public and privileged denial schemas. The public response should contain only information proven safe for that invocation—potentially just a generic role-denial kind and caller-safe state—while required roles, declaration ID, rule trace, and server-derived resource facts remain in gated doctor/audit output. Add enumeration tests covering hidden resources and non-public role policies.

5. **MATERIAL — The subject-scoped narrowing argument proves row attribution, not authorization-use closure.**

   **Evidence:** `§Invalidation` claims the membership declaration is itself a closed source from which the system can infer that only principal P’s queries against resource R require reauthorization. The row shape does identify P and R, but it does not prove that only P’s authority depends on that row. An allowed function-level check could authorize principal Q based on whether any host exists, whether another member has a particular role, or another aggregate over the ordinary membership table. A change to P would then affect Q. LLP 0053’s open question requires a structural derivation or equivalently closed source and explicitly says successful shadow observations are not proof.

   **Resolution criterion:** Reframe the declaration as a necessary candidate key, not a sufficient narrowing proof. Subject narrowing should require usage-side proof that every authorization dependency on the declaration is generated, current-effective-principal-local, and resource-local. Raw or cross-principal authorization reads must retain the global path. Shadow validation should include cross-principal counterexamples and transactional old/new principal and resource values.

6. **MATERIAL — The “actual actor must be human” example is false under LLP 0055.**

   **Evidence:** `§Agents` recommends:

   ```text
   hasRole(event, "host") && auth.isDelegated == false
   ```

   as meaning “the person themself.” LLP 0055 `§Principal kinds` and its validation requirements state that an autonomous agent has `kind = "agent"` and `isDelegated = false`. An autonomous agent with a host membership therefore passes this rule. LLP 0056’s validation checks only that a delegated agent is refused and separately says autonomous memberships behave like human memberships, so it would miss the error.

   **Resolution criterion:** Use a predicate that requires both a human effective principal and non-delegation, such as `auth.kind == "human" && auth.isDelegated == false`, or pin an `auth.actorKind == "human"` spelling whose direct-session semantics are unambiguous. Validate direct human, delegated agent, and autonomous agent separately.

7. **MATERIAL — Bare `--as-role` cannot coherently impersonate a scoped membership.**

   **Evidence:** `§What stays out of the session` leaves open whether `--as-role` selects a global declaration or matches any declared vocabulary, while requiring it to satisfy declaration-bound helper checks. LLP 0024 defines only repeatable `--as-role <role>` alongside `--as-user`; it carries no declaration or resource. A bare `host` therefore cannot express “host of event E.” Matching any vocabulary would effectively grant the role across declarations and resources, undermining the very declaration binding this RFC requires.

   **Resolution criterion:** Settle this in the RFC before acceptance. A coherent design would reserve `--as-role` for an explicitly selected app-global declaration and introduce a resource-qualified test facility such as `--as-membership <declaration>:<resource>:<role>`, or require tests to seed real membership rows. Ordinary scoped helpers must not consume an undimensioned role string.

8. **NON-BLOCKING — `v.principal()` needs a precise identity and lifecycle contract.**

   **Evidence:** `§Declaring a membership table` calls it a delegated reference validator and requires activation to reject a “wrong principal type.” Today `FieldType` contains only primitive types (`src/manifest.rs:251-258`), and the authoring package has neither ID nor principal validators (`packages/snapback-codegen/define.mjs:37-55`). The RFC does not say whether validation is nominal, checks current `_auth_users` existence, accepts arbitrary dev-impersonation IDs, or how deactivated/deleted principals behave.

   **Resolution criterion:** Have the LLP 0004/0037 companion work define the serialized type, referential behavior, activation checks, dev-mode behavior, and principal deactivation/deletion semantics before implementation begins.

## 4. Suggestions

- Give every membership declaration a stable generated ID, normalized manifest form, source span, and migration behavior for table renames and role-vocabulary changes.

- Validate that role vocabularies are non-empty, duplicate-free, bounded in size, and normalized consistently across generated helpers and diagnostics.

- Make doctor output show the declaration ID, resource expression, roles tested, captured dependency kind, and snapshot/version witness while keeping that trace out of ordinary client errors.

- Clarify whether an `invited` role satisfies `memberOf`. Pending invitations usually should not accidentally receive the same visibility as accepted members.

- Pin first-host bootstrap to the resolved effective principal and require the parent resource’s creator field to be server-derived or checked against that principal.

- Qualify retained/offline claims for LLP 0055 service principals, whose v1 retained reads are explicitly out of scope.

- When declarative write rules land, require separate insert, update-pre, update-post, and delete fixtures rather than treating “host can change roles” as one test.

## 5. Open questions

- What exact generated declaration-bound API and host-operation lowering will imperative role checks use?

- What precise captured dependency represents successful membership lookup, and how is it evaluated by both live matching and commit-time validation?

- Are auxiliary membership columns forbidden from influencing authorization, conservatively permission-relevant, or explicitly declared and verified?

- Which denial fields are public, which require diagnostic authority, and how is resource/policy enumeration prevented?

- What usage-side proof is sufficient for subject/resource-scoped authorization-version narrowing?

- How should dev impersonation name a declaration, resource, and role without turning a scoped role into an all-resources override?

- Is `v.principal()` nominal typing, an existence reference, or both, and what happens after principal deactivation or deletion?

- Should pending invitations and multi-role membership share the canonical membership table, or use distinct declarations with clearer semantics?

## 6. Readiness verdict

The architecture is promising and broadly aligned with the governing auth documents, but the unresolved declaration binding, dependency capture, invalidation-field completeness, denial redaction, narrowing proof, agent-kind semantics, and impersonation scope are material correctness and security issues. The validation plan also needs to separate matcher proof from coarse authorization-event recovery.

VERDICT: NOT READY
### Orchestrator verification notes — round 2 (not part of the received review)

- `CapturedReadKind::Auth | CapturedReadKind::Permission => {}` ignored in the matcher (`src/live_matcher.rs:~190`) and `CapturedReadKind::Permission => {}` ignored in commit-time read-set validation (`src/storage.rs:3233-3234`) — the captured-read seam is exactly as described.
- LLP 0053's permissionFields example includes `expiresAt` (`llp/0053:336-337`) — the derived-fields-too-narrow concern is grounded.
- `FieldType` is primitives-only (`src/manifest.rs:252-258`) — the `v.principal()` contract gap is real.
- 0024 pins `--as-role <role>` repeatable with no resource axis (`llp/0024:288`) — the impersonation-scope concern is real.
- The autonomous-agent hole in the "person themself" example follows directly from LLP 0055's pinned variable semantics — confirmed by cross-reading both documents.

## Round 3 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3 (`codex exec`), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session id 019f5f2d-053d-77f0-9f5d-a55d281ada31; method cli-runner; no redaction needed; reviewer barred from llp/reviews/.
**Revision under review:** `llp/0056-scoped-roles-and-memberships.rfc.md`, sha256 `e019f30dcaa56b125d720a327dfa49bbb6f5cd3194ec7d1b6e31b880d8fe6b10` (post-round-2 revision)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

The core proposal is a good idea. Representing scoped roles as ordinary application data with system-recognized schema metadata is a strong middle ground between stale session claims and a general-purpose policy engine. It fits Snapback particularly well because authorization, sync, retained results, and protected rooms share one invalidation problem. Declaration-bound helpers are also the right default: the declaration is part of the permission’s identity, not incidental metadata.

The RFC is unusually candid about the unbuilt substrate and the cost of LLP 0053’s global authorization version. Its treatment of `permissionBacking`, incidental-field narrowing, trusted denials, and the conservative `live_replace` lane is largely coherent with the governing corpus.

It is not ready, however. Several unresolved seams are exactly where authorization bugs become durable: v1 membership mutations are not specified with the two-sided guarantees required by LLP 0011 and LLP 0039’s handler substitute; the claimed HostPlan idiom cannot be expressed by the current IR; `requireRole` is assigned admission classes by outcome despite LLP 0053’s one-class-per-operation rule; negative membership capture is not pinned tightly enough for the actual matcher; global role impersonation loses declaration identity; and the promised after-the-fact attribution contradicts LLP 0055’s audit limitations. These are contract issues, not routine implementation gaps.

## 2. Strengths

- **Roles remain live application data rather than session claims.** §Summary directly preserves LLP 0039’s `ctx.auth.roles` contract and avoids manufacturing a second staleness mechanism.

- **The abstraction is appropriately scoped.** §Goals and §Non-Goals bless the common `(principal, resource, role)` case without attempting Zanzibar-style graphs, inheritance, or permission matrices.

- **Declaration-bound helpers are an excellent security property.** §Rule helpers recognizes that the same role name can occur in multiple relationship tables and refuses to invent a global resolution rule.

- **The implementation-status accounting is honest and useful.** §What exists, what this adds accurately identifies the single-table `QueryPlan`, limited `ValueExpr`, absent membership metadata, absent `ctx.permissions`, and deferred declarative write rules.

- **The captured-read representation avoids a real implementation trap.** §The captured-read representation correctly observes that `CapturedReadKind::Permission` is ignored by both matcher and commit validation, as confirmed by `src/live_matcher.rs:189-190` and `src/storage.rs:3233-3234`.

- **The invalidation mapping is mostly disciplined.** §Invalidation separates result dependence from authorization-event dependence, defaults `permissionFields` conservatively, and explicitly owns the global-version blast radius instead of presenting memberships as cheaply precise.

- **Denial privacy is well considered.** §Rule helpers keeps required roles, declaration identity, and resource facts out of the client payload while retaining them for gated diagnostics.

- **The LLP 0055 composition gets principal-kind semantics right.** §Agents correctly requires both `auth.kind == "human"` and `auth.isDelegated == false` for “the person themself.”

- **Validation is staged against the actual auth activation matrix.** In particular, the requirement to prove matcher wake-up independently of the coarse authorization event is exactly the right kind of test.

## 3. Concerns

1. **The v1 write-authorization idiom is not two-sided or scope-safe.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Write-side enforcement says v1 performs `requireRole(eventId, "host")` before the membership write and defers two-sided declarative rules. Membership `principal` and `resource` columns remain mutable ordinary fields. LLP 0011 §Authorization Model requires inserts to check the new row, updates to check both old and merged rows, and deletes to check the old row. LLP 0039 §Acceptance requires its handler substitute to reject forged inserts, cross-scope updates, and unauthorized deletes. As written, a caller can authorize against resource A and then target a row belonging to resource B, or move a row between resources while checking only one side.
   - **Resolution criterion:** Specify the complete v1 mutation contract. Either make principal and resource axes immutable and express moves as authorized delete-plus-insert, or require transactionally derived checks against the actual old and merged rows for insert, update, and delete. Add membership-specific negative tests for an unrelated target row, forged principal/resource input, both directions of a scope-moving update, unauthorized delete, and concurrent revocation.

2. **The claimed HostPlan twin cannot be expressed by the current HostPlan IR.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Write-side enforcement calls for a `Get` on the generated composite unique index followed by `Guard`. Current `MutationStep::Get` accepts only a document id (`src/manifest.rs:1214-1227`), and the generated `get()` has the same shape (`packages/snapback-codegen/define.mjs:342-352`). The codegen surface explicitly classifies “membership guards over non-id keys” as having outgrown the IR (`packages/snapback-codegen/define.mjs:392-400`). Current `Guard` also takes an application-chosen error code, so it cannot by itself implement LLP 0053’s host-owned trusted role denial. §What this adds does not name a `GetByUniqueIndex`, membership guard, or equivalent HostPlan extension.
   - **Resolution criterion:** Either define a first-class declaration-bound HostPlan membership-check step, including composite lookup, snapshot capture, host-owned denial, generated schema, evaluator, and commit validation, or remove HostPlan membership enforcement from v1 and explicitly route it through the JS/Ibex tier until that step exists. The generated physical index must also be a true unique `(principal, resource)` index, not the current ordinary index form.

3. **`requireRole` is assigned admission classes by outcome, contrary to LLP 0053.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Rule helpers and §Companion obligations classify `requireRole` as `DatabaseCaptured` on success and `TerminalAuthorization` on denial. LLP 0053 §Protected-query admission says, “Every runtime host operation has one admission class”; `TerminalAuthorization` is specifically the separate host-owned denial operation that returns no application value. LLP 0053 §Dispositions also requires a trusted denial to report a coherent authorization/data witness. LLP 0056 pins captured database dependencies only for the successful lookup.
   - **Resolution criterion:** Define `requireRole` as an explicit composition: a declaration-bound membership lookup with the single class `DatabaseCaptured` on both present and absent outcomes, followed on false by the already-classified `ctx.permissions.deny()` `TerminalAuthorization` operation. The denied lookup must contribute its snapshot-bound dependency and coherent witness. Amend LLP 0053 using those separate operations and test a grant/revocation race around denial production.

4. **Negative membership dependencies are not specified completely enough for the shipped matcher.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §The captured-read representation describes a “successful membership lookup,” while correctness also depends on empty and false lookups. A user with no membership may initially receive an empty result; a later membership insert or role upgrade must wake that query. In `src/live_matcher.rs:173-220`, once any captured `Query` dependency exists, the matcher can return `Some(false)` without consulting the static read summary. Thus a primary-table query dependency plus no captured membership query can incorrectly prove a membership-table insert disjoint. This violates LLP 0053’s requirement that dependencies be complete before publication.
   - **Resolution criterion:** Pin the dependency produced by every membership evaluation, including false, empty, and denied outcomes. For argument-scoped resources this can be an empty-result membership `Query` dependency; for row-field `resourceRef`, define a complete broad predicate or complete set of negative resource dependencies, with unknown/incomplete cases falling back conservatively. Add isolated hidden-to-visible tests for membership insertion and role upgrade, as well as visible-to-hidden revocation and a genuinely disjoint membership change.

5. **Bare `--as-role` loses declaration identity for app-global roles.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Rule helpers rejects global `hasRole` resolution because overlapping role names across declarations are an authorization ambiguity. §What stays out of the session nevertheless says bare `--as-role admin` satisfies app-global declarations. LLP 0024 defines only the bare repeatable `--as-role <role>` form. If two app-global declarations both define `admin`, the flag either satisfies both—granting a combination no single membership fact supplied—or relies on an unspecified resolution rule. The validation matrix covers overlapping scoped declarations but not this global impersonation case.
   - **Resolution criterion:** Preserve declaration identity in impersonation, preferably with a declaration-qualified spelling, or reject a bare role whenever more than one app-global declaration can resolve it. Add a two-global-declaration fixture with an overlapping role name and pin deterministic behavior.

6. **The durable attribution claim contradicts LLP 0055’s audit contract.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Agents says a delegated agent’s durable self-seating is “attributable after the fact via the actor/effective/grant audit tuple,” and validation requires doctor/audit to attribute the surviving row after grant revocation. LLP 0055 §Audit explicitly says plain HTTP app-data has no invocation envelope, promises attribution there only in denial diagnostics and dry-run facts, and defers a durable queryable audit log. LLP 0056 does not require provenance columns; §Open Questions treats `grantedBy` as optional future work. Once the grant is revoked, the membership row itself therefore contains no reliable creator tuple.
   - **Resolution criterion:** Either retract the universal after-the-fact guarantee and constrain validation to transports where an envelope is actually retained, or make attribution durable through host-filled immutable provenance or a committed audit event for every membership write. If delegated membership mutations remain capable of creating autonomous authority, the durable provenance requirement should apply before that path is enabled.

## 4. Suggestions

- Define the stable declaration-id derivation, collision handling, and behavior across table renames, column renames, and vocabulary reordering.

- Generate literal-union role types and reject unknown roles, duplicate helper arguments, empty accepted-role lists, and dynamic role expressions at generation or manifest load.

- Consider marking membership mutations as an `authorityCreating` effect. A delegated grant could then require explicit consent to manufacture authority that outlives the grant, rather than treating that as an ordinary mutation side effect.

- Resolve `memberOf` before freezing the authoring surface. Since it matches every declared role, vocabularies containing `invited`, `pending`, `suspended`, or `banned` states need an `activeRoles` subset, an exclusion list, or no `memberOf` helper at all.

- Add a generated first-host transaction helper if the same safe bootstrap sequence appears in more than one application; this is an area where small hand-written deviations are security-sensitive.

- Measure authorization-version churn by declaration as well as globally so declaration-scoped narrowing has usable evidence when it is considered.

## 5. Open questions

- Are principal and resource columns immutable after insertion, and what exact checks govern role changes and deletion?

- Is `requireRole` a generated composition of two host operations or intended to be one atomic host operation?

- What exact captured dependency represents a false semi-join when `resourceRef` is a primary-row field rather than a query argument?

- Must dev role impersonation identify a membership declaration, or is intentionally satisfying every matching global declaration acceptable?

- Should delegated invocations require an explicit durable-authority capability before writing membership tables?

- Which declared roles count as active membership for `memberOf` and the co-members visibility preset?

- Does declaration-scoped invalidation need to land with this RFC to make routine membership churn operationally acceptable?

- How will optimistic mutation replay prove that the local membership snapshot is current enough to perform the check, and what exact signal forces server-decision mode?

## 6. Readiness verdict

The proposal has a strong core abstraction and a credible invalidation direction, but material correctness and coherence issues remain at the write-enforcement, protected-host-operation, matcher-capture, impersonation, and audit boundaries. Those contracts need to be pinned before implementation can be evaluated safely.

VERDICT: NOT READY
### Orchestrator verification notes — round 3 (not part of the received review)

- `MutationStep::Get` is a point read by id only (`src/manifest.rs:1218-1223`) and `Guard` carries an author-supplied error code (`:1225-1228`); the generated `get()` has the same shape and the codegen's `OUTGREW_IR_CLASSES` names 'uniqueness/quota/membership guards over non-id keys' as outgrown (`packages/snapback-codegen/define.mjs:344-347`, `:392-400`) — the HostPlan-idiom concern is fully grounded.
- The one-admission-class rule (`llp/0053:423`), the matcher's captured-Query short-circuit, and the 0055 audit-contract limits were verified in prior rounds and re-checked against the revision text.
- The mutable principal/resource two-sidedness gap and the `--as-role` multi-global ambiguity are accurately described against the revision text.

## Round 4 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3 (`codex exec`), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session id 019f5f46-a54b-7270-9cee-6103540f9819; method cli-runner; no redaction needed; reviewer barred from llp/reviews/.
**Revision under review:** `llp/0056-scoped-roles-and-memberships.rfc.md`, sha256 `01b52b9c4eb6796414229ed4c69d0ac999501043054a5c4d069f01650cc22dbd` (post-round-3 revision)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

The proposal’s central idea is sound and worth pursuing. Treating roles as ordinary application data in a system-recognized membership shape is a strong middle ground between stale session claims and an overbuilt relationship-authorization engine. Declaration-bound helpers, live-data evaluation, and automatic LLP 0053 invalidation participation are the right architectural direction. The RFC also composes well with LLP 0039’s `ctx.auth.roles` restriction and LLP 0055’s actor/effective-principal model.

The implementation survey supports the RFC’s account of the current substrate. `QueryPlan` is single-table, `FilterExpr` is field/operator/value, `ValueExpr` has no relational lookup, `TableManifest` has no membership metadata, and `IndexManifest` has no uniqueness flag. The RFC is also correct that captured `Query` dependencies take precedence in `src/live_matcher.rs`, while `CapturedReadKind::Permission` is ignored by both the matcher and commit validation. Capturing empty membership lookups and conservatively depending on the whole membership table for row-field semi-joins is therefore well motivated.

The document is not ready, however. Several load-bearing claims currently depend on mechanisms that are either unspecified or contradicted by the governing corpus and implementation: denial outcomes have no validation/linearization point, role-managed writes are safe only by convention, the proposed predicate lacks a normative IR, retained eligibility contradicts LLP 0008, nullable keys can defeat uniqueness, provenance covers only inserts, and the public denial payload leaks membership-row existence. These are repairable design problems, not reasons to reject the overall direction.

## 2. Strengths

- **The session boundary is correct.** §Summary and §What stays out of the session preserve LLP 0039’s rule that real sessions carry `roles: []`, while role authorization reads live application data. This avoids turning session lifetime into a permission-staleness bound.

- **Declaration binding avoids ambiguous authority resolution.** §Rule helpers correctly rejects a global `memberOf` or `hasRole` resolver and binds every helper to one declaration. The explicit OR required to combine declarations is safer and more explainable.

- **The matcher analysis is unusually concrete.** §What exists, what this adds and §The captured-dependency contract correctly identify the shipped captured-query short-circuit in `src/live_matcher.rs:158-220` and the inert `Permission` dependency in `src/storage.rs:3122-3235`. Empty-result capture and the conservative membership-table dependency are the safe choices.

- **The LLP 0053 decomposition is conceptually strong.** §Rule helpers separates the database lookup from terminal authorization instead of inventing a host operation belonging to two admission classes. §Invalidation also correctly keeps result dependence distinct from permission-backing authorization events.

- **The coarse invalidation cost is not hidden.** §The v1 cost, owned clearly states that ordinary membership churn advances the global authorization version and can quarantine every auth-scoped subscription. The proposed per-declaration measurements are useful evidence for later narrowing.

- **The RFC does not overclaim subject-scoped narrowing.** §Declared memberships are a candidate on-ramp correctly distinguishes row-attribution closure from usage-side closure and supplies the aggregate-host counterexample required by LLP 0053.

- **Agent composition follows LLP 0055’s principal semantics.** §Agents uses the effective user’s memberships for delegation, the autonomous agent’s own memberships otherwise, and correctly requires both `auth.kind == "human"` and `auth.isDelegated == false` for “the person themself.”

- **The validation matrix is broad and adversarial.** §Validation Requirements covers every writer class, concurrent uniqueness, stale-allow and stale-deny races, hidden-to-visible matcher behavior independent of the coarse event, protected rooms, impersonation ambiguity, and agent composition.

## 3. Concerns

1. **A terminal denial has no defined validation or linearization point.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Rule helpers says a denial superseded by a concurrent grant is “caught by read-set validation,” and validation requires stale allow and stale deny to be caught. A denied query never commits, and a denied mutation terminates before commit, so ordinary commit-time validation cannot do this. Today `execute_ibex_mutation` in `src/runtime.rs:222-240` uses `?` on handler execution and returns no captured reads on failure; the query path has the same shape. `src/server.rs:4647-4650` explicitly acknowledges that failed queries can discard `ctx.db` capture. `src/local.rs:2493-2535` installs a live subscription and its dependencies only after a successful query. LLP 0053 requires a trusted terminal denial to carry a coherent, current authorization/data witness.
   - **Resolution criterion:** Specify a first-class terminal-authorization outcome that preserves captured dependencies despite handler termination. Before branding or emitting the denial, validate those dependencies and the relevant authorization/version witness at a commit-ordered linearization point; on mismatch, discard and rerun. Define whether a denied live query remains registered for later re-grant and, if so, where its empty dependency is retained. Acceptance must race grants and revocations against both query and mutation denials, including initial subscription and obligation-driven reruns.

2. **The “two-sided, scope-safe” write contract is an unenforced coding convention.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Write-side enforcement says the confused-deputy shape is impossible only “when the idiom is followed.” The central write path in §Declaring enforces vocabulary, uniqueness, and immutability, but it does not require any authorization check. Nothing binds a successful `requireRole(resourceA)` to a later insert, update, or delete, and raw Ibex membership writes remain available. LLP 0039 permits handler-owned rejection as an interim narrowing, but it does not make an omitted or misbound handler check structurally safe. The shown idiom also does not implement LLP 0011’s general pre- and post-merge policy for role-sensitive transitions.
   - **Resolution criterion:** Either narrow the claim explicitly to a recommended handler pattern, or make it enforceable. A robust v1 design would refuse ordinary raw writes to membership tables and require generated mutation methods to consume an unforgeable transaction-local authorization witness bound to caller/effective principal, declaration, resource, target row, operation, and relevant old/new role. Define a separate creator witness for first-host bootstrap. Add negative tests for an unguarded handler, check-A/write-B, witness reuse, and old/new-role transition bypass.

3. **The core membership predicate IR is not specified sufficiently to support the claimed composition.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §What exists proposes “a membership predicate node,” while §Rule helpers promises OR across declarations and §Agents shows conjunction with auth-kind expressions. The shipped `QueryPlan` in `src/manifest.rs:1143-1158` is a table plus an implicitly-ANDed `Vec<FilterExpr>`; each filter is only field/operator/`ValueExpr`. `ValueExpr` is a closed scalar expression language and the matcher environment in `src/value_expr.rs:54-67` has no database lookup. The RFC does not define whether membership is a new filter variant, a boolean rule AST, or a `ValueExpr`, nor its canonical serialization, NULL behavior, SQL lowering, or matcher behavior for primary-table changes. Deferring generated authoring spelling to LLP 0004 does not answer the core manifest semantics required by LLP 0037 and LLP 0053’s default-deny walker.
   - **Resolution criterion:** Add a normative Rust-first predicate AST and serialized schema covering logical composition, declaration identity, row-field versus argument resource references, role lists, pending-role semantics, effective-principal resolution, and bounds. Pin SQL/SQLite evaluation and conservative matcher evaluation for both primary-table and membership-table changes. Add schema-drift and matcher-versus-full-query convergence tests.

4. **Retained role-gated reads contradict LLP 0008’s eligibility contract.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** LLP 0008 §Subscription Contract says queries outside its syncable-live subset are online-only or replace-only and are not eligible for retained local results; §Reactivity limits retained local state to analyzable single-table filters. This RFC identifies membership as the first semi-join beyond that subset, says the LLP 0008 extension is follow-on work (§Delivery lanes and §Companion obligations), yet simultaneously claims retained/offline role-gated reads in §Delivery lanes, §Invalidation, and the `[retained]` validation row. LLP 0053 makes an otherwise eligible retained result authorization-safe; it does not supersede LLP 0008’s query-shape eligibility.
   - **Resolution criterion:** Either make the LLP 0008 semi-join/retention amendment part of this RFC’s v1 acceptance and define its capability class, or remove all retained claims and tests until that follow-on lands. `live_replace` by itself must not be treated as retained eligibility.

5. **The uniqueness invariant is not closed over NULL or missing fields.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Declaring requires one row per `(principal, resource)` through a unique composite index but never normatively requires the principal, resource, and role columns to be non-optional and non-null. The current authoring surface permits `v.optional(inner)`, and `FieldManifest` carries an `optional` flag. SQLite and PostgreSQL unique indexes ordinarily allow multiple rows containing NULL in a unique key, defeating exactly-one membership if either axis is nullable.
   - **Resolution criterion:** Reject membership declarations whose principal, resource, or role fields are optional; reject missing/null values on every write path and during activation scans. Define the app-singleton case separately rather than representing it with a nullable resource. Add activation and concurrent-write fixtures for null and missing axes.

6. **`provenance: true` does not provide durable attribution for all authority-changing membership writes.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Agents calls provenance a durable attribution mechanism but fills immutable `grantedBy*` columns only on insert. The RFC makes role change an update and removal a delete. A delegated agent can upgrade an existing membership—potentially its own—from guest to host, or delete another member, after which the row either retains the original creator’s provenance or disappears entirely. LLP 0055’s response attribution block is not a durable log, as that RFC explicitly states.
   - **Resolution criterion:** Record every authorization-relevant insert, role transition, and delete in an append-only transition log containing declaration, principal, resource, old/new role, actor, effective principal, grant, and commit witness. Alternatively, rename the option to creation provenance and refuse delegated role updates/deletes until the durable audit substrate exists. Define provenance identities for seed, import, admin, and system writers.

7. **The public denial payload is a membership-existence oracle.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Rule helpers exposes `callerState: "absent" | "wrong-role"` while asserting that hidden resources and non-public role policy leak nothing. The trusted evaluator deliberately bypasses the membership table’s row-visibility rules. A caller probing a known or guessed resource can therefore distinguish “no membership row” from “a hidden membership row exists with some other or pending role,” even when the application’s member-list policy would hide that fact. This is a private permission fact under LLP 0053’s redaction rule.
   - **Resolution criterion:** Make the public terminal payload invariant across absent, pending, and wrong-role states—such as `{kind: "role"}` or a single `callerState: "denied"`—and keep the distinction only on the gated doctor/audit surface. If an application wants to disclose its caller’s membership state, require an explicit app-visible check governed by that table’s visibility policy. Add byte-identical status/body tests across hidden-resource denial cases.

8. **The `incidental` no-wakeup validation overstates what the conservative matcher can prove.**

   - **Severity:** NON-BLOCKING
   - **Concrete evidence:** The `[live]` matcher validation says an incidental-only update “wakes nothing.” Under the RFC’s own row-field contract, any membership-table write wakes the query. Even for an exact membership lookup, the current matcher treats a changed row that still matches the captured query as affected; it does not prove irrelevance from `changed_fields`. `incidental` can suppress the coarse authorization-version event, but it does not currently suppress result-dependency re-evaluation.
   - **Resolution criterion:** Change the test to assert “no authorization-version advance and no coarse quarantine obligation,” while permitting a conservative matcher re-query, or add a separately specified and convergence-tested field-sensitive dependency optimization.

## 4. Suggestions

- Require explicit stable declaration IDs from the first release. Inferring a rename from one removed table and one added table is inherently ambiguous, while audit and future grant-scope continuity are security-relevant.

- Replace “exact-bytes” with “exact decoded string/scalar-sequence equality.” Two JSON source spellings can decode to the same string, so serialized bytes are not the semantic comparison being requested. Consider rejecting control characters and linting normalization-confusable roles.

- State whether `pendingRoles` is a disjoint extension of `roles` or a subset, and reject overlap and duplicates across the combined vocabulary.

- Generate an authority-transition helper for common invariants such as “do not remove or demote the last host,” while keeping the invariant opt-in because it is application policy.

- Treat membership-changing delegated functions as a distinct “authority-creating” scope class in consent UI and grants. This is more legible than expecting users to infer durable privilege minting from an ordinary mutation name.

- Add a reference-oracle test that evaluates every membership rule by a full SQL semi-join and compares it with matcher skip/re-query decisions, including NULLs, pending roles, role upgrades, and two declarations over one resource type.

## 5. Open questions

- After a terminal denial, is a durable live-query registration retained so that a later grant can wake it, or must the client explicitly resubscribe? What bounds and lifecycle apply to denied registrations?

- Is v1 promising only resource-scope authorization for membership writes, or the full LLP 0011 pre/post-row policy? Which role transitions can application policy restrict?

- Will semi-join queries become retained-eligible in this RFC, or only after the LLP 0008 follow-on? What capability is advertised before then?

- Must every delegated membership mutation carry an explicit authority-creating consent scope?

- Is creation-only provenance useful enough to ship before a full transition ledger, especially when deletion erases the row?

- Should one-role-per-declaration remain the core invariant, or should app-global roles force `multiRole` into v1?

- Who owns cleanup after principal deactivation, terminal principal deletion, and resource deletion, and what happens to active subscriptions while cleanup is pending?

- Are stable declaration IDs mandatory once referenced by audit records, retained-query metadata, or future grant scopes?

## 6. Readiness verdict

The proposal has a strong architectural core and accurately understands much of the shipped substrate, but the unresolved denial, write-enforcement, predicate-IR, retention, uniqueness, provenance, and privacy issues are material correctness and security concerns.

VERDICT: NOT READY
### Orchestrator verification notes — round 4 (not part of the received review)

- The terminal-denial claims are confirmed: `execute_ibex_mutation` propagates handler failure via `?` discarding captures (`src/runtime.rs:222-240`); the server comment says query failures 'can currently discard ctx.db dependency capture' verbatim (`src/server.rs:4647-4650`); subscriptions install only after success (`src/local.rs:2493`) — the revision's 'stale deny caught by read-set validation' claim is mechanically impossible as written.
- `FieldManifest.optional` exists (`src/manifest.rs:248`) — the nullable-axis uniqueness defeat is real.
- The retained-eligibility contradiction with LLP 0008's subset, the insert-only provenance gap, and the callerState existence-oracle were checked against the revision text; all accurately described.

## Round 5 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, effort ultra, read-only, fresh session 019f5f5e-f5bd-73f3-9eb0-8f4c7c01714a; method cli-runner; reviewer barred from llp/reviews/.
**Revision under review:** `llp/0056-…rfc.md`, sha256 `f0355df14cf0d5cac7a497a606f0fe678e52200bf77cd9f0c5ed63c111ee4ac2` (post-round-4)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong and worthwhile direction. Modeling scoped roles as ordinary app data in a system-recognized shape is preferable to session claims or an external policy engine: it preserves application flexibility while giving Snapback enough structure to enforce vocabulary, capture dependencies, explain denials, and participate in authorization invalidation. The alignment with LLP 0039’s `ctx.auth.roles` pin, LLP 0053’s event model, and LLP 0055’s effective-principal semantics is generally careful.

The implementation analysis is unusually honest. The RFC correctly identifies the current single-table `QueryPlan`, the absence of relationship expressions and unique indexes, the precedence of captured dependencies in `src/live_matcher.rs`, and the fact that `CapturedReadKind::Permission` is ignored by both the matcher and commit validation. The proposed ordinary `Query`/`Row` dependency representation, including empty-result capture, is feasible and matches the current machinery.

The RFC is not ready, however. Its central write-safety claim overstates what the specified API enforces; bootstrap is not structurally bound to resource creation; a current HostPlan write path is omitted from the raw-write validation; and the imperative read/denial contract leaves security-relevant semantics unresolved. These are repairable without abandoning the architecture, but they must be resolved before acceptance.

## 2. Strengths

- The decision to keep roles out of real session claims is correct and coherent with the controlling contract. “What stays out of the session” preserves LLP 0039’s exact `roles: []` projection and confines roleful session behavior to dev impersonation.

- “The captured-dependency contract” is grounded in the actual matcher. `src/live_matcher.rs:121-125` gives captured dependencies precedence over static summaries, while `src/live_matcher.rs:173-220` can return a definitive disjoint result after seeing query dependencies. Capturing an empty indexed membership query is therefore genuinely load-bearing, as the RFC says.

- The RFC correctly avoids `CapturedReadKind::Permission`. `src/storage.rs:3122-3235` validates `Row`, `MissingRow`, and `Query` dependencies while ignoring `Permission`, exactly supporting the design’s choice of ordinary database dependencies.

- “Invalidation: the LLP 0053 mapping” is strong. Deriving `permissionBacking`, making inserts and deletes event 1, and placing principal/resource/role/provenance outside the `incidental` escape hatch closes a serious downgrade and room-kick hole.

- “Delivery lanes, honestly” and “The v1 cost, owned” are exemplary scope discipline. The RFC does not confuse `live_replace` with retention eligibility and explicitly accepts the global-version blast radius until a separately proved narrowing exists.

- “Declaring a membership table” gives the primitive sound storage foundations: non-null axes, a true composite unique index, immutable scope axes, closed role vocabularies, and fail-closed activation over existing data.

- “Rule helpers” handles denial privacy well. The invariant `{ kind: "role" }` client payload avoids turning the trusted evaluator into an absent-versus-wrong-role oracle while retaining gated doctor detail.

- “Agents” composes coherently with LLP 0055: effective-principal lookup, grant-scope intersection, `authorityCreating`, durable membership authority, and creation provenance are treated as one combined security model rather than independent features.

- The live validation requirements are unusually good where specified, especially factoring out the coarse authorization event when testing matcher capture and separately covering visible-to-hidden, hidden-to-visible, and denied-at-subscribe behavior.

## 3. Concerns

1. **MATERIAL — The RFC conflates scope binding with LLP 0011’s two-sided write authorization.**

   - **Concrete evidence:** LLP 0011 defines two-sided authorization as evaluating an insert’s new state, both an update’s pre-state and merged post-state, and a delete’s existing state. By contrast, “Declaring a membership table” says immutable axes make the contract two-sided without declarative rules, while “Writes: structural, not conventional” later says those declarative two-sided rules are follow-on work. The shown generated API exposes only caller-authored `require: ["host"]` role lists. It specifies no transition-policy grammar involving actor, target principal, old role, new role, or membership aggregates, yet claims that self-promotion and last-host demotion are expressible. The validation matrix tests guest self-promotion but not last-host demotion/removal. Current code also classifies non-id membership guards as outgrown HostPlan IR (`packages/snapback-codegen/define.mjs:392-401`).
   - **Resolution criterion:** Either rename the v1 guarantee to scope-bound or axis-safe writes, explicitly retain LLP 0039’s `writeAuthorization: "handler"` status, and remove claims that it satisfies LLP 0011’s two-sided contract; or define a closed transition-policy surface with pre/post semantics, actor/effective/target inputs, aggregate-read capture, concurrency behavior, and validation for self-promotion, last-holder demotion, and last-holder removal.

2. **MATERIAL — Bootstrap is not structurally tied to creation and can reopen on an existing resource.**

   - **Concrete evidence:** “Writes: structural, not conventional” makes `{ bootstrap: true }` valid whenever no membership row exists for the resource. That condition is also true for an existing orphaned/imported resource and after the final membership is removed. It therefore does not support the next sentence’s claim that another user cannot bootstrap into an existing resource. The text also calls this “first-host” bootstrap without normatively fixing which declared role is assigned. The deferred “exactly-once property” and validation requirement merely repeat the no-memberships condition; they do not test an existing empty resource, last-member removal, or concurrent different-principal attempts.
   - **Resolution criterion:** Require an unforgeable same-transaction witness that the exact resource underwent absent-to-inserted creation in this mutation, bind the server-derived effective principal and declaration-configured bootstrap role to that witness, and make the capability single-use. Add adversarial tests for an existing zero-member resource, deletion of the last membership, imported orphan resources, wrong requested roles/principals, and concurrent bootstrap attempts by different principals.

3. **MATERIAL — The raw-write prohibition does not explicitly close the current HostPlan path.**

   - **Concrete evidence:** The RFC says membership invariants are enforced for “every writer,” explicitly including HostPlan, and says the table is written only through generated methods or privileged writers. Yet the normative refusal and validation mention only raw `ctx.db` insert/update/delete. HostPlan role enforcement and the declaration-bound HostPlan membership step are both non-goals. Today HostPlan `Insert`, `Patch`, `Delete`, `DeleteWhere`, and `InsertEach` reach generic table writes in `src/storage.rs:1165-1404`; corresponding authoring helpers exist in `packages/snapback-codegen/define.mjs:330-371`. A `ctx.db`-only gate could therefore pass the stated validation while leaving a real unprivileged writer.
   - **Resolution criterion:** Pin one central writer-class-aware enforcement seam below both buffered Ibex writes and HostPlan execution. Until the trusted membership HostPlan step exists, every generic HostPlan write form targeting a membership table must fail typed, including nested action-to-mutation and dry-run paths. Add positive tests for explicitly privileged seed/import/admin/system writers and negative tests for every generic HostPlan write form.

4. **MATERIAL — The public `ctx.permissions.<declaration>.get()` contract is unresolved and conflicts with the visibility/oracle story.**

   - **Concrete evidence:** “Rule helpers” exposes `get()` as an application-returning operation, while “Trusted policy evaluation” says its storage lookup deliberately bypasses membership-table visibility. The denial discussion then says membership existence must not be exposed and directs intentional disclosure through an ordinary visibility-governed read. “Open Questions” still asks what `get()` returns. If it returns a row, role, or present/absent distinction, a handler can directly return the private fact obtained through the bypass. The RFC honestly places arbitrary handler output in the app trust domain, but that does not make the contract of a blessed security helper reviewable or safe by default.
   - **Resolution criterion:** Before acceptance, either remove public `get()` from v1 and keep the captured lookup as an internal primitive used by generated authorization sugar, or specify a minimal return type, its visibility and serialization rules, its app-trust implications, and protected-profile behavior. The validation matrix must cover attempts to expose hidden absent/wrong-role/pending distinctions through this API.

5. **MATERIAL — The trusted denial path leaves a controlling LLP 0053 witness requirement open and does not validate capture survival.**

   - **Concrete evidence:** LLP 0053 requires a terminal denial to carry a coherent authorization/data witness; when resolving an obligation, its observed commit version must satisfy the obligation floor. The target’s “Stale checks” correctly notes that the shipped runtime discards captured reads on handler failure, but “Protocol obligations deferred to implementation” leaves “what witness it carries” and denial linearization undecided. The base validation tests an unsuccessful membership read against the commit-validation representation, even though `requireRole` denial commits nothing; the live validation tests waking and termination but not that the captured lookup survives terminalization into a current denial proof.
   - **Resolution criterion:** Pin the inherited semantic minimum now: terminalization preserves the membership lookup’s snapshot-bound dependency, produces a coherent authorization/data witness, and, during obligation resolution, cannot discharge a floor newer than that witness. Add an end-to-end revocation test proving that the role denial names at least the causing data version, plus concurrent grant/revoke and stale-proof tests showing that ordinary handler-error capture disposal cannot erase or misbrand the authorization read.

## 4. Suggestions

- Model resource creation as a one-shot, unforgeable capability returned by the host insert operation and consumed by bootstrap. This would make “same transaction” and “exactly once” structural rather than temporal conventions.

- Use the same one-shot proof pattern for authorized membership transitions: a generated policy check produces a declaration/resource/target/old/new-bound token consumed by exactly one generated write. That would make witness non-reuse testable and prepare a clean bridge to future declarative write rules.

- Replace table-name-derived “stable” declaration IDs with an ID generated and committed when the declaration is first created. At minimum, clarify that an unpinned rename diagnostic is activation-blocking once an ID is referenced by rooms, audit history, or durable metadata.

- Add a writer/surface matrix covering Ibex query, Ibex mutation, action, HostPlan, generated direct reads, live subscriptions, retained reads, seed, import, admin, and system. The current prose distributes these rules across several sections.

- Define the semantic predicate algebra before fixing its serialized encoding. It should explicitly distinguish row-scoped semi-joins, argument-scoped function gates, AND/OR composition, and declaration identity; otherwise “ordinary rule-level OR” is difficult to assess against the current implicit-AND `FilterExpr` model.

- Extend the proposed matcher reference oracle with property-based race generation over insert, delete, role transition, wrong-role rows, empty results, and pruned change history. Compare both matcher wake decisions and commit-conflict decisions against the same full semi-join oracle.

- Specify provenance columns as an explicit tagged union rather than mixing principal IDs, grant IDs, nulls, and values such as `seed` or `hostOps:<verb>` without a pinned type.

## 5. Open questions

- Which membership invariants are platform-enforced—such as “there must always be a host”—and which are entirely application policy?

- What is the authoring and execution model for transition policies involving the target principal, old/new roles, and aggregates such as host count?

- Is bootstrap permitted only during absent-to-present resource creation, and which role is the declaration’s bootstrap role?

- Does v1 need a public membership lookup at all, or only a captured internal decision primitive plus `requireRole`?

- What exact snapshot and obligation-floor witness does a membership-derived terminal denial carry?

- How are resource deletion, principal termination, last-membership removal, import, and restore expected to interact with membership lifecycle and bootstrap?

- Is one role per principal/resource acceptable for the first reference applications, especially for app-global roles, or should the schema anticipate multi-role membership now?

- What migration mechanism preserves declaration identity across table renames and declaration splits or merges?

- Should the first implementation phase land only schema/write enforcement and imperative checks, with declarative semi-joins and protected-room binding gated on their implementing specs and LLP 0053 landing items?

## 6. Readiness verdict

The proposal’s architecture is promising and its invalidation analysis is strong, but the write contract, bootstrap authority, writer coverage, public lookup semantics, and denial witness path contain unresolved material gaps. Acceptance now would bless claims that the specified API and validation suite do not yet enforce.

VERDICT: NOT READY
### Orchestrator verification notes — round 5 (not part of the received review)

- **Verified:** HostPlan generic write forms (`Insert`/`Patch`/`Delete`/`DeleteWhere`/`InsertEach`) reach generic table writes (`src/manifest.rs:1236-1243`, `packages/snapback-codegen/define.mjs:330-371`), so the round-4 `ctx.db`-only raw-write gate did leave a real writer open — the finding is exact.
- The two-sided overclaim, the emptiness-bound bootstrap, the public `get()` oracle, and the denial-witness gap were each verified against the round-4 text.

## Round 6 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, effort ultra, read-only, fresh session; method cli-runner.
**Revision under review:** `llp/0056-…rfc.md`, sha256 `11f3cd9c6ff66289543a6436ffc4daa02e02548ae57dff7dd04caf67185773db` (post-round-5)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

The core proposal is a good idea. Modeling roles as ordinary application data in a system-recognized `(principal, resource, role)` shape is a strong middle ground between stale session claims and a general authorization graph. The immutable axes, closed vocabulary, generated unique index, matcher-visible reads, and automatic LLP 0053 invalidation participation fit Snapback’s local-first architecture well.

The RFC also describes the current implementation accurately. `src/value_expr.rs` has no relationship/`EXISTS` expression, `TableManifest` and `IndexManifest` in `src/manifest.rs` lack membership and uniqueness metadata, `src/schema_export.rs` confirms the Rust-first generated-schema boundary, and the current package authoring surface has no membership or `ctx.permissions` API. Its matcher analysis is especially sound: `src/runtime.rs::capture_query_read` records empty query dependencies, `src/live_matcher.rs::live_subscription_may_be_affected_by_dependencies` honors row/query dependencies, and `src/storage.rs::validate_captured_read_set` ignores the legacy `Permission` kind exactly as the RFC says.

However, several authorization semantics remain open or internally inconsistent rather than merely implementation-detailed. In particular, the generated methods do not yet define a safe transition policy, the system sweep is an unrestricted role-management bypass, creation-only provenance cannot attribute later authority-creating transitions, and resource deletion can leave live authorization facts. The existence-oracle protections also need a runtime boundary and measurable validation, not only generated typing and an undefined timing envelope. These are material issues, so the proposal is not ready in its current form.

## 2. Strengths

- **§Summary and §Declaring a membership table:** Keeping roles in live app data rather than real-session claims correctly preserves LLP 0039’s `roles: []` rule and avoids session-baked authorization staleness.

- **§Declaring a membership table:** Required non-null axes, exact role values, a true unique `(principal, resource)` index, and immutable principal/resource columns form a coherent and enforceable base model.

- **§Writes: structural, not conventional:** The writer-class inventory correctly notices that HostPlan mutations and buffered Ibex writes are distinct paths today. The refusal of all generic HostPlan membership writes is safer than pretending the current id-only `Get` and app-supplied `Guard` can enforce membership administration.

- **§What exists, what this adds and §Rule helpers:** The RFC correctly identifies the current matcher’s load-bearing behavior. Successful, missing, and wrong-role lookups need ordinary row/query capture; using `CapturedReadKind::Permission` would indeed be ineffective in both the matcher and commit-time validation.

- **§Invalidation: the LLP 0053 mapping:** Deriving `permissionBacking`, protecting principal/resource/role/provenance from `incidental`, and accepting the global authorization-version blast radius are coherent with Accepted LLP 0053. The independent matcher-path validation is particularly valuable because it prevents the coarse event from masking broken dependency capture.

- **§Rule helpers:** The invariant denial payload and the distinction between an empty live result and a terminal denied subscription are thoughtful, security-relevant decisions.

- **§Optimistic/offline parity and §Non-Goals:** Deferring retained role-gated reads until the LLP 0008 semi-join amendment is honest. The current single-table retention grammar cannot support the proposed relationship predicate safely.

- **§Protocol obligations deferred to implementation:** Calling for a normative Rust-first AST, SQL/matcher convergence oracle, denial linearization, and transaction-local write witnesses follows LLP 0037’s source-of-truth rules and targets the right implementation risks.

## 3. Concerns

1. **The generated write API does not define a structural role-transition policy.**

   **Severity: MATERIAL.**

   **Concrete evidence:** §Writes exposes `insert`, `setRole`, and `remove` with a caller-supplied `{ require: [...] }`, but defines no declaration-level matrix over operation, caller role, target principal, old role, and new role. The pinned list of facts the method can see omits the target principal, yet the section claims it is enough for “a guest cannot promote themselves.” The validation requirement repeats that outcome without specifying the policy that produces it. This also leaves no structurally safe invitation-acceptance operation: allowing an `"invited"` caller to invoke `setRole(..., "guest", {require:["invited"]})` would let one invitee operate on another invitee’s row unless a hand-written handler separately checks target-principal equality. That reintroduces the conventional handler check the structural API is meant to replace.

   **Resolution criterion:** Either define a minimal host-enforced transition policy in the declaration—covering non-empty caller-role requirements, self-versus-other targeting, and permitted old-role/new-role transitions—or narrow the v1 claim to resource-axis binding only and add explicit safe operations such as `acceptOwnInvitation`. The transaction witness must include the target principal, and validation must name the configured transition policy being tested.

2. **The “system sweep” is an unrestricted system-authority role-management bypass, and its interaction with `lastHolder` is undefined.**

   **Severity: MATERIAL.**

   **Concrete evidence:** The writer matrix permits any system-authority cron to call both `systemRemove` and `systemSetRole` without a role requirement. §Time-bounded memberships says only that app code reads the timeout before calling the method; the host does not bind the effect to a declared expiry field, an expired value, a specific cron capability, or a non-authority-increasing transition. Consequently, a buggy system cron can promote arbitrary principals to `"host"` or remove arbitrary memberships. Meanwhile, `lastHolder` is called a declaration-level invariant, but the matrix and validation do not state whether system, admin, seed, or import writers honor it. An expiring final protected holder therefore either remains authorized indefinitely or strands the resource, depending on an unstated precedence rule.

   **Resolution criterion:** Replace the generic sweep bypass with a narrowly specified operation such as `systemRemoveIfExpired(rowId, expectedVersion)`, tied by the host to a declared expiry field and authoritative time, or explicitly classify system membership management as fully privileged and revise the safety claims accordingly. Remove or separately justify `systemSetRole`. Provide an invariant matrix for every writer class and pin the interaction between expiry and `lastHolder`, with negative tests for early expiry, promotion, cross-declaration access, and final-holder removal.

3. **Creation-only provenance contradicts both the writer matrix and LLP 0055’s authority-creating composition.**

   **Severity: MATERIAL.**

   **Concrete evidence:** §Agents says `grantedByActor`, `grantedByEffective`, and `grantedByGrant` are immutable and written only on insert. Yet §Writes says `systemRemove` and `systemSetRole` stamp system provenance; an update cannot stamp immutable creation fields, and a deletion leaves no row. More importantly, a delegated agent can upgrade an existing membership from `"guest"` to `"host"`. That operation creates durable authority which survives grant revocation, but the row continues to attribute only its original creation—possibly to an unrelated human. LLP 0055 §Grants says delegated durable membership writes persist attributably under `authorityCreating`; the proposed behavior does not satisfy that claim. The end-to-end validation only tests inserting a new host row, so it misses the upgrade case.

   **Resolution criterion:** Record attribution for every authority-relevant transition, not only row creation. This can be an append-only transition ledger, or separate creation and current-role-grant attribution fields updated atomically with `setRole`; deletion still needs a durable record. If that substrate is deferred, delegated and system role changes must be excluded from v1 rather than represented by misleading creation provenance. Add tests for delegated low-role-to-high-role upgrades, system transitions, downgrades, and deletes.

4. **Resource lifetime and bootstrap are not authorization-closed.**

   **Severity: MATERIAL.**

   **Concrete evidence:** Roster handling for deleted resource rows is left as an open hygiene question, while the helpers authorize solely from the membership table. A surviving membership can therefore authorize related data after the resource row is gone, or become active again if the same resource identity is restored or imported. The bootstrap witness only proves that an insert occurred in the mutation; it does not require the resource to exist in the merged commit state. That matters in the current implementation because `src/runtime.rs` buffers `db.insert` and `db.delete`, and `src/storage.rs` applies the buffered sequence at commit: a mutation can insert a resource, consume its bootstrap witness, then delete the resource while leaving the membership row. The declaration semantics also never pin whether `bootstrapRole` is required or optional, whether it must be a non-pending role, or which “named role” `lastHolder: "protect"` protects.

   **Resolution criterion:** Require bootstrap commit validation to prove that the exact resource row still exists in the merged post-state and belongs to the same resource incarnation. Pin resource-deletion behavior: cascade memberships, tombstone/rotate a resource incarnation included in membership identity, or require resource existence during every authorization evaluation. Define the semantic configuration and constraints for `bootstrapRole` and protected holder roles. Validate insert→bootstrap→delete in one mutation, delete/recreate or import with the same id, and cleanup of the final holder.

5. **The internal membership lookup’s non-observability is asserted but not protected by a runtime validation.**

   **Severity: MATERIAL.**

   **Concrete evidence:** §Rule helpers says a `DatabaseCaptured` host operation performs the lookup, generated sugar observes its outcome, and no application-returning form exists. §Validation only requires that attempts to surface the result “do not compile.” TypeScript surface omission is not an authority boundary for JavaScript, `any`, aliases, or computed access. Accepted LLP 0053 explicitly requires the authoritative host gate to cover dynamically reached operations and treats aliases/computed access as adversarial fixtures. The current runtime provides a viable implementation boundary—`packages/snapback-harness/ctx-bootstrap.js` keeps `host` closure-private while constructing `ctx`—but this RFC does not require the `requireRole` composition to live inside that trusted closure rather than generated application-realm code.

   **Resolution criterion:** Pin that only a sealed host/harness closure receives the lookup result and that the handler can invoke only an operation returning success-or-terminal-denial, never the intermediate fact. Add runtime adversarial tests for `any`, reflection, aliases, computed properties, direct transport attempts, monkey-patching, and caught denial; a compile-time test may remain as ergonomics but cannot be the security proof.

6. **“Equivalent timing envelope” is not a testable security criterion.**

   **Severity: MATERIAL.**

   **Concrete evidence:** §Validation requires an index miss and a row-read-plus-role-compare to be indistinguishable to a prober, but defines no attacker model, request budget, percentile or statistical bound, environmental controls, or mitigation. SQLite cache state, row decoding, and response serialization naturally make those paths perform different work. Byte-identical status and body are testable; “equivalent timing envelope” currently is not, so the validation cannot determine whether the existence oracle is actually closed.

   **Resolution criterion:** Specify a timing-side-channel threat model and a concrete mitigation—such as equalized query shape plus fixed minimum response scheduling—and define a measurable statistical acceptance bound under controlled cold/warm-cache conditions. Alternatively, remove the indistinguishability guarantee, document timing as a residual risk, and specify compensating rate limits and probe detection.

## 4. Suggestions

- Add a normative writer/invariant table showing, for every writer class, whether vocabulary, uniqueness, immutable axes, transition policy, `lastHolder`, expiry eligibility, provenance, and authorization-version advancement apply.

- Consider named declarative operations such as `invite`, `acceptOwnInvite`, `grantRole`, `revokeRole`, and `leave` rather than making every handler assemble policy from `setRole` plus a runtime `require` array.

- Give each resource an authorization incarnation and bind membership rows and bootstrap witnesses to it. This prevents stale memberships from reviving after delete/recreate or selective import.

- Keep transition audit data in a protected append-only companion table. That avoids mixing sensitive audit facts into ordinary membership rows and gives deletes a durable trace.

- Define the field projection of the “members see the member list” preset. Current queries return whole documents, so excluding pending-role rows alone would still expose generated provenance and arbitrary auxiliary columns unless projection is added or those facts move to a companion table.

- Add a model-based state-machine suite over writer authority, operation, old/new role, target relationship, resource lifecycle, and concurrent commits. This would exercise combinations that individual acceptance examples are likely to miss.

## 5. Open questions

- What is the minimum safe v1 transition language, especially for accepting one’s own invitation without gaining power over peers?

- Is system authority intended to be a fully privileged membership administrator, or a narrowly capability-bound maintenance principal?

- Which role or roles does `lastHolder` protect, and what happens when the final protected membership expires?

- Must membership authorization require a currently existing resource row, and how are delete, restore, and import identities distinguished?

- Does `authorityCreating` require attribution of the transition that created the current authority, or is creation attribution considered sufficient despite later promotion?

- Where exactly does the private lookup-to-denial composition execute, and how is its intermediate result kept outside the application realm?

- What fields does the member-list preset expose, particularly when `provenance: true` or auxiliary authorization columns are present?

- What concrete timing adversary and statistical threshold is the denial-oracle requirement intended to address?

## 6. Readiness verdict

The recognized membership abstraction and invalidation mapping are strong, but the v1 write, system-authority, provenance, resource-lifecycle, and denial-oracle contracts still contain material security and coherence gaps. These need semantic resolution before implementation mechanics alone can safely fill in the design.

VERDICT: NOT READY
### Orchestrator verification notes — round 6 (not part of the received review)

- **Verified:** cron entries must be `FunctionKind::Action` (`src/cron.rs:954`), and this RFC refuses `ctx.permissions` in actions — so the round-5 sweeper was reachable only via action→`ctx.runMutation`, exactly as the Claude family described.
- Both families converged on the same root cause: the caller-supplied `{ require: [...] }` grammar could not express leave / accept-invite / decline without a hand-written target-principal check (the convention the structural API exists to replace), and it left `systemSetRole` as an unbounded system-authority role-management bypass.
- Round 6 settles the write surface in one pass: a declaration-level **transition matrix** (op × caller role × self/other × from → to), closed by default, with the target principal in the host's witness; a host-bound `sweepExpired()` replacing the general system API; and `provenance: "full"` (an append-only transition log) so kicks and downgrades stay attributable.

## Round 7 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, effort ultra, read-only, fresh session; method cli-runner.
**Revision under review:** `llp/0056-…rfc.md`, sha256 `0d07c9193e402532a28cce5e6cf93cbb12dd30b59a0b382717513e8235fd8bc9` (post-round-6)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong proposal with the right core idea: roles remain application data, while a system-recognized membership shape supplies the structure needed for reliable authorization, invalidation, diagnostics, and protected-room enforcement. The design is appropriately narrower than general RBAC or Zanzibar, and it is unusually candid about v1 limitations and global invalidation cost.

The RFC is also largely coherent with LLP 0011, 0039, and 0053. It preserves real-session `ctx.auth.roles: []`, does not overclaim LLP 0011’s full two-sided write rules, uses 0053’s ordinary captured dependencies rather than the ignored legacy `Permission` kind, and retains trusted-denial witness requirements. These claims match the implementation: `src/live_matcher.rs` gives captured query dependencies precedence and captures empty query results; `src/storage.rs` validates `Row`, `MissingRow`, and `Query` but ignores `Permission`; and the current manifest, value-expression, schema, and codegen surfaces indeed lack membership relationships, unique indexes, and permission host operations.

It is not ready, however. Several security-relevant semantics remain undefined, and the LLP 0055 composition contains a direct contradiction. These are specification issues that cannot safely be left to the implementing protocol document.

## 2. Strengths

- **System-recognized application data is the right abstraction.** The distinction in §Summary and §Global roles preserves app ownership while giving Snapback enough structure to own revocation correctness.

- **The session-role boundary is correct.** §What stays out of the session accurately preserves LLP 0039’s rule that real sessions have empty role claims and confines `--as-role` to dev impersonation.

- **The writer-class analysis is excellent.** §Writes identifies raw Ibex writes, every generic HostPlan form, system authority, direct-runner `adminBypass`, seed/import/admin paths, and future adapters. Refusing generic HostPlan membership writes is consistent with the actual id-only `Get` and app-coded `Guard` surface.

- **The RFC does not misrepresent its write guarantee.** §Writes explicitly calls the result axis-safe and scope-bound rather than claiming LLP 0011’s full pre-state/merged-post-state enforcement.

- **The matcher analysis is accurate and load-bearing.** §What exists, what this adds correctly observes that `src/live_matcher.rs` can stop after captured-dependency disjointness, that empty HostPlan queries still receive a `Query` dependency, and that `CapturedReadKind::Permission` is ignored by both matcher and commit validation.

- **Denial handling is carefully decomposed.** §Rule helpers uses one `DatabaseCaptured` lookup followed by the existing `TerminalAuthorization` operation, preserves denial capture, minimizes the public payload, and correctly distinguishes denied-at-subscribe from empty-at-subscribe.

- **The LLP 0053 mapping is disciplined.** §Invalidation correctly derives `permissionBacking`, protects principal/resource/role from `incidental`, treats downgrades as room kicks, defers retained role-gated reads, and owns the coarse global-version cost.

- **The validation plan covers many realistic bypasses.** §Validation Requirements includes HostPlan variants, nested action calls, dry-run, empty lookups, hidden-to-visible changes, denial races, forged denials, impersonation ambiguity, privileged writers, and room suspension.

## 3. Concerns

1. **The scoped resource relationship is neither normatively defined nor representable.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Declaring a membership table uses `v.id("events")`, while `.membership()` names only `resource: "eventId"`. §What exists, what this adds and §Companion obligations add `v.principal()` but do not add or define a nominal resource-target descriptor. In the implementation, `packages/snapback-codegen/define.mjs` has no `v.id`; `FieldType` in `src/manifest.rs` reduces fields to `String`, `Boolean`, `Integer`, `Real`, or `Json`; and `TableManifest` carries no relationship metadata. Consequently, the host cannot determine that `eventId` refers to `events`, prove that a bootstrap witness came from inserting the correct resource table, or type-check a row-field/argument resource reference against the declaration. The lifecycle is also unresolved: §Writes permits orphan memberships after resource deletion, but IDs are ordinary strings with no foreign-key enforcement, so “IDs are never reused” does not prevent an orphan membership from authorizing surviving or subsequently written rows carrying that resource ID.
   - **Resolution criterion:** Define a Rust-first, generated resource-target descriptor—nominal `Id<table>` metadata or an explicit `resourceTable`—including the app-scope exception. Require exact resource-type matching for helpers, room bindings, and bootstrap. Pin whether resource deletion cascades membership deletion, makes helpers fail for absent resources, or intentionally leaves ID-scoped authority. Require a bootstrap resource to remain present in the transaction’s merged post-state, and add wrong-table, insert→bootstrap→delete, orphan-child, and resource-deletion tests.

2. **The LLP 0055 provenance contract contradicts this RFC.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Agents says LLP 0055 requires `provenance: "full"` and explains why creation-only provenance is insufficient for deletes and downgrades. LLP 0055 §Grants and its validation requirements require only that the target table declare `provenance`, which includes `"creation"` under this RFC. This RFC’s own §Validation Requirements likewise tests only that a table “without `provenance`” refuses `authorityCreating`; it lacks a negative fixture for `provenance: "creation"`. An implementer following LLP 0055 could therefore accept creation-only provenance while this RFC claims durable transition attribution.
   - **Resolution criterion:** Amend LLP 0055 and this RFC’s validation language to require exactly `provenance: "full"` for every LLP 0056 membership table reached by an `authorityCreating` function, with an explicit rejection test for `"creation"`. Alternatively, retract the stronger requirement and revise the claimed accountability guarantee.

3. **`lastHolder` is not specified as a transaction-level invariant.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Writes calls `lastHolder` a table invariant enforced for every writer, but defines only refusal of “any transition” removing or demoting the final holder. It never says whether a multi-write transaction is judged operation-by-operation or against its merged post-state. This matters because LLP 0003/0004 and `src/storage.rs` support atomic multi-write mutations, while reset plus seed is also one atomic replacement. Replacing one host with another can succeed or fail depending on write order under an intermediate-state interpretation; resource deletion, reset/import, and bulk admin changes have no defined behavior; and a resource beginning with zero holders is not covered despite the “never strand” gloss. The validation plan tests a sequential final-holder removal but not concurrent distinct-holder demotions or order-independent batch replacement.
   - **Resolution criterion:** State a formal pre-state/post-state invariant, including whether it applies only to resources present in the post-state and whether zero-holder creation/import is legal. Require evaluation over the complete merged write batch, independent of operation order, at the serialized commit boundary. Add concurrent two-holder demotion/removal, replacement-holder permutations, resource deletion, reset/seed, import, and initially-zero-holder fixtures.

4. **Security-sensitive declaration IDs lack a collision and reuse contract.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Declaring a membership table permits an explicitly pinned stable ID and uses it for helpers, doctor traces, audit, room bindings, and future durable references. Multiple declarations are supported, but the RFC never assigns IDs an app-global namespace, rejects duplicate pinned IDs, or defines whether a removed ID may be reused. §Validation Requirements has no collision fixture. A collision can make a room binding or audit record resolve to the wrong declaration.
   - **Resolution criterion:** Declare membership IDs app-global and collision-checked at activation, specify allowed syntax and reserved namespaces, and define deletion/reuse behavior for audit and future durable references. Add duplicate-default, duplicate-pinned, rename, removal/reintroduction, and schema-drift tests.

5. **Downgrade-on-expiry is not idempotent as specified.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Writes allows `onExpiry` to downgrade to a role but neither consumes/clears the expiry nor says that a row already in the target role is skipped. The row remains expired, so every cron run may repeat the downgrade. Today `patch_document` in `src/storage.rs` updates `_version` and records a change whenever a nonempty patch targets an existing row, even when the value is unchanged. Under this RFC, repeated writes would append provenance entries, advance authorization state, and globally quarantine auth-scoped subscriptions indefinitely.
   - **Resolution criterion:** Pin the sweep as idempotent: after one downgrade, another sweep with no intervening relevant change must perform no write, version advance, authorization event, or provenance append. Also decide whether later promotion with the old expired timestamp immediately re-expires or must replace/clear that timestamp, and test both repeated sweep and re-promotion behavior.

## 4. Suggestions

- Specify that a generated unique membership index uses `CREATE UNIQUE INDEX` without the `_id` suffix currently appended by `src/storage.rs::create_index`; otherwise the physical index would not enforce pair uniqueness.

- Normalize each transition matrix into a finite decision table during generation and exhaustively test every combination of operation, caller state, self/other, old role, and new role. This would make closed-by-default behavior easy to model-check and explain.

- Bound role vocabulary size, transition count, role-string length, and generated predicate size. These declarations enter trusted manifest and matcher paths and should inherit the repository’s explicit bounded-work posture.

- Require the transition log, membership write, authorization-version change, and provenance attribution to fail or commit atomically. Include fault injection between each conceptual step.

- Add a doctor view that renders the normalized transition matrix and explains which clause matched or why none did, while retaining the invariant public denial.

## 5. Open questions

- Is the resource scope an existing-row relationship, a nominal ID namespace, or merely an arbitrary scoped token? What should happen when the resource disappears?

- Does `lastHolder` mean “never transition from at least one holder to zero,” or “every extant resource must always have a holder”?

- Should `provenance: "full"` be mandatory for all membership tables, rather than only those currently reachable through `authorityCreating`, to avoid later activation surprises?

- Are membership declaration IDs permanently reserved after use, especially once audit records or grant scopes reference them?

- Should expiry be represented as a consumed state or generation rather than a timestamp that remains true forever?

- Does one-role-per-principal/resource have enough reference-app evidence to freeze the unique-pair storage shape, or should multi-role be settled before the schema becomes durable?

- What measured global-quarantine rate would trigger declaration-scoped narrowing before memberships are recommended broadly?

## 6. Readiness verdict

The proposal’s central direction is good, and its alignment with LLP 0011, 0039, and 0053 is mostly sound. It is not ready because resource binding/lifecycle, transaction-wide holder protection, declaration identity, and expiry semantics remain unsafe or ambiguous, while the sibling LLP 0055 provenance requirement directly disagrees with this RFC.

VERDICT: NOT READY
### Orchestrator verification notes — round 7 (not part of the received review)

- **Both families independently found the `lastHolder` linearization defect:** it is decided by an *aggregate* (the remaining holders of the protected role), and LLP 0004's ratified model runs handlers concurrently with only the commit serialized — so two concurrent removals of the final two hosts each see the other present, both pass, and the resource strands with zero hosts. Round 7 pins the holder-set read as a snapshot-bound range dependency validated at commit, the same machinery uniqueness and the stale-role check already ride.
- The expiry sweep's `downgradeTo` was non-idempotent (a downgraded row keeps a past `expiresAt` and is re-swept forever); the sweep now clears the field.
- The cross-declaration limitation (an app-global moderator resolves to `by: "none"`, so 'a moderator may kick from any channel' is unspellable in v1) is named rather than left to be discovered at authoring time.

## Round 8 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, effort ultra, read-only, fresh session; method cli-runner.
**Revision under review:** `llp/0056-…rfc.md`, sha256 `7591a4871dbe62e394f25d1804cde7df9b8bf0b0a5d247f405b112ab4b04af7f` (post-round-7)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong proposal with the right architectural instinct: memberships should remain ordinary application data while gaining a system-recognized shape that Snapback can analyze, invalidate, audit, and enforce. That fits LLP 0011’s rule model, preserves LLP 0039’s `ctx.auth.roles` restriction, and uses LLP 0053’s authorization-version and witnessed-delivery machinery rather than inventing a parallel revocation system.

The RFC is unusually honest about current implementation limits and v1 tradeoffs. Its captured-dependency analysis matches the shipped matcher, its writer-class matrix closes several obvious bypasses, and it explicitly avoids claiming full two-sided write RLS. The coarse global invalidation cost, retained-result deferral, dev-impersonation seam, and LLP 0055 composition are all handled thoughtfully.

It is not ready, however. Core transition semantics are ambiguous in a way that can change authorization outcomes; resource deletion can leave orphan memberships as live authority; the trusted-denial state machine leaves observable security semantics open; and the durable identity/provenance promises lack a reset, retention, and restore model. The `lastHolder` and expiry-sweep contracts also need stronger progress and concurrency requirements. These are repairable, but they must be resolved before acceptance.

## 2. Strengths

- **The central abstraction is sound (§Summary, §Motivation).** “App data in a system-recognized shape” avoids stale session claims while giving Snapback enough structure to enforce revocation across queries, rooms, and retained state.

- **The writer boundary is appropriately structural (§Writes: a declared transition policy).** Generated methods, immutable axes, a closed transition matrix, HostPlan refusal, and a creation-bound bootstrap witness are materially safer than handler conventions or caller-supplied authorization requirements.

- **The RFC accurately limits its relationship to LLP 0011 (§What v1 delivers).** It explicitly preserves LLP 0039’s `writeAuthorization: "handler"` narrowing and does not mislabel the transition matrix as full pre/post-state RLS.

- **The implementation inventory and capture analysis are accurate (§What exists, what this adds; §Captured-dependency contract).** `QueryPlan` remains single-table, `ValueExpr` has no relationship form, and manifests lack membership and unique-index metadata (`src/manifest.rs:226`, `src/manifest.rs:1143`, `src/manifest.rs:1260`). The matcher gives captured dependencies precedence and ignores `Permission` dependencies, as stated (`src/live_matcher.rs:164`; `src/storage.rs:3130`). Empty-result query capture is correctly identified as essential to hidden-to-visible transitions.

- **The LLP 0053 mapping is strong (§Invalidation).** Deriving `permissionBacking`, defaulting authorization fields conservatively, forbidding the principal/resource/role/provenance floor from `incidental`, and measuring the global blast radius all follow the Accepted parent contract.

- **The session and agent composition is coherent (§What stays out of the session; §Agents).** Real sessions retain `roles: []`, scoped impersonation becomes real seeded data, delegated agents evaluate the effective user’s membership, and durable authority creation requires explicit consent plus full provenance.

- **The validation plan is adversarial rather than merely demonstrative (§Validation Requirements).** It includes writer bypasses, empty captures, denial-oracle checks, room downgrade kicks, coarse-event isolation, and cross-principal agent cases.

## 3. Concerns

1. **Severity: MATERIAL — The transition grammar has ambiguous and colliding authorization classes.**

   **Evidence:** In §Writes, `by` may contain ordinary role strings or the special strings `"self"` and `"none"`, while §Declaring a membership table permits arbitrary exact-decoded roles except control characters and does not reserve either name. A real role named `"none"` is therefore indistinguishable from an unaffiliated caller, and a role named `"self"` collides with identity relation. The semantics are also internally unclear: `target` already records `self|other`, yet the RFC says `"self"` is the only way to authorize a self-transition. It does not settle whether a host changing their own row satisfies `by: ["host"], target: "self"`, or whether an unaffiliated caller inserting their own row simultaneously satisfies both `"none"` and `"self"`. The statement that anonymous `adminBypass` matches no transition further implies that `"none"` excludes a null principal, but the `by` definition does not say so.

   **Resolution criterion:** Replace these untagged strings with a tagged, non-colliding grammar and give it a normative truth table. Prefer separating actor affiliation from target relation—for example, caller roles or `unaffiliated` on one axis and `self|other` on another. Explicitly define precedence/overlap, pending-role behavior, and null-principal rejection. Add manifest and execution tests covering roles literally named `self`/`none`, unaffiliated self-insert, roleful self-transition, pending callers, and anonymous callers.

2. **Severity: MATERIAL — Deleted-resource memberships remain live authority, not merely “roster hygiene.”**

   **Evidence:** §Writes explicitly allows memberships to become orphaned when their resource row is deleted. The generated helpers in §Rule helpers authorize from the membership lookup alone; no resource-existence witness is required. Consequently, `hasRole(deletedResourceId, "host")` can remain true, including for a protected room keyed by that ID. Resource deletion itself is not a membership event, so §Rooms’ downgrade/delete kick path need not run. The problem is compounded by `lastHolder`, which refuses removal of the final protected membership for every writer class: an orphaned final host may be impossible to clean up under the stated invariant. Normal generated inserts also have no explicit requirement that the referenced resource currently exists.

   **Resolution criterion:** Pin resource-lifecycle semantics. For scoped declarations, either make orphan memberships authorization-inert by requiring a captured resource-existence fact, or require an atomic generated teardown that deletes the resource and its memberships while suspending rooms. Define whether `lastHolder` is waived only when the resource is removed in the same transaction, and require normal membership insertion to witness an existing resource. Validate query gates, imperative gates, rooms, concurrent resource deletion, old resource IDs, and orphan cleanup.

3. **Severity: MATERIAL — A linearization-failed denial’s treatment of the registration is security semantics, not an implementation detail.**

   **Evidence:** §Rule helpers correctly observes that the shipped runtime loses captured reads on handler failure, then defers both the denial linearization point and “what a linearization-failed deny does to the registration.” LLP 0053 permits trusted denial to drive destructive `delete` only with a coherent authorization/data witness. Whether the registration terminates, remains quarantined, retries, or is re-established after a concurrent grant directly determines whether stale denial can retire an obligation or destroy previously authorized state. The validation row asserts only that a stale deny cannot discharge a newer floor; it does not specify or test the resulting registration state or retry behavior.

   **Resolution criterion:** Define the denial state machine before acceptance for initial subscription and rerun separately. A trusted brand should be issued only after captured dependencies are validated at a commit-ordered point; failed validation must have a pinned fail-closed disposition, registration state, retry bound, and obligation behavior. Add deterministic grant/revoke interleaving tests around lookup, branding, registration, event projection, and terminal retirement.

4. **Severity: MATERIAL — Stable declaration identity and full provenance lack a durable lifecycle contract.**

   **Evidence:** §Declaring a membership table promises declaration IDs are never reused, but detects reuse by consulting provenance or transition-log rows. §Protocol obligations defers transition-log retention, while §Agents calls that log durable, append-only, and the basis for LLP 0055’s `authorityCreating` guarantee. Retention or deletion of the last log row would defeat the reuse check unless a separate tombstone exists. Reset, declared restore, schema removal/re-addition, and logical import are not classified in the writer matrix. The current reset path directly deletes every physical user table (`src/storage.rs:828`), so an app-adjacent log or registry will be bypassed unless deliberately placed in system metadata. Import preservation is specified for provenance columns but not for transition-log commit versions or declaration identity. Finally, validation rejects a target with no provenance, but does not explicitly prove that weaker `provenance: "creation"` is rejected where LLP 0055 requires `"full"`.

   **Resolution criterion:** Define a durable declaration registry or generation tombstone independent of retained audit rows, including activation, removal/re-addition, restart, reset, import, restore, and LLP 0053 incarnation semantics. Pin the transition log’s minimum retention, export/import behavior, commit linkage, and deletion authority. Enumerate reset/restore/schema migration in the writer matrix. Add ABA tests across restart/reset/restore and an explicit `provenance: "creation"` negative for `authorityCreating`.

5. **Severity: MATERIAL — `lastHolder` and expiry sweeping lack an executable safety-and-progress contract.**

   **Evidence:** §Writes correctly identifies the two-concurrent-removals race and requires a range dependency, but §Validation does not explicitly run that motivating final-two-holders interleaving. The prose also says this is “the same machinery” as uniqueness, although the implementation mechanisms are distinct: query dependencies are validated through the matcher (`src/storage.rs:3182`; `src/live_matcher.rs:229`), while uniqueness requires a new physical unique-index path. The expiry sweep is unspecified as to batch size, continuation, and failure granularity. If one expired final host raises a typed refusal inside a batch mutation, an ordinary transactional implementation can roll back unrelated expired removals indefinitely, leaving authority alive.

   **Resolution criterion:** Add a barrier-controlled test where concurrent removals/demotions of the final two holders yield exactly one success, including proof that the range dependency—not incidental serialization—caused the loser to fail. Define a bounded, fair sweep protocol with a frozen clock, continuation, per-resource atomicity, and explicit handling of protected rows so one refusal cannot starve unrelated expirations. Test mixed protected/unprotected batches, more than one batch, retries, and restart continuation.

6. **Severity: NON-BLOCKING — “Server-decides with the divergence window accepted” is too loose a capability statement.**

   **Evidence:** §What stays out of the session uses that phrase for optimistic role-gated mutations. LLP 0011 pins parity of `ctx.auth`, while LLP 0004 permits targets that cannot locally simulate a mutation only if they report the capability gap explicitly. “Divergence accepted” could be read as allowing an unauthorized optimistic changeset rather than disabling optimistic execution.

   **Resolution criterion:** State that v1 role-gated mutations are generated as non-optimistic/online-authoritative unless the adapter possesses a qualifying membership replica. Expose that as capability metadata and validate that an adapter cannot silently simulate the check without its required data.

## 4. Suggestions

- Compile each transition declaration into a total decision table over operation, caller class, target relation, old role, and new role. Emit diagnostics for impossible, duplicate, shadowed, or unintentionally broad entries, and expose the table through doctor.

- Bind a declaration generation and policy hash into authorization witnesses and transition-log entries. This would make schema-policy changes explainable and prevent an old witness from being interpreted under a new transition matrix.

- Generate SQL lowering, full-query reference evaluation, and matcher evaluation from one Rust-owned predicate AST, then use property-based differential tests over inserts, deletes, role changes, nulls, and multiple declarations.

- Give unique membership indexes a distinct physical-index path. The current ordinary index builder appends `_id` (`src/storage.rs:2751`), which would defeat uniqueness if copied mechanically into `UNIQUE(principal, resource, _id)`.

- Define how expiry is renewed or cancelled. The ordinary generated surface exposes insert, set-role, and remove, while the sweeper alone owns clearing expiry; a safe renewal API may need its own transition-policy axis.

- Make declaration-scoped invalidation the first optimization after correctness, as proposed. The declaration already provides a more defensible closed boundary than subject-scoped inference.

## 5. Open questions

- Are orphan memberships authorization-inert, retained only for audit, or prohibited entirely?

- Should resource deletion cascade memberships, be blocked until teardown, or carry a same-transaction teardown witness?

- Is caller identity relation truly part of `by`, or should it exist only as the independent `target` axis?

- What exact registration state follows denial-witness validation failure during initial subscribe versus rerun?

- Are declaration IDs globally permanent, incarnation-scoped, or represented as `(id, generation)`?

- What retention and export guarantee makes `provenance: "full"` sufficient for LLP 0055?

- What are the sweep batch limit, retry policy, fairness guarantee, and maximum practical expiration lag?

- Does a real app require renewal/cancellation of expiry or mutation of incidental columns through ordinary user-authorized flows?

- Should app-global roles remain exclusive per declaration, or is the expected multi-role pressure strong enough to settle the triple-key model now?

## 6. Readiness verdict

The architecture is promising and substantially aligned with LLP 0011, 0039, and 0053, but unresolved transition, resource-lifecycle, denial-linearization, durable-identity, and sweep-progress semantics can still produce incorrect authorization outcomes. These material issues need normative resolutions and corresponding validation.

VERDICT: NOT READY
### Orchestrator verification notes — round 8 (not part of the received review)

- Both families again converged on the transition grammar: the `by` classes were **colliding** (a caller who is both the target and a `host` matched two entries with no precedence rule). Now disjoint and totally ordered, with `"self"` winning.
- The Claude family found a real completeness gap: with raw writes refused and only insert/setRole/remove generated, **no user-authority path could write a non-axis column** — an app could not renew an expiring membership. A `patch()` form with its own declared transitions now covers it, and its invalidation follows the `incidental` floor.
- Deleted-resource memberships were dismissed as 'roster hygiene' but are **live authority** (a rule gating on membership alone still admits the holder). v1 now refuses a resource delete while memberships remain — fail-closed.
- **This is where the loop stopped.** The write-authorization surface has produced a new gap in each of rounds 4, 6, and 8; its v1 boundary (cross-declaration authority? renewal? column-level policy?) is a product decision the author should settle in one pass rather than have this loop discover incrementally.

## Round 9 — 2026-07-13 (RFC altitude)

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session; method cli-runner. Brief carried the author's ratified altitude ruling.
**Revision under review:** `llp/0056-…rfc.md`, sha256 `cdc47f1a2b9e493d15472d489a69e419493c12f8413d7bd614f671e61a3da8a6`
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong proposal with the right architectural center: scoped roles remain ordinary, transactional application data rather than session claims; declarations close the role vocabulary; generated operations bind authorization to the actual target row; and membership reads participate in Snapback’s existing capture and invalidation machinery. The RFC is candid about v1’s limitations, including global authorization-version blast radius, server-decided optimistic behavior, HostPlan exclusions, and the absence of full LLP 0011 two-sided write rules.

The proposal is coherent with LLP 0011, LLP 0039, LLP 0053, and LLP 0055. In particular, it preserves `ctx.auth.roles` as dev-only, respects `writeAuthorization: "handler"`, treats membership writes as permission-backing events, and composes delegated authority with `authorityCreating` and durable provenance. The implementation supports its key feasibility claim: ordinary row/query captures, including empty query results, are matcher-visible and commit-validated, while `CapturedReadKind::Permission` is deliberately ignored by `src/live_matcher.rs` and `src/storage.rs`. The special denial-capture requirement is also honest about the current failure path in `src/local.rs` and `src/server.rs`.

The deferred AST, serialization, denial-linearization mechanics, and executable transition machinery are appropriate implementing-spec work under the author’s RFC-altitude ruling. I nevertheless found two design-level problems: `lastHolder` and resource deletion presently form an impossible lifecycle, and the generic `patch()` policy lacks the field granularity needed to support its own examples safely. Those are not protocol-detail omissions and should be resolved before acceptance.

## 2. Strengths

- **Data-backed authority rather than stale session claims.** §“What stays out of the session” preserves LLP 0039’s real-session `roles: []` contract and cleanly separates dev impersonation from production membership state.

- **Structural write enforcement.** §“Writes: a declared transition policy, closed by default” correctly binds self/other, resource, principal, and old/new role using host-derived facts. The writer-class matrix closes both buffered-Ibex and generic-HostPlan paths and states honestly that this is axis-safe rather than LLP 0011’s eventual full two-sided RLS.

- **Accurate use of the existing capture substrate.** §“What exists, what this adds” and §“Invalidation: the LLP 0053 mapping” correctly avoid `CapturedReadKind::Permission`. `src/live_matcher.rs::query_dependencies_from_plan` records a query dependency even for an empty result, and `src/storage.rs::validate_captured_read_set` validates ordinary row, missing-row, and query dependencies while ignoring `Permission`, exactly as the RFC claims.

- **Careful denial design.** §“Rule helpers” avoids exposing a visibility-bypassing membership read, keeps the client denial invariant across absent and wrong-role cases, and explicitly requires captured membership evidence to survive terminalization. This is well aligned with LLP 0053’s trusted-denial and coherent-witness requirements.

- **Sound agent composition.** §“Agents” correctly recognizes delegated membership writes as durable authority creation, requires LLP 0055’s explicit consent gate and `provenance: "full"`, and narrowly exempts bootstrap because it can seat only the server-derived effective principal.

- **Honest sync scope.** §“Invalidation” and §“Non-Goals” distinguish conservative `live_replace` correctness from retained/offline eligibility and defer the incremental semi-join lane to the LLP 0008/0004 amendments.

- **Good RFC/spec boundary.** §“Protocol obligations deferred to implementation” enumerates the normative work that must follow without pretending those mechanics already exist. The Validation Requirements are unusually adversarial and often isolate the mechanism being tested from the coarse authorization-version fallback.

## 3. Concerns

1. **MATERIAL — `lastHolder` makes the specified resource-deletion lifecycle impossible.**

   **Evidence:** §“Writes” says `lastHolder` refuses every transition removing or demoting the final protected holder, including seed, import, expiry, and admin writers. The same section later says resource deletion is refused while memberships remain and that the app “must clear the roster first.” For any resource using `lastHolder`, clearing the roster necessarily removes the final protected holder, which is universally forbidden. Such a resource can therefore never follow the documented deletion path. The Validation Requirements repeat the universal `lastHolder` rule but do not exercise resource teardown.

   **Resolution criterion:** Choose and pin a coherent lifecycle. Preferably define the invariant over final transaction state—while a resource exists it must have a protected holder; when absent it must have no memberships—and provide an authorized atomic teardown operation that removes the resource and roster together, retaining event-1 and provenance consequences for membership deletions. Alternatively, explicitly declare protected resources undeletable. Add validation for ordinary teardown, teardown racing a new membership, and the exact concurrent-final-holder race.

2. **MATERIAL — `patch()` authorizes an operation class but cannot distinguish the fields that operation may touch.**

   **Evidence:** §“Writes” defines transition authority over `(op, caller role, self/other, old role, new role)`, while `patch()` may write every non-axis, non-role column. It then claims distinct policies such as “host may extend `expiresAt`” and “member may edit their own notification preference.” No transition dimension names touched fields. Consequently, a self-patch transition intended for notification preferences also authorizes changing `expiresAt`, `joinedAt`, or any other patchable auxiliary field. The wording also encompasses generated provenance columns unless they are separately excluded, contradicting §“Agents,” which calls those columns host-filled and immutable. The current substrate provides no implicit rescue: `BufferedWrite::Patch` and `MutationStep::Patch` carry arbitrary value maps into `patch_document` in `src/storage.rs`.

   **Resolution criterion:** Classify columns explicitly as axes, role, host-managed immutable, and app-patchable. Give patch transitions an exact field allowlist or field group, define mixed-field behavior fail-closed, and have the host authorize the actual touched-key set. If “extend expiry” means monotonic extension rather than arbitrary assignment, either add that state transition or expose a dedicated renewal operation. Add negative validation proving a notification-only transition cannot alter expiry, provenance, or a second field in a mixed patch.

3. **NON-BLOCKING — The “never reused” declaration-ID guarantee is narrower than its wording.**

   **Evidence:** §“Declaring a membership table” says declaration IDs are never reused, but only pins rejection after an ID has appeared in a provenance or transition-log row. A declaration without provenance can apparently be removed and rebound despite IDs also being used for audit, room bindings, and future durable grant scopes.

   **Resolution criterion:** Either retain a durable registry/tombstone for every activated declaration ID, independent of provenance, or narrow the guarantee and explicitly generation-bind every current reference.

## 4. Suggestions

- Make the generated non-unique `(resource, role)` index explicit alongside the unique `(principal, resource)` index; §“Writes” already relies on it for the protected-holder range dependency.

- Consider replacing generic `patch()` with generated capability-shaped methods or field groups, such as `updatePreferences()` and `renewExpiry()`. This makes the security boundary visible in both codegen and doctor output.

- Add the exact “two concurrent removals of the final two holders” fixture. The existing stale-role validation is related but does not directly prove the aggregate `lastHolder` race described by the RFC.

- State explicitly whether an expiry field may be attested `incidental`. The design is defensible if expiry has no authority effect until the sweep materializes it, but the current examples imply a leaning without pinning it.

- Clarify whether `pendingRoles` may appear as a transition’s `by` class when the caller is acting on another principal’s row.

- Update the `Revised` metadata summary so it reflects the revision actually under review; the document body describes later rounds than the header’s “round-5” label.

## 5. Open questions

- Who may authorize atomic resource teardown, and should teardown be a generated membership operation, a generated resource operation, or an operator-only capability?

- Should auxiliary-field authorization use exact field allowlists, named field groups, or dedicated semantic operations with old/new-value constraints?

- Are host-managed provenance fields completely absent from generated patch input types, and how is that exclusion represented in the manifest?

- What is the intended treatment of imported orphan memberships under `lastHolder`: repairable authority state, activation failure, or a state requiring operator intervention?

- What measured global-quarantine rate is acceptable before memberships are blessed for reference applications, and does acceptance require declaration-scoped narrowing first?

## 6. Readiness verdict

The central architecture is good, feasible, and consistent with the governing LLPs, and the named protocol deferrals are not blockers. The resource lifecycle contradiction and field-laundering risk in `patch()` are unresolved design defects, however, so the RFC is not ready for acceptance.

VERDICT: NOT READY

### Orchestrator verification notes — round 9 (not part of the received review)

Round 9 ran at the ratified altitude. **Both families independently found the same defect** — **`patch()` was column-blind**, so a `by: ["self"]` preferences transition would also have let a member extend their **own** `expiresAt`, silently renewing a membership the app meant to expire. `patch` transitions now name the exact `fields` they authorize. The GPT family additionally found that **`lastHolder` made resource deletion impossible** (the roster cannot be cleared, because the final host is protected — so a protected resource could never be deleted at all). Fixed with a **deletion witness**, symmetric to the creation witness that gates bootstrap.

## Round 10 — 2026-07-13 (RFC altitude)

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session; method cli-runner. Brief carried the author's ratified altitude ruling.
**Revision under review:** `llp/0056-…rfc.md`, sha256 `7ac8166ab77c7ddd8b061bc69d9bbde9bfc52a97ac11f0fe953e94f42038c99b`
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong and unusually careful RFC. Modeling roles as ordinary application data in a system-recognized membership shape is a good architectural choice: it preserves queryability and portability while giving Snapback enough structure to enforce invariants, explain authorization, and connect changes to LLP 0053’s invalidation machinery. The proposal is coherent with LLP 0011, LLP 0039, LLP 0053, and LLP 0055, including the real-session `ctx.auth.roles: []` rule, the interim `writeAuthorization: "handler"` boundary, trusted denial classification, effective-principal semantics, and `authorityCreating`.

The implementation-facing claims are accurate. `src/runtime.rs:1000` captures successful and empty query results as ordinary query dependencies; `src/live_matcher.rs:121-202` gives captured dependencies precedence and ignores `Permission`; and `src/storage.rs:3122-3235` validates `Row`/`MissingRow`/`Query` dependencies while ignoring `Permission`. The RFC also correctly identifies missing surface: `TableManifest` and `IndexManifest` currently lack membership and uniqueness metadata (`src/manifest.rs:227-264`), `ValueExpr` lacks a relationship predicate (`src/manifest.rs:1273`), and the codegen table builder exposes only ordinary indexes (`packages/snapback-codegen/define.mjs:61-89`).

I do not consider the deferred predicate AST, denial linearization machinery, ledger serialization, or executable witness mechanics blockers. They are named appropriately in §Protocol obligations deferred to implementation. Two policy-level issues remain material, however: the expiry design cannot support its claimed “never a promotion” guarantee, and the transition classifier does not close the anonymous-`by: "none"` case on which the direct-runner safety claim depends.

## 2. Strengths

- **The core representation is the right one.** §Summary and §Declaring a membership table make roles ordinary, joinable application data while adding only the structural facts Snapback needs. This cleanly answers LLP 0011’s roles question without creating stale session claims.

- **The schema invariants are security-relevant and well chosen.** §Declaring a membership table correctly pins non-null axes, exact role comparison, a closed vocabulary, a true composite unique index, immutable principal/resource axes, referential integrity, and fail-closed activation.

- **The write surface is substantially safer than handler conventions.** §Writes: a declared transition policy, closed by default binds authorization to host-derived caller, target, resource, and old/new-role facts. The self/role/none precedence rule solves real ambiguity, and the raw-write refusal covers both Ibex and every generic HostPlan form.

- **`lastHolder` is treated as a transactional invariant rather than a preflight check.** §Writes correctly identifies the two-final-holders race and requires a snapshot-bound range dependency validated at commit. That design is compatible with the existing captured-query validation path in `src/storage.rs:3182-3231`.

- **The RFC maps cleanly onto LLP 0053.** §What exists, what this adds and §Invalidation distinguish result dependence from authorization dependence, use ordinary database captures instead of the inert `Permission` kind, preserve empty-result dependencies, derive `permissionBacking`, and apply the exact `permissionFields` update rule LLP 0053 pins.

- **The denial design avoids turning privileged evaluation into an existence oracle.** §Rule helpers keeps the membership read internal, uses the already trusted terminal denial, returns an invariant `{ kind: "role" }` payload, and moves sensitive detail to gated doctor/audit surfaces.

- **The scope boundary is candid.** §What v1 delivers, named precisely and §Delivery lanes explicitly avoid claiming full two-sided LLP 0011 write rules, retained eligibility, or incremental semi-join delivery. The global invalidation blast radius is owned rather than hidden.

- **The LLP 0055 composition is thoughtful.** §Agents correctly separates actor from effective principal, gates durable delegated authority creation at the effect site, requires full provenance, and gives bootstrap a narrowly reasoned exception.

- **The deferred work is well catalogued.** §Protocol obligations deferred to implementation identifies the exact protocol artifacts that still need implementing specifications without pretending this RFC itself is one.

- **The validation plan targets real failure modes.** §Validation Requirements covers raw-writer bypasses, stale checks, empty-result capture, denial witnesses, room kicks, provenance after deletion, coarse-event masking, and both visible-to-hidden and hidden-to-visible transitions.

## 3. Concerns

1. **Severity: MATERIAL — The expiry policy cannot establish its claimed non-escalation property.**

   **Concrete evidence:** §Time-bounded memberships says `onExpiry` may “downgrade to a named role” but may “never [perform] a promotion,” and §Validation Requirements requires promotion attempts to be refused. The declaration supplies only a destination role; it supplies neither permitted source roles nor an ordering or privilege relation. §Open Questions explicitly leaves role ranking unresolved. Consequently, a declaration can name `host` as `downgradeTo`, or an expired pending `invited` row can be changed to active `guest`, and the host has no structural basis for classifying either transition as promotion. This recreates, through the system sweeper, the authority-changing behavior the RFC rejects for a general `systemSetRole`.

   The expiry field contract is also incomplete: no field type, time unit, or optionality requirement is stated, even though the host must compare it to an authoritative clock and clear it after a downgrade.

   **Resolution criterion:** Choose and state one enforceable design: restrict v1 expiry to removal; define an explicit role order/non-escalation relation plus allowed source roles; or admit that `downgradeTo` is a trusted manifest-declared transition that may elevate and remove the “never a promotion” guarantee. Also require a portable timestamp representation and a nullable/clearable field. Add negative validation for pending-to-active, guest-to-host, wrong-type, required-field, and undeclared-source cases.

2. **Severity: MATERIAL — `by: "none"` is not defined to exclude authorities with no effective principal.**

   **Concrete evidence:** §Writes says the host assigns exactly one totally ordered caller class, with `"none"` meaning the caller holds no membership for the resource. An anonymous projection necessarily has no membership and compares unequal to any non-null target principal, so the literal rules classify it as `by: "none", target: "other"`. A declared transition with that shape could therefore match an `optional-user` invocation or the direct admin runner. That contradicts the writer-class matrix’s claim that `adminBypass` has an anonymous projection and therefore “no transition can match.” LLP 0039 confirms that `adminBypass` and `system` carry no user. The current validation row tests `adminBypass`, but does not require a fixture containing a matching `none/other` transition, so the contradiction could escape.

   **Resolution criterion:** State that ordinary transition classification requires a non-null resolved effective principal; otherwise no `by` or `target` class exists and every generated membership write denies. Define `"none"` as “an authenticated effective principal with no membership in this declaration.” Add `optional-user`, anonymous, `adminBypass`, and `none/other` adversarial tests. Preserve the separately authorized system sweep.

3. **Severity: NON-BLOCKING — Single-use creation/deletion witnesses are ambiguous across multiple declarations on one resource.**

   **Concrete evidence:** §Rule helpers and the validation plan explicitly support two declarations over one resource type. §Writes describes both the creation witness and deletion witness as single-use. If single-use is per resource event, a resource cannot bootstrap two declarations or clear both rosters during deletion; if it is per `(resource event, declaration)`, the design works, but that policy cardinality is not stated. §Protocol obligations item 4 already defers the exact witness carrier and declaration binding, so the protocol representation itself is properly deferred.

   **Resolution criterion:** Add one RFC-level sentence specifying that a resource creation/deletion may derive one single-use capability per bound declaration, or reject multiple bootstrap/teardown-enabled declarations at manifest load. Require a validation fixture that bootstraps and tears down two rosters for one resource, with resource deletion succeeding only after all bound rosters are cleared.

4. **Severity: NON-BLOCKING — The stable-id reuse rule understates what counts as a durable reference.**

   **Concrete evidence:** §Declaring a membership table says declaration ids are used by room bindings and future durable grant scopes, but later defines “used” only as appearing in a provenance or transition-log row. A declaration without provenance could therefore be rebound despite an active room binding, and future durable reference kinds would not automatically lock the binding.

   **Resolution criterion:** Define “used” through a registry of every durable reference class, or explicitly state that current room bindings are activation-local and safely rebound through LLP 0053 event 2. Require every future durable reference kind to participate in the rebinding check.

## 4. Suggestions

- Compile each transition matrix into a finite policy graph and lint unreachable transitions, overlapping patch rules, protected-role dead ends, roles with no entry or exit path, and expiry paths that cross pending/active boundaries.

- State that one complete transition must authorize the entire patch atomically. Do not let two individually insufficient `fields` lists combine accidentally unless union semantics are an explicit design decision.

- Add a schema-diff diagnostic for authorization widening: new roles, new `by: "none"` transitions, newly permitted promotions, removal of `lastHolder`, or broader patch fields should be highlighted separately from ordinary schema changes.

- Have doctor render the derived writer matrix and transition graph, including effective-principal requirements, bootstrap/teardown exceptions, expiry effects, and the reason a transition was unreachable.

- For a later optimization, consider declaration-scoped authorization versions before subject-scoped versions. The RFC already has the declaration identities and measurements needed, and this is a substantially smaller proof obligation than principal targeting.

- Consider representing expiry work as version-bound scheduled intents for large tables: the intent would carry the expected membership row/version and become a no-op after renewal or role change. The current scanning sweep remains a sound v1 baseline.

## 5. Open questions

- Will expiry be removal-only in v1, or what machine-checkable relation makes a destination a downgrade rather than a promotion?

- Does every transition require an authenticated effective principal, with `system` handled solely through named host operations?

- Are creation and deletion capabilities single-use per resource or per `(resource, declaration)`?

- What exact references permanently lock a stable declaration id to its table?

- How should an imported or accidentally created resource with zero protected holders be repaired without weakening creation-bound bootstrap?

- If multiple transition entries match, must one entry cover the whole operation, or do entries compose?

- Does the first real app require cross-declaration authority or multiple simultaneous roles strongly enough to change the v1 matrix or uniqueness model?

- May a protected room bind an OR across declarations, and if so, does teardown or rebinding require all declaration dependencies to be fenced together?

## 6. Readiness verdict

The core proposal is sound, implementation-grounded, and appropriately scoped as an RFC. The explicitly deferred protocol obligations do not block readiness. The expiry non-escalation claim and null-effective-principal transition semantics are authorization-policy defects, however, and must be resolved before acceptance.

VERDICT: NOT READY

### Orchestrator verification notes — round 10 (not part of the received review)

Two material findings, both real, both the same race class the loop has been teaching this document to see. (1) **Referential integrity was unenforced on the live insert path, and race-defeasible**: an open-join insert captures only the empty membership range, which a concurrent teardown does not touch — so both commit, and an orphan membership lands on a **deleted** resource, minting authority over an object that no longer exists. Every insert now reads the resource row **and captures it**, so insert-vs-delete linearizes at commit exactly like `lastHolder`. (2) **The validation matrix omitted the concurrent `lastHolder` fixture** — the very race the invariant exists to refuse, and one a snapshot-read implementation would pass every *serial* row while failing. Also: **`insert` is now field-bound like `patch`** (an open-join joiner could otherwise have seated themselves with `expiresAt` a century out).

## Round 11 — 2026-07-13 (RFC altitude)

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session; method cli-runner. Brief carried the author's ratified altitude ruling.
**Revision under review:** `llp/0056-…rfc.md`, sha256 `c6b3f0b234a0d798c0b57cd7950f3febcce96c99eaeabb47215523ace7886c6c`
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong proposal with the right architectural center: roles remain live application data while Snapback recognizes enough structure to enforce writes, analyze reads, explain denials, and participate correctly in authorization invalidation. The transition matrix is substantially safer than caller-supplied guards, and the composition with LLP 0011, LLP 0039, LLP 0053, and LLP 0055 is generally careful and coherent.

The implementation claims check out. `src/live_matcher.rs` gives captured query dependencies precedence and ignores `Auth`/`Permission`; `src/storage.rs` validates `Row`, `MissingRow`, and `Query` dependencies but likewise ignores `Permission`; `src/value_expr.rs` has no relationship predicate; and the current schema/codegen surfaces have neither membership metadata nor unique indexes. The RFC therefore identifies the real extension points rather than pretending the mechanism already exists. Its protocol obligations are properly enumerated for implementing specifications and are not a reason to withhold readiness.

Three design-level issues remain. The transition language has an authorization-significant namespace collision, `lastHolder` does not provide the non-stranding guarantee repeatedly claimed for it, and expiry can preserve authority indefinitely. These affect policy meaning and security outcomes, not merely deferred serialization or linearization mechanics.

## 2. Strengths

- **Roles as recognized app data:** §Summary and §What stays out of the session correctly preserve LLP 0039’s rule that real sessions have `ctx.auth.roles: []`, avoiding stale role claims while still providing a blessed role model.

- **Closed write surface:** §Writes closes raw Ibex and generic HostPlan membership writes, derives caller/resource/target facts inside the host, and binds insert and patch fields. This is a convincing structural improvement over handler conventions.

- **Concurrency reasoning:** §Writes correctly identifies both final-two-holder removal and insert-versus-resource-deletion as range/row dependency problems under LLP 0004’s concurrent-handler model. The proposed captures match the capabilities already present in `src/storage.rs`.

- **Accurate matcher integration:** §What exists, what this adds and §Invalidation correctly identify the `CapturedReadKind::Permission` trap, the captured-query short circuit, and the necessity of empty-result dependencies. This matches `src/live_matcher.rs:13-84` and `src/live_matcher.rs:158-220`.

- **Faithful LLP 0053 composition:** §Invalidation treats membership writes as event 1, preserves the global v1 blast radius, gives `incidental` a hard authorization-field floor, and reuses the existing trusted denial operation rather than extending LLP 0053’s closed producer set.

- **Denial-oracle discipline:** §Rule helpers keeps the public denial invariant across absent, pending, and wrong-role states while retaining useful detail on gated doctor/audit surfaces.

- **Agent composition:** §Agents correctly distinguishes actor from effective principal, makes bootstrap seat only the effective principal, and requires full provenance for LLP 0055 `authorityCreating` functions.

- **Validation quality:** §Validation Requirements includes important adversarial cases that ordinary happy-path testing would miss, especially empty-result wakeups, matcher testing factored from coarse authorization events, every-writer enforcement, and final-two-holder concurrency.

- **Appropriate RFC altitude:** §Protocol obligations deferred to implementation records the normative AST, lowering, denial-linearization, ledger, and generated-witness work without pretending this RFC is their implementing specification.

## 3. Concerns

1. **MATERIAL — Caller-class sentinels collide with legal role literals.**

   **Evidence:** §Declaring a membership table permits exact decoded role strings, rejecting only controls and vocabulary defects. §Writes then uses the same untagged strings for declared roles and the special caller classes `"self"` and `"none"`, while claiming the classes are disjoint and totally ordered. A declaration containing role `"self"` or `"none"` makes `by: ["self"]` or `by: ["none"]` ambiguous between a role selector and a special caller selector. For example, `by: ["self"], target: "other"` is either an unreachable special-class transition or a transition for holders of the literal role `"self"`. Two conforming interpretations authorize different writes. No validation requirement reserves or disambiguates these values.

   **Resolution criterion:** Either reject `"self"` and `"none"` from both `roles` and `pendingRoles`, with manifest and generation tests, or use structurally tagged selectors such as `{ caller: "self" }` and `{ role: "self" }`. The manifest must have one unambiguous interpretation for every accepted transition.

2. **MATERIAL — `lastHolder` is only a row-count guard, not the promised non-stranding invariant.**

   **Evidence:** §Declaring a membership table explicitly makes `v.principal()` nominal and performs no principal-existence check; memberships may outlive deactivation. LLP 0055 §Principal kinds says deactivation is permanent, ends every authority-exercising path, and leaves memberships as historical data. Yet §Writes defines the protected-holder set solely by `(resource, role)` membership rows. Consequently:

   - a nonexistent or permanently deactivated principal counts as a holder;
   - an active final administrator may leave while such a dead row remains;
   - deactivation of the sole holder strands the resource without any membership transition on which `lastHolder` can run;
   - resources may begin with zero holders, because `bootstrapRole` grants an optional creation-bound capability rather than a commit postcondition, activation does not require holder coverage, and §Validation Requirements explicitly contemplates imported resources with zero memberships.

   The final-two-row concurrency proof is sound, but it proves only that a populated holder set cannot cross from one row to zero through the covered transition. It does not justify “never strand the resource” or “a resource is never silently stranded without a host.”

   **Resolution criterion:** Decide and state the actual invariant. If it is only “prevent a covered 1→0 holder-row transition,” rename it and remove the stronger availability claims. If it is administrative continuity, define an eligible holder as an existing, authority-capable principal; couple deactivation and other terminal principal transitions to the invariant; define whether `bootstrapRole` is a required creation postcondition; and validate activation/import for zero or ineligible holder sets. Add tests for nonexistent principals, sole-holder deactivation, active-plus-deactivated holders, creation without bootstrap, and imported zero-holder resources.

3. **MATERIAL — A supposedly time-bounded membership can remain authorized forever.**

   **Evidence:** §Time-bounded memberships says the sweep materializes expiry because protected rules cannot consult a clock, but when the expired row is the final protected holder it is skipped, “leaves it live,” and remains “expired-but-protected.” The rule helpers authorize from the live membership row, so no later bound terminates that authority; the app’s sweep cadence is irrelevant once this state is reached. §Validation Requirements enshrines the same precedence. A diagnostic is operational notice, not revocation. This conflicts with the advertised time-bounded semantics and the corpus’s fail-closed security posture.

   **Resolution criterion:** Prevent a protected-role expiry from silently becoming indefinite authority. Viable designs include rejecting declarations that allow the protected role to expire, revoking at expiry while atomically placing the resource into an explicit suspended/unowned state, or requiring an explicit conflict policy whose availability-over-expiry mode is not described as time-bounded. Validation must demonstrate that a configuration advertised as expiring cannot authorize the holder indefinitely.

## 4. Suggestions

- Provide an ergonomic self-pending flow. The member-list preset excludes pending rows while `setRole` and `remove` take a hidden row id; an `accept(resource)`/`decline(resource)` helper or “principal sees their own pending row” preset would make the motivating invitation flow straightforward without exposing a general bypassing read.

- State whether one transition must individually cover every inserted or patched field, rather than allowing authorization to be assembled from overlapping transitions. Reject or lint conflicting overlaps so policy review remains local.

- Replace or substantiate §Writes’ assertion that resource IDs are “never reused.” Current generated IDs are UUIDv7, while seeds can provide `_id`; there is no evident durable non-reuse tombstone. A resource incarnation identifier would make bootstrap and audit continuity independent of probabilistic uniqueness and privileged restore behavior.

- Require generated indexes and bounded batches for expiry sweeps and teardown, and define diagnostic deduplication for repeatedly skipped protected rows in the implementing plan.

- Reconcile the revision-history prose: the header says ten dual-family rounds, while §Status says eight and refers to round-eight findings.

## 5. Open questions

- Is `lastHolder` intended to preserve a nonempty set of rows or actual exercisable administrative control?

- Which principal lifecycle states count as eligible holders, and who must atomically repair affected resources when a principal becomes ineligible?

- When `bootstrapRole` is declared, is consuming the creation witness mandatory, optional, or controlled by a separate declaration flag?

- Is `expiresAt` a security deadline or best-effort cleanup metadata? Which invariant should win when expiry conflicts with holder continuity?

- Should caller selectors occupy a reserved role namespace, or should the transition language use tagged selector variants?

- How does an invitee discover and act on their own pending membership without learning unrelated pending rows?

- What durable resource-incarnation rule supports bootstrap, deletion, restoration, and transition-log interpretation?

## 6. Readiness verdict

The central proposal is good and implementable, and the deferred protocol work is appropriately scoped. However, the caller-selector ambiguity and the holder/expiry semantics can authorize unintended writes or preserve authority beyond the claimed boundary. Those material design issues must be resolved before acceptance.

VERDICT: NOT READY

### Orchestrator verification notes — round 11 (not part of the received review)

Four material findings across the families, and two were the document's *prose overclaiming what its mechanism delivers* — which is what convergence looks like. **Caller-class sentinels collided with legal role literals** (a role named `"self"` or `"none"`); both are now reserved. **`lastHolder` guarantees a _row set_ never empties — not that the resource has a reachable host** (a sole holder whose principal was deactivated still strands it); the document now says the narrower, true thing. **`expiry` does not bound a protected role**, since the sweep skips its final holder forever — stated plainly. And the **bootstrap-revival defense rested on "resource ids are never reused" — an invariant no document in this corpus owns**; it was also unnecessary, since orphan memberships can no longer exist, so a reused id has nothing stale to inherit. The argument is now self-contained rather than borrowed.

## Round 12 — 2026-07-13 (RFC altitude, final)

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session; method cli-runner. Brief carried the author's ratified altitude ruling.
**Revision under review:** sha256 `68126e488ec152c66cb75224e4adf8232570a4b3350534a73c7a99a3efa3c7d8`
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong, well-motivated proposal. Modeling scoped roles as ordinary application data with system-recognized structure is the right direction: it avoids stale session claims, preserves the `ctx.auth.roles` boundary established by LLP 0039, and composes naturally with LLP 0011’s structured authorization model, LLP 0053’s invalidation protocol, and LLP 0055’s effective-principal semantics. The transition matrix is substantially safer than convention-based membership handlers, while remaining understandable enough for application authors.

The implementation survey supports the RFC’s premises. `src/value_expr.rs` and `src/manifest.rs` currently have no relational membership predicate; `TableManifest` has no membership metadata; `IndexManifest` has no uniqueness flag; and the authoring surface in `packages/snapback-codegen/define.mjs` exposes neither membership declarations nor principal references. More importantly, `src/live_matcher.rs::live_subscription_may_be_affected_by_dependencies` and `src/storage.rs::validate_captured_read_set` both ignore `CapturedReadKind::Permission`, so the RFC is correct to require ordinary Row/Query dependencies, including empty-result captures. The proposed work is broad but buildable.

The protocol-level deferrals are appropriately isolated in §“Protocol obligations deferred to implementation” and are not grounds for withholding readiness at RFC altitude. One design-level defect remains, however: `lastHolder` is specified and validated as a transition guard, while the RFC claims it as a total invariant over live resources. Creation, activation, import, and app-global declarations can all begin with zero protected holders, and bootstrap is neither mandatory nor required to seat the protected role. That makes a central safety claim false and leaves the validation plan unable to detect the counterexample.

## 2. Strengths

- §“Declaring a membership table” chooses an excellent abstraction boundary: memberships remain inspectable, exportable app data, while nominal principal/resource typing, closed role vocabularies, immutable axes, and declaration identities give the host enough structure to enforce safety.

- §“Writes: a declared transition policy, closed by default” is particularly strong. The disjoint caller classes, explicit self/other distinction, old/new role matching, field-bound inserts and patches, and refusal of unmatched transitions eliminate several common confused-deputy and check-A/write-B errors.

- §“The writer-class matrix” correctly recognizes that enforcement solely in `ctx.db` would be ineffective. Current code has distinct HostPlan, buffered Ibex, and seed write paths in `src/storage.rs`; requiring a shared enforcement seam is essential.

- §“Rule helpers” and §“Invalidation: the LLP 0053 mapping” compose cleanly with LLP 0053. The split between a `DatabaseCaptured` membership lookup and the existing `TerminalAuthorization` denial operation preserves the closed trusted-denial set and avoids turning hidden membership facts into application values.

- §“The captured-dependency contract” is unusually precise for an RFC. Successful, absent, and row-field-dependent lookups are all covered, and the empty-result dependency directly addresses the matcher’s captured-dependency precedence. This matches the behavior of `src/live_matcher.rs` and `src/storage.rs`.

- §“Invalidation” correctly treats membership rows as both result dependencies and `permissionBacking` data. The `incidental` floor prevents role/provenance changes from suppressing LLP 0053 event 1, and downgrade-driven room kicks remain coherent with LLP 0013.

- §“What stays out of the session” preserves LLP 0039’s real-session projection and carefully confines `--as-role` to dev impersonation. The refusal of ambiguous bare global roles and the use of real rows for scoped impersonation are sound.

- §“Agents” composes well with LLP 0055. Effective-user membership evaluation, the `authorityCreating` gate, the bootstrap-only carve-out, and `provenance: "full"` address durable authority creation without conflating actor and effective principal.

- §“Protocol obligations deferred to implementation” draws the RFC/spec boundary responsibly. The deferred AST, lowering, denial linearization mechanics, transition ledger, and witness implementation are all explicitly retained rather than silently omitted.

## 3. Concerns

1. **Severity: MATERIAL — `lastHolder` does not establish the invariant the RFC claims.**

   **Concrete evidence:** §“Writes” says `lastHolder` refuses transitions removing or demoting the final holder and then claims that the protected role’s “row set never becomes empty.” But §“Declaring a membership table” lists activation/import checks for vocabulary, uniqueness, nullability, types, and referential integrity—not the existence of a protected holder for every live resource. Bootstrap is merely a single-use capability available after creation; the RFC does not require it to be consumed before the resource creation commits, nor require `bootstrapRole` to equal `lastHolder.protect`. The §“Validation Requirements” explicitly contemplates an existing resource with zero memberships and an imported orphan resource, while only verifying that neither can obtain a bootstrap witness.

   A concrete counterexample is therefore permitted:

   1. Create a resource without spending its creation witness, or activate/import a declaration over an existing resource with no membership rows.
   2. All listed activation/import invariants pass.
   3. The protected holder set is already empty, so no removal or demotion transition ever triggers `lastHolder`.
   4. Bootstrap is thereafter correctly unavailable because creation is over.

   The same issue applies to an app-global declaration: its singleton resource has no ordinary creation event from which to derive bootstrap. A mismatched `bootstrapRole: "owner"` and `lastHolder: { protect: "host" }` also spends bootstrap without establishing the protected set. This is not deferred protocol rigor; it is a mismatch between the mechanism and the stated design guarantee.

   **Resolution criterion:** Choose and specify one of two coherent contracts:

   - Preferably, make it a true post-state invariant: for every committed live resource, the protected holder count is at least one. Require `bootstrapRole == lastHolder.protect` or define an equivalent initial-holder rule; require resource creation to atomically establish that holder; reject userless creation unless a privileged writer supplies a protected holder; validate or explicitly migrate every existing/imported resource; define initialization for the app singleton; and permit teardown waiver only when the resource is absent in the final committed state.
   - Alternatively, narrow and rename the feature as a nonempty-to-empty transition guard, explicitly admit that resources may start and remain stranded, and remove claims that it prevents a protected role from ever being empty.

   Validation must add resource creation without bootstrap, mismatched bootstrap/protected roles, brownfield activation, import, app-global initialization, and delete/recreate final-state cases.

2. **Severity: NON-BLOCKING — the physical index contract is ambiguous and has a concrete implementation trap.**

   **Concrete evidence:** §“Declaring a membership table” requires a generated unique `(principal, resource)` index, while §“Writes” relies on “the declaration’s `(resource, role)` index” for `lastHolder`; the latter index is never explicitly added to the generated schema surface. In current code, `src/storage.rs::create_index` unconditionally appends `_id` and emits plain `CREATE INDEX`. Merely adding `UNIQUE` to that existing path would produce uniqueness over `(principal, resource, _id)`, which would not enforce one row per pair.

   **Resolution criterion:** Assign the implementing spec an explicit physical contract: a true unique key over exactly `(principal, resource)`—or principal plus the defined app-singleton representation—without `_id`, plus a separate non-unique `(resource, role, _id)` lookup index when holder-set operations need it. Clarify that correctness of captured range dependencies does not depend on the query planner choosing that physical index.

3. **Severity: NON-BLOCKING — the document’s revision history is internally inconsistent.**

   **Concrete evidence:** The `Revised` header says the RFC was refined through ten dual-family rounds, while §“Status” says eight rounds and that the current revision incorporates round-eight findings.

   **Resolution criterion:** Make the header and §“Status” state the same revision count and current-review boundary.

## 4. Suggestions

- Compile each declaration into two distinct enforcement layers: per-operation authorization and commit-time final-state constraints. A final-state checker over affected `(declaration, resource)` keys could enforce uniqueness, referential integrity, immutable axes, and `resource absent OR protected-holder-count ≥ 1` uniformly across Ibex, HostPlan, import, seed, and administrative paths.

- Add an explicit resource-lifecycle writer matrix alongside the membership writer matrix. It should cover raw resource creation/deletion, HostPlan, seed, import, reset/restore, administrative edits, and multiple membership declarations referencing one resource.

- In the implementing spec, distinguish a membership insert against a pre-existing resource—captured as an ordinary Row dependency—from bootstrap against a resource buffered in the same mutation, which must rely on the transaction-local creation witness and prospective post-state.

- Add model-based validation that generates transition sequences and concurrent pairs from the declared matrix. Compare each outcome against a simple reference post-state evaluator; this would exercise combinations beyond the hand-written seat/promote/kick cases.

- Consider a generated lint or doctor warning when a handler reads a membership table and returns an unconstrained result. It cannot prove output non-disclosure, but it could make the admitted handler trust boundary more visible.

## 5. Open questions

- Is `lastHolder` intended to be a total invariant of every live resource, or only a guard against transitions from one holder to zero?

- What is the brownfield adoption policy when existing or imported resources have no protected holder: refuse activation, require an explicit migration, or permit a temporary staged state?

- Must `bootstrapRole` equal the protected role? If not, what operation establishes the protected role before commit?

- May `system` or another userless authority create a resource governed by `lastHolder`, and if so, how is the initial holder supplied without weakening the system-authority write restrictions?

- How do reset, declared restore, import replacement, and same-id resource recreation interact with deletion witnesses, transition logs, and final-state holder checks?

- Should principal deactivation be refused when it would make the sole protected holder unreachable, or is a diagnostic plus application-owned recovery sufficient?

- What measured global authorization-version blast radius would trigger declaration-scoped narrowing before this primitive is recommended broadly?

## 6. Readiness verdict

The core design is good, consistent with LLP 0011, LLP 0039, LLP 0053, and LLP 0055, and its protocol deferrals are appropriate for an RFC. The unresolved `lastHolder` initialization and lifecycle gap is nevertheless a material correctness defect: the stated invariant can be false immediately after creation, activation, or import, and the current validation plan would not catch it.

VERDICT: NOT READY

### Orchestrator verification notes — round 12 (not part of the received review)

**The best finding on this document in the whole loop, and it is exactly right: `lastHolder` never _established_ the invariant it claimed.** It only refused transitions that would empty the protected set — which is vacuous if the set was never populated. Create a resource without seating a holder, declare `lastHolder` over existing resources that have none, mismatch `bootstrapRole` against `protect`, or use it on an app-singleton with no creation event, and the protected set is empty from birth, so the refusal never fires and guards nothing. The invariant now has **three legs**: **establishment** (a protected declaration must set `bootstrapRole` to the protected role, and creating a resource is refused unless the same transaction seats its bootstrap holder — the witness must be *spent*, not merely available), **preservation** (the transition refusal, for every writer), and **validation** (activation and import refuse when any live resource lacks a holder). `lastHolder` is now a manifest error on `scope: "app"` declarations, which have no creation event to anchor establishment on. Also pinned: the unique index is **total, not partial** (both key columns are non-null by declaration and the app singleton is a system constant, so no NULL row can silently defeat uniqueness).

## Round 13 — 2026-07-13 (RFC altitude)

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session; method cli-runner. Brief carried the author's ratified altitude ruling. (The CLI process exited nonzero on a post-completion error, but the review itself was received in full and is recorded verbatim below — a real review that happened, not a reconstruction.)
**Revision under review:** sha256 `d8d7d465713b7107ae1d438152d0758e81840cd9d0dff72a2a3350ddf48138af`
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong and unusually thoughtful RFC. Making scoped roles system-recognized application data—rather than session claims—is the right direction. The transition matrix, captured membership reads, fail-closed visibility, and explicit LLP 0053 mapping form a coherent design that fits Snapback’s existing architecture.

The implementation cross-check supports its feasibility claims. `ValueExpr` and `QueryPlan` cannot currently express membership semi-joins; `IndexManifest` lacks uniqueness; HostPlan classifies membership guards as outgrown IR; and both `src/live_matcher.rs` and `src/storage.rs` ignore `CapturedReadKind::Permission` while honoring ordinary row/query dependencies. The RFC correctly identifies each limitation and proposes compatible extensions.

The protocol-level deferrals are appropriate at RFC altitude and are not a reason to withhold readiness. There is, however, one material design defect: the claimed closure of permanent `lastHolder` stranding does not survive a valid multi-holder lifecycle. That counterexample also escapes the proposed validation suite. The RFC should not advance until the invariant and its composition with LLP 0055 are corrected.

## 2. Strengths

- **§Summary and §What stays out of the session:** Treating roles as fresh application data while preserving LLP 0039’s rule that real sessions have empty `ctx.auth.roles` avoids stale authorization claims and composes cleanly with dev impersonation.

- **§Writes: a declared transition policy, closed by default:** The host-derived, disjoint caller classes and transition matrix express invite, accept, leave, promotion, kick, and bounded patching without caller-supplied authorization claims. Field-bound insert and patch rules close meaningful privilege-escalation paths.

- **§Writes: `lastHolder`, referential integrity, and teardown:** The RFC correctly recognizes that holder counts, resource existence, and roster emptiness are race-defeasible aggregate reads. Capturing all three and introducing symmetric creation/deletion witnesses is a sound design.

- **§Rule helpers and §Invalidation:** Using ordinary `Row`/`MissingRow`/`Query` captures—including empty-result queries—matches the actual matcher and commit-validation behavior. Avoiding `CapturedReadKind::Permission` is essential and correctly justified by `src/live_matcher.rs` and `src/storage.rs`.

- **§Rule helpers:** Reusing `SNAPBACK_AUTH_PERMISSION_DENIED`, keeping client-visible denial details invariant, and placing richer explanations on gated doctor/audit surfaces respect LLP 0011 and LLP 0053’s trusted-denial contracts.

- **§Agents:** The `authorityCreating` composition with LLP 0055 correctly identifies delegated membership writes as durable privilege creation. Requiring full transition provenance, while exempting structurally constrained bootstrap-only writes, is well reasoned.

- **§Non-Goals, §Delivery lanes, and §Protocol obligations deferred to implementation:** The RFC is candid about online-only role-gated reads, conservative `live_replace`, global authorization-version cost, missing HostPlan support, and implementation-spec obligations. This is good RFC scoping rather than hand-waving.

## 3. Concerns

1. **Severity: MATERIAL — LLP 0055’s sole-holder deactivation check does not close permanent `lastHolder` stranding.**

   **Evidence:** §Declaring a membership table says principal identifiers receive shape validation only and memberships may survive deactivation. §Writes defines `lastHolder` strictly as row existence and explicitly admits that an inactive principal may be the sole surviving holder. It then claims the permanent case is closed because LLP 0055 refuses deactivation when an agent is the sole holder. LLP 0055 §Principal kinds pins exactly that sole-holder test.

   A permitted schedule defeats it:

   1. Agents A and B both hold the protected role.
   2. A is permanently deactivated; this succeeds because A is not the sole holder, and A’s membership remains.
   3. B leaves, is demoted, expires, or is deactivated. The holder-set check still sees A’s row, so B is not the final row and the operation may succeed.
   4. The resource is left with only permanently deactivated A.

   A similar state can be reached by seating an already-deactivated or nonexistent principal, because `v.principal()` does not check existence or activity. This contradicts §Writes’ claim that only a recoverable live-but-unreachable residual remains and LLP 0055’s claim that permanent deactivation “can never strand” a protected resource. The §Validation Requirements test only the one-holder case and therefore would not catch this schedule.

   **Resolution criterion:** Pin one coherent policy and test it adversarially. A strong resolution would define an “eligible protected holder” that excludes permanently deactivated principals, require eligibility when inserting/promoting into a protected role, and preserve at least one eligible holder across removals, demotions, expiry, deactivation, activation, and import. A simpler conservative policy is to refuse deactivation while the agent holds any protected role and reject protected-role grants to inactive principals, forcing removal or transfer before deactivation. Add sequential and concurrent tests for “deactivate A, then remove/demote/expire/deactivate B” and for granting a protected role to an already-deactivated principal.

2. **Severity: NON-BLOCKING — the app-wide reset boundary is implicit rather than represented in the writer and validation matrices.**

   **Evidence:** §Writer-class matrix and §Validation Requirements enumerate Ibex, HostPlan, seed, import, admin edits, and `--as-membership`, but not `app.reset` or reset-plus-seed. The current `src/storage.rs:828` `reset_and_seed` path directly deletes every physical user table before calling `seed_into_transaction`; it does not pass those deletions through the ordinary `apply_buffered_writes` seam. §Invalidation mentions reset only as LLP 0053 event 3.

   **Resolution criterion:** Add an explicit reset/reset-plus-seed row. State that an unseeded app-wide reset may waive per-resource teardown checks because resources and rosters disappear atomically, while reset-plus-seed must validate the complete final membership predicate—referential integrity, vocabulary, uniqueness, and protected-holder establishment—before commit. Exercise the actual `reset_and_seed` path in validation.

3. **Severity: NON-BLOCKING — the RFC relies on a `(resource, role)` index that it never clearly declares.**

   **Evidence:** §Writes says `lastHolder` captures a range over “the declaration’s `(resource, role)` index,” but §Declaring and §What exists, what this adds only promise a generated unique `(principal, resource)` index. That ordering does not efficiently serve holder-set checks, roster reads, teardown, or `clearForResource`.

   **Resolution criterion:** Declare a generated secondary index beginning with `(resource, role)`—and, if useful, a resource-only or `(resource, role, principal)` shape—or clarify that “index range” means a logical captured predicate rather than a physical index and add an explicit performance requirement for these operations.

4. **Severity: NON-BLOCKING — inline provenance visibility is not pinned alongside the member-list preset.**

   **Evidence:** §Declaring says membership rows appear in generated client types and offers a “members see the member list” preset. §Agents adds `grantedByActor`, `grantedByEffective`, and `grantedByGrant` directly to those rows. The deferred transition-ledger redaction work does not state whether these inline columns are included in ordinary roster projections.

   **Resolution criterion:** State whether provenance columns are hidden by default, exposed only through a gated audit projection, or intentionally included in ordinary member-list reads. Add a validation case proving the chosen projection.

## 4. Suggestions

- Require `bootstrapRole` and `lastHolder.protect` to name an active entry in `roles`, never a `pendingRoles` entry.

- Consider an atomic generated `transferProtectedRole(resource, successor)` operation. It would give ownership handoff and agent deactivation a safer, more explainable path than independently inserting and removing rows.

- Add resource-addressed `acceptInvite` and `declineInvite` helpers bound to the effective principal. The current `setRole(memberId, …)` surface otherwise requires application code to discover a pending row that the blessed roster preset deliberately hides.

- Normalize public failures from generated membership mutations where different errors could reveal a hidden row’s existence or role; retain detailed explanations in doctor/audit output.

- Remove or narrow the §Open Questions reference to membership rows whose resource has been deleted. The operative design says such rows are unreachable through live writes, activation, and import; only corruption or legacy-data recovery remains open.

- Reconcile the document metadata: the `Revised` header says ten dual-family rounds, while §Status says thirteen rounds, twenty-two reviews, and round-12 changes newer than the last review.

- Give the blast-radius instrumentation a concrete graduation or warning threshold before reference applications bless high-churn membership tables.

## 5. Open questions

- Is `lastHolder` fundamentally intended to preserve a row, or to preserve an actionable control path? The motivating language suggests the latter, while the formal invariant currently guarantees only the former.

- Which principal lifecycle states count as eligible for protected roles, and where is that status read and captured atomically?

- What supported recovery path exists if historical or corrupted data contains only inactive protected holders?

- Should app-global declarations eventually support a corresponding nonempty-admin invariant, or is that permanently application-owned?

- Which v1 limitation should be lifted first: multi-role membership, cross-declaration authority, or declaration-scoped invalidation narrowing?

- What are the default projection and retention policies for inline provenance and the full transition ledger?

## 6. Readiness verdict

The central design is good and largely consistent with LLP 0011, LLP 0039, and LLP 0053. The deferred protocol work is appropriately identified. However, the admitted two-holder deactivation schedule disproves a load-bearing safety claim shared with LLP 0055 and is absent from validation. That material lifecycle defect must be resolved before the RFC is ready.

VERDICT: NOT READY

### Orchestrator verification notes — round 13 (not part of the received review)

**This is the sharpest finding of the entire loop, and it defeats the orchestrator's own round-12 fix.** `lastHolder` counted **rows**, not holders who can actually act — so a two-step schedule strands a resource permanently, with every individual step legal:

1. Agents A and B both hold the protected role.
2. **Deactivate A** — allowed, because A is not the *sole* holder.
3. **B leaves** — also allowed, because the row-counting check still sees **A's row**.
4. The resource is now held only by permanently-deactivated A. `lastHolder` itself forbids clearing that row, so it is stranded **forever**.

The reviewer also noted a second entry to the same state: `v.principal()` validates *shape*, not existence or activity, so a **deactivated principal could be seated as `host` outright**.

Fixed in both documents by changing the unit of the invariant from a row to an **eligible holder** (one whose principal is not permanently deactivated):

* **LLP 0056** — no writer may leave the **eligible** holder set empty; an ineligible principal may never be inserted or promoted into a protected role ("the set cannot be kept full with corpses"); activation and import validate eligibility.
* **LLP 0055** — deactivation is refused whenever it would leave a protected resource with **no eligible holder**, rather than only when the agent is the *sole* holder.

The adversarial schedule (deactivate A → B leaves → **refused**) is now an acceptance row in both documents, along with the seat-a-dead-principal negative.

---

## Note on the loop's shape

The `/llp-super-refine` loop ran **twelve** dual-family rounds (fresh Claude
Fable 5 Max and GPT gpt-5.6-sol ultra reviewers each round, none with memory of
prior rounds). It paused after round 8 short of convergence, because the two
families had reached a disagreement about **altitude** rather than correctness —
one holding the document to executable-protocol standards, the other to
RFC-altitude design pins — and because the production-agent question was a
product decision no reviewer could make.

The author (Charlie) settled both on 2026-07-13:

1. **Altitude ratified** — RFC, not protocol spec; protocol rigor is deferred to
   implementation time, per the same call already ratified for the parent
   umbrella (LLP 0039 §Protocol obligations, 2026-07-12).
2. **Agents on `prod` — yes.** The orchestrating session's framing of the question
   was wrong: it had assumed the *operator* was the only party who could ever
   re-credential an agent, when in fact **agents have owners**, and an owner
   re-issuing their own agent's credential is app policy — no more privileged than
   rotating an API key they already hold.

The loop then resumed with the ratified standard in the reviewers' briefs, and
findings dropped sharply and became precise. `/llp-super-refine` authorizes only
the Draft→Review transition, and only on convergence; no reviewer accepts on the
author's behalf.
