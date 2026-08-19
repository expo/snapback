# LLP 0264: Table write policy

**Type:** Spec
**Status:** Accepted
**Systems:** Auth, Security/authorization, Storage, Code generation, Application data API, Generated artifacts, Diagnostics, Testing
**Author:** Codex (gpt-5.6-sol) / Charlie Cheever
**Date:** 2026-08-15
**Revised:** 2026-08-19 (identity-binding seal precedence clarified)
**Related:** LLP 0214, LLP 0231, LLP 0234, LLP 0255, LLP 0173, LLP 0240, LLP 0056, LLP 0065, LLP 0135, LLP 0239

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

This is the governing specification, not by itself a capability claim. The
2026-08-16 Phase 1a implementation and staged write-migration gap are recorded
in Migration and the revision history. Phase 1a claims only the owner-policy
slice: its declared non-owner gap is warning-backed and projected, never
described as permission or enforcement. The shipped standard-pattern lowerer emits the desired owner-shaped
plans, but that codegen structure is evidence and a compatibility wedge, not a
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
- On 2026-08-16 the experimental `.data()` / `lowerDataResourceV1` doorway was
  withdrawn by commit `7b40f3caa`; `defineOwnedCrud` remains the shipped
  compatibility wedge and positive owner-write fixture.
- `IbexHostContext::handle_host_call` in `crates/snapback/src/runtime.rs` buffers `db.insert`
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
  `crates/snapback/src/storage.rs` refuses generic HostPlan writes to membership and
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

The shipped `MutationStep` classification is closed: the five forms above are
generic; `AssetCollection` and `AllocateSequence` are specialized LLP 0239 D2
and LLP 0135 writers that use only their descriptor/declaration authority; and
`Get`, `Guard`, `Let`, `AssertCurrentRelation`, and `AssertSourceChanged` are
non-writers. Every variant has exactly one exhaustive-dispatch class.

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
It preserves the operation's declared missing-row shape: boolean `false` for
the point `ctx.db` calls, no matched effect for a HostPlan point write whose
authoritative check declares `no-effect`, or one canonical operation-declared
refusal whose complete public bytes are bound to that check. A preceding
`Get`/`Guard` sequence is neither that declaration nor write authorization.
For HostPlan `no-effect`, this is a whole-plan contract: after the authoritative
check takes the absent path, every later observation of that target row inside
the same plan sees the same canonical absent view for missing and not-owned.
The write step's disposition is not a step-local promise.

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
policy-program activation, not a library implementation detail.

This Spec extends LLP 0234 D5's shared body/digest, baseline, ledger, and both
comparators; its read-only order is insufficient. Every predecessor/successor
gains versioned `writePosture`: semantic version, per-form disposition, owner
field, authority-table class, and declared global-unique disclosures. Each
disclosure is a canonical
`{ table, writeForm, constraint, operations[] }` entry whose sorted exact
`operations[]` names stable generated operation/entrypoint identities. The
complete entries and operation sets participate in the normalized policy body,
body digest, baseline, every ledger node, transition approval, both admission
comparators, and the trusted runtime carrier. Old readers refuse the new schema
version.

The comparator is read × write; `narrowing` requires neither axis to broaden.
Refused-to-owner, new forms, new global-conflict disclosures, and growth of a
disclosure's `operations[]` set broaden. Removing an operation from that set is
write narrowing only when no other write fact broadens; owner-field,
semantic-version, identity rebinds, and unproved changes are incomparable. An
approval for operation A therefore cannot authorize operation B merely because
table, form, and constraint are equal.
`legacy-undeclared` exists only at D2's root. Broader/incomparable successors
use LLP 0234's remotely prior approval, separation receipt, exact-set ratchet,
and activation verdict.

Consequently `public-read|any-of -> owner` is governed despite read narrowing,
and `owner -> public-read` is governed despite write narrowing. V1 refuses
declared-policy removal in every migration phase.

## D2. V1 default write posture by policy kind

| Installed table policy | Generic write posture in v1 |
| --- | --- |
| `owner { field }` | Insert is host-stamped to the effective principal. Update/delete affect only an old row whose owner field equals that principal. The owner field is immutable. |
| `membership { ... }` | Phase 1a warns and preserves pre-0264 runtime behavior while projecting `migration-pending`; Phase 1b refuses. A read membership is not a write role. Future membership-scoped ordinary-data writes must extend this same policy IR. |
| `any-of { ... }` | Phase 1a warns and preserves pre-0264 runtime behavior while projecting `migration-pending`; Phase 1b refuses, including a group containing an owner arm. A read disjunction is not an unambiguous write principal. |
| `public-read` | Phase 1a warns and preserves pre-0264 runtime behavior while projecting `migration-pending`; Phase 1b refuses. Public disclosure never means anonymous, authenticated, system, or public mutation authority. |
| exact pre-cut undeclared table named by the D2 migration root | Before G2, Phase 1 may preserve existing behavior only as an explicitly projected `legacy-undeclared` gap with the existing missing-policy diagnostic. No enforcement or capability claim is permitted. G2 changes omission to a generation failure. |
| undeclared table absent from that root, including a new table or one whose declaration was removed | Generic writes refuse during every phase. At G2 the shared missing-policy generation failure applies as well. It never acquires `legacy-undeclared`. |

