<!-- Generated deploying section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/deploying/index.md -->
---
title: Deployment posture
id: deploying.index
order: 0
audience: agent-first
capabilities: [deploy.release-build, deploy.target-control, deploy.cloudflare]
authorities: [llp/0002-canonical-local-target.decision.md, llp/0040-cloudflare-narrow-proof.rfc.md, llp/0072-trusted-single-tenant-control-plane.rfc.md, llp/0111-fly-completion-and-hosted-ephemeral.plan.md, llp/0202-agentic-surface-audit-20260808.research.md, packages/snapback-cli/index.mjs, packages/snapback-cli/deployment-control.mjs, packages/snapback-cli/hosted-control.mjs, cloudflare/deploy.sh, issues/20260726-0072-fly-adapter-remaining-surface.md, issues/20260728-hosted-lifecycle-carrier-and-custody-gap.md]
examples: []
status: current
targets: [all]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:b8d0b1c8db2169ff78afea78417374268e681164c440744c62ec88c7122a1297
---

# Deployment posture

**Snapback does not currently offer an end-to-end path that deploys an
arbitrary user application to any hosted target.** The local target runs an
app for development and testing, the Fly control plane stops behind evidence
and lifecycle gates, and the Cloudflare workflow deploys only two checked-in
proof apps. Treat those as three different boundaries, not partial steps of one
working product journey.

## Check where each path stops

| Target or surface | What works now | Exact stopping point | Tracking ticket |
| --- | --- | --- | --- |
| Local | `snapback dev` runs the canonical local dev/test target. `snapback deploy build` can create and verify a target-neutral immutable release closure. | Every release built by that command has `activationEligible: false` and blocking `gaps`; the command does not upload, provision, activate, or host it. Local is not a hosting adapter. | The selected first complete hosted path, rather than a local-hosting adapter, is tracked by [the Fly adapter remaining-surface ticket](repo:issues/20260726-0072-fly-adapter-remaining-surface.md). |
| Fly.io | Exact target registration, observation/doctoring, content-addressed planning, and the target-neutral lifecycle engine exist. Some Fly observation, backup primitive, supervisor, and custody evidence has also been retained. | Ordinary `deploy plan` output remains blocked, and `deploy apply` cannot obtain the zero-GAP adapter qualification and prepared release backed by the complete remote product journey. Upload, provision, activation, served inspection, migration, rollback, restore activation, and the final packed receipt remain open. | [Fly adapter remaining surface](repo:issues/20260726-0072-fly-adapter-remaining-surface.md). |
| Cloudflare | `cloudflare/deploy.sh` can build, deploy, activate, health-probe, and emit an exact-version receipt for the checked-in `notes` or `all-aboard` proof from a Snapback source checkout. | `SNAPBACK_CF_APP` is a closed `notes | all-aboard` selector. The script is not wired to `snapback deploy build`, does not consume an arbitrary generated application, and is explicitly not a general Cloudflare hosting product. | The current product path to arbitrary app deployment is the [Fly adapter remaining-surface ticket](repo:issues/20260726-0072-fly-adapter-remaining-surface.md); the Cloudflare profile remains deliberately narrow under LLP 0040. |
| Hosted lifecycle CLI | `snapback hosted plan`, `inspect`, and `logs` expose package-owned planning/read surfaces and the package publishes the exact lifecycle vocabulary. | Every one of the 17 `snapback hosted lifecycle` verbs returns `SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE` before credential resolution or provider I/O. | [Hosted lifecycle carrier and custody GAP](repo:issues/20260728-hosted-lifecycle-carrier-and-custody-gap.md). |

The Fly tracker appears for both the local and Cloudflare rows deliberately:
the project selected Fly as the first complete hosted product journey. There
is no separate commitment to turn the local target into a host or generalize
the Cloudflare proof before that work.

## Choose the honest path today

- For development and acceptance, use the local authoring loop; do not call it
  a deployment.
- To exercise the retained release and planning contracts, follow [immutable
  releases and deploy plans](./releases.md) and expect the documented GAP
  refusals.
- To redeploy one of the two repository proofs, follow [the Cloudflare proof](./cloudflare.md).
- To inspect the disabled hosted command surface, read [hosted control](./hosted-control.md).
- If the task requires an arbitrary user app at a public hosted origin, stop
  and report the relevant open ticket instead of assembling a private path
  around the gates.

## Anti-patterns

- **Do not describe `deploy build` as deployment.** It produces no provider
  effect or traffic activation.
- **Do not treat a deterministic lifecycle-harness receipt as remote
  evidence.** Its explicit GAP is the point of the harness.
- **Do not substitute `cloudflare/deploy.sh` for a general app adapter.** Its
  two proof apps and source-checkout inputs are closed.
- **Do not bypass a hosted lifecycle refusal with direct Fly or Tigris
  credentials.** The missing carrier and custody closure is an authority
  boundary, not a CLI inconvenience.

---

