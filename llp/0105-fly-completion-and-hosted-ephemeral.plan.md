# LLP 0105: Fly completion and hosted ephemeral profile

**Type:** Plan
**Status:** Review
**Systems:** Deployment, Control plane, Ephemeral state, Realtime, TLS, Auth, Migrations, Backup, Restore, Logs, Inspection, Runtime, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-27
**Revised:** 2026-07-27 (round-1 author reconciliation: expiring
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
   resolutions; run LLP maintenance and full proof.

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

Review. The Plan can be Implemented only after the two-family review loop,
governing dated amendments, complete local/fixture/remote evidence, and an LLP
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

Connection open negotiates the must-understand offer/echo
`ephemeralAuthorityProtocol: "ephemeral-authority.v1"`. Missing or unsupported
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
