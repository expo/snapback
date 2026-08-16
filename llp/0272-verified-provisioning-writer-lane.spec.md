# LLP 0272: Host-invoked verified-provisioning writer lane

**Type:** Spec
**Status:** Accepted
**Systems:** Auth, Security/authorization, Storage, Code generation, Application data API, Diagnostics, Testing
**Author:** Claude Fable 5 / orchestrated
**Date:** 2026-08-16
**Revised:** 2026-08-16 (initial draft)
**Revised:** 2026-08-16 (round 2 — app-row binding, closed completion carrier,
buffered/OCC transition join, exact-pair idempotency, and LLP 0053 composition)
**Revised:** 2026-08-16 (round 3 — trusted-custody lookup source, `_id`+incarnation
binding, `onMissing:create` removed from v1, explicit LLP 0057 exchange join,
receipt/binding-state separation with a key-migration protocol, a closed
provisioning membership writer class, and the pre-SQLite protected-room interlock)
**Revised:** 2026-08-16 (round 4 — whole-table identity-source seal, provider
discriminator inside the unique index tuple, closed enumerated source-population
writer + a central incarnation-checking binding resolver, the completed LLP 0057
exchange amendment (attempt accounting, stripe/keyring lock order, full challenge
recheck), a framework-protected no-revival grant registry, bootstrap removed in
favor of `by:["none"]`/`self` open-join, mandatory binding target, a durable
canonical key registry with a fence-and-drain migration, and UUIDv7-`TEXT`
incarnation encoding)
**Revised:** 2026-08-16 (round 5 — identity-source activation is an attributed
import: activation refuses unless the table is empty or every current row carries
a §2.7 receipt (the RQ-1 cutover IS that import); permission/membership targets
pinned to resource-determined declarations with hook-selected identities refused
and non-`app` privileged seating in the type; ordinary-effect suppression rule so
the §2.5 skip predicate is decidable from declaration + lookup in every admitted
shape; §3.4 lock-order wording corrected (maintenance + stripe held throughout,
then keyring then writer, nothing across LLP 0059 `Begin`); migration option (b)
made repeat-until-empty or a terminal atomic fence; and the enumerated minors)
**Revised:** 2026-08-16 (round 6 — §3.4/§6.1/§6.3 lock protocol made SATISFIABLE
against shipped LLP 0059/0057: round 5's "hold maintenance + stripe throughout,
never drop, nothing across 0059 `Begin`" was unsatisfiable — shipped exchange does
the 0059 `Begin` / cap-eviction drain (`premark_issuance`) before its commit and
0057 requires every guard dropped before that `Begin`. Restored the shipped-sound
**drop-both-then-fresh** composition (hold through JS + quiescence, drop both, do
the `Begin`/drain, take one fresh non-nested shared admission, then keyring then
writer; the full commit recheck is the safety net for the unlocked stripe gap;
hook wall-clock bound cited). Spelled out MATERIAL A — the §2.7 receipt is now a
framework-owned always-sealed registry (`_snapback_verified_source_receipts_v1`)
unique on `(source_table, _id, incarnation)` and `(envelope, offset)`, integrity-
bound per LLP 0214 §4.8, written only by the §2.7 consumer in the row-creation tx;
activation's scan + seal + generation-publish occur under one serialized,
traffic-fenced transaction exact-joining that registry. Spelled out MATERIAL D —
deleted §7.4's exclusive-OR: the admission frontier / terminal atomic fence is
MANDATORY, repeat-until-empty only a drain tactic under it. Minors: §8.1 names
every LLP 0081 write primitive; `resourceFrom`/`source-row` conflict columns
required non-optional; `conflictValues` arity = non-principal `fields`; skip path
constructs the no-op buffer + receipt without JS)
**Revised:** 2026-08-16 (ACCEPTED — both families returned READY on the round-6
revision; folded grok's six non-blocking minors: §7.4 drain-fence and terminal
atomic fence are two implementations of the one mandatory frontier; activation
additionally requires `receipt.match_tuple` to equal the row's current
`lookup.fields` (refuses pre-seal cutover-window drift); a STALE/hook-refuse after
`premark_issuance` MUST `finish_issuance`/`compare_unmark_issuance`-roll-back the
premark; the LLP 0214 §4.8 integrity binding named as a keyring HMAC over the
canonical receipt record, verified on every consult; `(envelope, offset)` and
`(source_table, row_id, incarnation)` uniqueness scoped to `(app_id,
version_stream)` as v1; and a deferred-arm note that the source-key arm's receipt
PK must use a non-null `incarnation` sentinel under SQLite NULL-distinct semantics.
Status Draft → Accepted; implementation deferred as a separate follow-up)
**Related:** LLP 0003, LLP 0009, LLP 0057, LLP 0053, LLP 0055, LLP 0056,
LLP 0058, LLP 0110, LLP 0151, LLP 0183, LLP 0211, LLP 0214, LLP 0226, and
`issues/20260808-guide-gap-principal-to-app-identity-binding.md`

## Summary

LLP 0214 specifies a sealed, host-invoked verified-provisioning hook. LLP 0226
lane (b) shipped its read-only `ctx.auth.claims` projection and the complete
ordinary-write seal for declared identity-binding tables. The inside writer
remains deliberately unwired.

This Spec fixes **Fork A: channel only**. A provider claim is evidence for one
host-owned lookup and nothing more. The host resolves exactly one row in the
app's declared, **custody-sealed** identity source, then durably binds:

```text
Snapback principal  <->  resolved app-row identity + row incarnation
```

The right side is the app row's `(_id, rowIncarnation)`, or a schema-declared
identity-grade app source key. It is never an email, phone number, provider
`canonicalValue`, `(provider, subject)`, or `(issuer, subject)`. Those
credential-side values seed the one-time lookup and are absent from the binding
write. This is the LLP 0226 C-2/C-6 conversion, bound at LLP 0226 C-3 lifetime
identity rather than a bare address.

Round-4 closes the remaining integration-completeness layer:

- **Whole-table custody seal, with attributed activation.** The identity source
  is a **whole-table-sealed** table in the shipped
  `enforce_identity_binding_write_seal(schema, table)` family (§2.6), not a column
  subset the landed one-argument seal cannot express. Its only writers are a
  **globally enumerated, closed set** — an authorized migration/import lifecycle
  whose receipt binds the complete match tuple, resolved row identity and
  incarnation, source provenance, and an atomic row-creation/claim — so no
  ordinary caller can author the row a later migration stamps into the resolved
  set (§2.6, §2.7). Activation of a source table itself is that attributed import:
  it **refuses** unless the table is empty or **every current row already carries a
  §2.7 import receipt**, so declaring a pre-populated ordinary table as the source
  and backfilling incarnations can never launder attacker-authored rows into the
  resolved set (§2.2, §2.7).
- **Provider discriminator inside the unique index.** The stored lookup tuple and
  its unique index include the provider-installation discriminator:
  `(providerInstallation, subject)` for provider-subject,
  `(providerInstallation, issuer, subject)` for issuer-subject,
  `(providerInstallation, canonicalValue)` for a non-global `external` canonical
  value. Provider A's subject `42` can never resolve provider B's imported row
  (§2.1, §2.2).
- **Incarnation-checking binding resolver.** A generated/central resolver joins
  the stored `(_id, rowIncarnation)` to the live LLP 0110 incarnation registry on
  every `principal → binding → app row` read and returns dangling/conflict on
  mismatch, so a delete/recreate cannot be reached through a bare `_id` read
  (§5.4). Incarnation is LLP 0110's canonical UUIDv7 `TEXT`, and the source table
  is enrolled in the incarnation registry with a reviewed backfill (§2.2, §7.1).
- **Completed LLP 0057 exchange amendment.** Only an active *incorrect* code
  submission increments attempts (locked/terminal/unknown outcomes commit a no-op
  classification, never burning a valid code); wrong/locked codes still construct
  no completion and run no hook; success-path attempt accounting moves inside the
  one transition commit. The shared maintenance admission and the per-address
  stripe are held from HMAC through JS and room quiescence, then **both are dropped**
  so the shipped LLP 0059 projection `Begin` / cap-eviction drain (`premark_issuance`)
  runs with no guard held across it; the host then takes **one fresh, non-nested**
  shared maintenance admission (not the nested reacquire that deadlocks the fair
  gate) and acquires the keyring then the SQLite writer. The stripe is not
  reacquired; the brief unlocked gap is covered by the single commit's full
  challenge recheck — unconsumed, unsuperseded, unlocked, unexpired, same generation
  — which makes any in-gap re-mint refuse `STALE` and bind nothing (§3.4, §6.1,
  §6.3).
- **Framework-protected no-revival registry.** The no-revival witness is a
  framework-owned immutable grant-tombstone registry keyed to the complete grant
  identity, sealed against ordinary writes, and updated transactionally by every
  removal/revocation/expiry/replacement/reset/import/migration path — not an
  app-declared table an attacker could forge or a lifecycle could skip (§5.3).
- **Bootstrap removed.** The membership initial-grant arm admits only a
  `by:["none"], target:"self"` open-join onto a non-`lastHolder`-protected role;
  it never spends or fakes LLP 0056's creation-bound bootstrap witness, which
  app-global memberships do not have (§5.3).
- **Mandatory binding target and durable canonical registry.** A production/guest
  proof producer MUST declare at least one identity-binding target, so §2.5's
  repeat-event skip always has an event-independent binding key to decide on
  (§2.5, §7.2). The canonical binding/grant keys live in a defined framework-owned
  registry with a stored `key_version`, and a `v2` migration closes the cutover
  under a **mandatory terminal atomic fence / admission-epoch frontier** —
  repeat-until-empty is only a drain optimization under it, never a standalone
  termination rule (a paused `v1` producer defeats an empty pass) — before
  `v2`-only activation (§7.2, §7.4).

Prior rounds' next layer (retained):

- **Lookup steering.** The identity source is under **trusted custody** — sealed
  against ordinary handler/HostPlan/seed/projection writes, exactly like an
  identity-binding table. A caller cannot pre-seed `users.email = victim` and have
  the host bind the victim to that attacker-authored row (§2.2, §2.6). Host-read
  is not host-verified.
- **`onMissing:create` is removed from v1.** Zero-match refuses. An app
  provisions its app row through its ordinary, custody-governed flow before a
  binding can be ensured (§2.3, §11).
- **Lifetime identity.** The row-id arm binds `(_id, rowIncarnation)` in both the
  binding row and the canonical key; delete/recreate cannot silently retarget a
  binding (§2.2, §5.2, §7.2).
- **Producer join.** The production trigger, LLP 0057's
  `POST /auth/exchange` consumer, is **explicitly amended** from its shipped
  single-`IMMEDIATE`-transaction shape to the buffered / one-transition-commit
  model, with the hook joined inside that transition (§3.4).
- **Receipt vs binding state.** A per-completion receipt (idempotency by
  governing event) is separated from the durable, event-independent canonical
  binding key, with defined target cardinality and a versioned-key migration
  protocol (§7).
- **Permission writer class.** A closed `VerifiedProvisioningInitialGrant`
  membership writer class — *not* the `is_privileged_noninvocation` branch —
  carries an owner/last-holder/consent rule and a no-revival tombstone predicate,
  and LLP 0056 is amended for it (§5.3).
- **Protected-room interlock.** An explicit phase after hook settlement and
  before Local/SQLite derives a conservative authorization-impact preview,
  reserves and quiesces the LLP 0053 room interlock, then binds it to the exact
  final changes (§6.2).

The production-capable positive trigger is a private, non-deserializable
`VerifiedIdentityCompletion`. Only the exhaustively enumerated genuine-proof
consumers in §3 may construct it. `auth.mintSession` has a separate,
rehearsal-only carrier which can never become a production completion. A
password registration, password set, username that happens to look like an
email, request DTO, bearer, `AdminWrite`, `System`, CLI/MCP call, or
string-validating helper cannot construct either carrier.

Hook JavaScript runs outside the SQLite writer lock against captured reads and
buffers its writes. One brief transition commit revalidates all proof, app,
artifact, assurance, binding, and authorization inputs, then atomically applies
auth, app, session, receipt, journal, and notification-intent effects. The
provisioning executor joins that transition commit; it never begins a nested or
standalone transaction.

Fork B stays closed. `auth.mintSession` is a dev/test/demo-only operation,
requires both `AdminWrite` and `ImpersonationCapability`, and always produces
rehearsal-tainted authority. Production refuses the operation before it mints
anything.

## 1. Scope, precedence, and invariants

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative.

This Spec replaces, on acceptance, the conflicting mechanism text in LLP 0214
§§5.2–5.9, the verified-provisioning steps in §§8.2, 8.3, and 8.5, and the open
writer description in §23. It additionally **amends LLP 0057**'s
`POST /auth/exchange` transaction shape (§3.4), **amends LLP 0056** for the closed
`MembershipWriter::VerifiedProvisioningInitialGrant` open-join-self class (§5.3),
and **amends LLP 0053/0056** so every grant-ending path updates the
framework-protected grant-tombstone registry transactionally (§5.3.1). In
particular:

- LLP 0214 §5.2's credential-shaped `VerifiedIdentityResult` remains proof
  input, not the durable app-side identity;
- LLP 0214 §5.5's `identityField` grammar is replaced by §2's declared identity
  source and `appIdentityField` grammar;
- LLP 0214 §§8.3 and 8.5 do not fire provisioning merely because a local
  username/password identity was created;
- LLP 0214 §5.7's unversioned `provisioningKey` prose is replaced by §7's
  versioned binding-pair and completion keys and exact receipt comparison; and