<!-- snapback-guide-source: guide/deploying/releases.md -->
---
title: Build and plan an immutable release
id: deploying.releases
order: 1
audience: agent-first
capabilities: [deploy.release-build, deploy.target-control]
authorities: [llp/0072-trusted-single-tenant-control-plane.rfc.md, llp/0098-hosted-edge-adapter.spec.md, packages/snapback-cli/index.mjs, packages/snapback-cli/deployment-control.mjs, crates/snapback-auth/src/auth/deployment.rs, crates/snapback-auth/src/auth/hosted_edge.rs, schemas/release.manifest.schema.json, schemas/target.descriptor.schema.json, schemas/remote-drill.plan.schema.json, schemas/deploy.plan.schema.json, schemas/vm-adapter.lifecycle-request.schema.json, schemas/vm-adapter.lifecycle-response.schema.json, schemas/backup.manifest.schema.json, schemas/backup.plan.schema.json, schemas/control.audit-event.schema.json, schemas/deploy.receipt.schema.json, schemas/adapter.qualification.schema.json, schemas/hosted-auth.drill-receipt.schema.json, schemas/auth.hosted-admission-envelope.schema.json, schemas/auth.hosted-admission-key.schema.json, schemas/prepared-release.manifest.schema.json, schemas/rollback.plan.schema.json, schemas/restore.plan.schema.json, schemas/restore.activation-plan.schema.json, schemas/maintenance.receipt.schema.json, schemas/vm-adapter.query-request.schema.json, schemas/vm-adapter.query-response.schema.json]
examples: [demos/competitive-checkpoint]
status: current
targets: [all]
maturity: partial
reviewed: 2026-08-03
reviewed-authorities-digest: sha256:f85a68b5535014a11658cc98888396f98b3a2890058da4ba26f101dbb3176352
---

# Build an immutable release

`snapback deploy build` closes and retains the target-neutral input to a
deployment adapter. It does not upload, provision, activate, or claim a hosted
application. The resulting manifest is deliberately activation-ineligible and
lists every missing hosted or supply-chain proof as a blocking GAP.

## Build and verify the release closure

Run generation and release construction from the application root:

```sh
snapback deploy build snapback \
  --target-profile local-dev-sqlite-ibex \
  --web-dist dist-web \
  --json
```

The default store is `.snapback/releases/<release digest>/`. Pass `--output`
to retain the closure elsewhere. A successful result has
`schemaVersion: snapback.deploy-build.v1` and reports the release id, manifest
digest, component count, byte count, source posture, and blocking GAPs.

The command regenerates the app, verifies that its schema, function, and
capability manifests agree with the selected target profile, and collects the
generated artifacts, package manifest, dependency lock, and optional web
distribution. It then:

- rejects symlinks, path overlap/escape, source maps, local databases, dotenv
  files, npm credentials, private keys, and known credential patterns;
- enforces the v1 file and byte budgets;
- records the Git revision, commit timestamp, tool versions, dirty-state fact,
  compatibility digests, capabilities, scans, and every component digest;
- derives `releaseId` from canonical manifest content;
- copies through a private staging directory and verifies every copied byte;
  and
- reopens the completed closure and refuses undeclared, missing, or changed
  files.

Building the same clean inputs reuses the same verified release. The output
store is excluded from the source-dirty calculation, so a retained default
release does not poison the next build.

## Handle dirty preview input explicitly

A dirty tree fails with `SNAPBACK_DEPLOY_DIRTY_SOURCE`. For a non-production
preview only, opt in:

```sh
snapback deploy build snapback --allow-dirty --json
```

The manifest retains `source.dirty: true` and a digest of the dirty path facts
without disclosing the path list. Dirty input never becomes activation
eligible in this target-neutral command.

## Read GAPs before choosing an adapter

Every v1 release has `activationEligible: false`. It names missing adapter,
runtime, signing, provenance, SBOM, migration, probe, logs, inspection,
rollback, backup/restore, and TLS evidence, plus target capability gaps. A
future adapter may add artifacts and receipts only under the LLP 0072
identity/plan/apply contract; it may not reinterpret this result as deployment
success.

The existing [Cloudflare proof](./cloudflare.md) remains a separate, narrow
repository workflow. It is not wired to `snapback deploy build`, and neither
surface currently satisfies the complete hosted profile.

## Register one exact container/VM target

Create a descriptor conforming to
`schemas/target.descriptor.schema.json`, then register it outside the source
tree:

```sh
snapback target add \
  --descriptor ~/.config/snapback/preview-target.json \
  --control-root ~/.local/state/snapback/control \
  --json
```

The descriptor binds the project, target, environment, deployment, database,
stream incarnation, target profile, production class, provider account, region,
HTTPS origin, and `singleInstanceContainerVm` adapter version. `driverPath` is
absolute and `driverSha256` pins the executable bytes. `credentialRef` names an
OS or provider secret-store handle; a credential value is not a valid field.
Credential and state references reject URI userinfo, query, and fragment
components so an apparently opaque handle cannot smuggle inline authority.

The control root, target registry, and retained plans must be owner-only.
Registration is idempotent for identical canonical bytes and refuses to reuse a
`targetId` for any different descriptor. Every later read rechecks the adapter
digest, so replacing the executable invalidates the registration rather than
silently changing its authority.

Inspect the registration and require fresh provider read-back:

```sh
snapback target show target-preview-1 --json
snapback target doctor target-preview-1 --json
snapback deploy status --target target-preview-1 --json
```

The adapter receives one closed JSON request on stdin with no argv arguments and
an allowlisted environment. Snapback rejects a different provider account,
region, origin, deployment, database, stream, or target profile even when the
adapter exits successfully.

## Pin the remote drill before provisioning

An adapter integration calls `createRemoteDrillPlan` and
`verifyRemoteDrillPlan` from
`@expo/snapback-cli/deployment-control` before it exposes any provisioning action.
The resulting `snapback.remote-drill-plan.v1` artifact binds the registered
provider/account/region/origin and exact driver bytes to:

- compute and encrypted persistent-volume classes;
- distinct immutable artifact and separately permissioned backup stores;
- TLS issuer, automated renewal, supervisor, restart, and interruption rules;
- bounded redacted log sink and retention;
- external control, admission-key, state, and replay-floor handles; and
- a currency, estimate, maximum monthly cost, estimate-provenance digest, and
  the six included cost components.

The plan explicitly retains that the profile does not claim HA, autoscaling,
multi-region operation, zero downtime, untrusted multi-tenancy, or a managed
service SLA. It is owner-only, content-addressed, expires after one hour, and
contains an exact confirmation token. Verification rechecks the retained
content identity, current target/driver binding, confirmation, expiry,
infrastructure separation, cost ceiling, and nonclaims. There is intentionally
no provisioning apply path yet: constructing or verifying this plan records
choices but does not authorize spend or create resources.

## Retain a content-addressed deploy plan

Planning re-verifies the release, calls the adapter's read-only inspection, and
binds both observations into a 15-minute immutable plan:

```sh
snapback deploy plan .snapback/releases/<release-digest> \
  --target target-preview-1 \
  --reason "preview acceptance" \
  --json
```

The plan records exact identities, the observed activation generation and
active release, release and manifest digests, ordered lifecycle steps, every
blocking GAP, and an exact confirmation token. Repeating the same operation id,
reason, time, release, target, and provider facts produces the same plan id.

Apply consumes the exact retained plan and release:

```sh
snapback deploy apply <plan-id> \
  --target <id> \
  --release <release-dir> \
  --confirm <token>
```

It verifies the content identity, target, confirmation, expiry, GAP set, exact
release bytes, and fresh activation generation before any adapter mutation. At
this checkpoint every ordinary release remains activation-ineligible, so
normal apply fails with `SNAPBACK_DEPLOY_PLAN_BLOCKED`.

Behind that fence, the common apply engine is implemented. It acquires a
provider lease and invokes digest-bound, idempotent adapter steps for immutable
upload, inactive provisioning, compatibility preflight, verified backup,
staging, activation, served-path verification, and lease release. Each step is
retained immediately in an owner-only journal and a hash-chained final receipt.
An interruption resumes the same `operationId`; an adapter failure invokes
rollback and lease release. A production call rejects a step without a verified
`remoteProviderAttestation` as `SNAPBACK_DEPLOY_REMOTE_EVIDENCE_REQUIRED` and
rolls it back.

The deterministic lifecycle harness exercises this entire protocol, including
interruption/retry and failure/rollback, but every resulting receipt has
`remoteEvidence: false` plus a blocking GAP. It cannot satisfy the hosted
profile. No ordinary release verifier returns `activationEligible: true`, and
no remote provider driver or hosted receipt has been witnessed.

Retained control authority is read through a descriptor opened with
`O_NOFOLLOW`, not by trusting a pathname checked earlier. Owner-only artifacts
must remain single-link and unchanged across the bounded read. Qualification
and prepared-release inputs use the same descriptor-first, single-link rule.
Control writes fsync both the new bytes and containing directory before the
result is treated as retained authority.

## Qualify an adapter and prepare a release

Production planning has two additional, closed artifact gates. An adapter
qualification binds the exact target, complete profile, driver digest,
provider account, region, and origin to remote evidence for all of:

- identity fencing and immutable upload read-back;
- TLS/origin and hosted-auth behavior;
- public health/acceptance, logs, and authenticated inspection;
- compatibility plus code-only rollback;
- isolated backup/restore and interruption resume;
- secret/private-data scans; and
- the concrete cost and capacity boundary.

The `hostedAuth` claim cannot be satisfied by that label and a generic
attestation alone. The qualification embeds a content-addressed executed drill
receipt binding the exact target and browser artifact to all five positive
static support axes, a maximum-five-minute deployment admission, disabled
operator surface, excluded direct-bearer seam, compatible handler, and live
limiter/invalidation/serialized-authority health under the same admission
epoch. It requires zero GAPs and remote-provider evidence. The receipt proves
the qualification-time drill; serving activation still needs a fresh admission
and live health.

A prepared release then binds that qualification to one base release plus
runtime/server artifacts, signature, SBOM, provenance, compatibility
generations, migration/rollback envelope, health and acceptance probes, and
configuration requirements. Both artifacts are content-addressed, require a
closed evidence inventory, and must retain zero GAPs before they can produce an
eligible plan.

`@expo/snapback-cli` exports `createHostedAuthDrillReceipt`,
`createAdapterQualificationManifest`, and `createPreparedReleaseManifest` for
adapter implementations. The producers derive target, provider, account,
region, origin, driver, qualification, and base-release bindings instead of
accepting those identities from the caller. They also require every one of the
eleven qualification claims and ten prepared-release evidence classes exactly
once, then derive the content identities consumed by the verifier.

```sh
snapback deploy plan <release-dir> \
  --target <id> \
  --reason "qualified preview" \
  --adapter-qualification <qualification.json> \
  --prepared-release <prepared-release.json>
```

The verifier requires the exact
`trusted-single-tenant-app-complete.v1` profile in the target, base release,
qualification, and prepared release. The producers do not run provider
operations or manufacture remote attestations: their evidence inputs must come
from the concrete adapter's retained drill. There is still no codegen
capability manifest or concrete remote drill for that profile, so the producer
and verifier contracts do not make current releases eligible. A
caller-supplied boolean or an evidence-looking provider name cannot replace
the artifacts.

## Start a hosted handler through the authenticated gate

