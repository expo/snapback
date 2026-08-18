# LLP 0109: Versioned seed evolution

**Type:** Spec
**Status:** Accepted
**Systems:** Authoring, Code generation, App provisioning, Storage, Schema evolution, Auth, Inspection, Client integration, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-27
**Revised:** 2026-08-06 (LLP 0175 cadence reconciliation: relevant seed and
native changes select the complete case-by-surface dispatcher; scheduled,
release, and promotion authority still require its complete receipt). 2026-08-03
(Accepted by the author — decision sitting #2
extension, explicit commission 2026-08-03,
`issues/20260803-author-decision-sitting-2.md` — with §14's required
reconciliation set landed in the same change: dated amendments in LLP 0012,
LLP 0094, LLP 0034, LLP 0031, LLP 0040, LLP 0058, LLP 0059, LLP 0080, and
LLP 0081; status Review → Accepted.)
2026-08-01 (§18 dated amendment: the §8 membership fixture
lane lands, commissioned by LLP 0100 §8b — fixture seats through the
`MembershipWriter::Seed` writer with per-row provenance, membership
tables as legal seed/reset targets, the first-landing
`SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED` narrowing retired, and
the §6.3 reset cut delivering runtime-seat retirement with
event-3/declared-restore incarnation semantics per LLP 0056.)
2026-07-31 (LLP 0044 completion-program amendment: the
separately versioned `SeedAssetFixturesV1` sibling artifact with JCS
digest identity, file custody with no artifact-borne bytes, idempotent
`asset.ensureSeedFixture` ingestion through the trusted path, the
`{"$assetFixture": id}` placeholder resolved inside the install
transaction with refuse-whole semantics, resetInstall decomposition for
fixture-bearing seeds, app reset now clearing asset state, ordinary
quota, and the `seedAssetFixtures` capability fact — `SeedArtifactV1`
itself unchanged). 2026-07-27 (round-2 author reconciliation: scope the first
landing to fresh/same-mode install plus single-transaction reset-install/clear;
key active identity by the existing data-version stream so predecessor resets
cannot leave it active; remove migration/restore identity publication until a
separate reviewed extension; close preview, routes, gates, digests, and
carriers). 2026-07-27 (super-refine round-1 Codex reconciliation:
predecessor-unknown idempotent reset carriers; closed startup v2; empty-array
occupancy; stream-scoped version reuse; truthful receipt/restore/rollback
lineage; exact migration/reset/additive/projection semantics; hosted compiled
seed custody; separate membership/permission paths; gate/redaction precedence;
finite surface matrix). 2026-07-27 (entered the author-invoked super-refine
loop; initial focused specification for authored seed identity, safe
installation, and explicit evolution)
**Related:** LLP 0007, LLP 0010, LLP 0012, LLP 0024, LLP 0031, LLP 0034, LLP 0037, LLP 0040, LLP 0043, LLP 0044, LLP 0053, LLP 0056, LLP 0058, LLP 0059, LLP 0080, LLP 0081, LLP 0094

## Summary

Snapback seed data becomes a versioned, content-addressed installation
artifact. The author chooses an opaque `seedVersion`; codegen computes a
domain-separated digest over the exact canonical seed payload. A successful
first installation persists that identity in the same durability transaction
as the inserted rows. Repeating the same declaration is a no-op with a
`matched` outcome. Reusing a version for different bytes, presenting a new
version to a populated instance, or finding populated seed targets without a
durable identity refuses before changing schema, functions, rows, or metadata.

This Spec does **not** turn seed into an upsert or migration mechanism. Seed
installation never overwrites, deletes, adopts, or blesses nonempty durable
data. A changed seed declaration against an installed instance requires either:

1. an explicit destructive reset authorized for that target, which clears the
   instance and installs the new seed atomically; or
2. an approved LLP 0081 migration whose typed steps evolve the data and whose
   verified publication advances the seed identity atomically.

The existing untagged v0-dev `ensure` request and existing explicit
`provision` request retain their settled seed-if-empty behavior for
compatibility. Versioned installation is a new closed intent, not a field added
to those closed request or response families. A new client never downgrades a
versioned declaration to legacy seed-if-empty.

## 1. Scope and vocabulary

This Spec owns:

- the authored `seedVersion` and generated seed artifact;
- canonical seed digest computation;
- the durable seed identity and installation receipt;
- the versioned install, destructive reset-install, and clear state machines;
- ordering relative to schema provisioning and LLP 0081 migrations;
- authorization and authority-bearing application-table behavior;
- safe inspection, diagnostics, compatibility, and executable acceptance.

It does not make seed a source of application truth after installation. The
rows are ordinary mutable application data once committed. Deleting or editing
one later does not make the seed "partially applied" and does not cause a later
ensure to restore it. The durable identity means "this declaration was
installed at this stream boundary," not "the current database still equals the
fixture."

Terms:

- **authored declaration** — the checked-in `seed.json` containing
  `seedVersion` and `tables`;
- **seed artifact** — codegen's self-contained, digest-bearing
  `SeedArtifactV1`;
- **seed target** — every table key present in `tables`, including a table
  whose authored row array is empty;
- **target occupancy** — whether each seed target contains at least one
  durable row at the installation barrier;
- **durable identity** — the protected target-local record proving which seed
  artifact was installed into the current application data stream;
- **untracked data** — rows in one or more seed targets when no valid durable
  seed identity exists;
- **partial untracked data** — some, but not all, seed targets are nonempty
  when no valid durable seed identity exists.

`seedVersion` is an opaque identity token, not an ordering number. Comparing
versions lexically or numerically is invalid. "Newer" below means "a different
authored token selected by the author," not `>` under any ordering.

## 2. Authored declaration and generated artifact

### 2.1 Authored shape

The versioned source form is:

```json
{
  "seedVersion": "2026-07-27.1",
  "tables": {
    "todos": [
      {
        "_id": "welcome",
        "title": "Welcome",
        "completed": false
      }
    ]
  }
}
```

The object is closed. It contains exactly:

- `seedVersion`: a nonempty, author-chosen ASCII token matching
  `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`; and
- `tables`: the existing map from table name to an ordered array of row
  objects.

The author does not write `seedDigest`, `appId`, `formatVersion`, a timestamp,
or an installation target. Supplying any of them in the authored source is a
typed authoring error. Codegen owns those derived facts.

A source file with only `{ "tables": ... }` remains a legacy `SeedData`
declaration. Codegen may continue to validate and package it for compatibility,
but must diagnose that it lacks versioned evolution. It must not invent a
version from file mtime, Git revision, content hash, schema hash, or deployment
identity.

Changing any canonical seed content requires changing `seedVersion`. Changing
`seedVersion` without changing content is permitted but still denotes a
different installation identity and therefore requires reset or migration on
an already installed instance. This strictness makes the author's declared
boundary authoritative rather than having codegen guess intent.

### 2.2 Generated `SeedArtifactV1`

Codegen emits `snapback/generated/seed.artifact.json`:

```json
{
  "formatVersion": "snapback.seed.v1",
  "appId": "example",
  "seedVersion": "2026-07-27.1",
  "seedDigest": "sha256:<64 lowercase hexadecimal characters>",
  "tables": {
    "todos": [
      {
        "_id": "welcome",
        "title": "Welcome",
        "completed": false
      }
    ]
  }
}
```

The generated object is closed and self-contained. `appId` is the same
nonempty application identity used by the candidate schema/function pair.
Table arrays retain authored order. Object members are canonicalized; array
order is not sorted or otherwise rewritten.

Let `body` be the closed object:

```json
{
  "formatVersion": "snapback.seed.v1",
  "appId": "<appId>",
  "seedVersion": "<seedVersion>",
  "tables": "<the authored tables object>"
}
```

`seedDigest` is:

```text
sha256:<lowercase-hex(
  SHA-256(
    UTF8("snapback:seed-artifact:v1\n") ||
    RFC8785_JCS(body)
  )
)>
```

The newline is one byte `0x0a`. No BOM, trailing newline from the source file,
source path, schema hash, build time, file mode, or target identity participates
in the digest. RFC 8785 preserves array order, so reordering authored rows
changes the digest even when the row set is otherwise equal. Codegen and every
receiver recompute the digest; a supplied digest is never trusted.

The schema hash is deliberately outside the seed digest. An unchanged seed can
remain the same identity across a compatible schema evolution. The receiver
still validates every row against the candidate or installed schema before any
effect, and the install receipt records the exact schema hash under which the
rows were admitted.

The committed prior `snapback/generated/seed.artifact.json` is the v1
one-step history authority for the current `(appId, seedVersion, seedDigest)`
triple; the generated review manifest mirrors it when the separately ticketed
review surface is installed. If either prior artifact is available and the
same `(appId, seedVersion)` maps to a different digest, codegen refuses with
`SNAPBACK_SEED_VERSION_REUSED`. Runtime-definitive reuse detection is scoped to
the active `(appId, dataVersionStream)` identity: the active version paired
with another digest refuses. V1 does not retain a global or cross-reset
historical version registry. After clear/reset stream rotation, restore, or
migration away from a version, codegen/review history may still diagnose reuse,
but the runtime does not claim lineage-wide uniqueness it cannot prove.

### 2.3 Validation before effects

Codegen and the receiver both reject:

- an invalid `seedVersion`;
- an unknown format version or member;
- a missing or mismatched `appId`;
- a malformed digest or a digest that does not recompute;
- an unknown, system, retired, or non-seedable target table;
- duplicate row identities within one target;
- a row that fails the candidate schema's closed value grammar;
- a row that supplies host-owned system fields illegally;
- a target or value outside the target profile's portable limits; and
- a declaration that violates membership/authority rules in §8.

