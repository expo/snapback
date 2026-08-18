---
title: Reviewed migrations
id: backend.migrations
order: 30
audience: agent-first
capabilities: [backend.migrations]
authorities: [llp/0081-reviewed-storage-evolution-and-migrations.rfc.md, crates/snapback/src/cli.rs, crates/snapback-kernel/src/migration.rs, crates/snapback-kernel/src/migration_presentation.rs, crates/snapback/src/local.rs, crates/snapback/tests/migration_cli_presentation_v1.rs, crates/snapback/tests/migration_corpus_v0.rs]
examples: [crates/snapback/tests/migration_cli_presentation_v1.rs, crates/snapback/tests/migration_corpus_v0.rs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:0845678e9f349bbf1f6872d176f125d4fcd113124dda99a6558eb22917bb249f
---

# Reviewed migrations

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md). Hosted approval is an LLP 0072
> control-plane operation, not the local operator record taught here.

Ordinary schema activation applies additive, unambiguous changes directly.
A **destructive or reshaping** change — renaming a field, converting its
type, adding a required field to a populated table, tightening an optional
field, narrowing a stored domain, retiring fields or tables — must not be
guessed from a schema diff. Those route through the reviewed migration loop
(LLP 0081): `snapback migrate`, a seven-verb CLI surface in which a
deterministic plan is previewed, approved by digest, optionally rehearsed
against a restore-derived instance, applied, and verified. Search terms that
land here: migration, schema migration, alter column, rename column, drop
field, backfill.

## Run the reviewed loop

Every verb is a subcommand of `snapback migrate`; the global `--json` flag
silences the default human presentation on stderr and emits only the
structured envelope on stdout:

```sh
# 1. Deterministic plan + separately digested observation. Read-only.
snapback migrate preview \
  --db app.db --schema staged-schema.json \
  --intents intents.json \
  --publication-timestamp-ms 1790000000000 \
  --out preview.json

# 2. Authenticated local operator record, digest-acknowledged.
snapback migrate approve preview.json \
  --db app.db --out approved.json \
  --acknowledge-digests '<planDigest>:<observationDigest>'

# 3. (When the plan requires it) execute the approved plan AS a rehearsal
#    against the restore-derived instance its sealed binding names.
snapback migrate rehearse approved.json \
  --schema staged-schema.json \
  --rehearsal-plan rehearsal-plan.json \
  --db restored-copy.db --out rehearsal-receipt.json

# 4. Execute the approved file by path; never regenerates a plan.
snapback migrate apply approved.json \
  --db app.db --schema staged-schema.json \
  --rehearsal-receipt rehearsal-receipt.json

# 5. The receipt-vs-journal projection check.
snapback migrate verify --operation-id <id> --db app.db
```

`preview` also accepts `--rollback-timestamp-ms` (required later for the
LLP 0081 §6 fast rollback; must be at least the publication timestamp),
`--constants` (a JSON object of named literal constants — migration
constants are explicit inputs; preview creates none), and the reviewed
ceilings `--max-affected-rows` (default 1,000,000) and
`--max-barrier-downtime-ms` (default 60,000). `approve` accepts
`--approver` (defaults to the local `$USER` principal) and
`--expires-in-ms` (default 24 hours). `apply --dry-run` validates admission
without writing.

Approval authority on the local profile is filesystem custody of the
database plus the recorded operator principal; `--acknowledge-digests` is
the non-interactive render-first authorization and must be the exact
`<planDigest>:<observationDigest>` pair the review block printed. `apply`
consumes the approved file — it never regenerates a plan, so what runs is
byte-bound to what was reviewed.

## Declare migration intents

`--intents` names a JSON array of `MigrationIntent` values. Explicit intents
take precedence; when the flag is omitted, preview derives the intent set
from the schema diff for **unambiguous, semantics-free changes only** —
renames, conversions, and required-field backfills refuse derivation and
must be declared. The closed intent vocabulary:

- `CreateTable { table }` and
  `CreateIndex { table, index, fields, unique }`.
- `AddOptionalField { table, field, fieldType }`.
- `AddRequiredField { table, field, fieldType, backfill }` — add, backfill
  with the declared expression, validate, then tighten, in that required
  sequence.
- `TightenRequired { table, field }` — validate before tighten.
- `RenameField { table, from, to, fieldType }` — add destination, copy,
  validate, tighten, then retire the source (LLP 0081 §3's rename
  representation).
- `ConvertField { table, from, to, fieldType, expr }` — a rename with a
  conversion expression (type change).
- `ConvertJsonToStructured { table, field, generation }` — preserve the field
  name by staging a full successor table generation; each formerly-JSON value
  must validate and is rewritten as canonical structured storage before the
  successor can publish.
- `CopyTableToGeneration { table, generation, fields, sourceTable }` —
  stage a successor generation and copy into it.
- `RebuildProjection { projectionId }`.
- `RetireField { table, field }`, `RetireTable { table }`, and
  `RetireGeneration { table, generation }`.

```json fragment reason="illustrative intent file; CI constructs intents programmatically in crates/snapback/tests/migration_cli_presentation_v1.rs"
[
  {
    "AddRequiredField": {
      "table": "todos",
      "field": "priority",
      "fieldType": "Integer",
      "backfill": { "Literal": 0 }
    }
  }
]
```

### Evolve `v.json()` into a structured field

Changing an installed `v.json()` field directly to `v.object(...)` or
`v.array(...)` refuses with `SNAPBACK_SCHEMA_FIELD_RETYPED`; the server cannot
claim existing bytes satisfy the stronger contract. Declare the reviewed
intent instead:

```json fragment reason="illustrative intent; table and generation are application-specific"
[
  {
    "ConvertJsonToStructured": {
      "table": "messages",
      "field": "recipientSnapshot",
      "generation": 2
    }
  }
]
```

Preview expands this to `StageTableGeneration` plus an identity `CopyTable`
covering every successor field and seals the `shadow-generation` strategy. The
copy runs the structured validator/canonicalizer, then proves row count and a
full content digest. If even one legacy JSON value is outside the new shape,
apply refuses and the predecessor generation remains authoritative. Repair the
data under its old schema, preview again, and approve the new digests; do not
hand-edit the database or weaken the destination to make apply pass.

## Rehearse against a restore-derived instance

When the plan's target profile requires it, production apply refuses without
a rehearsal receipt (`SNAPBACK_MIGRATION_REHEARSAL_REQUIRED`: "execute it
and present its receipt to production apply"). `migrate rehearse` executes
the approved production plan **as** a rehearsal against the one database its
sealed `MigrationRehearsalPlanV1` binding names — a restore-derived isolated
instance, never the production audience. Targeting anything else, production
included, refuses with `SNAPBACK_MIGRATION_REHEARSAL_INVALID`. The receipt
comes back marked as a rehearsal and is consumed by
`migrate apply --rehearsal-receipt`; it never substitutes for the production
apply receipt.

## Verify, cancel, and the unbuilt rollback

- `migrate verify --operation-id <id> --db <db>` runs the
  receipt-vs-journal projection check. The §5 data proof (expected values,
  content digests) lands with the verification wave and refuses honestly
  until then.
- `migrate cancel approved.json --db <db>` requests cancellation at the
  next admitted pre-publication boundary; a cancelled operation reports
  `SNAPBACK_MIGRATION_CANCELLED`.
- `migrate rollback receipt.json --db <db>` is **declared but unbuilt** on
  this profile: it refuses with `SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE`
  rather than guessing. Plan the explicit `--rollback-timestamp-ms`
  constant at preview time anyway — the §6 fast-rollback design requires it
  to have been an input, not an afterthought.

## Handle migration refusals

The loop's decision-shaped refusals:

- `SNAPBACK_MIGRATION_PLAN_INVALID` — the plan, observation, or intent set
  fails validation.
- `SNAPBACK_MIGRATION_APPROVAL_REQUIRED` — apply without a binding
  authenticated approval (LLP 0081 §2).
- `SNAPBACK_MIGRATION_REHEARSAL_REQUIRED` /
  `SNAPBACK_MIGRATION_REHEARSAL_INVALID` — a required rehearsal receipt is
  missing, or the rehearsal targeted a database other than its sealed
  binding.
- `SNAPBACK_MIGRATION_PRECONDITION_FAILED` — a reviewed precondition (the
  digested observation, staged function set, or compatibility-posture
  ordering) no longer holds at execution.
- `SNAPBACK_MIGRATION_CANCELLED` — a requested cancellation was admitted.
- `SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE` — rollback is unbuilt here.

Execution- and client-facing codes you may also encounter:
`SNAPBACK_MIGRATION_PLAN_STALE`, `SNAPBACK_MIGRATION_TARGET_MISMATCH`,
`SNAPBACK_MIGRATION_STEP_FAILED`, `SNAPBACK_MIGRATION_BARRIER_FAILED`,
`SNAPBACK_MIGRATION_FENCE_CLOSED`,
`SNAPBACK_MIGRATION_EXPECTED_ORACLE_FAILED`,
`SNAPBACK_MIGRATION_VERIFICATION_FAILED`,
`SNAPBACK_MIGRATION_JOURNAL_CORRUPT`,
`SNAPBACK_MIGRATION_PUBLICATION_AMBIGUOUS`,
`SNAPBACK_MIGRATION_PROFILE_UNSUPPORTED`,
`SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE` /
`SNAPBACK_MIGRATION_EXECUTOR_STALE`,
`SNAPBACK_MIGRATION_RETAINED_WORK_INCOMPATIBLE`, and the two client-side
outcomes of a published migration: `SNAPBACK_MIGRATION_UPGRADE_REQUIRED`
(the application published a successor-only migration; upgrade client
artifacts and resync before replaying offline work) and
`SNAPBACK_MIGRATION_RESYNC_REQUIRED` (a replayed mutation's read baseline
predates a successor-only publication and its row has since changed; resync
before replaying client-custodied offline work). Assert on the stable code, not message prose
([diagnostics](../operating/diagnostics.md)).

## Anti-patterns

- **Do not hand-edit stored data or run ad-hoc SQL for a reshaping change.**
  The loop exists so destructive changes are previewed, digest-approved, and
  journaled; an out-of-band edit invalidates the record that makes later
  verification meaningful.
- **Do not let preview guess a rename.** Derivation is deliberately limited
  to semantics-free changes; a rename derived from a drop-plus-add diff
  would silently destroy data. Declare `RenameField`/`ConvertField`
  explicitly.
- **Do not regenerate a plan at apply time.** `apply` takes the approved
  file by path; a "fresh" plan is an unreviewed plan.
- **Do not point a rehearsal at production** — the sealed binding refuses
  it; do not try to satisfy apply with a production-shaped receipt either,
  the rehearsal marking is checked.
- **Do not treat approval expiry as a nuisance.** The default 24-hour
  window bounds how stale a reviewed observation can get before execution;
  re-preview instead of widening `--expires-in-ms` reflexively.
- **Do not build a schema-reset habit on data you meant to keep.** For
  disposable dev data, reset and reseed; the moment preserved data matters,
  this loop is the paved path.