The native server has the target-neutral consumer for a real adapter's hosted
startup authority, and `@expo/snapback-cli/hosted-admission-producer` supplies the
provider-neutral producer contract. Before each handler boot,
`prepareHostedAdmissionBoot` awaits the adapter's atomic advancement of
`senderReplayEpochFloor` in a monotone store outside the application backup
set and verifies its content-addressed receipt. Only then does it create
previously unused exact-0600 admission and key projections. The 32-byte MAC key
comes from the target's provider secret manager and conforms to
`schemas/auth.hosted-admission-key.schema.json`; it is never an application
config value or release, backup, log, or receipt component.

No `snapback start` flag consumes those two files today. The native
MAC-envelope consumer verifies the closed envelope shape, key identity,
canonical MAC, canonical HTTPS origin, five-minute admission lifetime, exact
finite throttle policy, positive hosted facts, and a nonzero external replay
floor — but it is reachable only through the native test harness, not the
serving path. A refresh of that envelope may advance admission, limiter, and
invalidation epochs; it cannot change deployment, handler incarnation, the
canonical origin, or the boot's replay floor. A bad or missing refresh never
extends authority: new work fails closed when the last authenticated
admission expires.

What `snapback start --auth-deployment hosted` accepts today is the LLP 0098
hosted-edge admission seam. Without an adapter attestation it refuses with
`SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED`. With one, the adapter supplies an
edge configuration — which carries no authority, only the identities and
verification key to check against — plus an Ed25519-signed admission
envelope, both verified before the database opens or a listener binds:

```sh
snapback start \
  --host 0.0.0.0 \
  --db /var/lib/snapback/app.sqlite3 \
  --auth-deployment hosted \
  --hosted-edge /run/snapback/hosted-edge.json \
  --hosted-admission /run/snapback/hosted-admission.json
```

`--hosted-edge` and `--hosted-admission` require each other. Installation
reconciles the admission epoch and external replay floor into a durable
SQLite watermark, so a correctly signed but older replayed snapshot is
refused. A verified admission lives at most five minutes; a renewal loop
re-reads the envelope document every 30 seconds and only ever installs
another independently verified successor — when the document stops covering
the clock, the incumbent expires and serving withdraws.

`refreshHostedAdmissionProjection` authenticates the current envelope with the
provider key before replacing it atomically. It constructs the next admission
from the authenticated boot facts, so deployment, configuration, support,
throttle policy, handler incarnation, and replay floor cannot be substituted
by the refresher. Its non-secret external-floor, boot-projection, and refresh
receipts have Rust-owned closed schemas and explicitly retain
`remoteEvidence: false`.

This is the producer protocol, not the concrete provider implementation. No
provider currently supplies and remotely attests the rollback-external
counter, secret-manager retrieval, supervised refresh operation, or complete
drill, so hosted capability and gate 1 remain open.

## Inspect retained backups

A backup can be planned and applied independently of a deployment. The plan
binds a fresh target observation, active release, activation and schema
generations, requested retention policy, operation id, expiry, and exact
confirmation:

```sh
snapback backup create plan \
  --target target-preview-1 \
  --reason "scheduled recovery point" \
  --retention-policy thirty-days

snapback backup create apply <backup-plan-id> \
  --target target-preview-1 \
  --confirm <create-backup-token>
```

Apply rechecks the same generations, acquires the deployment lease, requires
the adapter to return a content-addressed manifest only after component
read-back, verifies that the adapter honored the planned retention policy, and
proves that backup creation did not change the active release or activation
generation. A successful deploy lifecycle also retains its pre-deploy backup
manifest independently of the deploy receipt:

```sh
snapback backup list --target target-preview-1 --json
snapback backup verify <backup-id> --target target-preview-1 --json
```

The manifest binds deployment, database, stream, pre-deploy release, schema,
encryption/storage/retention classes, component byte/object/hash facts, and
verification times. It must explicitly exclude `application-secrets` and
`control-plane-credentials`. `backup verify` rechecks the owner-only manifest
content identity and the adapter's component read-back attestations; it does
not refetch a remote object and therefore is not a substitute for the remote
restore drill.

## Verify the control audit chain

Every deploy, backup, code-only rollback, destructive restore, and restore
activation apply writes a mandatory `began` fact before its first provider
mutation and a terminal outcome afterward. Log/admin inspection, backup
list/verify, and restore verification also append bounded privileged-read
facts. The owner-only ledger rejects secret-shaped field classes and chains
each Rust-schema-owned event to its predecessor:

```sh
snapback audit verify --control-root <control-dir>
```

Use `--audit-actor <portable-id>` on control commands to name the local
operator explicitly. If omitted, the CLI records the portable local OS user
when available. A busy, corrupt, unsafe, or unwritable audit intake fails
closed before a privileged action proceeds. The local chain detects accidental
loss or modification; it is not described as tamper-proof because the same
operator controls the store.

## Plan and apply a code-only rollback

Rollback is a separate content-addressed mutation; it never rewinds data. Its
planner consumes the destination release, prepared-release manifest, and
adapter qualification, then uses authenticated live inspection to prove that
the destination can read the current schema generation and declares
`rollbackMode: codeOnly`:

```sh
snapback deploy rollback plan \
  --target <id> \
  --release <destination-release-dir> \
  --prepared-release <prepared-release.json> \
  --adapter-qualification <qualification.json> \
  --reason "return to prior compatible release"

snapback deploy rollback apply <rollback-plan-id> \
  --target <id> \
  --release <destination-release-dir> \
  --prepared-release <prepared-release.json> \
  --adapter-qualification <qualification.json> \
  --confirm <token>
```