- LLP 0057's single-`IMMEDIATE`-transaction `POST /auth/exchange`
  ("runs lookup, HMAC verification, attempt accounting, challenge consumption,
  identity provisioning, session-cap enforcement, and session insertion in one
  `IMMEDIATE` transaction") is amended so its identity/session effects and any
  joined provisioning hook use §6's buffered / one-transition-commit model.
  Consumption of the challenge remains inside that single commit; it is never
  committed ahead of a joined hook.

This Spec is a design contract, not an implementation claim.

### 1.1 Load-bearing invariants

1. **App-row binding.** An identity-binding row contains the host-resolved
   principal and the host-resolved app-row identity **with its row incarnation**.
   A provider claim is never the stored app-side mapping key.
2. **Host-owned, custody-sealed lookup.** The provider claim seeds exactly the
   declared lookup in §2 against a **whole-table-sealed** identity source whose
   only writers are the closed enumerated migration/import set of §2.6. The hook
   cannot select the table, predicate, matching row, or bound app-row value, and
   no ordinary handler — nor a later migration acting on ordinary-authored
   staging — can author the row that the lookup resolves. The stored lookup tuple
   and its unique index always pin the provider-installation discriminator, so a
   subject shared across providers cannot cross-resolve.
3. **Constructor-only authority.** `VerifiedProvisioning` exists only after a
   private `VerifiedIdentityCompletion` constructor consumes one admitted proof
   predecessor, or after the separately typed non-production rehearsal
   constructor consumes `auth.mintSession`'s exact operator predecessor.
   Constructor-only authority is an invariant, not a coding convention.
4. **Separate writer type.** The shipped ordinary identity-binding seal remains
   unconditional. A distinct provisioning writer is the only application-code
   path that does not enter that ordinary writer.
5. **One atomic transition.** Proof consumption, principal/identity/assurance
   transitions, app writes, permission invalidation, session consequences,
   receipt, journal, and notification intent commit or roll back together, and
   the protected-room reservation is installed and quiesced before that commit
   begins.
6. **Lifetime identity.** Every lifetime-sensitive app-row reference the binding
   or canonical key stores is `(_id, rowIncarnation)` (LLP 0110 canonical UUIDv7
   `TEXT`) or an identity-grade source key (LLP 0226 C-3); bare `_id` is never a
   durable binding target, and the **only sanctioned/host-mediated**
   `principal → binding → app row` resolution rejoins the stored incarnation
   against the live LLP 0110 registry (§5.4), so the sanctioned path can never
   reach a recreated row. A hand-written `ctx.db.get(source, binding.userID)` in
   app-trust-domain code remains *expressible* and would see the recreated row;
   that is nonconforming code the guide reteaches off, not a runtime-impossible
   state (§5.4).
7. **No authority widening.** Bearers, `AdminWrite`, `System`, LLP 0055 grants,
   and handler ids cannot be widened or relabelled into the constructor or
   writer. The provisioning membership writer is its own closed class, not the
   privileged non-invocation branch.

## 2. Closed declaration grammar and compilation

### 2.1 Version-2 hook declaration

The round-1 string handler and credential-shaped binding declaration are
replaced by this closed source shape:

```ts
type VerifiedProvisioningDeclarationV2 = Readonly<{
  version: 2

  handler: Readonly<{
    module: string
    export: string
    kind: 'verified-provisioning-v1'
  }>

  requires: readonly string[]

  identitySource: Readonly<{
    // The identity source is a WHOLE-TABLE-sealed table. `custody.seal` names a
    // schema-declared whole-table custody seal (§2.6) in the shipped
    // `enforce_identity_binding_write_seal(schema, table)` family. Compilation
    // refuses a source table that is not under that seal, and binds `seal` to
    // the seal that actually covers this exact `table` (not an arbitrary
    // string).
    table: string
    custody: Readonly<{
      kind: 'identity-source-custody-v1'
      seal: string
      // The closed, globally enumerated writer set admitted to populate this
      // table (§2.6). v1 admits exactly the authorized migration/import
      // lifecycle. Every other writer refuses at the seal.
      admittedWriters: readonly Readonly<{
        kind: 'authorized-migration-import-v1'
        // `lifecycle` binds — exactly as `custody.seal` binds to the seal that
        // covers this table — to a HOST-RECOGNIZED validated-import-envelope
        // consumer registered in the framework's admitted-import registry, not an
        // arbitrary string and not an app SQL job that `SELECT`s attacker
        // staging. Compilation refuses a `lifecycle` that does not resolve to a
        // registered §2.7 envelope consumer (§2.7).
        lifecycle: string
      }>[]
    }>

    // A closed, provider-DISCRIMINATED match tuple. The stored tuple always
    // includes the provider-installation column, so a bare `subject` shared
    // across providers cannot match. `discriminatorField` names the stored,
    // indexed provider-installation column; `subjectField`/`issuerField`/
    // `valueField` name the remaining stored columns.
    claimKey:
      | Readonly<{
          // Only a GLOBALLY identifying canonical value (`email`, `phone`) may
          // omit the discriminator column; `external` (and any non-global
          // canonical value) MUST carry it (§2.2).
          kind: 'canonical-value'
          provider: string
          identityKind: 'email' | 'phone'
          valueField: string
        }>
      | Readonly<{
          kind: 'canonical-value-scoped'
          provider: string
          identityKind: 'username' | 'external'
          discriminatorField: string
          valueField: string
        }>
      | Readonly<{
          kind: 'provider-subject'
          provider: string
          discriminatorField: string
          subjectField: string
        }>
      | Readonly<{
          kind: 'issuer-subject'
          provider: string
          issuer: string
          discriminatorField: string
          issuerField: string
          subjectField: string
        }>

    lookup: Readonly<{
      index: string
      // Ordered to the claim-key arity; the named index is a true unique index
      // over EXACTLY these fields (§2.2), and EXACTLY equals the claim key's
      // stored tuple: [valueField] for a global canonical value;
      // [discriminatorField, valueField] for a scoped canonical value;
      // [discriminatorField, subjectField] for provider-subject; and
      // [discriminatorField, issuerField, subjectField] for issuer-subject.
      // There is no one-field subject index.
      fields: readonly string[]
      cardinality: 'exactly-one'
      collation: 'catalog-canonical'
    }>

    resolvedIdentity:
      | Readonly<{ kind: 'row-id' }> // binds (_id, rowIncarnation); TEXT UUIDv7
      | Readonly<{
          kind: 'identity-grade-source-key'
          field: string
          index: string
        }>

    // v1 has exactly one behavior on zero match: refuse. `create` is removed
    // (§2.3, §11); a future creating variant is a separate spec.
    onMissing: Readonly<{ kind: 'refuse' }>
  }>

  reads: readonly string[]

  writes: readonly (
    | Readonly<{
        table: string
        mode: 'ordinary'
      }>
    // The identity-binding write mode is a union by resolved-identity kind, so
    // the row-id arm's incarnation column is mandatory rather than optional.
    | Readonly<{
        table: string
        mode: 'identity-binding'
        resolved: 'row-id'
        principalField: string
        appIdentityField: string
        // Schema-declared framework-owned column storing the captured UUIDv7
        // TEXT row incarnation alongside appIdentityField. Mandatory here.
        appIncarnationField: string
      }>
    | Readonly<{
        table: string
        mode: 'identity-binding'
        resolved: 'identity-grade-source-key'
        principalField: string
        appIdentityField: string
        // No incarnation column: the source-key grade already guarantees
        // non-reuse (§2.2).
      }>
    | Readonly<{
        table: string
        mode: 'permission-initial-grant'
        principalField: string
        // Both target kinds are RESOURCE-DETERMINED: every non-principal axis of
        // the grant identity is fixed by the declaration or resolved from the §2
        // identity-source lookup, NEVER from hook output. This is what makes
        // `permissionGrantKeyV1` (§7.2) and therefore §2.5's skip predicate
        // decidable before the hook runs. Codegen refuses any target whose
        // resource/conflict identity is hook-selected
        // (`SNAPBACK_AUTH_PROVISIONING_IDENTITY_SOURCE_INVALID`).
        target:
          // A `.membership()` open-join. v1 admits ONLY a `by:["none"]`,
          // `target:"self"` open-join onto a role the declaration does not model
          // as `lastHolder`-protected or owner/bootstrap (§5.3). There is no
          // bootstrap arm; app-global and orphaned-resource seating stay on
          // LLP 0056's privileged non-invocation writers.
          | Readonly<{
              kind: 'membership-open-join-self'
              role: string
              // The resource identity is resource-determined, not hook output.
              // `scope: 'app'` is the app-global singleton (LLP 0056 §1299: no
              // creation witness, no privileged-first-holder seating — encoded in
              // the type, so codegen never emits first-holder seating for it).
              // `scope: 'resource'` resolves the resource id from a host-owned
              // `resourceFrom` column of the §2 source row; it likewise seats no
              // privileged first holder and only open-joins the completion
              // principal onto the non-protected role.
              resource:
                | Readonly<{ scope: 'app' }>
                | Readonly<{ scope: 'resource'; resourceFrom: string }>
            }>
          | Readonly<{
              kind: 'permission-backing'
              index: string
              fields: readonly string[]
              // Every non-principal conflict value is resource-determined: a
              // declaration literal or a host-owned value resolved from the §2
              // source row — never hook payload. Ordered to the non-principal
              // members of `fields`, and `conflictValues.length` MUST equal that
              // non-principal arity (§2.2). A `source-row` `sourceField` MUST name
              // a NOT NULL / required source column (§2.2). Codegen refuses a
              // conflict axis bound to hook output, a nullable source column, or a
              // length that does not match the non-principal `fields` arity.
              conflictValues: readonly (
                | Readonly<{ from: 'literal'; value: string }>
                | Readonly<{ from: 'source-row'; sourceField: string }>
              )[]
            }>
        // The no-revival witness is the FRAMEWORK-PROTECTED grant-tombstone
        // registry (§5.3), addressed by the grant identity — not an app-declared
        // table. This field only names how this grant's identity maps into that
        // registry's key; the registry itself is framework-owned and sealed.
        grantIdentity: Readonly<{ index: string; fields: readonly string[] }>
      }>
  )[]
}>
```

Unknown fields, tags, modes, providers, tables, indexes, source-key grades,
custody seals, requirements, or duplicate declarations refuse generation. The
compiled descriptor carries the normalized declaration, generator version,
auth-program digest, schema digest, authorization-metadata digest, hook artifact
digest, and complete bundle digest.

The round-2 `permission-backing` write mode with an inline `conflictKey` is
renamed `permission-initial-grant` and split by `target` into the two distinct
writer paths of §5.3.

**Mandatory binding target.** A `verified-provisioning-v1` declaration MUST
include at least one `identity-binding` write. A hook with zero binding targets
is refused generation with
`SNAPBACK_AUTH_PROVISIONING_IDENTITY_SOURCE_INVALID`. This is a soundness
requirement, not ergonomics: the identity binding is the lane's whole purpose,
and — as §2.5/§7.2 require — the stable `bindingPairKeyV1` is the
event-independent state the repeat-event skip rule decides on. A permission-only
or ordinary-only producer would leave §2.5 with no key to key on and would
release a session with no app binding; both are excluded in v1. A permission-only
lane, if ever wanted, is a separately named future spec with its own invariants
and its own mechanically-decidable skip rule.

### 2.2 Identity-source validation

Codegen and activation MUST prove all of the following:

- **Whole-table trusted custody.** `identitySource.custody.seal` names a
  schema-declared **whole-table** custody seal (§2.6) that seals the entire
  `identitySource.table`, in the shipped
  `enforce_identity_binding_write_seal(schema, table)` family. Compilation binds
  `seal` to the seal that actually covers this exact table and refuses a source
  table that is not sealed, or whose declared seal names a different table, with
  `SNAPBACK_AUTH_PROVISIONING_IDENTITY_SOURCE_INVALID`. Under that seal the whole
  table is unwritable by ordinary handler, HostPlan, seed, generated
  resource/transaction, and both maintained-projection paths. A source table that
  is also a maintained-projection output refuses generation (its projection write
  would refuse at the seal), rather than being discovered at rebuild time.
- **Closed admitted-writer set.** `custody.admittedWriters` globally enumerates
  the only writer identities permitted to populate the table (§2.6). v1 admits
  exactly one kind, the authorized migration/import lifecycle. Ordinary callers,
  the hook, HostPlan, seed, projections, and the deferred creating variant are
  not in the set.
- **Provider-discriminated match tuple.** `claimKey` names one declared provider
  installation and the stored discriminator/subject/issuer/value columns.
  `lookup.fields` equals the claim key's stored tuple **exactly**, in order, and
  MUST include the provider-installation discriminator column unless the kind is
  a `canonical-value` over a globally identifying `email`/`phone`. Concretely the
  arity is: `[valueField]` (global canonical value), `[discriminatorField,
  valueField]` (scoped canonical value), `[discriminatorField, subjectField]`
  (provider-subject), and `[discriminatorField, issuerField, subjectField]`
  (issuer-subject). A one-field subject index is refused. A completion from a
  different provider installation, identity kind, or issuer is both inapplicable
  (applicability pins the provider) **and** structurally non-matching (the stored
  discriminator differs), so provider A's subject `42` can never resolve provider
  B's imported row.
- **Unique index over exactly the discriminated tuple.** The named index is a
  true unique index whose equality key is exactly `lookup.fields` — the same
  discriminated tuple above, never a bare subject/value — using the
  **`catalog-canonical` collation** (LLP 0211), never a `NOCASE`-vs-binary split
  between the index and the host lookup predicate. Codegen refuses a declaration
  whose named index is not over exactly that tuple, and refuses to share one
  discriminator-free index across two provider installations. Activation scans
  legacy/existing data and refuses duplicates; the runtime still checks `>1` as a
  corruption/backstop case. Its storage query is not authored by the hook.
- **Cardinality.** `cardinality` is literally `exactly-one`. No first-row,
  limit-one, best-match, case-insensitive fallback, scan-order selection, or
  hook-supplied predicate exists.
- **Lifetime-safe resolved identity.** `resolvedIdentity: 'row-id'` binds the
  committed `(_id, rowIncarnation)` of the matching source row (LLP 0226 C-3;
  LLP 0110 incarnation). The row incarnation is LLP 0110's canonical
  **UUIDv7 `TEXT`** from `_snapback_relation_incarnations_v1.incarnation` — never
  a truncation, hash, or `u64` reduction, which would collide two lifetimes onto
  one key. The declaration MUST name `appIncarnationField`, a schema-declared
  framework-owned column, so the incarnation is stored alongside `_id`. The `_id`
  field is nominally `v.id(identitySource.table)`.
- **Source-table incarnation enrollment.** The `row-id` arm requires the
  identity-source table to be enrolled in the LLP 0110 incarnation registry
  (`_snapback_relation_incarnations_v1`): every insert mints one active
  incarnation in the same transaction, delete marks it inactive, and reusing an
  application id mints a new incarnation. Activation refuses until the table is
  enrolled and an existing table has one incarnation per current row through the
  same reviewed backfill LLP 0110 requires; no row is silently blessed. The
  `identity-grade-source-key` arm does not require enrollment (the grade already
  guarantees non-reuse).
- **Attributed activation — no unattributed existing rows.** Enrolling
  incarnations and passing uniqueness do **not** attribute a row's *envelope
  provenance*; §2.2's "no row is silently blessed" governs incarnation enrollment,
  not resolved-set membership. Activation of a table as `identitySource` therefore
  additionally **refuses** unless one of the following holds, checked **inside the
  one serialized, traffic-fenced activation transaction that also installs the seal
  and publishes the generation** (§2.7, "one atomic frontier"), so no ordinary write
  can slip an unattributed row between the scan and the seal going live:
  - the table is **empty** (zero rows), so every future row enters through the
    §2.7 attributed writer; or
  - **every current row exact-joins a §2.7 receipt** in the framework-owned sealed
    `_snapback_verified_source_receipts_v1` registry on `(source_table, row_id,
    incarnation)` — the durable record binding that row's complete stored match
    tuple (the discriminated `lookup.fields` values), its resolved `(_id,
    rowIncarnation)`, and its source-envelope identity/offset (§2.7) — **and** whose
    stored `receipt.match_tuple` still equals `canonical(§7.1)` of the row's
    **current** `lookup.fields` values. This match-tuple equality is required, not
    just the `(row_id, incarnation)` join: it refuses a row whose lookup columns
    **drifted** away from the attributed value after the receipt was written but
    before the table was sealed — e.g. an ordinary `UPDATE users SET email=attacker`
    during the pre-seal cutover window — so a drifted credential can never resolve a
    receipted row.
  A pre-existing ordinary table with any row that does not join a receipt, or whose
  current lookup tuple has drifted from its receipt, refuses activation with
  `SNAPBACK_AUTH_PROVISIONING_SOURCE_UNATTRIBUTED_ROWS`. This is
  the decisive close of the *declare-an-existing-table-and-look-up* path: an
  attacker who inserted `{email: victim, role: admin}` while the table was
  ordinary cannot have the app later flip that table into a source and have the
  victim's proof resolve the attacker-authored row, because that row has no
  §2.7 receipt and activation refuses. **The RQ-1 cutover IS this attributed
  import** — migrating an app's users into a custody source means running the §2.7
  import lifecycle over every row so each carries a receipt, not "add the
  `identitySource` declaration and backfill incarnations." A table that cannot be
  brought to that state (empty, or fully receipt-attributed) has no v1 provisioning
  path (§11, RQ-1). The `identity-grade-source-key` arm is bound by the same
  precondition: its existing rows must be empty or receipt-attributed, since the
  same lookup-then-bind steering applies.
- **Identity-grade source key.** `identity-grade-source-key` names a
  schema-declared immutable, never-reused identity-grade source key and its
  unique index (LLP 0226 C-3). An ordinary mutable unique field is not accepted,
  and no incarnation column is required because the grade already guarantees
  non-reuse. Until the LLP 0226 schema-owner lane emits that exact grade in the
  schema manifest, this arm fails activation; the row-id arm does not wait on it.
- **Binding-target indexes.** Every identity-binding target has a unique
  single-field index on `principalField` and a unique index on the app-identity
  columns (`appIdentityField` for a source key, or `(appIdentityField,
  appIncarnationField)` for a row-id target). Their nominal types match the
  declared resolved identity.
- **Source/binding table disjointness.** `identitySource.table` MUST NOT coincide
  with any declared `identity-binding` target table (nor with the framework
  grant-tombstone/source-receipt/canonical-key registries), so the zero-argument
  `ensure()`
  binding writer can never write the custody-sealed source table and no in-lane
  writer touches it. A coinciding table refuses generation with
  `SNAPBACK_AUTH_PROVISIONING_IDENTITY_SOURCE_INVALID`.
- **Distinct identity-kind domains per canonical-value index.** Codegen MUST NOT
  let one canonical-value unique index back two distinct identity kinds emitted
  under the same provider installation (the provider discriminator alone does not
  separate, e.g., `username` from `external`). Codegen either refuses reuse of one
  canonical-value index across distinct `identityKind` domains, or proves the
  domains disjoint (a stored, indexed kind-discriminator column inside
  `lookup.fields`); otherwise
  `SNAPBACK_AUTH_PROVISIONING_IDENTITY_SOURCE_INVALID`.
- **Resource-determined permission targets.** Every `permission-initial-grant`
  target's non-principal grant identity MUST be resource-determined (§2.1):
  `membership-open-join-self` resolves its resource from `scope: 'app'` or a
  `resourceFrom` source-row column; `permission-backing` resolves each
  non-principal conflict value from a literal or a source-row column. A target
  that would take any resource/conflict axis from hook output refuses generation
  with `SNAPBACK_AUTH_PROVISIONING_IDENTITY_SOURCE_INVALID`. In addition:
  - **Source-row axis columns are required (non-optional).** Every `resourceFrom`
    column and every `conflictValues` `source-row` `sourceField` MUST be a
    schema-declared **NOT NULL / required** column of the §2 source row. A nullable
    axis is refused generation, so a null value can never silently collapse an axis
    and make two distinct grants share one `permissionGrantKeyV1` by accident.
  - **`conflictValues` arity.** For `permission-backing`, `conflictValues.length`
    MUST equal the number of **non-principal** members of `fields` (the ordered
    conflict axes minus `principalField`); a shorter or longer `conflictValues`
    refuses generation. Each entry positionally supplies exactly one non-principal
    axis.
  This guarantees every `permissionGrantKeyV1` (§7.2) is derivable — with no
  missing or null axis — from declaration + §2 lookup before the hook runs, so
  §2.5's skip predicate is decidable in every admitted shape.

The lookup field may be a semantically mutable app attribute, such as an email
address, but under §2.6 custody it is not ordinary-writable. It is used once
under OCC, then discarded as a conversion key. The binding stores only principal
and the lifetime-safe resolved app identity.

### 2.3 Exact lookup result

Before hook evaluation, the host performs the declared equality lookup against a
captured app snapshot, using the `catalog-canonical` collation:

- **one row:** capture that row and resolve its `(_id, rowIncarnation)` or
  identity-grade source key;
- **zero rows:** refuse
  `SNAPBACK_AUTH_PROVISIONING_IDENTITY_SOURCE_NOT_FOUND`. v1 has no create arm:
  an app provisions the app row through its ordinary, custody-governed flow
  before a binding can be ensured; and
- **more than one row:** refuse
  `SNAPBACK_AUTH_PROVISIONING_IDENTITY_SOURCE_AMBIGUOUS`.

The lookup result and the zero-result predicate are captured reads. At commit
the host re-executes the same index equality predicate. A one-row result must
still be the same row, the same row incarnation, and the same resolved identity.
Any reassignment, extra match, deletion, source-key change, or row-incarnation
mismatch refuses `SNAPBACK_AUTH_PROVISIONING_STALE`. A database unique index is
a backstop, not a substitute for this predicate validation.

Because the whole source table is custody-sealed (§2.6) and its only populator is
the closed authorized migration/import writer (§2.7), the resolved row is one the
enumerated importer created and attributed to a validated envelope — not a row an
ordinary caller pre-seeded, nor an ordinary-authored row a later generic migration
stamped a match value onto. Removing `create` closes the round-2 defeat where
`onMissing:create` still bound an uninvited pre-existing match.

### 2.4 Private hook artifact

`handler` compiles to a dedicated `VerifiedProvisioningHookArtifactV1`; it is not
a free function-name string. Its module/export pair MUST resolve to exactly one
artifact in the selected graph. Codegen resolves **re-exports, aliases, and
wrapper bindings across the compiled module graph** — not by comparing
handler-name strings — and refuses if the same export, alias, wrapper, or
compiled function id is also a public query, mutation, action, HostPlan
function, nested-call target, cron target, CLI/MCP target, or general dispatch
entry.

The artifact may contain pure locally reachable helpers. Its complete reachable
graph is part of `hookArtifactDigest` and `bundleDigest`. The artifact is absent
from every ordinary function allowlist and dispatch table.

### 2.5 Repeat-event ordinary writes

A new governing event has a new completion key (§7.3) and the hook may run once
for that event. Its `identity-binding` and `permission-initial-grant` writes are
no-ops against an already-bound exact pair (§5), but `ordinary` writes are not
inherently idempotent, so repeat verification must not become an unaudited `patch`
path.

**Skip predicate.** The executor MUST **skip hook evaluation entirely** and take
the receipt/no-op path whenever the declaration's **complete deciding key set** —
every `bindingPairKeyV1` (one per identity-binding target) and every
`permissionGrantKeyV1` (one per permission-initial-grant target) — already matches
existing durable state. This set is:

- **non-empty**, because §2.1 mandates at least one identity-binding target; and
- **mechanically decidable before the hook runs**, because §2.2 forces every one
  of these keys to be derived from the declaration plus the host's §2 lookup
  result alone — never from hook output (resource/conflict axes are
  resource-determined; the binding pair is `(principal, resolved app identity,
  incarnation)`).

**Ordinary-effect suppression rule.** Ordinary writes are **not** part of the
deciding key set and never keep the hook alive on a repeat event. The rule is
categorical: **a matching deciding key set suppresses this declaration's ordinary
effects.** When the key set matches, the hook does not run and its `ordinary`
writes do not fire; when any key is absent, the hook runs once for the new
governing event and its ordinary writes fire in that single transition (§6.3).
There is no third state in which the host must run the hook merely to discover
whether an ordinary effect is "pending" — that would contradict the "not an
ordinary mutation path" guarantee, so it is excluded by construction.

**Cross-declaration consequence (stated, not hidden).** `bindingPairKeyV1`
deliberately excludes the hook declaration id and transition class (§7.2), so the
binding may have been established by a *different* declaration D1. If a first-ever
event under declaration D2 resolves a principal/app-identity pair already bound by
D1, D2's deciding key set already matches and **D2's ordinary writes are therefore
suppressed** — they do not run. This is intentional: ordinary writes in this lane
are best-effort side effects that accompany the *first establishment* of a binding
pair, not a guaranteed per-declaration mutation. An app that needs a guaranteed
per-declaration side effect MUST model it as its own binding/permission target (so
it enters the deciding key set) rather than as an `ordinary` write, or run it
through its ordinary handler flow outside this lane. The guide states this plainly
so agents do not rely on repeat-verify ordinary writes.

### 2.6 Identity-source whole-table custody seal

`identity-source-custody-v1` is a schema-declared **whole-table** seal in the
shipped identity-binding seal family. The landed
`enforce_identity_binding_write_seal(schema, table)` is table-level and consults
`identity_binding_tables`; column-level custody cannot be added without threading
a written-column set through every call site, so v1 seals the **entire identity
source table**, not a column subset. A new schema-declared set,
`identity_source_custody_tables`, is checked by exactly the same unconditional
refusal set as `identity_binding_tables`: every ordinary buffered, HostPlan,
seed, generated resource/transaction, maintained-projection rebuild, and
same-transaction projection-maintenance write to the table refuses
`SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`. Because §5.1 already forbids the hook's
`ordinary` mode on a custody table, and `ensure()` writes the binding table
rather than the source, no in-lane writer touches it either.

Whole-table (rather than column-level) sealing is the deliberate v1 simplification:
it matches the shipped seal exactly, adds no per-call-site written-column
threading, and is strictly stronger (an attacker cannot poison even a non-match
column such as `role` on the same row). The cost is that the identity source must
be a table whose *entire* content is import/migration-owned — stated as RQ-1.

**Closed, globally enumerated writer set.** The only writers admitted to populate
a custody table are those enumerated in `custody.admittedWriters` (§2.1). v1
admits exactly the **authorized migration/import lifecycle** named there. This is
a *global* property of the descriptor, not a per-write mode bit: the seal refuses
every non-enumerated writer unconditionally, and the enumerated migration/import
lifecycle is the separately governed path of §2.7 and §8.1 — never an ordinary
handler write and never the hook. The deferred creating variant (§11) would add
its own enumerated entry in a future spec. An app that cannot place its identity
source's whole table under this custody has no v1 provisioning path (§11) — the
guide says so plainly rather than steering agents back to password-register.

### 2.7 Authorized migration/import as a closed source-population writer

Because the source table is whole-table-sealed and has no `create` arm, the only
v1 populator is the authorized migration/import lifecycle. For that populator to
be a *closed custody mechanism* — not a generic bulk writer an attacker can steer
through ordinary-authored staging — it MUST satisfy all of the following, proven
by codegen/activation and enforced at import time:

- **Enumerated writer identity.** The importing lifecycle is one of the
  `custody.admittedWriters` entries, and its `lifecycle` string resolves — at
  compile/activation time — to a **host-recognized validated-import-envelope
  consumer** registered in the framework's admitted-import registry (the way
  `custody.seal` resolves to the covering table seal). It is never an arbitrary
  string, an app SQL job, or a generic bulk copy that `SELECT`s attacker staging.
  No other code path may write the table, even transiently, even under
  `Seed`/`Import`/`Admin` provenance that is not this exact enumerated lifecycle.
