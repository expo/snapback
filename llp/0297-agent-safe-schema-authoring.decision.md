# LLP 0297: Agent-safe schema authoring

**Type:** Decision
**Status:** Draft
**Systems:** Developer experience, Authoring, Schema, Application data API,
Code generation, Authorization, Assets, Migrations, Diagnostics, Testing
**Author:** Seth Webster / Codex
**Date:** 2026-08-21
**Revised:** 2026-08-21 (initial Draft from the authoring review of a
Facebook-like data model)
**Related:** LLP 0000, LLP 0004, LLP 0037, LLP 0044, LLP 0065, LLP 0080,
LLP 0081, LLP 0110, LLP 0146, LLP 0178, LLP 0231, LLP 0239, LLP 0240,
LLP 0252, LLP 0253, LLP 0264, LLP 0278

## Summary

Snapback will make schema declarations safer for agents by replacing
string-linked facts with typed declaration handles, adding a direct enum
spelling, grouping table policy in one explicit configuration, and compiling
common data invariants into closed schema declarations.

The same direction includes three higher-stakes additions:

- exhaustive visibility policies over a stored enum;
- closed discriminated-row constraints and one-hop child-policy inheritance;
  and
- declared chronological pagination and maintained relationship counts.

These additions must lower into the same
`NormalizedApplicationDefinitionV1` boundary that both current authoring
profiles use. They may extend the normalized definition and the Rust-owned
artifacts that represent it. They may not create profile-specific runtime,
storage, authorization, asset, or migration behavior.

This Decision selects the product direction. It does not fix the final source
spelling, claim implementation, or change the current
`snapback-explicit-v1` and `snapback-familiar-ts-v1` contracts. Follow-on
Specs must define each closed grammar, artifact change, migration, diagnostic,
and proof before a new profile revision ships.

## Context

Snapback's current schema language has good properties for agents. Definitions
are source-authored, local to a backend, deterministic, and checked by codegen.
Tables carry their indexes and policies beside their fields. Generated
artifacts expose the result for inspection. LLP 0004 requires schema parsing to
fail closed with source spans, and LLP 0037 gives the runtime artifact shapes
one Rust-owned source of truth.

The remaining mistakes are usually plausible rather than syntactic:

- a field, table, index, or upload intent is renamed in one string but not
  another;
- a closed string domain is written as a long union and later weakened to
  `v.string()`;
- one table omits visibility, asset sharing, or sync policy at the end of a
  method chain;
- an upload intent and its attaching field drift across source files;
- an `audience` column appears to protect a row while table-wide
  `public-read` still admits every row;
- a heterogeneous child row admits impossible field combinations; or
- an application rebuilds cursor keys and counters that the backend could own.

LLP 0146 identifies plausible code as the dominant agent defect class. Better
documentation helps, but it cannot make a stale string reference, an uncovered
audience variant, or an invalid attachment row unrepresentable.

Several accepted or active designs constrain the answer:

- Both authoring profiles lower to one normalized definition and cannot branch
  after normalization. LLP 0252 owns this rule.
- Rust owns shared artifact shapes. An authoring convenience may lower to an
  existing artifact shape, or it may commission a versioned Rust-owned
  extension under LLP 0037.
- Authorization declarations must stay closed, analyzable, bounded, and based
  on server-derived identity. LLP 0231 and LLP 0240 reject arbitrary per-row
  policy code.
- One installed table policy is the read and write locus. LLP 0264 grants
  generic writes only to its admitted owner posture and does not treat public,
  membership, or disjunctive read access as write authority.
- Asset references retain the upload-intent, attachment, delivery,
  authorization, and garbage-collection custody defined by LLP 0044. A shorter
  declaration cannot weaken those checks.
- Media-only zero-to-many relationships use LLP 0239's `assetCollection`.
  Heterogeneous application attachments remain ordinary bounded child rows.
- Portable pagination and aggregate work should compose with LLP 0278 rather
  than create a second cursor or aggregation contract.

## Decision criteria

The chosen design must satisfy these criteria:

1. Codegen catches a stale reference before activation.
2. Security-relevant omissions fail or remain visibly explicit.
3. The normalized definition contains every semantic fact.
4. Both authoring profiles can lower to the same fact without runtime branches.
5. The compiler can explain the effective result without evaluating arbitrary
   application code.
6. Current v1 applications keep working until they opt into a new profile
   revision or a reviewed migration.
