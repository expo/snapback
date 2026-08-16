# LLP 0274: Explicit write-authority postures

**Type:** Spec
**Status:** Accepted
**Systems:** Auth, Security/authorization, Memberships, Storage, Code generation, Application data API, Generated artifacts, Diagnostics, Testing, Demo applications
**Author:** Charlie Cheever / Claude Fable (orchestrated) / Codex
**Date:** 2026-08-16
**Revised:** 2026-08-16 (author acceptance after the five-round dual-family
review loop converged READY on this revision — Codex gpt-5.6-sol xhigh and
Grok grok-4.6 xhigh, mutually blind per round; artifacts under
`llp/reviews/0274-*`). 2026-08-16 (round-5 minor fold: flip-marker-scoped
Phase-1a predecessor eligibility, self-contained 0234 amendment wording, and
three added D8 fixtures/precedence entries). 2026-08-16 (revision round 4:
protected migration-registry initialization, complete two-axis new-table root
admission, and named activation/prefix digest domains)
**Related:** LLP 0056, LLP 0065, LLP 0173, LLP 0189, LLP 0231, LLP 0234, LLP 0235, LLP 0240, LLP 0264

## Summary

LLP 0264 defines the first generic table-write slice: absent an explicit
write posture, an ordinary `owner` read policy derives owner-write and every
other declared ordinary read policy reaches the migration-pending/refused
default. Some applications deliberately need write authority that is not
derived from their read audience. This sibling adds exactly three explicit
postures to the same table-policy program:

- `membership-write`: an authenticated principal may write a target only when
  the authoritative transaction resolves an active roster row satisfying the
  declared resource binding and role bound;
- `authenticated-write`: any effective authenticated principal may use an
  admitted form, with host-owned latest-writer attribution; and
- `open-write`: any caller, including an anonymous caller, may use an admitted
  form.

No posture is inferred from `public-read`, `membership`, `any-of`, handler
logic, field names, or caller values. `open-write` is the only admitted
steady-state generic posture that permits anonymous mutation. Membership-write
resolves LLP 0264 OQ2 only for ordinary target tables; roster and other
authority tables remain owned by their specialized writer.

The author chose broad read/write pairing. That expressiveness is bounded by
three rules. First, every field on which the read policy discriminates is
immutable under all three explicit postures; membership's write resource field
is also immutable, and attribution may not collide with either set. Second, a
membership writer paired with a membership-restricted read must match one
read arm's declaration/resource-field pair exactly, so that matched arm cannot
be used to plant a row into a different membership audience. Additional
`any-of` arms are deliberate publication audiences of the declaration, not
audiences this one-arm pairing proof excludes. Third, the governance comparator refuses to call
a read narrowing self-proving when the retained write audience is broader than
the successor read audience or when formerly caller-controlled bytes become an
authority/attribution field.

Membership admission observes one unified transaction effect log in handler
program order. Both early JavaScript checks and commit admission see the exact
specialized membership-command prefix, so bootstrap/accept can establish a
seat for a following generic write while removeSelf revokes it for following
writes. This ordering and read-your-membership-writes overlay are new runtime
work, not a claim about the shipped seam.

The normalized write semantic identity becomes
`snapback.write-authority.v2`; ordinary-policy governance and the review
projection rotate to v3. Historical approved nodes are never rewritten.
Runtime authority comes from a closed installed-posture dispatcher and a
versioned host-constructed execution carrier, not from source scans, handler
input, or review artifacts.

## S0. Current boundary and verified ground truth

The implementation inspected on 2026-08-16 has only the LLP 0264 owner slice:

- `genericDisposition` branches on the read kind, and
  `generic_owner_write_field` returns an owner field, a Phase-1a non-owner
  pass-through, or a refusal. Both must instead branch on the installed write
  posture.
- `TableVisibilityV1` and `canonicalPolicyLeaf` are closed read carriers.
  `normalizePolicyBody` already has a sibling `writePosture` seam, but the
  authoring lowerer and runtime manifest carrier for an explicit posture do not
  exist.
- HostPlan and buffered-patch execution both skip an empty value map before a
  host restamp could be materialized.
- the buffered commit seam concatenates every ordinary buffered write before
  every specialized membership-plan write, discarding handler program order
  across the two classes. The JavaScript read-your-writes overlay folds only
  ordinary writes, and the runtime intentionally permits only one membership
  command until sequential read-your-membership-writes exists. Consequently a
  generic write after `bootstrap` or `setSelfRole` cannot currently observe the
  seat the handler just established.
- `uniqueConflictFact` runs only for owner-policy rows; the JavaScript scanner
  can report an exact empty site set for aliased, computed, or helper writes.
- the ordinary dispatcher still returns an owner field as `Option<&str>`, a
  shape that cannot distinguish attribution or membership from owner checking;
  and permission-backing refusal is not exhaustive across preflight, early
  JavaScript, buffered commit, stale-carrier, and direct-storage paths.
- `FunctionWritePolicyV1` is pinned to `snapback.owner-write.v1` and lacks the
  sealed operation/policy/site closure needed by authoritative execution.
- `writePolicyChecks[]` v2 cannot represent the new authorities, a refused
  form under an admitted posture, effective auth value plus origin, or the
  already-emitted `missing-disclosure` candidate.

The five chartered demos establish these product facts:

1. Campfire, Chirp, and ordinary Messaging use public-read, caller-asserted
   persona fields. Their current writes need honest `open-write`, not invented
   identity.
2. Graffiti's `paintCell` is an append-only HostPlan insert. Last-writer-wins is
   a render rule. Authenticated restamp semantics are nevertheless selected so
   a future compacted patch preserves latest-writer attribution.
3. Team Chat's `messages` and `roomParticipants` remain generic non-owner
   writes. Both are authorized by the `roomMembers` roster. Invite writes the
   invitee's `userId` as data, so owner-write is the wrong model.
4. Team Chat currently writes only a sender-owned `deliveries` row. The author
   still intends recipient-owned read markers rather than restoring direct
   durable fan-out in this closure.
5. Messaging view-once lets a recipient patch the author's JSON grant map.
   That remains a storage-restructure case, not authenticated-write.

These shipped gaps and demo facts are evidence, not capability claims.

## Scope and terms

The closed generic forms remain:

```text
insert, insert-each, patch, delete, delete-where
```

`ctx.db` implements insert, patch, and delete. HostPlan implements all five.
`WriteWithActivity` is a HostPlan wrapper: every generic mutation step in its
nested mutation plan is classified and dispatched exactly as an ordinary
HostPlan step. `AssetCollection` and `AllocateSequence` remain specialized
steps and never inherit a generic posture. A future form or wrapper refuses as
uncomposed until generation, activation, review projection, early runtime,
preflight, authoritative commit, and qualification all classify it.

An **admitted form** is one explicitly declared `admitted`. Omission of a form
is invalid; it is not a default.

An **effective authenticated principal** is the host-resolved
`authUserId()` / `HandlerInput.auth.user_id`. Caller arguments, row fields,
sealed syntax markers, plan literals, service labels, override ids, and
handler values are not principal sources.

An **attribution field** records the effective principal responsible for the
latest admitted insert or patch. It is not an owner predicate.

A **read discriminator** is every stored target-table field used by the
canonical read policy to choose a row audience: an owner arm's `field`, a
membership arm's `resourceField`, and the union of those fields across every
`any-of` arm. `public-read` has none. Referenced roster fields are authority
inputs, not target-row read discriminators.

An **authority table** carries a membership declaration or
`permissionBacking`. It is ineligible for all three postures. An ordinary
target of `membership-write` is not thereby an authority table.

## D1. Authoring, validation, and closed lowering

### One table-policy carrier

`write` is a closed optional member of the existing `.visibility({...})`
authoring object:

```ts
messages.visibility({
  kind: 'membership',
  declaration: roomMembers,
  resourceField: 'roomId',
  roles: ['owner', 'member'],
  write: {
    kind: 'membership-write',
    membership: {
      declaration: roomMembers,
      resourceField: 'roomId',
      roles: ['owner', 'member'],
    },
    attribution: { field: 'authorId' },
    forms: {
      insert: 'admitted',
      'insert-each': 'refused',
      patch: 'refused',
      delete: 'refused',
      'delete-where': 'refused',
    },
  },
})

cells.visibility({
  kind: 'public-read',
  write: {
    kind: 'authenticated-write',
    attribution: { field: 'authorId' },
    forms: {
      insert: 'admitted',
      'insert-each': 'refused',
      patch: 'refused',
      delete: 'refused',
      'delete-where': 'refused',
    },
  },
})

messages.visibility({
  kind: 'public-read',
  write: {
    kind: 'open-write',
    forms: {
      insert: 'admitted',
      'insert-each': 'refused',
      patch: 'refused',
      delete: 'admitted',
      'delete-where': 'refused',
    },
  },
})
```

The exact grammar is:

- `write.kind` is `membership-write`, `authenticated-write`, or
  `open-write`.
- `forms` has exactly all five keys, each `admitted` or `refused`, with at
  least one admitted form.
- `open-write` permits neither `membership` nor `attribution`.
- `authenticated-write` requires exactly
  `attribution: { field: <field-name> }` and permits no `membership`.
- `membership-write` requires exactly
  `membership: { declaration, resourceField, roles? | minimumRole? }` and
  permits optional `attribution: { field }`. `roles` and `minimumRole` are
  mutually exclusive. A nonempty `roles` list must be a subset of the
  declaration's active roles. `minimumRole` is accepted only when a declared
  authority-profile lattice can lower it to a finite, **nonempty** role set.
  If both are omitted, the normalized set is every active, non-pending role.
  Canonical IR stores only the declaration closure, resource field, and sorted
  effective role set.
- Membership `delete-where` is always `refused` in v1. Declaring it admitted
  refuses generation. No current caller needs it, and a correct bulk form
  would require a per-row relationship join, a bounded execution contract,
  and a separately admitted changed-count disclosure.
- An attribution field is required/non-null, has `v.string()` or
  `v.principal()` storage, has no authored/runtime default, and is not a read
  discriminator or membership authority resource field.
- A membership resource field exists, is required/non-null, and has the nominal
  resource type required by the declaration. If `insert` or `insert-each` is
  admitted, the field must be authorable on insert; a host-generated field such
  as `_id` makes that form refuse generation with
  `SNAPBACK_TABLE_WRITE_MEMBERSHIP_RESOURCE_NOT_AUTHORABLE`. A posture using a
  non-authorable resource field remains valid when every insert form is refused
  and only patch/delete is admitted, because those forms resolve the stored
  field.
- All three postures require an ordinary target table. Appearance on a
  membership or permission-backing table refuses with the one generation code
  `SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE`.

Unknown keys, aliases, incomplete/all-refused maps, unresolved declarations,
unsupported field types, attribution/discriminator collision, and unsupported
role bounds refuse generation and activation.

Any of the three explicit postures may pair with any ordinary canonical read
kind subject to this audience-integrity precondition: when the read policy is
`membership`, the membership-write declaration and `resourceField` must equal
that read arm exactly; when it is `any-of` containing membership arms, the
write binding must equal at least one membership arm's declaration **and**
`resourceField` exactly. Otherwise generation and activation refuse with
`SNAPBACK_TABLE_WRITE_MEMBERSHIP_READ_BINDING_MISMATCH`. An insert can author
every read discriminator, so allowing admission through resource C while
planting a row in restricted audience R would defeat patch immutability. A
successful `any-of` pairing proves integrity only for the one matched
membership arm. Every additional owner, membership, or public arm is a
deliberate additional publication audience of that read declaration and is
recorded in the canonical read policy and audience closure; it is not erased
or claimed foreign by the write-pairing proof. A
public-read pairing needs no such constraint because it has no restricted
audience to plant into. Owner-read pairing composes independently with the
existing immutable owner discriminator. The read declaration contributes no
implicit write principal, role, or form; these pairing rules, D1 immutability,
and D5 governance admit the remaining arbitrary combinations without
pretending their audiences are equal.

### Read and authority fields are immutable