- **Receipt binds the complete match tuple, in a framework-owned sealed registry.**
  The import/migration receipt is **not** a row-resident column and **not** an
  app-declared table — either could be forged by an ordinary writer or skipped by a
  lifecycle. It is a durable record in a **framework-owned, always-sealed** receipt
  registry in the same `_snapback_verified_*` family as the tombstone (§5.3.1) and
  canonical-key (§7.4) registries:

  ```text
  _snapback_verified_source_receipts_v1(
    app_id TEXT, version_stream TEXT, source_table TEXT,
    row_id TEXT, incarnation TEXT,          -- resolved (_id, rowIncarnation) [row-id arm]
    identity_source_key TEXT,               -- resolved identity-grade key [source-key arm]
    match_tuple TEXT,                       -- canonical(§7.1) of the discriminated lookup.fields values
    envelope TEXT, offset INTEGER,          -- validated import-envelope identity + offset
    lifecycle TEXT, adapter_version TEXT,   -- the registered §2.7 consumer that wrote it
    integrity TEXT,                         -- LLP 0214 §4.8 integrity binding over the whole record
    created_at_ms INTEGER,
    PRIMARY KEY(app_id, version_stream, source_table, row_id, incarnation),
    UNIQUE(app_id, version_stream, source_table, row_id, incarnation),
    UNIQUE(app_id, version_stream, envelope, offset)
  )
  ```

  Its properties are:
  - **Sealed like an identity-binding table.** No ordinary handler, HostPlan, seed,
    projection, or hook write may insert, mutate, or delete a receipt row; only the
    **registered §2.7 envelope consumer** writes it, and only **in the same
    transaction** that creates/claims the row and mints its incarnation (§2.7 atomic
    create/claim). An ordinary writer therefore cannot forge a receipt for a row it
    authored, cannot mutate a row or its receipt after creation, and cannot delete
    receipt evidence — the seal refuses all three with
    `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`.
  - **Two-way uniqueness.** `UNIQUE(source_table, row_id, incarnation)` binds one
    receipt to one row lifetime, and `UNIQUE(envelope, offset)` binds one envelope
    record to one row lifetime, so a copied receipt cannot attest a second row and
    one envelope record cannot attest multiple row lifetimes (cross-row / cross-table
    replay both fail the join). Both constraints are **scoped to `(app_id,
    version_stream)`** (their leading key columns) as the deliberate v1 boundary: an
    envelope record blesses exactly one row lifetime **within its own stream**, and
    one `(envelope, offset)` cannot populate two source tables in that stream.
    Cross-stream envelope reuse (fork/restore) is out of v1 scope and is handled by
    the §7.2 version-stream re-parent path, not by this constraint.
  - **Integrity-bound.** The `integrity` column binds the whole record exactly the
    way LLP 0214 §4.8 binds import receipts, so a direct-storage tamper is detectable.
  - **The sole provenance authority.** "Prior output / same envelope provenance" in
    the atomic-create/claim rule below, and §2.2's attributed-activation scan, MUST
    consult **this registry** — never a row-resident column.
  - **Source-key arm PK sentinel (deferred-arm note).** The row-id arm always
    supplies a UUIDv7 `TEXT` `incarnation`, so the primary key is fully populated.
    When the deferred `identity-grade-source-key` arm lands (§11), its receipts have
    no incarnation; because SQLite treats `NULL` as **distinct** in a `UNIQUE`/PK
    constraint (two `NULL`s do not collide), that arm MUST populate `incarnation`
    with a **non-null sentinel** (e.g. a reserved constant keyed off
    `identity_source_key`), never SQL `NULL`, or the `(source_table, row_id,
    incarnation)` uniqueness would silently fail to prevent duplicate attestations.
- **Atomic row creation/claim.** Each row's creation-or-claim and its match-tuple
  population and incarnation mint happen in one transaction under the enumerated
  writer. A migration may not stamp a sealed match value onto a
  previously-ordinary-authored row: on an already-present `_id`, the import
  either treats the row as its own prior output (same envelope provenance) or
  refuses, so an ordinary caller cannot pre-author a row that a later migration
  promotes into the resolved set.

Without this closure the claim "an ordinary caller cannot author the resolved
row" would rest only on the migration's good behavior; §2.7 makes it a checked
property of the admitted writer. This narrows v1 applicability (RQ-1) and is
stated for the author as such.

**Activation is itself an attributed import, under one atomic frontier.** The §2.7
receipt registry is also the witness §2.2's *attributed-activation* precondition
checks: a table may be activated as an `identitySource` only when it is empty or
when every current row **exact-joins** a `_snapback_verified_source_receipts_v1`
row on `(source_table, row_id, incarnation)` **and** the row's current
`lookup.fields` still equal that receipt's stored `match_tuple` (a drifted lookup
tuple — an ordinary `UPDATE` of a receipted row during the pre-seal cutover window
— refuses, §2.2). Declaring a pre-populated ordinary
table as the source and backfilling only incarnations does not produce these
receipts and therefore refuses (`SNAPBACK_AUTH_PROVISIONING_SOURCE_UNATTRIBUTED_ROWS`).
The RQ-1 cutover of an existing app's users into a custody source **is** running
this import lifecycle over each row — not adding the declaration over ordinary
content.

The scan alone is not enough: an ordinary mutation admitted *before* the table
becomes custody-sealed could insert an unattributed attacker row *between* an
empty/all-attributed scan and the moment the source becomes live, and that row —
never attributed — would then be resolvable. Activation therefore **closes that
schedule** by performing three things under **one serialized, traffic-fenced
writer transaction / admission-epoch advance** (the same exclusive publication
fence LLP 0081 uses for schema publication and LLP 0053 for authorization
activation, and the same pattern LLP 0110 uses to activate a capability):

1. the empty-or-every-row-attributed scan, exact-joined against the receipt
   registry;
2. installation of the whole-table custody seal and the `identitySource`
   descriptor (so §2.6 sealing begins); and
3. publication of the new generation.

Predecessor writers admitted before the fence are drained; no ordinary write can be
admitted *after* the fence advances but observed as if before it. An ordinary
insert that races activation therefore either **lands before the checked snapshot**
(and must then carry a §2.7 receipt or the scan refuses the whole activation) or
**is admitted only under the successor generation** (where the table is already
sealed and the insert refuses at the seal). There is no interleaving in which an
attacker row is both present at first lookup and absent from the attributed scan.
This binds §2.2's attributed-activation precondition to LLP 0081's publication /
LLP 0053's activation obligations rather than asserting "every future row enters
through §2.7" as a bare invariant.

## 3. Sealed positive trigger

### 3.1 Private completion carrier

`VerifiedIdentityCompletion` is a private host type for genuine delivery,
federation, or declared-import proof. It does not implement `Deserialize`,
`Serialize`, a public constructor, `From<DTO>`, or a stringly builder. It
carries an unforgeable carrier token minted by the §3.2 constructor and checked
by the LLP 0058 authority; general host code cannot fabricate the token by
convention. It contains, at minimum:

```text
producer class and carrier token
consumed proof id and generation
admission state: fresh predecessor | reconciliation-only exact successor
exact transition predecessor digest
transition class
governing event id
resolved principal predecessor
provider identity/link predecessor
admitted assurance row ids and exact records
governing-authority ids and generations
auth mode generation and admission epoch
deployment posture and proof provenance
planned session/authority consequence identity
```

The carrier owns the consumed proof generation; copying its displayed fields
does not copy the authority. Its fields may be projected read-only into
`ctx.provisioning`, but that projection is not accepted back by any API.

A genuine proof consumer may create the reconciliation-only state after a lost
outcome only when the durable proof row records consumption by the exact derived
`completionKeyV1`. That state can enter §7's receipt/effect comparison but can
never evaluate the hook or apply writes. A caller cannot select the state, and
an unrelated consumed proof cannot become a retry carrier.

`RehearsalIdentityCompletion` is a second private, non-serializable type. It has
the same exact predecessor/generation discipline and its own carrier token, but
its only provenance is `rehearsal`, its posture is one of dev/test/demo, and its
constructors are exactly §3.2 items 5–7. It is not convertible into
`VerifiedIdentityCompletion`.

The transition class is this exact closed enum, not a generic
`verify | claim | import` string:

```text
EmailCodeExchange
GuestClaimEmailCode
FederationAssertionV1
DeclaredAssuranceImportV1
RehearsalEmailCodeExchange
RehearsalGuestClaimEmailCode
RehearsalAuthMintSession
```

The only function that can construct
`ResolvedAppAuthority::VerifiedProvisioning` consumes the closed sealed sum
`VerifiedIdentityCompletion | RehearsalIdentityCompletion` together with the
compiled private hook artifact and identity-source descriptor.
`VerifiedProvisioning` is added as an explicit closed LLP 0058 authority variant;
`InvocationSource::VerifiedIdentityCompletion` and
`InvocationSource::RehearsalIdentityCompletion` are explicit host-only sources.
Both pass the shared mode/epoch gate, resolve the principal projection, check
`requires`, and prepare only the private hook artifact. `System` is not used as
an implementation shortcut.

### 3.2 Exhaustive constructor set and closed producer registry

Exactly these private genuine-proof consumers may mint
`VerifiedIdentityCompletion`. They are the closed producer registry: the host
build enumerates these exact callsites, and the LLP 0058 authority refuses a
carrier token minted anywhere else.

1. **`consume_email_code_exchange_proof`.** The successful LLP 0057
   `POST /auth/exchange` consumer, after exact single-use challenge, canonical
   address, provider installation, and challenge-generation verification, joined
   into the exchange transition per §3.4. It constructs
   `VerifiedIdentityCompletion` only for a contact-ownership adapter that
   produces `delivery`; a simulation/capture adapter is routed to the separately
   named rehearsal consumer below. An app descriptor cannot relabel a capture
   adapter as `delivery` (LLP 0057 owns adapter class).
2. **`consume_guest_claim_email_code_proof`.** LLP 0214 §8.2 guest claim, after
   the same proof-generation checks plus the exact live guest-session and
   `guest_state = active` predecessor, joined into that claim transition. It is
   distinct from merely possessing an authenticated guest session. It constructs
   `VerifiedIdentityCompletion` only when the underlying adapter proves contact
   ownership.
3. **`consume_federation_assertion_v1`.** A provider-specific LLP 0151
   completion that has proved LLP 0214 §4.7's issuer, audience, subject,
   signature, nonce/state/replay, installation, and authoritative-claim rules.
   No current generic callback may construct this variant; it remains
   unavailable until its owning provider Spec lands the consumer.
4. **`consume_declared_assurance_import_v1`.** Only LLP 0214 §4.8's versioned,
   operator-authorized assurance import with a validated source envelope,
   explicit verified flag, collision analysis, immutable import receipt, and no
   imported live authority. LLP 0057's current logical `snapback auth import`
   imports stable auth data but no assurance or session and is expressly not
   this consumer.

The separate rehearsal-only constructor set has exactly three members:

5. **`consume_simulated_email_code_exchange_rehearsal`.** The successful LLP 0057
   exchange against an adapter classified `simulation`, with the same single-use
   challenge/generation checks as item 1. It produces only
   `RehearsalIdentityCompletion` outside production.
6. **`consume_simulated_guest_claim_email_code_rehearsal`.** LLP 0214 §8.2 guest
   claim when its exact consumed challenge came from a simulation adapter. It
   additionally binds the live guest predecessor and produces only
   `RehearsalIdentityCompletion` outside production.