7. SQLite, Postgres, retained data, live queries, assets, and generated clients
   observe one meaning for each declaration.

## Options

### Keep the current grammar and improve documentation

This option preserves one spelling and has no migration cost. It does not
address stale string references, accidental policy omissions, or invalid
cross-field combinations. The compiler has no new fact to verify.

### Add only rename and lint tooling

This option catches common edits while leaving the stored source string-based.
It improves maintenance but does not make new declarations safe by
construction. A generated or hand-edited file can still bypass the rename
command.

### Add arbitrary callbacks for policies and constraints

This option is expressive and familiar. It makes authorization, invalidation,
search, retention, asset delivery, and migration depend on opaque JavaScript.
The compiler could not prove that every audience case is covered or that two
targets agree. This option is rejected.

### Adopt an entity or ORM framework

This option could bundle relationships, policy, indexes, and derived fields in
one object model. It would create a second data abstraction beside Snapback's
portable document and relational model. It would also make the source model,
normalized definition, and runtime model harder to compare. This option is
rejected.

### Add a closed, typed schema profile that lowers to the existing model

This option keeps the current architecture and gives codegen more facts. It
requires new declaration grammar, artifact fields, migration rules, and proof.
It is selected.

## Decision

### D1. One normalized definition remains the semantic boundary

Every new schema convenience must lower before artifact emission. Runtime,
storage, clients, authorization, assets, and migration consume only the
normalized definition and its Rust-owned projections.

The normalized definition must preserve whether a fact was authored,
profile-defaulted, or migrated when diagnostics need that provenance. The
provenance cannot change runtime semantics after admission.

The current `snapback-explicit-v1` and `snapback-familiar-ts-v1` profiles stay
unchanged. New grammar ships through a versioned successor profile or another
explicit compatibility mechanism chosen by the implementation Spec. Snapback
must not reinterpret existing source silently.

### D2. References use declaration handles where JavaScript permits them

New schema grammar will admit typed handles for tables, fields, indexes,
authority profiles, asset intents, and generated relations. The compiler will
resolve each handle to the same stable name and identity that current manifests
carry.

The desired authoring shape is illustrative:

```js
authorProfileId: v.id(profiles),
avatar: v.optional(v.assetRef(avatarUpload)),
```

Index and policy builders should receive checked field handles instead of raw
field strings. A callback can select fields only from the table declaration
object. It cannot execute as application policy:

```js
indexes: {
  byAuthor: index((table) => [table.authorProfileId]),
},
```

The implementation Spec must solve forward and self references without
depending on JavaScript temporal-dead-zone accidents. A two-phase declaration,
a schema callback, or another statically resolved handle grammar is acceptable.
Falling back to a raw string for every self reference is not the target.

String forms remain readable compatibility input during migration. Codegen
must normalize a string and its equivalent handle to one semantic fact. New
generated examples and templates use handles after the successor profile
ships.

Snapback will also provide a previewing rename command. It must update all
resolvable source references, regenerate, show unresolved dynamic references,
and refuse to claim completion while any stale reference remains.

### D3. `v.enum` becomes the direct spelling for closed string domains

The successor grammar will admit:

```js
audience: v.enum(['public', 'friends', 'private']),
```

`v.enum` lowers to the existing stored literal-union domain. It retains the
same value bounds, storage representation, central write validation, generated
literal-union type, schema identity, and LLP 0081 migration rules.

This Decision supersedes only LLP 0004's dated deferral of a dedicated enum
spelling. It does not change that document's stored-domain semantics. The
existing `v.union` of string literals remains compatible input. Codegen
normalizes both forms to one enum fact and may offer an addition-only source
rewrite. It must not create two runtime enum kinds.

The implementation Spec must decide whether the same `v.enum` constructor is
legal in arguments, stored fields, results, and refusal details. If one context
cannot preserve the exact existing contract, generation must refuse there
instead of approximating.

### D4. A table may declare fields and policy in one closed configuration

The successor grammar will admit an object form that groups fields, indexes,
visibility, asset sharing, sync, constraints, and derived facts. Method chains
remain compatibility input.

An illustrative shape is:

```js
export const posts = defineTable(
  {
    ownerId: v.principal(),
    authorProfileId: v.id(profiles),
    body: v.string(),
  },
  {
    indexes: {
      byAuthor: index((table) => [table.authorProfileId]),
    },
    visibility: owner((table) => table.ownerId),
    sync: true,
  },
);
```

