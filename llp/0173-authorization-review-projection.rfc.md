# LLP 0173: Authorization review projection

**Type:** RFC
**Status:** Review
**Systems:** Authorization, Code generation, Generated artifacts, Diagnostics, Testing
**Author:** Codex (gpt-5.6-sol) / Charlie Cheever
**Date:** 2026-08-04
**Related:** LLP 0032, LLP 0037, LLP 0058, LLP 0062, LLP 0065, LLP 0100, LLP 0115, LLP 0170, LLP 0172

## Summary

Codegen should emit a small, deterministic, consumer-committed authorization
projection so reviewers do not have to reconstruct declared authority from a
digest-only artifact index and regenerable manifests. The projection reports
facts already present in the schema/function graph plus LLP 0172's requirement
provenance. It does not infer ownership, declare a query safe, or decide
whether a diff is an authorized widening.

This is deliberately narrower than rejected LLP 0170 §4. CI verifies that the
projection is current and deterministic through the existing generated review-
surface custody model. Git shows its diff. No baseline comparator, widening
partial order, or waiver language is introduced.

## Current state

`generated/artifacts.json` is the committed review manifest. It records the
complete inputs hash, bundle hash, cache graph, generated file digests, custody,
and a compact generation summary. Detailed `functions.manifest.json` and
`schema.manifest.json` are regenerable-cache projections. The function manifest
already carries effective auth requirements, runtime form, read/write
summaries, authorization-dependence dimensions, `EffectCeilingV1`, membership
HostPlans, and standard-pattern identifiers.

That custody split is correct for generated volume, but a reviewer cannot see
an authorization change from the committed index except as a changed digest.
LLP 0115 CV-14 separately proposes generic semantic summaries across dense
manifests. This RFC defines one stable security-focused projection and may
serve as an input to that generic diff renderer; it does not duplicate CV-14's
cross-artifact comparison program.

## Proposal

### 1. Artifact and custody

Codegen emits:

```text
generated/authorization-review.json
```

The artifact uses the existing `consumer-committed` custody class. Its entry in
`artifacts.json` names a versioned schema owned by codegen. Regeneration writes
the detailed cache graph first, derives this projection from the same verified
in-memory graph, and commits neither on generation failure. Existing generated-
artifact checks regenerate and fail on byte drift.

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
authorizationTables[]
```

`inputsHash` binds the projection to the same complete generation as the
schema/function pair. `authorizationTables` includes only existing schema facts
that affect authorization analysis: membership declarations and
permission-backing declarations. Version 1 invents no `owner`, `public table`,
`unscoped`, `writtenBy`, or waiver field.

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
| `standardPattern` | Existing versioned identifier or null. |

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

The committed JSON is the authority. Codegen may print a compact table derived
from those exact bytes after successful generation. The table groups operations
by effective requirement and flags, without policy judgment:

- `legacy-default` requirement origin;
- JavaScript/opaque predicate evidence;
- authored-basis effect ceilings;
- `authScopeField` as invalidation-only;
- membership and permission-backing tables; and
- additions/removals relative to a caller-supplied previous projection, if a
  generic diff tool requests them.

Human text cannot introduce a fact absent from JSON. It must not label a change
“safe,” “widening,” “reviewed,” or “waived.”

### 5. CI semantics

Required CI semantics are only:

1. schema-valid projection;
2. exact `inputsHash` agreement with the review manifest and generated pair;
3. deterministic regeneration;
4. consumer-committed custody; and
5. no stale projection after source changes.

The ordinary Git diff is the baseline selected by the reviewer. CI does not
fail merely because authority changed; it fails when the checked projection is
missing, malformed, or stale.

An automated widening gate is future work. It first needs a versioned baseline
authority, a partial order for each fact class, and scoped acknowledgement.
Examples are not interchangeable: authenticated→public, removal of an
`AuthUserId` filter, broader membership roles, new read tables, and a
static→declared effect-ceiling change require different comparisons. An
operation waiver would not authorize all of them.

## Security and claim boundary

- The projection reports declarations and structurally available facts. It is
  not runtime enforcement.
- JavaScript `reads`, `writes`, authorization dependence, and effect ceilings
  retain their authored/opaque status.
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
- No column write provenance.
- No free-text waiver.
- No CI authorization-widening policy.
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
8. No fixture expects CI to classify or reject a widening; a test asserts the
   implementation exposes no waiver or acknowledgement shortcut.
9. The human table is derived from parsed canonical JSON and is golden-tested
   to contain no `safe`, `widening`, `reviewed`, `waived`, or `discharged`
   verdict.

## Open questions

1. Should CV-14 consume this file directly or a shared internal semantic model?
   Either choice must leave this JSON schema stable for reviewers.
2. Does public `/inspect` need the requirement-origin fact? The review artifact
   is sufficient for this RFC; exposing it at runtime has a separate audience
   and compatibility cost.
3. What fact classes, if any, eventually deserve an automated comparator? That
   question is blocked on baseline and acknowledgement authority, not on this
   projection.
