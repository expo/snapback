# LLP 0228: State capture and custody

**Type:** Spec
**Status:** Draft
**Systems:** Storage, Backup and restore, Auth, Assets, Deployment, Security,
Operations, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-10
**Revised:** 2026-08-10
**Related:** LLP 0057, LLP 0072, LLP 0158, LLP 0188, LLP 0191, LLP 0192,
issues/shelved/20260808-state-capture-custody-spec.md,
issues/closed/20260807-server-sigterm-strands-large-sqlite-wal.md,
issues/closed/20260808-sessions-store-copy-needs-auth-keyring-sibling.md,
issues/20260730-auth-logical-export-import.md

## Summary

A Snapback store is not one file, and "copy" is not one operation. The same
database, credential table, keyring, asset tree, worker claim, or lineage
receipt must be treated differently when an operator is recovering the same
instance, restoring a successor, making an isolated test clone, forking a
derived deployment, or exporting portable application data.

This Spec defines a **closed, operation-specific custody profile** for each of
those operations:

- `snapshot/backup` captures a consistent data cut and exactly the authority
  material declared necessary to recover the same instance;
- `restore` verifies the captured input, applies an explicit target-identity
  policy, keeps the target inactive behind an activation barrier, and fences
  the predecessor before activation;
- `clone-for-test` declares its authority policy rather than inheriting
  authority because a filename happened to be copied;
- `fork` remains LLP 0158's scrub-and-mint profile; LLP 0158 consumes this
  Spec and is its first conformance witness;
- `export` is the logical, portable data seam and contains no operational
  secrets. Its import/export protocol remains separately owned.

The normative custody actions are LLP 0158's `copy`, `scrub`, `rotate`,
`share`, and `refuse`. Every known member receives one action in every
profile. An unknown Snapback-owned table, sidecar family, object namespace, or
authority carrier refuses the operation; a path's presence or basename never
chooses policy.

This is a Draft contract. It does not rename existing commands, claim a
`clone-for-test` implementation, publish a logical export format, or widen any
capability claim.

## Motivation and current evidence

The Zerobugs `zb5-hot` work exposed the failure mode twice. A large SQLite
store could retain committed pages in `-wal` after graceful shutdown, and a
byte-identical database copy could not serve sessions without its
`<db>.auth-keyring.json` sibling. The shutdown defect is now repaired, and
LLP 0192 added a supported WAL-consistent copy, but neither fact makes a raw
database copy a state-capture protocol. The capture must name its consistency
boundary and the custody of every member.

The current implementation provides two complementary inventories:

| Current authority | What it proves today | Role in this Spec | Basis |
| --- | --- | --- | --- |
| `durable_state_members(db)` | The local file-backed store has database, folded SQLite sidecars, required/optional durable siblings, instance-local paths, and lineage-bearing refusal members. | Baseline physical-member discovery for the local target. Its six `MemberDisposition` values are discovery/copy roles, not the cross-operation custody vocabulary. | Current code: [`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs); accepted decision: [LLP 0192 §D-1](./0192-store-durable-state-set.decision.md#d-1-the-durable-state-registry). |
| `TABLE_CUSTODY` | Every occupied `_snapback_*` and `_auth_*` table audited by the fork path has a closed fork disposition; an unknown owned table refuses. | Baseline database-resident custody inventory and the fork profile's table authority. | Current code: [`crates/snapback/src/instance_fork.rs`](crates/snapback/src/instance_fork.rs); [LLP 0158 §Design sketch](./0158-instance-forking.rfc.md#design-sketch). |
| `SIDECAR_CUSTODY` | Fork sidecars are explicitly copied, scrubbed, or rotated; they are not inherited by directory convention. | Baseline sidecar vocabulary and the fork profile's sidecar authority. | Current code: [`crates/snapback/src/instance_fork.rs`](crates/snapback/src/instance_fork.rs); [LLP 0158 §Design sketch](./0158-instance-forking.rfc.md#design-sketch). |
| `snapback auth backup` / `auth restore` | Descriptor-bound SQLite backup, database/keyring verification, three-state publication, target reservation, restore declaration, and destructive auth cleanup exist for the auth unit. | Current partial witnesses for `snapshot/backup` and `restore`; not a whole-envelope implementation. | Current code: [`crates/snapback/src/auth/backup.rs`](crates/snapback/src/auth/backup.rs) and [`crates/snapback/src/cli.rs`](crates/snapback/src/cli.rs); [LLP 0057 §Physical backup and declared restore](./0057-auth-provider-protocol.spec.md#physical-backup-and-declared-restore). |
| `snapback store describe` / `store export` | The local whole-store copy uses SQLite online backup, carries declared siblings, excludes instance-local state, refuses branch/fork lineage, scrubs push-token rows, and atomically publishes `store-export.json`. | Current partial `snapshot/backup` witness even though the command is named `export`; it is not this Spec's logical `export` profile. | Current code: [`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs) and [`crates/snapback/src/cli.rs`](crates/snapback/src/cli.rs); [LLP 0192 §D-2](./0192-store-durable-state-set.decision.md#d-2-the-store-export-verb). |
| LTX restorable frontier | A retained transaction boundary is paired with the governing keyring snapshot and an explicit replication lineage; restored output stays non-servable until declared restore. | Admissible future capture discipline and restore input, subject to LLP 0188's own gates. | Design authority, not a current capability claim: [LLP 0188 §§2, 5–6](./0188-ltx-sqlite-replication.rfc.md#2-integration-point-the-whole-instance-database). |

The local member registry currently classifies the following custody classes.
This table reports current code; it does not prescribe every profile's action:

| Member class | Current local members | Current meaning | Basis |
| --- | --- | --- | --- |
| Database image | `<db>` | Captured with SQLite online backup. | Current code: `MemberDisposition::Database` in [`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs). |
| Folded transaction companions | `<db>-wal`, `<db>-shm`, `<db>-journal` | Never copied beside the image; the online backup folds committed state into the output database. | Current code: `MemberDisposition::Folded` in [`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs) and `backup_database_image_into` in [`crates/snapback/src/storage.rs`](crates/snapback/src/storage.rs). |
| Required physical members | Auth, config, operation-detail, and completeness-proof keyrings; finalized asset blobs. | Physical state whose absence can invalidate authority or database references. | Current code: `MemberDisposition::Required` in [`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs). |
| Optional continuity members | Admin token, console credentials, resume keyring. | Reconstructible state whose presence can preserve live authority or continuity, so inclusion must be disclosed. | Current code: `MemberDisposition::Optional` and `StoreExportDeclaredProperties` in [`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs). |
| Instance-local members | Instance lock, target reservation, telemetry database and SQLite companions, asset staging, ready-file capability siblings. | Runtime ownership, incomplete work, or local observations excluded from the current physical copy. | Current code: `MemberDisposition::InstanceLocal` in [`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs). |
| Lineage/refusal members | Managed in-app branch workspace and derived-fork mint receipt. | Presence makes the current whole-store copy refuse rather than falsify lineage. | Current code: `MemberDisposition::Refuse` in [`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs). |
| Database-resident system state | The closed `_snapback_*` and `_auth_*` tables audited by the fork path. | Per-table `copy`, `scrub`, `rotate`, or `refuse` policy; unknown owned tables refuse. | Current code: `TABLE_CUSTODY` and `audit_connection` in [`crates/snapback/src/instance_fork.rs`](crates/snapback/src/instance_fork.rs). |

The successful shutdown checkpoint is useful operational hygiene, but it is not
an admissible capture discipline. A capture remains correct after `SIGKILL`, a
checkpoint timeout, or a live writer because it uses SQLite's backup API, an
LTX transaction boundary, or another independently qualified consistent-cut
primitive. See the resolved
[WAL-checkpoint prerequisite](../issues/closed/20260807-server-sigterm-strands-large-sqlite-wal.md)
and [`LocalDatabase::shutdown_checkpoint`](crates/snapback/src/storage.rs).

## Normative vocabulary

### Envelope, member, and profile

- The **durable-store envelope** is the closed set of database-resident and
  external members whose bytes, authority, lineage, or references affect the
  meaning of one instance's durable state.
- A **member** is one independently classified table, file, directory, object
  namespace, external secret, replication carrier, or lineage record.
- An **operation profile** is a total mapping from the discovered member set to
  custody actions, plus a capture discipline, identity policy, publication
  policy, and (where applicable) activation policy.
- **Same instance** means the same logical app and the same operational
  authority/lineage identity, not merely the same `appId` or database basename.
- A **derived instance** is a separately owned runtime boundary created from a
  source cut. LLP 0158's same-`appId` derived deployment is one such class.
- An **operational secret** is any key, bearer, token, credential, grant,
  capability, provider secret, signing material, or live coordination carrier
  that can authorize, decrypt, resume, administer, emit effects, or mutate an
  instance.

### Custody actions

These five actions are normative for all profiles. The definitions are a
design decision generalizing the implemented fork vocabulary in
[`crates/snapback/src/instance_fork.rs`](crates/snapback/src/instance_fork.rs):

| Action | Required result | Basis |
| --- | --- | --- |
| `copy` | Carry the member's source meaning into the artifact or target, integrity-bound to the same capture. `copy` may use a semantic capture primitive; it never requires pathname-level byte copying. | Design decision generalized from LLP 0158; SQLite semantic copying is evidenced by [`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs). |
| `scrub` | Ensure the target/artifact contains neither the source bytes nor spendable meaning. Absence, deletion, irreversible redaction, and safe inert projection are allowed only when the profile names which one. | Design decision generalized from LLP 0158; current table deletion is in `scrub_and_mint_with_cut` in [`crates/snapback/src/instance_fork.rs`](crates/snapback/src/instance_fork.rs). |
| `rotate` | Mint independent target authority/identity and bind it before activation; the source value must not validate in the target. | Design decision generalized from LLP 0158; current auth/data streams and keyrings rotate in [`crates/snapback/src/instance_fork.rs`](crates/snapback/src/instance_fork.rs). |
| `share` | Bind source and target to one deliberately shared external object under an explicit ownership, mutation, and GC policy. Shared path placement alone never counts. | Design decision; LLP 0158 names shared/content-addressed asset custody as follow-on rather than inferring it. |
| `refuse` | Abort before publication or activation and name the unclassified/unsupported member. No partial target may become servable. | Design decision generalized from `audit_connection` and store-export refusal in [`crates/snapback/src/instance_fork.rs`](crates/snapback/src/instance_fork.rs) and [`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs). |

`Database`, `Folded`, `Required`, `Optional`, `InstanceLocal`, and `Refuse` in
LLP 0192 remain local **inventory roles**. They are inputs to profile
evaluation, not substitutes for the five actions. In particular, `Optional`
does not authorize presence-based inheritance: the selected profile must still
emit an action for the member.

## The custody manifest

Every operation MUST select its profile before it reads or creates a target.
The result MUST carry a versioned manifest with at least:

1. `schemaVersion` and `profile`;
2. a unique operation id and creation time;
3. source logical-app and instance/lineage identity when those identities
   exist;
4. the capture discipline and exact transaction/commit boundary;
5. the target-identity policy;
6. one record for every discovered member: stable member id, member class,
   custody action, outcome, source of the rule, and (for carried or minted
   bytes) digest and length or an equally strong target-specific integrity
   binding;
7. explicit authority effects: which authority was copied, scrubbed, rotated,
   or shared;
8. publication state and, for operations that can serve, activation state and
   predecessor-fence evidence;
9. the manifest's own canonical digest.

This list is a **design decision**. Existing `StoreExportManifest` and
`ForkMintReceiptV1` are evidence for the shape but do not yet conform to one
shared schema ([`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs),
[`crates/snapback/src/instance_fork.rs`](crates/snapback/src/instance_fork.rs)). The manifest MUST contain
no secret bytes, bearer values, plaintext configuration secrets, or decryption
keys. Digests and non-secret key identifiers are allowed when they do not make
low-entropy material guessable.

