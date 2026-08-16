# LLP 0264: Table write policy

**Type:** Spec
**Status:** Draft
**Systems:** Auth, Security/authorization, Storage, Code generation, Application data API, Generated artifacts, Diagnostics, Testing
**Author:** Codex (gpt-5.6-sol) / Charlie Cheever
**Date:** 2026-08-15
**Revised:** 2026-08-15
**Related:** LLP 0231, LLP 0234, LLP 0255, LLP 0173, LLP 0240, LLP 0056

## Summary

LLP 0231 D6 fixes one table-policy locus and one policy IR for reads and
writes, but the generic write paths do not enforce that contract today. This
Spec defines the first write-side slice: generic writes to a table whose
declared policy is exactly `owner` are server-stamped and owner-checked at the
authoritative transaction. The other current policy kinds do not acquire
generic write authority by implication.

V1 has four central rules:

1. `ctx.db.insert` and HostPlan `Insert`/`InsertEach` derive the owner from the
   host's effective `authUserId()`; caller values and trusted defaults cannot
   choose it.
2. `ctx.db.patch`/`ctx.db.delete` and HostPlan
   `Patch`/`Delete`/`DeleteWhere` check the old row's owner in the transaction
   that commits the write. Missing and not-owned rows remain
   indistinguishable, and generic writes cannot change owner identity.
3. `public-read`, `membership`, and `any-of` are not generic write grants.
   Membership and permission-backing authority tables remain reachable only
   through their declaration-owned writer surfaces.
4. There is no write elevation. LLP 0231 D7 and LLP 0234 authorize bounded
   read alternatives only.

This is a specification, not an implementation or capability claim. The
shipped standard-pattern lowerers already emit the desired owner-shaped plans,
but that codegen structure is evidence and a compatibility wedge, not a
security boundary. Result egress after a write is also not solved here; §D8
names the separate phase and the risk that remains.

## S0. Shipped baseline and honesty boundary

The following is what ships on 2026-08-15. None of it constitutes general
table write-policy enforcement.

- `defineOwnedCrud` in
  `packages/snapback-codegen/standard-patterns.mjs` excludes the owner field
  from create arguments, emits `authUserId()` into the insert value map,
  excludes the owner from update arguments, rejects owner-setting trusted
  defaults, and refuses membership or permission-backing tables. Its private
  `ownedRowGuard` performs an in-plan `Get` plus owner `Guard` and collapses
  missing and other-owner rows to `SNAPBACK_ROW_NOT_FOUND`.
- `lowerDataResourceV1` reuses `defineOwnedCrud` for owner resources. Its
  `public-read.v1` branch emits only list/get queries and no mutations. These
  are the landed LLP 0255 S2 semantics. They protect only operations that
  retain this exact generated plan structure.
- `IbexHostContext::handle_host_call` in `src/runtime.rs` buffers `db.insert`
  after schema/value validation without resolving table visibility or
  stamping an owner. Its `db.patch` and `db.delete` arms call
  `read_table_visibility_point` and `effective_point_is_visible`, so an
  invisible row is currently a boolean-false no-op. The comments on both arms
  explicitly say that this is a read gate, not the LLP 0231 D6 write-policy
  slice.
- `IbexHostContext::ensure_permission_backing_write` refuses only the current
  service-principal case for a non-membership `permissionBacking` table. The
  central membership gate separately refuses raw membership writes. There is
  no one policy-locus rule covering every generic authority-table write.
- `Storage::execute_mutation_plan_with_lifecycle_and_settlement_time` in
  `src/storage.rs` refuses generic HostPlan writes to membership and
  framework-owned asset-collection tables, but ordinary `Insert`, `Patch`,
  `Delete`, `DeleteWhere`, and `InsertEach` steps do not consult the table's
  visibility policy. `DeleteWhere` constructs its scan with
  `table_visibility: None`.
- `Storage::apply_buffered_writes_with_lifecycle_gated` is the authoritative
  transaction seam for buffered handler writes. It validates captured reads
  and membership gates, then applies ordinary inserts, patches, and deletes
  without a table owner-policy check.