For each explicit posture, insert values may set read discriminators and the
membership resource field. Patch may set none of them, even to their current
value. The host never rewrites them. Codegen emits a table-specific input type
equivalent to:

```ts
type ExplicitWritePatch<
  Row,
  Immutable extends keyof Row,
> = Omit<Partial<Row>, Immutable> & {
  readonly [K in Immutable]?: never
}
```

`Immutable` is the union of read discriminators, the membership-write resource
field, and the attribution field. Dynamic JavaScript, HostPlan, stale
artifacts, and direct execution repeat the same check at runtime. Read
discriminator input refuses with
`SNAPBACK_TABLE_WRITE_READ_DISCRIMINATOR_IMMUTABLE`; membership authority-field
input additionally has
`SNAPBACK_TABLE_WRITE_AUTHORITY_FIELD_IMMUTABLE`; authored attribution uses
`SNAPBACK_TABLE_WRITE_ATTRIBUTION_INPUT_REFUSED`. An attribution collision is
invalid at generation with
`SNAPBACK_TABLE_WRITE_ATTRIBUTION_FIELD_INVALID`, so restamping can never
transfer a row's read audience.

### Lowering is explicit

The lowerer performs these steps in this order:

1. parse and validate the optional `write` member;
2. strip it from the authoring object;
3. pass only the remaining read leaf to the unchanged
   `canonicalPolicyLeaf`/`canonicalVisibilityPolicy` exact-key machinery;
4. derive or normalize `writePosture` independently; and
5. pass the canonical read policy and canonical `writePosture` as siblings to
   `normalizePolicyBody`.

`TableVisibilityV1` is unchanged. `TableManifest` gains one required closed
`writePosture: TableWritePostureV2` value per table. Activation validates that
carrier against the normalized body, shared policy digest, table class,
declaration closures, schema fields, and function carriers. The runtime
dispatcher consumes it directly.

The following divergent implementations are forbidden:

- passing the unstripped object into `canonicalPolicyLeaf` refuses as a
  noncanonical authoring/lowering failure;
- putting `write` inside the canonical read `policy` fails the v3 exact-key and
  body-digest validation; and
- adding a manifest sibling that is absent from, disagrees with, or is ignored
  by normalized governance/runtime state fails activation with
  `SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID`. A read-kind fallback
  may not turn such disagreement into Phase-1a pass-through.

### Required LLP 0264 amendment at implementation landing

The implementation landing normatively amends LLP 0264, not merely
cross-references it. The complete dated amendment text is:

> **Dated amendment (2026-08-16, LLP 0274).** D1's absence of an explicit
> non-owner write posture was a v1 scoping rule. Replace D1's sentence beginning
> “V1 derives write posture” and its “adds no ... `writePolicy`” inventory with:
> “The installed table policy remains the only authoring locus for generic
> write admission. Its closed `visibility({...}).write` member is not a
> separate write-policy locus: the lowerer removes it before read-leaf
> canonicalization and installs it as the normalized body's sibling
> `writePosture`. There is still no `.writeVisibility(...)`, per-function owner
> or authority field, inline guard authority, or caller-selectable policy.”
> `TableVisibilityV1` remains a read-only carrier. The manifest's closed
> `TableWritePostureV2`, the resolved installed-posture carrier, activation,
> projection, preflight, and both runtime commit seams consume the same posture
> fact and shared digest.
>
> Replace D1's later sentence beginning “Every predecessor/successor gains
> versioned `writePosture`” and its abbreviated identity inventory with:
> “Every predecessor/successor carries LLP 0274's exact canonical
> `writePosture`: semantic version; authority kind; the disposition of all five
> forms; owner and attribution fields; complete membership
> declaration/resource/role binding; sorted read discriminator fields;
> authority-table class; and canonical operation-bound global-unique
> disclosures. The normalized policy body, digest, baseline, every ledger node,
> approval scope, both comparators, activation, projection, and installed
> execution carrier bind that complete identity. Older inventories naming only
> version/dispositions/owner/class/disclosures are not the v3 contract.”
>
> Replace D1's sentence beginning “The comparator is read × write” through its
> “Refused-to-owner ... broaden” inventory with: “The comparator is read ×
> write, but write classification is LLP 0274 D5's complete relation, including
> its protected-field test before rank. Refused-to-owner, membership, or
> authenticated is incomparable when it introduces a protected binding;
> refused-to-open is growth. Canonical migration-pending is a kind-level value,
> incomparable to explicit postures and derived owner; it does not participate
> in formwise composition. Its one narrowing is the receipt-bound, all-form
> Phase-1b flip to refused. New forms and disclosure/operation-set growth remain
> growth; rebinds, mixed directions, and unproved changes remain incomparable.”
>
> In D2's table, replace the three declared-non-owner rows with: (1) ordinary
> `membership` **with no explicit LLP 0274 posture** is migration-pending in
> Phase 1a and refused in Phase 1b; (2) ordinary `any-of` **with no explicit
> LLP 0274 posture** is migration-pending in Phase 1a and refused in Phase 1b;
> and (3) ordinary `public-read` **with no explicit LLP 0274 posture** is
> migration-pending in Phase 1a and refused in Phase 1b. An exact, valid,
> installed LLP 0274 posture instead supplies its own formwise disposition.
> Owner derivation, omission/removal, migration-root, and authority-table rows
> remain unchanged. A read policy never derives an LLP 0274 posture.
>
> Replace D2's post-table paragraph beginning “This table is a default-closed
> derivation” with: “The no-posture rule is a source-origin classification, not
> a second policy and not a read-kind fallback. During Phase 1a, an ordinary
> declared non-owner table with source origin `implicit-no-posture` resolves to
> canonical `authorityKind: migration-pending`; during Phase 1b the same local
> origin resolves to canonical `refused`. An exact explicit LLP 0274 posture
> resolves to itself in both phases. Projection, execution carrier, preflight,
> authoritative commit, and the flip consume that one resolved posture fact;
> none recovers migration state from `policy.kind`.”
>
> Replace D9's paragraph beginning “Phase 1a has one deliberately
> non-admitting exception” with: “The historical v2 Phase-1a exception is
> available only when every exact declared target has activation-bound source
> origin `implicit-no-posture`: no explicit posture was declared, its canonical
> read is non-owner, its table class is ordinary, and the target's committed
> write-migration activation `migrationPhase` is `phase-1a`. Only then may the v2
> projection emit the table-specific
> `migration-pending-declared-write-set` compatibility row. Read kind alone is
> insufficient. Explicit posture syntax, derived owner, authority-table class,
> post-flip state, undeclared/mixed/unbounded targets, or source/body mismatch
> enters the ordinary exact/opaque gate and cannot use this exception.”
>
> LLP 0264 D9's `genericWriteDisposition` enum remains the exact historical v2
> projection domain. Do not extend that v2 table in place. LLP 0274 D5 owns the
> v3 replacement enum, taxonomy matrix, required fields, row-id domain, and
> migration-phase applicability rule; v3 readers use it and v2 readers refuse
> the v3 section.
>
> In D10,
> `SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING` and
> `SNAPBACK_TABLE_WRITE_POLICY_INELIGIBLE` mean a generic write reaches a
> declared ordinary `public-read`, `membership`, or `any-of` table **with no
> explicit LLP 0274 posture**. An explicit posture uses its posture/form
> diagnostic instead. Authority-table precedence remains unchanged.
>
> Replace Phase 1a's unconditional declared-non-owner migration bullets with:
> “Declared ordinary `public-read`, `membership`, and `any-of` generic writes
> **without an installed explicit LLP 0274 posture** carry resolved origin
> `implicit-no-posture`, emit
> `SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING`, preserve their exact
> pre-0264 behavior, and project canonical `authorityKind`/form disposition
> `migration-pending`. A valid installed explicit posture instead uses its own
> qualified form disposition and never enters the migration arm. Membership
> and permission-backing authority tables remain hard refusals regardless of
> explicit syntax.”
>
> Replace Migration's predecessor-version compatibility note with: “History
> admission validates retained v1, v2, and v3 artifacts under their own exact
> schemas and digest domains. It recognizes LLP 0264's exact v1-to-v2
> representation lift and LLP 0274's exact source/phase-aware root v2-to-v3
> representation lift. A retained chain is ordered `v1* -> v2* -> v3*`, with
> the existing single v1-to-v2 recognition below exactly one v2-to-v3 boundary.
> A historical v2 head with real history is not rewritten: activation appends
> LLP 0274's approved v3 bridge, validating and deep-binding the exact v2 head
> body/digest in the v2 domain. Interleaving, skipped heads, wrong-domain
> digests, hidden semantic change, or any downgrade refuses. No old node,
> approval, receipt, or G1 closure receipt is rewritten.”
>
> In the write-migration corpus closure receipt, replace “zero public-read,
> membership, `any-of`, membership-table, or permission-backing targets remain
> behind generic write declarations” with: “zero ordinary `public-read`,
> membership, or `any-of` generic-write targets remain **without an installed
> explicit posture**, and zero membership-table or permission-backing targets
> remain behind generic declarations.” The remaining receipt criteria are
> unchanged.
>
> Replace the Phase 1b flip paragraph with: “After the independent write-
> migration closure receipt is committed and qualified, the flip
> implementation and a target-scoped committed activation marker naming that
> exact receipt land together. The activation registry derives its sole
> `phase-1a -> post-flip` transition from that marker/receipt pair; ambient
> configuration cannot select it. Codegen/runtime then change only canonical
> `migration-pending` with resolved origin `implicit-no-posture` to canonical
> all-form `refused`. The posture-local `migrationPhase` becomes
> `not-applicable`. `genericDisposition` and runtime dispatch branch on the
> resolved installed posture, never read kind. There is no distinct
> post-migration state after Phase 1b. Synthetic fixtures prove all three
> no-posture non-owner read kinds flip while exact explicit postures and
> non-migration derived owner/authority-table/omission-refused postures carry
> `migrationPhase: not-applicable` and retain byte-identical carriers and
> review-row ids.”
>
> Replace Phase 1b's sentence claiming normalized `writePosture` is byte/
> semantically unchanged across 1a and 1b with: “Owner enforcement,
> authority-table/omission/removal refusals, the opaque owner-form gate, lack of
> elevation, explicit-posture bodies, and their comparator identities are
> byte/semantically unchanged. The one intended canonical change is the
> receipt-bound all-form `migration-pending -> refused` narrowing for
> `implicit-no-posture`; generation severity and the matching legacy runtime arm
> close with it. No explicit posture body or its resolved row changes.”
>
> Mark OQ2 **RESOLVED for ordinary target tables by LLP 0274**:
> membership-write supplies the transactionally resolved ordinary-table
> posture, and explicit `any-of` read pairings follow LLP 0274's one-arm
> audience-integrity rule. The question remains open only for generic mutation
> of roster/membership and other authority tables, which this Spec continues
> to reserve to declaration-owned specialized writers.

## D2. `open-write`

An admitted open form requires no principal and no old-row authority
predicate. Function auth may narrow invocation: an authenticated operation
still rejects an anonymous caller at the invocation gate. One open target
cannot launder another target or form.

| Form | Semantics when admitted |
| --- | --- |
| `insert` | Commit authored values after ordinary validation. Add no identity stamp. |
| `insert-each` | Apply insert semantics to every item atomically. One bad item or unique conflict rolls back the entire batch. |
| `patch` | Patch a physically present target without a reader/owner predicate, subject to D1 immutability. |
| `delete` | Delete a physically present target without a reader/owner predicate. |
| `delete-where` | Apply the authored filter without a hidden principal conjunct. |

Author-like fields remain caller-controlled data. They cannot satisfy Snapback
policy enforcement, generated derived authority, protected
attribution, or a later generic authority check. Handwritten application code
can of course choose to interpret arbitrary data; this Spec makes no taint
claim about such code.

Insert and insert-each reach the same complete unique-constraint set. Patch
reaches every constraint whose member may change; an unknown value shape
conservatively reaches all. Every non-owner-partitioned constraint requires an
exact operation-bound disclosure. The public conflict is value-free and one
insert-each conflict rolls back every item.

## D3. `authenticated-write`