The member inventory is closed per target and schema version:

- local file members originate in `durable_state_members`;
- local database-resident owned tables originate in an inventory at least as
  strict as `TABLE_CUSTODY` plus `audit_connection`;
- target adapters add object namespaces, external key custody, replication
  lineage, and provider control-plane members;
- a new owned member and its profile rules land together;
- unknown members, unknown actions, unknown required fields, and unsupported
  profile versions refuse.

## Cross-profile matrix

The following is the normative profile boundary. Each row is a **design
decision** except the `fork` row, which delegates to LLP 0158's accepted and
implemented local profile.

| Profile | Identity intent | Authority rule | Publication / activation rule | Basis |
| --- | --- | --- | --- | --- |
| `snapshot/backup` | Recover the same instance at a declared capture boundary. | Copy exactly the profile-declared recovery authority; the auth keyring is mandatory when the captured catalog depends on it. Exclude instance-local runtime ownership. | Publish an inert, verified artifact; capture success never activates another writer. | Design decision from LLP 0191 §4; current partial evidence in [`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs), [`crates/snapback/src/auth/backup.rs`](crates/snapback/src/auth/backup.rs), and LLP 0188 §2. |
| `restore` | Preserve the source instance identity or mint a declared successor, never infer the choice. | Consume the input manifest, then apply the selected target-identity policy's copy/scrub/rotate rules. | Verify first, prepare inactive, fence predecessor, cross one activation barrier, and receipt the outcome. | Design decision from LLP 0191 §4; current partial evidence in [`crates/snapback/src/auth/backup.rs`](crates/snapback/src/auth/backup.rs), [`crates/snapback/src/instance_lock.rs`](crates/snapback/src/instance_lock.rs), and LLP 0188 §6. |
| `clone-for-test` | Create a non-production derived instance for testing. | A named authority policy is mandatory. V1 defines `isolated`: retain test-relevant identity records, scrub spendable credentials and pending consent, rotate stream/key authority, and refuse unclassified authority. | Target remains non-servable until isolation and effect quarantine verify. Authority inheritance is unsupported in v1 and therefore refuses rather than becoming a hidden default. | Design decision; the negative-authority and quarantine precedent is current in [`crates/snapback/src/instance_fork.rs`](crates/snapback/src/instance_fork.rs). |
| `fork` | Create LLP 0158's same-`appId`, independently owned, finite derived deployment. | Use LLP 0158's exact table and sidecar custody manifest, scrub-and-mint transaction, private asset cut, worker pause, and deny-all egress posture. | Use LLP 0158's S0–S5 crash-safe publication and lifecycle evidence. | Accepted owner and current code: [LLP 0158 §Design sketch](./0158-instance-forking.rfc.md#design-sketch) and [`crates/snapback/src/instance_fork.rs`](crates/snapback/src/instance_fork.rs). |
| `export` | Produce logical portable application/auth identity data for import under a separately chosen target identity. | Include declared logical records; exclude operational secrets and spendable/pending authority by construction. Physical keyrings and instance-control carriers never appear. | Publish a validated logical manifest/chunk set; activation belongs to the bulk import protocol, not this physical-envelope Spec. | Design decision from LLP 0191 §6 and [`issues/20260730-auth-logical-export-import.md`](../issues/20260730-auth-logical-export-import.md). |

### `snapshot/backup`

The capture discipline MUST produce a transactionally consistent database
boundary without depending on graceful shutdown. The currently admissible
local discipline is SQLite online backup; LLP 0188's retained LTX boundary plus
its governing keyring snapshot is admissible only through that RFC's integrity,
lineage, encryption, and qualification rules. A future target may add an
equivalent primitive, but must prove the same consistency class.

The profile MUST declare whether it is a whole-instance snapshot or a bounded
unit such as LLP 0057's auth backup. A bounded unit cannot claim whole-envelope
recovery. For same-instance recovery, every authority member needed to
interpret or validate the captured rows is `copy`: at minimum the auth keyring
when an activated auth catalog is present; other keyrings, configuration,
assets, and external custody are resolved from the closed target inventory.
Locks, ready capabilities, staging, and process-local telemetry are `scrub`
unless a future profile explicitly specifies a non-authoritative diagnostic
attachment.

Optional continuity authority is never copied silently. For example, the
current local store copy records whether it carries admin authority and live
sessions in `StoreExportDeclaredProperties`; a conforming manifest must also
record the per-member action that produced those facts
([`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs)).