This table is a default-closed derivation, not a second policy. The normalized
`writePosture` consumed by LLP 0234 remains `refused` for every current
declared non-owner kind throughout the migration window; Phase 1a changes only
codegen severity and the review projection. Runtime neither gains enforcement
nor permission for those tables. An application needing another write model
uses an already-governed specialized operation or waits for a sibling that
extends the shared IR.

Before first Phase-1 activation, the shared baseline freezes a versioned root
from the protected immediately prior installed lineage: source/schema digest
plus the exact then-undeclared table ids (empty for a fresh app). Activation
deep-matches and retains it through G1. Thus a predecessor exists pre-G0/G1;
only exact root members get warning-backed legacy behavior before G2. New
omission, declared-then-deleted policy, missing root, or root mutation refuses.

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
`defineOwnedCrud` lowering already satisfies this rule: create arguments omit
the owner, its canonical plan uses `authUserId()`, and owner defaults are
rejected. It remains a compatibility and positive-test fixture after central
enforcement lands. The former `lowerDataResourceV1` doorway is not part of the
live surface after the 2026-08-16 withdrawal recorded in S0.

V1 does not provide owner delegation, owner transfer, caller-selected service
owners, or system stamping. Those are different authority operations, not
insert options.

### Unique-conflict disclosure gate

Success versus unique conflict is an existence oracle. Every owner insert
reaches all unique constraints; a patch reaches each constraint whose member
may change, with uncertainty treated as reach. Each must contain the installed
owner field or be named by the operation's closed `discloseUniqueConflicts`
fact, mirroring `SNAPBACK_STANDARD_PATTERN_DISCLOSURE_REQUIRED`. The latter
intentionally admits only the value-free conflict/success bit and joins D1's
write posture.

The declaration normalizes into D1's sorted
`{ table, writeForm, constraint, operations[] }` entries in function/plan
operation metadata. The operation being generated and the runtime carrier must
name the same stable identity and be a member of `operations[]`.
Unknown/duplicate facts, identity aliases, and caller input refuse; they never
become authority.

The gate is evaluated per statically classified write form. A JavaScript
operation whose write call sites cannot be enumerated or whose form cannot be
classified refuses generation in Phase 1a unless its operation metadata declares
the exact versioned posture `opaqueWritePosture: conservative-v1` and a closed
table ceiling. That posture means every ceiling member is treated as reachable
through all JavaScript generic forms (`insert`, `patch`, and `delete`), every
unique constraint is reachable from insert, and every field and therefore
every unique constraint may be reached by patch. D1's operation-bound conflict
disclosures must independently cover the resulting insert and patch facts. It
is conservative admission input, not runtime write authority; the central
dispatcher still enforces the exact call. A missing or opaque table ceiling
always refuses in Phase 1a.

For exact and conservatively opaque censuses alike, any reachable
non-owner-partitioned constraint without the operation-bound declaration makes
generation/activation refuse the affected insert/patch form. Statically
classified runtime-table sites satisfy all closed ceiling members. A declared
conflict uses `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION` and D9 names the
constraint. Error redaction alone cannot close the bit.

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

Every HostPlan owner `Patch`/`Delete` carries sealed `ownerWriteCheck` (or a
closed compound), binding `no-effect` or `refuse` with canonical public
code/message/details bytes and digest. Before row binding, it applies that
outcome to missing principal/row, malformed owner, and different owner.

`Get`/`Guard` is never the carrier. An aliasing/uncertain prior read refuses
unless compounded or independently composed to identical absent bytes. That
proof ranges over every intermediate step which can observe the aliased binding
and the complete public plan outcome, not only the prior read's direct error.
Thus an identical-byte `Get` followed by a divergent intermediate `Guard` is
not composable. The generated wedge migrates; each same-id read/write has
distinct identity.