Receiver validation uses the complete candidate schema/function pair and the
resolved requested auth mode before any loaded-hash shortcut, occupancy read,
DDL, function publication, seed write, or seed-identity write. Hash equality is
evidence, never authorization and never permission to skip validation.

## 3. Closed protocol evolution

### 3.1 New `/app/ensure` intent

LLP 0012 and LLP 0094 define both `/app/ensure` directions as closed families.
Versioned seeding therefore adds a new explicit variant rather than adding
members to `provision` or changing legacy `seed`:

```json
{
  "intent": "install",
  "ensureProtocol": "snapback.ensure.seed.v1",
  "requestedMode": "dev",
  "schema": {},
  "functions": {},
  "routes": {},
  "seed": {
    "formatVersion": "snapback.seed.v1",
    "appId": "example",
    "seedVersion": "2026-07-27.1",
    "seedDigest": "sha256:...",
    "tables": {}
  }
}
```

The `install` object is closed. Required fields are exactly `intent`,
`ensureProtocol`, `requestedMode`, and `seed`. Optional fields are exactly
`schema`, `functions`, and `routes`. At least the required seed is always
effect-bearing, even when its table map or every row array is empty, because a
successful first install writes durable seed identity.

`ensureProtocol` has the sole v1 value `snapback.ensure.seed.v1`.
`requestedMode` and pair-completeness rules are LLP 0012's: a first sessions
deployment requires a complete v1-sessions schema/function pair; a later
request may use an already loaded, attested sibling. The seed artifact's
`appId` must equal the coherent pair's `appId`. `routes`, when present, is
validated against that same candidate function generation before effects.

The success response is the new closed family:

```json
{
  "intent": "install",
  "ensureProtocol": "snapback.ensure.seed.v1",
  "schema": "matched",
  "functions": "matched",
  "routes": "skipped-absent",
  "seed": {
    "outcome": "matched",
    "identity": {
      "formatVersion": "snapback.seed-identity.v1",
      "appId": "example",
      "dataVersionStream": "opaque-stream-id",
      "seedVersion": "2026-07-27.1",
      "seedDigest": "sha256:..."
    },
    "changedCount": 0,
    "currentHead": 12,
    "establishingReceipt": {
      "formatVersion": "snapback.seed-receipt.v1",
      "operation": "install",
      "outcome": "installed",
      "commitVersion": 1
    },
    "receiptDigest": "sha256:..."
  },
  "profile": "dev"
}
```

Success vocabularies are closed:

- schema/functions: `matched | provisioned | skipped-absent`;
- routes: `matched | provisioned | skipped-absent`;
- seed: `installed | matched`.

`gated`, `skipped-nonempty`, `migration-required`, and `partial` are not
successful versioned outcomes. They are typed refusals from §9. Unlike the
legacy inspect-friendly request, an unauthorized or profile-forbidden
`install` fails before occupancy or identity comparison; it does not return
`gated`.

The existing Public `attest` DTO and outcome remain byte-for-byte closed and
unchanged. Public attestation cannot carry or return seed material. Safe seed
identity is available through the authorized inspection projection in §10,
not by widening `attest`.

### 3.1.1 Closed pre-bind startup carrier

Pre-bind startup uses new `StartupArtifactsV2`, not the open v1 `SeedData`
member:

```json
{
  "startupProtocol": "snapback.startup-artifacts.v2",
  "schema": {},
  "functions": {},
  "routes": {},
  "seedInstall": {
    "protocol": "snapback.ensure.seed.v1",
    "artifact": {}
  }
}
```

The object and discriminated `seedInstall` branch are closed. A predecessor
that knows only `StartupArtifactsV1` rejects the carrier before it can treat
`.tables` as legacy seed; new tooling never embeds a `SeedArtifactV1` in the v1
`seed` member or retries through it.

In sessions mode this composes LLP 0058's two transactions. The stage
transaction validates the complete pair/artifact, installs application rows,
maintained projections, seed identity/receipt, and pending deployment metadata
atomically but does not activate the catalog binding. The consume transaction
revalidates the staged digest/stream/receipt, activates the catalog/provider
binding, and publishes the prepared function/routes generation. A crash after
stage restarts from the durable staged receipt and never reseeds; a failed or
quarantined consume leaves admission closed and the staged successor
reconcilable. Fresh dev mode may perform the same closed steps in one
transaction because it has no separate catalog authority. LLP 0058 receives a
dated amendment before acceptance.

`install` admits a requested auth mode different from the active mode only
through that complete stage/consume protocol; it never performs an in-place
mode flip. During `MODE_PENDING`, versioned install refuses
`SNAPBACK_SEED_MODE_PENDING` because LLP 0012's existing privileged
`provision` recovery is the sole branch allowed to complete or repair the
pending transition. The operator first completes or cancels that transition
through its existing recovery contract, then retries versioned install against
the now-active mode. Identity and the establishing receipt are written at the
stage commit; they do not imply catalog admission until consume succeeds.

### 3.2 Capability negotiation and old servers

The target capability manifest gains the closed value
`snapback.ensure.seed.v1` in `supportedEnsureProtocols`. Absence means
unsupported. A client holding `SeedArtifactV1` checks this fact before sending
`install`.

An old local server will reject the unknown `intent`; an old hosted open
decoder might otherwise ignore new members. Therefore a new client must never
retry a failed or unsupported versioned install as legacy `provision` or
untagged ensure. It fails locally with
`SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED`. The new hosted implementation
must validate the `install` branch against the same closed generated schema as
the Rust arm even while LLP 0094's older hosted ensure variants remain open.

`app.ensure.input.schema.json` and `app.ensure.output.schema.json` are
regenerated from the Rust authority under LLP 0037. Positive and negative
fixtures cover the new branch on both arms. This Spec does not reopen any
existing branch.

### 3.3 Predecessor-unknown, idempotent reset family

Versioned reset never reuses the legacy reset route or `app.reset` host
operation: deployed predecessors may discard its body and reset anyway. The
new direct routes are `/app/reset-install-v1` and `/app/reset-clear-v1`; the
multiplexed host operations are `app.resetInstallV1` and `app.resetClearV1`.
An old local or hosted binary does not recognize those names and therefore
cannot perform the effect. Capability `snapback.reset.seed.v1` names exact
support for all four carriers and their closed schemas.

A client preflights `snapback.reset.seed.v1` before constructing or sending
either destructive request. Absence fails locally with
`SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED`; the client never retries on the
legacy reset route or `app.reset`, because those predecessors may execute a
reset while discarding the versioned body.

Every request carries `operationId` (a never-reused UUIDv7),
`predecessorDataVersionStream`, and `requestDigest`. The digest is
domain-separated JCS over the complete body except itself. The durable reset
journal keys `(operationId, requestDigest, predecessor stream)`. An exact retry
returns the original receipt without rotating streams or writing again;
changed bytes under the same id, a changed predecessor, or a concurrent winner
refuse before effects.

`resetInstall` carries the complete successor pair and seed:

```json
{
  "intent": "resetInstall",
  "resetProtocol": "snapback.reset.seed.v1",
  "operationId": "019...",
  "predecessorDataVersionStream": "opaque-current-stream",
  "requestDigest": "sha256:...",
  "schema": {},
  "functions": {},
  "routes": {},
  "seed": {
    "formatVersion": "snapback.seed.v1",
    "appId": "example",
    "seedVersion": "2026-07-27.1",
    "seedDigest": "sha256:...",
    "tables": {}
  }
}
```

and:

```json
{
  "intent": "clear",
  "resetProtocol": "snapback.reset.seed.v1",
  "operationId": "019...",
  "predecessorDataVersionStream": "opaque-current-stream",
  "requestDigest": "sha256:..."
}
```

`resetInstall` destructively clears the app instance and installs the supplied
complete successor schema/function/routes pair plus artifact into the new
data-version stream in one transaction. `clear`
destructively clears the app instance and leaves seed identity absent in the
new stream. Both return a closed `SeedOperationReceiptV1` with outcome
`reset-installed` or `cleared`.

The legacy `{ "seed": SeedData }` and empty reset bodies retain their current
wire and behavior. A versioned client does not use those bodies. There is no
v1 operation that clears only seed metadata while preserving application rows:
when seed targets remain populated it would manufacture untracked data and
force later install refusal; when rows were separately emptied it would erase
the provenance barrier and make a later install appear eligible. Both outcomes
require an explicit whole-instance reset path instead.
Once a target has admitted versioned seed metadata, deployment compatibility
does not admit a predecessor binary that cannot preserve/clear that metadata
through its reset paths.

## 4. Durable identity and receipt

### 4.1 Identity scope

A successful install stores this closed record in protected host metadata:

```json
{
  "formatVersion": "snapback.seed-identity.v1",
  "appId": "example",
  "dataVersionStream": "opaque-stream-id",
  "seedVersion": "2026-07-27.1",
  "seedDigest": "sha256:..."
}
```

Its logical key is `_snapback_meta/snapback.seed.identity.v1`. The record is
scoped to exactly `(appId, dataVersionStream)`, where `dataVersionStream` is the
app-data stream identity already used by runtime state and LLP 0081's local
audience. It is not global per source tree, target profile, machine, user,
database pathname, auth mode, or deployment release.

The scope has these consequences:

- an ordinary restart or code rollout retains the identity;
- an auth-mode transition over the same app-data stream retains it;
- a destructive reset rotates the data-version stream and atomically clears or
  replaces it;
- a byte backup includes the record because it is part of durable app state;
- restore into a replacement target follows the restore protocol's stream
  rotation and rewrites the record's `dataVersionStream` only inside the same
  sealed restore transaction and receipt; and
- a record whose `appId` or stream does not match the active instance is
  corrupt, not portable evidence to adopt.