Every admitted form requires an effective authenticated principal. Any such
principal may write any target admitted by the form; attribution does not
restrict the old row.

Generated operations must have effective `authRequirement: authenticated`.
Explicit `public`, explicit `optional-user`, and a legacy-default
`optional-user` refuse generation with
`SNAPBACK_TABLE_WRITE_AUTH_REQUIREMENT_INCOMPATIBLE`; an exact runtime ceiling
containing an authenticated target has the same requirement. Codegen does not
silently tighten the function declaration. The closed origin vocabulary is
`explicit | derived | legacy-default`; both explicit and derived
`authenticated` values are eligible, while origin never substitutes for the
value. These strings match the shipped authorization-review schema directly.

Conforming anonymous invocations stop at the existing invocation gate with
`SNAPBACK_AUTH_REQUIRED`. Only a forged, stale, or direct lower-seam execution
can reach the defense-in-depth
`SNAPBACK_TABLE_WRITE_AUTHENTICATION_REQUIRED`. The lower seam checks the
principal before target access, uniqueness work, value-map evaluation, or an
`AuthUserId` marker. Marker presence and absence therefore have byte-identical
lower-seam refusal bytes.

### Stamp and restamp

Insert and insert-each host-stamp attribution in the authoritative
transaction. Authored values must omit the field. A HostPlan insert may carry
the exact sealed `AuthUserId` compatibility marker; the host removes the marker
from authored input and independently derives the stored value. A literal,
argument, binding, default, JavaScript value, or other authored expression
refuses even when equal to the effective principal.

Every successful patch restamps attribution. The host materializes the stamp
as a host-owned entry in the committed patch value set **before** either
HostPlan or buffered execution evaluates its empty-values skip. Input refusal
applies only to authored values, never that host entry. Consequently:

- an empty-authored patch commits a restamp;
- a same-value authored patch still commits;
- even when the attribution bytes already equal the effective principal, the
  patch produces the ordinary version bump;
- `changedFields` contains the attribution field, plus whatever authored
  fields the ordinary committed-patch contract records; and
- lifecycle, activity, invalidation, read-your-writes, and other companion
  effects follow the ordinary committed-patch contract exactly once and roll
  back atomically on failure.

Delete and delete-where require a principal but do not stamp a surviving row.
They do not compare old attribution.

## D4. `membership-write`

Membership-write applies only to an ordinary target table. Its normalized
member binds one LLP 0056/0240 declaration closure, one target-row
`resourceField`, and one finite effective role set. It never grants mutation
of the declaration's roster table or another authority table.

Function auth coupling is exactly D3: every exact or ceiling-reachable
membership write requires effective `authenticated`, normal anonymous calls
stop with `SNAPBACK_AUTH_REQUIRED`, and lower-seam anonymous execution stops
with `SNAPBACK_TABLE_WRITE_AUTHENTICATION_REQUIRED` before value or target
evaluation.

Admission linearizes in handler program order inside the authoritative commit
transaction. The normative representation is one host-owned ordered effect
log, `UnifiedWriteEffectV1`. Every ordinary generic write and every specialized
membership command receives a never-reused monotonic `programOrder` when the
host accepts that call. Expansion of one specialized command retains that
ordinal plus a deterministic private suborder; it never moves the command as a
class. The commit seam processes the unified log in strict `(programOrder,
suborder)` order. Concatenating all ordinary writes before or after all
membership-plan writes is nonconforming.

The host also derives an exact transaction-local membership overlay from the
ordered prefix. Both the early JavaScript gate and authoritative admission for
an effect at ordinal N see specialized membership effects with ordinal `< N`
and never effects at `>= N`. `bootstrap` therefore exposes its creator seat to
a following generic participant insert, and `setSelfRole` exposes the active
seat to a following participant patch. Conversely, `removeSelf` followed by a
membership-dependent generic write denies. A specialized command remains
atomic at its ordinal, including bootstrap's resource/seat/initial-roster
witnesses. Storage and overlay evaluation use one planner and must produce the
same membership fact; the overlay is not an optimistic permission guess.

This is required **new runtime work**. The shipped seam discards cross-class
order, the shipped JavaScript overlay contains only ordinary writes, and the
one-membership-command limit explicitly defers sequential
read-your-membership-writes. An implementation may remove that limit only when
the unified log and exact overlay qualify. D9 cannot claim Team Chat closure
until this work and its D8 fixtures pass.

Within that ordered transaction:

- insert and each insert-each item must carry the resource field. Omission
  refuses before any resource or roster lookup with
  `SNAPBACK_TABLE_WRITE_MEMBERSHIP_RESOURCE_REQUIRED`; the host resolves the
  caller's active roster row and effective role against the authored resource
  value before committing;
- patch and delete internally read the stored row's immutable resource field,
  then resolve the caller's active roster row and role bound against it; and
- delete-where is refused at generation, activation, and runtime in v1.

The internal target/resource/roster lookup is not a public target resolution.
For membership-write point patch/delete, a missing target **always** produces
the same terminal `SNAPBACK_AUTH_PERMISSION_DENIED` bytes and invariant public
details `{ kind: "role" }` as absent membership, pending membership, an
insufficient role, or a nonexistent resource id. This includes a caller who is
an active member of some other resource; no fallback lookup may turn that fact
into a physical-existence bit. Insert against a nonexistent resource id folds
into the same denial. No FK/referential diagnostic may enumerate resource ids.
Success versus this role denial means only “the target was present in a
resource for which this invocation held an admitted role.” Membership point
forms never expose an ordinary physical-present-versus-missing bit.

The only post-admission missing case is internal OCC handling: if a row that
was present and role-admitted for an attempt vanishes before its effect can
linearize, that attempt takes the ordinary OCC conflict/retry path and commits
no effect. The retry begins admission again; if the row is now missing it
returns the same terminal role-denial bytes above, not an ordinary missing-row
result.

An unattributed membership patch with an empty authored value map still runs
target/resource/role admission. On success it is a form-admitted no-op: it
writes no row, bumps no version, emits no `changedFields`, and produces no
companion effect. On failure it returns the same role denial. The executor may
not take its shipped empty-values skip before admission. Attributed membership
retains D3's host restamp and therefore is not empty after host materialization.

The roster lookup and ordered membership-overlay facts are part of the
transaction's read/OCC set. Concurrent revocation or role reduction
invalidates/retries the attempt; a retried write cannot commit under the
removed role, and no companion effect from the stale attempt survives. Every
terminal role denial carries exactly one of these **hidden** witness variants:

```text
MembershipWriteDenialWitnessV1 =
  TargetAbsent { targetTable, targetKeyAbsence, declarationIdentity,
                 snapshotVersion }
  | CommittedRoster { declarationIdentity, capturedRosterRange,
                      snapshotVersion }
  | OverlayPrefix { declarationIdentity, invocationIdentity, programOrder,
                    prefixDigest, baseDataVersion }
```

- `TargetAbsent` is required for a missing point-patch/delete target. There is
  no stored `resourceField`, so this variant binds the target-key empty-result
  capture, declaration identity, and snapshot version. It must **not** invent
  or perform a `(principal, resource)` roster lookup.
- `CommittedRoster` is required when committed data supplies the resource but
  the ordinary roster capture proves non-member, pending, or insufficient
  role. Its range capture is the LLP 0056 snapshot-bound present/empty query
  fact; nonexistent-resource insert denial uses this variant as well.
- `OverlayPrefix` is required when the denial-causing membership state is an
  uncommitted specialized-command prefix, including
  removeSelf-then-dependent-write. That prefix has no committed data version,
  so the witness binds the host invocation identity, the denied effect's
  `programOrder`, a canonical digest of exactly the preceding unified-log
  prefix, and the committed base data version from which the overlay was
  derived. `prefixDigest` uses the
  `snapback:unified-write-effect-prefix:v1` digest domain; the exact canonical
  preimage bytes and field order are pinned by D8's named
  `overlay-prefix-digest-preimage` interchange golden.

The variants are host-only authorization/data evidence. They never enter the
public code, message, or details, which remain byte-identical
`SNAPBACK_AUTH_PERMISSION_DENIED` with `{ kind: "role" }` for all three. Each
variant preserves its snapshot/overlay dependency and names at least the
causing committed base version; none can discharge an obligation floor newer
than its coherent witness. Byte equality alone does not satisfy LLP 0056's
denial contract.

Optional attribution has exactly D3's host stamp/restamp, authored-input,
empty-patch, version, `changedFields`, and overlay semantics. Without
attribution, membership admission changes no author-like field. The immutable
resource field is never host-restamped.

## D5. Canonical identity, governance, and projection

### `TableWritePostureV2`

The exact canonical object is:

```text
semanticVersion
authorityKind
dispositions
ownerField
attributionField
membership
readDiscriminatorFields
authorityTableClass
globalUniqueDisclosures
```

`semanticVersion` is `snapback.write-authority.v2`.
`authorityKind` is `refused`, `migration-pending`, `owner`,
`membership-write`, `authenticated-write`, or `open-write`. `dispositions`
has exactly the five form keys and values from this closed vocabulary:

```text
refused
migration-pending
owner-host-stamped
owner-old-row-checked
owner-filtered
membership-admitted
membership-host-stamped
membership-restamped
authenticated-host-stamped
authenticated-restamped
authenticated-admitted
open-admitted
```

The consistency matrix is exact:

| Kind | Non-null authority members | Permitted admitted dispositions |
| --- | --- | --- |
| `refused` | none | none |
| `migration-pending` | none | `migration-pending` on every generic form retained during Phase 1a; never explicit syntax |
| `owner` | `ownerField` | owner stamp/check/filter, exactly per LLP 0264 form |
| `membership-write` | `membership`; optional `attributionField` | `membership-admitted`; stamp/restamp only when attribution exists; delete-where always refused |
| `authenticated-write` | `attributionField` | authenticated stamp/restamp/admitted by form |
| `open-write` | none | `open-admitted` |

Every other authority member is null. `readDiscriminatorFields` is the sorted
exact derived set. `membership` contains exactly declaration id and digest,
membership/resource table identities, principal/resource/role field bindings,
target `resourceField`, and sorted effective roles. `authorityTableClass` is
`ordinary`, `membership`, or `permission-backing`. A non-ordinary class is
always `refused`, all forms refused, all authority members null, and disclosures
empty. Global unique disclosures remain sorted exact
`{ table, writeForm, constraint, operations[] }` entries.

`migration-pending` is the sixth **canonical** kind, not `refused` plus a
projection-only flag. A Phase-1a ordinary declared non-owner table with no
explicit posture normalizes to that kind; Phase 1b normalizes the same source
origin to `refused`. This choice keeps temporary pass-through semantics in the
body/digest domain and prevents a lower seam from mistaking canonical
`refused` for permission.

The migration state is a committed, target-scoped activation fact, never an
environment variable, CLI default, build-time timestamp, or inference from a
read kind. Each target's installed activation registry carries one exact
`WriteMigrationActivationV1` record and binds its digest into the target
activation receipt:

```text
semanticVersion: snapback.write-migration-activation.v1
targetId
migrationPhase: phase-1a | post-flip
closureReceiptDigest: null | digest
flipMarkerDigest: null | digest
```

The `WriteMigrationActivationV1` record digest uses the
`snapback:write-migration-activation:v1` domain. Its exact canonical preimage
bytes and field order are pinned by D8's named
`write-migration-activation-v1-preimage` interchange golden.

Registry initialization has a protected cut. Before the flip, the registry
commits one immutable exact-set migration root of eligible `targetId`s. A
`phase-1a` record is valid only while the flip marker `F` does not exist and
when its exact `targetId` is present in that committed pre-flip root, or when
its append-only registry envelope names and retains an exact `phase-1a`
predecessor record for the same immutable target identity. Root membership and
the retained predecessor digest are bound by the target activation receipt
even though they are registry-envelope provenance, not members of the
canonical record above. A target absent from the root and without that retained
predecessor cannot initialize `phase-1a`.