When a HostPlan `ownerWriteCheck` with `no-effect` takes the absent path, the
executor records a host-owned, plan-local identical-absent marker for the
canonical table/id target before continuing. Every later `Get`, binding,
`Guard`, `Let`/expression, point write, changed-count observation,
`AssertCurrentRelation`/`AssertSourceChanged` observer step, document or
record return, and copy that resolves that target or a proven alias consults
the marker before storage and receives the same canonical absent value/effect
for missing and not-owned. No later step can recover or branch on the real
not-owned row. Preflight refuses a computed target or alias whose relationship
to a checked target cannot be proved. This normalization applies through the
last step and return value; unrelated steps may continue only with effects and
public bytes identical between the two absent cases. A `refuse` carrier instead
terminates with its bound canonical refusal before later steps execute.

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
- A HostPlan `Patch` or `Delete` whose authoritative carrier declares
  `no-effect` preserves its missing-row no-effect behavior for a not-owned row
  across the whole remaining plan and its return. A carrier declaring `refuse`
  returns its byte-identical canonical refusal for missing and not-owned rows.
  A nearby or later `Get`/`Guard` does not change either.
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

This deferral does not defer or weaken D4's narrower noninterference duty.
After a HostPlan checked write takes the absent path, every same-target
intermediate observation and the final return are normalized solely to keep
missing and not-owned indistinguishable. That whole-plan normalization is part
of write admission; it proves nothing about egress from owned or unrelated
rows.

D3's unique-conflict bit is in scope: a declared global conflict is a projected
residual disclosure, not a non-disclosing result claim.

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

For HostPlan and statically classifiable JavaScript, rows key operation ×
stable source/plan `siteId` × form × table fact, so same-form/table sites never
collapse. Exact sites emit once; a classifiable site with a closed runtime table
ceiling emits one `runtime-ceiling-member` row per member.

JavaScript for which codegen cannot enumerate stable call sites or classify
their forms instead emits exactly one operation-level `opaque` site entry,
mirroring LLP 0234 D6's elevated-site census rather than inventing spans or
collapsing guessed calls. The entry has `siteId: null`,
`siteResolution: opaque-module`, `writeForm: opaque`,
`writeFormCeiling: ["insert", "patch", "delete"]`, `table: null`,
`tableResolution: opaque-module`, the operation's sorted closed
`declaredTableCeiling`, and `sourceEvidence` containing the module path/digest
plus `opaqueWritePosture: conservative-v1`. Its target-dependent policy and
owner facts use D9's runtime-resolved sentinels; its preflight facts expose the
complete conservative D3 insert/patch census. Absence of that posture or of a
closed table ceiling is a Phase-1 generation refusal, whose structured
diagnostic carries this candidate entry. No generated artifact is published
for the refusal.

Phase 1a has one deliberately non-admitting exception to that owner-slice
gate. When an operation's exact declared write set contains only ordinary
tables whose installed policies are `public-read`, `membership`, or `any-of`,
codegen may emit one table-specific
`migration-pending-declared-write-set` row rather than fabricate call sites.
That row has `siteId: null`, `writeForm: opaque`, the exact declared table set,
and `authoritativeChecks: ["pre-0264-runtime-behavior"]`. It exists only to
expose the gap. Any owner, authority-table, undeclared, mixed, or unbounded
target still enters the ordinary opaque-form gate and refuses when it cannot
be classified.

The phase boundary is explicit: Phase 1a admits an opaque owner JavaScript site only
through D3's conservative posture above, while an unbounded target refuses even
then. The write-migration closure refuses every remaining
`siteResolution: opaque-module` entry, including one that satisfied the Phase
1a conservative gate; exact-site completeness is a Phase 1b closure
requirement. Fields are:

| Fact | Contents |
| --- | --- |
| `id`, `siteId`, `siteResolution` | `id` covers operation/site/form/table/policy, or operation plus the opaque capability identity; exact/member `siteId` stays stable across policy edits. `siteId` is null only for `siteResolution: opaque-module` or Phase 1a's honest `migration-pending-declared-write-set`. |
| `operation`, `runtimeClass` | Generated operation name and `javascript-handler` or `host-plan`. |
| `surface`, `writeForm`, `writeFormCeiling` | `ctx-db` or `host-plan`; exact rows use one of `insert`, `insert-each`, `patch`, `delete`, `delete-where` and a null ceiling. The opaque JavaScript entry uses `opaque` and the closed v1 JavaScript ceiling. |
| `table`, `tableResolution`, `declaredTableCeiling` | Exact/member table or opaque null; canonical ceiling or null. |
| `policyKind`, `policyDigest`, `declarationOrigin` | Exact installed/member facts (`legacy-default` only for a root member); opaque uses `runtime-resolved`, null, `runtime-resolved`. |
| `ownerField` | Exact field for owner policy, null for an exact non-owner policy, and null plus `ownerFieldResolution: runtime-resolved` for opaque. |
| `genericWriteDisposition` | `owner-policy`, `migration-pending`, `generic-refused`, `legacy-undeclared`, or `runtime-resolved`. `migration-pending` means Phase 1a preserved pre-0264 runtime behavior for a declared non-owner table; it is a projected gap, not permission. This is a fact, not a verdict. |
| `principalSource` | `auth.userId`, `none`, `not-applicable`, or `runtime-resolved`; never a caller argument. |
| `ownerInputDisposition` | `host-stamped`, `sealed-auth-user-id-marker`, `refused`, `not-applicable`, or `runtime-resolved`. |
| `preflightChecks[]` | Ordered early target/class/input/immutability/unique-disclosure checks. |
| `authoritativeChecks[]` | Ordered transaction policy/stamp/old-owner/delete-filter/absent checks; no early-only facts. |
| `absentDisposition` | `ctx-db-false`, `host-plan-no-effect`, `declared-refusal`, `not-applicable`, or `runtime-resolved`; it is fixed by the source/canonical carrier, not inferred from table policy. Only the opaque JavaScript entry uses `runtime-resolved`. |
| `absentDispositionDigest` | Digest of the D4 HostPlan canonical public refusal bytes, null for no-effect/ctx-db/not-applicable/runtime-resolved. This is site-declared and remains known for a classifiable runtime table target. |
| `uniqueConflictDisposition` | Exact `owner-partitioned`, `declared-disclosure` plus constraint ids, `not-applicable`, or `runtime-resolved`. |
| `authorityTableClass` | `ordinary`, `membership`, `permission-backing`, or `runtime-resolved`. |
| `writeElevation` | Always `unavailable` in v1. |
| `resultEgress` | `separate-phase-not-covered`, preserving §D8's claim boundary. |
| `sourceEvidence` | An exact site's generated step/span, or the opaque entry's module path/digest and conservative-posture fact. Multiple classifiable sites have separate rows; the one opaque entry is explicitly operation-level, never a fabricated site census. |

Rows and set-valued fields use LLP 0173's canonical ordering. Failed
generation publishes no projection; its structured diagnostic carries the
complete refused candidate row. Human rendering may group policy/check changes
and use D1's extended LLP 0234 product comparator's `narrowing`, `broadening`,
or `incomparable` structural relation. It must not render `safe`,
`authorized`, `approved`, `reviewed`, `waived`, or `discharged`.

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
| `SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT` (existing) | warning before G2 only for an exact D2 migration-root member; generation error at G2 | The pre-cut table policy remains undeclared. Write details list generic target surfaces without claiming enforcement. |
| `SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED` | generation/activation error before G2; shared missing-policy error at G2 | A new/unknown undeclared table is not in the retained legacy root and a generic write targets it. |
| `SNAPBACK_TABLE_WRITE_POLICY_REMOVAL_REFUSED` | generation/activation error in every phase | A table with a declared predecessor removed its policy. Removal never restores legacy writes. |
| `SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE` | generation/activation error | A generic write form lacks the central policy dispatcher or target implementation. No outputs/steps are published. |
| `SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING` | Phase 1a codegen warning | A generic write reaches a declared ordinary `public-read`, `membership`, or `any-of` table. The matching projection row has `genericWriteDisposition: migration-pending`; runtime remains pre-0264 and no permission or enforcement is claimed. This code is codegen-only. |
| `SNAPBACK_TABLE_WRITE_POLICY_INELIGIBLE` | Phase 1b generation/activation and runtime error | A generic write targets `public-read`, `membership`, or `any-of` after the write-migration closure. Details contain table, policy kind, and write form only. |
| `SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED` | generation/activation error | A reachable unique constraint omits owner and the insert/patch operation lacks its exact conflict-disclosure declaration. |
| `SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED` | generation or runtime error before buffering/execution | Caller/plan data attempts to set the owner field. The exact sealed HostPlan `AuthUserId` compatibility marker is not caller input. |
| `SNAPBACK_TABLE_WRITE_OWNER_DEFAULT_REFUSED` | generation error | A trusted default targets the owner field. |
| `SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE` | generation or runtime error before old-row read | A generic patch names the owner field, even with the same value. |
| `SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE` | generation/activation and runtime error before row access | A generic write targets a membership or permission-backing table. Existing membership-specific wire codes may remain compatibility projections of this fact. |
| `SNAPBACK_TABLE_WRITE_ELEVATION_UNAVAILABLE` | generation/activation error | Source or artifact attempts to declare a generic write elevation. |
| `SNAPBACK_AUTH_USER_MISSING` (existing) | runtime error before write | An owner insert has no effective principal to stamp. |
| `SNAPBACK_ROW_NOT_FOUND` (existing, when operation-declared) | runtime absent result | Missing and not-owned old rows use identical public bytes. Bare no-effect/boolean surfaces introduce no new visibility code. |
| `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION` (existing family, when declared) | runtime conflict | An operation explicitly admitted the named non-owner-partitioned constraint's success/conflict disclosure. Details remain value-free. |