Apply re-verifies every artifact and the live active release, activation
generation, and schema generation before acquiring a lease. It runs
compatibility preflight, switches to the destination under a new generation,
verifies the served path, and retains a hash-chained maintenance receipt.
`forwardFix`, `restoreRequired`, and `blocked` are not silently treated as
code-only rollback.

## Restore into an isolated destination, then activate explicitly

Restore consumes a retained verified backup and initially leaves the
destination inactive with external effects fenced:

```sh
snapback restore plan <backup-id> \
  --source-target <source-id> \
  --target <destination-id> \
  --reason "isolated recovery drill"

snapback restore apply <restore-plan-id> \
  --target <destination-id> \
  --confirm <destroy-and-restore-token>

snapback restore verify <paused-receipt-id> \
  --target <destination-id>
```

V1 refuses production destinations. An empty preview destination must be in an
isolated state. A nonempty destination additionally requires both its exact
active release and fresh application sentinel via `--replace-release` and
`--destination-sentinel`; neither fact is inferred from an alias.

Apply fences traffic and external workers, restores the backup into the
inactive destination, verifies component hashes and an application sentinel
with external effects disabled, and retains a `restoredPaused` receipt. That
receipt is not serving authority. Activation requires another fresh plan and
confirmation:

```sh
snapback restore activate plan <paused-receipt-id> \
  --target <destination-id> \
  --release <restored-release-dir> \
  --prepared-release <prepared-release.json> \
  --adapter-qualification <qualification.json> \
  --reason "activate verified recovery"

snapback restore activate apply <activation-plan-id> \
  --target <destination-id> \
  --release <restored-release-dir> \
  --prepared-release <prepared-release.json> \
  --adapter-qualification <qualification.json> \
  --confirm <activate-restore-token>
```

The activation plan rechecks the inactive state, restore generation, sentinel,
log sink, paused receipt, restored release bytes, prepared-release manifest,
and target-specific adapter qualification. Apply re-verifies them, acquires a
new lease, re-enables serving under a new activation generation, verifies the
public path, and retains a separate `restoreActivated` receipt.

## Query bounded logs and authenticated inspection

The adapter query protocol is separate from public health and ordinary target
identity inspection:

```sh
snapback logs --target <id> --since-ms <ms> --until-ms <ms> --limit 100
snapback inspect --target <id>
```

Responses are digest-bound to the request and exact target. Logs are limited to
500 structured entries per page and 32 bounded scalar payload fields per
entry. Credential-, request-body-, payment-, private-content-, query-argument-,
and result-shaped field names are rejected, as are known credential patterns.
An active target reporting dropped or backpressured logs fails log health.

Authenticated inspection returns only bounded digest facts for health,
dependencies, migration, backups, queues, connections, resources, generations,
capabilities, and recent control operations. Production commands require a
verified remote-provider attestation. The deterministic driver is accessible
only through the package test harness and remains `remoteEvidence: false`.

## Repair a refused build

- `SNAPBACK_DEPLOY_SOURCE_UNVERSIONED`: initialize and commit the application
  repository so the release has an immutable source identity.
- `SNAPBACK_DEPLOY_DIRTY_SOURCE`: commit the intended source, or use
  `--allow-dirty` only for a visibly dirty preview.
- `SNAPBACK_DEPLOY_CAPABILITY_MISMATCH`: select a profile that supports every
  generated requirement; do not delete the requirement to make the build
  green.
- `SNAPBACK_RELEASE_FORBIDDEN_FILE`,
  `SNAPBACK_RELEASE_SECRET_SCAN_FAILED`, or
  `SNAPBACK_RELEASE_SOURCE_MAP_REFUSED`: remove the forbidden bytes from the
  release input and rotate any credential that entered a build tree.
- `SNAPBACK_RELEASE_ARTIFACT_TAMPERED`: discard the damaged retained directory
  and rebuild from reviewed source. Never patch a content-addressed closure in
  place.
- `SNAPBACK_ADAPTER_DRIVER_TAMPERED`: restore the reviewed adapter bytes or
  register a new never-reused target descriptor after reviewing the new digest.
- `SNAPBACK_TARGET_IDENTITY_MISMATCH`: stop and reconcile the descriptor with
  the provider account and origin; never override provider read-back.
- `SNAPBACK_DEPLOY_PLAN_BLOCKED` or `SNAPBACK_DEPLOY_PLAN_EXPIRED`: inspect the
  GAPs or create a fresh plan. A confirmation token does not waive either
  fence.
- `SNAPBACK_DEPLOY_REMOTE_EVIDENCE_REQUIRED`: the driver returned a local or
  unattested lifecycle result. The CLI rolls back; install a qualified remote
  adapter rather than relabeling the evidence.
- `SNAPBACK_MAINTENANCE_CONFIRMATION_REQUIRED`: use the exact token retained in
  the rollback, restore, or restore-activation plan; TTY presence is not
  confirmation.
- `SNAPBACK_RESTORE_STALE_PLAN` or
  `SNAPBACK_RESTORE_ACTIVATION_STALE_PLAN`: destination generation, release, or
  sentinel changed; discard the plan and inspect again.
- `SNAPBACK_ADAPTER_LOG_REDACTION_INVALID`: the adapter emitted a forbidden or
  unbounded log payload field. Fix the adapter schema/redactor; do not weaken
  the reader.
