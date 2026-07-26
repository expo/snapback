**Reviewer family:** GPT (author-side pass; not independent)
**Provider / runtime:** OpenAI Codex API agent
**Date:** 2026-07-26
**Redacted:** no
**Method:** manual

# Review of LLP 0072: Trusted single-tenant control plane

This is an author-side critical pass over the committed Draft at Snapback
`828f359a0aaed7c7891058d36534d012a89f8f8e`. Because the draft is attributed
to Charlie Cheever / Codex, this review does **not** count as the independent
cross-family review appropriate for deployment, backup, restore, and operator
authority.

## Overall assessment

The proposal correctly chooses a narrow hosted minimum and builds unusually
strong local refusal machinery: content-addressed releases and plans,
descriptor-first file handling, exact identities, non-injectable qualification,
generation checks, resumable operations, paused restore, and honest
fixture-versus-remote evidence. The existing target-neutral implementation and
Fly drill are meaningful progress without being mislabeled as the complete
profile.

The remaining gap is not just more adapter calls. The RFC does not identify one
shared, rollback-resistant control authority that serializes operations from
multiple operator machines and couples an activation generation to provider
traffic state. A digest-pinned driver reporting two identical API reads is
still the same component making the claim; “remote evidence” needs a
cryptographic and semantic contract. Restore also needs a new data/stream
identity and a complete reconciliation protocol rather than restoring old
authority bytes under a fresh field. These are foundational correctness gaps.

## Strengths

- `## Control plane versus application plane` keeps deployment credentials and
  destructive authority out of generated application code and app secrets.
- `## Identities and objects` binds every operation to exact project, target,
  environment, deployment, release, data, stream, profile, and operation
  identities and rejects aliases for destructive effects.
- `## Release artifact` content-addresses the complete closure and retains
  unimplemented facts as blocking GAPs rather than allowing a caller to delete
  them.
- `### Implemented target and plan slice` distinguishes deterministic fixture
  evidence from provider evidence and reopens retained bytes before planning
  and applying.
- `## Migrations and rollback` explicitly separates code rollback from data
  rewind and recognizes forward-fix, restore-required, and unpublished
  generation-republish cases.
- `## Backup and restore` starts a restore inactive, fences effects, verifies
  the result, and requires a separate activation.
- `## CLI and automation contract` makes exact plan confirmation and automation
  authority explicit and does not infer destructive permission from a TTY.
- `### First adapter instantiation` truthfully records that the current rootfs,
  logs, auth mode, and partial edge topology do not satisfy the complete
  profile.

## Concerns

### Critical — there is no single shared control-operation fence

The implementation uses owner-only local plans, journals, and a
generation-bound lease, but the RFC does not say where the authoritative lease
and activation generation live. Two authorized operators on different
machines can each have valid local state, observe the same provider generation,
and begin deploy, rollback, backup, or restore concurrently. Provider APIs that
do not expose one transactional generation compare cannot make the local
journal authoritative.

Define a per-deployment control authority outside the application backup set
with atomic compare/update over:

- deployment and restore incarnation;
- current operation lease id, fencing token, owner, purpose, and expiry;
- active and staged release digests;
- activation generation and provider-routing observation;
- traffic/effect pause state;
- database/stream identity and schema generation; and
- last completed operation/receipt digest.

Every mutating adapter request and runtime boot must carry the current fence;
stale workers must be unable to stage, route, restore, refresh hosted admission,
or publish completion. If a provider cannot enforce the fence in its resource
API, the profile must name the compensating single-writer service and prove
that bypass credentials are absent from automation.

### Critical — activation generation is not atomically coupled to traffic

The state machine says switching traffic increments one activation generation,
but provider routing and the retained generation can change in separate
operations. A crash between them can report old traffic with a new generation
or new traffic with an old generation. A second operator cannot reliably infer
which release is authoritative from two byte-identical observations.