Static diagnostics may name table, owner field, policy kind, write form,
operation, and source span. Old-row failures may not expose stored owner,
expected principal, row existence, match counts split by policy, or runtime
operands. A future target that cannot provide the authoritative transaction
semantics refuses with `SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE`; it does not
fall back to handler checks or post-filtered writes.

LLP 0214 §5.9's identity-binding write seal is **not a policy refusal**. It is
policy-independent and precedes this section's complete policy-refusal order,
including the write operation's owning parse/schema failures. On the
JavaScript path the host must first extract a string target table name so it
can test the declaration; after that discriminant, the seal precedes unknown-
table lookup, `id`/`values` parsing, insert ctx-ledger consumption, authority-
table classification, and owner-policy checks. On the HostPlan path, closed-IR
artifact-shape admission remains an earlier generation/activation concern;
runtime preflight applies the seal to every write target before `schema_table`
lookup and before the policy dispatcher. Both `HandlerPlan::Mutation` and
`HandlerPlan::WriteWithActivity` use that order.

This deliberately means that a handler which passes a caller-controlled table
name can distinguish a declared identity-binding table from an unknown table
before the rest of that write's arguments are validated. That distinction is
acceptable on this surface: installed schema shape is not secret from
application handlers or generated artifacts; `refuse_binding_write()` carries
no table name or caller value in its public details; and HostPlan runtime
preflight already exposed the same declaration-derived distinction. Moving
unknown-table or value parsing ahead of the seal would restore cross-runtime
disagreement and let incidental malformed input shadow LLP 0214's categorical
ordinary-writer prohibition.

After that independent seal, policy-refusal precedence is: uncomposed surface;
authority-table class; removal/unrooted omission; ineligible policy kind;
unique-disclosure gate; owner input/default/immutability; missing principal/row.
Thus a membership or permission-backing table refuses on the authority-table
class even when its row policy is also ineligible. Owning parse/schema failures
remain earlier than this **policy** list only when no identity-binding seal
applies.

**Refusal-vocabulary note (2026-08-16, Phase-1a integration).** At GENERATION
time the authority-table class refuses with
`SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE`. At RUNTIME the
pre-existing specialized membership/permission seam owns the refusal and its
established typed codes (`SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED`,
`SNAPBACK_MEMBERSHIP_HOSTPLAN_WRITE_DENIED`, and the permission-backing
guard) take precedence: the generic dispatcher yields no owner-enforcement
field for authority tables and never shadows the seam's codes. This
integrates the concurrently landed LLP 0240 roster seam without changing the
precedence ORDER above — the authority-table class still refuses first; only
the emitting locus and code family are the seam's.

## Migration and rollout

### Cross-document obligation

- **Reciprocal LLP 0234 amendment completed 2026-08-16.** LLP 0234 D5/D6 now
  names this Spec's versioned
  `writePosture` as part of the shared ordinary-policy body, digest, baseline,
  ledger, approval closure, and read × write comparators; it must include the
  operation-set identity and set-growth rule for conflict disclosures and point
  its projection contract at D9. That amendment must land with the Phase-1
  implementation. The amendment preserves LLP 0234's Accepted status and
  records the reciprocal write-axis contract in the same change as Phase 1a.

### Phase 1a — declared-owner enforcement and write-migration window

Land central enforcement for every generic form on tables with an explicit
`owner` policy. In the same phase:

- declared ordinary `public-read`, `membership`, and `any-of` generic writes
  emit `SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING`, retain their exact
  pre-0264 runtime behavior, and project `genericWriteDisposition:
  migration-pending` rather than failing generation;
- membership/permission-backing generic writes refuse regardless of row
  policy;
- only exact members of the frozen D2 pre-cut root retain current behavior
  behind the existing warning, a `legacy-undeclared` projection fact, and an
  explicit nonclaim; new omission and policy removal refuse;
- the shared normalized policy body/digest and comparator include D1's write
  posture from the first activation, even if remote transition authority is
  not yet available;
- opaque JavaScript owner/mixed/unbounded write forms refuse unless their
  operation declares D3's conservative posture over a closed table ceiling;
  the non-admitting D9 declared-write-set migration row may expose an
  all-declared-non-owner gap without pretending to enumerate sites;
- `writePolicyChecks[]` becomes populated and deterministic;
- no write elevation is added; and
- the guide may document the experimental boundary but may not mark a generic
  table-write capability shipped until the phase's target-specific acceptance
  evidence exists.

The original sequence expected Phase 1 to precede LLP 0234 G1 because exact
legacy-root-to-owner migration narrows. G1 landed first on 2026-08-16 and
declared every registered table, emptying the intended `legacy-undeclared`
relief class while 30 of 34 registered backend jobs still carried ordinary
generic writes against those declarations. Landing the original refusal would
therefore have made the corpus red. Phase 1 is split into 1a/1b using the
repository's migrate-then-flip pattern; the protected root, removal refusals,
and read × write comparator are unchanged, and the G1 closure receipt is not
rewritten or repurposed.