7. **`consume_auth_mint_session_rehearsal`.** The LLP 0057/0058
   `auth.mintSession` operation after both `AdminWrite` and
   `ImpersonationCapability`, settled sessions mode, provider readiness, and a
   dev/test/demo posture. It mints `RehearsalIdentityCompletion`, never
   `VerifiedIdentityCompletion`; it is bound to the exact capability/generation
   facts and taints every resulting effect.

The constructor module is private to those consumers. Both carrier sets and the
call-site registry are exhaustive: adding a producer requires an amendment to
this Spec, a new enum case, shared-gate classification, posture/provenance
rules, a carrier-token minting site, and negative fixtures for every other
source.

### 3.3 Explicitly excluded transitions

The following do **not** construct a completion and do not fire the hook. They
are proof-free authorization inputs:

- LLP 0214 §8.1 guest creation;
- LLP 0214 §8.3 password account creation, including email-as-username
  registration;
- LLP 0214 §8.4 password authentication;
- LLP 0214 §8.5 password set;
- **password change, password reset, password recovery-code issue/consume/
  rotation**, username creation, or a local identity row's creation — each is a
  credential-management transition with no delivery/federation/import proof and
  therefore no carrier, no transition class, and no completion key;
- LLP 0057 logical auth import;
- request-code issuance before proof consumption;
- a handler, nested call, action, cron, request DTO, session bearer,
  `AdminWrite`, `System`, LLP 0055 scoped grant, CLI, MCP, or arbitrary host
  helper; and
- any function that merely validates caller-shaped principal, identity,
  assurance, event, or provider strings.

There is no "password-set is a conditional producer" arm. A future
password-register/set flow may run provisioning only if that *same atomic
operation* also consumes one of §3.2's genuine proof carriers (for example, a
composite "set password and prove email delivery in one request"). The carrier,
not the password transition or email-shaped username, is the trigger; adding
such a composite path requires the same closed-set amendment and a named
carrier-minting site.

The dormant `prepare_verified_provisioning`, `prepare_verified_email_claim`, and
equivalent caller-shaped helpers MUST be removed or replaced. They are not
promoted behind a visibility modifier and are never trusted as carrier
constructors.

### 3.4 Producer join into the LLP 0057 exchange transition

Item 1 is the only production **exchange** producer (items 2–4 are the other
production producers — guest-claim, federation, and declared-assurance import).
LLP 0057 today runs `POST /auth/exchange`'s lookup, HMAC verification, attempt
accounting, challenge consumption, identity provisioning, session-cap
enforcement, and session insertion in **one `IMMEDIATE` transaction**, holding
the per-address stripe from the pre-transaction lookup through post-commit mailbox
erase (LLP 0057 §"Challenge states and exchange"; lock order
maintenance → address stripe → keyring → SQLite writer → mailbox). This Spec
amends that path completely rather than leaving the wiring to implementer
inference. The two naive wirings are both forbidden:

- running the restricted JS hook while the exchange holds the SQLite **writer**
  lock revives the LLP 0003 violation; and
- committing the exchange (principal, consumed challenge, session) first and then
  running the hook leaves a live bearer/identity without its required binding,
  with the proof already consumed and unrollbackable — violating invariant 5.

**Attempt accounting is unchanged for wrong/locked codes.** An unknown, expired,
consumed, superseded, wrong, or locked code follows LLP 0057's existing contract
untouched, and it **preserves LLP 0057's distinction between incrementing and
classifying**: only an **active, incorrect** submission against an `Active`
challenge increments `attempts` (and locks at `5`); an already-locked, expired,
consumed, superseded, or unknown outcome commits a **no-op classification** — it
records the diagnostic outcome without incrementing the counter, so it can neither
burn nor extend the lock on a valid code. Either way the path commits as its own
transaction and returns `SNAPBACK_AUTH_CODE_INVALID` / `SNAPBACK_AUTH_CODE_LOCKED`
**without constructing a completion, preparing the hook, or running any JS**. The
hook lane is reached only after HMAC verification succeeds on an `Active`
challenge.

The amended successful-exchange path follows §6:

1. Under the LLP 0057 per-address stripe, the exchange performs its read-planned
   challenge lookup and HMAC verification. On HMAC success against an `Active`
   challenge it constructs the sealed `VerifiedIdentityCompletion` **without yet
   consuming the challenge, incrementing the success-path attempt counter, or
   minting a session**. The success-path attempt increment is deferred into the
   one transition commit (step 5) so a HMAC-correct code whose transition later
   refuses (`IDENTITY_SOURCE_NOT_FOUND`, `STALE`, hook error) burns **nothing** —
   it does not lock a valid code.
2. The host prepares the hook, performs the §2 custody-sealed lookup, and
   evaluates the hook against captured snapshots **outside the SQLite writer,
   keyring, projection, room, and sender locks** (§6.1). The two earlier LLP 0057
   guards — the **shared maintenance admission** and the **per-address stripe**
   (both bounded coordination locks, neither the global writer) — are **held
   through this window**: from HMAC verification through JS evaluation and room
   quiescence, so a concurrent `request-code` cannot supersede or re-mint the
   challenge mid-evaluation. Neither is dropped and reacquired *while the other is
   still held* during this window. LLP 0003 is satisfied because no SQLite writer
   lock is held while JS runs. The shared-maintenance hold across the hook is
   bounded by the hook's wall-clock deadline (`workerd_exec::wall_clock_timeout_ms`,
   the same finite budget every restricted-VM hook runs under, §4.1); an unbounded
   hook under the fair maintenance gate would be an availability incident, not a
   soundness hole (§6.1).
3. The pre-SQLite protected-room interlock is reserved and quiesced (§6.2), still
   under the held maintenance admission and stripe.
4. After hook settlement and room quiescence the host **drops both** the shared
   maintenance admission and the per-address stripe. This is the shipped, sound
   composition — not "hold both across the commit," which is unsatisfiable against
   LLP 0059. Shipped exchange issuance performs the LLP 0059 projection `Begin` /
   cap-eviction drain **before** its SQLite commit (`AuthCoordinator::premark_issuance`:
   topology lock, `begin_issuance`, the cap-eviction `begin_session_mutation`, then
   `drain.wait()` — `src/auth/coordinator.rs`, `src/auth/provider.rs`), and LLP
   0057 requires every provider/projection guard dropped before that `Begin` and
   forbids holding a projection guard while holding a provider lock. So the host,
   guards released, performs that `Begin` / cap-eviction drain here, keeping LLP
   0059 authoritative (Begin-before-commit for session issuance and cap eviction);
   the `Begin` is **never skipped** (skipping it would leave an evicted session
   projection-live through JS, room, and commit — a 0059 violation) and **never
   straddled** by a retained maintenance/stripe/projection guard. It then takes
   **one fresh, non-nested shared maintenance admission** and acquires, in LLP 0057
   lock order, **the keyring, then the SQLite writer**, and begins the one
   transition commit. This fresh admission is explicitly **not** the nested
   reacquire that deadlocks the fair maintenance gate: because the planning guard
   was dropped first, no thread holds a shared admission while blocking for a
   second one (the fair-RwLock deadlock came only from *nested* reacquire while
   retaining the planning guard, never from drop-both-then-fresh — the same pattern
   LLP 0057 already uses for password planning). The per-address stripe is
   deliberately **not** reacquired; the brief window between dropping it and the
   commit is unlocked, and step 5's full challenge recheck is the safety net for
   that gap. The transition commit's same-transaction projection maintenance
   (`maintain_projections_in_tx`) is LLP 0080 same-tx maintenance, not a 0059
   `Begin`, and is unaffected.
5. That one transition commit **rechecks the full challenge predicate**
   (`unconsumed`, `unsuperseded`, `unlocked`, `unexpired`, and the same challenge
   generation). This recheck is the safety net for the unlocked gap in step 4: a
   `request-code` that supersedes or re-mints the challenge after the stripe is
   dropped makes the commit `SNAPBACK_AUTH_PROVISIONING_STALE` — it **consumes
   nothing, binds nothing, mints no session**, and the re-minted challenge is the
   only live one. Only on a clean recheck does the commit apply the success-path
   attempt increment, challenge consumption, identity/session/cap effects, and the
   buffered provisioning writes, and finalize the reservation — all together, or
   all rolled back (§6.3). **Any `STALE` or hook refusal *after* the step-4
   `premark_issuance` MUST roll back that issuance premark** — `finish_issuance`
   with the compensating `compare_unmark_issuance` (and its session/stream
   counterparts), `src/auth/coordinator.rs`, `src/auth/session_projection.rs` — so
   the cap-eviction premark and topology reservation are released rather than
   stranded; aborting only the SQLite transaction is insufficient because the 0059
   `Begin` ran outside it. The shipped post-commit mailbox erase, which LLP 0057
   runs under the stripe, is performed after this commit under a **fresh
   non-nested** per-address stripe admission (the challenge is already consumed, so
   a concurrent `request-code` after commit simply mints a new-generation
   challenge); it is never held across the LLP 0059 `Begin`.

The existing candidate-collision / stale-predecessor retry loop in the exchange
MUST NOT silently re-evaluate the hook: a retry re-derives durable predecessor
facts and either re-enters step 4's commit against the **already-settled** buffer
or fails closed. The arbitrary JS hook is evaluated exactly once per governing
event (§2.5, §7.3); a retry never re-runs it.

The same prepare/buffer/one-commit shape governs item 2's guest-claim transition,
with one addition: LLP 0214 §8.2 step 10 **always** advances the LLP 0053
authorization version, so the guest-claim producer is inherently an authorization
event even when the hook buffer contains only an `ensure()`. The §6.2
authorization-impact preview therefore MUST include that producer-inherent LLP
0053 advance, not just the hook's permission writes, so the reservation is never
empty when the shipped interlock requires one (§6.2). An implementation MUST NOT
retain the legacy single-`IMMEDIATE` exchange when a provisioning hook is declared
for the applicable provider; where no hook is declared, the exchange's existing
behavior is unchanged except that challenge consumption and session insertion
continue to share one commit.

### 3.5 Production `auth.mintSession` refusal

The operation registry keeps `auth.mintSession` at `NonProd`. Under `prod`, the
operation refuses `SNAPBACK_PROFILE_FORBIDS` before provider planning, identity
creation, session minting, hook admission, or receipt creation. This is an
operation-level prohibition, not merely a later rejection of rehearsal by the
hook. In admitted non-production profiles, missing either operator capability
refuses before the rehearsal consumer runs.

## 4. Hook authority, context, and lifetime

### 4.1 Prepared authority and context

The LLP 0058 shared gate prepares a `VerifiedProvisioning` authority containing
the carrier token, declaration/artifact identities, normalized `requires`, and
an unforgeable transaction-join token. It projects read-only `ctx.auth` for the
resolved principal and read-only `ctx.provisioning` for proof/audit facts. It
does not grant arbitrary `System`, admin, impersonation, service-principal, or
scoped-grant authority.

The private artifact receives:

- captured `ctx.db` reads limited to declared tables;
- the distinct provisioning writer described below;
- deterministic, invocation-bound `ctx.runtime.now()` and `ctx.runtime.id()`;
  and
- no action, fetch, secret, job, cron, arbitrary function call, deferred work,
  public dispatch, or egress surface.

`ctx.db` writes are buffered. The hook does not receive a SQLite transaction or
hold the writer lock.

### 4.2 A distinct, non-ambient writer

The provisioning writer is a distinct host type and host-op namespace. Every
provisioning host call is dispatched only through the existing epoch-prefixed
`__hostCall` path (the `epoch|op` entry that `snapback_host_call` /
`dispatch_host_call` already gate); no native-method ABI that skips that entry
is added. It is created only inside the prepared hook context. No request or JS
operation may pass `mode: 'verified-provisioning'`, a brand bit, a claims
object, an authority enum tag, or a transaction id to convert an ordinary
writer.

Every provisioning host call obtains its mode from non-serializable host state
and verifies all of:

- the exact live hook invocation and process-monotonic invocation epoch;
- the prepared `VerifiedProvisioning` authority variant and carrier token;
- the transaction-join token and unsettled buffered transition;
- the hook artifact and complete bundle digest; and
- the declaration entry for the specific generated method.

There is no ambient thread-local "provisioning enabled" flag that another
writer, projection, helper, cleanup path, or nested call can inherit.

### 4.3 Stale-continuation fence

The writer follows LLP 0009's existing DK-4 invocation-identity fence. A stashed
`ctx.db`, generated method, bound method, or closure retains its originating
epoch. It is valid only during the live hook invocation and against that
invocation's unsettled buffer/transition token. After settlement, rollback,
commit, timeout, epoch retirement, or context replacement it is inert; a later
call refuses `SNAPBACK_HANDLER_STALE_CONTINUATION` before touching a current
context.

This is the existing cross-invocation mechanism, not a second lifetime system.
The provisioning writer adds the transaction-token and artifact checks within
the live invocation; it does not weaken or replace the epoch fence.

## 5. Writer modes

Mode is declaration-derived and must match the table's class. A mismatch is a
generation error and a runtime backstop refusal
`SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN`.

### 5.1 `ordinary`

`ordinary` may target only a table that is none of:

- a declared identity-binding target;
- a whole-table-sealed identity-source custody table (§2.6);
- a `.membership()` table;
- a legacy `permissionBacking()` table;
- the framework grant-tombstone (§5.3.1), source-receipt (§2.7), or canonical-key
  (§7.4) registries; or
- another framework-protected authorization table.

It uses ordinary captured reads and buffered operations within the declared
write set. It gains no binding or membership authority from being in the same
hook. Attempting `ordinary` on one of the protected classes refuses; the mode
cannot be selected at runtime. Per §2.5, a repeat event with an already-matching
binding/permission state does not re-run the hook, so `ordinary` writes are not
an unaudited per-verify mutation path.

### 5.2 `identity-binding`

The generated identity-binding surface exposes one operation per target:

```ts
ctx.db.identityBinding.<target>.ensure()
```

It takes no row payload. In particular, it has no `principalField`,
`appIdentityField`, `appIncarnationField`, `sourceUserID`, provider claim, `_id`,
patch, delete, delete-where, bulk, predicate, or conflict-target argument. The
host constructs the row from the prepared principal and §2's resolved app
identity **and captured row incarnation**.

Every declared identity-binding target is required output: a successfully
settled hook buffer contains exactly one `ensure()` marker for each target. Zero
markers or duplicate markers refuse the whole transition before commit. A hook
cannot succeed while silently omitting the binding its declaration promised.

Runtime permits exactly:

1. **insert** the host-constructed `(principal, appIdentity, incarnation)` row
   when neither unique side exists; or
2. **exact-triple no-op** when the same principal is already bound to the same
   resolved app identity **at the same row incarnation** and the existing
   normalized binding row has no incompatible non-framework value.

It refuses:

- principal bound to another app identity;
- app identity bound to another principal;
- a matching `(principal, appIdentity)` whose stored incarnation differs from the
  captured one (the app row was deleted and recreated) —
  `SNAPBACK_AUTH_BINDING_CONFLICT`, never a silent retarget;
- a same-pair row whose non-framework binding values differ;
- patch, update, replace, delete, delete-where, bulk, insert-each, owner
  transfer, or modification of any unrelated binding; and
- any attempt to provide a host-owned field.

Conflicts return `SNAPBACK_AUTH_BINDING_CONFLICT`; a forbidden operation returns
`SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN`.

Codegen omits all host-injected fields (principal, app identity, incarnation)
from hook insert types, and the zero-argument `ensure()` surface prevents the
"third-column bindMe" shape. An identity-binding table may contain only the two
declared mapping fields, the framework-owned incarnation field, plus other
framework-owned/defaulted metadata; another required app-supplied field or a
second app-row/source-key axis makes the descriptor invalid. **No provider claim
is copied into this row, and no claim-derived value may be a unique or indexed
column** on the binding table — a claim-shaped unique column would re-introduce
the LLP 0226 C-6 credential key through the back door.

Per LLP 0226 M-2, an attempted host-owned field is refused with
`SNAPBACK_AUTH_PROVISIONING_FIELD_FORBIDDEN`. There is no "host value wins" or
silent replacement behavior.

### 5.3 `permission-initial-grant`

Generic hand-written `permissionBacking()` tables (LLP 0053) and `.membership()`
tables (LLP 0056) are **not** the same object, and this Spec splits them into two
distinct writer paths selected by the declaration's `target`. Neither path seals
or replaces the ordinary authorized lifecycle: existing authorized membership
writers, enumerated operator lifecycle operations, import/reset, and migrations
retain their governing contracts. The provisioning hook adds only a narrow,
closed initial-grant producer.

Common rules for both `target` kinds:

- The generated payload omits `principalField`; the host injects the completion's
  principal and rejects any dynamic attempt to provide it with
  `SNAPBACK_AUTH_PROVISIONING_FIELD_FORBIDDEN`.
- No hook write may grant a caller-selected other principal;
  `SNAPBACK_AUTH_PROVISIONING_CROSS_PRINCIPAL` is the backstop.
- The **framework-protected grant-tombstone registry** (§5.3.1) is consulted
  before any insert. If a durable tombstone exists for the grant identity, the
  writer refuses `SNAPBACK_AUTH_PROVISIONING_PERMISSION_CONFLICT` rather than
  reviving it. "Upsert but never revive" is enforced by that framework-owned
  registry, not by an app-declared table (which a lifecycle could skip and an
  attacker could forge) and not by uniqueness alone (uniqueness sees absence
  after a delete).
- The constrained upsert is: no active key row and no tombstone → insert one
  active grant for the host principal; exact active key row with exactly the same
  role/authority-bearing values → no-op; any different, pending, revoked,
  expired, tombstoned, replaced, or differently scoped predecessor → refuse
  `SNAPBACK_AUTH_PROVISIONING_PERMISSION_CONFLICT`.
