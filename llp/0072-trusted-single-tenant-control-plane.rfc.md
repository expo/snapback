# LLP 0072: Trusted single-tenant control plane

**Type:** RFC
**Status:** Draft
**Systems:** Deployment, Control plane, TLS, Auth, Migrations, Backup, Restore, Logs, Inspection, Secrets, Runtime, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-08-27 (release output-root refusal is scoped to the tested
symlinked-ancestor topology; descendant aliases, the prospective-path TOCTOU
interval, and an in-project output directory's wholesale dirty-source exclusion
remain explicit hardening routes).
**Revised:** 2026-08-26 (`deploy build` now gives release-mode codegen a
project-shaped publication root below the excluded release output, so a build
neither overwrites the committed development review manifest nor changes
release identity with output location). 2026-08-06 (dated amendment drafted at the author's
direction and ratified by the author the same day: §"Continuous-replication
authority" — first-class replication epoch, whole-authority
revoke-then-grant handover with drain-inclusive barrier, window
reconciliation, delete-visible mechanism for LLP 0188 pinned objects,
asymmetric encryption custody for both object classes). 2026-07-26 (author-side review application: the first Fly profile
now proposes one provider-enforced external control head over immutable Tigris
records and Fly Machine lease/version-guarded metadata, pins activation
linearization and crash recovery, derives normalized claims from retained raw
evidence, requires maintenance-mode multi-component backups, translates restore
authority, separates pre-release from post-release rollback, closes artifact,
TLS, admission-key, operator-grant, and audit custody, and makes the deployment
state machine executable. The profile must prove the provider guards live or
remain unsupported; the RFC remains Draft and still requires independent
systems/security review and executable evidence). 2026-07-26 (first concrete
adapter driver: the packaged Fly Machines driver
for `single-instance-container-vm.v1` now implements the closed observation
protocol (`doctor`/`inspect`) and the bounded provider-event `logs` query
against the live Machines API, with keychain credential-handle resolution,
org-fingerprint identity read-back, TLS-probe state classification, and
two-read byte-identical read-back behind every `remoteProviderAttestation`;
the drill target registered under the digest-pinned driver produced the
repository's first control-plane response with `remoteEvidence: true`, plus
live fail-closed witnesses for wrong-account identity mismatch, missing
credential, and tampered driver bytes, and a platform stop/start interruption
observed through the adapter — receipt
`demos/competitive-checkpoint/acceptance/results/control-plane-remote.v0.json`.
A non-canonical provider base structurally forces `remoteEvidence: false` in
the driver itself. Claim boundary unchanged: the lifecycle train, release
manifests, backup/restore, activation, and `inspectAdmin` sourcing remain
fixture-only or unimplemented for this adapter, no acceptance-corpus item is
claimed, and the origin's Let's Encrypt rate-limit outage is recorded as a
real degraded-state classification plus a cert-persistence GAP);
2026-07-26 (claim-boundary reconciliation: the LLP 0098
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
**Related:** LLP 0002, LLP 0007, LLP 0009, LLP 0012, LLP 0014, LLP 0017, LLP 0018, LLP 0023, LLP 0024, LLP 0030, LLP 0031, LLP 0036, LLP 0041, LLP 0046, LLP 0047, LLP 0057, LLP 0060, LLP 0062, LLP 0063, LLP 0070, LLP 0071, LLP 0074, LLP 0075, LLP 0077, LLP 0081, LLP 0098

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

## External control authority and fencing

One canonical per-deployment authority outside the application backup set
serializes every deploy, rollback, backup, restore, admission refresh, queue
pause, audit checkpoint, and traffic/effect transition. Its closed state binds:

- deployment and restore incarnation;
- current operation lease id, monotonically increasing fence, actor, purpose,
  and expiry;
- active/staged release and prepared-artifact digests;
- activation generation and provider-routing/Machine-version observation;
- serving, write, worker, queue, webhook, notification, and payment-effect
  pause state;
- database, stream, schema, auth, queue-admission, privacy/retention, audit,
  and hosted-admission key/floor generations; and
- last completed operation and receipt digest.

Every mutating adapter call, runtime boot, hosted-admission refresh, worker
claim, and completion carries the current incarnation and fence. Stale actors
cannot stage, route, restore, publish effects, refresh authority, or advance the
head. Application code and its secrets have no credential capable of reading
or mutating this authority.

### Fly/Tigris v1 authority

For the first Fly profile, each canonical control-state version is an immutable
object in the separately permissioned Tigris control prefix, keyed by its
SHA-256 digest. The sole authoritative head digest is stored in the exact Fly
Machine configuration metadata. A mutation must:

1. acquire the provider's exclusive Machine lease;
2. read and exact-match Machine id, app/org/region, `instance_id`, current
   metadata head, and lease version;
3. read and verify the immutable predecessor object twice;
4. conditionally create the successor object, read it back, and verify bytes;
5. update the full Machine configuration/metadata under the lease and
   `current_version` guard, combining the new head with any image/routing
   change that belongs to the same linearization; and
6. reread the Machine and successor bytes, then release the lease only after
   the retained receipt is durable.

The provider's Machine lease/current-version update is the serialization
primitive; Tigris is immutable record custody, not a lock. Fly's official
[Machines API](https://fly.io/docs/machines/api/machines-resource/) documents
exclusive Machine leases, `instance_id`, and `current_version`; the profile
must retain live contention, expiry, stale-version, metadata-bypass, and token-
scope evidence for the exact API behavior. If metadata mutation is not covered
by the lease, another credential can bypass it, or the provider cannot preserve
the head through replacement, this profile fails and a separate single-writer
control service requires its own RFC/cost claim.

The application Machine boots only from the head digest embedded in its current
provider version and reopens the referenced state before database/listener
access. A successful full-config update that installs a new image and matching
head is the activation linearization point for the bounded-downtime v1 shape.
The boot health nonce binds challenge, deployment/restore incarnation, release,
Machine `instance_id`, activation generation, database/stream, and fence.

Crash recovery is deterministic:

| Last durable fact | Recovery |
| --- | --- |
| successor object only | leave it unreachable; retry from the unchanged head |
| provider update accepted, response lost | reread Machine version/head and continue only if exact successor matches |
| new head visible, Machine not healthy | keep traffic/effects fenced; retry the same operation or execute the reviewed pre-release rollback |
| health passed, completion receipt absent | verify served nonce and exact head, then append the idempotent completion |
| lease expired at any earlier point | a new operator supersedes the fence; stale completions and refreshes fail |

Local plans and journals are caches/evidence. They never outrank this head.

### Operator grants

A mutating operation consumes a short-lived signed grant over exact target,
environment, deployment, plan digest, allowed effect, maximum spend/data-loss
window, actor/issuer/audience, issue/expiry, grant generation, and one-use
nonce. The external authority consumes the nonce in the same head transition
that acquires the operation fence. Read-only inspection uses a narrower grant
with explicit data classes and limits. Provider root credentials remain in the
OS credential store and are not available to application code or ordinary
agents; the receipt records the scoped provider-token fingerprint and effective
grant, never secret bytes.

### Continuous-replication authority — dated amendment 2026-08-06 (ratified by the author 2026-08-06)

Required by LLP 0188 (Accepted 2026-08-06) as a hard prerequisite of its
hosted continuous-replication lane; drafted at the author's direction.
This amendment extends the canonical authority to the LTX replication
stream's head and lifecycle, resolving the four items LLP 0188 delegates
here.

1. **Replication epoch — first-class, not the operation fence.** The
   canonical authority mints a **replication epoch**: a monotonically
   increasing value in its closed state, distinct from operation lease
   fences because replication is *standing* authority (an operation
   fence expires with its operation; a replication epoch changes only on
   supervisor supersession, restore-incarnation change, or explicit
   revocation). The epoch is granted with the supervisor role, recorded
   in every head object that role writes, and bound — alongside the
   deployment/restore incarnation — into LLP 0188 checkpoint proofs.
   This resolves LLP 0188 OQ4 in favor of the first-class epoch,
   mirroring LLP 0099's barrier-lease epochs rather than reusing an
   expiring fence.
2. **Credential custody and revoke-then-grant handover.** The supervisor
   role of the current replication epoch is the **sole holder of the
   entire replication mutating authority** — the head-write credential
   and the lifecycle/delete credential together; the application
   credential is append-only under store-enforced immutability (LLP 0188
   §5). Supersession revokes both credentials behind a
   **store-qualified revocation barrier** before the successor's grant
   is issued: the barrier must cover propagation, session invalidation,
   and **completion or refusal of already-authorized in-flight
   requests** (a drain bound the store must guarantee; credential TTL
   expiry alone is insufficient). A store that cannot provide the drain
   guarantee is unsupported for the hosted continuous lane.
3. **Window reconciliation.** The handover protocol defines, per window,
   the reconciliation the successor must run before advancing the head:
   supersession ordering; an in-flight stale head write (including one
   authorized pre-revocation that lands post-handover) — detected
   against the head's recorded epoch and predecessor binding, resolved
   by re-reading the authoritative head and refusing non-descendant
   state; a stale deletion (below); crash during handover — the grant
   record in the canonical authority is the recovery point, and a
   half-completed handover resumes from revocation-confirmed state, never
   by issuing a second concurrent grant; and a lost response — the
   writer treats an unacknowledged head CAS as unknown and must re-read
   before any further advancement.
4. **Delete-visible reconciliation for pinned objects.** Head-epoch
   stamping cannot detect a slipped stale *delete*, so the per-store
   qualification must name one delete-visible mechanism protecting LLP
   0188 §3-pinned objects: store object versioning with delete markers,
   object-lock retention covering the pin lifetime, or a supervisor
   deletion journal committed through the head (a deletion is valid only
   if journaled in a head the current epoch wrote before the store
   delete executes). LLP 0188 G3 exercises a stale-supervisor deletion
   against a pinned object under the qualified mechanism.
5. **Asymmetric encryption custody, both object classes.** Per this
   document's existing posture ("encryption keys live outside the
   protected deployment"), the replication stream's client-side
   encryption is asymmetric: encrypt-only material may reside in the
   deployment; decrypt capability is custodied outside it, with the
   holder recorded in the profile's who-can-decrypt-and-restore
   statement. This shape is pinned for **both** object classes — LTX
   segments and keyring snapshots — and keyring-snapshot decrypt custody
   must survive loss of the deployment (it is the disaster-recovery
   path).

With this amendment ratified (2026-08-06, jointly with LLP 0111's
companion custody amendment), the hosted continuous lane is admissible
once LLP 0188's gates pass; until they do, the operative shape remains
LLP 0111's supervisor-mediated periodic backup, exactly as LLP 0188 §5
records.

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

The prepared-release digest roots one immutable artifact graph: base manifest,
OCI image by registry digest, runtime/server/app/web/migration/worker objects,
dependency lock, generated ABI and admission epochs, SBOM/provenance, and every
signature. The signature covers
`SHA256("snapback-prepared-release-graph-v1" || 0x00 || canonicalGraph)`,
names key generation/algorithm/issuer, and is checked against current revocation
state at both plan and activation. Registry tags are informational only.
Artifact retention outlives every admitted job, rollback window, and restore
manifest that names the graph. Revocation quarantines activation even when an
older signature remains mathematically valid.

### Implemented target-neutral slice

The packaged CLI implements the pre-authority `build` boundary. It regenerates
and cross-checks the schema, function, and capability artifacts; binds a Git
source identity and toolchain; collects generated, dependency-lock, and
optional web bytes; refuses symlinks, path overlap/escape, secret/state file
classes, source maps, known credential patterns, and v1 size limits; then
copies through a private staging directory and reads every digest back before
retaining the closure.

Release-mode generation materializes its complete generated graph, codegen
cache, and immutable generation envelope beneath the release output root, which
the source-identity scan excludes. On the tested ordinary disjoint path it does
not write the backend's `generated/` review surface. The tested
symlinked-ancestor refusal canonicalizes the deepest existing output ancestor,
detects overlap before creating the requested directory, and leaves that
directory absent. It does not establish universal filesystem non-mutation:
descendant symlinks at `outputRoot/<backend-name>`, `outputRoot/.snapback`, or an
existing `outputRoot/<backend-name>/generated` followed by familiar-bootstrap
synthesis, and the prospective-canonicalization-to-`mkdirSync` interval, remain
hardening routes. The private root otherwise mirrors the application's project
shape so `artifacts.json.cache.graphPath` remains valid and release identity is
independent of output-directory spelling. The authored backend remains the
source-input authority, the relocated backend owns its disjoint publication
lock, and authored dirt outside the exact output directory fails the release by
default; excluding an in-project output directory wholesale remains a
pre-existing hardening gap. These residual routes are tracked in
`issues/shelved/20260827-release-output-root-alias-hardening.md`.

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
the Fly adapter has executed only bounded observation and provider-event log
queries. No concrete provider has executed the complete upload, TLS/auth
health, structured-log custody, admin inspection, activation/rollback,
multi-component backup, or restore evidence. Those remain required.

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

### Remote evidence contract

`remoteProviderAttestation` is a content-addressed reference to package-owned
closed raw evidence, never an adapter boolean. Each item binds target/provider/
account/resource, endpoint and method or served-path observer, canonical
request/response bytes or bounded digests, TLS peer and certificate facts,
provider request/server time, credential-handle fingerprint, resource revision,
fresh challenge where applicable, collector artifact, and capture time.
Qualification derives normalized claims from reopened evidence under a
versioned adapter reducer.

Admissible evidence classes are:

- TLS-authenticated provider API response with account/resource revision and
  request id;
- independent served-path probe with DNS answers, SNI, certificate chain,
  challenge nonce, and response digest;
- object-store create/read-back with object version/etag, encryption metadata,
  and full byte digest; or
- explicitly weaker operator observation, which cannot satisfy a production
  claim by itself.

Two identical reads establish stability only; they do not establish provenance
or semantic support. The per-claim reducer identifies the raw fields and
evidence-class conjunction that proves it. Unknown fields, cached observations,
missing freshness, wrong credential/account, and an adapter-supplied normalized
value without derivation fail closed.

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
and deterministic-fixture gaps only. The Fly driver has witnessed a bounded
provider-event log query and closed observation response; it has not witnessed
the RFC's structured application/control log sink, `inspectAdmin` fact set,
restore drill, or complete lifecycle.

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
resistance. The complete profile anchors each terminal control-operation
receipt and every LLP 0071 sealed audit/deletion-manifest root in the external
control-head sequence and a separately permissioned remote object prefix.
Sequence gaps or forks fail verification. Same-operator replacement remains a
nonclaim unless a separately administered checkpoint is proved.

Control-store reads open the target descriptor or retained artifact with
`O_NOFOLLOW`, validate the descriptor rather than a pre-open pathname, reject
multiple hardlinks and non-owner access, and compare inode/size/mtime facts
before and after the bounded read. External qualification/prepared artifacts
use the same descriptor-first non-symlink and single-link read without
requiring private mode because they carry no credential values. New and
replaced control files fsync their bytes and parent directory before becoming
authority.

## Deployment state machine

Serving state and control-operation state are separate.

`TargetServingState` is `registered | inactive | ready | active | degraded |
failed | retired`. `ControlOperation` is one of `provision | stage | activate |
rollback | backup | restore | inspect-maintenance`, with
`planned | fenced | running | verifying | succeeded | failed | ambiguous`.
`restoring`, `draining`, and "backup in progress" are operation/effect-pause
facts, not overloaded serving-health labels.

The normative transition floor is:

| Serving / operation | Event and guard | Next / posture |
| --- | --- | --- |
| registered / provision planned | external fence acquired | inactive / traffic and effects off |
| inactive / stage running | prepared graph and provider bytes verified | ready / traffic and effects off |
| ready / activate verifying | one guarded Machine config+head update | active candidate / writes and external effects still fenced |
| active candidate | served nonce and complete probes pass | active / release admitted, fences opened |
| active candidate | pre-release probe fails | prior compatible head restored under same fence / effects never opened |
| active | post-release health fails | degraded / traffic posture explicit; no automatic rollback |
| any non-retired | backup fence acquired | serving policy-declared, writes/effects paused for v1 |
| inactive / restore fenced | fresh restore/data/stream authority allocated | inactive / all effects paused until separate activation |
| any | lease expires or result is unknown | prior serving state plus ambiguous operation; new fence required |
| any non-retired | retire exact target | retired / no traffic, effects, refresh, or ordinary restore |

Every transition exact-matches provider observation and external control head,
advances only the named generations, appends mandatory audit before effects and
a terminal/ambiguous result after, and defines which operations remain legal.
A retired target can be used only as a named backup source; it cannot be
reactivated.

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
10. retain the result; automatically invoke the declared rollback path only
    while public writes/workers/external effects remain fenced.

Every step is idempotent under `operationId` and records its input/output digest.
A retry resumes or proves completion; it does not begin an unrelated deploy.
Concurrent deploy/rollback/restore operations are fenced by a deployment lease
and activation generation.

After the release fence opens to public writes, workers, or external effects, a
health failure becomes `degraded`. Rollback then requires a fresh external
fence plus compatibility/effect audit and must select `codeOnly`,
`forwardFix`, or `restoreRequired`; the controller cannot infer that returning
to the predecessor is safe. Prepared releases declare producer/worker artifact,
schema, and external-effect compatibility through the latest generation their
predecessor may consume.

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

The complete drill exercises renewal or a provider-supported safe renewal
simulation; proves certificate/key persistence across process restart and
Machine version replacement; tests expired, not-yet-valid, wrong-host, stale
cache, and DNS-rebinding observations; and verifies that direct backend/private
addresses cannot bypass the admitted hosted-auth topology. A currently valid
certificate or provider label alone does not prove renewal. The recorded Let's
Encrypt rate-limit degradation remains a blocking cert-persistence/renewal GAP
until this corpus passes.

The application accepts browser credentials only under LLP 0060's origin,
cookie/token, XSS, and hosted-auth contract. The deploy receipt records the
exact authentication mode and public origin. Preview and production origins
have distinct issuer/audience, cookie scope, secrets, database, and stream
identities; a preview release cannot share production session authority.

Hosted-admission MAC keys and external replay floors are scoped to target,
deployment, restore incarnation, and key/floor generation in the external
authority. Rotation is a control-head CAS with either one declared verification
overlap or a single cutover; refresh compares envelope and authority generation
and cannot revive a revoked key. Restore/replacement advances both generations
before runtime open. Golden/live vectors cover concurrent refresh, old operator,
lost response, disaster recovery, and restored-envelope rejection.

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

The first profile makes no online multi-component snapshot claim. Backup takes
a bounded maintenance window under the external fence:

1. pause new writes, queue claims, notifications, webhooks, payment commands,
   document compaction, and other effect publishers;
2. drain or classify every in-flight operation and commit a database frontier
   containing exact object generations plus pending external operations;
3. create the SQLite snapshot and copy every referenced object version;
4. read back, decrypt in the isolated verifier, hash, and reconcile all
   components; and
5. retain the immutable manifest and control-head transition before reopening
   effects.

The Step 6 fixture's preregistered maximum backup maintenance window is 15
minutes. Observed downtime and any higher application-specific ceiling remain
receipt facts. Backup succeeds only after authenticated read-back and a
periodic isolated verification restore using the exact manifest/key generation,
logical database integrity, component reconciliation, generated read-only
acceptance, and secret/private-data scans. Encryption keys live outside the
protected deployment; the profile declares who can decrypt and restore.
Retention and deletion are policy-controlled and audited.

Restore is always explicit and initially isolated:

1. resolve exact source backup and destination identities;
2. refuse production or a nonempty destination unless the operation names the
   permitted replacement and presents its fresh sentinel/hash;
3. under the external control CAS allocate a fresh restore incarnation,
   database incarnation, stream incarnation, activation generation, replay
   floor, queue admission, privacy/key, audit-segment, and cursor/cache epochs;
4. fence deploys, traffic, cron, jobs, notifications, webhooks, payment workers,
   session/admission refresh, search, and caches;
5. restore into the inactive destination and translate source identities:
   invalidate sessions and hosted-admission envelopes; reconcile sender replay
   floors; restamp or scope row versions; quarantine source claims/jobs and
   payment/webhook/notification effects; apply external deletion/hold/key
   manifests; and link source-backup lineage without reusing source authority;
6. verify every component hash, schema/artifact compatibility, referential
   checks, stream identity, and application sentinel;
7. run generated application acceptance in read-only/external-effects-disabled
   mode;
8. require an explicit activation that reattests secrets, origins, provider
   environments, and worker posture; and
9. retain the previous destination until policy permits deletion.

The runtime refuses restored bytes before the external authority and translation
receipt exact-match. Old subscriptions, cursors, caches, claims, operator
confirmations, and admission envelopes fail under the successor epochs.

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
Each generated log partition carries monotonic source sequence plus delivered,
dropped, duplicate, and delayed counters from an independent health query.
Application logs may truthfully be bounded-loss; mandatory audit never relies
on them. A sink outage degrades the target without asserting that all ordinary
traffic must block indefinitely.

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
- two operator machines contending on the same predecessor produce one
  provider-guarded control-head successor; stale lease, version, fence, grant
  nonce, metadata, raw-evidence, and completion attempts fail closed;
- public TLS, authentication, application health nonce, live query/mutation,
  logs, and admin inspection pass against the activated release;
- a compatible next release migrates and activates, then code-only rollback
  returns traffic to the prior digest without data rewind or lost committed
  writes;
- an incompatible/irreversible release is refused or truthfully selects
  `forwardFix`/`restoreRequired` before activation;
- crashes before/after each immutable-object write, Machine lease/version
  compare, full-config/head update, health challenge, audit anchor, and lease
  release recover according to the normative table without split traffic/head
  authority;
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

While this RFC is Draft and the selected Fly adapter has witnessed only its
observation/log-query slice, `trusted-single-tenant-app-complete.v1` remains
unsupported. Documentation, local dev, partial admission, or an API-only deploy
is not Step 6 evidence.

## Decisions still requiring ratification

The 2026-07-26 author-side review application proposes Fly
`single-instance-container-vm.v1` plus Tigris as the first complete adapter;
Fly Machine lease/current-version guarded metadata as the control-head
linearization over immutable Tigris records; mandatory Ed25519 artifact-graph
signing with the private key in macOS Keychain and public key generation in the
external authority; Tigris as the separately permissioned artifact, backup,
control-record, and audit-root store; and
`snapback-control-grant-v1` as the signed one-use agent grant. The Step 6
fixture ceilings proposed for preregistration are five minutes of
activation/code-rollback downtime, fifteen minutes of backup maintenance, and
thirty minutes to restore verification-ready; no broader availability/RTO claim
follows.

These choices are not accepted merely because they are written here. Live proof
must show that Fly metadata mutation is actually covered by the Machine lease
and version guard and that no automation credential can bypass it; failure
requires a new single-writer authority design. Independent systems/security
review and maintainer ratification remain prerequisites before implementation
can satisfy LLP 0063.