**Implementation note (2026-08-16).** Phase 1a now has one installed-policy
dispatcher for all generic handler and HostPlan write forms, transaction-local
owner stamping/checking, the sealed plan-wide identical-absent carrier,
operation-bound unique-conflict disclosure admission, the read × write
governance comparator, deterministic `writePolicyChecks[]` projection, and the
warning-backed declared-non-owner migration gap above.
The implementation deliberately does not add result-egress protection,
membership/role write IR, Class M, or write elevation. Demo/package-consumer
migration remains the Phase 1b closure below, so this note is an implementation
record and owner-slice claim only, not a generic-write capability claim.

**Predecessor-version compatibility note (2026-08-16, round 4).** History
admission validates a committed v1 baseline/ledger/node/body with the exact v1
shape and digest domains at any revision, and validates v2 with the v2 rules.
Across the one v1 -> v2 edge, it treats a retained table as unchanged only when
the v2 body is the validated v1 body plus the mechanically derived D2 posture
for that policy kind and its closed table-class/disclosure inputs; the retained
node rewrite and v2 baseline exact-set digest must independently equal that
same lift. That representation-only upgrade needs no approval and no additional
ledger node. Any posture deviation or other broader/incomparable change enters
the ordinary transition-authority path, while a later v2 -> v1 edge always
refuses as a downgrade. This compatibility rule does not edit or borrow the G1
closure receipt.

Phase-1 acceptance is structural and executable:

1. Exhaustive dispatch covers `ctx.db` insert/patch/delete and HostPlan
   Insert/InsertEach/Patch/Delete/DeleteWhere at both early validation and the
   authoritative transaction; every other variant retains Scope's class. An
   unclassified variant breaks the test or refuses uncomposed.
2. Alice and Bob fixtures prove handler and HostPlan inserts always stamp the
   effective principal, reject an authored owner value even when equal, reject
   owner defaults, and atomically refuse ownerless `InsertEach`. Insert/patch
   fixtures admit owner-partitioned uniqueness, refuse undeclared global
   conflicts, and expose only the declared global conflict bit. Operations A
   and B target the same table/form/constraint with only A listed in the
   disclosure: A's runtime carrier cannot authorize B, and adding B to
   `operations[]` changes the transition identity, classifies as widening, and
   requires its remotely prior approval/receipt.
3. Point patch/delete fixtures prove missing and other-owner rows have
   byte-identical public code/message/details. HostPlan negatives cover bare
   `Get`, differing Get/Guard codes, same-id multi-read/write, missing, and
   other-owner rows; only the checked-write carrier governs. One negative uses
   an identical-byte `Get`, then a divergent intermediate `Guard`, then the
   checked write and must refuse composition. A second checked-`no-effect`
   negative continues through same-target `Get`, binding, expression/guard,
   copy/mixed step, changed-count observation, and document return: missing and
   not-owned inputs produce byte-identical results and identical companion
   effects, while an uncertain alias refuses preflight. Owned rows succeed.
   Changing the owner between handler observation and commit produces no stale
   commit and no partial companion effects.
4. `DeleteWhere` with an empty authored filter deletes Alice's rows and leaves
   Bob's rows; anonymous/system execution deletes none. Indexed and unindexed
   test shapes reach the same owner predicate before deletion.
5. Every attempt to patch the owner field refuses before row access. No
   generic operation can transfer a row.
6. Public-read, membership, and `any-of` ordinary-table fixtures emit the
   Phase 1a warning and migration-pending fact while exercising unchanged
   pre-0264 runtime behavior. Synthetic Phase 1b fixtures refuse every generic
   form. Membership-table and permission-backing fixtures remain hard
   refusals, and LLP 0240/0056 roster operations continue through their own
   writer seam.
7. Direct caller mutations, nested mutations, action/system roots, governed
   read overrides, captured grants, and `ctx.db.elevated` read use all produce
   the same ordinary write posture. No test can select write elevation.
8. The landed `defineOwnedCrud` fixture continues to generate and execute, but
   deleting its explicit plan guard does not remove central enforcement. The
   withdrawn `lowerDataResourceV1` doorway is not treated as a live fixture.
9. Published `writePolicyChecks[]` has exact golden rows for every successful
   positive, legacy, multi-site, exact, and runtime-ceiling-member class,
   including D9 sentinels and `migration-pending`. Opaque JavaScript goldens cover statically
   classifiable per-site entries and the one operation-level `opaque` entry
   under `conservative-v1`; structured-diagnostic candidate-row goldens cover
   Phase 1a refusal without that declaration and closure refusal even with it.
   Stale/malformed output fails custody; renderings lack verdicts.