Capture publication inherits LLP 0057's three outcomes:
`Unpublished`, `Published`, and `CommitAmbiguous`. A caller may advertise a
usable artifact only after integrity verification; an ambiguous publication
requires inspection, never optimistic retry that might create a second
artifact.

### `restore`

Restore is not file placement. It is the state transition from a verified,
inactive artifact to one authoritative serving instance.

The restore input MUST be authenticated or integrity-verified against its
closed manifest before destructive target effects. Every carried database row
that references key material MUST resolve against the selected keyring; missing
or ambiguous lineage refuses. The target MUST be new/private staging until all
members and authority effects validate.

The operation MUST select one target-identity policy:

- `preserve-instance` continues the captured instance and its declared
  authority. It requires proof that no predecessor can still write, admit
  sessions, advance replication, or emit autonomous effects.
- `successor-instance` preserves the logical app but rotates the instance's
  runtime/stream authority and applies declared revocation/purge rules before
  bind. LLP 0057's declared restore is the current auth-unit precedent.
- `derived-instance` delegates to `clone-for-test` or `fork`; plain restore may
  not invent derived-instance custody.

These policies are a **design decision**. Current `auth restore` implements
part of `successor-instance`: a new target directory, target reservation,
verified members, a restore declaration, session revocation, challenge purge,
and further ReadyV2 authority cleanup
([`crates/snapback/src/auth/backup.rs`](crates/snapback/src/auth/backup.rs), LLP 0057 §Restore). LLP 0188's
replication succession and lineage rules provide the off-host fencing
precedent; they are not a current general restore implementation.

