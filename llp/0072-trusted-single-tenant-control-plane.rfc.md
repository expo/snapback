# LLP 0072: Trusted single-tenant control plane

**Type:** RFC
**Status:** Draft
**Systems:** Deployment, Control plane, TLS, Auth, Migrations, Backup, Restore, Logs, Inspection, Secrets, Runtime, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-26 (claim-boundary reconciliation: the LLP 0098
loopback-terminated target admits hosted auth as a partial pass; it does not
claim `hostedAuthCapable` or the complete trusted-single-tenant profile while
two attested facts remain unenforced and the LLP 0077 matrix remains unrun).
2026-07-25 (hosted-auth admission leg resolved: LLP 0098's
`loopback-terminated-single-instance.v1` profile admits on the served origin;
partial pass, two attested facts unenforced, 0077 matrix not run); 2026-07-25
(first adapter instantiation recorded: the LLP
0075-pinned Fly.io single-Machine drill target with its
region/storage/TLS/supervision/artifact/log/backup/credential/cost facts; claim
boundary unchanged — provisioning and the LLP 0076 gate-2 streaming drill
only, not this RFC's acceptance corpus); 2026-07-24 (a Rust-schema-owned,
owner-only remote-drill plan now
pins every provider-specific execution choice LLP 0072 requires before
provisioning: exact target/provider/account/region/origin, compute and
encrypted volume classes, separate artifact/backup stores, TLS issuer,
supervisor, log sink, credential/floor handles, a cost ceiling with provenance,
and the complete narrow-profile nonclaim set. It retains an exact confirmation
but has no apply path and grants no provisioning authority by itself).
2026-07-24 (owner-only control artifacts and external authority
artifacts are now opened descriptor-first with `O_NOFOLLOW`, single-link and
before/after inode checks; retained control writes fsync bytes and their parent
directory. The hardlink refusal is exercised in the package proof).
2026-07-24 (the package-owned qualification producers now mint
the hosted-auth drill receipt, exact eleven-claim adapter qualification, and
prepared-release manifest from closed target-bound inputs. They derive all
identities and positive booleans, exact-match evidence inventories, and reuse
the production verifiers; they do not execute or invent provider evidence, so
the concrete remote drill remains open). 2026-07-24 (the package-owned hosted-admission producer now
requires a content-addressed result from an adapter-supplied atomic external
floor advancement before it writes any boot authority; creates previously
unused exact-0600 key/envelope projections; authenticates the current envelope
before an atomic refresh; and preserves deployment, configuration, support,
handler incarnation, and boot floor across refresh. Rust-owned closed schemas
cover the external-floor, boot-projection, and refresh receipts. This supplies
the provider-neutral producer contract, not a concrete provider counter,
secret-manager retrieval, or remote evidence). 2026-07-24 (the native
hosted-startup path now consumes a strict
owner-only, MAC-authenticated target envelope before database open or listener
bind, reconciles its external sender-replay floor into SQLite, and refreshes
the short admission lease without permitting a live process to change its boot
floor or handler incarnation. The package control plane supplies the exact
cross-language envelope sealer and generated schemas. This closes the
assertion-only runtime handoff, not the provider producer or remote drill).
2026-07-24 (hosted-auth admission and live-health artifacts now
carry the LLP 0077 external sender-replay floor and require an exact current
match; this closes assertion-only wiring but does not supply the concrete
provider-side monotone counter or remote evidence). 2026-07-22 (author selected the first complete adapter and LLP
0075 adjudicated the competitive checkpoint `reprioritize`). 2026-07-24
(same-landing amendment for the acceptance of LLP 0081: the rollback posture
set gains the `generationRepublish` row — the maintenance-window predecessor
republish defined by LLP 0081 §6, distinct from a data rewind because nothing
outside the migration fence observed the successor). 2026-07-20 (initial
proposal for LLP 0063's hosted minimum profile)
**Related:** LLP 0002, LLP 0007, LLP 0009, LLP 0012, LLP 0014, LLP 0017, LLP 0018, LLP 0023, LLP 0024, LLP 0030, LLP 0031, LLP 0036, LLP 0041, LLP 0046, LLP 0047, LLP 0057, LLP 0060, LLP 0062, LLP 0063, LLP 0070, LLP 0071, LLP 0074, LLP 0075, LLP 0077

**Standalone-backup and control-audit checkpoint (2026-07-22):**
Rust-owned artifacts now cover exact standalone backup plans and bounded
control-audit events. The packaged CLI plans and applies a generation-fenced,
retention-bound, read-back-verified backup without changing the active release.
Deploy, backup, rollback, restore, and restore activation write mandatory
pre-action and terminal audit facts; privileged log, inspection, backup, and
restore reads are audited. The owner-only ledger validates its complete digest
chain and fails closed when its append lane is unavailable. This is local
control-plane evidence, not an independent or remote tamper-proof audit sink.

**Maintenance and operator-observability checkpoint (2026-07-22):**
Rust-owned artifacts now distinguish code-only rollback, destructive restore,
paused restore verification, explicit restore activation, maintenance receipts,
bounded structured logs, and authenticated inspection. The packaged CLI
content-addresses each mutation plan, rechecks live generations and sentinels,
requires exact confirmation, fences effects during restore, and rejects
non-remote evidence in production. The deterministic driver passes the
normalized drill with `remoteEvidence: false`; no concrete provider or complete
hosted profile is claimed.

**Target/lifecycle control-plane checkpoint (2026-07-22):** Rust-owned closed
schemas cover target/plan identity, mutating adapter calls, provider leases,
verified backup manifests, and hash-chained deploy receipts. The CLI implements
idempotent upload/provision/preflight/backup/stage/activate/verify, interruption
resume, rollback, and owner-only journals. Production apply requires a complete
adapter qualification, prepared release, and remote provider attestations; the
deterministic harness records `remoteEvidence: false`. Ordinary releases remain
activation-ineligible and no remote drill is claimed.

**First-adapter author decision (2026-07-22):** Charlie Cheever selected
`single-instance-container-vm.v1` as the first complete hosted adapter. Public
npm publication is a parallel gate. The existing Cloudflare line remains a
narrow proof until it satisfies this RFC's profile without semantic
substitutions. This chooses the implementation boundary; it does not accept
this Draft or claim any hosted drill has passed.

**Target-neutral release-build checkpoint (2026-07-22):** `snapback deploy
build` retains a canonical, content-addressed generated app/web/lock closure,
scans it, and verifies every copied byte. The manifest is Rust-schema-owned and
remains `activationEligible: false` with blocking GAPs for every unimplemented
adapter, hosted drill, compatibility-generation, probe, migration, and
supply-chain fact. No hosted adapter or gate is claimed.

## Summary

Snapback should have a target-neutral control-plane contract for deploying one
trusted application into one isolated hosted deployment. The first complete
profile is exactly LLP 0063's `trusted-single-tenant-app-complete.v1`: TLS,
accepted authentication/security semantics, immutable deploy and controlled
rollback, backup and destructive restore drill, structured redacted logs, and
authenticated inspection.

This profile deliberately does not claim untrusted application code,
multi-tenancy, horizontal realtime, autoscaling, zero downtime, or managed
platform economics. LLP 0014's phase ladder continues to govern when those
stronger claims may begin. This RFC defines operator objects and transitions
that LLP 0014 and the application-plane CLI left unnamed.

The control plane is adapter based. A target can be a container/VM deployment,
the Cloudflare profile, or another host only after its adapter maps every
required operation and passes the same drill corpus. Local `snapback dev` is a
source of build inputs and diagnostics, not hosted-deployment evidence.

## Control plane versus application plane

The application plane serves generated queries, mutations, actions, realtime,
assets, webhooks, auth, and public application traffic. Its generated CLI under
LLP 0062 is scoped to one app instance and cannot silently acquire deployment
administrator powers.

The control plane owns:

- target and environment registration;
- release build, signing, upload, activation, and rollback;
- schema/config compatibility preflight;
- domain and TLS state;
- backup, restore, and recovery locks;
- deployment status, health, logs, metrics, and gated inspection; and
- operator audit and target-safety fencing.

Control-plane credentials never enter application bundles, function arguments,
client storage, database backups, application logs, or app-level secret APIs.
Application provider credentials continue through LLP 0036.

## Identities and objects

Every operation binds these immutable or monotonic identities:

- `projectId`: the source application's stable identity;
- `targetId`: a never-reused operator-registered hosted target;
- `environmentId`: a named environment within that target;
- `deploymentId`: one isolated running application/data authority;
- `releaseId`: a content-addressed immutable release;
- `activationGeneration`: increments whenever traffic authority changes;
- `databaseId` and `streamIncarnation`: the application data/reset authority;
- `targetProfileId`: the exact capability profile; and
- `operationId`: an idempotent control operation with actor and reason.

A target descriptor includes provider/adapter kind and version, account or host
fingerprint, region/jurisdiction, canonical public origin, deployment id,
credential reference, state-store location, and production classification.
Descriptors are stored owner-only outside the repository. Provider credentials
are handles to an OS or platform credential store, never inline printable
fields; handle URIs reject userinfo, query, and fragment components.

A target identity is resolved and displayed before every mutating operation.
Aliases are convenience only. Destructive operations require exact ids and a
fresh provider-side identity read, not a cached alias or broad selector.

## Release artifact

`snapback deploy build` produces an immutable release manifest containing:

- source repository and revision, dirty-state fact, build tool versions, and
  reproducibility inputs;
- runtime, server, generated app artifact, web/static, migration, and optional
  worker artifact digests;
- schema and function manifest digests;
- minimum/maximum readable schema, retained-client, job, and config generations;
- target-profile requirements and explicit GAPs;
- dependency lock, license/SBOM, and provenance attestations;
- health/acceptance probe definitions; and
- signature/key id when artifact signing is configured.

Production activation refuses dirty-source artifacts by default. An explicit
non-production profile may retain a dirty artifact for preview, but its manifest
and UI must say so. Upload verifies bytes after transfer and stores artifacts
immutably; `releaseId` is the digest of the canonical manifest and all referenced
digests.

Secrets, admin tokens, local database bytes, ignored build credentials, and
source maps containing forbidden source classes are excluded and scanned.

### Implemented target-neutral slice

The packaged CLI implements the pre-authority `build` boundary. It regenerates
and cross-checks the schema, function, and capability artifacts; binds a Git
source identity and toolchain; collects generated, dependency-lock, and
optional web bytes; refuses symlinks, path overlap/escape, secret/state file
classes, source maps, known credential patterns, and v1 size limits; then
copies through a private staging directory and reads every digest back before
retaining the closure.

For v1, `releaseId` is SHA-256 over the domain separator
`snapback-release-manifest-v1` plus a NUL byte plus canonical JSON of every
manifest field except `releaseId`. Object keys sort lexicographically; arrays
retain their authored order. `release.manifest.json` itself is canonical JSON
with the derived id added. The verifier recomputes that identity, enforces
closed nested shapes, checks the exact declared file closure and scan totals,
and refuses missing, extra, symlinked, or changed bytes.

This is intentionally not the whole artifact described above. Runtime/server,
compatibility-generation, migration, health/acceptance probe, signature,
license/SBOM, provenance, upload, activation, rollback, backup/restore, logs,
inspection, and TLS evidence are retained as blocking GAPs. An adapter must
augment and prove those facts under this RFC before it can produce an
activation-eligible release; deleting a GAP is not proof.

### Implemented target and plan slice

The packaged control-plane CLI also implements the authority-free portion of
target registration and planning. A `snapback.target-descriptor.v1` document
binds every identity in this RFC plus `singleInstanceContainerVm`, adapter
version, canonical executable path and digest, provider/account/region/origin,
external credential handle, and state-store handle. The registry and retained
plans are owner-only; identical registration is idempotent and a reused target
id with different canonical bytes is refused.

`target doctor`, `target inspect`, and `deploy status` invoke the digest-pinned
driver with no argv and a closed stdin request under an allowlisted environment.
The response is bounded and closed, and every provider-side identity is compared
with the descriptor. `deploy plan` re-verifies the immutable release, performs
that live read-back, and binds descriptor/observation/release digests, observed
activation generation and active release, ordered lifecycle steps, GAPs,
expiry, and exact confirmation into a content address.

`deploy apply` implements both the common refusal boundary and the normalized
lifecycle train. It re-verifies exact release bytes and fresh provider state,
acquires a generation-bound lease, calls each closed adapter operation, writes
an owner-only journal after every step, retains content-addressed verified
backups, and emits a hash-chained deploy receipt. An interrupted attempt replays
the same operation/step ids; an ordinary failure attempts rollback and lease
release before returning the retained failure receipt.

The executable fixture proves success, an abrupt interruption and idempotent
resume, served-path failure and automatic rollback, stale-generation refusal,
and secret-class exclusion. Fixture evidence is structurally incapable of
passing production: every lifecycle response names whether it has remote
evidence, a positive value requires a verified `remoteProviderAttestation`, and
production apply rejects/rolls back a false value. The fixture's final receipt
also retains a blocking `control-plane.remote-evidence` GAP.

This closes the target-neutral orchestration contract, not the hosted profile.
The normal release builder still returns only `activationEligible: false`, and
no concrete provider has executed upload, TLS/auth health, logging, inspection,
rollback, backup, or restore evidence. Those remain required.

The activation authority is no longer injectable as a verifier boolean. A
Rust-schema-owned `snapback.adapter-qualification.v1` manifest must bind the
exact complete target/adapter/provider identity to remote attestations for all
eleven adapter qualification claims and zero GAPs. Its hosted-auth claim must
also embed a content-addressed `snapback.hosted-auth-drill-receipt.v1`: exact
target/browser support binding, all five positive LLP 0060 axes, a short-lived
deployment admission, disabled operator surface, excluded direct-bearer seam,
compatible handler, and live limiter/invalidation/serialized-authority health
at the same epoch. The live-health tuple also exact-matches the admission's
`senderReplayEpochFloor` and attests that the external monotone floor is
current before handler boot. All facts require remote evidence and zero GAPs. A generic `hostedAuth`
label is no longer sufficient. A separately
content-addressed `snapback.prepared-release.v1` manifest must bind that
qualification and base release to runtime/server, signature, SBOM, provenance,
compatibility-generation, migration, probe, and config evidence, a safe
rollback mode, and zero GAPs. Production plans bind both manifest digests and
production apply re-verifies them.

Package-owned producers now create the hosted-auth drill receipt, adapter
qualification, and prepared-release manifest from closed inputs. They derive
target/provider identity from the digest-pinned registration, exact-match all
eleven qualification claims and all ten prepared-release evidence classes,
derive content identities, and fail closed on missing remote attestations or
unsafe compatibility. The same production verifier then reopens the retained
bytes before planning. These constructors do not execute a provider drill or
turn evidence references into provider facts: a concrete adapter still owes
the referenced remote evidence. The verifier additionally requires
`trusted-single-tenant-app-complete.v1` in the registered target and base
release; codegen cannot emit that target today. This makes the remaining
hosted-capability and remote-drill work an explicit prerequisite instead of a
field an adapter or caller can assert ad hoc.

The target-neutral runtime consumer and provider-neutral producer contract now
exist. A concrete adapter calls `prepareHostedAdmissionBoot`, which requires a
content-addressed receipt from its awaited atomic external-floor operation
before creating previously unused exact-0600 key/envelope files. The package
recomputes the browser/support digest and seals the closed `HostedAdmission`
with the provider-secret-manager MAC key. `snapback start
--auth-deployment hosted` requires both projections, authenticates them before
opening target state, and reconciles `senderReplayEpochFloor` before listener
bind. `refreshHostedAdmissionProjection` first authenticates the existing
envelope, then atomically replaces it while preserving the exact deployment,
configuration, support, throttle policy, handler incarnation, and replay floor
of that boot. Refresh may only move admission, limiter, invalidation, issuance,
and expiry monotonically forward; invalid refresh never extends authority.
Rust-generated schemas own the external-floor, boot-projection, refresh,
envelope, and key shapes.

This does not supply the concrete provider primitive. The selected adapter
still must implement the atomic monotone store outside the application backup
set, retrieve the MAC key from its provider secret manager, operate the refresh
writer for the supervised process, and retain remote evidence for each fact.

The normalized operator-maintenance surface is also implemented behind the
same remote-evidence fence. A code-only rollback plan binds a destination
prepared release and compares its readable generation interval with
authenticated live inspection before a new lease may switch traffic.
Destructive restore binds a retained source backup to an exact preview
destination, refuses production, requires a matching active release plus fresh
sentinel for nonempty replacement, fences external effects, restores inactive,
and verifies component and application sentinels. Serving requires a separate
content-addressed activation plan over the paused receipt, restored release
bytes, prepared-release manifest, adapter qualification, and another fresh
inspection/lease.

Logs and authenticated inspection use a separate digest-bound adapter query
protocol. Log pages and scalar payloads are bounded; credential/private-content
field classes and credential patterns are rejected; dropped/backpressured logs
degrade an otherwise active target. Inspection returns bounded digest facts
for health, dependency, migration, backup, queue, connection, resource,
generation, capability, and control-operation state. Production calls require
remote provider attestations. These implementations close normalized protocol
and deterministic-fixture gaps only: no remote log sink, restore drill, or
provider inspection has yet been witnessed.

Standalone backup creation now has its own content-addressed plan rather than
borrowing deploy authority. It binds the exact target observation, active
release, activation/schema generations, requested retention policy, expiry,
operation id, and confirmation. Apply rechecks those facts, acquires the common
lease, requires read-back verification, retains the manifest and maintenance
receipt, and refuses an adapter retention substitution or any activation
change.

The local control store also retains a Rust-schema-owned append-only audit
chain. Each event names actor authority, exact deployment/database/stream,
operation and optional plan/receipt, generated event type/version, bounded
redacted payload, retention class, predecessor, and its content identity.
Mandatory mutation intake succeeds before the first adapter lifecycle call;
privileged reads append at practical aggregation. Unsafe fields, broken chains,
concurrent append locks, and unavailable capacity fail closed. This detects
accidental loss or modification but does not claim independent tamper
resistance; a concrete adapter still owes a remote/external sink and its
retention evidence for the complete profile.

Control-store reads open the target descriptor or retained artifact with
`O_NOFOLLOW`, validate the descriptor rather than a pre-open pathname, reject
multiple hardlinks and non-owner access, and compare inode/size/mtime facts
before and after the bounded read. External qualification/prepared artifacts
use the same descriptor-first non-symlink and single-link read without
requiring private mode because they carry no credential values. New and
replaced control files fsync their bytes and parent directory before becoming
authority.

## Deployment state machine

The durable control-plane states are:

`registered → provisioning → inactive → staging → ready → active`

with `degraded`, `draining`, `failed`, `restoring`, and `retired` as explicit
states. Transitions compare operation and activation generations and append an
operator audit fact.

An activation follows a retained plan:

1. resolve and attest the exact non-retired target/deployment identity;
2. verify operator authority, production classification, adapter version, and
   control-plane credential status;
3. verify release digests, signatures when required, profile compatibility,
   application config status, and all declared provider dependencies;
4. inspect current data/schema, retained-client, job, and authorization
   generations and produce a reviewed migration/compatibility plan;
5. create and verify the policy-required pre-deploy backup/checkpoint;
6. upload/provision the inactive release without granting public traffic;
7. run expand/compatible migrations and generated smoke/health probes;
8. switch one activation generation to the ready release;
9. verify public TLS, origin, authentication, health nonce, data sentinel,
   realtime, logs, and inspection through the served path; and
10. retain the result or automatically invoke the declared rollback path.

Every step is idempotent under `operationId` and records its input/output digest.
A retry resumes or proves completion; it does not begin an unrelated deploy.
Concurrent deploy/rollback/restore operations are fenced by a deployment lease
and activation generation.

The base profile may have bounded downtime and says so in its receipt. A target
without inactive staging can implement stop/migrate/start only if the plan,
measured downtime, rollback boundary, and health result are explicit.

## Migrations and rollback

Schema changes use an expand/migrate/contract discipline. The release declares
the schema versions it can read and write, the migration digest, whether each
step is transactional, and the irreversible boundary. The planner refuses a
release whose running/queued/retained artifacts cannot coexist with the proposed
schema.

Rollback means switching code and traffic to a compatible earlier release; it
does not silently rewind application data. Before activation the plan must name
one of:

- `codeOnly`: previous release reads/writes the current schema;
- `forwardFix`: irreversible migration requires a new corrective release;
- `restoreRequired`: rollback crosses a destructive boundary and is a separate
  destructive restore operation with acknowledged data loss window;
- `generationRepublish`: an Accepted
  [LLP 0081](./0081-reviewed-storage-evolution-and-migrations.rfc.md) §6
  fast rollback — available only inside the migration's `published-held`
  maintenance window, before traffic or workers are released, it atomically
  republishes the retained predecessor storage generation at a new
  application version with restamped row versions and its own digest-sealed
  rollback receipt. It is not a data rewind: nothing outside the migration
  fence ever observed the successor. After release it is unavailable and the
  posture falls back to the rows above; or
- `blocked`: no safe rollback, therefore activation is refused for the profile.

The minimum profile requires a successful code-only rollback drill across one
compatible release pair and a separate backup/restore drill. It does not allow a
dashboard button to imply every migration is reversible.

## TLS and public origin

The target adapter proves the canonical HTTPS origin, certificate chain,
hostname, validity, automatic-renewal mechanism, HTTP-to-HTTPS behavior, minimum
TLS policy, and backend origin exposure. Health checks use the public origin and
SNI, not only an internal loopback port.

The application accepts browser credentials only under LLP 0060's origin,
cookie/token, XSS, and hosted-auth contract. The deploy receipt records the
exact authentication mode and public origin. Preview and production origins
have distinct issuer/audience, cookie scope, secrets, database, and stream
identities; a preview release cannot share production session authority.

## Backup and restore

A backup is an immutable manifest over:

- exact target/deployment/database/stream and schema identities;
- an application-consistent data snapshot or target-native consistency token;
- system tables required by auth, replay, jobs, moderation/audit, documents,
  payments, assets, notifications, and migrations;
- asset/object manifests and checksums when the profile claims assets;
- release and artifact compatibility facts;
- creation operation, server time, tool/adapter versions, encryption and storage
  classes, and retention policy; and
- per-component byte count, object count, hash, and verification result.

Provider/application secrets and control-plane credentials are excluded. The
manifest records required secret names and generations, never values.

Backup succeeds only after read-back verification. Encryption keys live outside
the protected deployment; the profile declares who can decrypt and restore.
Retention and deletion are policy-controlled and audited.

Restore is always explicit and initially isolated:

1. resolve exact source backup and destination identities;
2. refuse production or a nonempty destination unless the operation names the
   permitted replacement and presents its fresh sentinel/hash;
3. fence deploys, traffic, cron, jobs, notifications, webhooks, and payment
   workers;
4. restore into an inactive destination with a new activation and restore epoch;
5. verify every component hash, schema/artifact compatibility, referential
   checks, stream identity, and application sentinel;
6. run generated application acceptance in read-only/external-effects-disabled
   mode;
7. require an explicit activation that reattests secrets, origins, provider
   environments, and worker posture; and
8. retain the previous destination until policy permits deletion.

The Step 6 drill uses an isolated non-production deployment, writes a unique
sentinel plus application fixture hashes, backs up, destroys/replaces the exact
destination, restores, and proves those oracles through the public and inspection
paths. The tool refuses broadly resolved targets and production classifications.

## Logs, metrics, and inspection

Application and control-plane logs use generated event schemas with timestamp,
severity, deployment/release/activation/stream identities, request/job/operation
correlation, event code/version, and a bounded redacted payload. Arbitrary
objects, secret handles, credentials, raw webhook bodies, payment payloads,
private document/message bodies, and full query args/results are rejected from
default logs.

Targets publish retention, indexing, delivery latency, drop/backpressure, and
export capabilities. A log sink failure is visible in health; security-critical
control operations follow LLP 0071's mandatory-audit posture.

Authenticated inspection includes:

- active/inactive release and artifact digests;
- target, origin, database, stream, schema, config, auth, and worker generations;
- capability manifest and GAPs;
- health, dependency, migration, backup, queue, connection, and resource facts;
- bounded application table/query inspection under the existing admin model;
  and
- control operation history and redacted diagnostics.

Public health reveals only liveness and a nonce. Full health and inspection use
separate admin authority, are rate-limited and audited, and never expose secret
values. A deployment with app traffic but no working logs or inspection is
`degraded` and cannot pass the minimum profile.

## CLI and automation contract

The control CLI uses plan/apply operations:

- `snapback target add|show|doctor`;
- `snapback deploy build|plan|apply|status|rollback`;
- `snapback backup create|list|verify`;
- `snapback restore plan|apply|verify|activate`; and
- `snapback logs` / `snapback inspect`.

Every mutating command supports machine-readable output, stable diagnostic
codes, idempotency operation ids, noninteractive credentials, and exact target
identity. Production and destructive operations never infer confirmation from
TTY presence. They require the declared policy's explicit confirmation token or
signed automation authority after showing the immutable plan digest.

The generated app CLI may link to these operations but cannot widen its grant.
Agents can prepare plans and execute operations already granted to them; acquiring
provider accounts, accepting terms, spending money, changing DNS ownership, or
crossing a production-destructive boundary remains human work absent explicit
delegation.

## Adapter contract and first profile

A target adapter implements identity resolution, credential check, artifact
upload, provision/stage, schema inspection/migration, activation switch, public
health, rollback, backup/read-back/restore, log query/stream, and inspection.
Each operation returns raw provider facts plus a normalized result and names any
semantic gap.

The first complete hosted adapter is
`single-instance-container-vm.v1`. It has one deployment and data authority per
environment: one Snapback runtime/server process in an OCI container or
equivalently isolated VM service, one encrypted attached SQLite volume, and no
horizontal replica. Its normalized contract requires:

- a target-pinned provider, account, region, and public origin in every
  descriptor and receipt; there is no implicit default region;
- provider load balancer or reverse-proxy TLS with automated certificate
  renewal and an independently attested origin;
- provider container supervision or `systemd` with restart and interruption
  evidence, never a developer tunnel;
- immutable object storage keyed by release digest for artifacts and a
  separately permissioned object-store prefix/bucket for verified backups;
- structured `journald` or provider log export with the retention and
  redaction facts this RFC requires;
- an OS credential store or provider secret manager holding control-plane
  handles outside application configuration; and
- a cost boundary of one compute instance, one persistent volume, object
  storage, logs, DNS, and TLS, with no high-availability, autoscaling, or
  multi-region claim.

The first remote drill must pin the concrete provider, account fingerprint,
region, storage classes, TLS issuer, supervisor, artifact/backup stores, log
sink, credential backend, and estimated cost before provisioning. Those are
execution facts, not portable defaults. This adapter is representative because
it exercises the complete native runtime and data/control lifecycle with the
fewest distributed-system substitutions. The Cloudflare adapter remains a
separate narrow proof under LLP 0014 until it passes the same contract without
semantic forks.

`createRemoteDrillPlan` and `verifyRemoteDrillPlan` implement that
pre-provisioning boundary as
`snapback.remote-drill-plan.v1`. It derives target identity from the
digest-pinned registration; requires an encrypted volume, separate artifact and
backup permission boundaries, external admission-key and replay-floor handles,
all six cost components, a provenance digest and maximum monthly cost; and
retains the narrow profile's HA/autoscaling/multi-region/zero-downtime/
untrusted-multitenancy/managed-SLA nonclaims. The owner-only content-addressed
plan expires after one hour and says `confirmationRequired`; verification
rechecks its content identity, target registration, exact confirmation,
validity interval, infrastructure separation, cost boundary, and nonclaims.
No apply function exists yet, so producing or verifying it neither provisions
resources nor authorizes spend.

### First adapter instantiation — recorded 2026-07-25

The single-instance container/VM path is the chosen first adapter shape (LLP
0075 protocol amendment v0.6 pinned the provider tuple by author decision;
Cloudflare remains a narrow proof). The first real provisioning exists as the
LLP 0075/0076 remote drill target, with these recorded facts:

- **Provider/region:** Fly.io, one Fly Machine, region `sjc` (app
  `snapback-drill`, org `personal`).
- **Storage:** SQLite on the machine rootfs (`/data/drill.sqlite3`) — a drill
  posture, deliberately not a volume; rootfs survives machine stop/start and
  is reset on image update, and the drill receipt says so.
- **TLS:** Fly's edge-terminated automatic certificates on the canonical
  public origin (`https://snapback-drill.fly.dev`); the machine bind itself is
  plaintext behind the platform edge, which is exactly why the hosted-auth
  contract refuses on this target (below).
- **Process supervision:** the Machine's restart policy plus a two-process
  entrypoint (server + machine-loopback deterministic stream source).
- **Artifact store:** the Fly registry image built from the repository
  Dockerfile (`demos/competitive-checkpoint/acceptance/drill/`), with the
  Linux Hermes runtime as a checksum-pinned prebuilt patched bundle.
- **Log sink:** Fly's platform log pipeline (drill scope only; no structured
  log-schema claim is made).
