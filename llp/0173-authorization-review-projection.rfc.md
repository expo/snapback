# LLP 0173: Authorization review projection

**Type:** RFC
**Status:** Implemented
**Systems:** Authorization, Code generation, Generated artifacts, Diagnostics, Testing
**Author:** Codex (gpt-5.6-sol) / Charlie Cheever
**Date:** 2026-08-04
**Revised:** 2026-08-15
**Related:** LLP 0032, LLP 0037, LLP 0058, LLP 0062, LLP 0065, LLP 0100, LLP 0115, LLP 0170, LLP 0172, LLP 0231, LLP 0234, LLP 0235, LLP 0240

## Summary

Codegen should emit a small, deterministic, consumer-committed authorization
projection so reviewers do not have to reconstruct declared authority from a
digest-only artifact index and regenerable manifests. The projection reports
facts already present in the schema/function graph plus LLP 0172's requirement
provenance. It does not infer ownership, declare a query safe, or decide
whether a diff is an authorized widening.

The projection also makes the post-2026-08-04 authorization surface visible:
effective table policy, plan classes that have not composed that policy,
call-local `ctx.db.elevated` uses, handler-enforced field-boundary residuals,
and authority-profile identity. Draft governed overrides, class-M masking, and
write-policy checks reserve versioned empty sections; this RFC does not
implement or activate those siblings.

This is deliberately narrower than rejected LLP 0170 §4. CI verifies that the
projection is current and deterministic through the existing generated review-
surface custody model. Git shows its diff. No approval authority, waiver
language, or general authorization-widening gate is introduced.

## Current state

`generated/artifacts.json` is the committed review manifest. It records the
complete inputs hash, bundle hash, cache graph, generated file digests, custody,
and a compact generation summary. Detailed `functions.manifest.json` and
`schema.manifest.json` are regenerable-cache projections. The function manifest
already carries effective auth requirements, runtime form, read/write
summaries, authorization-dependence dimensions, `EffectCeilingV1`, membership
HostPlans, standard-pattern identifiers, `fieldBoundary:` residuals, and
authority-profile dependencies.

Codegen also holds two relevant in-memory review projections: the codegen
summary's `tableVisibility` and `implicitAuthRequirements`. Uncomposed table-
policy surfaces are already exact structured diagnostics, and authority-profile
generation identity already lives on lowered schema tables. The authorization
review projection consumes those facts rather than deriving parallel answers.

That custody split is correct for generated volume, but a reviewer cannot see
an authorization change from the committed index except as a changed digest.
LLP 0115 CV-14 separately proposes generic semantic summaries across dense
manifests. This RFC defines one stable security-focused projection and may
serve as an input to that generic diff renderer; it does not duplicate CV-14's
cross-artifact comparison program.

## Proposal

### 1. Artifact and custody

Codegen emits, for every backend in the generated-artifact custody registry:

```text
generated/authorization-review.json
```

The artifact always uses the existing `consumer-committed` custody class; it is
not optional in `codegen.policy.json`. Its file record in `artifacts.json`
names `@expo/snapback-codegen/authorization-review.schema.json`, a versioned
schema owned by codegen. Regeneration renders it into the candidate graph from
the same validated in-memory tables, decorated functions, diagnostics, and
codegen summary used by the schema/function pair. It joins the closed file
inventory before hashing and atomic publication. Generation failure therefore
publishes neither the detailed graph nor the projection.

One canonical JSON form is normative: UTF-8, sorted object keys under the
repository's canonical serializer, operations sorted by generated name,
declarations sorted by stable ID, and set-valued arrays sorted and deduplicated.
No timestamps, absolute paths, package-manager paths, or host-specific values
enter the artifact.

### 2. Top-level shape

Version 1 contains:

```text
schemaVersion: snapback.authorization-review.v1
appId
authMode
inputsHash
operations[]
tablePolicies[]
authorizationTables[]
authorityProfiles[]
sectionSchemas
fieldPolicies[]
visibilityOverrides[]
tablePolicyTransitions[]
writePolicyChecks[]
```

