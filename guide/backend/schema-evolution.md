---
title: Evolve a sessions schema without discarding data
id: backend.schema-evolution
order: 29
audience: agent-first
capabilities: [backend.schema-evolution]
authorities: [llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0081-reviewed-storage-evolution-and-migrations.rfc.md, llp/0160-ideal-migration-experience.rfc.md, crates/snapback-types/src/auth/mode.rs, crates/snapback-cli/src/cli.rs, crates/snapback-kernel/src/storage.rs, packages/snapback-cli/index.mjs]
examples: [packages/snapback-cli/sessions-dev-loop.test.mjs, crates/snapback-cli/src/cli/tests.rs, crates/snapback-kernel/src/storage/tests.rs]
status: current
targets: [local]
maturity: shipped
since: 0.1.21
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:b476c2fd5a9a0f161241edaf426111b715fe4ff7e28400191b91deeb893ee2ed
---

# Evolve a sessions schema without discarding data

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The ordinary sessions-mode loop is: edit the schema, let generation produce a
complete candidate pair, and let the packaged `snapback dev` owner advance the
deployment. Keep the database. A deployment-identity refusal is a safety fence
around that loop, not a request to delete local state.

## Change schema, then let the identity rotate

Additive changes such as a new table, index, or optional field can load through
the running watch loop:

```sh
snapback dev snapback --db .snapback/dev.sqlite3
```

Edit while that process owns the server. Generation creates one coherent
schema/function pair; the running load path preflights and activates it. If the
managed process must restart, it owns the cold successor handshake described
below. Raw `snapback start` is a lower-level harness surface and does not own
this authoring recovery loop.

A schema edit changes `schemaHash`. Because the manifests are one coherent
pair, it also changes their shared `inputsHash`; `bundleHash` identifies the
function-manifest content and may rotate with shared generated inputs even
when the handler you were thinking about did not change. A function-only edit
can rotate `bundleHash` while leaving `schemaHash` unchanged. Compare the
whole identity, never one digest in isolation.

## What the sessions pin means

A settled sessions database records the exact complete deployment it admitted:

| Field | What it identifies |
| --- | --- |
| `schemaVersion`, `authMode`, `appId` | The artifact protocol, sessions mode, and application namespace. |
| `schemaHash` | Canonical schema-manifest content. |
| `bundleHash` | Canonical function-manifest content. |
| `inputsHash` | The shared schema/function input closure; both halves must match it. |

The pin is executable-authority custody. It prevents an arbitrary cold binary
from opening an existing sessions store with a different half-pair. It is not
a hash of SQLite bytes, not a claim that application rows are unchanged, and
not a runtime/codegen compatibility stamp. The `expectedDeployment` in a
startup diagnostic is the database's settled pin; `observedDeployment` is the
complete startup carrier that just passed enough preflight to be compared.
Neither object contains a bearer or another secret.

Every settled sessions start requires the single closed startup carrier. A
missing or unreadable carrier produces
`SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED`; a malformed, incoherent, or
different pair produces `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`. Do not hand
edit either hash to make them agree.

## Let the packaged successor path advance the pin

The packaged dev owner reacts only to a structured mismatch that includes a
preflighted observed identity. It stops the refused child and retries before
listener bind with the managed-only successor opt-in. Native startup then
preflights the complete pair again under the closed transition guard, validates
storage compatibility, atomically advances the manifest and pin, and publishes
functions only after commit. A success event has state
`startup-successor-activated` and carries the old and new identities.

This is not subset or superset admission. The whole candidate pair advances,
including comment-only function changes. If preparation, capability, schema,
or storage validation fails, startup remains closed, the old pin stays active,
and the existing database is not discarded. Fix the candidate and rerun the
managed loop.

## Recover from SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH

Use this recipe when regeneration happened while the sessions server was
stopped, or a failed/partial attempt left the files and pin on different
generations:

1. Stop retry churn. Preserve the database, its auth sibling files, the
   current sources, and the last generated schema/function pair whose identity
   equals `expectedDeployment`. Do not edit the database or manifest hashes.
