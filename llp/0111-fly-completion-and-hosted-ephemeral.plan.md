# LLP 0111: Fly completion and hosted ephemeral profile

**Type:** Plan
**Status:** Accepted
**Systems:** Deployment, Control plane, Ephemeral state, Realtime, TLS, Auth, Migrations, Backup, Restore, Logs, Inspection, Runtime, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-27
**Revised:** 2026-08-07 (LLP 0189 alignment sweep: verification-cadence/claim-gating clauses re-scoped or annotated to the LLP 0189 D-3/D-6 defaults). 2026-08-06 (dated amendment drafted at the author's
direction and ratified by the author the same day: continuous-replication
custody role split per LLP 0188 §5, admissible only with store-enforced
immutability and jointly with LLP 0072's continuous-replication authority
amendment). 2026-08-03 (Accepted 2026-08-03 by the author — decision
sitting #2, "accept all that verify",
`issues/20260803-author-decision-sitting-2.md`; gate verified: the round-3
Fable-READY/Codex-NOT-READY residue is closed by the §Final author
reconciliation dispositions, and the 2026-07-30 promotion-ordering conflict
was resolved by the 2026-08-02 decision-sitting propagation below; acceptance
covers the Plan text only — Implemented still requires the complete evidence
gate and `ephemeralHostedAdapter` remains false until it passes; status
Review → Accepted). 2026-08-02 (decision-sitting propagation: the local nine-package
closure now follows LLP 0074's parallel npm gate and LLP 0134's maturity bar;
default-channel promotion is no longer serialized behind hosted qualification,
while every hosted-dependent claim and its hosted evidence gate remain intact;
source: `issues/20260802-author-decision-packet.md`). 2026-07-30 (dated conflict flag, decision pending — no semantic
change: this Plan serializes default-channel (`latest`) promotion of the
nine-package closure behind the complete hosted Fly qualification journey,
while LLP 0074 makes public npm publication a parallel gate independent of
hosted milestones, and the eight-package `0.1.0` closure in fact reached
`latest` on 2026-07-26, the day before this Plan's gate was written. The
Diary 0039 rerun ranks a boring public install as the top P0 lever, which
the hosted-gated ordering delays. Which document governs the next promotion
is an author decision recorded as LLP 0115 open question 5; until it is
made, this Plan's ordering stands as written.) 2026-07-28 (corrective implementation addendum: canonical pending
request reservation, registry-owned response class, supervisor-owned control
head, exact credential/grant/digest gates, bounded canonical reads, and all
lifecycle effects disabled pending a reviewed carrier/custody closure).
2026-07-28 (unreviewed post-round correction: purpose-limited
service intermediates, recovery bootstrap/rebind, transitive delegation,
atomic response replay, publication authority, and bounded upload). 2026-07-28 (LLP 0113 corrective reconciliation: closed
operator/root lifecycle, release-upload separation, self-expiring claim
families, and ledger lineage). 2026-07-28 (post-bakeoff round-2 reconciliation: root-signed
operator enrollment and scopes, exact first-publication claim semantics,
capability-only revocation, legacy disposition equivalence, and staged-target
adoption). 2026-07-28 (post-bakeoff round-1 reconciliation: qualification
promotion carrier, candidate registry state machine, bounded native TLS bridge,
closed operator/command authority, migration decisions, and unambiguous
cleanup). 2026-07-28 (post-bakeoff execution amendment: explicit legacy
certificate bootstrap, public-package closure, served corpus identities, and
cutover/cleanup stop rules). 2026-07-27 (round-1 author reconciliation: expiring
machine-bound routing admission, exact lifecycle-v2 carriers and handoff,
opaque ephemeral authority negotiation, distinct TLS replacement classes,
online admission renewal, versioned target/credential binding, raw evidence,
packed journey, spend grant, and closed cleanup). 2026-07-27 (initial focused plan for the backend-bakeoff hosted completion program)
**Related:** LLP 0012, LLP 0013, LLP 0026, LLP 0031, LLP 0037, LLP 0053, LLP 0060, LLP 0064, LLP 0071, LLP 0072, LLP 0077, LLP 0081, LLP 0094, LLP 0098, LLP 0099, issues `20260727-hosted-ephemeral-parity` and `20260726-0072-fly-adapter-remaining-surface`

## Summary

The first complete hosted Snapback target should be the existing Fly.io
`single-instance-container-vm.v1` target, completed through the public packaged
CLI. The same single-routed-process invariant can honestly qualify Snapback's
existing process-memory ephemeral backend as
`single-instance-sticky-memory.v1`; Redis and Durable Objects are unnecessary
for this exact profile and remain required for any multi-instance profile.

This Plan closes two related gaps without broadening the claim:

- finish the Fly Machines/Tigris lifecycle driver and produce one ordinary
  product-journey receipt from package installation through deploy, inspection,
  migration, backup, executed restore verification, rollback, logs, cost, and
  cleanup; and
- run the target-neutral ephemeral corpus against the real served Fly profile,
  including process-restart loss and client republish.

The target still has one routed Machine, bounded downtime during activation,
no horizontal scale, no HA, no managed SLA, no multi-region failover, and no
durable presence. A second routed process immediately invalidates the ephemeral
capability and the adapter refuses activation.

## Default-channel amendment — 2026-08-02

The 2026-08-02 author decision adopts LLP 0074's parallel npm gate for the
locally provable nine-package surface. Once that closure satisfies LLP 0134's
maturity bar (as re-scoped by LLP 0189 D-6) and its local publication
evidence, it may promote to npm `latest` independently of the hosted Fly
journey. This supersedes this Plan's
serialization of default-channel promotion behind the complete hosted
qualification, and only that serialization.

Hosted-dependent capabilities remain GAPs and nonclaims until their own gates
in this Plan pass. Exact-version candidate-tag publication remains the only
pre-qualification path for bytes intended to support those hosted claims; a
locally promoted `latest` release is not evidence of hosted support. Source:
`issues/20260802-author-decision-packet.md`.

## Continuous-replication custody amendment — 2026-08-06 (ratified by the author 2026-08-06)

Required by LLP 0188 (Accepted 2026-08-06) as a hard prerequisite of its
hosted continuous-replication lane; drafted at the author's direction.
This Plan's custody rule routes backup bytes through the supervisor and
gives the application Machine no provider credential. A continuous LTX
replicator inside the server process cannot ship through that path, so —
jointly with LLP 0072's continuous-replication authority amendment (both
ratified 2026-08-06) — this amendment admits LLP 0188 §5's **role split**
as a second admissible custody shape, for the continuous lane only:

- the application Machine holds an **append-only, prefix-scoped
  replication credential**, never exposed through the application secret
  API, valid **only where the store enforces immutability of written
  objects against that credential** (overwrite and delete denied by
  bucket policy or object lock, with the mechanism named in the per-store
  qualification receipt); where the store cannot enforce this, the
  continuous lane is inadmissible and the supervisor-mediated byte path
  remains the only custody shape;
- the supervisor is the **sole holder of the head-write and
  lifecycle/delete credentials** under LLP 0072's replication epoch,
  revoke-then-grant handover, drain-inclusive revocation barrier, and
  delete-visible reconciliation for pinned objects;
- the replication prefix lives in the same **separately permissioned
  Tigris boundary** this Plan already mandates for backups, with LLP
  0188 §5's encryption rules (keyring snapshots client-side encrypted
  unconditionally; asymmetric custody per the 0072 amendment).

What does not change: §3.3's periodic `createVerifiedBackup` maintenance
flow and §3.4's `restoreInactive` (which remains the identity-translating
restore path an LTX-materialized instance must also traverse per LLP 0188
§6 and the LLP 0057 amendment); the prohibition on application access to
provider credentials for every other purpose; and this Plan's gates.
Until LLP 0188's hosted gates pass, the operative shape remains exactly
this Plan's supervisor-mediated periodic backup.

## Governing amendments

Acceptance requires same-landing dated amendments:

1. LLP 0013 adds `EphemeralAuthorityInstanceV1` to the authority/wire model and
   records `single-instance-sticky-memory.v1` as the first hosted adapter.
2. LLP 0026 marks Phase 3 complete, selects the sticky single-instance profile
   for Phase 4, and leaves Redis/Durable Objects open for multi-instance
   targets.
3. LLP 0072 records this Plan's exact Fly lifecycle mapping, certificate/volume
   decision, public CLI receipt, and remaining nonclaims.
4. LLP 0094 adds the authority-instance member to the connection grant and
   ephemeral wire closure matrix. Old clients/servers fail capability
   negotiation rather than treating a new boot as the old room epoch.
5. LLP 0098 and LLP 0099 consume the same immutable release, hosted-edge
   attestation, migration-executor receipt, and public-origin identity.

No target advertises either completed profile until all applicable evidence
below is committed.

## 1. Exact target

The first target remains:

- provider/app: Fly.io, `snapback-drill`;
- region: `sjc`;
- runtime: one routed Fly Machine running one Snapback origin process and
  loopback Caddy;
- application data: SQLite on one encrypted Fly Volume;
- TLS: raw TCP passthrough to loopback Caddy, with Caddy state on the encrypted
  volume;
- immutable release: OCI image by registry digest;
- artifacts: Fly registry;
- backups: separately permissioned Tigris bucket/prefix;
- provider logs: Fly Machine events plus structured application/control export;
- control head/replay floor: the external Fly/Tigris authorities already
  specified by LLP 0072; and
- credential handles: macOS Keychain/provider secrets, never repository bytes.

Target registration pins resource IDs rather than discovering an application
by hostname at effect time. Every operation re-reads the Fly app, complete
Machine roster, Machine version/lease, volume attachment, certificate state,
image digest, and public origin before effects.

The profile requires exactly one **routed** Machine. A bounded non-routed
preflight process is allowed only when it has no production service mapping,
no production volume, no production credentials, and is destroyed before
activation. It cannot publish hosted or ephemeral evidence.

## 2. Hosted ephemeral semantics

### 2.1 Authority identity

Every process boot creates a cryptographically random UUIDv7
`processBootId`. The served connection grant contains:

```json
{
  "ephemeralAuthority": {
    "profile": "single-instance-sticky-memory.v1",
    "deploymentId": "opaque",
    "releaseId": "sha256:...",
    "activationGeneration": 7,
    "machineId": "opaque",
    "processBootId": "019...",
    "definitionGeneration": 4
  }
}
```

`EphemeralAuthorityInstanceV1` is the JCS digest of that closed object. Every
snapshot, upsert, remove, and resync frame carries the digest in addition to
room `scopeEpoch` and `entryVersion`. Clients compare room versions only inside
one exact authority instance. A different/missing instance clears the complete
old ephemeral overlay, fences old frames, and requires fresh subscribe plus
application republish before status becomes current.

A graceful release sends `ResyncRequired{reason:"Restarted"}` before closing
connections when possible. Crash, OOM, platform restart, or network loss may
prevent that frame; the new connection grant's changed `processBootId` is the
authoritative recovery boundary. UUID collision is treated as the same
negligible cryptographic-identity risk as existing UUIDv7 operation IDs; a
process never loads or accepts an authored boot ID.

### 2.2 Routing and activation

All public connections route to the one active Machine, so every room reaches
one in-process authority. Activation updates that Machine in place under the
external deployment lease:

1. re-read and require exactly one production-routed Machine;
2. stop new connection admission and drain for at most 30 seconds;
3. send the graceful restart boundary where possible;
4. update the immutable image/config on the same Machine;
5. wait for the new process boot and exact health nonce;
6. verify its new authority instance through the public TLS origin; and
7. reopen admission and record bounded downtime.

The adapter never blue/green-routes two process-memory authorities. A provider
roster with zero or more than one routed Machine, ambiguous routing, an
auto-scale policy capable of adding one, or a Machine identity mismatch refuses
with `SNAPBACK_EPHEMERAL_ROUTING_UNSAFE`. The target capability becomes false
before application ephemeral operations are admitted.

### 2.3 Loss and nonclaims

Room maps, entries, TTL indexes, subscribers, outboxes, rate buckets, and boot
IDs are process memory. Restart, release activation, destructive restore,
Machine replacement, or loss clears them. They are excluded from SQLite,
volumes, Tigris backup manifests, restore translation, migrations, RQS, offline
storage, export, and durable versions.

Recovery is reconnect, fresh authorization, fresh snapshot, and application
republish. Snapback does not replay a pre-crash client value automatically
unless the mounted application's first-party presence owner is still active and
chooses to republish its current value. An empty snapshot after restart is
correct.

The profile reuses the local backend's exact collection schema, generated API,
auth invalidation, TTL, limits, coalescing, durable-before-ephemeral drain, and
structured errors. Target facts report the same hard limits unless a reviewed
target override narrows them.

### 2.4 Capability facts

The Rust-owned `HostedEphemeralFactsV1` reports:

- `profile: single-instance-sticky-memory.v1`;
- backend and implementation digest;
- routing authority and exact routed Machine count;
- deployment/release/activation/process-boot/definition identities;
- limits, dispatch, frame-size, and rate profiles;
- auth-invalidation protocol and authority dependencies;
- state persistence `none`;
- loss recovery `resnapshot-republish`;
- durable lane priority fact;
- backup/migration/restore exclusion facts; and
- nonclaims for multi-instance, HA, offline, retained, and durable presence.

Public inspection reports capability/profile/limits and an opaque authority
digest. Machine ID, boot ID, room names, keys, scopes, subjects, values, and
subscriber facts require the gated developer/admin projection.

## 3. Fly lifecycle-driver mapping

The packaged `fly-machines-vm-driver.mjs` implements every existing closed
`snapback.vm-adapter-*.v1` operation. It may add no private lifecycle dialect.

### 3.1 Observation and lease

- `doctor`/`inspect`: provider app, exact roster, volume, Machine image/config/
  state/version, certificate, origin health, active release/control head, and
  capability gaps.
- `inspectAdmin`: authenticated public origin inspection plus provider
  read-back; the served manifest digest/release/generation/stream must agree
  with the control head and Machine image.
- `acquireLease`/`releaseLease`: Fly Machine lease plus exact current-version
  guard and external control-head CAS. Lost/expired lease refuses later steps.

Every provider GET/effect is bounded by timeout and returns URI, status,
request/response digest, provider revision/version, and `remoteEvidence`.
Noncanonical test bases can never mint remote evidence.

### 3.2 Release preparation

- `uploadImmutableRelease` verifies the registry digest and release-manifest
  digest, Linux architecture, Hermes/runtime closure, entrypoint, SBOM/license
  facts, and public web assets.
- `provisionInactive` creates the one stopped Machine and encrypted volume only
  for a new target; on an existing target it verifies exact identity and is an
  idempotent no-op.
- `compatibilityPreflight` validates predecessor/successor artifact, schema,
  function, route, migration, hosted-edge, and target-profile facts before
  changing the active Machine.
- `stageRelease` persists the desired image/config and migration approval in
  the external control record. It does not route or run candidate code.

The Linux image is built from public package/repository inputs by the CLI and
is content-addressed before the lifecycle plan. Hermes is a manifest component,
not an unrecorded Dockerfile download.

### 3.3 Backup, activation, rollback

- `createVerifiedBackup` enters the existing maintenance fence, pauses writes
  and external effects, creates an application-consistent SQLite backup plus
  schema/functions/routes/protected-host metadata manifests, uploads each
  component to the separate Tigris boundary, reads it back, verifies hashes,
  and resumes only after the terminal audit fact.
- `activateGeneration` executes the approved LLP 0081/0099 migration when
  required, performs the in-place Machine update, verifies public TLS/auth/
  health/data/realtime/inspection, and CASes the active control head.
- `rollbackGeneration` applies code-only rollback only when compatibility
  permits; it never rewinds application data. Forward-fix/restore-required
  classifications retain their existing meanings.

Every step is idempotent under `(operationId, planId, inputSha256)`. A lost
response re-reads provider/control facts and returns the retained terminal
result or a coded commit-uncertain reconciliation; it never repeats a backup,
migration, Machine replacement, or generation advance blindly.

### 3.4 Restore

`restoreInactive` always targets a fresh replacement incarnation. It:

1. confirms the exact source backup and destructive confirmation;
2. creates/attaches a fresh encrypted volume to a non-routed stopped Machine;
3. reads every component back from Tigris and verifies its manifest;
4. restores SQLite and protected artifacts, excluding all ephemeral bytes;
5. applies the LLP 0072 identity translation under a fresh stream, restore,
   admission, and ephemeral authority;
6. starts the Machine without public admission and runs integrity/auth/schema/
   function/migration/backup-lineage inspection; and
7. returns a paused verification receipt.

`restoreActivate` is a distinct confirmed operation that removes the
predecessor route, makes the verified replacement the sole routed Machine,
opens admission, and retires the predecessor. Failure before that switch leaves
the predecessor active; failure after an indeterminate provider response
reconciles the exact roster and control head before another effect.

The executed acceptance drill destroys or withdraws the disposable fixture
target, restores from its verified backup, proves a sentinel and absence of
ephemeral state, activates, then may restore the original target arrangement.

### 3.5 Logs, TLS, audit, cost

`logs` merges bounded Fly provider events with schema-owned application/control
events, preserving source sequence, delivery/drop/backpressure facts, redaction,
and retention class. Audit-required lifecycle facts go to the external
hash-chained ledger and never rely on bounded-loss application logs.

Caddy's `/data/caddy` state and SQLite's `/data/app` state live on the encrypted
volume under separate directories and backup policies. Machine update/
replacement reattaches the volume before Caddy starts. Acceptance uses a
staging issuer for destructive/retry cases and proves the production
certificate/account/key state survives stop/start and Machine replacement
without a new production issuance. The driver refuses when the certificate
store is rootfs-only.

The receipt reports measured/declared compute, volume, artifact, backup, logs,
DNS, and TLS costs; current utilization; fixed one-Machine capacity; and the
configured maximum monthly boundary. It does not extrapolate an SLA.

## 4. Public CLI product journey

From a clean temporary project and a freshly packed/installed package, one
documented command family must:

1. generate/build and print immutable release identity;
2. register or select the exact target;
3. run doctor and migration preflight;
4. plan and confirm deploy;
5. follow structured build/runtime logs;
6. verify public URL, authenticated inspection, live query/mutation, and
   hosted ephemeral presence;
7. create and verify a standalone backup;
8. perform the disposable executed restore drill and restore activation;
9. perform one compatible code rollback and re-activate the successor;
10. print cost/capacity and every nonclaim; and
11. destroy/withdraw temporary resources and prove cleanup.

The machine-readable `snapback.hosted-product-journey.v1` receipt binds package
tarball digest, repository/dirty state, target/release/deployment/database/
stream/restore/ephemeral identities, commands and exit classes, logs,
migration, backup/restore, rollback, TLS, cost, comparator results, and cleanup.
Secrets, bearer material, row values, room values, filesystem paths, and
private provider responses are absent.

The Rust carrier is content-addressed with `receiptSha256` over canonical JSON
excluding that field. Every retained evidence reference uses an opaque artifact
id plus byte length, media type, and digest; the operator supplies filesystem
locations separately to `snapback hosted-journey-verify`, which reopens the
bytes before accepting the claim. A passing receipt requires the exact command
family above, clean source/package identity, all remote identities, all nine
evidence families, internally consistent row details, and an empty temporary
lease/route/certificate-request/credential cleanup inventory. A failed receipt
may retain partial evidence but must keep hosted-product, hosted-ephemeral, and
comparator-parity claims false. Shape validation alone is never publication
authority.

## 5. Conformance and acceptance

### 5.1 Target-neutral ephemeral corpus

The same named corpus runs against local memory and the real Fly profile:

- schema/whole-scope validation, generated values, publish/delete/snapshot,
  snapshot-plus-register atomicity, update ordering, and coalescing;
- two-client convergence, connection/session/user/custom-key ownership,
  disconnect and TTL removal, quiet-room client pruning, and reconnect;
- exact entry/room/subscriber/bytes/frame/rate boundaries, queue overflow and
  fresh resync, with no silent eviction;
- auth denial, dependency-indexed revocation, dropped resync/ack, authority
  change, and secret-like value redaction;
- hot ephemeral traffic while durable mutation ack/live delivery remains
  inside its registered latency bound and drains first;
- graceful activation, hard process kill, platform restart, and replacement:
  the old overlay clears, old frames are fenced, the fresh snapshot is empty,
  active publishers republish, and clients converge;
- roster/routing failure with two routed Machines refuses capability and all
  ephemeral operations;
- no ephemeral operation changes a durable version or backup component; restore
  contains zero pre-backup room values; and
- inspection/receipt identity and public/gated custody match
  `HostedEphemeralFactsV1`.

### 5.2 Complete hosted journey

The existing LLP 0072 acceptance corpus plus:

- real remote evidence for every lifecycle/query operation;
- registry/image/Linux/Hermes closure from a cold package install;
- exact migration preflight/apply and compatible rollback classification;
- standalone backup read-back and executed isolated restore/activation;
- public TLS certificate storage across Machine replacement;
- authenticated served inspection matching provider/control identity;
- structured logs and external audit roots;
- measured cost/capacity and explicit HA/autoscale/multi-region/SLA nonclaims;
- comparator-acceptance-kit receipt for the ordinary product fixture; and
- no leaked temporary Machine, volume, lease, route, certificate request,
  backup test object, or credential.

Any failed mandatory item leaves both profiles unavailable and produces a coded
recovery receipt. Evidence from fixture servers or deterministic harnesses
cannot satisfy a remote row.

## 6. Implementation sequence

1. Super-refine this Plan with fresh Fable 5 and Codex reviewers; reconcile the
   governing amendments before advertising anything.
2. Extract the target-neutral ephemeral corpus and add authority-instance wire/
   client handling on local first.
3. Add exact single-routed-Machine facts and hosted ephemeral capability to the
   Fly target; pass restart/republish and durable-lane evidence.
4. Complete driver observation, admin inspection, lifecycle, backup, restore,
   TLS, log, cost, and interruption tests against a noncanonical fixture API.
5. Build/package the Linux release and run the complete real Fly/Tigris journey
   with staging certificate cases before the production persistence witness.
6. Commit receipts, guide/capability updates, demo diary, and ticket
   resolutions; run LLP maintenance, referencing the most recent eligible
   complete battery per LLP 0189 D-6 rather than a full proof at this
   commit.

## Non-goals

- multiple routed Machines, shared Redis/DO rooms, HA, autoscaling,
  zero-downtime activation, multi-region, or managed SLA;