- Reactivation, role change, owner transfer, raw delete, and revocation use the
  ordinary authorized lifecycle, not this hook.

#### 5.3.1 Framework-protected grant-tombstone registry

The no-revival witness is a **framework-owned, sealed** registry, not the
round-3 app-declared `tombstone` table:

```text
_snapback_verified_grant_tombstones_v1(
  app_id TEXT, version_stream TEXT, grant_identity TEXT,
  tombstoned_at_ms INTEGER, cause_class TEXT,
  PRIMARY KEY(app_id, version_stream, grant_identity)
)
```

- `grant_identity` is the canonical encoding (§7.1) of the complete grant
  identity: the permission-backing table + conflict tuple values, or the
  membership table + resource + role + effective principal. The declaration's
  `grantIdentity` (§2.1) only names how a grant maps into this key; the registry
  and its key are framework-owned.
- The registry is sealed exactly like an identity-binding table: no ordinary
  handler, HostPlan, seed, projection, or hook write may insert, delete, or edit
  a tombstone row. An attacker can therefore neither forge a tombstone to deny a
  victim nor delete a real one to force a revive.
- **Every grant-ending path updates it transactionally.** LLP 0056 `remove` /
  `removeSelf`, generic `permissionBacking()` revoke/delete, expiry, replacement,
  reset, and authorized import/migration MUST, in the same transaction that ends
  or supersedes a grant that this lane could re-produce, write (or deliberately
  transform) the matching tombstone row. LLP 0053/0056 are amended to make this
  update part of the one authorization commit hook for those transitions, so a
  removal cannot leave the grant reproducible with no tombstone. A grant-ending
  path that cannot name the tombstone key fails closed rather than deleting
  silently.
- A future authorized "genuinely re-admit this principal" operation clears the
  tombstone through the ordinary lifecycle; the provisioning hook never clears
  it.

**`target: 'permission-backing'`** names an exact unique index on a legacy
`permissionBacking()` table. Its ordered fields MUST include `principalField` and
every field that distinguishes one grant, and MUST NOT include event id, proof
id, assurance id, timestamp, receipt id, or another per-completion value. Every
non-principal conflict value is **resource-determined** via the declaration's
`conflictValues` (§2.1): each is a declaration literal or a value resolved from
the §2 source row, never hook payload; codegen refuses a conflict axis bound to
hook output. `permissionGrantKeyV1` is therefore derivable from declaration + §2
lookup before the hook runs. This path never touches the LLP 0056 membership
machinery.

**`target: 'membership-open-join-self'`** is issued under a **new, closed LLP
0056 writer class**, `MembershipWriter::VerifiedProvisioningInitialGrant`:

```text
MembershipWriter::VerifiedProvisioningInitialGrant {
  effective_principal,   // the completion principal; never caller-selected
  hook_id,
  completion_key,
  assurance_set_digest,
  grant_identity,        // key into the framework-owned tombstone registry
}
```

Its semantics are fixed, and LLP 0056 is amended to define them:

- It is **not** `is_privileged_noninvocation` (not `Seed`/`Import`/`Admin`) and
  **not** `System`. It does not gain the privileged-writer bypass of the LLP 0056
  transition matrix, and it does not inherit `AdminBypass`/`Admin` power. Only the
  distinct generated permission method may map a live
  `ResolvedAppAuthority::VerifiedProvisioning` to this class; general
  `ctx.membership` methods, ordinary buffered writes, and
  `MembershipWriter::from_resolved` never acquire it by ambient mapping.
- **No bootstrap.** It drives **only** a `by: ["none"], target: "self"`
  open-join onto a role the target declaration does not model as
  `lastHolder`-protected, owner, or `bootstrapRole`. It never spends, fakes, or
  substitutes for LLP 0056's creation-bound **bootstrap witness**. LLP 0056 mints
  bootstrap capability only when *this* mutation inserted *that* resource; "no
  membership row exists yet" (an imported orphan, an emptied resource, or an
  app-global singleton with no creation event) is exactly the condition LLP 0056
  rejects as a bootstrap predicate — so seating an owner on an empty/orphaned
  roster is out of this class entirely. First-owner and app-global seating remain
  LLP 0056's privileged non-invocation writers (seed, admin edits,
  `--as-membership`), unchanged.
- **Resource-determined, never hook-selected.** The resource the principal joins
  is fixed by the declaration's `resource` (§2.1): `scope: 'app'` is the app-global
  singleton (LLP 0056 §1299 — no creation witness, no privileged-first-holder
  seating, encoded in the type so codegen never emits first-holder seating for the
  non-`app` case either), and `scope: 'resource'` resolves the resource id from a
  host-owned `resourceFrom` column of the §2 source row. The hook cannot select or
  supply the resource. Because the resource, role, and effective principal are all
  declaration- or lookup-determined, `permissionGrantKeyV1` is fully derivable
  before the hook runs (§7.2), which is what makes §2.5's skip predicate decidable
  in this shape.
- Because the only transition is an open self-join onto a non-protected role, the
  completion principal is always the effective principal and the grant is only
  for that principal; it can never mint a second owner, seat a first owner,
  transfer ownership, or grant a protected role. A declaration whose named role
  is `lastHolder`-protected, owner, or a `bootstrapRole`, or whose `scope` would
  require seating a privileged first holder, is a manifest error.
- Consent: the class carries no `authority_creating_consent` toward a third
  party; it can create authority only for the completion principal itself.
- Its sealed `ProvisioningAuthorityProvenance` (hook id, completion key,
  assurance-set digest) is appended to membership provenance and the protected
  audit/commit record; it explains the initial grant and grants no independent
  authority.

A later verification event therefore cannot create a duplicate, revive a
tombstoned grant, or escalate ownership. Both `target` kinds hand their admitted
effect to LLP 0053's **single transactional authorization commit hook** (the "one
commit hook used by every writer"), not a raw row insert plus manual epoch bump.
In the same app commit it receives:

- the normal app commit version and changed-row journal;
- `permissionBacking`/`permissionFields` or `.membership()` classification;
- the central authorization-version cause and durable version transition;
- the ordinary authorization hook and post-commit live/retained obligations;
- the pre-commit publication barriers; and
- the dependency-indexed protected-room pending barriers, quiescence, committed
  generation finalization, and reauthorization installed in §6.2.

The provisioning executor cannot call a lower-level raw insert that bypasses that
composition.

### 5.4 Read-side incarnation-checking binding resolver

Storing `(_id, rowIncarnation)` closes the *write*-side retarget (§5.2), but a
consumer that later resolves `principal → binding → app row` by a bare `_id` read
would still reach a recreated row before any later `ensure()` detects the drift.
The shipped guide resolver does exactly that: it reads `ctx.db.get('user',
binding.userID)` and compares an application string, not the incarnation
(`guide/auth/app-identity-binding.md`). This Spec therefore requires a
**generated/central binding resolver** as the only sanctioned steady-state path:

- On every `principal → binding → app row` resolution, the resolver reads the
  binding's stored `(appIdentityField, appIncarnationField)` and **joins the
  stored incarnation against the current active incarnation** in
  `_snapback_relation_incarnations_v1` for `(identitySource.table, _id)`.
- If the row is absent or its active incarnation differs from the stored one, the
  resolver returns a typed **dangling/conflict** result
  (`SNAPBACK_AUTH_BINDING_DANGLING`) — it never returns the recreated row. This
  is the fail-closed dangling outcome LLP 0226 M-3 already permits.
- This resolver is the **only sanctioned/host-mediated** protected resolution;
  the guide teaches only it, and every generated/host-mediated protected read
  joins on it. A hand-written `ctx.db.get(identitySource.table, binding.userID)`
  in app-trust-domain code remains **expressible** and would return the recreated
  row — exactly as app code can omit any authorization check. That is
  **nonconforming code the guide reteaches off**, not a runtime-impossible state:
  the mechanical guarantee is over the sanctioned path, not over every bare read a
  nonconforming author could write. Invariant 6 is scoped to the sanctioned path
  accordingly.
- Recovery from a dangling binding (delete/recreate of the resolved `_id`) is an
  authorized re-provision or an operator lifecycle action, not a silent retarget;
  §11 notes this liveness cost.

The `identity-grade-source-key` arm needs no incarnation join (the grade
guarantees non-reuse), so its resolver compares the immutable source key
directly.

## 6. Buffered execution and one transition commit

### 6.1 Prepare and evaluate outside the writer lock

The real algorithm is:

1. A §3.2 completion consumer validates the expensive/external proof or exact
   rehearsal predecessor, captures its durable predecessor and generation, mints
   the carrier token, and constructs the appropriate sealed completion. It does
   not yet publish authority or irreversibly consume the proof/rehearsal
   predecessor (for the exchange producer, the challenge is not yet consumed,
   §3.4).
2. The host selects and digests the private hook artifact and declaration,
   resolves the principal predecessor, evaluates current assurances and
   `requires`, performs §2's custody-sealed identity-source lookup, and opens
   captured app/auth snapshots.
3. The host derives `completionKeyV1` and checks for an existing receipt. An
   exact receipt plus its exact durable effect set returns `AlreadyCommitted`
   without evaluating the hook; a same-key mismatch refuses. If every
   `bindingPairKeyV1`/`permissionGrantKeyV1` already matches, the hook is not
   evaluated (§2.5). **"No other effect is pending" is defined structurally, not by
   running the hook to find out:** the only effects this lane produces are the
   deciding-key effects (bindings + permission grants), plus the producer's own
   unavoidable proof/session/receipt transition and any declared `ordinary` writes.
   The deciding keys are covered by the match above; the `ordinary` writes are
   **categorically suppressed** by a matching deciding set (§2.5), so they are never
   a reason to keep the hook alive; and the producer's proof/session/receipt
   transition is host-constructed, not hook-authored. There is therefore no third
   "an ordinary effect might be pending" state that forces JS. On the skip path the
   host constructs the **host-derived no-op buffer** (zero binding inserts, zero
   grant inserts, no `ordinary` writes) and a **new `completionKeyV1` receipt for
   this governing event WITHOUT evaluating any JS**, then proceeds to the one
   transition commit. Only receipt absence with a **fresh** carrier and at least
   one absent deciding key proceeds to hook evaluation. A reconciliation-only
   carrier with no exact receipt/effect set fails closed.
4. The restricted JS hook runs to settlement against those snapshots. Reads,
   empty results, predicates, identity-source lookup, deterministic ids/time, and
   authorization facts join the captured read set. Writes remain in a
   transition-owned buffer. No SQLite writer lock is held while JS or its
   microtasks run.
5. From the settled buffer, the host computes identity-binding triple keys,
   permission conflict keys and framework-tombstone-registry lookups (§5.3.1),
   permission classifications, affected protected-room dependencies **plus any
   producer-inherent LLP 0053 advance** (e.g. the guest-claim §8.2 step 10 bump,
   §3.4), the exact planned-write digest, and the notification intent row.

This follows LLP 0003's buffered-writes-outside-lock boundary. No keyring,
projection, SQLite **writer**, protected-room registry, or sender lock is held
across hook evaluation. The exceptions are the two earlier LLP 0057 guards for the
exchange/guest-claim producers — the **shared maintenance admission** and the
**per-address stripe** — both bounded coordination locks (not the global writer),
held from HMAC through JS and room quiescence in LLP 0057 lock order so a
concurrent `request-code` cannot supersede the challenge mid-evaluation. After
quiescence **both are dropped**; the host then performs the LLP 0059 projection
`Begin` / cap-eviction drain (`premark_issuance`) with no guard retained across it,
takes **one fresh, non-nested shared maintenance admission** (never the nested
reacquire that deadlocks the fair gate — the planning guard was already released),
and acquires the keyring and then the SQLite writer in that order (§3.4). The
per-address stripe is not reacquired; the unlocked gap before the commit is
covered by the §6.3 full challenge recheck (`unconsumed`/`unsuperseded`/`unlocked`/
`unexpired`/generation), so a re-mint in the gap fails the commit `STALE` and binds
nothing. Neither maintenance nor any projection guard is held across the LLP 0059
`Begin`, keeping LLP 0059 authoritative. The shared-maintenance hold across the
hook is bounded by the hook's wall-clock deadline
(`workerd_exec::wall_clock_timeout_ms`); an unbounded hook under the fair
maintenance gate would stall new shared admissions — an availability incident, not
a soundness hole. LLP 0003 concerns the SQLite writer lock, which is never held
while JS runs. Exact proof generations and level-triggered barrier tickets preserve
the remaining predecessors without extending any global lock across JavaScript.

**Concurrent double-evaluation is safe.** Two concurrent requests for the same
governing event may each speculatively evaluate the pure hook against captured
snapshots, but at most one can commit: the single transition commit consumes the
one-time proof/challenge and the completion key, so the loser's commit-time
revalidation (§6.3) fails closed. Because the hook has no egress, deferred work,
or external side effect (§4.1), a discarded speculative evaluation leaves no
observable trace. This is the same at-most-one-session property LLP 0057 already
relies on for concurrent exchanges.

### 6.2 Pre-SQLite protected-room interlock

LLP 0053/0056 require a protected-room reservation to be installed and quiesced
**before** entering Local/SQLite; the shipped interlock carries an **unbound**
`AuthorizationCommitReservation` into SQLite and refuses at commit unless it is
`bind()`-bound to the exact impact — `bind()` returns the `PreparedAuthorizationCommit`
(`src/storage.rs`, the `AuthorizationCommitInterlock` /
`AuthorizationCommitReservation` contract; the shipped `bind()` also refuses an
impact the reserved selector does not `covers()`). Routing effects through the
central commit hook does not by itself install that reservation, and preparing it
*after* opening SQLite would hold the writer lane across a room wait. This Spec
therefore adds an explicit phase between §6.1 settlement and §6.3 commit:

1. Derive a **conservative authorization-impact preview**. It reuses the existing
   mutation authorization-impact preflight
   (`app_writes_are_authorization_event` / `AuthorizationCommitPreflight`), not a
   homemade "tables the grant may touch," and it MUST additionally include every
   **producer-inherent** LLP 0053 advance for this transition — notably the
   guest-claim §8.2 step 10 bump even when the hook buffer holds only an
   `ensure()` — over-approximated so the reservation covers at least the real
   change set. A binding-only exchange with no producer-inherent advance and no
   permission write is authorization-neutral and reserves nothing; the shipped
   `NoAuthorizationEventReservation` then correctly refuses if an event
   nonetheless appears. (Exchange identity/session writes are auth-catalog, not
   app permission-backing, and do not need this reservation.)
2. Install the `RoomAuthorityPending` dependency tickets and room barriers for
   that preview and wait until every targeted barrier reports quiescent. If
   targeting, ticket/barrier installation, or quiescence cannot be established,
   the transition refuses before any durable write — no writer lane is held
   during the wait. **Quiescence is level-triggered barrier-ticket waiting, not a
   fresh lock acquisition:** no quiescence-completion path may itself require a
   *new* shared maintenance/stripe admission while this transition still holds one,
   so a fair maintenance gate with a queued exclusive waiter cannot turn the held
   reader into a self-deadlock. This is bounded by the same finite quiescence/
   wall-clock deadline; on expiry the transition fails closed rather than blocking
   (a liveness/availability bound, not a soundness gap). Acceptance proves no
   quiescence-completion path needs a fresh admission (item 17).
3. Only then — for the exchange/guest-claim producers, after **dropping** the
   held maintenance admission and per-address stripe, performing the LLP 0059
   `Begin` / cap-eviction drain with no guard held across it, and taking **one
   fresh non-nested** shared maintenance admission then the keyring (§3.4 step 4) —
   acquire the writer and begin the one transition commit (§6.3). The reservation
   carried in is **unbound**; the executor calls the interlock's `bind()` with the
   exact final impact, receiving the prepared commit.
4. On commit, finalize the prepared commit to the committed app/authorization
   versions; on refusal/rollback, `cancel()` the unbound reservation; on an
   ambiguous durable outcome, retain it closed until §7.5 reconciliation proves
   commit or rollback.

### 6.3 Commit-time revalidation and joined application

The host acquires the writer once and begins the **one transition commit**.
Before applying any effect it rechecks, in that transaction:

- the consumed proof id, generation, unused state, and exact transition
  predecessor digest (and, for the exchange producer, the **full challenge
  predicate**: unconsumed, unsuperseded, unlocked, unexpired, same generation —
  §3.4);
- principal existence/state and the expected provider-identity link predecessor
  or exact compatible link;
- every hook row read, point read, query/predicate read, empty-result read, and
  the full identity-source equality predicate;
- the same resolved app row, `(_id, rowIncarnation)`, and identity-grade source
  key;
- the current hook artifact, bundle, schema, auth-program, and
  authorization-metadata digests;
- LLP 0058 durable mode generation, admission epoch, deployment posture, and
  prepared invocation currentness;
- each assurance row, exact assurance set, effective expiry, revocation,
  identity/credential/session liveness, governing-authority liveness and
  generation, provenance admissibility, and normalized `requires` result;
- identity-binding unique-side state and exact-triple (incarnation) compatibility;
- every permission conflict key, framework grant-tombstone-registry state
  (§5.3.1), membership predecessor, permission classification,
  authorization-version predecessor, and the reserved LLP 0053 selector via
  `bind()`; and
- receipt absence or the exact receipt comparison in §7.

Any mismatch refuses `SNAPBACK_AUTH_PROVISIONING_STALE`, rolls back all durable
effects, and cancels the reservation. A same-key receipt mismatch retains §7's
more specific replay diagnostic. The handler is not silently retried against
changed facts.