The identity does not include current schema hash, current row count, current
commit version, auth mode, or install time. Those are receipt facts, not seed
identity. Equality is exact equality of all five members after format
validation.

### 4.2 Durable operation receipt

An effectful install, migration advance, reset-install, clear, restore rebase,
or migration rollback-republish stores the
latest closed `SeedOperationReceiptV1` at
`_snapback_meta/snapback.seed.last-receipt.v1` in the same transaction:

```json
{
  "formatVersion": "snapback.seed-receipt.v1",
  "operation": "install",
  "outcome": "installed",
  "operationId": "019...",
  "requestOrPlanDigest": "sha256:...",
  "appId": "example",
  "dataVersionStream": "opaque-stream-id",
  "predecessorIdentity": null,
  "successorIdentity": {},
  "schemaHash": "sha256:...",
  "commitVersion": 1,
  "changedCount": 4,
  "authorizationChanged": false
}
```

Closed vocabularies are:

- operation:
  `install | reset-install | clear | migration | restore-rebase |
  rollback-republish`;
- outcome:
  `installed | reset-installed | cleared | evolved | restored |
  predecessor-restored`.

`operationId` is the durable install/reset/migration/restore operation identity;
`requestOrPlanDigest` binds its canonical request or LLP 0081 plan.
`predecessorIdentity` and `successorIdentity` are nullable
`SeedIdentityV1`. `changedCount` includes direct seed rows plus maintained
projection writes; a separate `seedRowCount` records only authored rows.
`authorizationChanged` is the exact result of the existing
authorization commit hook, not an inference from table names. The receipt
records no row values, principals, credentials, secrets, source path, or
carrier path.

The receipt body is RFC 8785 canonicalized and its external `receiptDigest` is
computed with:

```text
SHA-256(
  UTF8("snapback:seed-receipt:v1\n") ||
  RFC8785_JCS(receiptBody)
)
```

The successful carrier response is the closed
`SeedOperationObservationV1`:
`{outcome, identity, currentHead, changedCount, establishingReceipt,
receiptDigest}`. `establishingReceipt` is the complete durable receipt body;
`currentHead` is the current observation and is never described as that
receipt's commit. A `matched` ensure performs no durable write, returns
`changedCount: 0` and the current head, and returns the still-current
establishing/restore/rollback receipt and digest. Thus repeated startup does not
churn metadata or application versions and cannot pair a current head with a
mislabelled historical commit.

Valid protected pairs are exhaustive:

- present identity + a latest receipt whose non-null successor equals it;
- absent identity + no receipt on a never-versioned stream;
- absent identity + `clear/cleared` whose successor is null; and
- a staged sessions successor + its unconsumed `install` receipt and exact
  pending-deployment digest.

Restore rebase and rollback-republish always write a new receipt whose
successor equals the active identity; they never leave an old `evolved` receipt
beside a restored predecessor. Any other pair is corrupt for seed/admin/
migration operations, but does not by itself fence ordinary application
reads/writes whose data/schema authority remains valid.

The receipt is operational evidence, not execution authority. Editing it or
the identity directly is corruption. The unkeyed digest assumes trusted host
storage and detects accidental/protocol inconsistency, not a malicious
filesystem/operator who can rewrite metadata and recompute SHA-256. Neither
digest authorizes provisioning, migration, reset, restore, or membership
changes.

## 5. Installation state machine

### 5.1 Barrier-time classification

After authorization and complete artifact validation, the runtime acquires the
target's serialized write/admission barrier and reads the durable identity and
seed-target occupancy from one snapshot. Each target is `empty` when a bounded
existence query finds no row, otherwise `nonempty`. The classification is:

| State | Durable identity | Candidate target occupancy |
| --- | --- | --- |
| `uninstalled-empty` | absent | every target empty |
| `untracked-nonempty` | absent | every target nonempty and at least one target exists |
| `untracked-partial` | absent | a proper subset of targets is nonempty |
| `installed` | present, structurally valid, current app/stream | occupancy is not consulted for matching |
| `corrupt` | malformed, unknown format, wrong app/stream, or inconsistent with its durable receipt | irrelevant |

A truly empty `tables` map classifies vacuously as `uninstalled-empty` when
identity is absent. Every named target is physically checked even when its
authored array is `[]`; `{todos:[]}` over a populated `todos` table is
`untracked-nonempty`, never an identity-only install or adoption. A single
target cannot be `untracked-partial`: it is empty or nonempty.

Occupancy is consulted only while identity is absent. After installation, rows
may be changed by ordinary application operations; scanning them to infer
whether a seed is still installed would confuse fixture bytes with durable
provenance.

### 5.2 Exact transitions

For `intent: "install"`:

| Current state | Presented artifact | Result | Durable transition |
| --- | --- | --- | --- |
| `uninstalled-empty` | valid | `installed` | insert all rows and persist identity + receipt |
| `installed` | exact same `SeedIdentityV1` | `matched` | none |
| `installed` | same app/version, different digest | `SNAPBACK_SEED_VERSION_REUSED` | none |
| `installed` | same app, different version or digest | `SNAPBACK_SEED_EVOLUTION_REQUIRED` | none |
| `untracked-nonempty` | any | `SNAPBACK_SEED_NONEMPTY_UNTRACKED` | none |
| `untracked-partial` | any | `SNAPBACK_SEED_PARTIAL_UNTRACKED` | none |
| `corrupt` | any | `SNAPBACK_SEED_IDENTITY_CORRUPT` | none |

The same-version/different-digest row takes precedence over the general
evolution row because it identifies version reuse or artifact tampering. An
`appId` mismatch is rejected during artifact/pair preflight and never reaches
this table.

There is no transition from untracked data to `installed`, no "adopt,"
"accept current," "force," or "continue and remember" flag, and no per-table
completion. The remedies for untracked or partial data are:

- leave it untouched and remove the versioned install from this deployment; or
- run an explicit authorized clear/reset and then install.

V1 migration is not an adoption remedy for untracked data; §7 admits evolution
only from a valid installed predecessor identity.

The install path uses inserts only. It never updates on conflict, deletes
unexpected rows, truncates a table, or retries table-by-table.

### 5.3 Legacy behavior

The existing untagged v0-dev request and existing explicit `provision` request
keep LLP 0034's behavior:

- if every legacy seed target is empty, insert the legacy `SeedData` and return
  `seeded`;
- if any target is nonempty, return `skipped-nonempty` and write nothing;
- if provisioning is profile-gated, return `gated` without scanning;
- if no seed is supplied, return `skipped-absent`; and
- never write `SeedIdentityV1` or a versioned seed receipt.

In particular, a partially populated legacy target continues to collapse to
`skipped-nonempty` for wire compatibility. It remains untracked. A later
versioned `install` sees the actual per-target occupancy and refuses
`SNAPBACK_SEED_PARTIAL_UNTRACKED`; legacy success or skip is never retroactive
identity evidence.

A legacy reset with raw seed first clears any prior versioned identity as part
of the destructive transaction, then leaves the newly seeded data untracked.
An empty legacy reset clears the identity with the data. No legacy operation
can create, preserve across a reset, or silently advance versioned identity.

## 6. Ordering and atomicity

### 6.1 Prepare before effect

One `install` request has a prepare phase and a commit/publication phase.
Prepare completes, in order:

1. parse generic JSON/framing and extract only enough closed discriminant data
   to recognize or conservatively classify the effect-bearing branch;
2. resolve request intent, auth mode, principal, and profile, then apply LLP
   0031's required gate (including indeterminate effect-bearing bodies);
3. only after that gate, decode the exact closed DTO and protocol token;
4. validate the complete schema/function pair, routes, target capabilities,
   seed artifact, recomputed digest, app identity, explicit row `_id` values,
   all rows, and the candidate maintained-projection graph; projection output
   tables are never seed targets;
5. classify whether schema change is safe additive provisioning or requires
   LLP 0081 migration;
6. prepare the complete function generation without publishing it; and
7. classify candidate-table physical absence/collision without DDL (a missing
   safely creatable candidate table counts empty), then acquire the target
   write/admission barrier and re-read pair identity, seed identity, physical
   catalog, and occupancy before selecting a §5 transition.

Any failure through step 7 leaves schema, functions, routes, rows, app
versions, authorization epochs, seed identity, and seed receipts unchanged.
A matching loaded hash cannot move validation or authorization after the
shortcut.

### 6.2 Fresh/additive install transaction

For an admitted `uninstalled-empty` transition, the target's one durable
transaction performs:

1. revalidate the predecessor pair, stream, identity absence, and target
   emptiness under the write lock;
2. apply safe additive table/column preparation admitted by LLP 0007;
3. insert seed rows through the sanctioned bulk mutation path, using the
   table-class-specific writer rules in §8;
4. maintain every active/candidate LLP 0080 projection sourced by those rows in
   the same transaction, accounting reverse-index reads and derived writes;
5. run membership vocabulary, provenance, referential, `lastHolder`, unique,
   required-field, and all other final-state validation;
6. install generated/user indexes;
7. enforce the aggregate 1,024 direct-plus-derived application-write ceiling
   and advance the app commit version exactly once when at least one application
   row changed;
8. run the existing authorization commit hook over the complete direct and
   derived change set;
9. persist `SeedIdentityV1`, `SeedOperationReceiptV1`, deployment metadata,
   and any authorization witness; and
10. commit.

An empty seed still persists identity and receipt atomically, but does not
invent an application data version when no application row changed. Its
receipt records the unchanged head and `changedCount: 0`.

An already `installed`/`matched` identity plus safe additive schema follows a
separate transition: it applies the additive schema/projection preparation and
publishes the compatible generation atomically while leaving seed identity and
establishing receipt bytes unchanged. It cannot route through the fresh-install
state machine or write a new seed receipt merely because schema changed.