- durable, retained, offline, migrated, exported, or restored presence;
- Cloudflare ephemeral parity by inheritance;
- arbitrary provider shell commands or repository-private deployment scripts;
- application access to Fly/Tigris primitives; or
- treating a successful provider API call without public/read-back evidence as
  a completed lifecycle fact.

## Status

Accepted (2026-08-03). The Plan can be Implemented only after the governing
dated amendments, complete local/fixture/remote evidence, and an LLP
maintenance audit. Until then the Fly adapter remains partial and
`ephemeralHostedAdapter` remains false.

## Round-1 author reconciliation

This section is normative where it conflicts with the first draft.

### Expiring routed-machine authority

A **routed Machine** is any Machine in the bound Fly app whose complete config
contains the production service/process-group mapping, regardless of started,
stopped, suspended, autostop, or autostart state. A policy capable of creating,
autostarting, or routing another such Machine is part of the roster and makes
the profile ineligible.

The control plane owns a closed `FlyTargetBindingV2` naming organization, app,
region, origin, active Machine incarnation, complete Machine roster, service/
process-group routes, autostop/autostart/autoscale posture, volume, OCI
repository/digest, Tigris bucket and per-role prefixes, issuer, certificate
posture, external-head key, and ownership sentinel. It also names separate
credential handles/fingerprints for Fly control, registry, artifact, backup,
control state, audit, logs, admission, replay floor, and cleanup. Hostname
discovery, ambient credentials, and first-Machine selection are forbidden on
effect paths.

After provider read-back proves exactly one routed Machine, the control plane
mints a signed `HostedAdmissionV2` bound to target id, binding digest,
machine id, provider version, configuration digest, external head, and an
expiry no more than 60 seconds ahead. The origin has no Fly credential; it
verifies this short-lived admission at connection open, subscribe, ephemeral
publish/delete, drain, and final frame send. A supervised online channel
renews it every 30 seconds. Expiry, roster drift, or machine mismatch
withdraws hosted-ephemeral capability, refuses new work, emits one restart
boundary, clears clients, and force-closes sockets. An out-of-band second
routed or autostartable Machine cannot obtain a matching admission and refuses
to serve ephemeral operations. The control plane also re-witnesses the roster
at every lifecycle step. Provider compromise between read-backs remains an
explicit residual; data-plane admission bounds it to the signed expiry.

### Ephemeral wire and custody

Connection open negotiates the must-understand numeric offer/echo
`ephemeralAuthorityProtocol: 1` under LLP 0094's controlling per-boundary
matrix. The former string spelling `"ephemeral-authority.v1"` is superseded
and must be refused. Missing or unsupported
negotiation disables/refuses only ephemeral operations with
`SNAPBACK_EPHEMERAL_AUTHORITY_UNSUPPORTED`; durable connection features remain
available. The negotiated protocol conditionally adds the opaque
`ephemeralAuthorityInstance` string to every ephemeral request, success,
error, acknowledgement, snapshot, upsert, remove, and resync frame. Old/new
client/server cross-product fixtures prove no silent downgrade.

The string is:

```text
eai1.<base64url-no-pad(
  SHA-256(
    UTF8("snapback:ephemeral-authority-instance:v1\n") ||
    RFC8785_JCS({
      targetId, deploymentId, machineId,
      authorizationIncarnation, bootSequence, bootNonce,
      profile: "single-instance-sticky-memory.v1"
    })
  )
)>
```

It deliberately reuses the existing grant's never-reused issuer boot identity
instead of minting a second boot UUID. Ordinary grants expose only this opaque
digest and profile. Machine/member breakdown, route roster, and boot facts
remain gated admin custody. Clients compare room versions only within one
exact digest. On change they clear all room state, reject predecessor
responses, resubscribe, and invoke an application-registered republisher; a
fresh snapshot makes observers current while a publish acknowledgement under
the new digest makes that publisher current. TTL expiry remains mandatory
while live, stale, disconnected, partitioned, or authority-lost in every
client arm.

### Exact lifecycle-v2 protocol and restore cutover

The adapter implements the existing operation names exactly:
`observe`, `acquireLease`, `renewLease`, `releaseLease`,
`uploadArtifact`, `provisionInactive`, `verifyServedPath`,
`fenceExternalEffects`, `stageRelease`, `preflightMigration`,
`applyMigration`, `activate`, `rollback`, `backup`,
`restoreBackupInactive`, `verifyRestoredComponents`,
`verifyRestoredApplication`, `activateRestoredGeneration`, `readLogs`,
`inspectAdmin`, and `reconcile`. New destroy work uses a separately versioned
`planCleanup`, `confirmCleanup`, and `applyCleanup` family; no alias/private
dialect is admitted.

Where v1 carriers cannot express Fly binding, migration authority,
commit-uncertain status, restore translation, cleanup, or effect-open state,
the landing adds closed descriptor/plan/request/response/observation/receipt
v2 schemas. Each provider effect has a stable semantic id and digest over
operation, target binding, artifact/plan identity, and desired provider state;
retry attempt, lease token, timestamps, and local paths are excluded.
Responses distinguish `notApplied | applied | commitUncertain`; uncertain
effects reconcile provider, external-head, route, and raw-evidence facts before
another write. Migration requests carry LLP 0099 approval, admission,
rehearsal, executor job, checkpoint, and terminal receipt identities.
Automatic rollback is forbidden after the durable effect-open boundary.

Restore is a downtime handoff:

1. acquire lease/current-version authority and create a non-routed helper with
   a fresh encrypted volume;
2. restore and verify SQLite/protected components while all admission/runtime
   authority stays under `/run` and is never restored;
3. withdraw predecessor admission, send the boundary, drain then force-close
   every socket, prove zero predecessor sockets/effect authority, stop the
   predecessor, and persist the new external head;
4. route and start the successor alone, mint admission for its exact Machine,
   verify public/admin read-back, then retire predecessor resources; and
5. reconcile every interruption from durable predecessor/successor head and
   provider route facts.

No two memory authorities are usable concurrently. Zero-downtime restore is a
nonclaim. Restore stream/incarnation translation is explicit in the v2
descriptor and is validated rather than forced to equal the backup source.

### TLS, admission, evidence, and packaging

Stop/start, update, and same-volume Machine replacement must preserve
`/data/caddy`. Fresh-volume destructive restore does **not** back up ACME
account/certificate keys; it requires reissuance. Staging is the default
restore witness. Production issuance requires a one-use issuance/spend grant,
read-back of remaining attempt budget, and refuses before routing if unsafe.
The current cert-only deployment migrates once to a fresh target id by a
non-routed helper that copies the existing Caddy state into the single
encrypted volume; the old `snapback-drill` target is retired and its immutable
target id is never reused. Admission/key projections live under `/run`.

The online admission supervisor mints, delivers, and rotates five-minute
hosted-auth admissions and the 60-second routed-machine admission over the
authenticated control channel. Activation/restore changes force immediate
rotation. Receipt facts include current expiry/renewal mode; renewal failure
withdraws serving. The remote proof runs beyond both renewal intervals.

The package owns content-addressed raw Fly/Tigris/TLS/log evidence and a
versioned reducer. Raw records bind request/response bytes, resource/account,
provider revision/request id, capture/server time, credential fingerprint,
TLS facts, and freshness challenge. Adapter-supplied URI/digest/`verified`
claims cannot qualify evidence. Structured application/control logs are
exported to the dedicated Tigris log prefix with independent sequence/
delivered/dropped counters, retention, redaction, capacity, cost, and cleanup.
The journey verifier reopens every subordinate artifact.

The reviewed adapter ships at a stable CLI-owned package path. The public
target constructor pins its digest automatically. The clean-package journey
uses a digest-pinned OCI builder/base image/toolchain, immutable registry push
and read-back, no repository/sibling imports, and records builder resources,
credentials, cost, and cleanup.

### Spend authority and cleanup

Before any remote build, upload, provision, certificate attempt, backup, or
restore, a one-use expiring destructive/spend grant binds maximum concurrent
Machines/volumes (including restore overlap), builder resources, registry and
object bytes, snapshots, logs, egress, IPs, certificate attempts, and total
drill cost. This is a Snapback refusal boundary, not a claim that Fly enforces
a billing cap. Cost components use the closed names
`compute | persistentVolume | objectStorage | logs | dns | tls`; artifact and
backup details are `objectStorage` subfacts.

Cleanup is plan/confirm/apply, inventories exact ownership sentinels before
effects, converges provider absence, verifies Tigris prefixes and credentials,
then revokes temporary credentials last. Fixed shared names are never
destroyed without an exact sentinel. Residual resources yield non-success with
continuing cost. Journey receipt schema and package inventory are Rust-owned
under LLP 0037 and include the already-landed comparator receipt as a required
dependency. The maintenance-receipt schema is corrected to admit the emitted
`backup/backedUp` pair, and authority-frame bytes participate in all existing
outbox/frame limits.

## Round-2 author reconciliation: closed hosted v2

The second review agreed with the single-routed-Machine profile but found the
lifecycle vocabulary, online supervisor, control-head transfer, wire rollout,
spend authority, and one-time TLS transition under-specified. This section is
normative and supersedes contrary text above.

### Exact v1 closure and additive v2 operations

The existing adapter protocol has exactly these operations:

```text
AdapterOperation:
  doctor, inspect

AdapterLifecycleOperation:
  acquireLease, uploadImmutableRelease, provisionInactive,
  compatibilityPreflight, createVerifiedBackup, stageRelease,
  activateGeneration, verifyServedPath, rollback, fenceExternalEffects,
  restoreBackupInactive, verifyRestoredComponents,
  verifyRestoredApplication, activateRestoredGeneration, releaseLease

AdapterQueryOperation:
  logs, inspectAdmin
```

No `observe`, `uploadArtifact`, `preflightMigration`, `applyMigration`,
`activate`, `backup`, `readLogs`, or generic `reconcile` alias exists.
Migration execution remains part of `activateGeneration`: it admits and
observes LLP 0099's resident executor and never becomes an independent remote
batch executor.

V2 is additive. It retains every v1 spelling and adds only:
`renewLease`, `reconcileEffect`, `planCleanup`, `confirmCleanup`, and
`applyCleanup`. The first two use
`snapback.vm-adapter-lifecycle-request.v2`; cleanup uses
`snapback.vm-adapter-cleanup-request.v1`. A generated mechanical test compares
the v1 list with the three Rust enums above and compares the v2 additions with
their new Rust enums. No private operation can satisfy acceptance.

### Closed carrier, digest, and effect journal

Rust owns and exports JSON schemas for `FlyTargetBindingV2`,
`HostedAdmissionV2`, `AdapterLifecycleRequestV2`,
`AdapterLifecycleResponseV2`, `ProviderEffectIntentV1`,
`ProviderEffectObservationV1`, `ProviderEffectTerminalV1`,
`HostedControlHeadV2`, and the cleanup plan/confirmation/receipt. Requests are
closed tagged unions; each operation variant has only its legal plan,
predecessor version/head, lease, admission, migration, and confirmation
members.

Every lifecycle request digest is lowercase SHA-256 over:

```text
UTF8("snapback:fly-lifecycle-request:v2\n") ||
RFC8785_JCS(complete closed request except transport bearer)
```

Each semantic provider effect id is:

```text
base64url_no_pad(SHA-256(
  UTF8("snapback:fly-semantic-effect:v1\n") ||
  RFC8785_JCS({
    operationId, operation, targetBindingDigest, planDigest,
    effectKind, resourceIdentity, desiredProviderState
  })
))
```