- `IbexHostContext::elevated_database_allowed` and
  `ensure_db_read_available` carry the root-provenance fence for the four
  `ctx.db.elevated` **read** forms. No elevated write form exists. This is a
  useful closed boundary, not evidence that ordinary writes are policy-gated.
- `ReturnValue::Document` is materialized directly from the transaction in
  `Storage::execute_mutation_plan_with_lifecycle_and_settlement_time`, and a
  JavaScript mutation may compute its own result. Current result-contract
  validation establishes shape, not this Spec's authorization egress rule.
- LLP 0173's implemented `generated/authorization-review.json` carries a
  versioned but empty `writePolicyChecks[]`. The guide advertises
  `auth.table-visibility` for reads, partial standard patterns and data
  resources, and the separate shipped scoped-role writer. It advertises no
  generic table write-policy capability.

Therefore this Spec claims neither current owner enforcement on generic
writes nor end-to-end write-result confidentiality.

## Scope and terms

A **generic write** is one of these existing forms:

- JavaScript mutation host calls: `ctx.db.insert`, `ctx.db.patch`, and
  `ctx.db.delete`; or
- HostPlan steps: `Insert`, `InsertEach`, `Patch`, `Delete`, and
  `DeleteWhere`.

The list is closed for v1. A new generic mutation form is unsupported until it
is added to the same exhaustive policy dispatcher and acceptance matrix.
Framework-owned asset, membership, roster/role, seed, import, migration,
operator, and admin-data writers are not generic merely because they
eventually touch storage. Their own tagged authority and invariants remain in
force.

The **authoritative transaction** is the target-owned transaction that
linearizes and commits the write—SQLite's immediate write transaction on the
local target, or the equivalent serialization point on another target. A
handler snapshot, codegen scan, or client plan is not authoritative for the
old-row decision.

The **effective principal** is the host-resolved principal represented by
`authUserId()` / `HandlerInput.auth.user_id`. A caller argument, row field,
handler variable, system label, override id, or plan literal is never a
principal source for this Spec.

**Absent semantics** means that the public operation cannot distinguish a
missing row from a row whose old owner does not match the effective principal.
It preserves the operation's existing missing-row shape: boolean `false` for
the point `ctx.db` calls, no matched effect for bare point/set HostPlan steps,
or the same operation-declared not-found refusal (for example
`SNAPBACK_ROW_NOT_FOUND`) when the plan explicitly uses `Get`/`Guard`.

## D1. One table policy is the read and write locus

The installed table policy governed by LLP 0231 D1/D6 is the only authoring
locus for generic write admission. V1 derives write posture from the existing
closed policy kinds; it adds no `.writeVisibility(...)`, `writePolicy`,
per-function owner field, inline guard declaration, or caller-selectable
policy.

Codegen, activation, handler runtime, and HostPlan execution resolve the exact
installed policy identity. The runtime/storage seam re-derives it from the
installed schema rather than trusting a handler, plan, function manifest, or
client to supply it. A generated guard may narrow or explain an operation, but
it is never the only owner check.

The executable policy carrier has a versioned semantic identity included in
generation and activation inputs. Changing the meaning of a policy kind is a
policy-program activation, not a library implementation detail. A table-policy
edit that broadens or is incomparable with the prior write posture is the same
governed ordinary-policy transition LLP 0234 D5 already records. It requires
LLP 0234's remotely prior transition approval, separation receipt, exact-set
ratchet, and activation verdict; this Spec creates no write-only approval
vocabulary.

Examples of governed incomparable or broader changes include changing an
owner field, changing an owner policy to a future membership-write policy, or
making a presently non-writable policy kind generically writable. A
restricted-to-`public-read` edit may narrow writes while widening reads; it is
still governed by LLP 0234 because the shared policy change is incomparable or
broader on at least one authorization axis.

## D2. V1 default write posture by policy kind