`inputsHash` binds the projection to the same complete generation as the
schema/function pair. `tablePolicies` lists every application table's exact
normalized policy and whether it was `declared` or the current
`legacy-default` public-read behavior. This reuses the in-memory
`tableVisibility` summary rather than reclassifying schema builders.
`authorizationTables` includes only existing schema facts that affect
authorization analysis: membership declarations and permission-backing
declarations. `authorityProfiles` contains the frozen `AuthorityProfileV1`
identity (`id` plus `generation`) and its closed `roleLattice`; operations also
list the profile identities they depend on.

`sectionSchemas` pins schema identities for the additive sibling sections.
`fieldPolicies`, `visibilityOverrides`, `tablePolicyTransitions`, and
`writePolicyChecks` are present and empty in this implementation. The first
reserves LLP 0235 §6 without claiming class M; the middle pair reserve LLP 0234
D6 without generating an override or approval fact; the last reserves the
future LLP 0231 D6 write-policy slice. `maskedFieldUses` is likewise present
and empty on every operation. Populating any reserved section requires its
own governing implementation and a projection schema revision.

Version 1 invents no `owner`, `public table`, `unscoped`, `writtenBy`, approval,
or waiver declaration.

### 3. Operation facts

Each operation entry contains:

| Field | Meaning |
|---|---|
| `name`, `kind` | Stable function identity and Query/LiveQuery/Mutation/Action kind. |
| `runtimeClass` | `host-plan` or `javascript-handler`; never a safety ranking. |
| `handlerForm` | Existing inline/module/plan form when present. |
| `authRequirement` | `{ value, origin }`, with origin from LLP 0172: `explicit`, `derived`, or `legacy-default`. |
| `authorityIndependent` | Existing validated boolean, default false. |
| `authorizationDependence` | Existing sorted dimensions. For opaque JavaScript this is dependence evidence, not proof of row scoping. |
| `readSetSummary`, `writeSetSummary` | Existing exact dependency summaries, including mode, primary table, tables, and `authScopeField` where present. |
| `authorizationPredicates` | A normalized projection of structured HostPlan authorization-bearing filters and membership predicates; `opaque` for JavaScript. |
| `effectCeiling` | Existing version, basis, read/write/host-operation/authorization-input facts. `basis: declared` remains visibly distinct from `basis: static`. |
| `standardPattern` | Existing versioned pattern descriptor (or legacy identifier) or null. |
| `effectiveTablePolicies` | Exact table policies that the operation's composed read surfaces run under, with table, surface, declaration origin, and composition source. The single-table HostPlan entry states that activation re-derives the exact restricted predicate from the schema. Handler entries cover ordinary `ctx.db` read calls only. |
| `uncomposedReadSurfaces` | Every current `SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE` fact for the operation: relational root/joined, bounded-child parent/children, and snapshot-batch node surfaces, with table, declared policy, and analysis limit. |
| `elevatedDatabase` | Whether the runtime class and operation kind make call-local elevation available, plus every statically captured direct `ctx.db.elevated` member use, literal table when available, portable source span, and capture scope. Empty capture is not proof of absence for opaque module computation. |
| `authorityProfileIdentities` | Existing sorted `{ id, generation }` dependencies of the operation. |
| `fieldBoundary` | The existing handler-enforced masking residual or null, explicitly labeled `handler-residual` and never promoted to class-M enforcement. |
| `maskedFieldUses` | Reserved empty LLP 0235 operation section. |

`effectiveTablePolicies` and `uncomposedReadSurfaces` are deliberately
disjoint facts. A composed single-table plan reports the exact schema policy,
including public-read when the executable plan correctly omits a predicate.
The server's manifest validator independently re-derives the restricted
single-table predicate and rejects mismatch. An uncomposed relational,
bounded-child, or snapshot-batch table appears only in the uncomposed list; the
projection does not turn its declared table policy into a false execution
claim. Opaque handler-local narrowing is not inferred.