Activation is a single named barrier. Before it, the target MUST refuse normal
serving. The barrier may cross only after:

1. input verification and member materialization are complete;
2. target identity and all rotations/scrubs are durable;
3. predecessor write, session-admission, replication-head, scheduler, worker,
   and egress authority are fenced or explicitly proven absent;
4. the target's own startup validation accepts the manifest and sidecars.

The activation receipt MUST bind the predecessor evidence, target identity,
input-manifest digest, and the exact barrier transition. A crash before the
barrier leaves an inactive target; a crash after it leaves enough durable
evidence to decide idempotently whether activation committed. These barrier
and predecessor-fencing requirements are **design decisions** not yet
implemented as one cross-target restore protocol.

### `clone-for-test`

`clone-for-test` exists for fixtures, migration rehearsals, debugging, and
other test environments that need production-shaped data without accidentally
becoming production authority. Its request and manifest MUST name an
`authorityPolicy`; neither copied filenames nor destination names such as
`test`, `staging`, or `dev` supply policy.

V1 specifies only `isolated`:

- logical application rows and non-spendable auth identity/recovery records
  may `copy` when their owning schema permits;
- sessions, bearer/token families, verification codes, agent credentials,
  grants, invitations, pairing requests, provider secrets, admin capabilities,
  resume authority, and pending external-effect authority `scrub`;
- auth/data stream identities, required encryption/signing keyrings, local
  admin authority, and other target identity `rotate`;
- scheduled and durable work is inert, and outbound effects refuse until an
  independently specified test-effect policy admits a class;
- unknown credential, effect, or lineage members `refuse`.

This is a **design decision** modeled on the current fork policy in
`TABLE_CUSTODY`, `SIDECAR_CUSTODY`, and `scrub_and_mint_with_cut`
([`crates/snapback/src/instance_fork.rs`](crates/snapback/src/instance_fork.rs)). There is no current
standalone `clone-for-test` implementation or conformance claim. A future
authority-inheriting test clone requires a separately named policy, threat
model, and acceptance corpus; until then a request to inherit authority
refuses.

### `fork`

