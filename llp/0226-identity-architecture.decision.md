# LLP 0226: Identity architecture — namespaces, provenance, and conversion

**Type:** Decision
**Status:** Active
**Systems:** Schema, Auth, Mutations, Storage, Client SDK, Effects
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-10
**Revised:** 2026-08-25 (Active: linked into `llp/foundation/` as part of the
LLP v2 larger kernel)
**Revised:** 2026-08-10 (a — initial draft)
**Revised:** 2026-08-10 (b — Draft → Review at llp-super-refine loop start,
the one authorized transition; independent-loop topology)
**Revised:** 2026-08-10 (c — round-1 revision; see Status)
**Revised:** 2026-08-10 (d — round-2 revision; see Status)
**Revised:** 2026-08-10 (e — post-round-3 closing fixes; **unreviewed** — see
Status)
**Revised:** 2026-08-10 (f — round-3 revision under the author's extended
budget; see Status)
**Revised:** 2026-08-10 (g — round-4 revision; see Status)
**Revised:** 2026-08-10 (h — round-5 revision; see Status)
**Revised:** 2026-08-10 (i — closing revision, loop terminal; see Status)
**Revised:** 2026-08-10 (j — Accepted: both loop-proposed rulings
(bootstrap conversion; destructive-reset-new-lineage) author-confirmed)
**Revised:** 2026-08-16 (k — lane (b) partial implementation pointer to LLP
0214 §6/§23: claims and the ordinary-write seal shipped; the host writer is
open; no Decision ruling changed)
**Related:** LLP 0004, LLP 0007, LLP 0008, LLP 0011, LLP 0043, LLP 0057,
LLP 0058, LLP 0081, LLP 0110, LLP 0129, LLP 0133, LLP 0135, LLP 0148,
LLP 0151, LLP 0158, LLP 0163, LLP 0191, LLP 0192,
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
| **Row identity (authoritative)** | The server's committed `_id` — minted server-side in Lane L (LLP 0148 prefixed encoding for framework mints), or an accepted client-minted id in Lane Q under the server's admission grammar (LLP 0133's `generatedIds` pin) | One table within one store lifetime (fork/restore rotates the stream, LLP 0158) | `_id` is a row *address*, not a lifetime identity: delete/recreate with the same `_id` mints a fresh **row incarnation** (LLP 0110); lifetime-sensitive references bind `(_id, rowIncarnation)` | `v.id(table)`, `_id` |
| **Row identity (speculative)** | The client mints optimistically for local-first creation; becomes authoritative or is rewritten at settlement via C-7's id map | One client's optimistic state until settlement | Replaced, not mutated | optimistic `_id` before settlement (LLP 0133) |
| **Principal (account identity)** | Snapback mints `usr_…` at account creation | One auth catalog/instance | The id is immutable; its **linked credential set is mutable** (LLP 0151 lifecycle) | `ctx.auth.userId`, `v.principal()` |
| **Provider identity** | The provider asserts the subject; Snapback mints the `idn_…` link row recording `(provider installation, subject) → principal` — physically keyed `(provider, subject)` unique; OIDC subjects are canonically `(issuer, subject)`, other providers define their subject per LLP 0151 (email-code: the canonical address) | One auth provider installation | The `(provider, subject)` pair is immutable as recorded; the principal link changes only via LLP 0151 lifecycle flows; **profile claims are mutable attributes, never identity** | auth substrate only — never handler-visible in v1 |
| **Source key** | The application (client-generable; safe for local-first creation) | Declared unique index scope on one table | Two grades, declared: an **identity-grade** source key is immutable and never reused; a mutable unique field is an ordinary lookup key, not an identity (C-3/C-6) | declared unique field + alternate-key lookup (schema lane) |
| **Serial identity (identity column)** | Server allocates, always — sequence semantics, gaps allowed | One table within one store lineage, at every instant: **the table counter never restarts** — the high-water is durable and survives restart, fork, and restore (restore carries the snapshot's high-water: rewind semantics, M-3), so the public value is the bare numeric with no prefix | Immutable after allocation; not writable by handlers, ever | `v.serial({ start })` (schema lane) |
| **Settlement identity** | Server derives a versioned digest: the base preimage `{authFingerprint, authorityInstanceId, clientMutationId, function, inputFingerprint}`, with issuance-bearing operations additionally binding `operationIssuance` **and** `artifactGenerationDigest` (LLP 0163's complete selected-artifact binding) | Caller/auth + instance + operation (+ selected artifact for issuance-bearing ops) — `authFingerprint` is the resolved invocation-auth fingerprint over principal/session/user (session-scoped when a session is present), not the app | Immutable; replay-stable by construction | `ctx.mutation.settlement()` (LLP 0043) |
| **Authority-instance identity** | Provenance varies by authority class (crates/snapback/src/auth/descriptor.rs): the stored session/revalidated authority id, a derived service-authority id (`aut_…`, LLP 0148), or the authorization-stream incarnation for anonymous/dev/admin/system authority | One authority instance; LLP 0043 owns queued-mutation binding and rotation | Rotates per LLP 0043's authority-descriptor rules; never a principal, session, stream, or settlement identity — it is the settlement digest's `authorityInstanceId` component | `authorityInstanceId` inside `ctx.mutation.settlement()`; auth substrate |
| **Stream identity** | Framework mints the opaque `versionStream` (LLP 0043/0053); rotated on fork/restore (LLP 0158) | One instance's durable data stream | Rotates as a unit; values never compared across streams | resume tokens, live-query cursors |
| **Artifact identity** | Toolchain digests the evaluated code graph (LLP 0009/0010/0024) | One deployment's loaded artifacts | Immutable; a new build is a new identity | artifact digests, readiness receipts |
| **Counter identity** | Framework: `(counterName, scopeTable, scopeRowId, scopeIncarnation)` in `_snapback_sequence_counters_v1` (LLP 0135 §1.1) | One app instance / store lineage (a fork's copy is a divergent sibling, LLP 0158) | N/A — substrate, never app-visible as a value | `AllocateSequence`, handler allocation |

Two clarifications the table cannot carry:

- **`v.principal()` is a *reference* type, not a mint.** A stored
  `v.principal()` field holds a principal id minted elsewhere; it confers no
  verification. The verified thing is the principal on `ctx.auth`, and what
  *claims* travel with it is the auth lane's decision (lane (b)). The
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
  the wrong row (the ABA failure). "An appropriate generation" means the row
  incarnation of LLP 0110 wherever row lifetime matters. Rotation,
  deletion-with-reuse, not-found, and stale-queue behavior are the schema
  amendment's to specify under this rule.
- **C-4 (client mutation id → settlement identity).** A raw client-chosen
  `clientMutationId` is never an effect key. The only conversion is the
  server-derived settlement digest, which namespaces it to app, instance,
  and operation. Downstream effect idempotency keys derive from
  `settlementId`, not from `clientMutationId`.
- **C-5 (no leakage of infrastructure namespaces).** Stream and counter
  identity never convert into application data, and no infrastructure
  identity may be exposed or used *directly* as an application identity.
  Artifact identity admits exactly one crossing: the **opaque, one-way,
  server-derived digest** of C-4's settlement conversion
  (`artifactGenerationDigest` in the issuance-bearing preimage) — the value
  is unrecoverable from the result and travels only inside `settlementId`.
  Apps distinguish instances by endpoint + stream identity (LLP 0158 OQ9),
  not by comparing stream values; counter state is unreadable by
  construction.
- **C-6 (mutable attributes never key durable app-side conversions).**
  Email, display name, and other mutable attributes may be *looked up* but
  never used as the stored key of a durable app-side binding or mapping. The
  stored key is the immutable member of the source namespace, chosen per
  conversion: inside the auth substrate, provider identity → principal keys
  on the recorded `(provider, subject)` pair (where a provider's subject
  *is* an address — email-code — that is that provider's subject inside its
  own namespace, not a license for app-side email keys); **app-side bindings
  (C-2) key on the principal**, never on the credential; row conversions key
  on `_id` (with row incarnation where lifetime matters) or an
  identity-grade source key.
- **C-7 (speculative → authoritative row identity).** LLP 0133's settlement
  id map is the declared conversion between the two row-identity regimes:
  Lane Q accepts client-minted ids (the `generatedIds` pin) as
  authoritative under the server's admission grammar; Lane L receives the
  same values as *claims*, rederives server-side, and publishes the
  `(mint site, occurrence)`-keyed map that rewrites optimistic ids, with
  0133's private receipt scope, unmapped outcome, rewrite, and cascade rules
  governing. No other conversion between speculative and authoritative row
  identity exists.

### 3. Conformance rules for the mints

- **M-1 (one authority per namespace per scope).** Exactly one component
  *admits* values into each namespace within a scope. For server mints the
  admitter and the minter coincide; for Lane Q row ids the client mints but
  the server's admission grammar is the single authority — no second
  admitter exists. Concretely: no second counter authority beside
  `_snapback_sequence_counters_v1` (LLP 0135 §1.1's protected-framework-table pin is adopted here as a corpus-wide rule).
- **M-2 (server-owned values refuse application overrides with stable
  codes).** Where the server owns a value (serial identity, settlement
  identity, the committed `_id` a handler reads), an **application or
  handler attempt to supply or override** it refuses with a stable
  `SNAPBACK_*` diagnostic; it is never silently accepted or silently
  replaced. The **protocol claim channels are exempt and governed
  exclusively by C-7**: Lane Q's accepted client-minted ids and Lane L's
  speculative claims (recorded and rewritten, never refused) are the
  accepted LLP 0133 contract, not overrides.
- **M-3 (uniqueness is scoped, and the scope is stated).** Every uniqueness
  claim names its scope from §1's table. Row-scoped counters keep LLP
  0110/0135's `(scopeId, relationIncarnation)` prefix rule: they
  intentionally restart with their recreated parent, and the prefix is what
  keeps duplicate numerics unreachable. **Table-scoped serial counters take
  the opposite decision, made here, not in the profile: the counter never
  restarts within a store lineage** — the high-water mark is durable and
  survives restart, fork, and restore — so the public serial value is the
  bare numeric with no prefix, and two visible rows can never share one.
  The lineage boundary is decided here too (author confirmed 2026-08-10,
  Charlie Cheever — destructive reset begins a new lineage): **destructive reset
  (`resetInstall`, `clear`, legacy reset) begins a new lineage** — data and
  counters restart together, so no visible collision can arise; **physical restore**
  continues the restored store's lineage and high-water (the bytes carry
  them) — with the across-time consequence stated plainly: restoring an
  earlier snapshot rewinds counter and data together, so uniqueness holds
  within the store at every instant, but an externally published serial
  (a permalink) may afterwards be re-minted for a *different* row. Apps
  that need external references immutable **across restores** use an
  identity-grade source key or `(_id, rowIncarnation)` — bare `_id` is a
  row address that can itself designate a fresh lifetime after a rewind —
  and a rewind can still *dangle* any reference (erase the referent);
  retarget-proof is the achievable property, dangling-proof is not — the serial's
  contract is PostgreSQL sequence-in-backup, no stronger, and the §1 row's
  "never share" claim is scoped within-lineage-at-any-instant. A booted
  `snapback store export` copy (LLP 0192) is classified with fork **for
  the counter lineage**: it begins a divergent sibling lineage continuing
  the snapshot's high-water, never comparable to its source — with the
  mechanism asymmetry stated: fork actively mints a new stream identity
  (LLP 0158), while an export is a faithful copy that *shares* its
  source's stream identity, sessions, and resume material, so only the
  endpoint distinguishes the siblings until the LLP 0192/0158 owners rule
  a rotation-on-boot story (their task, referenced here, not decided
  here); **logical export/import is refused for serial-bearing stores**
  until an LLP 0007 amendment defines atomic portable carriage of the
  counter's high-water, exhaustion state, and stable table/field identity —
  row reconstruction cannot recover a gap-burning counter's true
  high-water, so silently re-minting burned values is not an option (that
  amendment task joins the schema lane's list); a fork
  **begins a divergent sibling lineage** that continues its source's
  high-water, and fork *siblings* may thereafter mint equal bare numerics
  for different rows — the correct sequence-like
  outcome, never comparable across instances (C-5, LLP 0158 OQ9). The
  successor profile chooses mechanics under that observable contract,
  never the contract itself.
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
  Contract); the author declares one; a serial column's unique index uses
  the bare numeric alone under M-3's no-restart contract — the
  `(scopeId, relationIncarnation)` prefix remains a row-scoped LLP 0110/0135
  mechanism only.
- **The amendment must answer, explicitly:** reservation timing relative to
  the application transaction (LLP 0135's current allocator buffers the
  counter advance *into* the transaction, which un-burns values on
  rollback — gap-burning needs its own durable reservation boundary, or the
  amendment must show why in-transaction advance plus retry satisfies the
  gap semantics); the durable counter-key shape (whether the field name
  participates in counter identity, what rename means, whether multiple
  serial fields per table are permitted); the `start` grammar (required or
  defaulted, signed/range domain within the JS-safe bound); assignment
  order for multiple or conditional inserts, with "strictly increasing"
  defined as **allocation order** (commit order may interleave);
  crash-before-commit and exact-replay behavior; the durable high-water
  carrier that implements M-3's no-restart contract across fork/restore —
  including the stated observable that restoring an earlier snapshot
  rewinds the high-water with the data (externally published serials may be
  re-minted for different rows, the sequence-in-backup behavior) — and the
  LLP 0007 logical-import amendment above;
  range/bulk allocation (LLP 0135 OQ2); and contention evidence — the
  off-the-write-path claim is an expectation pending measurement (today's
  SQLite target serializes writes globally anyway; a future multiwriter
  target has a real hot-counter point).
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
`issues/20260808-guide-gap-principal-to-app-identity-binding.md` (open).
Constraints from this Decision:

- The §1 principal/provider-identity split governs: the principal (`usr_…`,
  `ctx.auth.userId`) is the app-side key; provider identities (`idn_…`,
  `(issuer, subject)`) stay inside the auth substrate, and email is a
  mutable attribute and never a stored binding key (C-6).
- **Bootstrap conversion (RULED — author confirmed 2026-08-10, Charlie
  Cheever):** a narrowly scoped, verified **bootstrap** conversion
  `provider identity → app row` is permitted at binding-creation time only
  — the moment C-2's writer holds both verified sides — after which all
  steady-state handler access keys on the principal, and every durable
  binding does too. (Where an amendment exposes specific verified claims to
  handlers, it supersedes §1's "never handler-visible in v1" qualifier for
  exactly those claims.) This keeps the "expose verified claims" branch usable without
  weakening C-6: exposed claims may seed a binding, never key one. Which
  claims are exposed remains the owner's deliberate, claim-by-claim
  trust-boundary decision; the privileged-provisioning channel remains the
  alternative where no claims should reach handlers at all.
- The guide's broker and frozen-actor-map recipes remain the conforming
  patterns after the amendment as alternative trusted-writer shapes.
- **Partially implemented 2026-08-16:** LLP 0214 §6 and §23 record the exact
  exposed claim boundary, server-derived frozen projection, and complete
  declaration-derived seal against ordinary writes. The host-invoked,
  host-injected writer remains open; the broker and frozen actor-map remain
  the conforming executable writers. Email/provider facts cannot authorize an
  ordinary binding write; durable app access remains principal-keyed.

### (c) D5/effects owner — settlement identity

Owner: LLP 0043 (offline replay/retention), where the handler-visible
settlement identity already landed 2026-08-08
(`ctx.mutation.settlement()` → `{clientMutationId, settlementId}`; ticket
`issues/closed/20260808-handler-settlement-identity-surface.md`). That
landing is this lane's floor and already conforms: server-derived versioned
digest, namespaced to caller (authFingerprint hashes
principal/session/user), instance (authorityInstanceId), operation
(function + inputFingerprint), and — for issuance-bearing operations — the
selected artifact (`artifactGenerationDigest`, LLP 0163), read-only,
mutation-only (C-4, M-2). Remaining lane scope: reconciling LLP
0043's own digest enumeration with the corrected preimages above (its text
still omits `artifactGenerationDigest`; one-line amendment), guide absorption
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
belong to the owner amendments. Row-incarnation mechanics belong to LLP
0110/0129's owners; conversions that bind row lifetime cite them. C-3's
incarnation clause names the interface; today's registry carries
incarnations only for registered protected-relation parents, so where
lifetime matters the owning amendments must **extend or activate the
incarnation carrier for the tables that need it, or refuse the
capability** — the rule, stated once: an `_id`-only reference is permitted exactly where
the amendment normatively declares the operation non-lifetime-sensitive,
and prohibited everywhere else — lifetime-sensitive durable or queued
references re-admit exactly the ABA failure C-3 refuses. No comparative
claim against any other system is made (LLP 0183's comparator protocol
governs).

## Status

Accepted, 2026-08-10 (j) — author sign-off with both loop-proposed rulings
confirmed. Each owner lane
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

Revision (i — closing revision, loop terminal). Round-6 convergent fixes:
the authority-instance identity gains its own namespace row (the round-6
pre-existing catch — its provenance-by-authority-class, LLP 0043
ownership, and non-equivalence to stream/settlement identity stated); the
restore-immutability recommendation corrected to identity-grade keys or
`(_id, rowIncarnation)` with the retarget-vs-dangling distinction; the
export-sibling classification scoped to counter lineage with the
shared-stream-identity asymmetry disclosed and its rotation-on-boot story
assigned to the LLP 0192/0158 owners; the fallback boundary stated as one
rule; LLP 0192 added to Related. The loop ends here — six rounds, both
families endorsing the direction throughout; final report carries the
ledger. This revision is final-unreviewed.

Revision (h), round-5 revision: the restore-rewind consequence is stated in
M-3 itself (permalinks may retarget across restores; apps needing
restore-immutable external references use identity-grade keys or row ids —
sequence-in-backup, no stronger), the §1 serial row scoped
within-lineage-at-every-instant, and booted `store export` copies (LLP
0192) classified as divergent sibling lineages alongside fork; the
lifetime-sensitive qualifier moved adjacent to the fallback prohibition.

Revision (g), round-4 revision: the `_id`-only fallback is prohibited for
lifetime-sensitive durable/queued references (extend the incarnation
carrier or refuse — the fallback re-admitted C-3's ABA failure); C-5
narrowed to admit exactly the opaque one-way artifact-digest crossing that
C-4's shipped settlement design performs; physical restore vs logical
import distinguished, with logical import of serial-bearing stores refused
pending an LLP 0007 portable-carriage amendment; fingerprint renamed the
resolved invocation-auth fingerprint; fork classified a divergent sibling
lineage; restore-rewind observable added to the amendment list; M-1
citation corrected to the protected-table pin; bootstrap sentence repaired
with the v1-qualifier bridge; the dangling section token fixed.

Revision (f), round-3 revision under the author's extended budget: the
verified-claims branch gains the loop-proposed bootstrap-conversion ruling
(binding-creation-time only; steady state keys on principal — author
confirms at acceptance); the serial lineage matrix is decided (destructive
reset = new lineage; import/restore continue; fork siblings may collide,
never comparable); counter identity rescoped to one instance/lineage; the
incarnation-carrier gap and caller-fingerprint wording made honest.

Revision (e — UNREVIEWED), post-round-3 closing fixes applied after the
review budget closed and not seen by any reviewer: the ambiguous "(lane (b))"
cross-reference now names lane (b); lane (c) gains the LLP 0043
digest-enumeration reconciliation task; the schema lane's leftover
incarnation-prefix bullet is aligned with M-3's bare-numeric decision.
Remaining round-3 MATERIAL concerns are dispositioned in the loop's final
report.

Revision (d), from dual-family round-2 review: M-2 rescoped to
application/handler overrides with the C-7 protocol claim channels exempt
(Lane L claims are recorded and rewritten, never refused) and M-1 restated
as single-*admitter*; `_id` corrected to a row address with LLP 0110 row
incarnations carrying lifetime (C-3's "appropriate generation" named); the
provider-identity row rebuilt on the physical `(provider, subject)` link
model with per-provider subject definitions and the email prohibition
narrowed to durable app-side keys; the serial no-restart/no-prefix contract
decided at this Decision's level (M-3); the settlement digest corrected to
the versioned preimages including `artifactGenerationDigest` for
issuance-bearing operations (LLP 0163 added to Related) with caller-scoped
`authFingerprint`; the schema amendment's mandatory list gains counter-key,
`start`-grammar, and high-water questions; "ledger id" replaced with LLP
0133's `generatedIds` vocabulary.