For JavaScript queries, live queries, and mutations, ordinary declared-read
tables report the caller-scoped `ctx.db` default. `ctx.db.elevated` use sites
are separate call-local facts: they bypass only class-R table visibility under
LLP 0231 D7 and do not erase the ordinary default from the rest of the handler.
Actions and HostPlans report elevation unavailable with
`captureCompleteness: "not-applicable"`. A statically captured
member use is review evidence, not a complete data-flow proof or a claim about
the handler's returned value.

`authScopeField` is rendered with a fixed semantic label:

```text
purpose: live-invalidation-disjointness
authorizationProof: false
```

It never increments a “scoped,” “safe,” or “discharged” count. An operation
whose JavaScript body correctly filters by `ctx.auth.userId` still renders
`authorizationPredicates: opaque`, because current codegen has not proved that
predicate. Honest opacity is preferable to an author assertion promoted into a
security fact.

For a closed HostPlan, `authorizationPredicates` reports syntax and binding,
not a universal verdict. Direct `AuthUserId` comparisons name table, field,
operator, and input. Membership entries name declaration, roles, and resource
reference class (`rowField`, `arg`, or `app`) with the typed table binding
already validated by codegen. Role-broad and argument-addressed predicates are
therefore reviewable without being misreported as row-ownership proofs.

### 4. Human rendering

The committed JSON is the authority. The diff renderer parses those exact bytes
and compares a caller-supplied prior projection with a freshly generated one.
It groups changes by stable operation/table name and renders compact facts such
as:

```text
messages.list:
  visibility: public-read -> membership(roomMembers, admin|member)
  effect: narrowing
```

`narrowing`, `broadening`, and `incomparable` are structural results of the
closed table-policy comparator, not approval or safety verdicts. An
unclassified fact change renders `changed`. The renderer also flags:

- `legacy-default` requirement origin;
- JavaScript/opaque predicate evidence;
- authored-basis effect ceilings;
- `authScopeField` as invalidation-only;
- membership and permission-backing tables; and
- additions/removals relative to the caller-supplied previous projection.

Human text cannot introduce a fact absent from JSON. It must not label a change
“safe,” “reviewed,” “approved,” “waived,” or “discharged.”

### 5. CI semantics

Required CI semantics are only:

1. schema-valid projection;
2. exact `inputsHash` agreement with the review manifest and generated pair;
3. deterministic regeneration;
4. consumer-committed custody; and
5. no stale projection after source changes.

`scripts/check-generated-artifacts` regenerates every registered backend, runs
the authorization-projection validator/staleness comparison against a fresh
check-only candidate, and includes every consumer-committed projection in its
Git diff gate. When policy bytes differ, it prints the human rendering before
the ordinary Git diff. CI does not fail merely because authority changed; it
fails when the checked projection is missing, malformed, has mismatched
`inputsHash`/schema authority/custody, or is stale.

An automated authorization-widening gate is future work. It first needs a
versioned baseline authority and scoped acknowledgement for each fact class.
Examples are not interchangeable: authenticated→public, removal of an
`AuthUserId` filter, broader membership roles, new read tables, and a
static→declared effect-ceiling change require different comparisons. The
human renderer's closed table-policy relation does not authorize any of them.

## Security and claim boundary

- The projection reports declarations and structurally available facts. It is
  not runtime enforcement.
- JavaScript `reads`, `writes`, authorization dependence, and effect ceilings
  retain their authored/opaque status.
- A captured elevated member and literal table are syntax facts, not a proof
  that every elevated access was found or that its use is justified.
- A declared table policy on an uncomposed surface remains a declared policy,
  not an effective enforcement claim.
- `authScopeField` is never treated as identity or row-filter proof.
- HostPlan predicate reporting does not establish the rejected general
  ownership-obligation rule; result provenance and policy semantics remain LLP
  0170 open work.
- The artifact contains no credentials, source bodies, row data, handler args,
  or absolute paths.
- Changing or deleting the projection cannot change runtime authority; the
  complete schema/function pair remains LLP 0058's executable carrier.

