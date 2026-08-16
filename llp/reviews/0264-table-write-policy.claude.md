# Review: LLP 0264 — Table write policy

**Reviewer:** Claude (claude-fable-5)
**Date:** 2026-08-15
**Document:** `llp/0264-table-write-policy.spec.md`
**Revision reviewed:** Revised 2026-08-15 (initial Draft)
**Review basis:** independent, mutually blind; Spec read in full against LLP 0231
(D1–D7), LLP 0234 (D5, G0–G2), LLP 0255 (S0/S2), and the shipped code
(`packages/snapback-codegen/standard-patterns.mjs`, `src/runtime.rs`,
`src/storage.rs`).

## Baseline verification

Every S0 claim I checked matches the shipped code:

- `defineOwnedCrud` excludes the owner field from create/update arguments,
  stamps `authUserId()` into the insert value map, rejects owner-setting
  trusted defaults, refuses authority-bearing tables, and its `ownedRowGuard`
  collapses missing and other-owner rows to `SNAPBACK_ROW_NOT_FOUND`
  (`packages/snapback-codegen/standard-patterns.mjs:181-189`, `:225-231`,
  `:242-247`, `:307-313`). `lowerDataResourceV1` reuses it for owner and its
  `public-read.v1` branch emits list/get only (`standard-patterns.mjs:447-521`).
- `db.insert` buffers after validation with no visibility resolution or owner
  stamp (`src/runtime.rs:3458-3472`); `db.patch`/`db.delete` are read-gated
  with in-code comments explicitly disclaiming the D6 write slice
  (`src/runtime.rs:3495-3498`, `:3520-3522`).
- `ensure_permission_backing_write` refuses only the
  service-principal × non-membership × permission-backing case
  (`src/runtime.rs:4683-4702`).
- HostPlan execution refuses membership and framework asset-collection targets
  before steps, and ordinary Insert/Patch/Delete/DeleteWhere/InsertEach steps
  consult no table policy; `DeleteWhere` builds its scan with
  `table_visibility: None` (`src/storage.rs:2946-2994`, `:3524-3536`).
- `apply_buffered_writes_with_lifecycle_gated` is the buffered commit seam and
  applies writes with no owner-policy check beyond the membership gate
  (`src/storage.rs:4053-4241`).
- Exactly four `db.elevated.*` read forms exist; no elevated write form
  (`src/runtime.rs:3198-3205`). The patch/delete existence reads are captured
  into OCC dependencies (`src/runtime.rs:2628-2657`), so D4's stale-owner
  retry requirement is implementable on the current substrate.
- `writePolicyChecks[]` ships versioned and empty
  (`packages/snapback-codegen/authorization-review.mjs:19`, `:321`;
  `authorization-review.schema.json:224-231`).

The transactional old-row semantics of D4 are implementable at the storage
layer as specified for all three surfaces: the commit seam receives
`&HandlerInput` (effective principal) and the schema; HostPlan steps execute
inside the single immediate transaction; `DeleteWhere` already routes through
`build_query_sql`, so conjoining the owner predicate into the WHERE (rather
than post-filtering) is a natural extension.

## Findings

### 1. MATERIAL — Write-posture widening rides through LLP 0234's comparator as a self-proving narrowing

D1 asserts: "A table-policy edit that broadens or is incomparable with the
prior write posture is the same governed ordinary-policy transition LLP 0234
D5 already records," and its example list includes "making a presently
non-writable policy kind generically writable." But LLP 0234 governs reads
only — "This RFC governs reads … An override declaration may list writes only
as non-authoritative review facts" (0234:317-321) — and its D5 structural
partial order is defined over read admission alone: "fewer admitted
principals/rows is narrower, `public-read` is the maximum" (0234:921-925),
with `narrowing` ledger nodes self-proving and requiring no approval
(0234:977-979).

Under D2's derivation, the transitions `public-read → owner` and
`any-of{owner arm, …} → owner` convert the table's generic write disposition
from **refused** to **owner-admitted** — new write authority over every
existing row whose owner field happens to name a principal — while being
provably read-*narrowing*. The 0234 comparator therefore classifies them
`narrowing`, self-proving, no transition approval, no separation receipt. The
governance D1 claims for write-posture widening does not exist in the
mechanism D1 delegates it to. (D1's one worked case — restricted →
`public-read` — is the opposite direction, where the read axis already
triggers governance, so it does not exercise this hole.)

**Resolution:** state explicitly that the 0234 D5 structural comparator must
be extended to a two-axis order — read admission × derived generic write
posture — with any transition that changes `genericWriteDisposition` from
`generic-refused`/`legacy-undeclared` to `owner-policy` classified as
broader/incomparable and requiring the full 0234 transition approval path.
Record this as a required LLP 0234 amendment (or a 0264-owned extension of
the shared comparator), not as something 0234 "already records."

### 2. MATERIAL — Declared-then-deleted policies fall into the legacy-undeclared gap, and the pre-G0 "inert/refused" claim has no specified mechanism

D2's undeclared row and D10's `SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT`
warning route **any currently-undeclared table** to legacy unchecked generic
writes during G1. Nothing in the Spec distinguishes a never-declared table
from a table whose owner policy was declared, enforced, and then **removed**:
under a plain reading of the D2 table, deleting a table's `owner` declaration
during Phase 1 reverts it to `legacy-undeclared` — reopening unchecked
generic writes over previously owner-protected rows behind only a warning.
That is the cheapest attack a hostile-but-competent app author has against
this Spec's contract: one deleted declaration, no error, full cross-owner
write reach restored.