- `SNAPBACK_CONTROL_AUDIT_UNAVAILABLE`: the mandatory append lane is locked or
  unwritable. Stop the privileged operation, preserve the store, and run
  `snapback audit verify`; do not bypass or delete audit history.

## Anti-patterns

- **Do not call `deploy build` a deployment.** It grants no provider or traffic
  authority.
- **Do not suppress a blocking GAP.** Supply the named artifact or executed
  receipt through an accepted adapter contract.
- **Do not put secrets in a web bundle or generated directory.** Secret scans
  are a last refusal boundary, not a configuration mechanism.
- **Do not edit a retained release.** Its content address and read-back check
  are the authority.

---

<!-- snapback-guide-source: guide/deploying/cloudflare.md -->
---
title: Deploying the Cloudflare proof
id: deploying.cloudflare
order: 2
audience: agent-first
capabilities: [deploy.cloudflare]
authorities: [llp/0014-cloudflare-strategy.rfc.md, llp/0031-server-route-taxonomy.spec.md, llp/0040-cloudflare-narrow-proof.rfc.md, llp/0049-all-aboard-cloudflare-live.plan.md, llp/0060-hosted-auth-security.rfc.md, llp/0094-wire-envelope-contract.spec.md, llp/0251-outbound-destination-policy.rfc.md, schemas/cloudflare.deploy-receipt-v1.schema.json, schemas/live.kit-socket-request.schema.json, schemas/live.kit-socket-reply.schema.json, cloudflare/README.md, cloudflare/deploy.sh, cloudflare/src/gateway.js, cloudflare/src/coordinator.js, crates/snapback-server/src/server.rs, cloudflare/test/local-suite-manifest.mjs]
examples: [demos/all-aboard, cloudflare/app/all-aboard.app.js]
status: current
targets: [cloudflare]
maturity: partial
reviewed: 2026-08-12
reviewed-authorities-digest: sha256:1c337a2cb1b8d1afc09c7addc6be2bd689e1fd5ac5a0e06b5a00bdfcbb526174
---

# Deploying the Cloudflare proof

Snapback's Cloudflare target is real but narrow. The All Aboard Contract app
has been deployed and remotely proven over Workers, a coordinator Durable
Object with SQLite, a separate V8 action isolate, same-origin static/native
assets, WebSocket Hibernation, deploy-time secrets, and demand-armed alarms.
It is a proof profile—not a general hosted Snapback product.

The target profile id is `cloudflare-do-sqlite-v8`. Read the deployed
`GET /capability` or `/inspect` result before relying on a feature; its explicit
`capabilityGaps` outrank assumptions from the local guide.

## Prove the profile locally first

Use the Node major pinned in `.node-version` (24.x) and the repository-locked
Wrangler:

```sh fragment reason="Canonical local Cloudflare regression commands, composed with the repository Node pin."
volta run --node 24.18.0 -- node cloudflare/test/local-suite.mjs
volta run --node 24.18.0 -- node cloudflare/test/measure.mjs
```

The suite inventories every non-remote gate; the canonical check count is
the `EXPECTED_LOCAL_SUITE_CHECKS` constant in
[`cloudflare/test/local-suite-manifest.mjs`](repo:cloudflare/test/local-suite-manifest.mjs)
(29 as of this review), and the runner asserts the executed count against it.
Miniflare validates protocol, storage, handlers, secrets, egress, cron, and
hibernation-event behavior, but it cannot prove platform eviction, placement,
or billing. Those require a real Cloudflare run.

## Understand the deployed shape

One gateway Worker routes HTTP, WebSockets, capability reads, and assets to one
named app coordinator Durable Object. That object's embedded SQLite owns:

- app and system tables;
- the per-app commit-version counter;
- change journal and storage-backed subscriptions;
- connection grants and cron/config state.

A mutation commits version, rows, and journal in one `transactionSync`. Live
fan-out happens directly from that commit—there is no polling tailer. App code
is compiled into the Worker at deploy time because deployed Workers forbid
dynamic evaluation; changing schema/handlers is a redeploy, not a bundle load.

Handlers run through the stripped, single-sourced V8 harness. Queries and
mutations receive only generated `ctx` powers. Actions run in a separate
handler Worker so a slow external fetch cannot queue the coordinator's
transactional work.

## Deploy All Aboard

Deployment mutates a real Cloudflare account. Use a Workers + Durable
Objects-scoped token and an independently generated admin token; never commit
either:

```sh fragment reason="All Aboard selection added to the canonical cloudflare/README.md deployment sequence."
bun install --frozen-lockfile
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
export SNAPBACK_ADMIN_TOKEN=...
SNAPBACK_CF_APP=all-aboard ./cloudflare/deploy.sh
```

The script builds the same-origin Contract/native bundle, verifies the
repo-local Wrangler and locks, deploys handler dependencies before the gateway,
attests the exact active Worker version, and performs the final gateway deploy
after secret changes. On a partial failure it attempts to restore previously
active Worker versions; ambiguous account/API state fails closed.

On success, the script emits exactly one JSON line with
`schemaVersion: snapback.cloudflare-deploy-receipt.v1`. The receipt names each
Worker and its exact activated version, the probe URL, final health code, and
the actions this run took. Validate or retain it using
`schemas/cloudflare.deploy-receipt-v1.schema.json`; ordinary progress lines are
not deployment evidence.

An absent local `SNAPBACK_ADMIN_TOKEN` is not evidence that the remote secret
is absent. Deployment reports absent, present-and-preserved, or unknown; only
`SNAPBACK_ADMIN_TOKEN_REMOVE=1` requests attested removal.