Lease tokens, retry number, timestamps, local paths, credentials, and bearer
material are excluded. The external control journal appends exactly:

```text
intent(requestDigest, semanticEffectId, predecessorHead)
effecting(providerRequestDigest)
terminal:notApplied(reason)
terminal:applied(providerVersion, redactedEvidenceDigest, retainedResult)
terminal:commitUncertain(lastObservation, recoveryClass)
```

Intent is durable before the provider call. A terminal result is immutable and
byte-replayed. `commitUncertain` blocks that semantic effect and every
dependent effect; `reconcileEffect` may transition it only after fresh provider
and control-head observation proves `notApplied` or `applied`. Unknown remains
non-success and cannot be retried. The generated schema and interruption
corpus cover every operation variant, effect kind, lost response, duplicate,
and illegal transition.

### Always-on supervisor and canonical single-writer head

The landing adds a separately deployed, packed
`snapback-hosted-supervisor` service outside every application target. It is
the LLP 0072 single-writer authority fallback and the only writer of
`FlyTargetBindingV2`, `HostedControlHeadV2`, provider-effect journals,
admission chains, spend ledgers, and cleanup authority. Its package and OCI
digest are part of the target binding and journey receipt. It owns a durable
SQLite control database backed up to the dedicated Tigris control-state prefix
and exposes an authenticated mutually-TLS control API. It restarts
independently and reconstructs from its durable head/journal before minting or
effecting.

The supervisor holds the Fly read/control and admission-signing roles. The
application Machine holds neither. The application maintains an authenticated
outbound long-poll channel to the supervisor; inbound control-plane access to
the application is not required. The supervisor reads the complete Fly roster
before every 60-second routed-Machine admission and sends an ordered,
head-bound admission chain. Target and supervisor authenticate each other
with separately rotated keys whose fingerprints live in the binding.

Admission renewal continues during backup/restore/activation leases and is not
a deployment effect. A routed-Machine-admission lapse withdraws only hosted
ephemeral capability, emits one restart boundary, clears rooms, and closes
ephemeral subscriptions; durable public and authenticated work remains
available while its independent hosted-auth admission is valid. Hosted-auth
admission expiry refuses all authenticated serving under LLP 0098. These two
blast radii, current expiry, supervisor identity, renewal mode, and
supervisor-availability dependency are target facts and receipt rows.

Acceptance terminates the invoking CLI, then proves the supervisor and target
remain publicly correct for longer than both admission windows, tests
supervisor restart and network loss, observes the two distinct withdrawal
classes, restores the channel, and proves fresh authority without stale frame
delivery. Supervisor compute/storage/network cost and cleanup are included in
the spend and journey receipts. This section resolves LLP 0098 open question 1
for this Fly profile only.

The supervisor serializes each target through one durable lease and
monotonically increasing binding generation. Two operator CLIs submit to that
service; neither writes Fly or Tigris directly. The canonical control head is
the supervisor's committed `HostedControlHeadV2`; every mirrored Tigris object
names its generation, predecessor digest, and journal root but is not an
independent writer.

Cutover interruption states are closed:

```text
prepared: predecessor routed/admitted; successor non-routed
predecessorWithdrawn: predecessor admission withdrawn and sockets zero
predecessorStopped: predecessor stopped; no runtime effect authority
headAdvanced: successor binding/head committed; neither public-admitted
successorRouted: exact successor is the sole routed Machine
successorAdmitted: successor serving under its head-bound admission
predecessorRetired: predecessor resources cleanup-eligible
```

Each state records predecessor/successor Machine, volume, lease/version,
binding generation/digest, route roster, admission, and provider versions.
Recovery may only advance from observed facts or restore the predecessor before
`headAdvanced`; after `headAdvanced` it must finish the successor or perform a
separately journaled reverse transition. No state permits two runtime effect
authorities. Two-controller contention and a lost response at every boundary
are mandatory fixtures.

### Four-way wire rollout and republisher

Open requests are closed, so rollout uses capability-first staging:

| client | server | behavior |
| --- | --- | --- |
| old | old | existing durable/local behavior |
| old | new | durable behavior remains; hosted ephemeral is unavailable because no offer was made |
| new | old | client capability preflight omits the unknown offer; durable behavior remains and hosted ephemeral refuses locally |
| new | new | client preflight sees the capability, sends `ephemeralAuthorityProtocol`, and requires the exact echo |

The server first lands decoding/echo support and advertises the offer
capability; only then may new clients send the member. Missing/unsupported
offer never fails the whole durable open. On the hosted profile it withholds
ephemeral operations with `SNAPBACK_EPHEMERAL_AUTHORITY_UNSUPPORTED`.

When negotiated, `ephemeralAuthorityInstance` appears on every socket and HTTP
ephemeral subscribe, unsubscribe, publish, delete, snapshot/register,
acknowledgement, error, upsert, remove, resync, and drain item/response. The
existing flattened acknowledgement exception is amended explicitly. Mixed
durable/ephemeral drains check admission per selected frame: stale ephemeral
frames are discarded behind one restart marker and never block durable
recovery. Authority loss during request, acknowledgement, drain, reconnect,
and republish has named four-way fixtures.

The JS, React, native/Expo, and Swift arms expose the same first-party
`registerEphemeralRepublisher(collection, callback)` lifecycle. It is
application data production, not authority: the client invokes active
registrations only after a fresh empty snapshot under the successor authority;
a successful publish acknowledgement makes that publisher current. Callbacks
are generation-fenced, bounded, idempotently unregisterable, and never receive
credentials or underlying authority facts. Any arm without this API reports a
structured GAP and cannot qualify the hosted profile.

### Durable spend, cleanup, and credential custody

Before a target exists, the supervisor owns
`HostedSpendLedgerV1(journeyId, currency, tariffSource, tariffObservedAt,
maximum, remaining, cleanupReserve, grants)`. A one-use grant is bound to
journey, plan, target-or-planned-target sentinel, and a closed set of semantic
effect ids. Its state is
`planned | reserved | effecting | consumed | released | commitUncertain`.
Reservation precedes every billable effect; applied consumes measured or
conservatively bounded cost, not-applied releases it, and uncertainty holds the
maximum until reconciliation. Provider price observations, currency, quantity,
egress attribution, and calculation are receipt facts.

Cleanup has a separate non-expiring-to-the-target authority and reserved
budget created with the first spend reservation. It can only inventory,
withdraw, delete sentinel-owned temporary resources, revoke temporary
credentials last, and verify absence; it cannot deploy or expand resources.
Failed cleanup retains authority/reserve and returns continuing-cost facts.
No expired product grant can strand cleanup.

Credential roles are a closed role→provider verb→resource-prefix matrix.
Fingerprints must be distinct unless the provider cannot enforce separation;
those cases are labeled custody-separated and run wrong-role negative tests.
The application Machine has only its outbound channel credential and
target-scoped artifact reads. Raw provider captures strip authorization,
cookies, signed query parameters, secret values, and private row data before
content addressing. Encrypted owner-only originals have explicit producer,
verifier, retention and `retain | delete` disposition; public receipts use only
redacted projections. Cleanup proves absence only for delete-designated target
prefixes and retains the immutable journey-evidence prefix.

### Same-origin TLS transition

The one-time transition retains the existing Fly app, public origin, DNS, and
Tigris bucket. It retires only the old Snapback target registration and mints a
new never-reused target id/binding. Source and destination identities include
app, origin, Machine, volume, control head, binding generation, and ownership
sentinel.

For the current cert-only source, the supervisor withdraws admission and
quiesces Caddy, creates a one-use encrypted certificate-transfer artifact in a
dedicated owner-only Tigris prefix using a transfer key held only by the
supervisor, and records source bytes/modes/digest without secret values. It
then resumes the predecessor if any pre-head step fails. A non-routed successor
with the new encrypted volume reads and verifies the artifact, installs exact
ownership/modes under `/data/caddy`, starts with public routing disabled, and
proves certificate/account/key identity. After the closed head/route handoff,
cleanup deletes and read-back-proves absence of the transfer object and key.
Failure after `headAdvanced` follows the cutover table; rollback never permits
two Caddy writers. This is the only cross-volume certificate copy.

Ordinary same-volume stop/start/update/replacement reattaches the one volume
and performs no issuance or copy. Fresh-volume restore does not copy Caddy and
uses staging by default; an explicit production one-use issuance grant,
supervisor-owned issuance-attempt ledger, and conservative published-limit
budget are required before production reissuance. There is no claim that the
CA exposes a remaining-budget API.

### Comparator prerequisite and final gate

The comparator kit is a same-landing prerequisite, not “already landed” in the
round-2 capsule. Step zero runs the packed
`snapback accept comparator` command and validates its
`snapback.comparator-receipt.v1` receipt. Hosted work may begin only after
that receipt passes for the ordinary product fixture, and the final journey
embeds its digest and reopens it. Both profiles remain unavailable if the
receipt or any v2 schema/interruption/wire/supervisor/remote row is missing.

Implementation order is comparator → generated v2 schemas → local wire/client
corpus → supervisor/control-head service → deterministic fixture-provider
interruption corpus → packed real Fly/Tigris journey → cleanup and LLP
maintenance. Status remains Review; no capability is advertised by a partial
implementation.

## Final author reconciliation after round 3

Round 3 reached the protocol's three-round maximum with the Fable reviewer
READY and the Codex reviewer NOT READY. These decisions close the remaining
reported defects and details. They are unreviewed implementation requirements,
not a convergence claim; this plan remains Review and both hosted capabilities
remain unavailable until the complete gate passes.

### One fail-closed hosted authority and recoverable supervisor

Fresh exact-roster evidence is a conjunct of *all* hosted authenticated live
health, not only hosted-ephemeral capability. Zero, multiple, ambiguous,
autoscalable, or stale Fly Machine roster state withdraws every protected HTTP
and socket operation even if the older five-minute hosted-auth admission has
not expired. The final corpus starts a second Machine while that older
admission is valid and proves every protected path refuses.

The hosted profile uses one pre-provisioned shared supervisor installation,
operated and recovered independently of a product journey. Its installation
receipt, standing root authorization, dedicated Fly Machine and volume,
Tigris prefix, credential fingerprints, and tariff allocation are prerequisites
referenced by every journey receipt. Supervisor platform cost is allocated to
each journey by measured active milliseconds and stored bytes; creating or
deleting the shared supervisor is not a journey effect.

Exactly one supervisor incarnation is admitted by both a current-version Fly
Machine lease and a Tigris conditional-write incarnation anchor outside the
recoverable SQLite database. Before an intent becomes effect-capable, the
supervisor commits its monotonically increasing generation, journal digest,
spend floor, cleanup floor, replay floor, and control-head digest to SQLite,
then conditionally advances the external anchor. A SQLite record without the
matching external generation is uncommitted and cannot effect; an external
generation ahead of SQLite requires reconstruction from the encrypted journal
mirror before any mint or effect. The mirror is written before the anchor CAS.
No recovery may regress a head, terminal journal record, admission generation,
spend reservation, cleanup authority, issuance attempt, or replay floor.

Recovery rotates admission-signing and mTLS keys, conditionally replaces the
incarnation anchor, and proves the predecessor lease invalid before serving.
A stale restored or partitioned predecessor fails the external incarnation
comparison at every mint and immediately before every provider effect. The
acceptance corpus covers control-volume loss, restoration of a lagging mirror,
partitioned old/new supervisors, key rotation, and every journal/mirror/anchor
crash boundary.