- **Backup store:** the Tigris S3-compatible bucket `snapback-drill-backups`
  with an application-consistent SQLite backup and byte-exact read-back
  witness (`backup-to-tigris.sh`).
- **Credential backend:** `FLY_API_TOKEN` — a named revocable org token —
  sourced from the git-ignored machine-local `.agent-local-secrets.md`.
- **Cost boundary:** one `shared-cpu-1x` machine with auto-stop plus one
  bucket (single-digit dollars per month at drill duty cycle).
- **Representativeness:** one isolated container-image deployment owning one
  data authority behind a platform TLS edge is the smallest honest instance
  of this profile's shape.

Drill evidence (2026-07-25, protocol amendment v0.7): the LLP 0076 gate-2
remote instrument passed 7/7 against the served origin, the durable-row
secret scan over post-run on-machine dumps passed with zero findings, the
Tigris backup read-back witnessed byte-exact, and the hosted-auth leg
produced its refusal witness on-machine (exit 1). Receipts:
`demos/competitive-checkpoint/acceptance/results/{remote-streaming,durable-row-scan,tigris-backup,hosted-auth-refusal}.v0.json`.
Every receipt records the posture: `SNAPBACK_PROFILE=test` with
`--allow-insecure-dev-auth` behind Fly's TLS edge — the prod profile refuses
this exact configuration, and that refusal is part of the shipped fence. The
drill also caught a serve-path defect the fence's local witnesses could not:
the CLI validated `--allow-insecure-dev-auth` pre-bind but never installed it
into request-path state, so every app-data route on a non-loopback bind
refused regardless of the flag (fixed with a regression test in the same
landing).