The object is closed. Unknown keys refuse with a source path. Codegen records
every profile default in the normalized definition. A default cannot disappear
from inspection merely because the author omitted its source spelling.

New sessions-mode templates must make table visibility explicit. Asset-bearing
tables must make asset sharing explicit whenever an intent permits reads through
references. A successor profile may require an explicit sync choice. Changing
the Familiar v1 sync default requires a new profile revision and migration
preview, not an in-place reinterpretation.

The configuration does not create a second write-policy declaration. It must
project the write posture derived from the installed table policy under LLP
0264. If a new read-policy kind needs a new write posture, both facts extend one
shared policy representation and receive one governing Spec.

### D5. Asset intents are shared declaration handles

An application may define asset intents in a shared authored module and import
the same handle into schema fields, commands, and mutation attachment code.
The exported binding remains the stable intent id that LLP 0044 requires.

The handle lowers to the existing intent identity, policy generation,
implementation identity, and generated client reference. Importing the handle
does not move an authorizer into the schema evaluator, capture ambient module
state, or let a client widen policy.

The implementation Spec must define source discovery and dependency identity
for the shared module. Any import cycle, dynamic reference, or unexported
declaration that prevents exact resolution must refuse at generation.

### D6. Enum-selected visibility is exhaustive and closed

Snapback will support a visibility declaration selected by a stored enum when
each case lowers to an existing closed authority operation. The desired shape
is illustrative:

```js
visibility: visibilityBy((table) => table.audience, {
  public: publicRead(),
  friends: anyOf(
    owner((table) => table.ownerId),
    memberOf(friendships, {
      resource: (table) => table.authorProfileId,
      role: 'friend',
    }),
  ),
  private: owner((table) => table.ownerId),
}),
```

Codegen must prove all of these facts:

- the selector is a required stored enum field;
- every enum value has exactly one case;
- no unknown case exists;
- each arm lowers to public, owner, membership, or an admitted authority
  profile operation;
- every field, relation, role, and index has the required nominal type;
- the policy has one exact generic-write posture, or generic writes refuse;
- the target can compose the resulting policy into each requested query,
  live, search, retention, and asset lane; and
- negative authorization changes enter the existing invalidation path.

There is no default case and no arbitrary predicate callback. A target that
cannot carry one case refuses the schema or the dependent function. It must not
fall back to client filtering or broad `public-read`.

This decision extends the closed policy representation. It does not weaken LLP
0231's rejection of opaque per-row policy code. A dedicated authorization Spec
must define the policy representation, storage pushdown, live invalidation,
search, asset sharing, retention eligibility, write posture, migration, and
negative tests before this declaration ships. Public visibility must never
become public write authority. A common owner field can authorize writes only
when the shared policy representation and central transaction checks say so.

### D7. Discriminated child rows declare valid field combinations

Snapback will admit a closed row constraint selected by a required stored enum.
Each case declares which fields are required and which fields are forbidden.
The compiler validates all writes at the central commit boundary, including
handler, plan, seed, import, migration, and admin writers.

A heterogeneous post attachment is the motivating example:

```js
export const postAttachments = defineTable(
  {
    postId: v.id(posts),
    position: v.integer(),
    type: v.enum(['image', 'video', 'url', 'other-post', 'file']),
    asset: v.optional(v.assetRef(postAttachmentUploads)),
    url: v.optional(v.url({ protocols: ['https', 'http'] })),
    referencedPostId: v.optional(v.id(posts)),
  },
  {
    constraints: [
      discriminatedBy((table) => table.type, {
        image: requireOnly((table) => [table.asset]),
        video: requireOnly((table) => [table.asset]),
        file: requireOnly((table) => [table.asset]),
        url: requireOnly((table) => [table.url]),
        'other-post': requireOnly((table) => [table.referencedPostId]),
      }),
    ],
  },
);
```

The snippet does not fix the final `v.url`, multi-intent asset, or constraint
spelling. It fixes the semantic requirement. A row cannot commit with both a
URL and an asset, with no payload for its type, or with a referenced post under
the `image` type.

Media-only collections continue to use LLP 0239's `assetCollection`.
`postAttachments` is an application-owned child table because URL and
other-post attachments are not assets.

The constraint grammar is closed. V1 may require or forbid top-level fields,
compare scalar literals, and apply validator-owned checks such as URL protocol
admission. It may not run arbitrary JavaScript, fetch a URL, inspect an asset's
bytes, or perform an undeclared multi-row lookup.

### D8. One-hop child policy inheritance is declared, never inferred