### Stable planned bindings and immutable reconciliation

Pre-target semantic effect ids use
`sha256("snapback:planned-binding:v1" || JCS(journeyId, planDigest,
logicalResourceNames, provider, region, ownershipSentinel))`. Provider-assigned
ids never enter this digest. Provisioning appends a
`PlannedBindingPromotionV1` that maps every closed logical resource name to
one provider id, records the resulting target binding, and refuses additions,
duplicates, provider/region drift, or sentinel drift. Later effects continue
to use the planned-binding digest plus logical resource name, so promotion
cannot rename an effect or evade its reservation.

`commitUncertain` is an immutable terminal record for the original attempt.
`reconcileEffect` appends a distinct immutable reconciliation record that
references that uncertain record and fresh provider/head observations; it
never mutates or “transitions” the prior record.

### Executable certificate recipient custody

The non-routed successor generates an in-memory X25519 key pair and sends the
public key in a supervisor-attested request bound to journey, planned binding,
successor Machine/volume, binding generation, and expiration. The supervisor
quiesces the predecessor, extracts the exact Caddy files through the existing
outbound mTLS channel, validates modes and a secret-free manifest, encrypts
them with a fresh random data key, wraps that key only to the attested
successor public key, and persists only the encrypted object, wrapped key, and
manifest in the owner-only transfer prefix. Neither plaintext nor either
unwrapped key is written to supervisor storage.

The bound successor downloads, unwraps in memory, verifies the manifest,
installs atomically with exact modes, proves certificate/account/key identity,
and erases its private key and plaintext staging before readiness. Replays,
expired requests, predecessor/successor mismatch, stale binding generations,
and routed successors refuse. Before `headAdvanced`, interruption deletes the
partial successor and permits predecessor resume; after it, the cutover table
governs. Terminal cleanup read-back-proves deletion of ciphertext, wrapped
key, successor private-key process, and predecessor extraction session. The
fixtures interrupt extraction, upload, unwrap, install, proof, head advance,
and cleanup independently.

### Complete carriers and remaining exact assignments

The republisher inventory is exactly headless JS client,
`@snapback/react`, native/Expo, Swift, and `@snapback/contract`.
`@snapback/contract` delegates registration, authority replacement, fresh-empty
snapshot, generation fence, acknowledgement, inspection, and disposal to its
owned headless client. A missing implementation in any one arm is a structured
blocking GAP for the hosted profile.

The wire offer preflight reads the capability manifest (`/capability` hosted,
`/inspect` local) and uses the LLP 0094 known-binds / unknown-refuses /
absent-degrades matrix, including unknown token values and the flattened
acknowledgement exception. Servers land decode/echo and the capability row
before any client sends the member.

The LLP 0099 amendment maps “executor job” to the journaled resident
operation/operation id, “checkpoint” to the admitted backup-manifest boundary,
and “terminal receipt” to the LLP 0081 receipt. Backup bytes and bounded log
exports travel application → supervisor over the authenticated outbound
channel → Tigris; no application provider credential is introduced. The
supervisor control database owns the atomic monotone replay floor and mirrors
it in the external incarnation anchor described above.

## Implementation checkpoint — 2026-07-28

This checkpoint records evidence without changing this Plan's Review status or
either capability claim.

The shared pre-provisioned supervisor now exists as one sentinel-owned Fly
Machine with no services, one encrypted volume, one private Tigris bucket with
separate role prefixes, scoped Fly/Tigris credentials, and a TLS 1.3 mutually
authenticated control endpoint. Its packed service implements the
deterministic spend/effect/reconciliation/planned-binding/cleanup core and the
canonical external commit order:

1. commit the complete generation to volume-backed SQLite with
   `synchronous=FULL`;
2. write and read back one immutable content-addressed journal mirror;
3. retain one immutable generation anchor; and
4. advance the current incarnation pointer with the predecessor's Tigris
   `ETag` in `If-Match`.

The real provider proof advanced generation 0 to 1 with a harmless
1000-micro-USD installation ledger, rejected a stale conditional writer,
restarted the Machine, and recovered generation 1 with a verified predecessor
chain to the exact generation-0 standing root. Bootstrap also reopens and
verifies a nonzero generation instead of trying to recreate generation 0.
`demos/signal-desk/hosted-supervisor-installation.v1.json` binds the exact
Machine, image, volume, current/root anchors, mirror, custody, tariff, restart,
and retained-resource facts. This satisfies the standing installation and
single-writer persistence slice only.

A separate remote drill took an application-consistent SQLite backup from
`snapback-drill`, read it back byte-identically, restored it to a fresh
encrypted volume on a zero-service helper Machine, and proved SHA-256 equality,
`PRAGMA integrity_check=ok`, and 29 schema tables. The helper Machine, helper
volume, and test backup object were then destroyed/deleted and read back
absent. The non-success receipt
`demos/signal-desk/hosted-product-journey.v1.json` records both that proof
and every skipped row.

The mandatory journey remains incomplete. In particular, the existing product
target still has rootfs application SQLite and its finite legacy hosted-auth
chain has expired, so public health returns
`SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED`. It is not registered as a safe
`FlyTargetBindingV2`, does not maintain the outbound online admission channel,
and has not passed packed release/migration/restore-activation/rollback/admin
inspection, the LLP 0110 relation/activity hosted qualification, or the
target-neutral remote ephemeral restart/republish corpus. Consequently
`ephemeralHostedAdapter` remains false, the filesystem tickets remain open,
and the failed product receipt cannot be used as hosted evidence.

The next narrow onboarding slice is also live without changing that boundary.
The fresh never-reused identity
`snapback-drill-hosted-v2-20260728` now has distinct target-scoped Fly control
and registry credentials, a supervisor-held Ed25519 online-admission seed, and
a dedicated target outbound mTLS identity. The product app has only staged the
successor secret names; its legacy routed Machine was not updated. The
standing supervisor was updated in place to immutable image
`sha256:d718a52ea29583a5d2e2df4810ad838a7ed3a0479ba87dfa5e7a2f9b735894dd`,
recovered generation 1 unchanged, and exposes the target-only TLS 1.3
admission listener separately from operator control.

The listener authenticates the enrollment-bound client certificate, double
reads the Fly roster, requires the requester to be the one exact routed bound
Machine, commits the boot-stable admission epoch and replay floor through the
same SQLite/mirror/anchor order, and only then signs a Rust-compatible online
hosted admission with a maximum 60-second lifetime. Its mTLS/refusal proof
passes before enrollment. The staged receipt is
`demos/signal-desk/hosted-target-onboarding.v1.json`. It is not a target
binding, release, cutover, or capability receipt: the fresh encrypted volume,
successor Machine, certificate transfer, route/head handoff, and remote
application corpora remain mandatory.

The onboarding receipt now also binds six distinct Tigris credentials for the
fresh target's artifact, backup, control-state, audit, log, and cleanup roles.
The legacy bucket bootstrap credential was captured once from the unchanged
predecessor into owner-only Keychain custody without printing or repository
storage. Live provider probes proved every data role's own-prefix read, every
cross-role object read denial (including cleanup), artifact and cleanup write
denial, and cleanup's target-wide delete authority; all probe objects were
then deleted. Tigris IAM
rejects S3 prefix conditions on `ListBucket`, so the supervisor-only cleanup
credential's inventory verb is explicitly recorded as bucket-scoped and
custody-separated rather than falsely claimed prefix-enforced. Its only object
verb is delete, limited to `snapback-hosted-v2/*`. This completes
credential staging only and does not alter the mandatory journey boundary.

The next code checkpoint closes the admission-envelope gap without claiming a
live deployment. Online supervisor responses now carry an independently
Ed25519-signed `HostedAdmissionV2` bound to the exact target binding
generation/digest, control head, supervisor incarnation, complete provider
roster digest, routed Machine, replay floor, boot-stable admission generation,
and two at-most-60-second expiries. The target verifies that signature and its
cross-binding to the hosted-auth envelope before install; missing, tampered,
stale, and replayed inputs have stable refusing diagnostics. The packed
renewer validates and atomically preserves the complete dual-signed envelope.

Connection open derives the opaque normative `eai1.` digest from the verified
target/process authority, binds it immutably to the grant lineage, and requires
the same witness on HTTP and WebSocket ephemeral requests. HTTP/socket
acknowledgements and errors, snapshots, changes, resyncs, and drain items are
stamped at final serialization; the client refuses a negotiated grant without
the witness and carries it on both transports. Exact Fly roster verification
now also checks the complete roster plus active image digest, encrypted volume,
region, process routes, and autostop/autostart posture. Rust, JavaScript,
schema-drift, roster-drift, renewer replay/tamper, and client transport corpora
pass locally. The currently installed supervisor image predates this
checkpoint, so a rebuilt image, real successor journey, restart/republish
corpus, and remote receipts remain required; `ephemeralHostedAdapter` stays
false.

## Post-bakeoff execution amendment — 2026-07-28

This section is normative where it conflicts with the earlier implementation
sequence or transition text. It closes the gaps found while attempting to
execute the public journey; it does not claim that the journey has passed.

### Legacy certificate bootstrap

The cert-only predecessor has no outbound supervisor-mTLS agent. Therefore the
ordinary certificate-recipient protocol cannot begin by asking that
predecessor to use a channel it does not possess.

The one permitted transition bootstrap is a journaled, one-use
`legacyCertificateExtraction.v1` provider effect under the exact predecessor
Machine lease and transition spend grant:

1. fresh provider read-back proves the expected sole routed predecessor,
   exact image/version, public origin, and unchanged ownership sentinel;
2. the successor is non-routed, volume-bound, and supplies the attested
   in-memory X25519 recipient key from the existing recipient protocol;
3. the supervisor invokes Fly Machine exec against that exact predecessor
   with a fixed, content-addressed extractor command. The command reads only
   the allowlisted Caddy state paths, validates ownership/modes and a closed
   secret-free manifest, and streams one bounded archive. No arbitrary
   operator command, path, or shell fragment is accepted;
4. the supervisor keeps the provider response and plaintext archive only in
   locked process memory, immediately encrypts it to the attested successor,
   persists only ciphertext/wrapped key/manifest, zeroizes plaintext buffers,
   and records only redacted provider request/response digests;
5. the successor installs and proves certificate/account/key identity before
   any route or head change; and
6. every pre-head failure leaves the predecessor routed and deletes partial
   successor/transfer state. After `headAdvanced`, only the closed cutover
   recovery table applies.

Provider-exec extraction is restricted to this declared legacy source class.
Every successor and all later transitions use the outbound mTLS channel.
Fixtures prove wrong Machine/version/path, oversized output, extra archive
members, mode mismatch, truncated or corrupt output, lost provider response,
replay, recipient mismatch, supervisor crash before/after encryption, and
cleanup. The final receipt identifies this exceptional custody path without
retaining certificate bytes.

### Public package and command closure

The public CLI package must include the Fly driver, its immutable digest, the
hosted release packer, the generated v2 schemas, and a high-level
`snapback hosted` command family. Repository-relative `scripts/` and sibling
workspace imports cannot satisfy the journey. The command family exposes:

- `hosted doctor|inspect`;
- `hosted release pack`;
- `hosted deploy plan|confirm|apply|reconcile`;
- `hosted backup`;
- `hosted restore plan|confirm|apply|activate`;
- `hosted rollback`;
- `hosted logs|inspect-admin|cost`; and
- `hosted cleanup plan|confirm|apply`.

Each mutating command submits the closed request to the standing supervisor;
the installed CLI never becomes a second Fly/Tigris writer. The package test
unpacks the tarball into a temporary directory, removes repository access, and
proves every driver/packer/schema path and command help/import before any
remote effect.

The Fly driver implements every v1 spelling plus the five v2 additions in the
mechanical operation registry. Each effect records durable intent before the
provider call, raw redacted evidence, immutable terminal status, and explicit
reconciliation after uncertainty. `inspectAdmin` combines authenticated served
inspection with provider/control-head read-back instead of returning a
provider-only approximation.

### Served evidence and release gate

The completed receipt binds one clean source SHA, package-tarball digests,
Linux image digest, supervisor image/incarnation, target binding/control head,
predecessor and successor identities, and every subordinate artifact digest.
Its verifier reopens the artifacts and requires:

- public-origin health/auth/data/live/ephemeral checks under the successor
  head;
- the complete target-neutral hosted ephemeral restart/republish corpus;
- LLP 0099 resident migration execution and interruption evidence;
- LLP 0110 bounded-relation and existing-owner activity corpus against the
  same served release;
- backup read-back, fresh-volume restore, restore activation, compatible
  rollback, TLS continuity, logs/admin inspection, cost, and nonclaims; and
- exact cleanup absence for disposable helpers, transfer objects/keys,
  temporary credentials, leases, and test prefixes.

No verifier infers success from skipped rows or a successful provider HTTP
status. The old predecessor and shared supervisor are never cleanup targets
until the successor is sole-routed, head-bound, admitted, publicly verified,
and the reverse-transition window is closed. On failure, cleanup removes only
sentinel-owned disposable resources and preserves the last publicly correct
generation plus the evidence needed to resume.

Only after this receipt and the public macOS/arm64 and Linux/x64 cold-install
receipts pass may the nine-package release be published and the served target
advertise `ephemeralHostedAdapter`,
`container-vm-migration-executor.v1`, `bounded_children_v1`, or
`write_activity_v1`.

## Post-bakeoff round-1 reconciliation — 2026-07-28

This section is normative where it tightens or supersedes the post-bakeoff
execution amendment. LLP 0041's dated candidate-promotion amendment, LLP 0099's
dated executor decisions, and LLP 0110's candidate/applicability amendment are
part of this same executable gate.

### Qualification, package promotion, and capability publication

The product journey uses LLP 0110's digest-addressed
`QualificationGenerationV1` and one-use `QualificationGrantV1`. A candidate
graph can run at the public origin only for the receipt-bound acceptance
principal; it is absent from ordinary discovery and the target continues to
advertise a GAP. The qualification route is not a second general capability
authority and is consumed or expires before publication.

The standing supervisor alone commits the Rust-owned
`CapabilityPublicationV1` into the target control head. In addition to LLP
0104's fields, its closed claim set is:

- target capabilities `bounded_children_v1` and `write_activity_v1`;
- hosted claim `ephemeralHostedAdapter`; and
- migration profile `container-vm-migration-executor.v1`.

Each entry has its own profile version, maturity/nonclaim facts, and evidence
digest; one missing or mismatched entry remains a GAP without weakening the
others. The carrier binds the running target and supervisor images to the same
clean source SHA, the complete qualification receipt, the exact nine-package
post-promotion ledger and cold receipts from LLP 0041, the target-neutral
ephemeral receipt, the LLP 0099 migration receipt, and the LLP 0110
applicability-partitioned receipt. The target refuses the whole carrier when
its signature, control head, running image, active graph, or package provenance
does not match.

The executable order is:

1. pack and locally cold-test all nine exact package tarballs;
2. publish their immutable exact versions under the non-default candidate tag,
   create the candidate ledger, and run both exact-version public cold installs;
3. build target and supervisor images from the same clean source and the exact
   candidate package bytes, then complete local and hidden served qualification;
4. complete the hosted ephemeral, migration, relation/activity, TLS,
   backup/restore/rollback, cost, inspection, and cleanup qualification receipt;
5. promote the default npm closure under LLP 0041's dependency-first,
   CLI-root-last rule and pass both final `latest` cold installs;
6. CAS the candidate graph and `CapabilityPublicationV1` into the target head;
   and
7. record the post-CAS public observation receipt. Failure at step 7 immediately
   revokes the carrier to GAP while retaining the prior graph and evidence.

Thus immutable candidate publication occurs before public-registry proof;
default-channel promotion and served advertisement occur only after
qualification. Immutable failed candidates may remain quarantined. They never
change `latest`, the active graph, or target support. The public closure is the
nine packages enumerated by LLP 0041; the hosted supervisor is an image-bound
component, not an unlisted tenth registry package.

### Closed legacy certificate transition

`legacyCertificateExtraction.v1` is a semantic subeffect of the existing
`activateGeneration` lifecycle operation for exactly the declared legacy
source class. It is not a new top-level adapter spelling. Its intent, lease,
spend, uncertainty, reconciliation, and terminal record use the same v2 effect
journal as every other provider effect.

The legacy binding substitutes an owner-approved pinned identity for a
sentinel the old Machine never had: exact Fly app, Machine id/version, image
digest, volume id, region, public origin/certificate fingerprint, and the
predecessor ownership-record digest. Every pre-effect read must match all
members.

The fixed provider-exec program:

- addresses only `/data/caddy`;
- admits POSIX-ustar directory and regular-file members only, no symlinks,
  hard links, devices, sockets, absolute paths, `..`, duplicate paths, sparse
  members, extensions, or trailing data;
- permits at most 4,096 members, 8 MiB per file, 32 MiB cleartext total,
  40 MiB ciphertext total, and 60 seconds elapsed;
- validates each member against a closed path/mode/uid/gid manifest derived
  from the pinned predecessor image; and
- uses one exact Caddy PID/executable digest. Under a fixed process lock it
  sends `SIGSTOP`, proves that PID is stopped and no other process has an open
  descriptor below `/data/caddy`, emits the archive, then sends `SIGCONT` in a
  trap. A separate fixed recovery command is safe to replay and resumes the
  same pinned PID.

The supervisor image contains a native `snapback-cert-bridge` helper. That
helper, not Node or JavaScript, owns the Fly exec HTTPS exchange and secret
response. It preallocates and locks fixed-size memory, rejects overflow before
copy, never creates a JavaScript string/Buffer or plaintext file, encrypts
directly to the attested successor X25519 key, zeroizes and unlocks on every
exit, and returns only ciphertext plus redacted metadata to the Node
supervisor. Its binary digest and locked-memory/zeroization corpus are receipt
members. Fly's control plane necessarily carries the plaintext exec response;
provider compromise during that bounded exchange is an explicit residual.

Every pre-head exit runs recovery, proves the predecessor PID resumed, and
probes the prior public certificate/TLS response. A lost exec response or
supervisor crash remains `commitUncertain` until reconciliation. If the exact
encrypted artifact exists and validates, reconciliation appends an immutable
`applied` record referring to the uncertain intent. Otherwise, after resume
and public TLS proof it appends `notApplied`; a new intent, recipient key, and
effect id may retry. "One-use" means at most one successfully applied transfer,
not one transport attempt. After ciphertext creation the successor's existing
recipient protocol installs atomically and proves account/certificate/key
identity. The custody receipt binds source and recipient identities, member
manifest, effect id, resume proof, ciphertext deletion, key deletion, and
terminal disposition without certificate bytes.

### Public operator and command authority

The installed CLI begins with `hosted supervisor enroll`. It generates device
Ed25519/X25519 keys in the OS credential store, consumes a one-use,
ten-minute `SupervisorEnrollmentBundleV1`, pins the supervisor endpoint and
server certificate fingerprint, and obtains an operator client certificate
bound to subject, device key, and scopes. The private key and renewable
credential never enter repository files or CLI JSON. A CI enrollment uses an
owner-provided mode-0600 one-use bundle, stores credentials only in its
ephemeral keychain, and deletes the bundle after exchange.

`hosted target register` submits the closed target descriptor and creates the
planned binding; `hosted target select` changes only the local nonsecret target
pointer. `deploy plan` resolves that planned binding and owns its
provider-assigned-id promotion to a registered binding. Every supervisor
request uses mTLS plus a device-key signature and carries operator subject,
supervisor installation fingerprint, target/planned-binding digest, request
id, expiry, and required scopes.

The mechanical command registry maps:

| Command group | Closed request/authority |
| --- | --- |
| `supervisor enroll`; `target register|select` | one-use enrollment; register mutation or local-only selection |
| `doctor|inspect|logs|inspect-admin|cost` | supervisor-signed read request; the supervisor performs provider/control/served read-back |
| `release pack` | local deterministic pack only; no provider or registry credential |
| `deploy plan|confirm|apply|reconcile` | planned binding, approval, spend grant, lease, effect journal; `apply` streams the bounded content-addressed release to the supervisor, which alone owns Fly registry credentials |
| `backup plan|confirm|apply|reconcile` | exact target/head, destructive-write scope, spend, lease, idempotent backup effect |
| `restore plan|confirm|apply|activate|reconcile` | backup identity, restore approval, spend, lease, migration authority where required, activation/head CAS |
| `rollback plan|confirm|apply|reconcile` | compatible held generation, rollback approval, spend, lease, head CAS |
| `cleanup plan|confirm|apply|reconcile` | sentinel inventory, cleanup reserve, destroy grant, lease, continuing-cost reconciliation |

No read command holds Fly or Tigris credentials. No mutating command directly
writes Fly/Tigris. npm candidate publication is the separately confirmed LLP
0041 publisher path and uses the operator's npm authority; it grants no hosted
provider authority. The clean-tarball test enrolls a fixture operator,
registers/selects a target, plans/confirms/submits every group, and proves the
CLI has neither repository access nor Fly/Tigris credentials.

### Migration and cleanup closure

LLP 0099's dated amendment fixes enqueue admission with barrier re-proof,
checkpointed cancellation, a 180-second ceiling, and the qualifying streaming
backup. The served receipt reopens all those decisions and every exact
package/audience identity before publishing
`container-vm-migration-executor.v1`.

The shared standing supervisor, its monotone authority store, and the immutable
evidence prefix are never journey cleanup targets. The predecessor is not
described as currently correct protected serving while its hosted admission is
expired; before cutover it is the preserved data/TLS generation with an exact
continuing-cost and availability report.

A predecessor Machine, volume, or credential becomes eligible for destruction
only after a signed `ReverseTransitionClosedV1` records:

- the post-CAS publication receipt and a fresh verified backup/isolated restore;
- at least 60 continuous minutes of successor public health, twelve five-minute
  probes, and ten consecutive admission renewals;
- sole routing, current target/control head, no unresolved/uncertain effect,
  no pending rollback request, and zero disposable-resource cleanup residual;
- the exact predecessor inventory and continuing cost; and
- a separate one-use operator destroy grant issued after `notBefore`.

Machine, volume, and credential dispositions are separate confirmed effects;
failure of one cannot imply absence of another. Until that artifact and grant
exist the predecessor is retained. Afterward only sentinel-owned predecessor
resources may be removed; the shared supervisor and evidence remain. Every
failure receipt reports what still serves, what data/TLS generation remains,
and what continues to cost money instead of claiming a generically "publicly
correct generation."