Once the committed flip marker `F` exists, every newly registered or
legitimately rebound target initializes directly as `post-flip`, with
`closureReceiptDigest` naming the qualified closure receipt `R` and
`flipMarkerDigest` naming that exact `F`. The old registry entry remains
retained, and `targetId` is immutable: an in-place target-id change,
delete-and-recreate reset, or fresh `phase-1a` record cannot manufacture a new
migration window. Any such initialization/reset refuses with
`SNAPBACK_TABLE_WRITE_MIGRATION_ACTIVATION_INITIALIZATION_REFUSED`.

The closed `MigrationPhaseV1` vocabulary is `phase-1a`, `post-flip`, or
`not-applicable`. The target record uses the first two; a resolved posture uses
`phase-1a` or `not-applicable` as constrained below. `phase-1a` requires both
digests null. `post-flip` requires both digests non-null and equal to the exact
qualified `R`/`F` pair. There is no distinct behaviorally useful
`phase-1b` interval followed by `post-migration`; the minimal state machine
collapses both to `post-flip`. The only transition is `phase-1a -> post-flip`,
triggered when the qualified LLP 0264 corpus-closure receipt is already
committed and the flip implementation plus a marker naming that exact receipt
land together. The registry derives `post-flip` only from that committed
marker/receipt pair. Missing, dangling, mismatched, or rollback state refuses
activation; a process cannot select either state through ambient config.

Activation then constructs one host-owned
`ResolvedInstalledWritePostureV2` per table containing the canonical posture
plus `postureOrigin` (`owner-derived`, `explicit`,
`implicit-no-posture`, `authority-table-ineligible`, or
`omission-refused`) and posture-local `migrationPhase` (`phase-1a` or
`not-applicable`). The value is `phase-1a` exactly for
`implicit-no-posture` resolved to canonical `migration-pending`; **every**
explicit posture and every derived owner/refused posture, including post-flip
implicit-no-posture refusal, carries `not-applicable`. Explicit source syntax
may never name migration state. Projection, function/execution carriers,
HostPlan preflight, the early JavaScript gate, and authoritative commit consume
this exact resolved fact. They never reconstruct its origin or phase from the
read kind. Because non-migration explicit, owner-derived,
authority-table-ineligible, and omission-refused carriers are `not-applicable`
before and after the registry transition, the flip cannot change their
canonical carrier, shared digest, projection content, or review-row id. The one
implicit-no-posture migration row intentionally changes as specified.

`TableManifest.writePosture`, the normalized body's `writePosture`, activation,
the baseline, ledger, transition scope, runtime dispatcher, review row, and
execution carrier bind byte-identical canonical content and the same shared
policy digest; runtime consumers additionally bind the exact resolved carrier
above.

### Write partial order and read-audience cap

For each form, the authority lattice is:

```text
refused < owner            < authenticated-write < open-write
refused < membership-write < authenticated-write < open-write
owner || membership-write
```

This Hasse chain is **not** the comparison relation without the following
protected-field compatibility precondition and exceptions. Before **any** rank
edge is applied, every successor `ownerField`,
`attributionField`, and membership binding must already exist compatibly in
the predecessor posture, and each named field must already be host-protected
there: either host-stamped or an immutable read/membership discriminator.
Introducing an `ownerField`, `attributionField`, or membership binding where
the predecessor posture had none is incomparable. Reusing a name that was
caller-authorable under the predecessor is also incomparable. Rank never
blesses predecessor bytes as authority or trusted attribution.

The explicit exception list is therefore part of the lattice statement:
`authenticated-write -> membership-write` is incomparable when the
membership binding is new, including a formerly caller-controlled `roomId`
under public-read plus authenticated-write;
`authenticated-write -> owner` is incomparable when `ownerField` is new or
was not protected, including a predecessor that stamped `lastEditorId` while
caller-controlled `ownerId` becomes the successor owner field; adding
attribution to unattributed membership-write is incomparable;
`refused` to owner, membership, or authenticated is
incomparable because the protected binding is new; owner to authenticated is
incomparable when attribution is a new binding even if the owner field had
been protected; and every field or binding rebind is incomparable. By
contrast, refused to open introduces no protected binding and
retains its rank-growth verdict. The ordinary rank verdict applies only after
these tests pass.

Subject to that precondition, `refused` is below both `owner` and
`membership-write`;
`owner` and `membership-write` are incomparable; both are below
`authenticated-write`, which is below `open-write`. A higher reachable node is
growth; a lower one is narrowing; incomparable nodes are incomparable. The
comparison is formwise, so mixed growth and narrowing is incomparable.

`migration-pending` is outside the steady-state Hasse lattice. Its Phase-1b
flip to `refused`, with all five forms changing together, is the single named
narrowing and is valid only for the same `implicit-no-posture` source origin
and the target registry's exact `phase-1a -> post-flip` transition.
`migration-pending` is otherwise **kind-level incomparable** to every explicit
posture and to derived `owner`; this includes `open-write`, even for a partial
form map that would appear formwise to grow. Adoption of membership,
authenticated, open, or owner is therefore an ordinary remotely-prior approved
transition, never a migration shortcut. Formwise composition does not apply to
`migration-pending`. Any other transition from it to `refused`, or any
transition into it from an explicit/owner/refused posture, has the wrong
origin/registry transition and refuses as malformed before comparison.

Within membership-write, an effective role-set subset is narrowing and a
superset is growth when declaration closure and resource field are identical.
Equal-size role sets for which neither is a subset are incomparable, not an
equal-cardinality shortcut. Declaration or resource-field rebind is
incomparable. Owner-field,
attribution-field, or membership attribution rebind is incomparable.
Introducing any authority or attribution field where the predecessor posture
had none is incomparable, including open-to-owner, open-to-membership, and
open-to-authenticated. Predecessor rows may contain caller-chosen bytes in that
field; a rank decrease cannot bless them as authority. Adding or removing
attribution within membership-write is likewise incomparable.

Owner insert and authenticated insert with the same stamped field admit the
same principals and perform the same host stamp. Their conservative rank is
retained as the authority-breadth Hasse edge because posture identity also
governs patch/delete semantics and a later form admission, but the protected-
binding precondition still runs first. A newly introduced attribution binding
therefore makes the concrete transition incomparable. Insert-only equivalence
is documented, not used as a transition shortcut.

The successor read-audience cap is exact:

- `public-read` admits any write audience through `open-write`;
- `owner { field: F }` admits only refused or owner-write on the same `F`;
- `membership` admits only refused or membership-write whose declaration and
  resource field match and whose effective roles are a subset of the read
  roles; and
- `any-of` admits refused plus an owner or membership writer that is contained
  by one exact arm. It never admits authenticated/open as within-read.

`migration-pending` never satisfies a read-audience cap; it is a temporary
unclaimed compatibility state, not a proven write audience.

This is a subset proof, not a rank guess. Whenever the read axis narrows and a
retained successor form has write authority broader than that cap, the combined
transition is **incomparable**, never narrowing. Thus public/open to
owner/open, public/authenticated to membership/authenticated, and a membership
role narrowing that retains a broader membership writer all require governance.

Disclosure addition or `operations[]` growth is growth. Removal is narrowing
only if no other fact grows; swaps are incomparable. Field/class/version/
declaration rebind and unproved changes are incomparable. Every growth or
incomparable transition requires LLP 0234's remotely-prior, content-bound
approval closure and signed separation receipt.

### Normative LLP 0234 D5 amendment

The implementation landing normatively amends LLP 0234, not merely its version
cross-reference. The complete dated amendment text is:

> **Dated amendment (2026-08-16, LLP 0274).** In D5, replace the canonical
> write-posture inventory sentence with: “`writePosture` contains semantic
> version, `authorityKind` (`refused`, `migration-pending`, `owner`,
> `membership-write`, `authenticated-write`, or `open-write`), the disposition
> of every closed generic form, `ownerField`, `attributionField`, the complete
> membership declaration/resource/role binding, sorted
> `readDiscriminatorFields`, authority-table class, and canonical
> operation-bound global-unique disclosures. All of those facts participate in
> the normalized body, digest, baseline, ledger, approval scope, comparator,
> projection, and installed execution carrier.” D5/D6 old readers must refuse
> every new authority kind, field, membership member, and disposition; they may
> not erase one or map it to refused/owner.
>
> Replace “The structural partial order is the product of the read order and
> LLP 0264's write order” and its write-order paragraph with: “The structural
> order is the product of the read order and LLP 0274 D5's **complete** write
> comparison: its protected-field compatibility precondition, Hasse
> edges, owner/membership incomparability, membership role-set subset/superset
> and equal-size non-subset rules, declaration/resource/field rebind rules,
> successor read-audience cap (which canonical `migration-pending` never
> satisfies), disposition/form order, and disclosure set/order.
> The Hasse chain alone is not the comparison relation. A transition narrows
> only when neither axis grows and every protected-field precondition passes;
> opposite-axis changes, field introduction over caller-controlled predecessor
> bytes, malformed combinations, and any unproved change are incomparable.”
>
> Replace the old refused-to-owner growth inventory with: “For each form,
> `refused < owner < authenticated-write < open-write` and `refused <
> membership-write < authenticated-write < open-write`, with owner and
> membership incomparable, with LLP 0274's protected-field compatibility test
> applied before every rank edge. Refused to open, a newly
> admitted form with unchanged protected bindings, a role-set superset, a new
> global-conflict disclosure, or growth of a disclosure's `operations[]` is
> growth. Refused to owner, membership, or authenticated is
> incomparable because it introduces protected bindings. A role-set subset or disclosure removal
> is narrowing only when all bindings match and no other fact grows; equal-size
> non-subset role swaps, authority/member/attribution introduction or rebind,
> semantic-version/class/declaration changes, mixed per-form direction, and
> read-audience-cap failures are incomparable. Every broader or incomparable
> successor requires the existing remotely-prior content-bound approval and
> signed separation receipt. Canonical `migration-pending` is outside this
> formwise lattice: it is kind-level incomparable to every explicit posture and
> derived owner, including open-write, and formwise composition does not apply.
> Its sole narrowing is the all-five-form `migration-pending -> refused` flip
> for the same `implicit-no-posture` origin under the receipt-bound target
> `phase-1a -> post-flip` transition; every adoption is an ordinary approved
> transition.”
>
> Replace D5's sentence beginning “A new restricted table is not widening” and
> its null-predecessor `new-restricted` admission rule with: “A new restricted
> table is not read widening, but a null predecessor does not erase the write
> axis. `new-restricted` is valid only
> when the successor's **complete read/write normalized body** has a restricted
> read policy and every admitted write form is within LLP 0274's successor
> read-audience cap. Qualifying examples include canonical derived refusal,
> owner-read plus derived owner-write on the same owner field, and membership-
> read plus membership-write whose declaration/resource pair matches and
> whose roles are contained by the read roles; the analogous exact-arm
> containment rule applies to `any-of`. Owner-read plus open-write and
> membership-read plus authenticated-write or open-write are not
> `new-restricted`, because their write authority exceeds the successor read
> audience. A broad-write new table uses the ordinary remotely-prior
> `approved-transition` path even with a null predecessor. Its root ledger node
> has `admissionKind: approved-transition`, null predecessor body/id/digest,
> and the exact approval closure plus protected-observer separation receipt.
> Any authored `new-restricted` label for a body that fails the complete
> two-axis test fails
> `SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID`.”
>
> Append to Acceptance item 10: “Null-predecessor new-table classification is
> recomputed from the complete read/write normalized body. Owner/open and
> membership/authenticated-or-open fixtures fail `new-restricted` admission
> and require a remotely prior `approved-transition` closure and receipt whose
> node retains a null predecessor. Owner/owner and contained membership/
> membership fixtures pass `new-restricted`; derived-refused restricted roots
> remain positive controls.”
>
> Replace the 2026-08-16 predecessor-compatibility paragraph with: “The v3
> admission reader validates retained v1, v2, and v3 artifacts under their own
> exact schemas and digest domains. LLP 0264's exact G1-root v1-to-v2 lift and
> LLP 0274's exact root-only v2-to-v3 lift remain the only automatic lifts. A v3
> boundary over a real v2 history is an appended, approved v3 node whose
> predecessor body and digest are decoded and verified in the v2 domain and
> deep-equal the referenced exact v2 head. A retained mixed chain is ordered
> `v1* -> v2* -> v3*`: retained v1 segments sit below retained v2 segments and
> continue through LLP 0264's one recognized v1-to-v2 boundary, each segment
> validating under its own exact schema and digest domains; exactly one
> v2-to-v3 boundary may then occur. Interleaving, a second boundary, downgrade,
> skipped-head linkage, body/digest mismatch, or hidden semantic change
> refuses. The v3 node and approval-scope hashes bind both version tags. Their
> exact canonical-byte preimages and field order are defined by LLP 0274 D8's
> named dual-tag golden vectors; those vectors are interchange conformance and
> no alternate prose serialization is accepted. No retained v1/v2 node,
> approval, receipt, or immutable G1 closure receipt is rewritten.”