A child table may declare that visibility or asset sharing follows a required
parent reference. Codegen must bind the exact parent table, child field, parent
policy generation, and required indexes.

This feature is a bounded one-hop policy relation. It is not a generic join or
an inference from a field named `postId`. The normalized definition records the
dependency so authorization invalidation can re-evaluate child delivery when
the parent policy or membership changes.

If a target, query class, search lane, retention lane, or asset-delivery lane
cannot compose the inheritance, generation refuses that use. An application
may instead denormalize the governing authority field under a maintained
invariant, or use the existing named-handler authorization path. Snapback must
not widen the child table to make the composition work.

The authorization Spec commissioned by D6 also owns the exact inheritance
grammar and proof. D7 can ship without D8 if authors repeat an explicit policy
on the child row and codegen proves that policy independently.

### D9. Pagination uses server-owned chronology and opaque cursors

The successor grammar will offer a chronological index over a server-owned
creation time with the row id as the deterministic tie-breaker. Authors should
not synthesize `pageKey` from a timestamp and a runtime id for the common
created-order case.

The generated query contract uses LLP 0278's declared page envelope and opaque
cursor. This Decision does not create a second cursor format. The storage and
migration Spec must define how SQLite and Postgres index the server-owned time
and id pair, and how existing `pageKey` applications preview a migration.

Applications can keep an authored immutable sort key when product ordering is
not creation order. The chronological helper is a common-case declaration, not
a ban on domain-specific ordering.

### D10. Common relationship counts are maintained declarations

Snapback will support a bounded maintained-count declaration for a child table
grouped by one required parent reference. Examples include reactions per post,
comments per post, and followers per profile.

The declaration must reuse LLP 0080's transaction, fan-out, direct-write,
rebuild, and equivalence rules. Current `MaintainedProjectionPlanV1` does not
admit aggregates, so a companion extension must define the count plan rather
than pretending that the current projection grammar already expresses it. The
server updates the source row and count in one transaction, supplies backfill
and repair, and exposes provenance in inspection. No application mutation may
patch the derived count directly.

LLP 0278 D4 remains the owner for set-keyed live aggregate delivery. A stored
maintained count and a set-keyed live aggregate are different products and must
share one source fact when both exist. The follow-on Spec must define which one
is authoritative, how rebuilds work, and how deletion and migration preserve
the count.

### D11. Schema explanation and rename are first-class agent operations

Snapback will provide a schema explanation for one table or the complete app.
The operation emits both bounded JSON and readable text. At minimum it reports:

- normalized fields and validators;
- indexes and their deterministic tie-breakers;
- authored and profile-defaulted policy facts;
- every visibility case and authority dependency;
- the generic-write posture derived from the installed table policy;
- asset intent and sharing compatibility;
- row constraints and inherited parent policies;
- maintained projections;
- target capability requirements; and
- source locations for each fact.

The initial command may be named `snapback schema explain`. The implementation
Spec owns its exact command and artifact shape. A machine-readable projection
must exist even if the human command name changes.

The rename operation from D2 uses the same normalized source map. Both
operations must distinguish a complete answer from an unsupported or elided
answer. Silence cannot mean success.

## Consequences

### Benefits

- A rename fails during authoring instead of becoming a runtime mismatch.
- An audience enum cannot gain a value without a corresponding visibility
  decision.
- Attachment mutations no longer repeat cross-field shape checks.
- Asset policy has one importable declaration identity.
- New applications state security-relevant table policy in one place.
- Common feeds stop rebuilding chronological cursor keys and counters.
- Agents can inspect the compiler's effective schema instead of inferring it
  from method chains and defaults.

### Costs

- The normalized definition and Rust-owned artifact schemas gain new variants.
- Conditional visibility adds authorization and invalidation work to every
  target that claims it.
- Commit-boundary constraints must cover every writer class.
- Typed handles require a source grammar that handles forward references,
  self references, imports, and source maps without dynamic evaluation.
- One-hop inherited policy can add a bounded parent read to authorization and
  invalidation paths.
- Maintained counts need backfill, repair, migration, and corruption tests.
- Supporting old strings and new handles increases codegen compatibility work
  until migration completes.

## Compatibility and migration

Current Explicit and Familiar v1 source remains valid. This Decision does not
change its meaning.

A successor profile must provide a previewing source migration. The preview
must show:

- each string reference converted to a handle;
- each literal union converted to `v.enum`;
- each method-chain fact moved into table configuration;
- each implicit policy or profile default made visible;
- each manual `pageKey` or counter that is eligible for a generated
  declaration;