## Configure declared secret pools

All Aboard declares `caltrainFeed` and `directions`. Send one JSON object of
non-empty string arrays over stdin, never in argv or shell history:

```sh source=cloudflare/README.md
SNAPBACK_ADMIN_TOKEN=... node cloudflare/config-set.mjs \
  --url https://snapback-all-aboard-proof.<subdomain>.workers.dev \
  --entries-stdin < /secure/path/to/secret-pools.json
```

`config-set.mjs` reads the current generation, writes changed bindings plus a
new `SNAPBACK_CONFIG_GENERATION` in one `wrangler secret bulk` activation, then
polls authenticated `/_snapback/api/config/status` (the hosted system surface
lives under `/_snapback/*`) until that generation and member counts are
attested as applied. It refuses value-bearing argv flags. Status returns
names, set/missing state, counts, and grant relationships—never values.

App actions receive descriptor handles only. Values unwrap at the coordinator's
host-fetch boundary into declared query-parameter or header slots:

```js source=cloudflare/app/all-aboard.app.js
  const response = await ctx.fetch({
    url,
    headers: { Accept: 'application/json' },
    timeoutMs: 15_000,
    secretSlots: [{ placement: 'query-param', name: 'api_key', handle }],
  });
```

Ambient `fetch`, `.expose()`, and `.asBearer()` stay unavailable in the app
isolate. The host validates HTTP(S), descriptor ownership and placement,
enforces action/fetch deadlines and bounded response bodies, and redacts secret
values before any response or diagnostic re-enters app code. The outbound
floor also refuses credentials in URLs, metadata/localhost hostnames, and
non-public IPv4/IPv6 literals; redirects are manual and refused. Workers does
not expose a DNS-resolution-and-pinning primitive, so a public-looking hostname
that resolves or rebinds to a private address remains a named residual. This is
not a general egress claim: the two All Aboard placement shapes are proven, but
a destination allowlist is still a declared gap.

The app-data boundary is separately fail-closed. Only functions whose compiled
entry explicitly says `authRequirement: 'public'` admit an anonymous request.
Every other query, mutation, or action requires either
`x-snapback-admin-token` or the id/token pair issued by
`POST /connection/open`. A connection grant is a scoped request capability,
not hosted user authentication; handlers still receive an anonymous authority
projection, and the profile continues to report hosted auth unavailable.

## Run the remote proof

After secrets are applied, run the real-deployment acceptance:

```sh fragment reason="All Aboard remote acceptance invocation from the runner header."
SNAPBACK_PROOF_URL=https://snapback-all-aboard-proof.<subdomain>.workers.dev \
SNAPBACK_ADMIN_TOKEN=... \
  node cloudflare/test/acceptance.remote.all-aboard.mjs
```

It proves cold start, same-origin Contract/native assets, ensure/seed, config
attestation, finite queries and mutations, real hibernating WebSocket push,
live 511/directions actions, demand-armed warm polling, eviction recovery, and
secret redaction. Expect minutes rather than seconds because it waits for a
real scheduled cycle.

For the notes proof, `cloudflare/test/acceptance.remote.mjs` additionally
records connected-idle billing windows and platform-eviction evidence. Cloudflare
analytics may settle several minutes later; re-read the emitted window before
calling observed-zero usage final.

## Hibernation, reconnect, and idle-to-zero

Server-held sockets use the Durable Object WebSocket Hibernation API. Durable
subscription rows, not isolate memory or socket attachments, are the recovery
authority. After wake/eviction, the object rehydrates them; socket loss takes a
fresh snapshot-with-subscribe. Retained-version resume and HTTP outbox delta
polling are explicit gaps.

The hosted kit socket's in-band durable surface is independently governed:
`live.kit-socket-request.schema.json` covers `subscribe`, `unsubscribe`, and
`ping`; `live.kit-socket-reply.schema.json` covers the actually served
`pong`, `snapshot`, `current_as_of`, and `error` frames. Unsubscribe is
deliberately silent. The Cloudflare wire-schema gate validates real reply bytes
against that Rust-derived contract; the older proof socket's `type`-tagged
frames are a separate pinned protocol.

The coordinator uses no always-awake interval. All Aboard's `warmPoll` is a
single Durable Object alarm dispatcher job:

- first live demand arms the alarm;
- the last unsubscribe cancels it;
- `(jobName, scheduledAt)` durable claims make alarm retry idempotent;
- an app with no subscribers schedules zero warm-poll wakeups.

Real settled evidence includes a two-hour no-demand interval with observed-zero
request/execution estimates and hibernating connected-idle measurements. This
supports the narrow proof's idle-to-zero claim; it is not a scale or price
guarantee for arbitrary apps.

## Exact supported subset and non-claims

The manifest currently claims V8, Durable Object SQLite, serialized mutation
commits, syncable/online single-table queries, replace-only live subscriptions,
the witnessed outbound-action shapes, and demand-armed cron. Enforced limits
include row/storage size, wall-clock/CPU, and subscription counts.

It explicitly does **not** claim:

- hosted authentication (only `authMode: dev` is supported);
- offline retention/replay or optimistic replay: the manifest reports
  `offline_mutation_replay` as a gap because the coordinator has no
  client-mutation settlement ledger. Accordingly, `SnapbackClient` treats
  default `queue: 'auto'` as fail-loud/no-enqueue after an ambiguous transport
  failure, and explicit queueing or draining an existing outbox refuses with
  `SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED`;