| Installed table policy | Generic write posture in v1 |
| --- | --- |
| `owner { field }` | Insert is host-stamped to the effective principal. Update/delete affect only an old row whose owner field equals that principal. The owner field is immutable. |
| `membership { ... }` | Generic writes are refused. A read membership is not a write role. Future membership-scoped ordinary-data writes must extend this same policy IR. |
| `any-of { ... }` | Generic writes are refused, including a group containing an owner arm. A read disjunction is not an unambiguous write principal. |
| `public-read` | Generic writes are refused. Public disclosure never means anonymous, authenticated, system, or public mutation authority. |
| undeclared during LLP 0234 G1 migration | Phase 1 preserves the existing behavior only as an explicitly projected legacy gap and emits the existing missing-policy diagnostic. No enforcement or capability claim is permitted. G2 changes omission to a generation failure. |

This table is a default-closed derivation, not a second policy. V1 implements
only the exact owner slice; every other current declared kind has a generic
write disposition of `refused`. An application needing another write model
uses an already-governed specialized operation or waits for a sibling that
extends the shared IR.

## D3. Owner inserts are host-stamped

For an `owner { field: F }` table, every generic insert derives `F` from the
effective principal on the server. If no effective principal exists, the
insert refuses with the existing `SNAPBACK_AUTH_USER_MISSING` and writes
nothing.

### `ctx.db.insert`

The caller-supplied `values` object must not contain `F`, even if its value
equals the caller's principal. The host refuses before buffering the write,
then adds `F = authUserId()` to the buffered row. Refusing rather than silently
overwriting catches confused code and prevents a caller-controlled field from
being mistaken for trusted provenance.

The central transaction re-derives the installed owner field and effective
principal and verifies/stamps the carried insert again before storage. A
forged `BufferedWrite`, missed handler scanner, nested invocation, replay, or
future producer cannot bypass the rule by reaching the commit seam directly.

### HostPlan `Insert` and `InsertEach`

The value map may omit `F`, in which case the executor injects it, or may carry
the canonical sealed `AuthUserId` expression used by today's
`defineOwnedCrud`. The latter is a compatibility marker, not caller authority:
the executor still derives the value from host input. Any `Arg`, item binding,
literal, row binding, runtime default, or other expression assigned to `F`
refuses generation/activation before a step executes.

`InsertEach` applies the rule independently to every generated row. One bad
owner assignment or a missing effective principal refuses the entire atomic
plan; it cannot insert a prefix.

### Defaults and generated patterns

A trusted default may not set `F`. Codegen refuses that declaration rather
than ordering the default before or after stamping. The existing
`defineOwnedCrud` and `lowerDataResourceV1` lowerings already satisfy this
rule: create arguments omit the owner, their canonical plan uses
`authUserId()`, and owner defaults are rejected. They remain compatibility and
positive-test fixtures after central enforcement lands.

V1 does not provide owner delegation, owner transfer, caller-selected service
owners, or system stamping. Those are different authority operations, not
insert options.

## D4. Update and delete check the old row transactionally

For `ctx.db.patch`, `ctx.db.delete`, and HostPlan `Patch`, `Delete`, and
`DeleteWhere`, the owner decision is made from the **old row** inside the
authoritative transaction, before changing or deleting that row.

The transaction resolves the table's installed owner field, reads the old row
at the transaction's serialization point, and compares it with the effective
principal. An absent row, absent principal, malformed/non-string owner value,
or different owner all take the same absent path. Public diagnostics and
results do not contain the stored owner, expected principal, existence bit, or
which comparison leg failed. Protected operator telemetry may record a
value-free internal reason under the repository's existing redaction rules.

The surface-specific effects are:

- `ctx.db.patch` and `ctx.db.delete` return `false` and buffer no effect when
  their caller-scoped snapshot already sees the row as absent. The commit seam
  independently checks every carried write.
- If a buffered handler observed an owned row but the authoritative old row
  changed before commit, the invocation may not commit a silently dropped
  write while retaining a handler result computed from `true`. The normal OCC
  conflict/retry path reruns the mutation; the retried caller-scoped read then
  produces absent semantics. No other buffered effect from the stale attempt
  commits.
- A bare HostPlan `Patch` or `Delete` preserves its missing-row no-effect
  behavior for a not-owned row. A plan that explicitly uses `Get`/`Guard`
  receives the same declared not-found refusal for missing and not-owned rows.
- `DeleteWhere` conjoins the exact owner predicate with the authored filter in
  the transaction. An empty authored filter deletes all and only rows owned by
  the effective principal. With no principal it matches none. It never scans
  broadly and post-filters a deletion set.