Superseded round vocabulary remains non-controlling under the dated
amendments. A consolidation pass after first publication will remove it
without weakening the reviewed carriers or gates.

## Post-bakeoff round-2 reconciliation — 2026-07-28

This section closes the operator trust root, request scope/replay protocol,
claim-family publication, post-CAS revocation, and remaining legacy/adoption
details. LLP 0110's registered qualification and local-carrier amendment, LLP
0108/0094's addendum/wire amendments, LLP 0099's reconciled executor state machine,
and LLP 0041's prior-closure preflight are part of the same landing.

### Standing-supervisor root and operator protocol

Bootstrap creates one `SupervisorInstallationRootV1`: an Ed25519 signing root,
an X.509 client-CA identity, supervisor endpoint/certificate fingerprint,
installation id/incarnation floor, and external-store head. Private root
material is encrypted in the external authority store and usable only by the
standing supervisor. Bootstrap returns the initial owner device certificate
once, before the public listener is enabled; its public fingerprint is
journaled. The root public bytes and installation fingerprint are retained in
the public bootstrap receipt.

An enrollment bundle can be minted only by a current owner device holding
`operator.enroll`. `SupervisorEnrollmentBundleV1` is canonical JCS signed by
the installation root over schema version, root key id, bundle id/nonce,
installation fingerprint, intended subject, maximum scopes, device
proof-of-possession challenge, issuance, and expiry of at most ten minutes.
Issuance writes an unused nonce record to the monotone external database before
returning bytes. Consumption supplies the new device Ed25519/X25519 public keys
and a signature over the challenge; one external-head CAS changes
`unused → consumed` and issues `SupervisorOperatorCertificateV1`. Concurrent,
expired, cross-installation, or replayed consumption refuses.

Operator certificates are valid at most 24 hours. Renewal before expiry
requires the current mTLS certificate, device-key signature, unchanged subject,
and current revocation generation; after expiry a new owner-issued bundle is
required. Owner revocation increments a monotone
`operatorRevocationGeneration` and identifies the device key. Root recovery or
rotation must prove the external head and mirror are not behind before minting;
uncertain/regressed state disables enrollment and all mutating requests. Root
rotation is a dual-signed control-head CAS, never replacement by restored
database bytes.

Every request is canonical `SupervisorRequestV1`, device-signed over
installation/root ids, operator certificate digest, revocation generation,
monotone per-device request sequence, request/idempotency ids, command scope,
target or planned-binding digest, body digest, issued time, and expiry.
The external database atomically retains the highest sequence and exact
response digest. Exact replay returns the retained response; a reused sequence
with different bytes or a lower sequence refuses, including after supervisor
recovery.

The closed scope vocabulary is:

- `operator.enroll`, `supervisor.read`, and `target.register`;
- `release.upload`;
- `deploy.plan|confirm|apply|reconcile`;
- `backup.plan|confirm|apply|reconcile`;
- `restore.plan|confirm|apply|activate|reconcile`;
- `rollback.plan|confirm|apply|reconcile`; and
- `cleanup.plan|confirm|apply|reconcile`.

Each mechanical command-registry row maps to exactly one scope above and denies
unknown or missing scopes. `target select` and `release pack` are local-only.
Read commands are device/operator-signed requests under `supervisor.read`; the
supervisor returns a signed response. They are not "supervisor-signed
requests." Negative tests cover every command × wrong-scope pair, revoked or
expired device, root rotation, restored old database, sequence replay, body
substitution, and cross-installation certificates.

### First publication and revocation

The first `CapabilityPublicationV1` CAS requires all three claim families and
all four positive claims: atomic relation/activity
(`bounded_children_v1` plus `write_activity_v1`), hosted ephemeral, and
migration. A missing first-publication receipt blocks the whole initial CAS.
After a successful first publication, later validation or revocation may
withdraw hosted-ephemeral or migration independently; the relation/activity
pair always changes state together.

Post-CAS observation has a hard 120-second window. Timeout or failed
observation causes a new control-head CAS that withdraws only the affected
capability claim family. The promoted generation remains active, but its
functions immediately refuse through their function-level capability
requirements. Generation demotion is a separate, journaled, compatibility-
checked rollback and is never an automatic consequence of capability
revocation. This rule is identical in LLP 0110.

The post-CAS wording "retain the prior graph" is therefore superseded. The
predecessor graph may remain stored for an explicitly approved compatible
rollback, but it is not silently reactivated after new-generation writes.

### Legacy and staged-target closure

The owner-approved pinned legacy identity is the exact sentinel substitute for
all predecessor disposition effects. "Sentinel-owned" in the cleanup rule
means either a native v2 sentinel or that complete pinned legacy identity—never
a weaker provider label.

Before extraction, provider read-back and image-content preflight prove the
pinned legacy image contains the exact `sh`, `tar`, `procfs`, signal, hashing,
and Caddy executables/paths required by the content-addressed program. Missing
or different tools refuse before `SIGSTOP`. A file already torn before stop
can be copied consistently while stopped; successor account/certificate/key
identity and Caddy-open validation make this fail-closed, but inability to
prove semantic Caddy consistency is an explicit residual and prevents
cutover.

The controlling command registry is the plan/confirm/apply/reconcile table;
earlier single `hosted backup` or `hosted rollback` spellings are superseded.
The already staged `snapback-drill-hosted-v2-20260728` artifacts are not
ambiently trusted. `hosted target register --adopt` may consume them only after
fresh provider/onboarding read-back, exact bundle/root/target identity, owner
authorization, and a new registered-binding CAS; otherwise registration starts
fresh and the staged artifacts are cleanup-only.

The target validates package provenance only against the signed candidate →
post-promotion ledger lineage digest embedded in its own image/release
provenance. It never fetches npm or accepts a carrier-supplied ledger digest as
self-authenticating.

## LLP 0113 corrective reconciliation — 2026-07-28

This section supersedes the incomplete online-root and command registry above.
It also adopts LLP 0113's isolated qualification data, candidate-ledger
lineage, provisional family epoch, and target-enforced expiry rules.

### Root custody, rotation, and recovery

`SupervisorInstallationRootV1` is an offline Ed25519/X.509 trust root whose
public identity is pinned by targets and operators. Its private key is not an
online service secret. Bootstrap encrypts a recovery package to three
independent owner recovery keys and requires any two to authorize use.

The standing supervisor holds a seven-day online enrollment intermediate,
signed by the offline root and encrypted at rest with a platform-held service
secret. That intermediate may issue at-most-24-hour device/operator
certificates; it cannot rotate the root, add recovery keys, or grant a scope
outside the authorizing operator's delegable subset. No issuer may delegate
`operator.admin` or `root.admin` unless it is a current owner root operation
with explicit confirmation.

Root rotation is `root.rotate.plan -> confirm -> apply`, authorized by two of
the three registered recovery keys and the current external head. The old and
new roots cross-sign a 24-hour overlap carrier. Requests and targets accept
both only during that exact overlap, after which the old root and every
intermediate/certificate descending solely from it are revoked.

Lost-root recovery is `root.recover.plan -> confirm -> apply` using a
`RootRecoveryV1` signed by any two pre-registered recovery keys. It advances
the installation incarnation and revocation generations, invalidates all
operator certificates and target enrollments, and requires explicit target
and device rebind. With fewer than two recovery keys there is no bypass:
operators build a new supervisor installation and re-enroll targets through
their ordinary ownership proof.

Every plan, confirmation, application, refusal, and exact replay is retained
in the external request journal. If a response is lost, a caller resubmits the
identical request id/bytes and receives the retained response; a different
body, sequence, scope, installation, root, or head refuses. Recovery may not
restore a journal or revocation generation behind the monotone mirror.

### Closed request and command registry

The complete authority vocabulary adds `operator.admin`, `root.admin`, and
the recovery threshold authority. It maps commands and request variants
exactly:

| CLI command | Request variant | Required authority |
| --- | --- | --- |
| `hosted operator enrollment issue` | `operator.enrollment.issue` | `operator.enroll` |
| `hosted operator enrollment consume` | `operator.enrollment.consume` | one-use bundle plus device proof |
| `hosted operator certificate renew` | `operator.certificate.renew` | current certificate self-auth |
| `hosted operator device list` | `operator.device.list` | `operator.admin` |
| `hosted operator device revoke` | `operator.device.revoke` | `operator.admin` |
| `hosted release upload` | `release.upload` | `release.upload` |
| `hosted root rotate plan|confirm|apply` | `root.rotate.plan|confirm|apply` | `root.admin` plus 2-of-3 recovery signatures at confirm/apply |
| `hosted root recover plan|confirm|apply` | `root.recover.plan|confirm|apply` | 2-of-3 recovery signatures; no operator scope substitutes |

The previously listed `hosted supervisor enroll` is an ergonomic alias for
`hosted operator enrollment consume` only; it is not a separate authority.
All plan/confirm/apply/reconcile rows for deploy, backup, restore, rollback,
cleanup, reads, and target registration keep their exact scopes from the
earlier table. Unknown command/request/scope combinations fail the exhaustive
registry equality test.

`hosted release upload` is a distinct bounded byte-stream request. It verifies
and stores the content-addressed release under an upload receipt. A later
`deploy.apply` carries no release bytes and may reference only that verified
digest. Thus deploy authority cannot be used as release-upload authority, and
upload authority cannot activate a release.

### Claim expiry and ledger authority

All three hosted claim families use LLP 0113's `familyEpoch` and provisional
expiry. Each target rechecks the authoritative epoch at the exact operation
boundaries listed there, closes live/ephemeral sockets on change, and refuses
provisional claims after reboot or time/head uncertainty. Even if withdrawal
CAS is unavailable, the provisional carrier self-expires within 120 seconds.
The active graph and data remain intact; only functions needing the withdrawn
family refuse.

Target and supervisor images embed the candidate-ledger digest, not a
future post-promotion digest. The final ledger supplied by the supervisor must
canonically extend that digest through `previousLedgerSha256`. Qualification,
release upload, deploy, final publication, and both public cold-install
receipts reopen the same nine-package lineage.

## Unreviewed post-round authority closure — 2026-07-28

This section applies the terminal dispositions in LLP 0113's corrective review
journal. It has not received a further independent review. LLP 0111 remains
Review and no hosted capability claim advances without the complete executable
receipt.

### Purpose-limited service intermediates

The offline installation root certifies closed
`SupervisorServiceIntermediateV1` envelopes:

```text
{
  schemaVersion: 1,
  installationId,
  rootKeyId,
  intermediateKeyId,
  publicKey,
  purpose,
  notBefore,
  expiresAt,
  rootSignature
}
```

`purpose` is exactly `operator-enrollment`, `qualification-grant`,
`capability-publication`, `migration-deadline`, `hosted-admission`, or
`supervisor-response`.
`expiresAt` is no more than seven days after `notBefore`. The root signature
uses Ed25519 over
`"snapback-supervisor-service-intermediate-v1\0" || RFC8785_JCS(envelope
without rootSignature)`. A key is accepted only for its one purpose, current
root/incarnation, and overlap window. Grants, claim families, deadlines, and
admissions carry the complete intermediate chain and their own domain-separated
signed envelope; no operator-enrollment key can sign a capability claim.