## Non-goals

- No owner declaration or derived authorization obligation.
- No column write provenance or write-path change.
- No free-text waiver.
- No CI authorization-widening policy.
- No governed override, approval, transition, or class-M field policy entry;
  their reserved arrays remain empty.
- No replacement for the complete function manifest, inspect endpoint, admin
  authorization explanation, or generic CV-14 semantic diff.
- No claim that a clean projection means an application is secure.

## Acceptance

1. Regenerating the same app twice produces byte-identical
   `authorization-review.json`; its `inputsHash` equals the artifact index and
   schema/function pair.
2. A seeded fixture covers all three auth requirements and all three origins,
   both runtime classes, static and declared effect ceilings, direct
   `AuthUserId`, row-field membership, argument membership, role membership,
   permission backing, and an `authScopeField`.
3. The `authScopeField` fixture renders
   `authorizationProof: false`; a leaking JavaScript handler carrying the field
   remains `authorizationPredicates: opaque`.
4. JavaScript declared reads/writes never render as statically proved effects;
   HostPlan facts retain `basis: static` only when the current ceiling validator
   proves them.
5. Changing only `auth`, a membership role/binding, an authorization-bearing
   HostPlan filter, a declared JavaScript table set, effect-ceiling basis, or a
   permission-backing declaration changes the committed projection.
6. Changing a non-authorization prose comment does not change it.
7. Removing, corrupting, or leaving the projection stale fails the existing
   generated-review-surface check before merge.
8. No fixture expects CI to classify or reject an authorization widening; a
   test asserts the implementation exposes no waiver or acknowledgement
   shortcut.
9. The human table is derived from parsed canonical JSON and is golden-tested
   to contain no `safe`, `reviewed`, `approved`, `waived`, or `discharged`
   verdict; its visibility effect words come only from the closed structural
   comparator.
10. Every generated operation reports its composed effective table-policy
    facts and every emitted uncomposed-surface diagnostic is projected exactly
    once under that operation.
11. An inline query and mutation using `ctx.db.elevated` list their captured
    read members and source sites; an action and HostPlan report the surface
    unavailable. Empty capture remains explicitly non-probative for opaque
    module computation.
12. Every `fieldBoundary:` appears as a handler residual, every authority
    profile carries its frozen generation hash and role lattice, and dependent
    operations carry the same profile identity.
13. The field-policy, override, transition, and write-check sections are
    schema-versioned and byte-stably empty. No Draft sibling entry is inferred.
14. The registered demo/package corpus commits the projection with
    `consumer-committed` custody; the staleness check and human diff renderer
    have focused deterministic tests.

## Open questions

1. Should CV-14 consume this file directly or a shared internal semantic model?
   Either choice must leave this JSON schema stable for reviewers.
2. Does public `/inspect` need the requirement-origin fact? The review artifact
   is sufficient for this RFC; exposing it at runtime has a separate audience
   and compatibility cost.
3. Which fact classes beyond the closed table-policy grammar eventually
   deserve an automated comparator? That question is blocked on baseline and
   acknowledgement authority, not on this projection.

## Revision history

- 2026-08-15 — Status Review → Implemented on author direction (Class R
  row-authorization completion program, sequence step 1: ship the
  authorization-review projection). The amended projection, generator,
  corpus artifacts, staleness checker, and structural diff renderer land in
  the same commit as this transition; the August-4 review round's artifacts
  remain under `llp/reviews/`.
- 2026-08-15 — refreshed the unimplemented proposal against landed table
  visibility, the server-re-derived single-table policy check, current
  relational/bounded/snapshot uncomposed diagnostics, LLP 0231 D7 call-local
  `ctx.db.elevated`, handler `fieldBoundary:` residuals, and LLP 0240 authority
  profile identity. Reserved empty, versioned schema room for Draft LLP 0234
  overrides/transitions, Draft LLP 0235 class-M projection facts, and future
  LLP 0231 D6 write checks; specified the focused staleness checker and
  structural human diff rendering without changing this RFC's status.