LLP 0158 owns the fork profile. This Spec does not duplicate its table list or
weaken its accepted semantics. A conforming fork manifest MUST bind or embed
the exact `ForkMintReceiptV1` custody map and preserve LLP 0158's fail-closed
inventory, same-cut database/assets materialization, credential negative
corpus, stream/key rotation, non-promotable finite lineage, worker quarantine,
egress denial, and S0–S5 publication.

LLP 0158 becomes a consumer of this Spec conceptually; a later amendment may
add the shared manifest envelope without changing its owned policy. Its current
implementation and receipts are a conformance witness for the `fork` row, not
evidence that the other four profiles exist.

### `export`

The `export` profile is logical and portable. It is not the existing physical
command named `snapback store export`. Command spelling never selects the
profile; manifests do.

The logical export includes application data and explicitly declared identity
and recovery metadata. For the agent-auth surface, the current open contract
requires agent principals and identities, ownership, registration provenance,
deactivation state, and `_auth_scope_bases`; it excludes credentials, scoped
tokens, grants, invitations, pairing requests, and other spendable or
consent-pending authority
([`issues/20260730-auth-logical-export-import.md`](../issues/20260730-auth-logical-export-import.md)).
All keyrings, config secrets, admin/console capabilities, resume authority,
provider credentials, instance locks, lineage writers, replication credentials,
and raw telemetry are operational secrets or instance-control state and MUST
not appear in logical output.

The exact logical schema, chunking, resumption, validation, import activation,
and target identity mapping belong to LLP 0191 §6's bulk-transfer protocol.
This Spec owns only the seam: physical snapshots may carry recovery authority;
logical export may not. The existing `store-export.json` physical manifest is
therefore not a logical-export format.

## Processing rules

All profiles follow this order. These are **design decisions** unless a current
witness is cited above:

1. **Select profile and target policy.** Refuse absent or unsupported values.
2. **Discover the closed envelope.** Resolve every member through target-owned
   code, not filename heuristics supplied by the caller.
3. **Audit completeness.** Refuse unknown owned tables, files, namespaces, or
   authority carriers before any publishable target exists.
4. **Acquire one consistent cut.** Bind the database boundary to corresponding
   keyrings, assets, external objects, and replication position under the
   profile's consistency rules.
5. **Apply custody in private staging.** Copy, scrub, rotate, or establish a
   declared share; a refused member aborts.
6. **Verify and receipt.** Reopen/validate materialized state, verify digests
   and references, and create the custody manifest without secrets.
7. **Publish atomically.** Use the target's qualified atomic-publication
   primitive and report `Unpublished`, `Published`, or `CommitAmbiguous` (or a
   future schema-compatible target equivalent with the same distinctions).
8. **Activate only if the profile serves.** Apply the restore/derived-instance
   barrier and predecessor fences; snapshot and export artifacts remain inert.

No operation may derive a missing member's action from another profile. No
operation may treat successful boot as proof of correct custody: a copy can
boot while preserving the wrong credentials, lineage, worker claims, or
external-effect authority.

## Acceptance

No profile is claimable from prose alone. A profile's acceptance corpus MUST
exercise the target's real capture and activation paths and retain a manifest
or receipt for each case.

1. **Inventory closure.** Plant every known table and external member; prove one
   manifest action each, then add an unknown owned member and prove refusal
   before publication. Local evidence should extend the divergence tests in
   [`crates/snapback/src/store_state.rs`](crates/snapback/src/store_state.rs) and custody audit tests in
   [`crates/snapback/src/instance_fork.rs`](crates/snapback/src/instance_fork.rs).
2. **Consistent capture.** Capture under concurrent writes and with committed
   WAL state after unclean exit; prove one transaction boundary, standalone
   integrity, referenced asset completeness, and matching key custody. A clean
   shutdown may be a control, never a prerequisite.
3. **Authority matrix.** Plant live sessions, every credential/token/grant
   family, config/provider secrets, admin and resume bearers, signing and
   encryption keys, pending work, and external-effect intents. For every
   profile, prove copied authority works only where declared and every
   scrubbed/rotated source authority fails in the target. Logical export adds a
   planted-secret byte scan over every output component.