Function and route candidates publish only from the successfully committed,
still-admitted deployment generation. A pre-commit failure discards them. A
lost or failed post-commit acknowledgement uses the durable identity and
receipt to classify the operation as committed or rolled back; it never
replays seed inserts. If the target cannot establish commit certainty, it
returns the existing uncertain-operation class and keeps serving admission
closed until reconciliation reads the durable records.

No observer may see seeded rows without the matching identity, or the matching
identity without all seeded rows and final-state validations. Durable live
publication occurs only after commit and uses the transaction's exact app and
authorization versions.

### 6.3 Reset-install and clear

`resetInstall` composes the existing LLP 0059 coordinated reset with versioned
seed installation:

1. validate the predecessor stream, operation id/request digest, complete
   successor pair, compiled/supplied seed authority, and candidate projection
   graph before closing lanes;
2. close and drain all reset-governed lanes;
3. rotate the data and authorization stream incarnations;
4. clear app data, retained app work, prior seed identity, and prior receipt;
5. install the complete successor pair, insert/validate the new seed through
   the class-specific writer, and maintain all projections under the aggregate
   write bound;
6. persist its identity scoped to the successor data stream and its
   `reset-installed` receipt; and
7. commit the reset-operation journal and publish the reset boundary.

Those are one durability transaction. A duplicate row, invalid membership,
commit-boundary injection, or identity-write failure restores the complete
predecessor, including its old stream and seed identity.

`clear` performs the same coordinated reset without row insertion. It commits
identity absence and a `cleared` receipt in the successor stream. A standalone
metadata clear is forbidden. Lost-response retry returns the journaled receipt
without repeating any step.

## 7. Schema evolution and seed evolution

### 7.1 Seed never substitutes for migration

`install` may accompany only a fresh or LLP 0007-safe additive schema
provision. If the candidate schema requires a reviewed migration, ensure
refuses `SNAPBACK_SEED_MIGRATION_REQUIRED` before schema, function, row, or
identity effects. It never applies schema first and discovers seed refusal
afterward.

For an existing installed instance:

- unchanged seed identity plus safe additive schema may provision the schema
  while seed reports `matched`;
- unchanged seed identity plus a non-additive schema follows LLP 0081 and
  reports `matched` only after the approved migration has published;
- changed seed identity, with or without schema change, requires reset or an
  approved seed-aware migration; and
- absent identity plus nonempty or partial targets cannot be repaired by
  schema application.

### 7.2 LLP 0081 plan binding

Because LLP 0081's `migration-plan-v1` is closed, seed-aware evolution uses
`migration-plan-v2`, whose only added canonical member is:

```json
{
  "seedTransition": {
    "kind": "evolve",
    "predecessorIdentity": {},
    "successorIdentity": {},
    "predecessorArtifactDigest": "sha256:...",
    "successorArtifactDigest": "sha256:...",
    "predecessorTablesDigest": "sha256:...",
    "successorTablesDigest": "sha256:..."
  }
}
```

The v2 seed-transition vocabulary is:

- `{"kind":"unchanged","identity": SeedIdentityV1 | null}`, binding the exact
  current identity/absence on both sides; or
- `evolve`, binding one valid installed predecessor identity and one valid
  successor identity for the same `appId` and data stream, both artifact and
  tables digests, and the exact typed migration-step write set.

`seedTransition` participates in LLP 0081's length-framed `planDigest`,
approval, preview, journal, checkpoint, publication, and rollback evidence.
Journal events record predecessor/successor identity hashes and artifact
digests without row bytes. A v1 executor rejects `migration-plan-v2` before
effects; a v2 executor rejects a missing transition member.

There is no `adopt`, `infer`, `force`, or metadata-only `advance` transition.
`evolve` is admitted only when:

- the author explicitly changed `seedVersion`;
- the plan binds both complete seed artifacts and their digests;
- typed migration steps, not the seed installer, express every intended data
  change. When the tables digests are equal, a version-only evolution may have
  no DML while still proving the exact installed predecessor and approved
  successor; when they differ, metadata-only evolution is forbidden;
- plan preconditions and write sets cover every changed seed target;
- the independent expected-value proof and final validation required by LLP
  0081 succeed; and
- the migration is not merely observing already-nonempty untracked rows and
  writing identity over them.

If current data is untracked, v1 migration cannot establish seed identity by a
no-op proof or metadata write. The operator must reset-install, or a later
reviewed migration profile must define a transformation that constructs a new
successor generation from declared predecessor data without treating the
incoming seed as an overwrite. This Spec deliberately provides no generic
adoption escape hatch.

The successor seed identity is written in the migration's atomic publication
transaction after all typed steps and verification have succeeded, beside the
successor schema/storage generation and `SeedOperationReceiptV1` with
`operation: "migration"` and `outcome: "evolved"`. It is never advanced at
preview, approval, staging, a batch checkpoint, or `published-held`.

Rollback follows LLP 0081:

- before publication, the predecessor identity remains authoritative;
- generation republish restores the predecessor identity in the same atomic
  rollback publication as predecessor data and schema and writes a
  `rollback-republish/predecessor-restored` receipt;
- a reverse migration binds the reverse seed transition explicitly; and
- restore carries the backed-up identity with the restored data, then
  re-scopes it to the restore's successor data stream inside the sealed
  restore transaction and writes a `restore-rebase/restored` receipt.

Deployment ordering consumes both schema compatibility and seed transition.
Code/functions that present a successor seed artifact cannot activate against
the predecessor identity until the migration receipt proves publication. A
seed identity match alone never proves schema or function compatibility.

## 8. Authorization and authority-bearing rows

The `install`, `resetInstall`, and `clear` branches are effect-bearing admin
operations:

- branch authorization occurs before pair hashes, seed digest comparison,
  durable identity lookup, or occupancy reads;
- `install` uses the same `AdminWrite` or pre-bind startup authority and
  positive environment/profile gate as explicit provisioning;
- `resetInstall` and `clear` use the stricter destructive reset authority and
  profile gate from LLP 0031/LLP 0059;
- sessions-mode same-mode provisioning and activation remain under LLP 0058's
  admission fence; and
- no public, app-data, browser, handler, MCP argument, or ordinary mutation
  can mint the host-owned seed writer carrier.

Declared LLP 0056 membership tables use a new bulk in-transaction
`MembershipWriter::Seed` primitive, backed by the unforgeable
`privileged(seed)` carrier. It stamps writer provenance per row and the complete
same-transaction state must pass:

- exact role vocabulary and non-null authority axes;
- provenance stamping for the `seed` writer;
- uniqueness, referential integrity, and immutable-axis rules;
- declared membership activation rules; and
- `lastHolder` protection, which applies to seed and admin writers too.

Generic `permissionBacking` tables are not membership tables and receive no
role/provenance vocabulary. They use ordinary closed-row/schema validation plus
the existing authorization commit hook over the complete direct/derived change
set. Seed does not bypass either path because an instance is fresh. The
resulting authorization change and permission-epoch witness are part of the
same commit and receipt.

Sessions-mode membership seed is admitted only after the provider catalog has a
recoverable effective principal eligible to satisfy `lastHolder`; seed cannot
create that catalog. Missing, deactivated, stranded, or invalid holders refuse
the stage transaction. Provider/principal catalog bootstrap therefore precedes
membership seed validation, while catalog activation still follows LLP 0058's
stage/consume fence.

Provider credentials, auth-provider catalog rows, signing material, session
records, grants, secret values, protected `_snapback_*` tables, and other
host-owned authority are never seed targets. Their owning bootstrap,
registration, secret, or control-plane protocol remains the only writer.
`AdminWrite` does not convert them into seedable application tables.

On hosted targets LLP 0040's compiled-seed invariant remains authoritative.
Caller bytes attest the requested artifact identity but are never the
production write source. The clean compiled release contains one
`SeedArtifactV1`; the coordinator recomputes and requires exact
app/version/digest/table identity, then applies only those compiled bytes.
Malicious/mismatched caller content, release rollback, and concurrent clean
object creation refuse without falling back to caller or legacy seed.

Inspection and diagnostics never echo row values, membership principals,
credentials, tokens, secrets, filesystem paths, or seed source bytes. The
seed digest and opaque version are identity facts, not secret-storage
mechanisms; authors must still not put credentials into seed data.

## 9. Stable diagnostics

These codes are stable:

| Code | Meaning | Safe remediation |
| --- | --- | --- |
| `SNAPBACK_SEED_DECLARATION_INVALID` | authored or generated seed shape, token, target, or row is invalid | fix the cited declaration location and regenerate |
| `SNAPBACK_SEED_DIGEST_MISMATCH` | received digest does not recompute from the closed artifact | regenerate from trusted source; do not retry |
| `SNAPBACK_SEED_VERSION_REUSED` | one app/version names a different digest than generated history or active durable identity | restore the original content or author a new version and migrate/reset |
| `SNAPBACK_SEED_PROTOCOL_UNSUPPORTED` | receiver knows the install branch but not the requested protocol/artifact format | upgrade the target; do not downgrade |
| `SNAPBACK_SEED_NONEMPTY_UNTRACKED` | all candidate targets are nonempty and no durable identity exists | preserve data; choose explicit migration or destructive reset |
| `SNAPBACK_SEED_PARTIAL_UNTRACKED` | only some candidate targets are nonempty and no durable identity exists | preserve data; investigate the partial state, then migrate or reset |
| `SNAPBACK_SEED_EVOLUTION_REQUIRED` | installed identity differs from the presented valid identity | run an approved seed-aware migration or explicit reset-install |
| `SNAPBACK_SEED_MIGRATION_REQUIRED` | schema or seed transition cannot use the fresh/additive install path | preview and approve LLP 0081 migration, or reset where authorized |
| `SNAPBACK_SEED_IDENTITY_CORRUPT` | durable identity/receipt is malformed, mismatched, or scoped to another app/stream | stop seed/admin/migration effects and recover from a verified backup or operator repair |
| `SNAPBACK_SEED_MODE_PENDING` | a versioned install was attempted while an auth-mode transition is pending | complete or cancel the existing LLP 0012 recovery, then retry |
| `SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED` | client capability preflight found no safe versioned install path | upgrade/configure the target; never send legacy seed automatically |