Comparator identity is approval machinery. The in-tree policy comparator and
the revision/admission comparator replace their old
`compareWritePostures` behavior with one shared specification and the same
golden vector set. A version-list cross-reference alone is nonconforming.

### Governance v3 and predecessor reading

The family rotates to:

```text
snapback.table-visibility-policy-baseline.v3
snapback.table-visibility-policy-transition-ledger.v3
snapback.table-visibility-policy-transition.v3
snapback.visibility-governance-comparator.v3
snapback:table-visibility-policy-body:v3
snapback:table-visibility-transition-node:v3
snapback:table-visibility-transition-ledger:v3
snapback:table-visibility-policy-transition-scope:v3
```

Validation is version-dispatched, never `version === v2` by implication:

| Governance | Body exact keys | Write posture | Digest domains |
| --- | --- | --- | --- |
| v1 | `policy`, audience closure, closure digest | absent | all committed v1 domains |
| v2 | v1 keys plus `writePosture` | exact `snapback.owner-write.v1` | all committed v2 domains |
| v3 | v2 body keys | exact `TableWritePostureV2` | the v3 domains listed above |

Baseline, ledger, record, body, node, ledger-set, and transition-scope versions
must match their row/node segment. Exact keys, enum domains, canonicalization,
and digest verification run under that segment's version.

The v3 validation matrix retains these exact container records: baseline
`{schemaVersion, entries, exactSetDigest}`; baseline entry
`{tableId, normalizedPolicyBody, policyDigest, provenanceHeadId}`; ledger
`{schemaVersion, nodes, heads, ledgerDigest}`; and transition node
`{schemaVersion, id, tableId, predecessorHeadId, predecessorHeadDigest,
predecessorNormalizedPolicyBody, predecessorPolicyDigest,
successorNormalizedPolicyBody, successorPolicyDigest, admissionKind,
approvalPath, approvalClosureDigest, serverSeparationReceipt,
serverSeparationReceiptDigest, quarantineVerdict}`. The normalized body has
exactly `{policy, audienceDeclarationClosure,
audienceDeclarationClosureDigest, writePosture}`; `writePosture` has exactly
the D5 `TableWritePostureV2` keys. `additionalProperties` is false at every
level. Baseline exact-set, body, node, ledger, and transition-scope hashes use
their named v3 domains; audience-closure and retained v1/v2 segment hashes keep
their original domains. A v2-special-cased validator or hash fallback is a
refusal, not compatibility.

The automatic v2-to-v3 representation lift is limited exactly to a root-only,
G1-rooted ledger with no real predecessor and no `approved-transition` node,
approval, or receipt. Its deterministic input is the complete validated v2
body **plus** the activation-bound source origin and the target's committed
`WriteMigrationActivationV1` fact. The source origin is lowered from the exact
installed source/schema covered by the activation receipt: `implicit-no-posture`
means no explicit `write` member, a non-owner canonical read kind, and ordinary
table class. This one lift-time decoding step may inspect those bound source
facts; projection and runtime may not reconstruct origin from `policy.kind`.

The lift arms are mechanical and exhaustive:

- an exact ordinary owner matrix requires a non-null owner field and lifts to
  canonical `owner`, as before;
- an exact all-refused v2 matrix with source origin
  `implicit-no-posture` and target `migrationPhase: phase-1a` lifts to canonical
  `migration-pending`, with **all five** dispositions
  `migration-pending`;
- an exact all-refused authority-table body lifts to canonical `refused`, with
  all authority members null, including normalization of a dead owner field;
- an exact all-refused `implicit-no-posture` body under target
  `migrationPhase: post-flip` lifts to canonical `refused`; and
- any other exact all-refused source may lift to `refused` only when its bound
  source origin independently resolves refusal. Newly added explicit posture
  syntax or any source/body disagreement is a semantic change and is not
  liftable.

This Phase-1a arm is representation-only even though the v3 canonical kind is
not `refused`: v2 encoded the same pass-through state as all-refused **body
bytes** plus the projection-only `migration-pending` fact. The lift decodes
that historical two-part v2 encoding into v3's single canonical representation;
it does not grant, revoke, or transition authority. Source origin and target
phase are deterministic, receipt-bound inputs, so two readers cannot choose
different meanings. The lifted v3 body is then byte-identical across baseline,
manifest, activation, resolved carrier, projection, and runtime binding.

The lift otherwise preserves valid class and disclosures, adds null
attribution/membership plus derived read discriminators, and rehashes only the
eligible G1 roots in v3 domains. Mandatory positive fixtures include Campfire
`messages` (`public-read`, ordinary, implicit-no-posture) and Team Chat
`messages` (`membership`, ordinary, implicit-no-posture) under `phase-1a`;
both must lift from exact all-refused v2 bytes to canonical
`migration-pending`. Team Chat `roomMembers` and the current
permission-backing baselines are the authority-table-to-refused controls. A
hand-crafted owner matrix with null field or non-ordinary class is not
liftable. Any other semantic deviation enters ordinary transition governance.

A v2 history containing a real predecessor or approval is never rewritten.
Every old node, body, approval, closure, receipt, id, and digest remains under
its original version. To activate v3, append a v3 head-boundary node pointing
to the exact v2 head digest and carrying the exact current v3 successor. When
source semantics are unchanged, that successor must equal the mechanical lift;
when they changed, it is the ordinary governed v3 normalization and the
boundary's incomparable approval covers the change. The boundary node's
`predecessorNormalizedPolicyBody` is decoded and exact-key
validated under the **v2** body schema, and its `predecessorPolicyDigest` is
computed and verified in the v2 policy-body digest domain. Both values must be
deep-equal to the body and digest of the referenced exact v2 head; merely
matching one hash is insufficient.

A v3 ledger may retain one contiguous v1 segment below one contiguous v2
segment, with LLP 0264's existing recognized v1-to-v2 boundary between them,
and then exactly one v2-to-v3 boundary. Each segment and the older boundary
validate under their own rules. After the v2-to-v3 boundary, every appended
node is v3; v1/v2/v3 interleaving, a second v2-to-v3 boundary, downgrade, or a
predecessor link that skips the actual v2 head refuses. The v3 boundary node
hash encodes both the node's v3 schema tag and the predecessor's v2 schema tag.
The transition approval-scope hash likewise encodes both tags plus both
domain-qualified body digests, so a digest cannot be replayed in the wrong
version domain. Exact byte layout and canonical field order are delegated to
the D8 interchange goldens named
`dual-tag-v2-v3-transition-node-preimage` and
`dual-tag-v2-v3-transition-scope-preimage`; conformance is equality with those
golden preimages and hashes, not an implementation-selected serialization.
Such a non-root bridge is incomparable unless a future Spec defines a narrower
representation bridge; under this Spec it uses the ordinary remotely-prior
`approved-transition` path.

A v3 reader walks and validates the v1, v2, and v3 segments and both recognized
boundaries in order. A v1/v2 reader refuses the v3 ledger; v3-to-v2 downgrade
always refuses. Golden
negatives cover a tampered embedded predecessor body, a digest calculated in
the wrong domain, a skipped v2 head/node, and a hidden semantic change across
the boundary. The immutable LLP 0234 G1 closure receipt remains byte-for-byte
unchanged, following the v1-to-v2 precedent; the bridge neither rehashes nor
borrows it.

### Authorization-review v3 delta

The section becomes
`snapback.authorization-review.write-policy-checks.v3`. The containing
authorization-review artifact remains v2. Every row retains all v2 required
fields and adds these required fields:

```text
authorityKind
formDisposition
postureOrigin
migrationPhase
attributionField
attributionFieldResolution
membership
membershipResolution
readDiscriminatorFields
authRequirement { value, origin }
pointExistenceDisclosure
deleteWhereCardinalityDisclosure
```

The exact new/replaced domains are:

- `authorityKind`: the six D5 kinds plus `runtime-resolved`;
- `formDisposition`: every D5 disposition plus `runtime-resolved`;
- `genericWriteDisposition`: `owner-policy`, `membership-write`,
  `authenticated-write`, `open-write`, `generic-refused`,
  `migration-pending`, `legacy-undeclared`, or `runtime-resolved`;
- attribution field: string/null with resolution `exact`,
  `not-applicable`, or `runtime-resolved`;
- posture origin: the exact D5 resolved-origin domain plus `runtime-resolved`;
  migration phase: `phase-1a`, `not-applicable`, or `runtime-resolved`;
- membership: the exact canonical D5 member or null, with the same resolution
  domain;
- read discriminators: canonical sorted unique strings, empty when exact and
  absent, or null only when runtime-resolved;
- auth requirement value: `public`, `optional-user`, or `authenticated`; origin:
  `explicit`, `derived`, or `legacy-default`;
- `principalSource`: existing values plus `auth.userId-required`;
- `ownerInputDisposition`: existing values plus
  `host-stamped-attribution`, `sealed-auth-user-id-attribution-marker`, and
  `input-refused-host-restamped-attribution`;
- point-existence disclosure: `read-authorized-or-identical-absent`,
  `physical-present-vs-missing`, `membership-present-admitted-or-role-denial`,
  `not-applicable`, or `runtime-resolved`;
- delete-where cardinality: `surface-defined-outside-claim`,
  `not-applicable`, or `runtime-resolved`; and
- `uniqueConflictDisposition.kind`: `owner-partitioned`,
  `declared-disclosure`, `missing-disclosure`, `not-applicable`, or
  `runtime-resolved`, always with a sorted unique `constraints` array.

Exact and runtime-ceiling-member rows always carry an exact
`formDisposition`, including `refused`. A diagnostic for a refused candidate
carries the complete candidate row but publishes no artifact. Opaque rows use
`runtime-resolved`; no other exact row may.

`preflightChecks[]` is an ordered subset of this closed enum:

```text
target-policy, authority-table-class, posture-shape, form-admission,
resolved-posture-origin, write-migration-activation, function-auth, execution-carrier,
carrier-invocation-binding, membership-binding, membership-read-pairing,
membership-resource-authorability, attribution-input,
owner-input, owner-immutability, read-discriminator-immutability,
membership-resource-immutability, unique-disclosure, closed-table-ceiling,
conservative-all-form-census, census-declaration-reconciliation
```

`authoritativeChecks[]` is an ordered subset of:

```text
installed-policy-dispatch, resolved-posture-origin, carrier-operation-binding,
carrier-invocation-binding, carrier-policy-digest,
carrier-migration-activation, ordered-effect-log,
specialized-authority-refusal, effective-principal-required, owner-stamp,
old-owner, identical-absent, owner-delete-filter, membership-resource-resolve,
membership-active-roster, membership-role-bound,
membership-identical-role-denial, membership-denial-witness, attribution-stamp,
attribution-restamp, read-discriminator-immutability,
physical-point-existence, unique-conflict-disclosure,
pre-0264-runtime-behavior, installed-policy-refusal
```

No other string is schema-valid. Taxonomy combinations must match D5 exactly:
for example, `owner-policy` requires owner kind/non-null owner/null attribution
and membership; membership-write requires its member and null owner;
authenticated requires attribution and null owner/member; open requires all
three null; migration-pending requires `implicit-no-posture`, `phase-1a`, null
authority members, and migration-pending dispositions. Candidate refused forms
retain the installed kind and use `formDisposition: refused`.