The owner field is immutable through every generic update. A patch value map
that names the owner field refuses before an old-row read, even when it repeats
the existing value. This prevents both transfer and an existence oracle based
on whether an apparent no-op owner assignment succeeds. There is no post-state
owner predicate beyond equality with the immutable old value in v1; richer
old/new-row rules remain a later shared-IR slice.

## D5. The policy check is central and exhaustive

Both current execution pipelines must meet one table-policy dispatcher:

1. **Buffered JavaScript writes.** The handler host resolves policy early for
   useful absent results and diagnostics. The storage commit seam re-resolves
   it and performs the authoritative insert stamp or old-row check below all
   buffered producers.
2. **HostPlan writes.** Structural validation resolves every generic write
   step before the first step executes. The executor then stamps/checks within
   the same transaction that evaluates plan reads, guards, and writes.

HostPlan preflight is atomic over the closed step list. If any generic write
form targets an ineligible policy or cannot be composed, the plan refuses and
executes zero steps. A future `MutationStep` variant cannot inherit generic
write authority from a wildcard/default match; it must be exhaustively
classified or fail with `SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE`.

The policy dispatcher consumes the installed schema policy and host-resolved
principal. Function `writes`, effect ceilings, standard-pattern ids, generated
guards, static source scans, and `writePolicyChecks[]` are review/admission
facts. None can turn an ineligible runtime write into an eligible one.

## D6. Authority tables and membership/role writes stay specialized

A table carrying a membership declaration or `permissionBacking` is
ineligible for every generic write, regardless of whether its row-read policy
is owner, membership, `any-of`, public-read, or temporarily undeclared. The
refusal occurs before any row read or write and applies to user, system,
service-principal, nested, replay, direct-runner, and dry-run paths.

This generalizes the intent of
`IbexHostContext::ensure_permission_backing_write`; it does not weaken the
existing LLP 0056 central membership writer seam. Existing specific membership
raw/HostPlan refusals may remain the public compatibility codes, but every
writer must reach the same declaration-derived ineligibility fact.

Membership and role mutations through the shared authority IR are explicitly
out of v1. LLP 0240's generated roster/role operations own that application
surface, and LLP 0056's declaration-bound transition matrix and central writer
carrier remain its enforcement owner. This Spec neither adds a generic
HostPlan membership step nor interprets membership read roles as write roles.

The seed, import, migration, admin-data, protected-resource bootstrap/teardown,
membership sweep, and future dedicated owner-transfer lanes remain separate
tagged writer classes. They are not “elevated generic writes” and gain no
authority from this Spec.

## D7. There is no write elevation

LLP 0231 D7's `ctx.db.elevated` bypasses only Class-R read visibility at one
trusted handler read call. LLP 0234's governed overrides likewise grant only
alternate read scope and explicitly do not unblock writes. Neither authority
can stamp an owner, satisfy an old-row owner check, mutate an authority table,
or make a public-read/membership/`any-of` table generically writable.

No `ctx.db.elevated.insert|patch|delete`, plan flag, function flag, override
field, system mode, captured grant, or invocation-wide bypass exists in this
Spec. The root-provenance fence that prevents an action/schedule from regaining
elevated reads through a nested mutation remains intact, but a caller-backed
named mutation with read elevation still performs all writes under ordinary
table write policy.

If a future source or artifact attempts to declare write elevation before a
governing sibling exists, generation/activation refuses it. Dedicated
framework writers must continue to name and enforce their own closed authority
instead of being represented as elevation.

## D8. Write-result egress is a subsequent bounded phase

Write admission and result egress are separate security questions. This v1
slice decides whether a row may be inserted, changed, or deleted. It does not
decide whether a mutation may return or copy:

- the old row, merged row, or another row through HostPlan
  `ReturnValue::Document`, bindings, records, or expressions;
- a JavaScript handler result computed from ordinary or elevated reads;
- a row snapshot into activity/audit data, jobs, notifications, assets, logs,
  or another table; or
- a result whose field masking or recipient audience is narrower than the
  write authority.