2. If the previous pair was overwritten, restore the previous sources from
   version control and regenerate them into a separate preserved directory.
   Verify its complete identity equals `expectedDeployment`.
3. Boot that exact predecessor carrier against the existing store. This
   restores a running authority that agrees with the pin; it does not roll
   application rows back.
4. Put the intended additive schema and functions back, then run them through
   the packaged `snapback dev` watch/restart path. Let its
   `startup-successor-activated` event prove the guarded pin advance.
5. Rerun the acceptance process against the preserved rows and inspect the
   new generated identities. Only then retire the predecessor carrier.

The conformance witness in
[`sessions-dev-loop.test.mjs`](repo:packages/snapback-cli/sessions-dev-loop.test.mjs)
does exactly this boundary: it writes a row under the predecessor, restarts on
a successor, observes `startup-successor-activated`, and proves the row
survived. It also proves that an invalid successor refuses while the old data
remains available.

## Recover after a partial load materialized data

A deployment recovery does not make a destructive field change additive. For
example, if one generation admitted an optional object field and application
code wrote object values, changing that same field directly to an array must
refuse with `SNAPBACK_SCHEMA_FIELD_RETYPED`. Likewise, adding a required field
to populated rows refuses with
`SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED`.

Preserve the store and boot the exact carrier named by `expectedDeployment` as
above. Then choose one of two valid continuations:

- introduce a new optional field, deploy it through the managed successor
  path, backfill with an ordinary bounded mutation, and only later retire the
  old field through a reviewed migration; or
- author explicit migration intents and use the
  [reviewed migration loop](./migrations.md) to preview, approve, rehearse,
  apply, and verify the retype/backfill.

Do not delete the database to make the new type load, and do not patch the
stored JSON manually. The data already materialized under the predecessor is
the reason the applier refuses; preserving it is the recovery objective.

For `AssetRef`, the display name alone is not the type identity. The retype
diagnostic's `existingAssetRef`, `requestedAssetRef`, and `changedFacts`
identify changes to upload/media intent, policy generation, media kinds,
delivery, variants, classification, retention, and target capability. Preserve
data by adding a nullable successor AssetRef field and repopulating it through
ordinary authorized application mutations. That route invokes the AssetRef
attachment hook, which rechecks the successor intent/media policy and maintains
the successor field's reverse edges. Do **not** use generic migration copy or
backfill for AssetRef values: that path does not run the attachment hook. Keep
the predecessor field until an AssetRef-aware retirement migration exists; do
not interpret `AssetRef` → `AssetRef` as stale codegen or an in-place compatible
policy edit.

If this is a disposable local target and you intentionally do **not** need the
data, use `snapback reset --dev-fresh --db <db>`. The store is not one file:
deleting only the SQLite database leaves custody keyrings, config, and assets
behind and can reproduce `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`. Preserve a
copy first with `snapback store export` when needed; the complete inventory and
procedure are in [Back up, copy, and move a store](../operating/backup-and-copy.md).

## Diagnose the four boundary codes

| Code | Meaning and next action |
| --- | --- |
| `SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED` | A settled sessions start has no readable trusted complete-pair carrier. Restore the exact generated carrier and retry. |
| `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` | The carrier differs from the pin or is not a coherent closed pair. Read `expectedDeployment`/`observedDeployment`; use the exact-carrier then managed-successor recipe above. |
| `SNAPBACK_SCHEMA_FIELD_RETYPED` | Existing storage makes a direct field retype non-additive. Preserve the predecessor and route ordinary fields through a new-field backfill or reviewed migration. For AssetRef → AssetRef, read `changedFacts`, add a nullable successor, and populate it only through ordinary authorized application mutations; generic migration copy/backfill is not AssetRef-safe. |
| `SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED` | Populated rows lack the proposed required value. Add it as optional and backfill, or declare the reviewed migration. |

For seed identity changes, use [versioned seeds](./versioned-seeds.md). For
renames, drops, retypes, required-field backfills, or domain narrowing, use
[reviewed migrations](./migrations.md). Those are storage-evolution decisions;
the sessions successor path is the safe carrier for a candidate after its
storage semantics are valid.