10. Comparator fixtures cover `public-read -> owner`, each other refused kind
    `-> owner`, semantic-version change, `owner -> omitted`, and new omission
    before/after G0/G1. Only the pre-cut root yields `legacy-undeclared`;
    widening needs receipts, while removal/new omission refuse.

### Write-migration corpus closure receipt

Phase 1b requires a new write-migration corpus closure receipt analogous in
shape to LLP 0234 G1's receipt but independent from it. It inventories every
registered backend and binds the write-policy semantic version, exact corpus
membership, generation inputs, and the resolved model for every declared write:

- every table has an explicit policy;
- every write is represented by one of: an exact owner-policy generic write;
  a declaration-owned generated roster/authority operation; or an accepted,
  implemented, and independently qualified sibling extension of the shared
  write-policy IR for a model v1 cannot express;
- zero public-read, membership, `any-of`, membership-table, or
  permission-backing targets remain behind generic write declarations;
- zero generic write surfaces are uncomposed;
- the ordinary-policy baseline/transition ledger contains the same normalized
  read × write body and digest the write dispatcher consumes, with the retained
  migration root and no remaining legacy member; and
- all broader/incomparable transitions are receipted under LLP 0234 rather
  than grandfathered by this migration.

Closure acceptance runs a corpus inventory over generated write reach and the
authorization projection. It fails on any implicit target, ineligible generic
target, remaining opaque site, runtime table target without a closed ceiling,
missing transition provenance, policy/check digest disagreement, or remaining
`migration-pending` fact. The new receipt names owner `LLP 0264 Phase 1b` and
cross-references the D-6 battery used; it does not edit, supersede, or borrow
authority from `visibility-governance-g1-closure.json`.

### Phase 1b — declared-non-owner refusal flip

Only after the write-migration corpus closure receipt above is committed and
qualified may codegen change
`SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING` to the existing
`SNAPBACK_TABLE_WRITE_POLICY_INELIGIBLE` refusal for declared ordinary
`public-read`, `membership`, and `any-of` generic writes. The runtime dispatcher
flips the matching pre-0264 pass-through arm in the same change. The synthetic
flip fixtures must pass before the receipt is minted; live corpus fixtures must
contain no target that exercises them.

The flip makes no new capability claim. Owner enforcement, authority-table
refusals, omission/removal refusals, the opaque owner-form gate, lack of write
elevation, the normalized `writePosture`, and LLP 0234's two-axis comparators
are byte/semantically unchanged across 1a and 1b. Only generation severity,
the migration projection disposition, and the matching legacy runtime arm
close.

### Phase 3 — LLP 0234 G2 omission failure and completion proof

Only after G1 closes may the existing implicit-table warning become a
generation error under LLP 0234 G2. Missing policy writes no generated outputs
and cannot be repaired by suggesting `public-read` merely to make a write
compile. This flip closes the exact pre-cut legacy set; declared-policy removal
and newly introduced omission already refused before G2 and continue to do so.

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

Accepted (2026-08-15, author-directed after dual-family same-revision READY
convergence; run journal at `llp/reviews/0264-table-write-policy.run.md`).
Acceptance authorizes the Phase-1 owner-write implementation. This document
still specifies the owner-policy slice for generic writes. The 2026-08-16
implementation supplies central owner enforcement and `writePolicyChecks[]`
population. Phase 1a projects declared-non-owner generic writes as
`migration-pending` and preserves their pre-0264 runtime behavior; it makes no
generic membership/public write-authority or result-egress-protection claim.
The independent Phase 1b write-migration closure remains outstanding.

## Revision history

- 2026-08-19 — clarified D10 after the JavaScript/HostPlan parity repair:
  LLP 0214 §5.9's identity-binding seal is policy-independent, precedes owning
  write parse/schema failures once the target table-name string is available,
  and applies before the policy-refusal list in both HostPlan mutation wrappers.
  Recorded the bounded schema-enumeration consequence and why it is acceptable.
- 2026-08-16 — round 4 made history admission predecessor-version aware: exact
  v1 and v2 artifacts validate under their own rules, the D2-derived v1 -> v2
  representation lift preserves retained nodes and exact-set identity without
  inventing a transition, posture deviations remain governed, and v2 -> v1
  always refuses. The G1 closure receipt remains untouched.
- 2026-08-16 — recorded the G1-first sequencing collision and split Phase 1
  into 1a/1b. Phase 1a keeps the complete owner-policy and authority-table
  enforcement slice, stages declared ordinary `public-read`, `membership`, and
  `any-of` generic writes behind codegen warning
  `SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING`, and projects the gap as
  `genericWriteDisposition: migration-pending` while preserving pre-0264
  runtime behavior. Phase 1b may flip only after an independent
  write-migration corpus closure receipt resolves every backend to owner
  writes, generated roster operations, or an implemented IR-extension
  sibling. LLP 0234's writePosture identity/comparators and the retained G1
  receipt are unchanged. Status remains Accepted; no capability claim added.