- each unresolved dynamic reference; and
- every semantic artifact change.

The migration applies only after regeneration proves that the normalized
definition is equivalent, except for changes that the author separately
accepts. Schema evolution then follows LLP 0081. A source rewrite cannot bypass
data migration or authorization broadening review.

## Required follow-on work

This Decision commissions separate implementation documents because the
security and storage work should not hide inside one syntax Spec:

1. A schema grammar Spec for typed handles, `v.enum`, table configuration,
   shared asset declarations, source migration, and schema explanation.
2. An authorization Spec for enum-selected visibility, its shared read and
   write posture, and one-hop child-policy inheritance. This Spec must receive
   security-focused review before implementation.
3. A constraint Spec for discriminated rows and commit-boundary enforcement
   across every writer.
4. An amendment or companion Spec under LLP 0080 and LLP 0278 for
   chronological indexes, cursor migration, and maintained-count composition.

Each implementation must update the guide and at least one shipped template.
The social-model acceptance app must include public, friends, and private posts;
heterogeneous post attachments; a parent visibility change; asset revocation;
pagination with equal creation times; and repaired reaction and comment counts.

## Acceptance

The decision is implemented only when all of these statements are proved:

1. Renaming a referenced field, table, index, authority profile, or asset
   intent cannot leave a stale admitted declaration.
2. String and handle spellings normalize to identical semantic facts during
   compatibility.
3. `v.enum` and its compatible literal-union spelling enforce one stored
   domain and one migration rule.
4. Adding an audience value without a visibility case fails generation.
5. No client filter can substitute for a missing server visibility case.
6. Public or relationship-based read access never grants generic write access.
7. Every writer refuses an invalid discriminated attachment row.
8. A parent authorization change invalidates dependent child delivery before
   unauthorized data or asset access continues.
9. Chronological pages neither skip nor duplicate rows with equal creation
   times.
10. Maintained counts survive concurrent create, delete, replay, backfill, and
   repair tests.
11. Explicit and Familiar successor-profile fixtures lower to the same
    normalized contract for equivalent source.
12. `snapback schema explain` reports every effective policy, constraint,
    default, and capability requirement used by the acceptance app.
13. Existing v1 fixtures retain their current semantic identities unless an
    explicit migration changes source.

## Risks

### The new grammar becomes a second product

Keeping v1 chains and strings indefinitely would double examples, tests, and
maintenance. The successor profile needs a migration path and a stop rule for
new template usage. Runtime semantics must remain single through the normalized
definition.

### Conditional visibility becomes an unbounded policy language

The exhaustive enum mapping is useful because it is closed. Adding arbitrary
predicates, callbacks, multi-hop joins, or target-specific clauses would lose
that property. New policy operations require their own decision and target
proof.

### Convenient inheritance hides authority

Child-policy inheritance can look like ordinary object traversal. The schema
explanation must name the parent, relation, policy generation, invalidation
dependency, and unsupported lanes. Source syntax alone is not enough.

### Derived data gains two owners

Handwritten mutations and maintained declarations cannot both own a count.
Activation must refuse direct writes to a derived field and provide one repair
authority.

### Handle syntax fights JavaScript initialization order

A handle design that works only for acyclic schemas would push self references
back to strings and teach two models. The grammar Spec must prove self and
forward references before the handle profile is accepted.

## Open questions

1. What exact two-phase or callback grammar provides typed self and forward
   table references in both JavaScript and TypeScript?
2. Does the successor ship first as Explicit v2, Familiar v2, or both in one
   release behind one normalized-definition gate?
3. Which current targets can push down enum-selected visibility without a new
   conservative online-only class?
4. How does enum-selected read visibility derive one exact LLP 0264 write
   posture for public rows that remain owner-writable?
5. Does one-hop inherited visibility require a stored parent policy generation
   on the child, or can invalidation derive the dependency from the relation?
6. Which URL validator facts belong in portable schema validation, and which
   URL safety rules belong in outbound fetch policy?
7. Does a heterogeneous attachment use one multi-intent asset field or separate
   typed asset fields per media kind?
8. When may codegen remove legacy string references from new output while still
   reading old source?
9. Which maintained-count declarations qualify for local sync and offline
   retained views?

## Status

Draft. The authoring direction is selected in this document, but no current
source profile or runtime capability changes until the required Specs are
accepted and implemented.