The executor has the conceptual shape:

```text
apply_verified_provisioning_on(
  &mut TransitionCommit,
  VerifiedIdentityCompletion | RehearsalIdentityCompletion,
  SettledProvisioningBuffer,
  Box<dyn AuthorizationCommitReservation>,   // UNBOUND; bind() returns the prepared commit
)
```

It accepts an already-open, transition-owned commit capability and the **unbound**
reservation, and calls `bind()` on it (with the exact `AuthorizationCommitImpact`)
to obtain the `PreparedAuthorizationCommit`. It has no database handle from which
to begin, commit, or nest a transaction. The dormant standalone executor that
opens its own transaction MUST be replaced, not called from this function.

After all rechecks, this one commit applies:

- proof/challenge consumption and principal/identity/assurance transitions;
- ordinary, identity-binding, and permission-initial-grant app writes;
- app commit version and change journal;
- LLP 0053 authorization version and protected-room/invalidation durable cause,
  bound to the reservation;
- security-journal and protected provisioning-provenance facts;
- the provisioning receipt;
- the configured notification **intent row**; and
- session creation/rotation/revocation and authority consequences.

They commit or roll back together. The resulting bearer/authority is not released
before commit and required post-commit barriers. Notification delivery dispatch
begins only after the intent row commits; dispatch is never inside the
transaction.

After commit, LLP 0053 finalizes the reservation and exact barrier tickets to the
committed app and authorization versions, projects live/retained obligations,
reauthorizes protected rooms, and only then releases publication according to its
existing contract. An ambiguous durable result keeps the exact barriers closed
until §7.5 reconciliation proves commit or rollback.

## 7. Versioned idempotency and reconciliation

One key cannot serve both "same completion" and "same app binding" because a new
proof event is a new completion but may resolve the same durable pair. This Spec
therefore separates a **per-completion receipt** (idempotency by governing event)
from the **durable canonical binding state** (event-independent), with defined
target cardinality.

### 7.1 Canonical encoding

All key inputs use a closed canonical encoding:

```text
text := u32be(UTF-8 byte length) || UTF-8 bytes
bytes := u32be(byte length) || bytes
u64 := eight-byte unsigned big-endian
list := u32be(item count) || canonically encoded items
option := 0x00 for absent | 0x01 || encoded item for present
```

Set-valued ids are bytewise sorted before list encoding. No JSON
stringification, locale order, optional-field omission ambiguity, or
caller-supplied preimage is admitted. The public representation is unpadded
base64url of SHA-256. The literal domain tag is the first encoded field.
Application identity values use LLP 0211's versioned, type-tagged canonical
stored-value encoding; a string, nominal row id, and another future source-key
type can never share preimage bytes. A row incarnation is LLP 0110's canonical
**UUIDv7 `TEXT`** and is encoded with the `text` rule above (never a `u64`
truncation or hash, which would collide two distinct lifetimes onto one key).

### 7.2 Stable binding-pair key and target cardinality

```text
bindingPairKeyV1 = SHA-256(canonical(
  "snapback.verified-provisioning.binding-pair.v1",
  app id,
  version stream identity,
  binding table, appIdentityField identity, appIncarnationField identity,
  principal id,
  resolved app-identity namespace,
  resolved app table,
  resolved app identity value,
  row incarnation           // UUIDv7 TEXT; always present for the row-id arm
))
```

This key contains no provider claim, provider identity, proof, assurance,
governing event, event id, hook declaration id, transition class, hook digest,
bundle digest, or `provisioningKey`. It is one key **per binding target per
resolved pair**. Therefore a later genuine verification that resolves the same
principal and app identity (at the same incarnation) recognizes the existing
exact pair and takes §5.2's no-op path, regardless of which hook declaration or
transition class produced it. The two unique indexes remain the structural
backstop.

**Target cardinality.** Every `verified-provisioning-v1` hook has **at least one**
identity-binding target (§2.1), so a non-empty set of `bindingPairKeyV1`s always
exists — this is what gives §2.5's repeat-event skip an event-independent key to
decide on. A hook with multiple identity-binding targets has one
`bindingPairKeyV1` **per target**; there is no attempt to fold multiple targets
into a single canonical key. Each target's no-op/insert decision is independent.

**Version-stream identity and fork/restore.** `version stream identity` binds the
key to a durable stream so a copied receipt from a fork/restore hashes the old
stream and is not silently trusted. A fork/restore that re-parents the version
stream is therefore treated exactly like a `key-version` bump: it runs the §7.4
dual-read/backfill/activation-fence sequence (re-deriving keys under the new
stream) rather than leaving §2.5's skip to match a stale copied key. There is no
in-place rehash that skips the fence.

Permission writes use the analogous declaration-derived `permissionGrantKeyV1`
over app id, version stream identity, table, conflict/index field identities, and
exact conflict-key values (one per permission-initial-grant target). Every one of
those conflict-key values is **resource-determined** — the membership `resource`
(`scope: 'app'` or the `resourceFrom` source-row column) and role, or the
`permission-backing` `conflictValues` (literals or source-row columns) — so the
key is fully computable from declaration + §2 lookup **before** the hook runs
(§2.1, §2.2, §5.3). No axis is hook-selected; this is what makes the key an
event-independent decider for §2.5. It likewise excludes event-scoped facts and
cannot duplicate or revive a grant on a new event; the framework grant-tombstone
registry (§5.3.1) is the revive guard.

### 7.3 Completion receipt key and exact comparison

```text
completionKeyV1 = SHA-256(canonical(
  "snapback.verified-provisioning.completion.v1",
  app id,
  version stream identity,
  hook declaration id,
  principal id,
  provider identity id,
  transition class,
  consumed proof id and generation,
  governing event id
))
```

`completionKeyV1` replaces the governing event's opaque `provisioningKey` as the
receipt primary key. Hook/bundle and assurance facts are deliberately compared,
rather than hidden by deriving a different key when they drift.

The existing receipt stores only a single `assurance_id`. The receipt schema is
therefore extended to store or integrity-bind at least:

- key-derivation version and completion key;
- hook declaration id and private hook artifact digest;
- complete bundle, schema/auth-program, and authorization-metadata digests;
- principal id;
- provider identity id and exact link predecessor/successor identity;
- for each binding target: resolved app identity namespace/table/value, **row
  incarnation**, and `bindingPairKeyV1` (a list, sized to target cardinality);
- transition class, proof id/generation, and governing event id;
- bytewise-sorted assurance ids, exact assurance-event ids, and a digest of the
  exact assurance records/set;
- each `permissionGrantKeyV1`, its framework grant-tombstone-registry result
  (§5.3.1), and normalized authority-bearing values;
- the **complete normalized planned-effect digest** — a durable, normalized
  reference to the exact app/auth/journal changeset the transition applied, so
  reconciliation can compare against actual writes rather than re-running the
  hook;
- auth/app commit version, authorization incarnation/version, and commit time;
  and
- the exact session/authority successor identity needed for LLP 0057/0059
  reconciliation, never its bearer secret.

`AlreadyCommitted` is returned without rerunning the hook only when **every**
stored fact equals the current completion and prepared artifact: hook id,
principal, provider and app identity (with incarnation), proof/event/generation,
assurance event and assurance set, transition class, hook/bundle/metadata
digests, permission-grant keys, and authority successor. The receipt's stored
planned-effect digest must also match the exact durable app/auth/journal effects
the receipt names; it is not recomputed by rerunning the hook. Same key with any
mismatch refuses `SNAPBACK_AUTH_PROVISIONING_REPLAY_MISMATCH`.

A new proof/governing event has a new completion key. Its hook may run once for
that event, while the stable binding-pair and permission-grant keys make exact
existing rows no-ops rather than uniqueness failures.

### 7.4 Canonical key registry and key-version migration protocol

**Durable home.** The stable keys are not free-floating hashes; they live in a
framework-owned registry with a stored key column, a stored `key_version`, and a
uniqueness constraint, so §7.4's "each binding/permission key row stores its
version" has a concrete referent:

```text
_snapback_verified_binding_keys_v1(
  app_id TEXT, version_stream TEXT, key_version INTEGER,
  binding_pair_key TEXT, binding_row_id TEXT,
  PRIMARY KEY(app_id, version_stream, key_version, binding_pair_key),
  UNIQUE(app_id, version_stream, key_version, binding_row_id)
)
_snapback_verified_grant_keys_v1(
  app_id TEXT, version_stream TEXT, key_version INTEGER,
  permission_grant_key TEXT, grant_row_id TEXT,
  PRIMARY KEY(app_id, version_stream, key_version, permission_grant_key),
  UNIQUE(app_id, version_stream, key_version, grant_row_id)
)
```

Both are sealed like an identity-binding table (no ordinary/HostPlan/seed/
projection/hook write). Each carries the same **two-way uniqueness** — a key maps
to one row and a row carries one key per `(app_id, version_stream, key_version)` —
so deterministic derivation is backed structurally, not merely by convention, on
both the binding and the grant registry. Each provisioning commit writes the
appropriate key row(s) in the same transaction as the binding/grant, and the
completion receipt (§7.3) stores the same `key_version`. The two application-level
unique indexes on the binding table (§5.2) remain the structural backstop for the
pair itself; these registry rows are the canonical lookup that §2.5/§6.1 consult.

**Key-version migration.** A bare domain-tag bump would give the same binding a
new key and split one principal↔row pair across two key namespaces. A future `v2`
of either key family therefore lands under an explicit migration, never a silent
rewrite:

1. Each registry row and each receipt already stores its `key_version`.
2. On a `v2` deployment, the host **dual-reads**: it derives both `v1` and `v2`
   keys and treats a `v1` registry match as an existing pair/grant (no-op) while
   writing the `v2` key going forward. Existing receipts are dual-read the same
   way — a `v1` receipt satisfies `AlreadyCommitted` without writing a second
   receipt for the same completion.
3. **Fence and drain `v1`-only producers.** Before `v2`-only activation, the
   migration MUST close the last-scan/activation interval, not merely narrow it.
   The two forms below are **two implementations of the same one mandatory
   producer-exclusion frontier** — not an exclusive-OR between a fenced path and an
   unfenced termination rule. Both fence further `v1`-only admission and drain the
   admitted predecessors before activation; they differ only in *where* the fence
   is placed (at key-write admission vs. at an advanced admission epoch), never in
   whether one is required:
   - **(a) drain-fence.** Fence new `v1`-only key writes, then drain in-flight
     `v1`-only producers to quiescence. This is sound as written.
   - **(b) terminal atomic fence (mandatory), with repeat-until-empty only as a
     drain tactic under it.** A single high-water + catch-up pass is
     **insufficient**, and so is standalone repeat-until-empty: an already-admitted
     `v1`-only producer `P` can **pause before commit**, a catch-up pass then
     observes zero new commits and declares a false fixed point, and `P` commits row
     `R` afterward — leaving `R` with only a `v1` key a `v2`-only lookup misses.
     Observing zero commits is not proof that the producer set and the scanned set
     coincide. Option (b) therefore **always** ends in a **terminal atomic fence /
     admission-epoch advance**: advance an admission epoch so **no further `v1`-only
     commit can be admitted**, capture the *terminal* watermark under that epoch,
     drain every admitted `v1`-only predecessor (including a paused `P`) to
     quiescence, catch up through the terminal watermark, and only then activate
     `v2`-only enforcement. Repeat-until-empty is admitted **only as an optimization
     that narrows the backlog before that fence** — never as a standalone
     termination rule, because it cannot exclude a paused/late producer. Completeness
     proof and producer exclusion **must share this one atomic admission frontier**;
     continuous catch-up without it always leaves the gap and is not admitted.

   A bounded backfill re-derives and stores `v2` keys for all existing `v1` rows.
4. An **activation fence** withholds `v2`-only enforcement (refusing on `v2`
   absence) until the backfill and the drain/catch-up are proven complete for the
   app's version stream; before the fence lifts, absence of a `v2` key is
   resolved by the `v1` dual-read, not by minting a duplicate binding.

No key-version change (nor a fork/restore version-stream re-parent, §7.2) is
admitted without this fence-and-drain / dual-read / backfill / activation-fence
sequence.

### 7.5 Ambiguous commit

After a storage outcome whose commit status is unknown, no caller may assume
rollback and rerun the hook. A fresh read transaction reconciles:

1. the exact completion receipt and every field in §7.3;
2. the identity-source row, resolved identity, and row incarnation;
3. every binding pair and permission grant named by the receipt, plus tombstone
   state;
4. the auth proof/challenge/link/assurance/session successor;
5. the app change journal and commit version compared against the stored
   planned-effect digest;
6. the authorization version/cause and the reservation's finalized/cancelled
   state; and
7. the journal and notification-intent ids.

Exact receipt plus exact effects means committed; return `AlreadyCommitted` and
only the exact precomputed/retained credential successor allowed by LLP 0057's
reconciliation rules. No receipt plus the exact complete predecessor and
definitive absence of every effect means rolled back; destroy unpublished
secrets and either retry from a newly prepared completion or report unavailable.
A receipt without its effects, effects without their exact receipt, a different
valid successor, unreadable state, or continuing ambiguity is terminal
fail-closed recovery (`SNAPBACK_AUTH_PROVISIONING_RECONCILIATION_REQUIRED`). It
never guesses, returns a fresh bearer, replays a notification, or opens an LLP
0053 publication barrier.

## 8. Seal composition

### 8.1 Identity-binding and identity-source seals remain unconditional

Every shipped `enforce_identity_binding_write_seal` / ordinary buffered,
HostPlan, seed, generated resource/transaction, maintained-projection rebuild,
and same-transaction projection-maintenance call site remains an unconditional
refusal for declared identity-binding tables **and** for every
**whole-table-sealed identity-source** in the new `identity_source_custody_tables`
set (§2.6), the framework grant-tombstone registry (§5.3.1), the framework
source-receipt registry (§2.7), and the framework canonical-key registries (§7.4).
The seal function stays table-level — the same
`(schema, table)` shape it ships with — so no call site changes signature. The
`AuthClaimsProjection` does not gain a write predicate. No "current provisioning
mode" branch is added to an ordinary writer.

Two write surfaces that today bypass the seal are folded in:

- **Codegen.** The generated-writer refusal set
  (`refuseGeneratedIdentityBindingWriters`) MUST additionally exclude the
  `identity_source_custody_tables`, the framework grant-tombstone registry, the
  framework source-receipt registry (§2.7), and the two canonical-key registries
  from generated insert/patch/delete types — the same shape it already uses for
  `identity_binding_tables`.
- **Migration executor.** The LLP 0081 migration executor
  (`src/storage/migration_executor.rs`) does not call the seal today. **Every** one
  of its write primitives that can create or materialize a row in a custody/registry
  target MUST route through the same `(schema, table)` seal check — not only raw
  `INSERT INTO {staged}` but also `CopyTable`, `CopyField`, `BackfillField`, an
  `ALTER … ADD COLUMN DEFAULT` that materializes column values into existing rows,
  and a rename-swap that moves a staged table onto a custody/registry name (row 4d
  already requires the last two) — and each MUST refuse **unless the writer identity
  IS the §2.7 admitted import lifecycle** (a registered validated-import-envelope
  consumer, §2.7). A generic staged copy, backfill, column-default materialization,
  or rename-swap over a custody table therefore refuses; only the attributed import
  populates it.

The new provisioning writer is beside those paths. Its zero-argument generated
binding operation constructs and applies an insert/exact-triple-no-op through the
joined executor without calling the ordinary sealed writer. Absence of the
private writer type is refusal.

The only writers permitted to populate a whole-table-sealed identity source are
the closed `custody.admittedWriters` set (§2.6, §2.7) — the authorized
migration/import lifecycle in v1, and the deferred creating variant in a future
spec. This Spec does not pretend a sealed source table can never be populated,
only that no ordinary caller claim or application authority crosses into it, and
that even the admitted migration cannot promote an ordinary-authored row into the
resolved set (§2.7).

### 8.2 Permission writers are split and composed, not mislabelled sealed

Permission-backing and membership tables are not added to
`identity_binding_tables`, and this Spec does not describe the existing identity
seal as covering them. Ordinary authorized `.membership()`/`permissionBacking()`
writers remain available under LLP 0053/0056. The provisioning writer's narrow
initial-grant path is an additional producer, split by `target` (§5.3) into a
generic-permission-backing writer and the closed
`MembershipWriter::VerifiedProvisioningInitialGrant` class (open-join-self only,
no bootstrap), both feeding the same central authorization commit hook with the
unique / framework-tombstone-no-revive / no-escalate rules of §5.3. The
grant-tombstone registry (§5.3.1) is framework-owned and updated by every
grant-ending path, so no-revival does not depend on an app-declared table.

### 8.3 Constructor-only authority is preserved

The separate writer is not, by itself, the authority. It exists only as a field
of a live prepared hook context produced by:

```text
enumerated proof consumer (closed registry, §3.2)
  -> private VerifiedIdentityCompletion (with carrier token)
     OR private non-production RehearsalIdentityCompletion
  -> closed LLP 0058 VerifiedProvisioning authority
  -> private hook artifact
  -> epoch/transaction-bound provisioning writer
```

No layer can be skipped or reconstructed from the serialized outputs of another
layer. This remains true even if a hook catches an application exception.

## 9. Adversarial refusal table