### Hosted-auth leg resolved 2026-07-25 — the loopback-terminated profile

The hosted-auth refusal recorded below is superseded for the admission leg.
[LLP 0098](./0098-hosted-edge-adapter.spec.md) defines the
`loopback-terminated-single-instance.v1` profile and the same Fly target now
runs it: Caddy terminates a Let's Encrypt certificate inside the container
behind Fly raw-TCP passthrough on 443, and the origin binds `127.0.0.1:4287`.
`--auth-deployment hosted` **admits** there under a signed, deployment-bound
attestation, and the served origin publishes the attested five-positive tuple.

The topology change is what resolved it. The plaintext posture below cannot
attest LLP 0060 D2 because any co-resident workload on the platform's private
network can address the origin directly; loopback termination removes that
class by construction rather than assuming the private network is empty.

Receipt: `demos/competitive-checkpoint/acceptance/results/hosted-edge-admission.v0.json`.
It is a **partial pass**: two attested facts (`operatorSurface: disabled` and
D2's plaintext-refusal clause) are not yet enforced by the origin, and the LLP
0077 matrix has not run because the deployment's active auth mode is still
`dev`. `hostedAuthCapable` stays unclaimed.

Claim boundary, unchanged: this records provisioning, the LLP 0076
gate-2 streaming drill, and now the hosted admission leg — NOT this RFC's
acceptance corpus. No control-plane
adapter operations (release manifests, activation generations, restore locks,
inspection contract) exist for this target;
`trusted-single-tenant-app-complete.v1` remains unsupported. The hosted-auth
admission leg no longer refuses on this target: it admits under LLP 0098's
signed, deployment-bound hosted-edge attestation. That partial admission does
not establish `hostedAuthCapable`, because the two enforcement gaps above
remain and the LLP 0077 matrix has not run against a hosted-auth deployment.

## Acceptance

The chosen hosted adapter must retain executable evidence that:

- a clean immutable release builds, scans, uploads, and verifies its manifest
  and every artifact digest;
- target aliases, stale descriptors, cross-account credentials, wrong origin,
  preview/production identity, and concurrent operations fail closed;
- public TLS, authentication, application health nonce, live query/mutation,
  logs, and admin inspection pass against the activated release;
- a compatible next release migrates and activates, then code-only rollback
  returns traffic to the prior digest without data rewind or lost committed
  writes;
- an incompatible/irreversible release is refused or truthfully selects
  `forwardFix`/`restoreRequired` before activation;
- backup read-back verifies all component hashes and excludes secret values;
- the isolated backup → destroy/replace → restore-paused → verify → activate
  drill recovers the exact fixture/sentinel, document/payment/job/audit facts
  admitted by the pressure tests, and external effects remain fenced until
  explicit activation;
- process/platform restart and deployment interruption resume idempotently;
- expired TLS, missing config, incompatible artifacts, failed migration, log
  sink failure, inspection failure, and health failure produce structured
  degraded/failed state and block profile completion;
- logs/diagnostics/artifacts/backups/receipts pass secret and private-data scans;
  and
- the final receipt names costs, downtime, retention, performance, capacity,
  target limitations, and all nonclaims.

The retained receipt binds repository revisions, clean-state facts, release and
adapter versions, target/environment/deployment/database/stream identities,
public origin and certificate fingerprint, schema/migration/config/auth
generations, activation timeline, backup/restore manifests, log/inspection
queries, acceptance hashes, and every GAP.

## Non-goals and claim boundary

This RFC does not define a hosted multi-tenant service, untrusted execution,
horizontal scaling, autoscaling, zero downtime, global failover, full disaster
recovery objectives, billing, or a universal infrastructure-as-code language.
It does not make all schema migrations reversible.

While this RFC is Draft and the selected first adapter has not been witnessed,
`trusted-single-tenant-app-complete.v1` remains unsupported. Documentation,
local dev, or an API-only deploy is not Step 6 evidence.

## Open questions

1. *(Narrowed 2026-07-25 — shape chosen, adapter still unbuilt.)* Is
   Cloudflare or a single-instance container/VM the first complete hosted
   adapter? The container/VM shape is selected (LLP 0075 amendment v0.6) and
   first instantiated on Fly.io as the recorded drill target; whether that
   provisioning grows into this RFC's complete adapter remains open.
2. Which artifact-signing and external backup stores are mandatory for the base
   profile rather than reported opt-ups?
3. What measured downtime ceiling should the first profile declare?
4. Which control-plane credential store and agent grant format should be the
   paved local operator experience?