Specify a provider-specific linearization point and recovery table. Each
adapter must prove one of:

- native conditional routing update bound to an immutable release digest and
  provider revision;
- a stable router/proxy controlled by the external control authority; or
- bounded-downtime stop/rebind/start under an exclusive provider fence.

The health nonce must be generated by the active release and bind release,
activation, deployment, stream/restore epoch, and a fresh challenge. A
point-in-time status label is not activation evidence.

### Critical — `remoteProviderAttestation` is self-attestation without a trust contract

A digest-pinned adapter can still return fabricated normalized facts. Reading
the same provider response twice proves stability, not provenance, freshness,
or that the response supports the normalized semantic claim. The current RFC
does not pin which raw API bytes, TLS observations, signatures, request ids, or
credential/account bindings make an attestation admissible.

Define evidence classes per qualification claim:

- provider-signed or TLS-authenticated API response with endpoint, method,
  request/response digest, server/request time, account/resource revision, and
  credential-handle fingerprint;
- independent served-path probe with DNS answers, certificate chain, SNI,
  challenge nonce, and observed body digest;
- object-store read-back with version/etag, authenticated encryption metadata,
  and full digest verification; or
- explicitly weaker operator observation, which cannot satisfy a production
  claim by itself.

The package verifier should derive normalized facts from retained closed raw
evidence where practical, rather than accepting a driver boolean plus
attestation label.

### Critical — restore must create new data and stream authority

The backup manifest binds the source database and stream identities, while the
restore step asks to verify “stream identity” and also claims a new restore
epoch. Copying the old system tables can revive sender replay floors,
authorization epochs, subscription cursors, job claims, idempotency windows,
session generations, and external-effect state that belonged to the source
incarnation.

Define destination identity translation:

- a fresh database incarnation or an explicit same-database restore generation;
- a fresh stream incarnation that old cursors cannot use;
- a restore epoch sourced from authority not rolled back with the backup;
- invalidation/reconciliation of sessions, hosted-admission envelopes, sender
  replay floors, jobs, webhooks, payments, notifications, caches, and retained
  clients;
- row/version restamping or a protocol proving old versions are safely scoped
  by the new stream; and
- an append-only source-backup lineage link without reusing source authority.

The runtime must refuse to open restored bytes until translation and all
external-authority reconciliation complete.

### Critical — multi-component backup consistency is unspecified

The profile may include SQLite plus assets, documents, payments, jobs, audit,
and object manifests. An “application-consistent snapshot or consistency
token” for SQLite does not atomically freeze object storage or external
provider facts. Hashing each component can preserve a mutually inconsistent
set.

Pin a backup barrier:

1. acquire the shared control fence and enter a bounded application snapshot
   epoch;
2. stop or fence writes/effect publishers that cannot participate;
3. commit a database backup frontier containing exact object generations and
   pending external operations;
4. copy/version every referenced object and prove read-back;
5. record excluded/non-restorable provider state explicitly; and
6. release the barrier only after the immutable manifest is durable.

If online backup is not proved, the base profile should honestly require
bounded maintenance downtime. Do not imply cross-provider atomicity.

### Critical — automatic rollback after public activation can be unsafe

The lifecycle automatically rolls back after served-path verification failure.
Once public traffic or workers can reach the new release, it may commit writes,
enqueue new-artifact jobs, emit webhooks, or exercise newly expanded semantics.
Code-only compatibility at planning time does not prove those effects are safe
to hand back to the predecessor.

Separate:

- pre-release verification, where traffic/effects remain fenced and automatic
  rollback is safe;
- a release linearization point;
- a short monitored canary/validation interval with explicitly constrained
  writes; and
- post-release failure, where rollback requires a fresh compatibility and
  effect audit or selects `forwardFix`/`restoreRequired`.

Every prepared release must declare producer and worker artifact compatibility,
external-effect compatibility, and the latest generation to which its
predecessor can safely return.

