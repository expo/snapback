# LLP 0226: Identity architecture — namespaces, provenance, and conversion

**Type:** Decision
**Status:** Draft
**Systems:** Schema, Auth, Mutations, Storage, Client SDK, Effects
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-10
**Revised:** 2026-08-10
**Related:** LLP 0004, LLP 0007, LLP 0043, LLP 0081, LLP 0110, LLP 0129,
LLP 0135, LLP 0148, LLP 0151, LLP 0191,
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
| **Row identity** | Server mints `_id` at insert (LLP 0148 prefixed encoding, `prefix_` + base32) | One table within one instance incarnation | Immutable; never reused | `v.id(table)`, `_id` |
| **Auth identity (principal)** | Session mint; anchored to the provider's immutable `(issuer, subject)` pair | One auth provider installation | Immutable anchor; **email and profile claims are mutable attributes, never identity** | `v.principal()`, `ctx.auth.userId` |
| **Source key** | The application (client-generable; safe for local-first creation) | Declared unique index scope on one table | App-owned; the app decides | declared unique field + alternate-key lookup (schema lane) |
| **Serial identity (identity column)** | Server allocates, always — sequence semantics, gaps allowed | One table within one instance incarnation, under LLP 0110's incarnation prefix | Immutable after allocation; not writable by handlers, ever | `v.serial({ start })` (schema lane) |
| **Settlement identity** | Server derives a digest over `{authFingerprint, authorityInstanceId, clientMutationId, function, inputFingerprint[, operationIssuance]}` | App + instance + operation | Immutable; replay-stable by construction | `ctx.mutation.settlement()` (LLP 0043) |
| **Stream identity** | Framework mints the opaque `versionStream` (LLP 0043/0053); rotated on fork/restore (LLP 0158) | One instance's durable data stream | Rotates as a unit; values never compared across streams | resume tokens, live-query cursors |
| **Artifact identity** | Toolchain digests the evaluated code graph (LLP 0009/0010/0024) | One deployment's loaded artifacts | Immutable; a new build is a new identity | artifact digests, readiness receipts |
| **Counter identity** | Framework: `(counterName, scopeTable, scopeRowId, scopeIncarnation)` in `_snapback_sequence_counters_v1` (LLP 0135 §1.1) | The declaring app | N/A — substrate, never app-visible as a value | `AllocateSequence`, handler allocation |

Two clarifications the table cannot carry:

- **`v.principal()` is a *reference* type, not a mint.** A stored
  `v.principal()` field holds an auth-identity value minted elsewhere; it
  confers no verification. The verified thing is the principal on
  `ctx.auth`, and what *claims* travel with it is the auth lane's decision
  (§3b).
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
  rows they did not create (`W-MUTATION-IR`'s missing half).
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
  member of the source namespace — `(issuer, subject)` for auth identity,
  `_id` or a declared source key for rows.

### 3. Conformance rules for the mints

- **M-1 (one authority per namespace per scope).** Exactly one component
  mints values in each namespace within a scope. Concretely: no second
  counter authority beside `_snapback_sequence_counters_v1` (LLP 0135 §1.1's
  rejection-with-rationale is adopted here as a corpus-wide rule).
- **M-2 (server-owned mints refuse client values with stable codes).** Where
  the server owns the mint (row identity, serial identity, settlement
  identity), a client- or handler-supplied value refuses with a stable
  `SNAPBACK_*` diagnostic; it is never silently accepted or silently
  replaced.
- **M-3 (uniqueness is scoped, and the scope is stated).** Every uniqueness
  claim names its scope from §1's table. Client-observable unique
  constraints over server-allocated values are prefixed by
  `(scopeId, relationIncarnation)` per LLP 0110, so a restarted allocator
  cannot collide observably with orphaned rows.
- **M-4 (exhaustion fails closed).** Bounded namespaces (serial identity
  under LLP 0007's JavaScript-safe integer profile) refuse before the
  mutation tier on exhaustion, mirroring LLP 0135 §1.5.
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
  fail-closed refusal before the mutation tier (M-4).
- **Uniqueness and indexing:** no implicit index (LLP 0007's Index
  Contract); the author declares one; incarnation-prefix rule applies where
  a constraint stores allocated values (M-3).
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

- Auth identity is anchored to immutable provider `(issuer, subject)`;
  email is a mutable attribute and never a stored binding key (C-6).
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

Draft, 2026-08-10. Becomes Accepted on author sign-off; each owner lane
lands as a dated amendment to its owning LLP with a pointer added here.