Intermediate private keys are generated inside the standing supervisor's
native custody helper, encrypted under a platform-held service secret, and
unsealed only into locked native memory. They never enter JavaScript strings,
repository files, CLI output, or application secrets. Issue, renewal, and
rotation require a 2-of-3 recovery-key authorization over the current external
head. The helper decrypts the offline recovery package only for the bounded
signing ceremony, zeroizes plaintext before returning, and emits a custody
receipt. An expired intermediate disables its purpose; there is no implicit
extension. During a root/intermediate rotation, both complete chains are
accepted only for the recorded overlap.

The exact ceremony registry is:

| CLI command | Request | Authority |
| --- | --- | --- |
| `hosted root intermediate issue` | `root.intermediate.issue` | `root.admin` plus 2-of-3 recovery signatures |
| `hosted root intermediate renew` | `root.intermediate.renew` | `root.admin` plus 2-of-3 recovery signatures |
| `hosted root intermediate rotate` | `root.intermediate.rotate` | `root.admin` plus 2-of-3 recovery signatures |
| `hosted root intermediate unseal` | `root.intermediate.unseal` | local threshold ceremony; no operator scope substitutes |

`SupervisorEnrollmentBundleV1` and
`SupervisorOperatorCertificateV1` are signed by the current
`operator-enrollment` intermediate, not the offline root. Both carry the
intermediate chain/key id, issuer certificate digest, `effectiveScopes`, and
`delegableScopes`. Requested effective and delegable scopes must be transitive
subsets of the issuer's delegable scopes. `operator.admin` and `root.admin`
are not ordinarily delegable; granting either uses the separately retained
`operator.delegation.plan|confirm|apply` operation with `root.admin` and
2-of-3 recovery signatures.

### Recovery bootstrap and revocation

`root.recover.apply` atomically commits the new installation incarnation and
root, revokes all old intermediates/operator certificates/target enrollments,
and returns one encrypted, ten-minute, one-use
`RecoveryOwnerBootstrapV1`. The bootstrap binds the recovery operation, new
root/incarnation, intended initial-owner device keys, maximum owner scopes,
nonce, and current external head; it is signed by the 2-of-3 recovery
authorization. It can perform only:

| CLI command | Request | Authority |
| --- | --- | --- |
| `hosted operator device rebind` | `operator.device.rebind` | current one-use recovery-owner bootstrap plus device proof |
| `hosted target rebind` | `target.rebind` | current owner certificate plus prior target ownership proof and new-root challenge |

Device rebind consumes the bootstrap and issues the first new owner
certificate. Target rebind requires that certificate, provider/target
read-back, the prior target identity, and a target-generated proof-of-
possession challenge before the target pins the new root. Replay, expiry,
cross-target use, or a behind external head refuses. With no valid 2-of-3
authorization, no bootstrap is minted and the new-installation path remains
the only recovery.

`operatorRevocationGeneration` is a global monotone head with a per-device
status map. Revoking one device advances the head and marks that device
revoked; unaffected devices prove the current head on their next request and
renewal, which rolls their certificate lineage forward without broad
revocation. Admission order is current installation/root, global head not
behind, device not revoked, certificate/device signature, then scope and
request sequence.

### Atomic request-response replay

The request transaction retains the canonical response, not only its digest,
before advancing the device sequence, enrollment nonce, or effect state.
Responses up to 1 MiB are encrypted inline in the external authority store;
larger bounded responses use an encrypted content-addressed object reference,
at most 64 MiB, whose digest and object generation are committed in the same
transaction. Retention is at least 30 days. Receipt-bearing GC leaves a
tombstone that returns 410 to an exact replay; different bytes at the same
sequence remain 409.

Exact replay after mere certificate expiry returns the committed response
without rerunning the effect. Device revocation, root-overlap end, or recovery
may override replay of credential-bearing secret bytes: the response becomes
410 with a redacted terminal-result receipt, never a newly valid credential.
Noncredential effect results remain replayable when their target/head still
matches; otherwise they return the stable reconciliation result. Recovery
cannot restore response bytes, sequences, tombstones, or revocation state
behind the monotone mirror.

### Capability-publication authority and state machine

Capability publication is never implicit in `deploy.apply`. The command and
scope registry adds:

| CLI command | Request | Scope |
| --- | --- | --- |
| `hosted capability publication plan` | `capability.publication.plan` | `capability.publish` |
| `hosted capability publication confirm` | `capability.publication.confirm` | `capability.publish` plus explicit approval |
| `hosted capability publication provision` | `capability.publication.provision` | `capability.publish` |
| `hosted capability publication finalize` | `capability.publication.finalize` | `capability.publish` |
| `hosted capability publication withdraw` | `capability.publication.withdraw` | `capability.withdraw` |
| `hosted capability publication renew` | `capability.publication.renew` | `capability.publish` |
| `hosted capability publication reconcile` | `capability.publication.reconcile` | `capability.publish` or `capability.withdraw`, matching the operation |

Plan/confirm binds the deploy approval, exact candidate graph, target/head,
claim families, qualification and package ledgers, receipt vector, observation
principal, and expiry. `provision` performs LLP 0113's provisional activation
CAS. Only that principal can observe provisional support through the public
origin. `finalize` consumes the retained passing observation and changes the
same live family epoch to final; `withdraw` advances the family epoch and
support gate. Each claim is signed by the `capability-publication`
intermediate. Lost responses use the atomic replay protocol above.

### Hosted-ephemeral enforcement

LLP 0094's later per-boundary table is the only hosted-ephemeral wire
authority: numeric open offer/echo `1`, HTTP
`x-snapback-ephemeral-authority-instance`, WebSocket upgrade subprotocol
`snapback.ephemeral-authority-instance.<eai1 token>`, and the required
authority-instance field on every governed response/frame. The earlier string
offer and any ambiguous generic "member" wording are non-controlling.

The connection lineage carries `hostedEphemeralAuthorityRequired`. Hosted
ephemeral operations require negotiated protocol 1 and the exact authority
instance; `(None,None)` is admitted only on a legacy local target that does
not carry the required fact. Offerless/missing instance uses HTTP 400
`SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_REQUIRED`; unknown or mismatched
protocol uses HTTP 400 `SNAPBACK_EPHEMERAL_AUTHORITY_UNSUPPORTED` or
`SNAPBACK_EPHEMERAL_AUTHORITY_PROTOCOL_MISMATCH`; a changed instance uses HTTP
409 `SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_CHANGED`. Socket failures occur at
upgrade when possible, otherwise close with the generated error frame and
force reconnect/resnapshot. The four-way client/server corpus includes direct
server enforcement, not only capability discovery.

### Bounded release upload

`release.upload` reserves spend and a temporary object before reading bytes.
The first profile permits at most 2 GiB declared and received bytes, 15 minutes
total, and 30 seconds idle. The stream is hashed while writing under
`uploads/<installationId>/<requestId>/<attemptId>`; declared length and
SHA-256 must match before an immutable content-addressed object and
`ReleaseUploadReceiptV1` become visible atomically. No partially uploaded
object is deployable.

Exact replay returns the retained receipt. A different digest/body at the same
request id refuses. Disconnect, timeout, size/hash mismatch, or lost staging
response leaves a cleanup-only temporary object and releases only the unused
spend reservation. The standing cleanup worker deletes terminal partial
objects within 24 hours and emits an inventory/absence receipt; uncertain
objects remain nondeployable and continue to report cost until reconciled.

## Corrective implementation addendum — 2026-07-28

This addendum records the fail-closed implementation disposition after an
adversarial review of the first operator/supervisor wiring. It does not advance
this Plan from Review and does not authorize a private V3 carrier or any
positive hosted lifecycle claim.

### Request reservation and exact settlement

An ordinary `SupervisorRequestV1` is now a two-commit protocol. After mTLS,
device signature, current installation/root/revocation head, scope, registry
response class, and sequence admission, the supervisor commits
`operatorRequestReserved` with the canonical request bytes and digest, device,
sequence, request id, variant, scope, target head, and registry-derived
credential-bearing bit. The sequence does not advance at reservation.

Only the byte-identical request with the same request id, device, and sequence
may recover a reservation. Any other request from that device is refused while
the reservation is pending. Provider intent may be appended only after the
reservation has reached SQLite, mirror, and anchor. Terminal settlement removes
the pending row and atomically commits the canonical signed response,
request-journal record, sequence-journal entry, and device sequence. Thus a
crash before settlement leaves an exact recoverable request, never a free
sequence that can authorize another effect.

Credential-bearing replay classification is not caller authority. The closed
request registry derives it for enrollment issue/consume, certificate renewal,
recovery device rebind, recovery bootstrap application, and intermediate
unseal. A caller-supplied mismatch is malformed and cannot weaken redaction.

### Canonical lifecycle and effect identity

The lifecycle digest has a defined acyclic preimage:

```text
UTF8("snapback:fly-lifecycle-request:v2\n") ||
JCS(request without transportBearer, requestSha256,
    and effectIntent.requestSha256)
```

The supervisor and provider executor both recompute that digest. They also
recompute the semantic effect id from the exact operation id, operation,
target-binding digest, plan digest, effect kind, logical resource name, and
desired-provider-state digest. Carried values are comparisons, not authority.
Any drift refuses before intent.

A spend grant is admitted before intent only when its journey, grant id,
plan digest, target-or-planned-binding digest, confirmation digest, semantic
effect id, and `reserved` one-use state all match. Terminal effect state retains
the complete lifecycle response so interruption recovery preserves diagnostics,
observation, evidence, and terminal facts instead of reconstructing a lossy
success-shaped response.

### Canonical head and provider custody

`HostedControlHeadV2` now has a distinct supervisor-owned `controlHeads` map in
the canonical database. Its digest, not the target-binding registry, enters
each mirror and incarnation anchor. The first head is generation zero with no
predecessor; every successor must name the exact digest of generation minus
one. Operator lifecycle admission requires byte-equality with that canonical
head. Tigris is only a supervisor-written/read-back mirror under exact
bucket/prefix/key authority and never a second writer.

Credential admission is an exact role → verb → resource check. Fly control is
bound to one exact app, while Tigris control state is bound to one exact bucket,
prefix, and external-head key. Wrong-role, cross-app, cross-bucket, cross-key,
and wrong-verb tests are required. Provider and external-store bodies are
bounded before accumulation; JSON control objects must be canonical JCS.
Ambiguous provider outcomes remain `commitUncertain`.

Every supervisor response signature rechecks the exact current
`supervisor-response` purpose head—root, intermediate key, serial, revocation
generation, and expiry—at signing time. Expiry is strict: equality with
`expiresAt` is expired.

### Explicit lifecycle GAP

The current V2 request/response carrier cannot express the exact
operation-specific authority and recovery facts required above. In particular,
`releaseLease` exposes a provider nonce as `leaseId` and lacks a
supervisor-only opaque lease journal binding exact expiry, provider version,
supervisor generation, and current control head. It is therefore not a safe
exception.

All seventeen lifecycle operations, including `releaseLease`, remain registered
for vocabulary compatibility but are disabled with
`SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE` before credential resolution or
provider I/O. CLI plans and supervisor health report disabled per-operation
availability until a separately reviewed closed-carrier design, Rust-owned
schemas, bootstrap/custody installation, public listener proof, and packed live
Fly/Tigris receipt all land. The tracked resolution criteria are in
`issues/shelved/20260728-hosted-lifecycle-carrier-and-custody-gap.md`.