### Major — deployment state names are not an executable state machine

`degraded`, `draining`, `failed`, `restoring`, and `retired` have no complete
transition table. It is unclear whether degraded traffic remains public, how a
failed operation resumes, whether retired can be restored, or which state wins
when a lease expires during activation.

Add a normative table with current state, event, required observation and
fence, next state, traffic/effect posture, generation changes, allowed
operations, audit facts, and recovery. Make operation state separate from
target serving state so “backup in progress” does not overload deployment
health.

### Major — deploy-time compatibility does not close producer admission races

Inspecting queued jobs, retained clients, schema, auth, and configuration before
activation is a point-in-time check. An old producer can enqueue an
old-artifact-only job after inspection; a new producer can publish data before
rollback compatibility is fixed. LLP 0070 has the same race.

Use versioned admission epochs for jobs, clients, writes, hosted auth, and
configuration. Activation must atomically change allowed producer/worker
generation sets under the shared control fence. Compatibility is an enforced
overlap, not a report.

### Major — release identity, signatures, and OCI custody need one protocol

The base manifest identity is well defined, but the RFC does not pin what the
signature covers, how keys rotate/revoke, how a prepared release relates to
the base identity, or whether OCI images are referenced by immutable registry
digest rather than mutable tag. Artifact/object retention must outlive every
queued job, rollback window, and restore manifest that names it.

Require an immutable artifact graph rooted at prepared-release digest,
signature over a domain-separated graph identity, key generation and
revocation status, transparency/provenance facts, registry/object-store version
ids, and verified download bytes. Revocation must quarantine activation even
when an old plan still verifies cryptographically.

### Major — TLS evidence needs renewal and backend-exposure proofs

A currently valid certificate and HTTPS response do not prove automatic
renewal. The recorded Let's Encrypt rate-limit degradation demonstrates that
the renewal mechanism and certificate persistence are operational behavior,
not metadata.

The complete drill should exercise or safely simulate renewal with retained
provider evidence, prove certificate/key persistence over process and machine
replacement, test expired/not-yet-valid/wrong-host chains, and verify direct
backend addresses cannot bypass the hosted-auth topology. DNS rebinding and
stale certificate observations must not be accepted from cache.

### Major — external floor and MAC key rotation are incomplete

The hosted-admission envelope binds an external replay floor and a
provider-secret-manager MAC key, but rotation/revocation, concurrent refresh,
disaster recovery, and restored-envelope rejection are not fully specified.
Deleting/replacing the target must not make an older key/floor current again.

Bind key generation and floor generation to target/deployment/restore
incarnation in the external authority. Rotation needs an overlap or
single-cutover protocol, fail-closed refresh CAS, audit, and a proof that old
operators and restored snapshots cannot mint accepted envelopes.

### Major — backup verification needs authenticated restore, not byte equality alone

Object-store etags and encrypted-byte read-back prove custody of ciphertext but
not that the complete backup can decrypt and restore. Conversely, a test
restore can leak sensitive data if its destination and logs are not isolated.

Require periodic isolated verification restores using the exact manifest and
key generation, logical database integrity checks, component/object
reconciliation, generated read-only acceptance, and secret/private-data scans.
Record recovery time and recovery point honestly. The base profile need not
promise an ambitious RTO/RPO, but it must report measured values.

### Major — retention and privacy authority can be rolled back

Retaining old destinations and backups may conflict with LLP 0071 deletion,
legal hold, and cryptographic-erasure requirements. Restoring an old backup can
resurrect data already expired from production.

The control plane must consume a deletion/hold/key manifest from authority
outside the restored backup before activation, reconcile it, and include the
result in the restore receipt. Backup deletion must preserve only the minimum
audit tombstone and must not leave undeclared replicas.

### Major — admin inspection authority is underspecified