HTTP registration is closed: declaration/digest errors are `400`; version
reuse, untracked/partial, evolution/migration required, corrupt identity, and
mode-pending conflicts are `409`; a receiver-known unsupported protocol is
`426`; authorization/profile gates retain their existing `401`/`403`; and the
client-preflight code is local-only and never an HTTP response. All server
codes are added to LLP 0012's allow-listed status mapper in the same landing;
an unknown seed code remains `500`.

Seed-identity corruption blocks versioned seed install, migration publication,
reset-install/clear, and restore re-scope. It does not by itself stop ordinary
already-admitted application reads/writes or unrelated admin inspection; an
underlying storage/auth integrity failure may independently impose a wider
quarantine under its owning contract.

Existing schema, auth, profile, membership, storage-version, commit-uncertain,
and migration diagnostics retain precedence when their preflight fails first.
In particular:

1. generic invalid JSON/framing may fail before branch recognition, but a
   recognizable or indeterminate effect-bearing body receives LLP 0031's
   strongest required gate before detailed closed-DTO errors;
2. authorization/profile refusal wins before shape, artifact, digest,
   identity, or occupancy disclosure;
3. artifact/digest/app/pair validation wins before state comparison;
4. identity corruption wins before version comparison;
5. same-version/different-digest wins over general evolution; and
6. partial untracked wins over general nonempty untracked.

Safe details may contain format/protocol versions, `appId`, `seedVersion`,
digests, target-table names, empty/nonempty target counts, schema hash,
profile, and opaque stream identity. They never contain rows or secret-bearing
values.

Seed wraps underlying membership/schema/storage failures in a schema-owned
public projection that removes principals, resources, row values, filesystem
paths, provider/credential facts, and secret-like argument bytes from response,
log, and receipt. The original bounded detail is available only through LLP
0031's separately gated sessions `AdminSecretRead`/developer twin where its
own policy permits it. Tests use secret-like membership values to prove the
public projection rather than assuming current internal diagnostics are safe.

## 10. Inspection and developer receipts

Authorized app inspection adds this closed projection:

```json
{
  "seed": {
    "protocol": "snapback.ensure.seed.v1",
    "state": "installed",
    "identity": {},
    "lastReceipt": {},
    "lastReceiptDigest": "sha256:..."
  }
}
```

`state` is `absent | installed | corrupt`. Inspection without a candidate
artifact does not guess `untracked-nonempty` or `untracked-partial`, because it
has no authoritative target set. An install dry-run may add a candidate-scoped
observation with `uninstalled-empty | untracked-nonempty |
untracked-partial | installed | corrupt` and only target names/counts, never
rows.

The inspector recomputes and validates the protected record and receipt before
projecting them. A corrupt record is not omitted or treated as absent. Public
inspection may report only protocol support and `state`; identity, receipt,
stream, target names, and counts require the existing admin inspection
authority.

`snapback generate`, `snapback dev`, Vite lifecycle integration, authorized app
inspection, and the existing host-op JSON carrier consume the same structured
result. V1 does not invent a separate `snapback ensure` command; adding one
requires its own target/authority/dry-run/exit-code contract. Human output for
every attempted versioned install includes:

- requested `seedVersion` and abbreviated digest;
- active version/digest when authorized;
- `installed`, `matched`, or the stable refusal code;
- changed row count and commit version on success; and
- one direct remediation: migrate, reset-install, upgrade, or inspect partial
  state.

There is no quiet fallback from evolution-required to "preserving existing
data" while printing success. Preserving the data is correct, but startup must
surface that the new declaration was **not** installed.

Dry-run performs the full authorization, artifact validation, state
classification, and migration requirement analysis under a read-consistent
snapshot, returns a non-authoritative observation receipt, and writes nothing.
The real operation rechecks every fact under its write barrier.

## 11. Compatibility and rollout

Rollout order is:

1. land Rust-owned artifact, request, response, reset, identity, and receipt
   schemas plus positive/negative fixtures;
2. land receiver support, protected metadata, transaction semantics,
   inspection, and capability advertisement on each arm;
3. land codegen emission and review-manifest history checks;
4. land client capability preflight and closed response decoding;
5. migrate one demo's authored seed by adding `seedVersion`, regenerate, and
   prove fresh/repeat/evolution/reset behavior; then
6. migrate remaining demos and make versioned install the managed dev-loop
   default.

At every intermediate point:

- new server + old client continues legacy behavior;
- new client + old server refuses locally and does not downgrade;
- legacy source + new codegen/server continues legacy behavior and creates no
  identity;
- versioned source + new codegen produces one deterministic artifact;
- local and hosted arms use the same committed schemas and digest vectors; and
- a target advertises `snapback.ensure.seed.v1` only when transaction,
  inspection, reset, diagnostics, and conformance are all implemented.

Adding `seedVersion` to an existing demo whose database is already populated
does not adopt that database. The first versioned dev start refuses and tells
the developer to inspect, migrate, or explicitly reset. Tooling may offer the
command, but cannot execute destructive reset without the existing explicit
authority and profile checks.

## 12. Executable acceptance

The Spec is implementable only when one shared corpus proves all of the
following against the direct Rust API, served local HTTP API, packaged JS
client/dev loop, and hosted arm where that arm claims the capability.

The committed conformance manifest is a non-vacuous case-by-surface matrix:

| Surface | Install | Reset/clear | Required before capability |
| --- | --- | --- | --- |
| Rust storage/local API | required | required | yes |
| local HTTP `/app/ensure` + new reset routes | required | required | yes |
| host ops `app.ensure` + new v1 reset ops | required | required | yes |
| `StartupArtifactsV2` dev | required | n/a | yes |
| `StartupArtifactsV2` sessions stage/consume | required | n/a | yes for sessions |
| packaged client/dev/Vite | required | explicit admin only | yes |
| hosted compiled-seed arm | required or GAP | required or GAP | every applicable row before advertisement |

Each row names its runner, expected case count, exact capability predicate, and
`required | unsupported | not-applicable` reason. Zero cases, an unrecognized
runner, or an unexplained skip fails the manifest. A hosted arm may remain a
machine-readable GAP, but cannot advertise the single protocol bit while
skipping reset, inspection, compiled custody, or transaction rows.

### 12.1 Artifact and protocol

- Two clean checkouts generate byte-identical `SeedArtifactV1` and digest from
  the same explicit source; golden vectors cover object-key reordering,
  Unicode, numbers, empty tables, empty row arrays, and row-array reordering.
- Editing content without changing `seedVersion` is refused by generated
  history when available and by the runtime against active identity.
- Malformed version, digest, app mismatch, unknown member/format/protocol,
  invalid row, and system-table target all fail before effects.
- Generated request/output/reset schemas accept every valid variant and reject
  smuggled fields, legacy/versioned mixtures, missing discriminants, and
  invalid outcome vocabulary on both arms.

### 12.2 Install state machine

- Fresh empty targets return `installed`; rows, one identity, one receipt,
  app-version change, and authorization witness are from one commit.
- Repeating the byte-identical request after restart returns `matched`, changes
  no row or metadata byte, and does not advance app or authorization versions.
- Mutating or deleting installed rows and repeating the same request still
  returns `matched` and does not restore fixture data.
- Same version/different digest and different version both refuse with the
  exact precedence codes and preserve schema, functions, routes, rows,
  versions, identity, receipt, and live state.
- Identity-absent all-nonempty and partial target matrices refuse with their
  distinct codes, including named empty-array targets over populated data.
  Neither creates identity or fills an empty table; only an empty table map is
  vacuously installable.
- Two concurrent first installs serialize: one commits `installed`; the other
  observes the durable identity and returns `matched`. No duplicate or partial
  seed is visible.
- Failure injection after every transactional step, immediately before commit,
  and at commit acknowledgement proves either the complete predecessor or the
  complete installed successor; reconciliation never replays inserts.
- Projection-source seeds maintain exact derived rows in the same version and
  authorization hook, count direct plus derived writes, and roll back on
  fan-out overflow; direct projection-output targets refuse.

### 12.3 Legacy, reset, restore, and migration

- Legacy all-empty, any-nonempty, partial, gated, and absent cases retain exact
  `seeded | skipped-nonempty | gated | skipped-absent` behavior and never write
  versioned identity.
- `resetInstall` rotates data/auth streams, clears predecessor state, installs
  the complete successor pair, rows/projections and successor-scoped identity,
  and publishes one reset boundary;
  injected failure restores the predecessor stream, data, identity, and
  subscriptions.
- `clear` rotates streams, removes all app rows and identity, and persists a
  redacted `cleared` receipt. There is no metadata-only clear.
- exact response-loss/concurrent retries of reset-install/clear return one
  journaled receipt and rotate once; stale predecessor, reused operation id,
  changed digest, legacy route, and old host-op carriers refuse before effects.
- A legacy reset over a versioned instance clears identity and leaves any raw
  legacy seed untracked; later versioned install refuses rather than adopting.
- Backup/restore keeps data and seed evidence together and re-scopes identity
  only inside the sealed restore transaction.