The next egress phase must enumerate those sinks, re-resolve the result policy
at the release/copy boundary, compose Class M when it exists, and define
non-disclosing result failures. Until then, a capability claim may say
“generic owner write admission” only. It may not say that arbitrary mutation
results or copies are authorization-safe.

The deferred risk is exfiltration after an otherwise legitimate write or read:
for example, a handler authorized to update Alice's row returning Bob's
snapshot, or a generated plan copying an old value into a public activity row.
The landed owner CRUD returns its stamped/checked row and is a useful bounded
fixture, but its structure does not prove the generic egress problem.

## D9. Authorization-review projection

Implementation populates LLP 0173's reserved `writePolicyChecks[]` and rotates
only that section's schema identity. The artifact remains deterministic,
consumer-committed, and fact-only. It is never an enforcement or approval
locus.

The section has one canonical row per operation × generic write form × exact
target table. A dynamically targeted JavaScript host call that codegen cannot
enumerate uses `tableResolution: runtime` plus its declared table ceiling (or
`opaque`); runtime resolution remains central, and the projection does not
invent a table. Each row contains these normalized facts:

| Fact | Contents |
| --- | --- |
| `id` | Stable identity derived from operation, surface, write form, table resolution, and policy identity. |
| `operation`, `runtimeClass` | Generated operation name and `javascript-handler` or `host-plan`. |
| `surface`, `writeForm` | `ctx-db` or `host-plan`; one of `insert`, `insert-each`, `patch`, `delete`, `delete-where`. |
| `table`, `tableResolution`, `declaredTableCeiling` | Exact table when known; otherwise the honest runtime/opaque fact and closed declared ceiling when one exists. |
| `policyKind`, `policyDigest`, `declarationOrigin` | Installed normalized table-policy identity, including `legacy-default` during migration. |
| `ownerField` | Exact field for owner policy, otherwise null. |
| `genericWriteDisposition` | `owner-policy`, `generic-refused`, or `legacy-undeclared`. This reports the installed disposition; it is not a safety verdict. |
| `principalSource` | `auth.userId`, `none`, or `not-applicable`; never a caller argument. |
| `ownerInputDisposition` | `host-stamped`, `sealed-auth-user-id-marker`, `refused`, or `not-applicable`. |
| `transactionChecks[]` | Exact ordered facts such as `stamp-owner`, `check-old-owner`, `conjoin-delete-where-owner`, and `owner-field-immutable`, each with `authoritative-transaction` as its locus. |
| `absentDisposition` | `ctx-db-false`, `host-plan-no-effect`, `declared-not-found`, or `not-applicable`. |
| `authorityTableClass` | `ordinary`, `membership`, or `permission-backing`. |
| `writeElevation` | Always `unavailable` in v1. |
| `resultEgress` | `separate-phase-not-covered`, preserving §D8's claim boundary. |
| `sourceEvidence` | Generated plan/span or opaque-module facts already available to codegen, without promoting opacity into a verdict. |

Rows and set-valued fields use LLP 0173's canonical ordering. Failed
generation publishes no projection; the structured diagnostic carries the
refused source fact instead. Human rendering may group policy/check changes
and use the closed LLP 0234 comparator's `narrowing`, `broadening`, or
`incomparable` structural relation. It must not render `safe`, `authorized`,
`approved`, `reviewed`, `waived`, or `discharged`.

The section is review evidence only. Changing, deleting, or forging it cannot
change runtime write authority, and an empty/opaque row is never treated as
proof that no generic write exists.

## D10. Diagnostics and refusal vocabulary

The implementation uses the existing `SNAPBACK_*` families and value-free
public details. Names below are proposed normative names for this Draft; review
may rename them once, before implementation, but implementation must then pin
the chosen spellings in generated schemas and negative fixtures.