Every exact explicit, owner-derived, authority-table-ineligible, and
omission-refused row has `migrationPhase: not-applicable`. A post-flip
implicit-no-posture refusal does too. Therefore the target registry flip
changes the row id only for a real Phase-1a migration row; an explicit
posture's resolved carrier and review-row id are byte-identical on both sides
of the flip. `phase-1b` and `post-migration` are not schema-valid aliases.

Row id rotates to `snapback:write-policy-check:v3`; it does not deliberately
lag the section version. It binds operation, site, form, table, complete v3
body digest, auth value and origin, authority/member/attribution/immutability
facts, posture origin/migration phase, form disposition, residual disclosure facts, and exact unique
disclosure identity. `siteId` remains source-site stable. `policyDigest` is the
v3 shared ordinary-policy **body** digest, not the old installed-read digest.
Rows and sets retain LLP 0173 canonical ordering and render facts, never
approval verdicts.

## D6. Runtime enforcement, census, and trusted execution

### Closed dispatcher

`generic_owner_write_field -> Option<&str>` is replaced by a closed result:

```text
GenericTableWriteAuthorityV2 =
  Refused { reason }
  | Owner { field }
  | Membership { declarationClosure, resourceField, effectiveRoles,
                 attributionField? }
  | Authenticated { attributionField }
  | Open
  | MigrationPending
```

The dispatcher returns one exact form disposition with the authority. Only the
`Owner` variant can create or consume `ownerWriteCheck` and call
`owner_row_matches`. Binding those paths to membership or attribution is a
type error, not a nullable-field convention. `defineOwnedCrud` and
`ownedRowGuard` generate only when the installed authority is exact derived
owner; owner-read paired with any explicit posture refuses the helper.

HostPlan preflight resolves every nested generic step before execution. The
early JavaScript gate resolves the same installed posture for diagnostics and
side-effect fencing. The authoritative HostPlan and buffered-commit seams
re-resolve it in the committing transaction. A forged early result cannot
widen authority. For non-owner point forms, the early gate replaces the
shipped `effective_point_is_visible` decision with the D4 admission rule and
the posture-specific outcome; read visibility is not a substitute write check.
Every seam receives `ResolvedInstalledWritePostureV2`; no seam derives
`MigrationPending`, refused, or an explicit authority from the read kind.

### `FunctionWritePolicyV2` and execution carrier

The function-level carrier rotates; `FunctionWritePolicyV1` keeps only its
historical `snapback.owner-write.v1` meaning. New activation requires
`FunctionWritePolicyV2` with semantic identity
`snapback.write-authority.v2`. It contains the exact/opaque census, declared
ceilings, auth requirement value/origin (`explicit`, `derived`, or
`legacy-default`), and operation-bound disclosure set. No translation alias is
schema-valid.

After activation validation, the host constructs a versioned
`WriteExecutionAuthorityV1` exactly once per invocation at the named
`prepare_write_execution_authority` point: after `PreparedInvocation` resolves
the operation and effective auth, and before handler JavaScript or a HostPlan
can execute. It binds:

```text
invocationIdentity
operationId
effectiveAuth { value, origin }
effectivePrincipal { userId | absent }
writePolicy { semanticVersion, sharedPolicyDigest }
writeMigrationActivation { semanticVersion, targetId, migrationPhase, digest }
sites { mode: exact | ceiling, facts[] }
```

Each site fact binds stable site id when exact, table, form, installed
authority kind/form disposition, declaration/member/attribution identities,
resolved posture origin/migration phase, and reached disclosure ids. The
carrier exists only in host-owned memory for that invocation. It is immutable
and is never serialized into handler-reachable arguments, JavaScript values,
plan-authored data, handler results, or another payload from which application
code could replay it. The host passes the in-memory fact to HostPlan execution
and the buffered-commit seam.

Activation cross-checks function carrier sites/ceilings and disclosures
against the manifest's `TableWritePostureV2`, resolved installed posture,
normalized body, shared digest, operation registry, and the exact
activation-receipt-bound `WriteMigrationActivationV1` record. Every lower seam
independently receives the executing invocation identity and effective
principal from host state and compares them with the carrier before
target/value access. It also checks operation identity, exact or ceiling
membership, effective auth value/origin, installed policy semantic
version/digest, the target write-migration activation identity/digest, resolved
origin/phase, form, and operation-bound disclosure.
A missing carrier, mismatched/absent effective-principal fact, stale or
cross-invocation identity, cross-operation use, or forged policy fact refuses
as uncomposed. Handler input can never supply or repair the fact. Replaying a
carrier into the same operation under the same principal would be permission
reuse rather than privilege escalation, but the invocation binding refuses it
anyway and leaves no freshness exception. Only the valid carrier can
distinguish operation A from otherwise identical operation B.

### Sound operation census

Exact census is limited to direct, statically bound `ctx.db.<form>` member
calls with a statically resolved form and an exact table or admitted exact
runtime ceiling. Any write-capable alias, indirect helper, computed member,
escaped `ctx`/`ctx.db`, unresolved call graph, or other path the scanner cannot
prove direct marks the complete module `opaque`.

Opaque execution requires `conservative-v1` plus an exact closed table ceiling
and checks all three JavaScript forms against every ceiling member, or refuses.
It still cannot satisfy Phase-1b corpus closure, which requires exact sites.
The exact census is the union of direct JavaScript call sites and every generic
HostPlan plan-step site, including steps nested in `WriteWithActivity`.
HostPlan steps are not inferred from the JavaScript scanner and may not be
discarded merely because the handler has no direct `ctx.db` call. `sites: []`
with a nonempty declared write set **or any HostPlan generic step** refuses. A site/declaration
mismatch in either direction, a declared table absent from exact sites, an
undeclared site, or a form/ceiling mismatch refuses generation. There is no
honest zero-site shortcut for a writing operation.

### Central unique and specialized classification

Unique-conflict census runs for **every admitted write posture**, not only
owner. It determines owner partitioning or exact disclosure from installed
posture, form, changed fields, and constraint members. Insert-each uses the
insert constraint set and is atomic.

The implementation must add, rather than assume, exhaustive authority-table
refusal: HostPlan preflight checks membership and permission-backing; the early
JavaScript gate covers ordinary, anonymous, service, delegated-service,
system/cron, and admin-bypass principals; buffered commit checks both classes;
and stale-carrier/direct-storage paths check again. Specialized membership
writer operations remain admitted only through their own carrier.

The exhaustive step classifier names all five generic forms,
`AssetCollection`, `AllocateSequence`, non-writing steps, ordinary Mutation
plans, and `WriteWithActivity`'s nested plan. Asset collection stays on its
specialized writer. `WriteWithActivity` does not shield inner generic writes
from this dispatcher.

### Overlay and residual disclosures

Read-your-writes overlay injects the host-owned owner stamp for owner insert
and the host-owned attribution stamp/restamp for authenticated and attributed
membership writes. It also folds the exact specialized membership-command
prefix from D4's unified ordered effect log, so a later generic write sees a
buffered bootstrap/setSelfRole seat and a write after removeSelf sees its
absence. Open and unattributed membership writes add no host field. Overlay
bytes and membership facts match the eventual ordered commit, including an
empty-authored restamp.

Arbitrary read pairing deliberately admits two disclosures outside the
noninterference claim:

- an admitted open/authenticated point write can reveal the physical
  present-versus-missing bit even when read policy hides the row; and
- admitted open/authenticated delete-where can expose the surface's changed-
  count cardinality. Membership delete-where is refused in v1.

The first is projected per row as `physical-present-vs-missing` and tested with
hidden-present versus missing. Membership point forms instead project
`membership-present-admitted-or-role-denial` and obey D4's single terminal
denial rule. The second is projected as
`surface-defined-outside-claim`. Neither releases row contents. Arbitrary
return/copy/activity/job/log egress remains LLP 0264 D8 work.

## D7. Diagnostics and refusal precedence

Normative new/extended codes are:

| Code | Locus | Meaning |
| --- | --- | --- |
| `SNAPBACK_TABLE_WRITE_POSTURE_INVALID` | generation/activation | Explicit posture keys, kind/member combination, or form map is malformed. It does not represent authority-table ineligibility. |
| `SNAPBACK_TABLE_WRITE_POSTURE_UNSUPPORTED` | generation/activation/runtime | Posture or semantic version is unknown. |
| `SNAPBACK_TABLE_WRITE_FORM_REFUSED` | generation/activation/runtime | Installed posture explicitly refuses the form. |
| `SNAPBACK_TABLE_WRITE_AUTH_REQUIREMENT_INCOMPATIBLE` | generation/activation | Authenticated or membership write is reached by a non-authenticated operation requirement. |
| `SNAPBACK_TABLE_WRITE_AUTHENTICATION_REQUIRED` | lower runtime seam | Forged/stale/direct execution has no effective principal. Normal invocation uses `SNAPBACK_AUTH_REQUIRED`. |
| `SNAPBACK_TABLE_WRITE_ATTRIBUTION_FIELD_INVALID` | generation/activation | Attribution is absent/optional/defaulted/type-invalid or collides with a read/authority discriminator. |
| `SNAPBACK_TABLE_WRITE_ATTRIBUTION_INPUT_REFUSED` | generation/runtime | Authored insert/patch data names attribution. |
| `SNAPBACK_TABLE_WRITE_READ_DISCRIMINATOR_IMMUTABLE` | generation/runtime | An explicit-posture patch names a read discriminator. |
| `SNAPBACK_TABLE_WRITE_AUTHORITY_FIELD_IMMUTABLE` | generation/runtime | A membership patch names its resource field. |
| `SNAPBACK_TABLE_WRITE_MEMBERSHIP_BINDING_INVALID` | generation/activation | Declaration, resource field, or role bound is invalid. |
| `SNAPBACK_TABLE_WRITE_MEMBERSHIP_READ_BINDING_MISMATCH` | generation/activation | A membership writer on a membership-restricted read policy matches no read arm's exact declaration/resource-field pair. |
| `SNAPBACK_TABLE_WRITE_MEMBERSHIP_RESOURCE_REQUIRED` | generation/runtime | An admitted membership insert omits its resource field. No resource or roster lookup runs. |
| `SNAPBACK_TABLE_WRITE_MEMBERSHIP_RESOURCE_NOT_AUTHORABLE` | generation/activation | An admitted membership insert binds a host-generated/non-authorable resource field such as `_id`. Patch/delete-only use remains valid. |
| `SNAPBACK_TABLE_WRITE_MIGRATION_ACTIVATION_INITIALIZATION_REFUSED` | activation/registry admission | A fresh `phase-1a` record lacks exact pre-flip-root or retained same-target predecessor eligibility, a post-flip new/rebound target does not cite exact `R`/`F`, or an existing target id is reset. |

Existing `SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE` is the one public
generation code for an explicit posture on an authority table. Existing
specialized membership/permission runtime codes may remain compatibility
projections at their seam. `SNAPBACK_AUTH_PERMISSION_DENIED` with
`{ kind: "role" }` is membership admission denial. Unique, omission/removal,
owner, uncomposed, and Phase-1b no-posture codes keep LLP 0264 meanings as
amended in D1.

After parse/schema validation, generation/activation precedence is:

```text
uncomposed surface
authority-table class
policy removal or unrooted omission
write-migration activation initialization
  (`SNAPBACK_TABLE_WRITE_MIGRATION_ACTIVATION_INITIALIZATION_REFUSED`)
posture shape/version and membership binding
membership/read-arm pairing and insert resource authorability
function-auth incompatibility
refused/no-posture-ineligible form
census/ceiling reconciliation
unique-disclosure requirement
attribution input
membership-resource input
read-discriminator input
owner/default input rules
```

A conforming runtime first applies the function invocation gate. Below it:

```text
uncomposed or specialized authority-table class
execution-carrier identity and installed-policy digest
unsupported/omitted posture and refused form
effective principal requirement (before value-map or target evaluation)
authored attribution input
membership-resource input
other read-discriminator input
owner input
membership target-resource and role admission
authoritative row/unique outcome
```