| # | Attack | Required outcome |
| --- | --- | --- |
| 1 | Ordinary handler/HostPlan/seed/projection writes an identity-binding table or an identity-source custody column | Existing unconditional seal: `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`, including when `ctx.auth.claims` is present. |
| 2 | Caller names the private hook through bearer, handler id, `AdminWrite`, scoped grant, CLI/MCP, public route, or nested call | No dispatch entry and no completion constructor. Any ordinary table write still hits row 1. |
| 3 | Hook attempts `bindMe({sourceUserID})` or provides principal/app identity/incarnation | Generated binding API is zero-argument; dynamic field attempt refuses `SNAPBACK_AUTH_PROVISIONING_FIELD_FORBIDDEN`. |
| 4 | Ordinary caller pre-seeds `identitySource` row (`email = victim`, `role = admin`) then victim verifies | Whole source table is custody-sealed (§2.6): the pre-seed write to any column already refused `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`. There is no `create` arm to bind an uninvited row. |
| 4a | Ordinary caller authors row R on other columns, later generic migration stamps a sealed match value onto R | Whole-table seal blocks the ordinary write entirely (§2.6); the admitted migration/import writer cannot promote a prior ordinary-authored row into the resolved set — its receipt binds the match tuple, resolved incarnation, source provenance, and an atomic create/claim, refusing on an unattributed pre-existing `_id` (§2.7). |
| 4c | Attacker inserts `{email:victim, role:admin}` while `users` is ordinary; app later declares `users` as `identitySource` and only backfills incarnations, then victim proves the email | Activation is an **attributed import**: it refuses `SNAPBACK_AUTH_PROVISIONING_SOURCE_UNATTRIBUTED_ROWS` unless the table is empty or **every current row carries a §2.7 receipt** (match tuple + resolved incarnation + envelope identity/offset). The attacker row has no receipt, so activation refuses and no bind occurs. The RQ-1 cutover IS running the §2.7 import over every row, not adding the declaration over ordinary content (§2.2, §2.7). |
| 4d | Generic migration DML, `CopyTable`/`CopyField`/`BackfillField`, a row-materializing `ALTER … ADD COLUMN DEFAULT`, or a rename-swap onto a custody name writes/materializes rows in a custody-sealed source | Must enter the §2.7 admitted import lifecycle or refuse at the seal (§8.1) — **every** LLP 0081 write primitive routes through the seal, not only raw `INSERT INTO {staged}`; a generic copy/backfill/column-default/rename-swap over a custody table refuses `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`. Only the registered envelope consumer populates it. |
| 4e | Attacker forges a §2.7 receipt for an ordinary-authored row, copies a valid receipt onto another row/table, mutates a row or its receipt after creation, or deletes receipt evidence after activation | The receipt lives in the framework-owned always-sealed `_snapback_verified_source_receipts_v1` registry (§2.7): ordinary/HostPlan/seed/projection/hook writes to it refuse `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`, so no forge/mutate/delete. Only the registered §2.7 consumer writes it, in the row-creation tx. `UNIQUE(source_table,row_id,incarnation)` + `UNIQUE(envelope,offset)` defeat cross-row/cross-table copy (the exact-join fails), and LLP 0214 §4.8 integrity binding detects a direct-storage tamper. |
| 4f | Ordinary write admitted before sealing inserts an attacker row *between* the empty/all-attributed activation scan and the seal going live | Activation performs scan + seal install + generation publish under **one serialized, traffic-fenced transaction / admission-epoch advance** (§2.7 "one atomic frontier"); predecessors drain, and any racing insert either lands before the checked snapshot (then it needs a §2.7 receipt or the whole activation refuses `SNAPBACK_AUTH_PROVISIONING_SOURCE_UNATTRIBUTED_ROWS`) or is admitted only under the successor generation where the table is already sealed and the insert refuses. No interleaving leaves an attacker row present-at-lookup yet absent-from-scan. |
| 4b | Provider A subject `42` and provider B subject `42` share one imported source table | Stored lookup tuple and unique index include the provider-installation discriminator (`(providerInstallation, subject)` etc., §2.1/§2.2). A/42 and B/42 are distinct keys; codegen refuses a one-field subject index and refuses to share a discriminator-free index across installations. |
| 5 | Client replays a claims object as proof | No API accepts it. Only §3's private completion consumers can construct either carrier, each with a carrier token. |
| 6 | Password register/set/change/reset/recovery or email-as-username register is treated as verified | Explicitly excluded by §3.3; no carrier, no hook marker, no app write. A genuine composed proof requires a future closed-set amendment consuming a §3.2 carrier. |
| 7 | Ordinary writer passes an ambient provisioning brand/mode bit | No serializable bit exists; ordinary seal remains unconditional. `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`. |
| 8 | Host runs the hook as `System`, or a `System`/aliased/re-exported function resolves to the private artifact | `System` cannot prepare the private artifact; compilation resolves re-exports/aliases across the graph and forbids public dispatch. No hook evaluation. |
| 9 | Hook stashes `ctx.db`/method/closure and calls it during a later warm invocation | Existing epoch fence refuses `SNAPBACK_HANDLER_STALE_CONTINUATION`; transaction token is also settled/inert; call goes through the epoch-prefixed `__hostCall` path. |
| 10 | Branded writer patches, deletes, delete-wheres, bulk-writes, transfers, or edits an unrelated binding | Operation absent; runtime backstop `SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN`. |
| 11 | Provider claim maps to zero/multiple rows, or the row/incarnation changes before commit | Zero refuses `...IDENTITY_SOURCE_NOT_FOUND`; multiple refuses `...IDENTITY_SOURCE_AMBIGUOUS`; commit predicate/incarnation drift rolls back `...STALE`. |
| 12 | App row `_id = U` is deleted and recreated; a stale binding retargets on the write side | Binding stores `(_id, rowIncarnation)` (UUIDv7 TEXT); recreation is a new incarnation, so the existing pair mismatches and refuses `SNAPBACK_AUTH_BINDING_CONFLICT` — no silent retarget. |
| 12a | Protected handler resolves `principal → binding → app row` by bare `_id` after a delete/recreate | The sanctioned resolver joins the stored incarnation against the live LLP 0110 registry and returns `SNAPBACK_AUTH_BINDING_DANGLING`, never the recreated row (§5.4). Bare-`_id` resolution is not a sanctioned path. |
| 13 | Same completion key carries different hook, principal, identity, incarnation, assurance event/set, transition, bundle, or planned effects | `SNAPBACK_AUTH_PROVISIONING_REPLAY_MISMATCH`; no `AlreadyCommitted`. |
| 14 | New verification event resolves the same binding | New completion receipt; `bindingPairKeyV1` recognizes exact pair (incarnation included) and binding write is a no-op. Conflicting pair refuses `SNAPBACK_AUTH_BINDING_CONFLICT`. |
| 15 | Hook grants another principal, duplicates a grant with new event id, revives a removed grant, or seats an owner | Principal host-injected; stable conflict key exact-active no-op only; the framework grant-tombstone registry (§5.3.1), written by every removal/revocation path and sealed against forgery, blocks revive; the membership class admits only a `by:["none"], target:"self"` open-join onto a non-protected role — no bootstrap, no owner seating. Cross-principal / permission-conflict refusal. |
| 15a | Attacker forges a tombstone to deny a victim, or deletes a real tombstone to force a revive | The grant-tombstone registry is framework-owned and sealed (§5.3.1); ordinary/HostPlan/seed/projection/hook writes to it refuse `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`. Neither forge nor delete is possible. |
| 15b | New writer seats `bootstrapRole`/owner on an orphaned or empty-roster resource (or app-global singleton) | Out of the class entirely: it drives only open-join-self onto a non-protected role and never spends LLP 0056's creation-bound bootstrap witness, which empty/orphaned rosters do not have. First-owner/app-global seating stays on privileged non-invocation writers. |
| 15c | Hook selects the permission resource or a `permission-backing` conflict value so the grant key can't be derived before JS | Codegen refuses: every permission/membership target is **resource-determined** — `scope:'app'`, `resourceFrom` source-row column, `conflictValues` literal/source-row — never hook output; `SNAPBACK_AUTH_PROVISIONING_IDENTITY_SOURCE_INVALID` (§2.1, §2.2, §5.3). `permissionGrantKeyV1` is therefore always decidable before JS. |
| 16 | Permission writer raw-inserts then manually bumps an epoch | No raw path; both `target` kinds enter LLP 0053's central hook with journal, classification, barriers, obligations, and protected-room invalidation. |
| 17 | Rehearsal completion or `auth.mintSession` reaches production | Production refuses the operation with `SNAPBACK_PROFILE_FORBIDS`; rehearsal is independently inadmissible at completion/commit. |
| 18 | Producer wired inside the LLP 0057 `IMMEDIATE` exchange lock, or committed before the hook | §3.4 amends the exchange to the buffered / one-transition-commit shape: JS never runs under the SQLite writer lock, and challenge consumption + success-path attempt increment share the hook's single commit. |
| 18a | HMAC-correct code fails the §2 lookup (`NOT_FOUND`) five times to lock a valid code | Success-path attempt increment is deferred into the one transition commit (§3.4); a refused transition commits nothing, so no attempt is burned and the code is not locked. Wrong/locked codes still commit attempt accounting without a completion, per LLP 0057. |
| 18b | Concurrent `request-code` supersedes/re-mints the challenge while the hook evaluates, or during the unlocked gap after the stripe is dropped | The per-address stripe is held across evaluation and room quiescence so no supersession happens *during JS* (§6.1); after the stripe is dropped for the 0059 `Begin`, the one commit rechecks the full challenge predicate — consumed/superseded/locked/expired/generation — so any re-mint in that unlocked gap refuses `...STALE`, consuming/binding/minting nothing (§3.4 step 5, §6.3). |
| 18d | §3.4 tries to hold maintenance + stripe across the LLP 0059 projection `Begin`, or skips the `Begin` | Both are forbidden and neither is the spec's protocol: shipped exchange does `premark_issuance` (0059 `Begin` / cap-eviction drain) before commit and 0057 requires every guard dropped before it, so holding across it violates 0059 prohibited-overlap and drains under a held guard, while skipping it leaves an evicted session projection-live. §3.4 instead **drops both**, does the `Begin`, then takes **one fresh non-nested** shared admission (not the nested reacquire that deadlocks the fair gate) before keyring/writer — satisfiable against shipped 0059/0057. |
| 18c | Guest-claim hook buffers only an `ensure()` but the producer inherently advances the LLP 0053 version | The §6.2 preview includes the producer-inherent LLP 0053 advance (§8.2 step 10), so the reservation is non-empty; the shipped interlock's `bind()` covers it rather than `NoAuthorizationEventReservation` refusing. |
| 19 | Proof, assurance, governing authority, artifact, lookup, auth metadata, incarnation, or binding changes while JS runs | Commit-time revalidation fails and all transition effects roll back; reservation cancelled. |
| 20 | Authorization write reaches SQLite without an installed room reservation, or the reservation is prepared after opening SQLite | §6.2 reserves and quiesces the interlock before Local/SQLite; the shipped `AuthorizationCommitInterlock` refuses an unbound authorization write. |
| 21 | Commit response is lost and caller retries blindly | Exact durable reconciliation in §7.5 against the stored planned-effect digest; no rerun or fresh credential while outcome is ambiguous. |
| 21a | During a `v1`→`v2` key migration, an admitted `v1`-only producer pauses before commit, a catch-up pass sees an empty pass, then it commits row `R` after the "fixed point" | Repeat-until-empty is **not** a standalone termination rule (§7.4 option (b)): an empty pass does not exclude a paused/late producer. `v2`-only activation always ends in a **terminal atomic fence / admission-epoch advance** that bars further `v1`-only commits, drains every admitted `v1`-only predecessor (including the paused one), catches up through the terminal watermark, and only then activates — so `R` is caught before activation, never left `v1`-only. |
| 22 | Repeat verification event re-runs the hook to `patch`/side-effect an ordinary row on every re-verify | The complete deciding key set — every `bindingPairKeyV1` + `permissionGrantKeyV1` — is non-empty (mandatory binding target) and derivable from declaration + §2 lookup before JS; a matching set **categorically suppresses** the hook and its ordinary writes (§2.5). Ordinary writes are never a per-verify mutation path, in every admitted shape including a binding established by a different declaration. |

## 10. Implementation and acceptance obligations

### 10.1 Required implementation shape

- Replace the dormant caller-shaped `prepare_*` helpers with §3's private
  completion/rehearsal consumers and carrier-token minting. Replace the
  standalone executor with the §6.3 joined executor. Do not incrementally trust
  the dormant shapes.
- Amend LLP 0057's `POST /auth/exchange` and the LLP 0214 §8.2 guest-claim
  transition to the §3.4 prepare/buffer/one-commit shape completely: wrong/locked
  attempt accounting unchanged and hook-free; success-path attempt increment,
  challenge consumption, and the full challenge recheck inside the one commit; the
  maintenance admission and per-address stripe held across JS + quiescence then
  **both dropped** for the LLP 0059 `Begin` / cap-eviction drain, with **one fresh
  non-nested** shared admission taken before keyring/writer and the stripe not
  reacquired (the unlocked gap covered by the commit recheck, §3.4); the
  candidate-collision/stale retry loop never re-evaluating the hook.
- Extend LLP 0058's closed authority/source registries with
  `VerifiedProvisioning`, `VerifiedIdentityCompletion`, and
  `RehearsalIdentityCompletion`, including exhaustive projection, mode/epoch,
  nested-call, public-source, and `System` negatives.