- A migration-required schema refuses before ensure effects. A valid LLP 0081
  `evolve` plan binds both seed identities, proves typed data evolution, writes
  successor identity only at publication, and restores predecessor identity
  on pre-publication failure or generation republish.
- version-only/equal-tables evolution may use an approved no-DML v2 transition;
  changed table bytes require typed DML, and restore/rollback each writes a
  truthful successor receipt.
- A metadata-only migration attempt, absent-to-present identity adoption over
  nonempty data, and successor activation before seed-transition publication
  all fail.

### 12.4 Auth, inspection, and developer experience

- Public attest/browser/app-data callers cannot submit or learn versioned seed
  material; AdminWrite/pre-bind startup and destructive reset authorities are
  tested independently from the profile gate, including matching hashes.
- Membership seed rows carry the `seed` writer provenance and exercise valid
  roles, invalid roles, null axes, uniqueness, referential integrity, and
  `lastHolder`; each failure rolls back identity and every row.
- Auth-provider catalog, credential, secret, and protected system-table seeds
  are refused even to AdminWrite.
- Inspection distinguishes absent/installed/corrupt, validates receipt digest,
  redacts rows and sensitive values, and requires admin authority for detailed
  identity.
- Dev startup proves fresh `installed`, repeat `matched`, edited-without-bump
  version reuse, bumped-version evolution refusal, partial-state remediation,
  and explicit reset-install. No case exits zero while claiming the requested
  seed is active when it is not.
- `StartupArtifactsV2` predecessor rejection, sessions stage/consume crash
  points, catalog-principal ordering, and hosted compiled-seed mismatch/
  malicious-caller/clean-object races pass without legacy downgrade.
- A client presented with a target lacking `snapback.reset.seed.v1` refuses
  locally and proves no request reached either the new or legacy destructive
  carriers.
- Dry-run covers every state classification and refusal with no changed head,
  row, identity, receipt, stage, or reset-journal entry.
- The getting-started, headless-client, Contract-adapter, and acceptance Guide
  pages teach versioned install as the managed default, preserve the named
  legacy lane, and `guide/capabilities.md` reports both ensure/reset profiles
  without an undated GAP.
- The package-cold-install test proves the generated artifact, client
  capability check, schemas, and diagnostics ship without repository source
  aliases.

## 13. Non-goals

- Seed is not an upsert, merge, delete, patch, fixture reconciliation, or
  continuously enforced desired state.
- V1 has no per-table versions, partial completion, force/adopt flag, implicit
  migration, automatic reset, or production bypass.
- `seedVersion` is not a schema version, release version, migration ordering,
  timestamp, or SemVer promise.
- A digest proves byte identity, not that seed content is safe, authorized,
  secret-free, or appropriate for production.
- This Spec does not add new generic migration expressions; evolution outside
  LLP 0081's typed vocabulary requires reset or a separately reviewed
  migration extension.
- This Spec does not make destructive reset reachable from application mount
  lifecycle. It remains explicit admin/test work under LLP 0031 and LLP 0059.

## 14. Status

Accepted (2026-08-03) by the author — decision sitting #2 extension,
explicit commission 2026-08-03
(`issues/20260803-author-decision-sitting-2.md`) — with the required
reconciliation amendments landed in the same change: LLP 0012 and LLP 0094
for the new closed request/response/reset families, LLP 0034 for the
explicit exception to legacy seed-if-empty, LLP 0031 for gated
decode/redaction, LLP 0040 for compiled artifact identity, LLP 0058 for
StartupArtifactsV2 stage/consume, LLP 0059 for idempotent
predecessor-bound reset, LLP 0080 for projection maintenance, and LLP 0081
for migration-plan-v2 seed transition/restore/rollback publication.
Implementation may prototype behind an unadvertised capability, but no
target may advertise the versioned-seed capabilities (§15.3's
`versioned_seed_install_v1` / `versioned_seed_reset_v1`, superseding the
`snapback.ensure.seed.v1` / `snapback.reset.seed.v1` protocol-bit sketch)
until its complete conformance matrix passes — §16.6's executable manifest
is the sole advertisement gate, and §16.7 records the local target's landed
evidence.

## 15. Round-2 author reconciliation for the first landing

The second review found that migration-v2, restore publication, cross-mode
staging, and a multi-phase reset journal were not closed enough to implement
safely. This section narrows v1. It is normative and supersedes contrary
requirements above for the first advertised implementation.

### 15.1 Active identity is stream-keyed

The local SQLite implementation owns:

```text
_snapback_seed_installations_v1(
  data_version_stream TEXT PRIMARY KEY,
  artifact_json TEXT NOT NULL,
  receipt_json TEXT NOT NULL
)
```

`artifact_json` is the exact JCS `SeedArtifactV1`; `receipt_json` is the exact
JCS successful installation receipt. Both are recomputed and validated on
read. The active record is the row whose key equals the strict, non-creating
read of the current `auth_invalidation_data_version_stream_v1`. A record for
any other stream is historical and can never authorize `matched`.

This layout is the predecessor compatibility fence. Every shipped legacy
destructive reset rotates the data-version stream in its reset transaction.
An older binary need not know this new table: after rotation, an old
installation row is unreachable as active identity. The new binary may prune
orphan rows later, but it never treats them as active and never requires an
unmodified predecessor to delete a future metadata key.

Fresh versioned installation initializes a missing data-version stream in the
same successful transaction as rows, identity, and receipt. Read-only preview
uses a strict `absent | present | corrupt` stream reader and cannot create a
UUID or write any metadata.

### 15.2 Closed first-landing operations

The first landing admits exactly:

- same-mode `install`/`matched` on the active schema/function pair;
- explicit destructive `resetInstall`, which clears application state,
  rotates both governed streams, seeds, and writes the successor identity in
  the existing single SQLite reset transaction; and
- explicit destructive `clear`, which performs the same reset without seed
  and leaves the successor stream without an installation row.

Cross-mode staging refuses `SNAPBACK_SEED_CROSS_MODE_UNSUPPORTED` before any
stage or write. A sessions-mode seed that targets membership-protected tables
refuses `SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`; ordinary
non-membership application tables may be installed only after the sessions
catalog is already active. No bootstrap/activation split is invented.

Restore already rotates the data-version stream, so a restored target has
absent active seed identity and must be explicitly reset-installed before a
versioned declaration can become active. Migration does not rotate the stream:
an installed instance presented with another identity continues to return
`SNAPBACK_SEED_MIGRATION_REQUIRED`, but v1 supplies no metadata-only or DML
identity-advance step. Operators must use an authorized whole-instance
reset-install. A future migration/restore identity extension requires its own
reviewed LLP and may not be advertised by this landing. All
`MigrationPlanArtifactV2`, restore-rebase, rollback-republish, and
contract-compatible predecessor claims above are removed from v1.

`StartupArtifactsV2` is also removed from the first landing. For a versioned
project, tooling supplies the existing `StartupArtifacts` carrier with its
legacy `seed` member absent; after a sessions target has completed activation,
tooling invokes the named versioned operation. Passing an artifact-shaped
object through a legacy `SeedData` carrier is refused by new tooling because an
older open nested decoder would otherwise discard `seedVersion`.

### 15.3 Routes, host operations, and authority

System HTTP operations live only under the reserved prefix:

```text
/_snapback/api/app/seed/ensure-v1
/_snapback/api/app/seed/preview-v1
/_snapback/api/app/seed/reset-install-v1
/_snapback/api/app/seed/clear-v1
```

The host operations are predecessor-unknown closed names:
`app.seed.ensure.v1`, `app.seed.preview.v1`,
`app.seed.reset-install.v1`, and `app.seed.clear.v1`. There is no claim that a
legacy `app.ensure` host operation exists. Vite and packaged CLI callers use
these names after manifest capability preflight and never fall back to
`app.reset`, `snapback reset --seed`, or untagged provisioning.

Capability preflight uses the existing `supportedCapabilities` member with
exact experimental ids `versioned_seed_install_v1` and
`versioned_seed_reset_v1`; no new `supportedEnsureProtocols` member is added.

Ensure and preview use the existing provisioning AdminWrite policy. Reset and
clear use exactly the same `AdminWrite + NonProd` profile requirement as the
shipped `app.reset`; this Spec does not claim a nonexistent stricter gate.
LLP 0031's route matrix and LLP 0059's reset registry are amended in the same
landing.

### 15.4 Exact request, replay, digest, and preview carriers

`InstallSeedRequestV1` is the closed object
`{formatVersion:"snapback.seed.install-request.v1", operationId, artifact,
requestedMode}`. `ResetSeedRequestV1` is the closed object
`{formatVersion:"snapback.seed.reset-request.v1", operationId,
expectedDataVersionStream, artifact?}`. `operationId` is a caller-minted
canonical UUIDv7. An operation id is globally unique within the database.

Request digests are bare lowercase SHA-256 hex over:

```text
UTF8("snapback:seed-install-request:v1\n") || RFC8785_JCS(body)
UTF8("snapback:seed-reset-request:v1\n")   || RFC8785_JCS(body)
```

where `body` is the complete closed request excluding no member. The runtime
stores completed effectful operations in
`_snapback_seed_operations_v1(operation_id PRIMARY KEY, request_digest,
predecessor_stream, successor_stream, receipt_json)`. A retry with identical
bytes returns the stored receipt without rerunning effects. Reusing an id with
another digest refuses `SNAPBACK_SEED_OPERATION_ID_REUSED`. Because reset,
stream rotation, row writes, active installation, and completed-operation
receipt share one SQLite transaction, recovery has only `not committed` and
`committed`; there is no publication phase or reset journal.

`matched` is observational: it returns the closed matched-observation variant
with the active identity and its establishing receipt, writes no operation
row, and does not claim operation-id replay. Operation-id uniqueness and
completed-operation replay apply only to effectful `installed`,
`reset-installed`, and `cleared` outcomes.