| Code | Severity and locus | Meaning |
| --- | --- | --- |
| `SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT` (existing) | warning during G1; generation error at G2 | The table policy is undeclared. Write details list generic target surfaces without claiming a posture. |
| `SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE` | generation/activation error | A generic write form lacks the central policy dispatcher or target implementation. No outputs/steps are published. |
| `SNAPBACK_TABLE_WRITE_POLICY_INELIGIBLE` | generation/activation and runtime error | A generic write targets `public-read`, `membership`, or `any-of`. Details contain table, policy kind, and write form only. |
| `SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED` | generation or runtime error before buffering/execution | Caller/plan data attempts to set the owner field. The exact sealed HostPlan `AuthUserId` compatibility marker is not caller input. |
| `SNAPBACK_TABLE_WRITE_OWNER_DEFAULT_REFUSED` | generation error | A trusted default targets the owner field. |
| `SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE` | generation or runtime error before old-row read | A generic patch names the owner field, even with the same value. |
| `SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE` | generation/activation and runtime error before row access | A generic write targets a membership or permission-backing table. Existing membership-specific wire codes may remain compatibility projections of this fact. |
| `SNAPBACK_TABLE_WRITE_ELEVATION_UNAVAILABLE` | generation/activation error | Source or artifact attempts to declare a generic write elevation. |
| `SNAPBACK_AUTH_USER_MISSING` (existing) | runtime error before write | An owner insert has no effective principal to stamp. |
| `SNAPBACK_ROW_NOT_FOUND` (existing, when operation-declared) | runtime absent result | Missing and not-owned old rows use identical public bytes. Bare no-effect/boolean surfaces introduce no new visibility code. |

Static diagnostics may name table, owner field, policy kind, write form,
operation, and source span. Old-row failures may not expose stored owner,
expected principal, row existence, match counts split by policy, or runtime
operands. A future target that cannot provide the authoritative transaction
semantics refuses with `SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE`; it does not
fall back to handler checks or post-filtered writes.

## Migration and rollout

### Phase 1 — declared-owner enforcement

Land central enforcement for every generic form on tables with an explicit
`owner` policy. In the same phase:

- declared `public-read`, `membership`, and `any-of` generic writes refuse;
- membership/permission-backing generic writes refuse regardless of row
  policy;
- undeclared tables retain current behavior only behind the existing warning,
  a `legacy-undeclared` projection fact, and an explicit nonclaim;
- `writePolicyChecks[]` becomes populated and deterministic;
- no write elevation is added; and
- the guide may document the experimental boundary but may not mark a generic
  table-write capability shipped until the phase's target-specific acceptance
  evidence exists.

Phase 1 may land before LLP 0234 G1 corpus closure because migrating an
unchecked generic table to exact owner enforcement is a narrowing. It may not
activate a broader/incomparable policy edit while LLP 0234 G0 authority is
unavailable; such an edit stays inert/refused until the governance path can
validate it.

Phase-1 acceptance is structural and executable:

1. Exhaustive dispatch covers `ctx.db` insert/patch/delete and HostPlan
   Insert/InsertEach/Patch/Delete/DeleteWhere at both early validation and the
   authoritative transaction; adding an unclassified mutation form breaks the
   exhaustiveness test or gets the uncomposed-surface refusal.
2. Alice and Bob fixtures prove handler and HostPlan inserts always stamp the
   effective principal, reject an authored owner value even when equal, reject
   owner defaults, and atomically refuse ownerless `InsertEach`.
3. Point patch/delete fixtures prove missing and other-owner rows have
   byte-identical/publicly identical absent outcomes. Owned rows succeed.
   Changing the owner between handler observation and commit produces no stale
   commit and no partial companion effects.
4. `DeleteWhere` with an empty authored filter deletes Alice's rows and leaves
   Bob's rows; anonymous/system execution deletes none. Indexed and unindexed
   test shapes reach the same owner predicate before deletion.
5. Every attempt to patch the owner field refuses before row access. No
   generic operation can transfer a row.
6. Public-read, membership, `any-of`, membership-table, and
   permission-backing fixtures refuse every generic form before effects. LLP
   0240/0056 roster operations continue to pass through their own writer seam.
7. Direct caller mutations, nested mutations, action/system roots, governed
   read overrides, captured grants, and `ctx.db.elevated` read use all produce
   the same ordinary write posture. No test can select write elevation.
8. The landed `defineOwnedCrud`/`lowerDataResourceV1` fixtures continue to
   generate and execute, but deleting their explicit plan guard does not remove
   central enforcement.