LLP 0234's machinery would eventually catch this ("an entry without a live
declaration … fails", 0234:1027-1029), but the table-policy baseline and
transition-ledger roots land only at **G1** (0234:1461-1462), and 0264 Phase 1
explicitly "may land before LLP 0234 G1 corpus closure" and while "G0
authority is unavailable." In that window there is no predecessor record at
all, so Phase 1's own sentence — "It may not activate a broader/incomparable
policy edit while LLP 0234 G0 authority is unavailable; such an edit stays
inert/refused" — is unimplementable as specified: with no predecessor
snapshot, nothing can classify any edit as broader/incomparable, and policy
*removal* is not classified anywhere in the Spec. (Phase 3's
"deleting the `hands` policy makes generation fail" proof only holds after
G2; Phases 1–2 are the exposed window.)

**Resolution:** (a) classify removal of a declared table policy as a
broader/incomparable transition — simplest form: once Phase-1 enforcement has
landed, deleting a declared policy from a table fails generation outright
(the never-declared legacy gap stays legacy; the declared→undeclared edge is
refused); and (b) name the concrete predecessor source Phase 1 consults
pre-G0 (e.g., the prior installed generation / activation lineage), or
withdraw the "stays inert/refused" claim and state the honest exposure as a
projected nonclaim.

### 3. MATERIAL — Unique-constraint conflicts remain a cross-owner existence oracle that the non-disclosure contract does not cover

D4 claims the design "prevents both transfer and an existence oracle," and
the Scope section pins hidden-equals-absent for all old-row failures. But a
generic insert (`ctx.db.insert`, HostPlan `Insert`/`InsertEach`) or patch
into an owner-policy table carrying a **unique index that does not include
the owner field** will surface a unique-constraint conflict whenever another
owner's row holds the same key — a caller-observable success/failure bit that
discloses cross-owner row existence, exactly the channel the read gate's
hidden-equals-absent rule exists to close. The shipped kit polices this at
codegen (`SNAPBACK_STANDARD_PATTERN_DISCLOSURE_REQUIRED`,
`packages/snapback-codegen/standard-patterns.mjs:295-305`, per LLP 0065's
"uniqueness is existence disclosure by conflict"), but that guard is local to
`defineOwnedCrud`; the D1 table-policy locus specifies no analogue, so an
implementation faithful to this Spec ships the oracle on every generic write
path while the Spec's failure contract reads as non-disclosing.

**Resolution:** extend the owner-policy declaration validation (generation
time, at the D1 locus) to require every unique index on an owner-policy table
to be owner-partitioned or named in an explicit disclosure declaration —
mirroring the kit rule — or explicitly carve declared unique-conflict
channels out of the non-disclosure contract, give them a stable code, and add
a `writePolicyChecks[]` fact so the residual disclosure is projected rather
than silent.

### 4. MINOR — D5's exhaustive dispatcher does not classify the two existing write-bearing `MutationStep` variants

D5 addresses only *future* variants ("A future `MutationStep` variant cannot
inherit generic write authority…"), but the shipped enum
(`src/manifest.rs:10097`) already contains two write-bearing non-generic
variants: `AssetCollection` (arguably covered by "Framework-owned asset …
writers" in Scope) and `AllocateSequence`, which patches a counter field on a
scope-table row inside the same transaction
(`src/storage.rs:3045-3094`) and is named nowhere in the Spec. The Phase-1
exhaustiveness test needs a pinned expected classification for both.
**Resolution:** enumerate both existing variants with their dispositions
(declaration-bound sequence authority per LLP 0135; framework asset writer)
in Scope or D5's closed classification.

### 5. MINOR — D9 projection fields are undefined for `tableResolution: runtime`/`opaque` rows

`policyKind`, `policyDigest`, `declarationOrigin`, `ownerField`,
`genericWriteDisposition`, `absentDisposition`, and `authorityTableClass` are
all defined in terms of one installed table, but a runtime-resolved row has
no single table. The Spec's stated goal is "complete enough to implement
without invention"; these fields currently require invention.
**Resolution:** pin the values for runtime/opaque rows (e.g., explicit
`not-applicable`/null with the declared table ceiling's policy facts listed
per ceiling member, or a stated aggregate rule).

### 6. MINOR — Refusal-code precedence for doubly-ineligible tables is unpinned

A membership-declared table whose row policy is `membership` (or `any-of`)
matches both `SNAPBACK_TABLE_WRITE_POLICY_INELIGIBLE` and
`SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE`. D6 fixes when the
authority refusal happens relative to row access but not which code wins at
generation/runtime, so negative fixtures and golden `writePolicyChecks[]`
rows can diverge across implementations.
**Resolution:** one sentence pinning precedence (authority-table
classification first, matching D6's "regardless of whether its row-read
policy is …").

## Assessment

The Spec's core owner slice — host-stamped inserts, transactional old-row
checks, owner immutability, default-refused non-owner kinds, authority-table
ineligibility, no write elevation, honest S0 baseline, and the D8 egress
carve-out — is internally consistent, implementable on the verified
substrate, and correctly scoped against LLP 0231 D6/D7 and LLP 0255 S2.
Findings 1–3 are each individually acceptance-blocking: 1 and 2 leave
governed and ungoverned paths by which write authority appears or reappears
without the approval machinery the Spec claims covers them, and 3 leaves a
concrete cross-owner existence oracle inside a contract the Spec describes as
non-disclosing. All three have small, local textual resolutions.

VERDICT: MATERIAL