The input-rule order is exact when one forged/stale value map violates more
than one protection: authored attribution wins first;
`SNAPBACK_TABLE_WRITE_AUTHORITY_FIELD_IMMUTABLE` wins next when the field is
the membership resource (even if it is also a read discriminator); the general
read-discriminator code wins next; owner/default rules follow. Generation
normally rejects attribution collisions, but lower seams retain this order for
malformed or stale carriers. No implementation may choose a code by hash-map
iteration or field order.

Static details may name operation, table, form, fields, posture, declaration,
auth requirement/origin, roles, and source span. Runtime details may name only
table, form, posture, and invariant role denial kind. They never contain a
target id, resource, stored owner/attribution/role, expected principal,
operand, conflict value, or split match count. All runtime codes are in the
typed handler-envelope allowlist.

## D8. Independent qualification and claim boundary

An implementation counts toward LLP 0264 Phase 1b only after this Spec is
Accepted and the target passes this scoped battery.

### Authoring, lowering, and census

1. Positive fixtures cover all three exact posture objects and every form.
   Missing/extra keys, all-refused maps, role/member errors, unsupported kinds,
   invalid attribution, delete-where membership admission, and authority-table
   declarations refuse with the pinned codes. Membership insert with an
   omitted resource field and admitted insert over non-authorable `_id` use
   their exact codes; `_id` with patch/delete-only remains positive.
2. The lowerer strips `write` before the unchanged read canonicalizer and
   produces sibling read/write values. The three D1 divergence implementations
   (whole-object canonicalization, write bytes inside read policy, ignored
   adjacent manifest posture) each refuse.
3. Generated patch types make every read discriminator, membership resource,
   and attribution field `never`; dynamic JavaScript and HostPlan attempts,
   including same-value updates, refuse before row access. Any-of fixtures
   include every arm. Attribution/discriminator collision refuses generation.
   Membership-read pairing succeeds only on an exact declaration/resource-field
   arm. An insert whose write binding C matches **no** membership read arm R
   refuses with `SNAPBACK_TABLE_WRITE_MEMBERSHIP_READ_BINDING_MISMATCH`; a
   separate any-of fixture proves that additional arms beside one exact match
   remain deliberate publication audiences in the canonical read closure.
4. No read policy derives a new posture. No-posture public/membership/any-of
   fixtures carry exact resolved origin plus canonical `migration-pending` and
   `migrationPhase: phase-1a`, then canonical refused plus
   `migrationPhase: not-applicable` under a synthetic committed
   `WriteMigrationActivationV1` flip marker bound to the qualified closure
   receipt. Missing/mismatched receipts, marker rollback, ambient-config phase
   selection, and the aliases `phase-1b`/`post-migration` refuse. Fresh-target-
   after-flip and target-rebind-after-flip negatives attempt to initialize
   `phase-1a` or reset the target id and both refuse with
   `SNAPBACK_TABLE_WRITE_MIGRATION_ACTIVATION_INITIALIZATION_REFUSED`; their
   positive controls initialize `post-flip` with the exact qualified `R`/`F`
   pair. A pre-flip out-of-root negative with no retained same-target
   predecessor refuses `phase-1a` initialization with the same code and cannot
   initialize `post-flip` because `F` does not exist. An existing target whose
   retained state is `post-flip` cannot roll back to `phase-1a` and refuses with
   the same code. Exact
   explicit and non-migration derived owner/authority/omission-refused postures
   carry `not-applicable` on both sides; their resolved carriers and review-row
   ids are byte-identical. Every
   projection and runtime seam consumes the same resolved carrier rather than
   branching on read kind.
5. Direct JavaScript sites reconcile to declared writes. Aliased
   `const patch = ctx.db.patch`, computed `ctx.db[form]`, and
   `helperThatWrites(ctx, ...)` fixtures become opaque and require
   conservative-v1 plus an exact ceiling or refuse. Nonempty declarations with
   `sites: []`, undeclared sites, and table/form mismatches refuse. A HostPlan-
   only `paintCell` fixture contributes its exact plan-step site and prevents a
   false zero-site refusal; nested `WriteWithActivity` steps do likewise.
6. Explicit public, optional-user, and legacy-default operations targeting
   membership/authenticated write refuse with correct origin. Exact/derived
   authenticated succeeds. Only the three pinned origin strings are
   schema-valid. Opaque/ceiling coupling is conservative.

### Runtime authority

7. Open anonymous/authenticated cases exercise every form and both applicable
   pipelines. Refused forms fail generation; forged carriers fail before
   effect. Author-like fields remain data.
8. Conforming anonymous authenticated/member invocations return
   `SNAPBACK_AUTH_REQUIRED`. Direct/stale lower-seam cases return
   `SNAPBACK_TABLE_WRITE_AUTHENTICATION_REQUIRED` before value evaluation;
   omitted and sealed-marker HostPlan inputs are byte-identical, as are
   missing and present targets. Missing, forged, cross-operation,
   cross-invocation, stale same-principal/same-operation, principal-mismatched,
   and handler-serialized carriers all refuse uncomposed before target access.
9. Authenticated insert/insert-each stamps; authored literals, arguments,
   bindings, JavaScript values, and defaults refuse. Alice-to-Bob patch proves
   restamp without owner comparison.
10. Empty-authored and semantically same-value patches run through JavaScript
    and HostPlan. Each restamps, bumps version, reports attribution in
    `changedFields`, updates read-your-writes, and emits/rolls back companion
    effects under the ordinary contract.
11. Membership insert/patch/delete fixtures cover active member, non-member,
    insufficient role, pending role, anonymous, and forged carrier. Insert
    checks the authored resource; point forms check the stored immutable
    resource. Missing target, nonexistent resource, nonmember, pending, and
    wrong-role bytes are identical, including when the caller belongs to a
    different resource. Hidden witness assertions distinguish: missing point
    targets produce `TargetAbsent` bound to target-key absence/declaration/
    snapshot and perform no fabricated roster lookup; present-target
    nonmember/pending/wrong-role and nonexistent-resource insert denials
    produce `CommittedRoster`; both retain the coherent witness and obligation-
    floor behavior required by LLP 0056.
12. Membership OCC fixtures revoke/remove or lower the role concurrently with
    a write and prove retry/refusal with no partial effects. Cross-room forgery
    proves a signed-in Room A member cannot write a Room B message or
    participant. Resource-field patching refuses. Delete-where is absent and a
    forged admitted carrier refuses. Ordered-effect fixtures prove Team Chat
    `createRoom` succeeds when `bootstrap` precedes its participant insert in
    the same mutation, `acceptInvite` succeeds when `setSelfRole` precedes its
    participant patch, and `removeSelf` followed by a dependent generic write
    returns role denial with no partial effect and hidden `OverlayPrefix`
    witness binding invocation identity, the denied `programOrder`, exact
    prefix digest, and base data version. Reversing those orders does not borrow
    a future membership state. The named `overlay-prefix-digest-preimage`
    interchange golden pins the
    `snapback:unified-write-effect-prefix:v1` domain, exact bytes, field order,
    and hash. Public denial bytes remain identical across all three hidden
    witness variants.
13. Optional membership attribution runs the full D3 stamp/restamp matrix;
    unattributed membership writes add no identity field. An unattributed empty
    patch performs admission and then produces the exact no-version/no-effect
    no-op; its denial side has no early empty-map shortcut. Neither can mutate
    a roster/permission table.
14. Owner-read paired with open, authenticated, and membership write performs
    admitted blind point writes on physically present read-invisible rows.
    Open/auth paths do not bind `ownerWriteCheck`; only exact owner reaches
    `owner_row_matches`. `defineOwnedCrud`/`ownedRowGuard` refuse all explicit
    postures.
15. Bare user, anonymous, service, delegated service, system/cron,
    admin-bypass, HostPlan, buffered, stale-carrier, and direct-storage
    authority-table attempts prove membership and permission-backing refusal at
    every required seam. Specialized roster operations remain positive.
16. Exhaustive classification fixtures cover ordinary HostPlan,
    WriteWithActivity inner mutations, AssetCollection, AllocateSequence, and
    every non-writer. No wrapper/default inherits authority.

### Unique, governance, and projection

17. Unique census runs on owner, membership, authenticated, and open admitted
    writes. Insert-each reaches the insert set; a conflict rolls back the whole
    batch. Operations A/B prove disclosure operation binding at commit.
18. Concrete non-owner fixtures include Campfire
    `messages.by_room_sequence` and
    `reactions.by_message_emoji_user`; Chirp `likes.by_post_user`; Messaging
    `conversationMembers.by_conversation_user` and
    `reactions.by_message_user_emoji`; Team Chat
    `messages.by_room_page_key` and
    `roomParticipants.by_room_user`. Missing declarations produce a complete
    candidate row with `missing-disclosure` and no published artifact.
19. Canonicalization round-trips every valid kind/disposition/taxonomy and
    refuses every cross-kind combination. v1/v2/v3 exact key sets and digest
    domains are independently golden-tested; old readers refuse v3. The named
    `write-migration-activation-v1-preimage` interchange golden pins the
    `snapback:write-migration-activation:v1` domain, exact bytes, field order,
    and hash.
20. Root-only G1 lift fixtures include ordinary owner; exact Phase-1a
    all-refused v2 Campfire `messages` and Team Chat `messages`, whose bound
    ordinary implicit-no-posture source/phase lifts to canonical all-form
    `migration-pending`; the same inputs under committed post-flip state, which
    lift to refused; and current membership/permission-backing baselines,
    including Team Chat `roomMembers`' dead `ownerField`, which remain refused.
    Source/body disagreement, explicit posture syntax, hand-crafted null-owner,
    and nonordinary owner matrices refuse. Approved historical nodes and
    receipts remain byte-identical; their v3 boundary is appended and version-
    dispatched, never rehashed. Positive mixed-chain fixtures retain v1 below
    v2 below exactly one v3 boundary and validate each segment plus the existing
    v1-to-v2 recognition. Bridge negatives cover a tampered embedded
    predecessor body, a wrong-domain predecessor digest, a skipped v1/v2 head,
    version interleaving, a second v2-to-v3 boundary, and hidden semantic
    change. Named `dual-tag-v2-v3-transition-node-preimage` and
    `dual-tag-v2-v3-transition-scope-preimage` goldens define exact domain,
    bytes, field order, and hashes. The G1 closure receipt stays byte-identical.
21. Comparator vectors cover every lattice edge per form, owner versus
    membership, membership role subset/superset/rebind, attribution/member/
    owner field rebind, open-to-field introduction, mixed-form changes,
    disclosure sets, semantic versions, and read/write cross-axis changes.
    Equal-size non-subset role swaps are incomparable. Named vectors prove
    refused to owner, membership, and authenticated is incomparable while
    refused to open is growth. Separate kind-level vectors prove every
    migration-pending adoption—owner, membership, authenticated, and open—is
    incomparable regardless of partial-form shape, formwise composition is not
    invoked, and only the receipt-bound same-origin all-form flip to refused is
    narrowing;
    public-read/authenticated-write with caller-controlled `roomId` cannot
    narrow to membership-write, and authenticated-write stamping
    `lastEditorId` with caller-controlled `ownerId` cannot narrow to owner.
    Public/open to owner/open and public/authenticated to restricted/
    authenticated are incomparable. Null-predecessor root-admission vectors
    run the same complete two-axis body: owner-read/open-write and membership-
    read/authenticated-or-open-write are negative `new-restricted` cases and
    require `approved-transition` nodes with null predecessors plus exact prior
    approvals/receipts; owner-read/owner-write and contained membership-read/
    membership-write are positive `new-restricted` cases, with derived refused
    as a positive control. Exact approvals/receipts are required.
22. Projection goldens cover exact, runtime ceiling, opaque, refused
    candidate, sealed marker, restamp, membership role, residual disclosure,
    resolved posture origin/phase, auth mismatch, and `missing-disclosure`.
    Every required field reconstructs the v3 row id; `siteId` stays stable
    across policy changes. Explicit and non-migration
    owner/authority/omission-refused `not-applicable` phase rows remain byte-
    identical across the target flip; only an actual migration row rotates to
    the post-flip refused identity.