4. **Publication crash cuts.** Cut around every member write, manifest write,
   fsync, rename/provider commit, and final receipt. Prove only the declared
   publication state and never a partially servable target. LLP 0057 and LLP
   0158 provide the local precedent.
5. **Restore input and identity.** Reject corrupt, incomplete, wrong-profile,
   wrong-lineage, missing-key, replayed, and unsupported-version inputs before
   destructive effects. Exercise each supported target-identity policy.
6. **Activation and predecessor fencing.** Race an old and new process, stale
   session admission, scheduler/worker claims, effect egress, and replication
   head advancement. At most one side may hold each mutating authority after
   the barrier; crash/retry must decide idempotently from durable evidence.
7. **Clone isolation.** Present every source credential and cursor to the clone,
   attempt autonomous and handler egress, and prove refusal; prove retained
   identity/application rows remain usable for test logic without reviving
   source authority.
8. **Fork conformance.** Reuse LLP 0158's accepted local corpus by binding its
   exact implementation/receipt digest to this profile. Do not extrapolate it
   to clone, restore, backup, or export.
9. **Logical round trip.** Through the separately accepted bulk-transfer
   protocol, verify included logical records, excluded authority, resumability,
   corrupt/older input handling, target identity mapping, and no resurrection
   of excluded authority.
10. **Target equivalence.** A target-specific accelerator (LTX, object snapshot,
    provider branch, volume clone, Postgres snapshot) must pass the same
    profile corpus; speed or provider nomenclature is not semantic evidence.

The existing local store export, auth backup/restore, fork, and shutdown tests
are inputs to this corpus, not a claim that the corpus is complete. LLP 0188's
G1–G3 gates remain prerequisites for any LTX-backed claim.

## Open questions

1. **Physical command naming.** Should the current physical
   `snapback store export` eventually become `store snapshot`/`store copy`, or
   should its manifest simply declare `snapshot/backup` while the logical
   command uses an unmistakable name? Renaming is not decided here.
2. **Same-instance identity.** Which durable identifier is the portable
   instance identity across local, hosted, and replicated targets? LLP 0158's
   `parentInstanceId` is intentionally source-shaped, not a universal id.
3. **Restore fencing authority.** What single component owns predecessor
   fencing across listener admission, background workers, replication head,
   and provider credentials on each target? Local locks and hosted supervisor
   generations are precedents, not yet one contract.
4. **Clone authority inheritance.** Is there a legitimate test workflow that
   needs live source credentials? V1 refuses it. Any future mode needs a named
   trust boundary and planted-credential/egress corpus before admission.
5. **External assets and shares.** Which object stores can prove atomic or
   same-cut asset custody, and when is `share` preferable to private copy? GC
   ownership and mutation authority must be settled together.
6. **Telemetry.** Should a non-authoritative diagnostic attachment be allowed
   on snapshot/backup, or should telemetry remain a separate export forever?
7. **Logical asset export.** Does the bulk-transfer protocol carry asset bytes,
   content-addressed references, or a separate assets manifest? It must not
   inherit physical-store credentials.
8. **Manifest schema ownership.** Should one Rust-owned shared schema replace
   `StoreExportManifest` and `ForkMintReceiptV1`, or should those receipts
   remain profile-specific beneath a small common envelope?
9. **Retention and deletion.** What pins snapshot members, replication
   segments, keyring snapshots, and shared assets until every referencing
   operation expires or activates?
10. **Hosted and Postgres inventory.** The local registry is concrete; complete
    member discovery and custody profiles for Cloudflare, container-VM, and
    Postgres targets remain unimplemented and unclaimed.

## Status

Draft. Charlie Cheever's 2026-08-08 ruling in LLP 0191 commissioned this as a
standalone Spec, with LLP 0158 remaining the fork profile and a consumer/
conformance witness. The next step is the LLP 0005 review loop. Acceptance,
implementation, command changes, capability publication, and bulk logical
import/export remain separate future acts.