`SeedPreviewRequestV1` is the closed effect-free object
`{formatVersion:"snapback.seed.preview-request.v1", artifact,
requestedMode, operation:"install"|"resetInstall"|"clear"}`.
`SeedPreviewResultV1` returns the same state classification, stable diagnostic
code, current/requested redacted identities, and would-write row/effect
counts, but never an operation id or receipt. Preview must leave database,
WAL, stream, rows, identity, receipt, and operation tables byte-identical.

The successful receipt is the closed object
`{formatVersion:"snapback.seed.receipt.v1", operationId, requestDigest,
operation, outcome, appId, seedVersion, seedDigest, schemaHash,
dataVersionStream, directApplicationRows, derivedProjectionRows,
totalApplicationEffects, resetDeletedRows}`. `outcome` is
`installed | reset-installed | cleared`; cleared receipts omit the
three seed identity members and report zero successor application effects.
Exact JSON schemas,
golden digest vectors, HTTP 409 for known unsupported protocol/identity drift,
HTTP 503 for mode-pending, and existing legacy
`SNAPBACK_SEED_INVALID` row diagnostics are part of the landing.

### 15.5 Quantitative and acceptance closure

Versioned installation is intentionally bounded to 1,024 total direct plus
distinct changed maintained-projection outputs under the named
`VERSIONED_SEED_MAX_EFFECTS_V1` constant. Codegen reports the authored direct
row count. The runtime measures derived effects through the real projection
maintenance path; install enforces the bound inside its transaction and
preview executes the same DML against an owned disposable snapshot.
Existing demos must fit or receive an explicit version split/reset
remediation; there is no batching that could partially establish identity.

The committed conformance manifest is
`tests/conformance/versioned-seed-v1.manifest.json`. Its closed runner set
covers HTTP, direct CLI, the four real host-operation names, Vite lifecycle,
package-cold-install, and restore/migration refusal. Unknown runners, zero
cases, and unexplained skips fail. Required predecessor evidence runs the
unmodified prior binary's legacy reset against a versioned store and proves
that reopening with the new binary sees absent—not stale—active identity.
Required crash evidence injects before commit and after commit/response loss
and proves zero or one complete effect. The matrix also covers every authored
state, empty-array occupancy, operation-id reuse, route/gate precedence,
sessions membership refusal, strict preview byte identity, 1,024/1,025
boundaries, cleared-backup restore, and no legacy fallback.

This manifest replaces the obsolete §12 table as the sole advertisement gate.
The hosted compiled-seed arm is an explicit machine-readable GAP row and
cannot contribute a positive capability.

The predecessor runner builds the exact ticket-checkpoint commit
`3db3185a` in a clean compatibility worktree, records the Git commit and binary
SHA-256 in the conformance receipt, and executes that unmodified binary's
legacy reset. CI may consume the same content-addressed cached binary; absence
is a coded mandatory-row failure, never an unexplained skip.

Other-stream installation rows are historical and ignored by the active
point-read. `corrupt` applies only when the row at the current stream key is
malformed, embeds a conflicting app/stream, or has inconsistent artifact and
receipt facts.

The stable first-landing diagnostic additions are:

- `SNAPBACK_SEED_CROSS_MODE_UNSUPPORTED` — HTTP 409;
- `SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED` — HTTP 409;
- `SNAPBACK_SEED_OPERATION_ID_REUSED` — HTTP 409;
- `SNAPBACK_SEED_MIGRATION_REQUIRED` — HTTP 409; and
- the existing `SNAPBACK_AUTH_MODE_PENDING` — HTTP 503, which wins before the
  seed route. The obsolete `SNAPBACK_SEED_MODE_PENDING` is not emitted.

HTTP success bodies are exactly `SeedInstallReceiptV1` for effectful/matched
operations and `SeedPreviewResultV1` for preview. Host-operation success wraps
the same value in the standard `hostOpsResult.data` envelope.

The same landing amends LLP 0024 for the four `app.seed.*` operations, LLP
0031 for their reserved routes, LLP 0037 for Rust-owned schemas, and LLP 0059
for reuse of its single reset coordinator. The active stream is LLP 0043/
0053's `versionStreamId`; no new migration audience is introduced.

## 16. Final author reconciliation after round 3

The third and final review round converged on the stream-keyed identity model
but found six safety details that §15 left ambiguous. This section is
normative for the first landing and supersedes contrary text above. The
document remains **Review** until the executable conformance gate passes.

### 16.1 Replay observes current state before historical completion

Completed effectful operation rows are durable idempotency evidence, not proof
of current activation. Replay lookup performs these checks in order:

1. if the operation id exists with another request digest, refuse
   `SNAPBACK_SEED_OPERATION_ID_REUSED`;
2. strictly read the current data-version stream without creating it;
3. if the stored successor stream differs from the current stream, refuse
   `SNAPBACK_SEED_OPERATION_HISTORICAL`;
4. for `installed` or `reset-installed`, validate that the active protected
   installation equals the stored receipt; for `cleared`, validate that the
   active installation is absent; and
5. only then return the stored receipt without rerunning effects.

Corrupt current identity still wins as `SNAPBACK_SEED_IDENTITY_CORRUPT`. A
historical completion is never projected as current success and is never
rerun. Restart, legacy reset, restore, clear, and changed-digest retries are
mandatory fixtures.

`matched` is a pure observation and the caller's operation id has no durable
meaning. Its response is a closed `SeedMatchedObservationV1` containing the
current active identity and the already-stored establishing receipt. It has no
caller operation id or caller request digest and does not reserve either.
After reset the same declaration is classified afresh. The closed ensure
result is `installed(receipt) | matched(observation)`; `matched` is not a legal
stored receipt outcome.

### 16.2 Closed carriers and exact operation combinations

`ExpectedDataVersionStreamV1` is the tagged union
`{state:"absent"} | {state:"present", value:<canonical UUIDv7>}`.
`ResetSeedRequestV1` is:

```text
{
  formatVersion: "snapback.seed.reset-request.v1",
  operationId: <canonical UUIDv7>,
  operation: "resetInstall" | "clear",
  requestedMode: "dev" | "sessions",
  expectedDataVersionStream: ExpectedDataVersionStreamV1,
  artifact?: SeedArtifactV1
}
```

`resetInstall` requires `artifact`; `clear` forbids it. The complete closed
body, including operation, mode, and absent/present predecessor state, enters
the reset request digest. `InstallSeedRequestV1` continues to bind its
operation id, artifact, and requested mode. The preview carrier uses the same
tagged operation and optional-artifact rules, but has no operation id and is
read-only. Clear results omit requested seed identity.

The direct HTTP routes decode exactly one of those Rust-owned bodies and return
their Rust-owned success union or the stable diagnostic with the status named
here. Host operations put that same body only under
`HostOpsRequest.input`; seed-body siblings at the host wrapper level are
forbidden and wrapper fields do not enter the seed digest. Host failures use
LLP 0024's understood-failure HTTP-200 envelope with the same code and details;
transport/authentication failures retain LLP 0024's ordinary status rules.

### 16.3 Complete route authority

All four direct routes and corresponding host operations require
`AdminWrite + NonProd`, including read-only preview. This deliberately retains
the existing provisioning invariant and gives callers one stable deployment
profile for the family. Authentication and profile refusal happen before
seed-state inspection, operation replay, or request-specific diagnostics.

### 16.4 Existing reset publication remains load-bearing

There is no *separate seed durability publication phase* and no seed-specific
reset journal. Reset-install and clear still use every part of LLP 0059's
shipped reset protocol: the stream ticket, blocked admission, single SQLite
commit, successor session-projection installation, issuer reconstruction,
postcommit publication, commit-uncertainty reconciliation, and release/response
ordering. A failure after the SQLite commit is reconciled through LLP 0059; it
is not reported as an uncommitted seed operation and does not rerun row
effects.

### 16.5 Executable effect accounting

The v1 ceiling counts the same observable application effects as LLP 0080:

```text
directApplicationRows + distinctChangedProjectionOutputRows
```

The first term counts each authored seed row inserted once. The second counts
each distinct maintained projection-output row whose final value changes
because of those inserts. Reset table-deletion statements, stream metadata,
the one installation row, and the one completed-operation row are fixed
framework bookkeeping and are reported separately but do not consume this
application-effect budget. For ordinary install:

```text
totalApplicationEffects = directApplicationRows
                        + derivedProjectionRows
```

For reset-install the same formula applies to successor writes; predecessor
deletions are reported as `resetDeletedRows` but are not used to smuggle new
writes past the ceiling. Clear has zero application write effects and reports
its deletion count. Preview and successful receipts expose all four counts.
`totalApplicationEffects <= 1024` succeeds;
`totalApplicationEffects >= 1025` refuses
`SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED` before commit and leaves every
application and protected byte unchanged.

### 16.6 The manifest is an executable advertisement gate

`tests/conformance/versioned-seed-v1.manifest.json` is a closed dispatcher
input, not an inventory. It names a schema version, exact case id, runner id,
repository-relative executable entrypoint, expected assertion count,
capability predicate, and required/GAP status for each row. The dispatcher
rejects unknown or missing case ids, unknown runners, duplicate ids,
non-executable entrypoints, assertion-count mismatch, zero assertions, and
unexplained skips. It emits a closed completion receipt containing the
manifest digest, current binary build identity/digest, per-case outcome and
assertion count, capabilities admitted, and explicit GAP rows.