- ephemeral realtime rooms;
- generalized outbound actions or an egress destination allowlist;
- calendar/Cron Trigger schedules;
- R2 asset upload, notifications, Postgres, code hot-load, untrusted hosted
  tenant code, multiple apps per deployment, or a hosted marketplace;
- the local served-discovery surface: `/llms.txt`, `/_snapback/guide*`,
  `/_snapback/api/control-catalog`, and host-operation discovery are not
  hosted claims when `operatorSurface` is disabled; use the pinned checkout
  or published guide instead;
- local pages whose `targets:` omit `cloudflare`.

An unimplemented path inside a reserved app-data namespace must not be
mistaken for a web page. When Workers Assets answers such a miss with its SPA
`200 text/html` fallback, the gateway converts it to HTTP 501 with the
versioned `SNAPBACK_ROUTE_UNSUPPORTED_ON_TARGET` JSON diagnostic. This is an
honest target refusal, not evidence that the route is available under another
hosted path.

See [auth target honesty](../auth/targets.md) before exposing this deployment
to users. The local bearer/dev identity posture is not production hosted auth.

## Anti-patterns

- **Do not call the proof a general Cloudflare target.** Inspect its manifest
  and keep every gap visible.
- **Do not deploy with an unlocked/ad-hoc Wrangler or `npx`.**
- **Do not pass secrets in argv, config files, logs, or app-visible errors.**
- **Do not add interval polling to keep the object warm.** Use hibernation and
  the one demand-armed alarm dispatcher.
- **Do not infer a successful local suite proves billing or eviction.** Run the
  remote evidence lane.

---

<!-- snapback-guide-source: guide/deploying/hosted-control.md -->
---
title: Inspect hosted control
id: deploying.hosted-control
order: 3
audience: agent-first
capabilities: [deploy.target-control]
authorities: [llp/0111-fly-completion-and-hosted-ephemeral.plan.md, packages/snapback-cli/hosted-control.mjs, packages/snapback-cli/index.mjs, issues/20260728-hosted-lifecycle-carrier-and-custody-gap.md]
examples: []
status: current
targets: [all]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:6cb04e0ad71393216ec57d648a10ccc352a99e73955a5684e96ae8700caeef99
---

# Inspect hosted control

The packaged `snapback hosted` surface is present, but its provider-mutating
lifecycle is intentionally disabled. Planning and bounded reads work against
the retained control-plane contracts; lifecycle commands publish the exact
future vocabulary while refusing every effect before credentials or provider
I/O.

## Use the available read surface

The closed command registry begins with three non-lifecycle entries:

- `snapback hosted plan [--target <id>]` renders the package-owned driver,
  schema identities, availability, required evidence, and complete command
  inventory.
- `snapback hosted inspect --target <id>` reads bounded authenticated target
  inspection through the existing control plane.
- `snapback hosted logs --target <id>` reads bounded retained logs and supports
  the documented time, limit, and cursor bounds.

`snapback hosted operator-request` is the separate signed, certificate-pinned
supervisor transport command. Its existence does not enable lifecycle effects:
the lifecycle gate returns before transport submission.

## Read the complete lifecycle registry

`snapback hosted lifecycle --help` lists all 17 closed verbs. They are:

1. `acquire-lease`
2. `renew-lease`
3. `upload-immutable-release`
4. `provision-inactive`
5. `compatibility-preflight`
6. `create-verified-backup`
7. `stage-release`
8. `activate-generation`
9. `verify-served-path`
10. `rollback`
11. `fence-external-effects`
12. `restore-backup-inactive`
13. `verify-restored-components`
14. `verify-restored-application`
15. `activate-restored-generation`
16. `reconcile-effect`
17. `release-lease`

Unknown verbs fail as `SNAPBACK_HOSTED_LIFECYCLE_VERB_UNKNOWN`; a valid verb
with a valid V2 request returns the structured
`snapback.hosted-lifecycle-refusal.v1` envelope with
`SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE`. Its `recommendedNext` uses the
catalog refusal shape—`owner`, `ticketOrDesignPointer`, and `note`—and points
to the [hosted lifecycle carrier and custody GAP](repo:issues/20260728-hosted-lifecycle-carrier-and-custody-gap.md).

## Understand what must land before enablement

The blocker is not merely a missing executor. The current V2 carrier cannot
express the operation-specific authority and recovery facts required for safe
effects, and `releaseLease` is not an exception. Enablement requires all of:

- a separately reviewed closed per-operation carrier;
- Rust-owned schemas with exhaustive registry and unknown-field tests;
- supervisor-only opaque lease custody bound to expiry, provider version,
  supervisor generation, and control head;
- bootstrap, purpose-key custody, public mTLS listener, and wrong-role proofs;
  and
- a packed live Fly/Tigris journey covering reservation, interruption,
  recovery, head CAS, and zero premature capability advertisement.

Until the tracking ticket meets those criteria, availability stays `disabled`
for every lifecycle entry.

## Anti-patterns

- **Do not infer a listed lifecycle verb is usable.** Registry membership
  preserves vocabulary; `availability: disabled` is authoritative.
- **Do not special-case `release-lease`.** It shares the same carrier and
  opaque-custody blocker as the other 16 operations.
- **Do not supply provider credentials directly to the CLI.** Fly and Tigris
  authority belongs behind the supervisor/adapter boundary.
- **Do not call `hosted plan` a deployment plan.** It describes the closed
  hosted command surface; it performs no provider mutation.