### Disclosure and claim boundary

23. Hidden-present versus missing fixtures project and prove the admitted
    physical point-existence bit for open/authenticated point forms only.
    Membership fixtures instead prove present-in-admitted-resource success
    versus one terminal role denial for missing/nonmember/pending/wrong-role/
    nonexistent-resource cases. Behind those identical bytes, golden internal
    traces name `TargetAbsent`, `CommittedRoster`, or `OverlayPrefix` exactly as
    D4 requires; none of those witness contents is projected publicly.
    Delete-where changed counts are explicitly projected outside the claim.
    Neither result contains row values.
24. The proof covers form admission, effective principal, membership role,
    server attribution, discriminator immutability, typed refusal bytes,
    operation-bound unique bits, OCC, batch atomicity, and absence of partial
    companion effects.
25. It does not cover arbitrary HostPlan documents/records/expressions,
    JavaScript returns, old/new row copies, activity/audit rows, jobs,
    notifications, assets, logs, field masking, or recipient audience. Claims
    may say only `open-write admission`, `authenticated-write admission and
    attribution`, or `membership-write admission against <declaration/roles>`.

Independent evidence identity is distinct from the corpus receipt. A generated
projection is evidence, not runtime proof.

## D9. Demo migrations and Phase 1b closure

### Exact demo mapping

| Demo | Posture and current forms |
| --- | --- |
| Campfire | `open-write`: messages insert; reactions insert/delete. Caller `author`/`userKey` remain unauthoritative. |
| Chirp | `open-write`: posts insert/patch; likes insert/delete. Counter patches are honestly table-wide. |
| Messaging ordinary | `open-write`: written conversations, conversationMembers, messages, and reactions with only censused forms admitted. Persona fields remain unauthoritative. |
| Graffiti | `authenticated-write` on cells, attribution `authorId`, current insert only. `paintCell` becomes explicitly authenticated; its HostPlan marker is compatibility syntax. |
| Team Chat messages | `membership-write` using `roomMembers`, `resourceField: roomId`, effective roles `owner | member`, attribution `authorId`, insert only. JS omits authored `authorId`; the host stamps it. |
| Team Chat roomParticipants | `membership-write` using the same binding and roles, no attribution, insert/patch only. `userId` is invitee data; `roomId` and `userId` are immutable because they are authority/read discriminators. |
| Messaging view-once | No broad posture. Replace the grant map with grantee-owned grant rows and keep specialized asset-grant creation. |

Exact forms come from regenerated sound census. Unused forms remain refused.
Each named non-owner unique constraint in D8 requires its operation-bound
disclosure. Read-only `rooms`, `profiles`, and Messaging `users` gain no write
posture.

### Team Chat closure

The `owner | member` role set on `roomParticipants` is a documented
**table-wide ceiling**, not the exact operation policy inferred from today's
handlers. Any active owner or member can generically insert or patch another
participant's display/status row in the same room, because `userId` is invitee
data and immutable rather than the caller predicate. Handler gates are
additional operation-level restrictions: invite/remove remain owner-only, while
send and ordinary participant convergence can use the wider table ceiling. The
review projection and guide must state that breadth plainly; “the handlers
justify the exact role set” is forbidden wording.

Team Chat closes only after D4's new ordered runtime and these source-level
conditions qualify:

- `createRoom` buffers `bootstrap` before its participant insert, and the
  insert observes the creator seat through the exact membership overlay;
- `acceptInvite` buffers `setSelfRole` before its participant patch, and the
  patch observes the newly active `member` seat;
- `inviteMember` and `ownerRemoveMember` do not rely on the specialized command
  to create the caller's role; their caller remains owner while the generic
  convergence write is admitted; and
- the current `leaveRoom` source orders `removeSelf` before its participant
  patch. The shipped class-concatenating seam happens to execute generic writes
  first, but that accidental survival is not a contract. Under the unified log,
  `removeSelf` followed by the dependent patch must deny. The demo migration
  must explicitly place every membership-dependent delivery/participant write
  before `removeSelf`, or replace the sequence with a separately specified
  specialized atomic operation; the runtime may not silently reorder it.

Phase 1b also requires an exact census. `myParticipant` and
`myRoomDeliveries` currently receive escaped `ctx` and issue database calls
through helper functions, making the module opaque under D6's direct scanner.
They must be inlined at each call site or admitted by a sound
interprocedural proof that emits the exact sites. A declared table ceiling does
not make an opaque Team Chat module closure-qualified.

With those changes, no roster restructure of `roomParticipants` is required.
Until they land and D8 passes, D9 records a migration target and may not claim
Team Chat or Phase-1b closure.

Handler `requireRole` remains useful narrowing but is not the table authority.
The commit seam repeats the posture's role bound. Cross-room carrier/argument
forgery cannot substitute Room A membership for a row whose stored `roomId` is
Room B.

The deliveries/read-marker ruling stands: the intended product replaces
per-recipient delivery rows with recipient-owned last-read markers and derives
unread state from membership-visible messages. Membership-write paired with
owner-read would now make direct fan-out technically expressible: a room member
could insert a recipient-owned delivery whose recipient discriminator is set
on insert and thereafter immutable. Adopting that alternative is a separate,
governed product decision and is not part of this closure.

### Messaging view-once closure

`viewOnceMessages` becomes author-owned; live grant rows are grantee-owned and
created through the declaration-owned asset-grant writer; consume/close acts on
the caller's own grant row. `viewOnceConsumptions` is included explicitly and
its `by_message_principal` uniqueness remains owner-partitioned when principal
is the owner field. Author-wide revoke and asset lifecycle stay specialized.
Authenticated-write would be overbroad and is forbidden for this migration.

### Governed adoption and receipt

Every canonical `migration-pending` adoption to owner, membership,
authenticated, or open is kind-level incomparable and uses the ordinary
two-push LLP 0234 approval/separation sequence; partial-form composition cannot
waive it. For canonical `refused`, open is rank growth while owner, membership,
and authenticated are protected-field incomparable, and each likewise uses
the governed sequence. Form growth repeats it. The migration window is not
approval.

The LLP 0264 Phase-1b closure receipt is keyed by the registry-derived
canonical backend-job set, with exactly one record per job. `34` is only a
historical census, never a schema constant; rows and sites cannot masquerade
as jobs. A job is closed only when:

- every generic write is exact owner, membership, authenticated, or open, or
  has been replaced by a declaration-owned specialized operation;
- zero ordinary public-read/membership/any-of generic-write target lacks an
  installed explicit posture, and zero authority-table target remains generic;
- every explicit transition and disclosure is governed and target-qualified;
- operation/auth/form/census/carrier/policy digests agree;
- no opaque site, migration-pending row, uncomposed surface, or undeclared
  write remains; and
- Team Chat and view-once use the exact models above.

The Phase-1b flip affects only installed canonical `migration-pending` whose
resolved origin is `implicit-no-posture`. The qualified receipt is committed
first; the flip implementation and target-scoped activation marker naming that
receipt then land together and move the registry from `phase-1a` to the one
collapsed `post-flip` state. The posture-local result is canonical refused with
`migrationPhase: not-applicable`. The marker cannot refuse or rewrite an
explicit posture: explicit and non-migration derived owner/authority/omission-
refused carriers and review-row ids remain byte-identical. The receipt remains
independent of G1, cites the scoped LLP 0189 battery, and makes no result-egress
claim.

## Non-goals

- Generic roster mutation, delegated/grant-derived writes, or an arbitrary
  relationship language. Membership-write is the ordinary-target slice only.
- Any-of-write, caller-selected principals, impersonation, service stamping,
  owner transfer, or write elevation.
- Membership delete-where in v1.
- Mutable read/authority discriminators or attribution/read-field collision.
- Class M field masking or arbitrary result/copy/side-effect egress.
- Restoring Team Chat fan-out or retaining Messaging's JSON grant map by
  silently broadening authority.
- Treating handwritten application interpretation of caller data as something
  Snapback's generic policy can prevent.

## Open questions

These are landing/follow-on questions, not unresolved semantics in this Draft:

1. Which implementation change carries the complete LLP 0264 D1/D2/D10/
   Phase-1b amendment and the normative LLP 0234 D5/D6 comparator amendment?
   They must land with the first implementation, not trail it.
2. Does a future membership delete-where surface justify a bounded per-row join
   and explicit cardinality contract? Until a sibling answers yes, it refuses.
3. Does Team Chat retain the read-marker product ruling or later seek a
   separately approved membership-write-over-owner-read fan-out transition?
4. Which existing approved v2 histories, if any, need remotely-prior v3 bridge
   approvals before activation? Tooling must inventory them; it may not rewrite
   their nodes or receipts.

## Status

Accepted (author ruling 2026-08-16), after the dual-family review loop
converged: rounds 1-4 each produced blind Codex + Grok reviews whose MATERIAL
findings were fixed and delta-reviewed, and the bounded round-5 delta review
marked the same revision READY in both families with zero MATERIALs
(`llp/reviews/0274-*`). The two author sittings' rulings — three-posture
scope including membership-write, arbitrary read-pairing with
discriminator-immutability and comparator hardening, the Team Chat and
view-once restructures, and incremental Phase 1b sequencing — are recorded in
D1/D5/D9. The Spec records required runtime and Team Chat source work rather
than claiming it ships: implementation plus independent qualification is still
required before any job counts toward LLP 0264 corpus closure, and no shipped
capability is claimed by this document.

## Revision history

- 2026-08-16 — accepted by author ruling after round-5 dual-family READY
  convergence (Codex + Grok, mutually blind, xhigh; zero remaining MATERIALs).
- 2026-08-16 — round-5 minor fold from the Grok delta review: Phase-1a
  predecessor eligibility scoped to the absence of the flip marker, the 0234
  read-audience-cap replacement made self-contained for `migration-pending`,
  the new-restricted justification sentence replaced with the explicit
  write-axis exception, pre-flip out-of-root and rollback-to-Phase-1a D8
  fixtures added, and activation-initialization refusal added to D7
  precedence.
- 2026-08-16 — revision round 4. Restricts Phase-1a activation records to the
  protected pre-flip target root or a retained same-target predecessor;
  requires new/rebound post-flip targets to cite exact closure and flip
  digests; makes `new-restricted` root admission classify the complete
  read/write body and routes broad-write null-predecessor roots through
  `approved-transition`; and names the activation and overlay-prefix digest
  domains plus interchange goldens.
- 2026-08-16 — revision round 3. Applies both reviewers' shared lift finding
  and all remaining Codex/Grok dispositions: decodes Phase-1a ordinary
  implicit-no-posture all-refused v2 roots as canonical migration-pending;
  binds phase to a target activation-registry marker and closure receipt with
  `not-applicable` on explicit/derived postures; distinguishes target-absence,
  committed-roster, and overlay-prefix denial witnesses; makes
  migration-pending adoption kind-level incomparable; completes the LLP 0264
  replacement inventory; and pins v1/v2/v3 segment order, dual-tag golden
  preimages, and additional any-of audience wording.
- 2026-08-16 — revision round 2. Applies both round-2 NOT READY dispositions:
  specifies a unified program-ordered effect log plus exact membership
  overlay; closes protected-field/lattice precedence, read/write membership
  pairing, missing-target denials and witnesses, canonical migration facts,
  v3-over-v2 bridging, invocation-bound carrier custody, auth-origin names,
  amendment completeness, Team Chat honesty, and every folded minor.
- 2026-08-16 — revision round 1. Integrates both NOT READY reviews and the
  second-sitting rulings: adds membership-write; makes read/authority
  discriminators immutable; closes lowering, manifest, execution carrier,
  JavaScript census, restamp ordering, auth precedence, authority-table
  refusal, v3 lift/history, projection schema, comparator, Team Chat mapping,
  residual disclosures, and the complete 0264/0234 amendment obligations.
- 2026-08-16 — initial Draft. Selected nested explicit postures, five-form
  maps, authenticated restamp-on-patch, governance/projection rotation,
  central runtime enforcement, independent qualification, and governed demo
  rollout.
