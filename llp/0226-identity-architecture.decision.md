# LLP 0226: Identity architecture — namespaces, provenance, and conversion

**Type:** Decision
**Status:** Review
**Systems:** Schema, Auth, Mutations, Storage, Client SDK, Effects
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-10
**Revised:** 2026-08-10 (a — initial draft)
**Revised:** 2026-08-10 (b — Draft → Review at llp-super-refine loop start,
the one authorized transition; independent-loop topology)
**Revised:** 2026-08-10 (c — round-1 revision; see Status)
**Related:** LLP 0004, LLP 0007, LLP 0008, LLP 0011, LLP 0043, LLP 0057,
LLP 0058, LLP 0081, LLP 0110, LLP 0129, LLP 0133, LLP 0135, LLP 0148,
LLP 0151, LLP 0158, LLP 0191,
issues/20260808-identity-architecture-decision.md,
issues/20260808-numeric-identity-default-columns.md,
issues/20260808-guide-gap-principal-to-app-identity-binding.md,
issues/closed/20260808-handler-settlement-identity-surface.md

## Context

LLP 0191 §3 found that the largest friction cluster in the Zerobugs port was
identity — four workarounds that arrived independently (`W-IDENTITY`,
`W-MUTATION-IR`, `W-SHORTID`, settlement identity) and share a vocabulary but
not a trust domain. Charlie's 2026-08-08 OQ2 ruling chose the **distributed**
structure: one coordinating Decision fixing the identity vocabulary —
namespaces, provenance, uniqueness, mutability, conversion rules — with
implementation authority distributed to the schema, auth/D7, and D5/effects
owners as amendments. Writing this Decision was greenlit 2026-08-10, together
with a wholesale endorsement of the schema lane's worked proposal
(`issues/20260808-numeric-identity-default-columns.md`, "Author ruling —
2026-08-10").

This document is that Decision. It holds **vocabulary and conformance, not
implementation**. Nothing here adds a host op, a schema field, or a wire
change; every mechanism lands as an owner amendment to the LLP that already
governs its surface, checked against the conformance rules below.

## Decision

### 1. The identity namespaces

The codebase currently overloads the word "identity" across at least six
unrelated concepts. This section fixes the namespace map. Each namespace
answers four questions: **provenance** (who mints a value), **uniqueness
scope** (where two equal values must mean the same thing), **mutability**, and
its representative authoring surface.

| Namespace | Provenance | Uniqueness scope | Mutability | Surface |
| --- | --- | --- | --- | --- |
| **Row identity (authoritative)** | The server's committed `_id` (LLP 0148 prefixed encoding, `prefix_` + base32) — minted server-side in Lane L, or an accepted client-minted ledger id in Lane Q (LLP 0133) | One table within one store lifetime (fork/restore rotates the stream, LLP 0158) | Immutable; never reused | `v.id(table)`, `_id` |
| **Row identity (speculative)** | The client mints optimistically for local-first creation; becomes authoritative or is rewritten at settlement via C-7's id map | One client's optimistic state until settlement | Replaced, not mutated | optimistic `_id` before settlement (LLP 0133) |
| **Principal (account identity)** | Snapback mints `usr_…` at account creation | One auth catalog/instance | The id is immutable; its **linked credential set is mutable** (LLP 0151 lifecycle) | `ctx.auth.userId`, `v.principal()` |
| **Provider identity (credential)** | The provider's immutable `(issuer, subject)` pair, recorded as an `_auth_identities` row (`idn_…`) linking to one principal | One auth provider installation | Immutable as a credential row; **email and profile claims are mutable attributes, never identity**; the principal link changes only via LLP 0151 lifecycle flows | auth substrate only — never handler-visible in v1 |
| **Source key** | The application (client-generable; safe for local-first creation) | Declared unique index scope on one table | Two grades, declared: an **identity-grade** source key is immutable and never reused; a mutable unique field is an ordinary lookup key, not an identity (C-3/C-6) | declared unique field + alternate-key lookup (schema lane) |
| **Serial identity (identity column)** | Server allocates, always — sequence semantics, gaps allowed | One table within one store lifetime; the constraint-prefix mechanics for table scope are the successor profile's to define (M-3) | Immutable after allocation; not writable by handlers, ever | `v.serial({ start })` (schema lane) |
| **Settlement identity** | Server derives a digest over `{authFingerprint, authorityInstanceId, clientMutationId, function, inputFingerprint[, operationIssuance]}` | App + instance + operation | Immutable; replay-stable by construction | `ctx.mutation.settlement()` (LLP 0043) |
| **Stream identity** | Framework mints the opaque `versionStream` (LLP 0043/0053); rotated on fork/restore (LLP 0158) | One instance's durable data stream | Rotates as a unit; values never compared across streams | resume tokens, live-query cursors |
| **Artifact identity** | Toolchain digests the evaluated code graph (LLP 0009/0010/0024) | One deployment's loaded artifacts | Immutable; a new build is a new identity | artifact digests, readiness receipts |
| **Counter identity** | Framework: `(counterName, scopeTable, scopeRowId, scopeIncarnation)` in `_snapback_sequence_counters_v1` (LLP 0135 §1.1) | The declaring app | N/A — substrate, never app-visible as a value | `AllocateSequence`, handler allocation |

Two clarifications the table cannot carry:

- **`v.principal()` is a *reference* type, not a mint.** A stored
  `v.principal()` field holds a principal id minted elsewhere; it confers no
  verification. The verified thing is the principal on `ctx.auth`, and what
  *claims* travel with it is the auth lane's decision (§3b). The
  principal/provider-identity split is load-bearing: an account keeps its
  principal across credential link, unlink, and identifier replacement, so
  **app-side conversions key on the principal, never on `(issuer,
  subject)`** — the credential key lives inside the auth substrate only
  (C-2/C-6).
- **Serial identity is a display/permalink identity, not the canonical
  relationship key.** Per LLP 0191 §3, client-generable ids (row identity or
  source keys) remain the safer canonical key for local-first creation;
  serial columns exist so ported relational contracts (permalinks,
  notification numbers, `shortID`) work without `W-SHORTID`-class scans.

### 2. Conversion rules

Conversions between namespaces are the trust boundaries. The rules:

- **C-1 (declared conversions only).** No implicit conversion exists between
  any two namespaces. Every crossing is a declared mapping with a named
  owner: a binding table, an alternate-key lookup, or a server-derived
  digest. Code that treats a value from one namespace as a member of another
  without a declared mapping is nonconforming.
- **C-2 (principal → app row).** The principal-to-app-user conversion is a
  binding row written only by an authority that holds *both* verified sides
  at once (the identity broker pattern, or the acceptance harness's frozen
  actor map). A handler-reachable `bindMe({ sourceUserID })` mutation is an
  authentication bypass and refuses conformance review. The binding table
  carries unique indexes on every side it maps
  (`guide/auth/app-identity-binding.md` is the current recipe).
- **C-3 (source key → row).** Alternate-key lookup (schema lane) converts a
  declared source key to a row within the key's declared unique scope. It is
  the sanctioned way for ported contracts and the generated tier to address
  rows they did not create (`W-MUTATION-IR`'s missing half). Only an
  **identity-grade** source key (declared immutable, never reused) may be
  used as a durable or queued reference; a *mutable* unique field may be
  looked up interactively but a queued/offline operation addressing through
  it must bind the expected `_id` (and an appropriate generation) and
  refuse on reassignment — otherwise key reuse retargets the operation to
  the wrong row (the ABA failure). Rotation, deletion-with-reuse, not-found,
  and stale-queue behavior are the schema amendment's to specify under this
  rule.
- **C-4 (client mutation id → settlement identity).** A raw client-chosen
  `clientMutationId` is never an effect key. The only conversion is the
  server-derived settlement digest, which namespaces it to app, instance,
  and operation. Downstream effect idempotency keys derive from
  `settlementId`, not from `clientMutationId`.
- **C-5 (no leakage of infrastructure namespaces).** Stream, artifact, and
  counter identity never convert into application data. Apps distinguish
  instances by endpoint + stream identity (LLP 0158 OQ9), not by comparing
  stream values; counter state is unreadable by construction.
- **C-6 (mutable attributes never key conversions).** Email, display name,
  and other mutable attributes may be *looked up* but never used as the
  stored key of any binding or mapping. The stored key is the immutable
  member of the source namespace, chosen per conversion: inside the auth
  substrate, provider identity → principal keys on `(issuer, subject)`;
  **app-side bindings (C-2) key on the principal**, never on the credential;
  row conversions key on `_id` or an identity-grade source key.
- **C-7 (speculative → authoritative row identity).** LLP 0133's settlement
  id map is the declared conversion between the two row-identity regimes:
  Lane Q accepts client-minted ledger ids as authoritative; Lane L rederives
  server-side and publishes the `(mint site, occurrence)`-keyed map that
  rewrites optimistic ids, with 0133's private receipt scope, unmapped
  outcome, rewrite, and cascade rules governing. No other conversion between
  speculative and authoritative row identity exists.

### 3. Conformance rules for the mints

- **M-1 (one authority per namespace per scope).** Exactly one component
  mints values in each namespace within a scope. Concretely: no second
  counter authority beside `_snapback_sequence_counters_v1` (LLP 0135 §1.1's
  rejection-with-rationale is adopted here as a corpus-wide rule).
- **M-2 (server-owned mints refuse client values with stable codes).** Where
  the server owns the mint (serial identity, settlement identity, Lane L row
  identity), a client- or handler-supplied value refuses with a stable
  `SNAPBACK_*` diagnostic; it is never silently accepted or silently
  replaced. This does **not** apply to Lane Q's accepted client-minted
  ledger row ids — that acceptance is the accepted LLP 0133 contract, and
  C-7 is its declared conversion.
- **M-3 (uniqueness is scoped, and the scope is stated).** Every uniqueness
  claim names its scope from §1's table. Client-observable unique
  constraints over server-allocated values carry an incarnation prefix so a
  restarted allocator cannot collide observably with orphaned rows — for
  row-scoped counters that is LLP 0110/0135's `(scopeId,
  relationIncarnation)` rule as defined; for table-scoped serial values the
  successor profile defines the equivalent prefix carrier (a table-scoped
  counter has no scope row, so the row-scoped rule cannot apply as-is).
- **M-4 (exhaustion fails closed).** Bounded namespaces (serial identity
  under LLP 0007's JavaScript-safe integer profile) refuse on exhaustion
  with LLP 0135 §1.5's shape: the refusal surfaces inside the allocating
  transaction and rolls the whole mutation back
  (`SNAPBACK_SEQUENCE_EXHAUSTED`-class, a distinct stable code). The
  commit-version precedent's "before every mutation tier" shape does not
  fit allocation-during-insert and is not the rule here.
- **M-5 (vocabulary discipline).** New surfaces do not introduce the bare
  word "identity" for a new concept; they name one of §1's namespaces or
  amend this Decision first.

### 4. Clearing LLP 0135's fences for the identity-column case

Accepted LLP 0135 §1.1 pins v1 counters to "no authored start" and §1.9
names "any cross-scope or global counter" as not lifted. A serial identity
column is exactly a table-scoped counter with an authored start, so this
Decision must be explicit:

**Both fences are cleared for the serial-identity-column case only**, under a
successor profile version of `sequence_allocation_v1` carried as the
schema-owner amendment to LLP 0135 — a table-scoped counter identity with an
authored `start`, sequence (gap-admitting) semantics, extending
`_snapback_sequence_counters_v1`. The fences **stand unchanged** for
app-declared counters: LLP 0135's dense, gap-free, row-scoped counters keep
their closed v1 contract, and a general cross-scope or global app counter
remains not lifted. The two products are observably different (gap-free
versus gap-admitting) and the vocabulary difference is load-bearing: LLP 0135
counters are *sequence counters* (dense); serial identity columns are
*sequences* in the PostgreSQL sense (monotonic, gaps allowed, rollback burns
values). LLP 0007's 2026-08-08 amendment ("closed string domains and the
identity-column boundary") anticipated exactly this clearance and requires
the amendment that lands it to state gap semantics, exhaustion refusal, and
its relationship to LLP 0135's counters — restated here as binding.

## The three owner-amendment lanes

Implementation authority is distributed. Each lane lands as a dated amendment
to its owning LLP, conforming to §§1–3 above; this Decision gains only a
one-line pointer per landed lane.

### (a) Schema owner — source keys, serial columns, defaults, alternate-key lookup

Owner: LLP 0004 (authoring grammar) + LLP 0007 (physical mapping and
evolution) + LLP 0135 (counter substrate). Ticket:
`issues/20260808-numeric-identity-default-columns.md`, whose worked proposal
the 2026-08-10 author ruling endorsed **wholesale** and which is hereby
folded in as the ruled direction:

- **Substrate:** extend `_snapback_sequence_counters_v1` with a table-scoped
  counter identity under a successor profile of `sequence_allocation_v1`; no
  second counter table (M-1). LLP 0135 OQ2 (multiple allocations per
  invocation) is a prerequisite for bulk insert.
- **Semantics:** sequence semantics per LLP 0191 §3 — strictly increasing,
  gaps allowed, an aborted or rolled-back mutation burns its value. This
  keeps allocation off the table's write-serialization path (the gapless
  variant recreates the `W-SHORTID` scale cliff).
- **Client-supplied values:** **server-owned always** — the field is not
  writable by handlers; supplying it in an insert or patch refuses with a
  stable code (M-2). This is `GENERATED ALWAYS` semantics under a
  `BY DEFAULT`-style spelling; the legacy-import escape hatch is explicitly
  out of v1 and may be designed later if demand appears.
- **Bound and exhaustion:** LLP 0007's JavaScript-safe integer profile;
  fail-closed in-transaction refusal per M-4.
- **Uniqueness and indexing:** no implicit index (LLP 0007's Index
  Contract); the author declares one; the successor profile's
  incarnation-prefix carrier applies where a constraint stores allocated
  values (M-3).
- **The amendment must answer, explicitly:** reservation timing relative to
  the application transaction (LLP 0135's current allocator buffers the
  counter advance *into* the transaction, which un-burns values on
  rollback — gap-burning needs its own durable reservation boundary, or the
  amendment must show why in-transaction advance plus retry satisfies the
  gap semantics); the table/incarnation key shape; assignment order for
  multiple or conditional inserts, with "strictly increasing" defined as
  **allocation order** (commit order may interleave); crash-before-commit
  and exact-replay behavior; range/bulk allocation (LLP 0135 OQ2); and
  contention evidence — the off-the-write-path claim is an expectation
  pending measurement (today's SQLite target serializes writes globally
  anyway; a future multiwriter target has a real hot-counter point).
- **Evolution:** v1 **refuses adding a serial column to a non-empty table**,
  pointing at LLP 0081's reviewed `AddField` + backfill lane; a portable
  in-transaction backfill ordered by `(_createdAt, _id)` is the documented
  successor path.
- Also in this lane: declared **source keys** (unique app-public ids the
  generated tier can address) and **alternate-key lookup** (C-3), and any
  general default-value vocabulary (LLP 0007's amendment: "a general default
  expression is a vocabulary question, not a column question").

### (b) Auth/D7 owner — principal claims

Owner: the auth provider protocol and session surface (LLP 0057/0058 seam;
LLP 0151 for the first-party provider substrate). Ticket:
`issues/20260808-guide-gap-principal-to-app-identity-binding.md` (open
platform ask). Constraints from this Decision:

- The §1 principal/provider-identity split governs: the principal (`usr_…`,
  `ctx.auth.userId`) is the app-side key; provider identities (`idn_…`,
  `(issuer, subject)`) stay inside the auth substrate, and email is a
  mutable attribute and never a stored binding key (C-6).
- The lane's open design choice — expose verified provider claims on the
  handler authority projection, or provide a declared privileged
  provisioning channel for binding rows — is the owner's to make, but
  either answer must preserve C-2: the binding writer holds both verified
  sides. Which claims are exposed is a deliberate trust-boundary widening
  and must be decided claim-by-claim, not wholesale.
- The guide's broker and frozen-actor-map recipes remain the conforming
  patterns until the amendment lands.

### (c) D5/effects owner — settlement identity

Owner: LLP 0043 (offline replay/retention), where the handler-visible
settlement identity already landed 2026-08-08
(`ctx.mutation.settlement()` → `{clientMutationId, settlementId}`; ticket
`issues/closed/20260808-handler-settlement-identity-surface.md`). That
landing is this lane's floor and already conforms: server-derived digest,
namespaced to app (authFingerprint), instance (authorityInstanceId), and
operation (function + inputFingerprint), read-only, mutation-only (C-4,
M-2). Remaining lane scope: guide absorption
(`issues/20260808-guide-gap-mutation-settlement-identity.md`, closed), the
hosted-arm asymmetry (hosted answers all-null today — an honest twin, not a
conformance failure, but the capability claim stays local-target), and any
future effect-worker key derivation, which must derive from `settlementId`.

## Standing constraints (from the 2026-08-08 ruling)

1. **One acceptance corpus.** A single Zerobugs port acceptance corpus
   covers all three lanes; each lane's amendment cites its rows there
   rather than growing a private harness. Retiring `W-IDENTITY`,
   `W-MUTATION-IR`, and `W-SHORTID` from the workaround register is the
   corpus-level exit criterion.
2. **LLP 0129 keeps mutation-IR admission.** Any consequence a lane has for
   the mutation IR — alternate-key `Get` addressing, `AllocateSerial`-class
   plan steps — is admitted (or refused) solely by LLP 0129's authority.
   This Decision confers no IR admission.
3. **Naming ruling — `v.serial({ start })` is adopted as the final
   spelling.** A corpus and package search found no conflicting use of
   `serial` on the validator surface or in the schema grammar; the name
   reads correctly to anyone porting a relational schema and avoids
   overloading "identity" (M-5). The schema-owner amendment uses this name;
   changing it now requires amending this Decision.

## What this Decision does not decide

Physical layout of the successor counter profile, the alternate-key lookup
grammar, which verified claims the auth projection exposes, wire encodings,
diagnostics codes beyond the requirement that they exist and be stable, and
all sequencing among the lanes (OQ5's envelope-early tail governs). Those
belong to the owner amendments. No comparative claim against any other
system is made (LLP 0183's comparator protocol governs).

## Status

Review, 2026-08-10 (c). Becomes Accepted on author sign-off; each owner lane
lands as a dated amendment to its owning LLP with a pointer added here.

Revision (c), from dual-family round-1 review: the auth row split into
**Principal (account identity)** and **Provider identity (credential)** with
C-2/C-6 rekeyed to the principal for app-side conversions; row identity
split into authoritative/speculative regimes with LLP 0133's id map added as
C-7 and M-2 scoped to preserve Lane Q's accepted ledger ids; source keys
graded identity-grade vs mutable-lookup with the queued-operation `_id`
binding rule (ABA); M-3's prefix scoped honestly (successor profile defines
the table-scope carrier); M-4 pinned to LLP 0135 §1.5's in-transaction
refusal shape; the schema amendment's mandatory question list added
(reservation timing, assignment order, replay, contention evidence);
Related gains 0008/0011/0057/0058/0133/0158.