9. `writePolicyChecks[]` has exact golden rows for every positive, refused,
   legacy, exact-table, and opaque/runtime-resolved class; stale or malformed
   projection fails LLP 0173 custody checks and no human rendering contains a
   verdict word.

### Phase 2 — LLP 0234 G1 write migration closure

Close the required demo/package-consumer corpus alongside LLP 0234 G1:

- every table has an explicit policy;
- every generic write target is either exact owner policy or migrated to its
  declaration-owned specialized writer;
- zero public-read, membership, `any-of`, membership-table, or
  permission-backing targets remain behind generic write declarations;
- zero generic write surfaces are uncomposed;
- the ordinary-policy baseline/transition ledger contains the same normalized
  policy identity the write dispatcher consumes; and
- all broader/incomparable transitions are receipted under LLP 0234 rather
  than grandfathered by this migration.

Phase-2 acceptance runs a corpus inventory over generated write reach and the
authorization projection. It fails on any implicit target, ineligible generic
target, opaque target without a closed runtime ceiling, missing transition
provenance, or policy/check digest disagreement. The retained G1 closure
receipt names the write-policy semantic version and the exact corpus result.

### Phase 3 — LLP 0234 G2 omission failure and completion proof

Only after G1 closes may the existing implicit-table warning become a
generation error under LLP 0234 G2. Missing policy writes no generated outputs
and cannot be repaired by suggesting `public-read` merely to make a write
compile.

The card-game read completion test has this write-side analogue: one fixture
targets the `hands` table from each generic form—handler insert/patch/delete
and HostPlan Insert/InsertEach/Patch/Delete/DeleteWhere. With the owner policy,
Alice can create only Alice-owned hands and can change/delete only her old
rows. Deleting the `hands` policy makes generation fail for every independently
isolated generic path that could write cards. Replacing it with `public-read`,
`membership`, or `any-of` makes every such path fail with the ineligible-policy
disposition; no path becomes public-write or unchecked. The read-side policy-
deletion proof from LLP 0231 must continue to fail at the same time.

A target may advertise generic owner write admission only after its exact
Phase-1 proof and the Phase-3 corpus completion digest are registered under
LLP 0189's scoped claim rules. Egress remains excluded until §D8's successor
phase qualifies independently.

## Non-goals

- No membership/role mutation grammar or generic membership HostPlan step.
- No owner transfer, delegation, impersonation, service owner, or system
  owner-stamping mode.
- No general old/new-row predicate language beyond immutable owner identity.
- No write elevation or write-bearing visibility override.
- No result/side-effect egress authorization claim.
- No change to seed, import, migration, admin-data, asset, membership,
  bootstrap/teardown, or other dedicated writer authority.
- No inference of owner from field names, indexes, read/write sets,
  `authScopeField`, standard-pattern ids, or handler code.
- No approval or verdict authority in `writePolicyChecks[]`.

## Open questions

1. **What is the exact result/copy egress IR and sink inventory?** The boundary
   and risk are fixed in D8, but the grammar for HostPlan returns, JavaScript
   results, cross-table copies, jobs, notifications, assets, and field masking
   is not. **Owner:** Charlie Cheever / the next LLP 0231 D6 egress Spec author.
2. **What future generic posture should membership and `any-of` policies
   receive for ordinary, non-authority tables?** V1's answer is refusal. Any
   future admission needs transactionally resolved role semantics in the same
   IR without colliding with the specialized roster writer. **Owner:** LLP
   0240 and LLP 0056 authors.
3. **Should owner transfer ever be a dedicated table-policy operation?** V1
   makes owner immutable and refuses transfer through generic writes. A future
   operation would need old/new-owner concurrency, non-disclosure,
   invalidation, offline replay, and LLP 0234 transition governance. **Owner:**
   Charlie Cheever / future table-write-policy successor author.

## Status

Draft. This document specifies the owner-policy slice for generic writes. It
claims no current enforcement, no current `writePolicyChecks[]` population, no
generic membership/public write authority, and no result-egress protection.

## Revision history

- 2026-08-15 — initial Draft, authored as the write-side sibling reserved by
  LLP 0231 D6.