The RFC requires separate admin authority, rate limiting, and audit but does
not define credential issuance, audience, resource ceiling, expiry,
revocation, two-person control for destructive operations, or agent grant
format. A control-plane token with broad provider credentials can bypass the
fine-grained plan model.

Define short-lived operation-scoped grants over exact target, plan digest,
allowed command/effect, maximum cost or data-loss window, actor, issuer,
audience, expiry, and nonce. Provider root credentials should remain behind a
broker or be inaccessible to ordinary agents where the provider permits.

### Major — control audit is local and can fork

Owner-only files and a local append lock protect one workstation, not multiple
operators or workstation loss. Two control stores can each produce valid
chains. The RFC already avoids claiming independent tamper resistance, but the
minimum hosted profile needs a canonical complete operation history.

Anchor each completed control operation receipt in the shared external control
authority and, for the selected adapter, a separately permissioned remote log
or object sink. Define sequence, partition, canonical bytes, retention, fork
detection, and restore behavior. Local chains remain useful caches/evidence,
not the sole authority.

### Moderate — exact confirmation needs replay and delegation semantics

The plan digest and typed confirmation are good, but confirmation should bind
actor/grant generation, target and environment, effect class, maximum cost and
data-loss window, issue/expiry times, and a one-use nonce consumed by the shared
control authority. Copying a confirmation string between machines must not
authorize a later operation after identity or policy changes.

### Moderate — logs cannot be both mandatory and lossless by assertion

Provider log pipelines may drop, reorder, duplicate, or delay events.
“Dropped/backpressured logs degrade” requires sequence/loss counters and an
independent health source. Mandatory control audit should use the durable
control-audit path; application logs can truthfully report bounded loss rather
than blocking the whole app indefinitely.

### Moderate — profile cost and capacity need measured definitions

The final receipt names costs, performance, and capacity, but no workload,
sampling interval, bill components, headroom rule, or overload behavior is
pinned. Record observed idle and drill-period cost, storage/log growth,
concurrency and data-size fixtures, restart/restore duration, and explicit
nonclaims. Do not extrapolate a one-machine drill into a general production
capacity claim.

### Moderate — the RFC is mixing stable design and an implementation diary

The long revision header and multiple checkpoint banners make the normative
contract hard to distinguish from dated evidence. The document is near LLP
0005’s large-RFC threshold and its artifact, lifecycle, backup, auth, and
operator-authority sections have independent change pressure.

Keep the architectural RFC concise and move implementation chronology to a
diary or active implementation plan. If further normative growth continues,
split release/artifact custody, lifecycle/authority, and backup/restore into
numbered sub-RFCs with independent acceptance.

## Suggestions

1. Implement the external control-authority record and provider-routing
   linearization proof before adding more normalized adapter methods.
2. Model `TargetServingState`, `ControlOperation`, `Lease/Fence`, and
   `ReleaseAdmissionEpoch` as separate objects rather than one overloaded
   deployment state.
3. Build a deterministic crash/retry model that stops before and after every
   provider call, authority CAS, local journal append, traffic switch, backup
   barrier, and restore translation.
4. Promote retained raw evidence into a closed package-owned schema and derive
   qualification facts from it.
5. Move the Fly target to the required encrypted volume and immutable
   digest-addressed artifacts before attempting the complete acceptance drill.

## Open questions for the author

1. What provider or separately deployed service will own the canonical
   operation fence and activation generation for the first Fly profile?
2. Does the first profile permit maintenance downtime for all migrations and
   backups, or is any online-consistency claim required?
3. Is a provider-signed API response required for each remote fact, or which
   facts may be established by an independent served-path observer?
4. Which operator actions require fresh human confirmation versus a
   pre-authorized, short-lived automation grant?

## Recommended next step

Revise and remain `Draft`. Close the shared control authority, activation
linearization, remote-evidence contract, restore identity translation,
multi-component backup barrier, and post-release rollback rules. Then obtain an
independent non-GPT systems/security review and execute the full crash model
before the author considers `Accepted`.