- 2026-08-16 — recorded Phase-1 implementation: central generic-write owner
  enforcement, plan-wide identical-absent carriers, uniqueness disclosure
  admission, shared read × write governance identity/comparator, and populated
  `writePolicyChecks[]`. Updated the S0/D3/acceptance baseline after commit
  `7b40f3caa` withdrew `.data()` / `lowerDataResourceV1`; `defineOwnedCrud`
  remains the wedge. Recorded the reciprocal LLP 0234 D5/D6 amendment and kept
  result egress, membership/role write IR, Class M, elevation, and Phase-2
  corpus migration out of scope. Status remains Accepted.
- 2026-08-15 — Status Draft → Accepted, author-directed (Class R
  row-authorization completion program, sequence step 5). Three review rounds
  (full, delta, confirming), six artifacts under `llp/reviews/0264-*`, both
  families VERDICT: READY on the round-3 revision. The confirming round's one
  residual MINOR (the `AssertCurrentRelation`/`AssertSourceChanged` observer
  variants missing from D4's marker enumeration) is applied in this same
  edit. Phase-1 implementation authorized; the reciprocal LLP 0234 D5/D6
  write-axis amendment remains a listed Phase-1 obligation.
- 2026-08-15 — initial Draft, authored as the write-side sibling reserved by
  LLP 0231 D6.
- 2026-08-15 — round-2 dual-family response. Every finding was accepted; no
  finding was rejected.
- 2026-08-15 — round-3 targeted response. The three requested GPT round-2
  MATERIAL findings and three Claude round-2 MINOR findings were accepted; no
  finding was rejected. Status remains Draft.

| Reviewer | Finding | Disposition |
| --- | --- | --- |
| GPT, MATERIAL 1 | Comparator/removal gap. | Accepted: D1 product order; D2 rooted removal/omission refusal. |
| GPT, MATERIAL 2 | HostPlan absent carrier. | Accepted: D4 sealed byte-bound carrier and alias tests. |
| GPT, MATERIAL 3 | Uniqueness oracle. | Accepted: D3 gate; D9/D10 projection/diagnostic. |
| GPT, MATERIAL 4 | D9 site/runtime loss. | Accepted: site rows, ceiling expansion, opaque form. |
| Claude, MATERIAL 1 | Read/write laundering. | Accepted: D1 two-axis governed order. |
| Claude, MATERIAL 2 | Removal/pre-G0 source. | Accepted: D2 installed-lineage root and refusal. |
| Claude, MATERIAL 3 | Uniqueness oracle. | Accepted: GPT MATERIAL 3 disposition. |
| Claude, MINOR 4 | Step classifications. | Accepted: Scope/D5 exhaustive classes. |
| Claude, MINOR 5 | Runtime D9 fields. | Accepted: exact members/sentinels and split loci. |
| Claude, MINOR 6 | Refusal precedence. | Accepted: D10 authority class first. |

Round-3 targeted dispositions:

| Reviewer | Finding | Disposition |
| --- | --- | --- |
| GPT r2, MATERIAL 1 | HostPlan `no-effect` allowed later same-target observation. | Accepted: D4 now carries an identical-absent view through every later step and return; uncertain aliases refuse, with a composite negative fixture. |
| GPT r2, MATERIAL 2 | Conflict disclosure omitted operation identity from the D1 transition. | Accepted: every disclosure lists exact stable `operations[]`; the set is bound into every transition artifact/carrier and set growth is widening, with an A/B operation fixture. |
| GPT r2, MATERIAL 3 | D9 could not represent opaque JavaScript and D3 lacked its per-form gate. | Accepted: classifiable sites stay per-site; otherwise one operation-level `opaque` entry requires `conservative-v1`, a closed ceiling, and all-form/all-field D3 evaluation. |
| Claude r2, MINOR 1 | D3 and D9 disagreed on the opaque-refusal phase. | Accepted: Phase 1 permits only declared conservative opacity with a closed target ceiling; Phase 2 refuses every remaining opaque site. |
| Claude r2, MINOR 2 | D4's identical-absent proof did not quantify intermediate steps. | Accepted: the proof now spans every intermediate alias observation and the complete outcome; an identical `Get` plus divergent intermediate `Guard` is a negative fixture. |
| Claude r2, MINOR 3 | LLP 0234 still needs the reciprocal shared-ledger amendment. | Accepted: Migration lists the pending LLP 0234 D5/D6 amendment as a Phase-1 obligation; this revision does not edit LLP 0234. |