The predecessor case additionally records commit
`3db3185a8325b5e8209b637080ab65d775c880ea`, the deterministic build recipe
and inputs digest, predecessor binary SHA-256, reported binary build identity,
and the legacy-reset observation. A cache hit is accepted only when all of
those facts reverify. Until every mandatory runner exists and the dispatcher
produces a conforming receipt, both versioned-seed capability ids remain
absent.

Recurring cadence does not weaken this advertisement gate. The checked local-
proof selector maps versioned-seed corpus inputs and native storage/runtime
changes to the complete `versioned-seed-conformance` dispatcher and closes its
binary/readiness prerequisites. Unknown and shared-authority changes run the
complete inventory. The same dispatcher runs again in the scheduled/manual
complete latest-main proof and at release/capability-promotion authority;
passing an unrelated affected subset can never advertise either capability.
`tests/local_proof_selection_v0.mjs` replays a historical storage/route defect
diff to this gate so the path map cannot silently lose that obligation.

The additional stable code is
`SNAPBACK_SEED_OPERATION_HISTORICAL` (HTTP 409; understood host failure).
Retention of historical rows is bounded by pruning rows that are neither
current nor referenced by the newest 256 completed operations; pruning is
best-effort maintenance and never changes replay of a retained current-stream
operation.

### 16.7 Implementation evidence (2026-07-27)

The complete local suite has executed all 20 mandatory rows, including the
exact predecessor binary, package cold install, client/CLI/Vite lifecycle,
restore, precommit rollback, response-loss replay, empty-array occupancy,
sessions membership refusal, and the 1,024/1,025 boundaries. The closed
dispatcher emits the secret-free receipt to an explicitly selected artifact
path; hosted compiled-seed custody remains its one declared GAP row.

The local and remote SQLite target manifests now advertise
`versioned_seed_install_v1` and `versioned_seed_reset_v1` with
`experimental` maturity. The Spec remains **Review**—this implementation
evidence does not substitute for Charlie's author acceptance or the dual-READY
review lifecycle required to change that status.

## 17. Dated amendment: seed asset fixtures (2026-07-31)

Recorded as part of [LLP 0044](./0044-asset-storage-pipeline.rfc.md)'s
completion program (its §Seeds and agent DX reserves seed-carried binary
fixtures for "a separately versioned fixture artifact and an LLP 0109
amendment covering digest identity, custody, install ordering, reset, and
quota semantics"). `SeedArtifactV1` and the authored `seed.json` shape stay
**closed and unchanged**; this amendment adds a sibling artifact and one
optional install-request member.

**Artifact.** Codegen emits `snapback/generated/seed.asset-fixtures.artifact.json`,
the closed `SeedAssetFixturesV1`:

```json
{
  "formatVersion": "snapback.seed-asset-fixtures.v1",
  "appId": "<appId>",
  "fixturesDigest": "sha256:<64 hex>",
  "fixtures": [
    {
      "id": "welcome-photo",
      "upload": "photoUpload",
      "file": "seed-assets/welcome.jpg",
      "mediaType": "image/jpeg",
      "sourceDigest": "sha256:<64 hex>"
    }
  ]
}
```

Authored source is `snapback/seed-assets.json` (`{ "fixtures": [ { id,
upload, file, mediaType } ] }`); codegen derives `sourceDigest` per file
and `fixturesDigest` over the JCS body with domain prefix
`snapback:seed-asset-fixtures:v1\n`, exactly the §2.2 discipline. Fixture
ids share `seedVersion`'s token grammar and are unique. `sourceDigest`
covers the committed **source** bytes; canonical published bytes may
differ (strip rewrites), which is the 0044 trusted-path invariant, not
drift.

**Custody.** Fixture bytes live as committed files under the app's
`snapback/` directory, referenced by relative path (no traversal, no
absolute paths). No artifact ever carries base64 bytes. Bytes travel only
the ordinary upload transport: ingestion is the admin-gated
`asset.ensureSeedFixture` host operation, which drives the same
create → checksummed-transfer → finalize path as any upload under the
declared intent — ceilings, privacy policy, capability gates, and quota
all apply. A seed can never inject bytes directly as a ready blob.

**Idempotent ingestion.** The server keeps the durable mapping
`(fixtureId) → (sourceDigest, assetId, intent)` in
`_snapback_asset_seed_fixtures_v1`. `asset.ensureSeedFixture` with a
matching digest returns the mapped asset (re-ingesting only if the asset
no longer exists); a changed digest ingests a new asset and repoints the
mapping — the superseded asset follows ordinary replacement/GC semantics,
never special-cased deletion.

**Install ordering and placeholders.** Seed rows reference fixtures with
the reserved value `{"$assetFixture": "<fixtureId>"}` in `v.assetRef`
fields (exactly one member; any other use refuses). The install request
(`InstallSeedRequestV1`) gains one optional member, `assetFixtures`,
carrying the fixtures artifact. Resolution happens inside the install
transaction, before row validation: each placeholder resolves through the
mapping, which must exist **and** match the artifact's `sourceDigest` —
any missing or stale mapping refuses the whole ensure with a structured
diagnostic and zero row effects. Fixtures therefore finalize strictly
before rows install, and the resolved rows pass the ordinary
commit-boundary asset admission (seed-path authority). A placeholder with
no attached fixtures artifact, or a fixtures artifact for a different
app, refuses. Placeholder resolution never participates in `seedDigest` —
identity covers the authored placeholder form; installed rows carry
per-instance asset ids.

**Reset.** Single-transaction `resetInstall` carries no placeholders and
no `assetFixtures` member — a fixture-bearing seed decomposes into the
idempotent `clear` + fixture ensure + `install` sequence (managed tooling
owns the decomposition), because trusted finalization cannot run inside
the destructive transaction. App reset/clear deletes every asset system
table and removes the instance's staging and blob files after commit —
asset bytes are app state, and this amendment makes that explicit
(previously the asset tables survived reset).

**Quota.** Fixture bytes consume ordinary logical quota under the
declared intent; there is no seed bypass. A fixture the target cannot
admit (inadmissible intent, missing capability, ceiling) refuses at
ingestion, which managed tooling surfaces before any seed effect.

**Capability.** Targets advertise fixture support as the
`seedAssetFixtures` fact in the assets facts block; a request carrying
`assetFixtures` against a server without the fact fails closed under the
existing deny-unknown-member discipline, which is the intended
negotiation.

## 18. Dated amendment: the membership fixture lane lands (2026-08-01)

**Commissioning authority:** LLP 0100 §8b, which routed the trusted
membership seed/reset case here as this document's composition with
LLP 0056, after the LLP 0137 A3 arm evidenced the gap
(`issues/20260801-0137-a3-membership-not-seedable-cleanup-cannot-retire-authority.md`,
finding a3-f1): with membership tables refused at the seed boundary, the
arm had to **choreograph per-persona self-removal (`leaveOrg` × 3) before
every receipted reset** and re-redeem a restored invite afterwards to earn
a seat back — cleanup choreography standing in for the missing lane, while
a receipted reset could not retire authority a fixture never established.

This amendment records the landing of §8's already-specified contract and
retires the first-landing narrowing:

- **The refusal is retired.** §15.2's first-landing rule — "a
  sessions-mode seed that targets membership-protected tables refuses
  `SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`" — and that code's row
  in §9's first-landing list no longer describe the implementation. A
  named membership table (empty or fixture-bearing) is a legal seed and
  reset target in both modes. Unknown tables still refuse; nothing else
  in §2.3's validation order changed.
- **Fixture seats enter through the seed writer.** §8's bulk
  `MembershipWriter::Seed` primitive is now real on the install path:
  every fixture row on a membership table is stamped with per-row `seed`
  writer provenance in the same transaction
  (`seed_rows_into_transaction`, crates/snapback/src/storage.rs). Host-managed provenance
  columns are not app-declared fields, so a fixture row that names one
  refuses as an undeclared field — spoofing fails closed.
- **Validation is the §8 stack, unchanged.** The same-transaction
  activation scan (`validate_membership_activation`) enforces the closed
  role vocabulary, non-null axes, `(principal, resource)` uniqueness,
  resource referential integrity, and the `lastHolder`
  eligible-holder-per-live-resource invariant (in sessions mode through
  the catalog-eligibility predicate, honoring §8's
  catalog-precedes-membership-seed ordering). Any violation refuses the
  whole install; the transition matrix is not consulted — seed is a
  privileged non-invocation writer class (LLP 0056), and no transition
  records are synthesized.
- **Reset retires runtime authority in the §6.3 cut.** The reset's
  deletion set already spans every application table, membership tables
  included; with fixture seats installable, the §6.3 single transaction
  now delivers the complete witness: every runtime seat deleted, exactly
  the fixture seats restored, and the authorization consequence carried
  by the rotated stream incarnation at epoch 0 —
  **event-3/declared-restore semantics per LLP 0056's taxonomy, one
  incarnation cut, never a stream of per-row event-1 kicks** (the
  classification LLP 0100 v0.4 corrected and this landing honors).
- **Witnesses.** `versioned_seed_membership_fixture_lane_installs_resets_`
  `and_retires_runtime_authority` (install + provenance +
  fixture-authority-is-real + one-cut reset + runtime-only principal
  denied + fixture authority surviving),
  `versioned_seed_membership_fixture_lane_fails_closed`
  (out-of-vocabulary role; provenance spoof), and
  `versioned_seed_conformance_empty_target_and_sessions_membership_lane`
  (sessions-mode admission of a named membership table; undeclared table
  still refused) — crates/snapback/src/storage.rs and src/seed_identity.rs. The
  conformance manifest case `sessions-membership-refusal` is renamed
  `sessions-membership-fixture-lane` with the new witnessed semantics.

The guide's versioned-seeds page documents the lane; product bootstrap
remains the generated membership `bootstrap()` method — the fixture lane
is for seeds, resets, and test personas, not an application write path.