- Compile §2's private artifact and identity-source descriptor, including the
  §2.6 **whole-table** custody seal (`identity_source_custody_tables`), the
  provider-discriminated lookup tuple + unique index (§2.2), the
  `catalog-canonical` collation, and the §2.7 closed migration/import writer with
  its receipt-bound atomic create/claim and its `lifecycle` bound to a registered
  validated-import-envelope consumer. Add the **framework-owned sealed source-receipt
  registry** `_snapback_verified_source_receipts_v1` (§2.7), written only by the
  registered §2.7 consumer in the row-creation tx, unique on `(source_table, row_id,
  incarnation)` and `(envelope, offset)` (both scoped to `(app_id, version_stream)`,
  §2.7), integrity-bound per LLP 0214 §4.8. The integrity binding is a **keyring
  HMAC computed over the canonical (§7.1) encoding of the whole receipt record**
  (the LLP 0214 §4.8 item-8 import-receipt integrity contract — source identity,
  adapter version, target app, principal, and imported facts), written to the
  `integrity` column by the §2.7 consumer at row-creation time and **verified
  whenever a receipt is consulted** — the activation exact-join (§2.2/§2.7) and the
  §7.5 reconciliation recompute and check it before trusting a receipt, so a
  direct-storage tamper of the sealed row is detected, not silently honored. Enforce
  the §2.2 **attributed-activation** precondition **under one serialized,
  traffic-fenced activation transaction** that runs the receipt-registry exact-join
  scan (on `(source_table, row_id, incarnation)` **plus** `receipt.match_tuple ==`
  the row's current `lookup.fields`), installs the seal, and publishes the generation
  together: activation refuses
  `SNAPBACK_AUTH_PROVISIONING_SOURCE_UNATTRIBUTED_ROWS` unless the source is empty or
  every current row exact-joins a §2.7 receipt with a non-drifted match tuple, and
  no ordinary write can be interleaved between the scan and the seal going live.
  Refuse
  a source table coinciding with a binding target or a framework registry, refuse
  reuse of one canonical-value index across distinct identity-kind domains (or
  prove them disjoint), and refuse any permission/membership target whose
  resource/conflict identity is hook-selected rather than resource-determined
  (§2.1, §2.2). Keep the artifact out of all public function registries and reject
  aliasing/re-exports. Require row-id source-table enrollment in the LLP 0110
  incarnation registry with reviewed backfill.
- Generate distinct provisioning writer types. Omit host-owned fields (principal,
  app identity, incarnation) from binding and permission payloads. Keep every
  existing ordinary identity-binding seal call site unchanged (same `(schema,
  table)` shape) and add `identity_source_custody_tables`, the framework
  grant-tombstone registry, the framework source-receipt registry (§2.7), and the
  canonical-key registries to the sealed set — including the generated-writer
  refusal set (`refuseGeneratedIdentityBindingWriters`). Route **every** LLP 0081
  migration executor write primitive that can create or materialize rows — raw
  `INSERT INTO {staged}`, `CopyTable`, `CopyField`, `BackfillField`, a
  row-materializing `ALTER … ADD COLUMN DEFAULT`, and a rename-swap onto a
  custody/registry name — through the same seal for custody/registry targets,
  refusing unless the writer is the §2.7 admitted import lifecycle (§8.1).
- Generate the §5.4 central incarnation-checking binding resolver as the only
  sanctioned steady-state `principal → binding → app row` path (UUIDv7 TEXT
  join), and reteach the guide off the bare-`_id` read.
- Add the framework grant-tombstone registry (§5.3.1) and amend LLP 0053/0056 so
  every removal/revocation/expiry/replacement/reset/import/migration path updates
  it transactionally through the one commit hook.
- Add the closed `MembershipWriter::VerifiedProvisioningInitialGrant` class
  (open-join-self only, no bootstrap) and amend LLP 0056 for it; keep it off the
  `is_privileged_noninvocation` branch and off the bootstrap witness.
- Capture and validate the hook read set and identity lookup predicate with the
  ordinary LLP 0003 OCC machinery, extended for the auth/metadata/incarnation
  facts in §6.
- Add the §6.2 pre-SQLite impact-preview / reserve / quiesce / bind phase using
  the shipped **unbound** `AuthorizationCommitReservation` interlock (the reused
  mutation preflight plus producer-inherent LLP 0053 advances; `bind()` returns
  the prepared commit), and route every permission effect through LLP 0053's one
  commit hook.
- Add the framework canonical-key registries (§7.4), extend receipts (per-target
  binding keys, UUIDv7 incarnation, planned-effect digest) and ambiguity
  reconciliation per §7, and implement the §7.4 fence-and-drain key-version
  migration protocol (and the fork/restore version-stream re-parent path).

### 10.2 Diagnostics

The implementation registers and projects at least:

- `SNAPBACK_AUTH_PROVISIONING_FIELD_FORBIDDEN`;
- `SNAPBACK_AUTH_PROVISIONING_IDENTITY_SOURCE_NOT_FOUND`;
- `SNAPBACK_AUTH_PROVISIONING_IDENTITY_SOURCE_AMBIGUOUS`;
- `SNAPBACK_AUTH_PROVISIONING_IDENTITY_SOURCE_INVALID`;
- `SNAPBACK_AUTH_PROVISIONING_SOURCE_UNATTRIBUTED_ROWS`;
- `SNAPBACK_AUTH_BINDING_CONFLICT`;
- `SNAPBACK_AUTH_BINDING_DANGLING`;
- `SNAPBACK_AUTH_PROVISIONING_PERMISSION_CONFLICT`;
- `SNAPBACK_AUTH_PROVISIONING_CROSS_PRINCIPAL`;
- `SNAPBACK_AUTH_PROVISIONING_STALE`;
- `SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN`;
- `SNAPBACK_AUTH_PROVISIONING_REPLAY_MISMATCH`;
- `SNAPBACK_AUTH_PROVISIONING_RECONCILIATION_REQUIRED`; and
- the preserved `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`,
  `SNAPBACK_HANDLER_STALE_CONTINUATION`, and `SNAPBACK_PROFILE_FORBIDS`.

Public diagnostics never echo provider claims, lookup values, app rows, proof
material, assurances, tokens, or secret-bearing receipts.

### 10.3 Acceptance matrix

The implementation MUST prove at least:

1. exact-one existing-row lookup for `_id`+incarnation and identity-grade
   source-key arms, using the `catalog-canonical` collation;
2. zero-refuse (no create arm), multiple-row, reassignment, deletion, and
   row-incarnation/source-key race cases;
3. **whole-table custody-steering negatives**: an ordinary/HostPlan/seed/
   projection write to *any* column of a whole-table-sealed identity source
   refuses, no pre-seeded row can steer a later bind, and a source table that is
   also a projection output refuses generation;
4. **closed-migration-writer negatives**: a generic migration cannot promote a
   prior ordinary-authored `_id` into the resolved set; the import receipt binds
   the match tuple, resolved incarnation, source provenance, and atomic
   create/claim (§2.7); and generic migration DML and a row-materializing
   `ALTER … ADD COLUMN DEFAULT` against a custody-sealed source either enter the
   §2.7 admitted import lifecycle or refuse `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`
   (§8.1); and **attributed-activation negatives**: declaring a pre-populated
   ordinary table as `identitySource` and backfilling only incarnations refuses
   `SNAPBACK_AUTH_PROVISIONING_SOURCE_UNATTRIBUTED_ROWS` when any current row lacks
   a §2.7 receipt, an empty table and a fully receipt-attributed table both
   activate, and a victim proof against an attacker-authored pre-activation row
   never binds because activation refused (§2.2, §2.7); and **receipt-registry
   negatives**: an ordinary/HostPlan/seed/projection/hook write that tries to forge
   a `_snapback_verified_source_receipts_v1` row, copy a valid receipt onto another
   row or table, mutate a row or its receipt after creation, or delete receipt
   evidence after activation refuses `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN` (or
   fails the two-way-unique exact-join / integrity check); a **match-tuple-drift
   negative**: a receipted row whose `lookup.fields` were ordinary-`UPDATE`d during
   the pre-seal cutover window (so the row no longer equals its `receipt.match_tuple`)
   refuses activation `SNAPBACK_AUTH_PROVISIONING_SOURCE_UNATTRIBUTED_ROWS` (§2.2);
   a **receipt-integrity-tamper negative**: a direct-storage edit of a sealed
   receipt row is caught by recomputing the LLP 0214 §4.8 keyring HMAC at the
   activation join and at §7.5 reconciliation; and an **atomic-activation race**: an
   ordinary writer paused between the attributed scan and the seal publication either
   lands before the checked snapshot (and must carry a §2.7 receipt or the whole
   activation refuses) or is admitted only under the successor sealed generation and
   refuses — never resolvable-yet-unattributed (§2.7 "one atomic frontier");
5. **provider-discriminator negatives**: provider A subject `42` cannot resolve
   provider B's imported row; codegen refuses a one-field subject index and a
   discriminator-free index shared across installations;
6. **incarnation negatives**: delete/recreate of the resolved `_id` refuses on the
   write side with `SNAPBACK_AUTH_BINDING_CONFLICT`; and the §5.4 resolver returns
   `SNAPBACK_AUTH_BINDING_DANGLING` (never the recreated row) on a bare-`_id`-style
   steady-state read, using the UUIDv7 TEXT registry join;
7. provider claim absent from the committed binding row and from every unique/
   indexed column on the binding table;
8. unique principal/app identity conflict interleavings;
9. password-register/set/change/reset/recovery and email-as-username negatives,
   and every admitted §3.2 producer;
10. **LLP 0057 exchange join** (satisfiable against shipped 0059/0057): hook JS
    never runs under the SQLite writer lock, with the shared maintenance admission
    and per-address stripe held from HMAC through JS and room quiescence; **both are
    then dropped**, the LLP 0059 projection `Begin` / cap-eviction drain
    (`premark_issuance`) runs with **no guard held across it**, and **one fresh
    non-nested** shared maintenance admission is taken (asserted distinct from a
    nested reacquire) before the keyring then the writer; the per-address stripe is
    not reacquired and the resulting unlocked gap is closed by the commit-time full
    challenge recheck; a `request-code` re-mint injected **during that gap** makes
    the commit refuse `...STALE` and bind/consume/mint nothing, **and the step-4
    `premark_issuance` is rolled back via `finish_issuance`/`compare_unmark_issuance`
    so no cap-eviction premark or topology reservation is stranded** (assert on both
    the STALE path and a hook-error path); a failed hook rolls
    back challenge consumption and session minting; five HMAC-correct `NOT_FOUND`
    attempts do not lock a valid code; an active incorrect submission increments
    while a locked/terminal/unknown outcome commits a no-op classification;
    wrong/locked codes still commit attempt accounting without a completion; a
    concurrent `request-code` supersession during JS is caught by the full challenge
    recheck;
11. production `auth.mintSession` refusal before provider/session/hook effects;
12. private artifact dispatch/alias/re-export/`System`/AdminWrite/grant negatives;
13. stale `ctx.db`, bound-method, and closure continuation negatives using the
    existing epoch fence and the epoch-prefixed `__hostCall` path;
14. insert-only identity writer and exact-triple no-op across a new verification
    event, plus the §2.5 skip-hook-on-matched-state path (with the mandatory
    binding target always present): a matching deciding key set suppresses the
    hook and its `ordinary` writes; a first-ever event under a second declaration
    whose pair was already bound by a different declaration suppresses that
    declaration's ordinary writes (cross-declaration consequence); and the deciding
    key set is proven non-empty and hook-output-independent in every admitted shape;
15. exact receipt comparison, target-cardinality (1/many binding targets), and all
    ambiguous-commit states, plus a `v1`→`v2` migration
    fence-and-drain/dual-read/backfill/activation-fence exercise and a
    fork/restore version-stream re-parent; and a **paused-producer negative**: an
    admitted `v1`-only producer that pauses before commit, followed by a catch-up
    pass that observes an empty pass, is still caught — `v2`-only activation only
    fires after the mandatory terminal atomic fence / admission-epoch advance drains
    that predecessor and catches up through the terminal watermark, so the paused
    producer's row is never left `v1`-only (§7.4 option (b));
16. permission grant duplicate / no-revive (framework tombstone registry) /
    tombstone-forge-and-delete negatives / cross-principal / owner-seating /
    orphaned-roster-bootstrap-refusal cases under
    `MembershipWriter::VerifiedProvisioningInitialGrant`, plus a removal path that
    writes the tombstone transactionally; and **resource-determined permission
    negatives**: codegen refuses a hook-selected membership resource or
    `permission-backing` conflict value (`scope:'app'`/`resourceFrom`/literal/
    source-row only), and a `scope !== 'app'` declaration that would seat a
    privileged first holder is a manifest error (§2.1, §2.2, §5.3);
17. permission write change journal, app version, authorization version, durable
    obligation, publication barrier, retained-client quarantine, and
    protected-room kick behavior, including the §6.2 reserve-before-SQLite phase
    with a producer-inherent guest-claim LLP 0053 advance in the preview; and a
    **lock-liveness** proof that the maintenance/stripe hold across JS + quiescence
    is bounded by the hook wall-clock deadline and that no quiescence-completion
    path requires a fresh maintenance/stripe admission (so the held reader cannot
    self-deadlock under the fair gate), with expiry failing closed (§6.1, §6.2); and
18. one all-effects atomicity fault-injection cut at every §6.3 effect.

### 10.4 Documentation and sequencing

Once implemented, the guide teaches:

```text
whole-table-sealed app identity source (import/migrate-owned)
  -> verified provider proof
  -> host exact-one, provider-discriminated app identity lookup (catalog-canonical)
  -> sealed private hook
  -> principal <-> resolved app-row identity (_id + UUIDv7 incarnation) binding
  -> central incarnation-checking resolver on every protected read
  -> LLP 0053-composed initial permission effects (open-join-self writer class)
  -> reserve/quiesce protected rooms (incl. producer-inherent 0053 advances)
  -> atomic session/receipt/intent commit
  -> post-commit dispatch and authority release
```

It does not teach a client-callable `bindMe`, claim-keyed binding, `onMissing:
create`, a bare-`_id` binding read, or raw permission insert. It says plainly that
a **username-only app has no v1 provisioning path** and that an app whose identity
source cannot be placed under **whole-table** custody (import/migrate-owned)
cannot use this lane — so agents do not reopen password-register as "the" writer.
The reopened guide-gap ticket closes only when that recipe and its runnable
acceptance case land.

This contract remains a cross-cutting dependency of LLP 0183 D2, D3, and D5. On
acceptance, the owner/sequence issue required by the round-1 Spec is filed in the
Exact project with a Snapback label and cross-linked from the filesystem ticket.

## 11. Author rulings, deferred scopes, and status

The round-2 author-proxy rulings are incorporated and extended:

- **OQ-1:** `auth.mintSession` remains non-production, requires both operator
  capabilities, and always carries rehearsal taint. No production graduation
  occurs here.
- **OQ-2:** resolved as the load-bearing mechanism: provider claim is lookup
  input only; the binding stores principal and the resolved app-row identity with
  its row incarnation.
- **OQ-3:** multiple provider identities continue to link to one principal in the
  auth substrate. A genuinely multi-persona app requires a separate, scoped
  app-binding model; this Spec does not bless provider-keyed app bindings.
- **OQ-4:** the notification intent row commits in the transition; delivery
  dispatch occurs only after commit.
- **OQ-5 (round 3):** `onMissing:create` is removed from v1. Provisioning binds
  only to an app row the app already created through its ordinary,
  custody-governed flow. A creating variant — which must specify host-filled
  match fields, host-minted row identity, custody of a newly created row, and
  replay semantics — is deferred to a separate spec.

- **OQ-6 (round 4):** the membership initial-grant arm admits only a
  `by:["none"], target:"self"` open-join onto a non-protected role; bootstrap and
  first-owner/app-global seating stay on LLP 0056's privileged non-invocation
  writers, and no bootstrap witness is spent or faked here.

Explicit dependencies / deferred scopes remain:

- the identity-grade source-key arm cannot activate until LLP 0226's schema-owner
  lane emits its immutable/non-reuse descriptor; the row-id+incarnation arm does
  not wait on it;
- a creating identity-source variant (former `onMissing:create`) is a future
  spec (OQ-5);
- later revocation/reactivation of app memberships remains a separate lifecycle
  policy, and a future authorized "genuinely re-admit" operation is the only path
  that clears a grant tombstone (§5.3.1);
- **dangling-binding recovery** after a delete/recreate of the resolved `_id` is
  an authorized re-provision or operator action, not a silent retarget — the
  binding is fail-closed dangling (§5.4) until then, a stated liveness cost; and
- a future production mint entry point or multi-persona binding requires a new
  scoped decision.

None of these is an open escape hatch in this Spec.

**Residual open question (RQ-1):** the §2.6 custody model requires the identity
source to be a **whole table** whose entire content is written only by the closed
`custody.admittedWriters` set (in v1, the authorized migration/import lifecycle of
§2.7). For an app whose users are today created by ordinary handlers writing
`users.email`, adopting this lane requires migrating that table to whole-table
custody — a one-time schema/data migration whose ergonomics are not yet designed.
That migration **is** the §2.7 attributed import: activation refuses
(`SNAPBACK_AUTH_PROVISIONING_SOURCE_UNATTRIBUTED_ROWS`) unless the source is empty
or every current row already carries a §2.7 receipt, so the cutover cannot be a
bare "declare `identitySource` and backfill incarnations" over pre-existing
ordinary rows — it must run the import lifecycle over each row (§2.2). This is a
real scope/ergonomics limit, not a laundering hole: an unattributed row simply has
no path into the resolved set. Until the creating variant lands, the practical v1
surface is apps that **import or migrate** their identity source under the
authorized lifecycle, not apps that mint app rows from ordinary client handlers. Whole-table (rather than the round-3
column-level) custody is the deliberate v1 simplification: it matches the shipped
table-level seal, needs no per-call-site column threading, and is strictly
stronger — at the cost of requiring an import/migration-owned source table. This
is called out for the author as the honest boundary of v1.

**Accepted.** The round-4 revision closed the integration-completeness items both
independent round-3 reviews converged on: the whole-table custody seal and its
closed enumerated writer set, the provider discriminator inside the unique index
tuple, the read-side incarnation-checking resolver, the completed LLP 0057
exchange amendment, the framework-protected no-revival registry, bootstrap removal
in favor of open-join-self, the mandatory binding target, the durable
canonical-key registry, and the UUIDv7-`TEXT` incarnation encoding. This round-5
revision closes the last decisive soundness hole both round-4 families circled —
**activation of a pre-existing ordinary table is now an attributed import** that
refuses unless the source is empty or every current row carries a §2.7 receipt —
and completes three tightenings: permission/membership targets are pinned to
resource-determined declarations (hook-selected identities refused,
non-`app` seating in the type) so §2.5's skip predicate is decidable from
declaration + lookup in every admitted shape; §3.4's lock order; and migration
option (b).

This round-6 revision makes those last two **satisfiable/mandatory** and spells out
attributed activation to the level both round-5 families asked for:

- **§3.4 lock order is now satisfiable against shipped LLP 0059/0057.** Round 5's
  "hold maintenance + stripe throughout, never drop, nothing across the 0059
  `Begin`" was unsatisfiable — shipped exchange does the 0059 `Begin` /
  cap-eviction drain (`premark_issuance`) *before* its commit and 0057 requires
  every guard dropped before that `Begin`. The shipped-sound **drop-both-then-fresh**
  composition is restored: hold through JS + quiescence, drop both, do the
  `Begin`/drain with no guard held across it, take **one fresh non-nested** shared
  admission (explicitly not the nested reacquire that deadlocks the fair gate), then
  keyring then writer; the full commit recheck is the safety net for the unlocked
  stripe gap; the hook wall-clock bound caps the maintenance hold (availability, not
  soundness).
- **§2.7 receipt is a framework-owned sealed registry, and activation is atomic.**
  `_snapback_verified_source_receipts_v1` is sealed like an identity-binding table,
  written only by the registered §2.7 consumer in the row-creation tx, unique on
  `(source_table, row_id, incarnation)` and `(envelope, offset)`, integrity-bound
  per LLP 0214 §4.8. The attributed scan, seal installation, and generation publish
  run under one serialized, traffic-fenced transaction exact-joining that registry,
  so no ordinary write can slip an unattributed row between scan and seal.
- **§7.4 migration frontier is mandatory.** The exclusive-OR is deleted:
  `v2`-only activation always ends in a terminal atomic fence / admission-epoch
  advance; repeat-until-empty is only a drain optimization under it (a paused `v1`
  producer defeats a standalone empty pass).

Plus the minors: §8.1 routes every LLP 0081 write primitive through the seal;
`resourceFrom`/`source-row` axis columns are required (NOT NULL) and
`conflictValues` arity equals the non-principal `fields` arity; and the §2.5/§6.1
skip path constructs the host-derived no-op buffer + completion receipt without
JS.

Both independent model families returned READY on the round-6 revision, and this
Spec is **Accepted as design-of-record**. The acceptance fold applied grok's six
non-blocking minors (§7.4 one-frontier framing; the `receipt.match_tuple`
non-drift check at activation; the mandatory `finish_issuance`/`compare_unmark`
rollback of a `premark_issuance` on any post-Begin refusal; the named LLP 0214
§4.8 keyring-HMAC integrity binding verified on every consult; `(app_id,
version_stream)`-scoped receipt uniqueness; and the source-key-arm non-null
`incarnation` sentinel note). None reopened a MATERIAL concern.

**Implementation deferred.** Acceptance ratifies the design contract only; it is
**not** an implementation claim. The v1 surface is deliberately
**import/migrate-provisioned apps** (RQ-1) — apps whose identity source can be
placed under whole-table custody and populated through the §2.7 authorized import
lifecycle — not apps that mint app rows from ordinary client handlers. The build
(the closed trigger, whole-table-sealed lookup, joined transaction, distinct
writers, exact receipts, the framework registries, the §5.4 resolver, and the LLP
0053/0056/0057/0059 composition) is a **separate follow-up**, not part of this
acceptance, and no code path should be wired from this document until those pieces
are implemented together and qualified per LLP 0189.
