# LLP 0072: Trusted single-tenant control plane

**Type:** RFC
**Status:** Draft
**Systems:** Deployment, Control plane, TLS, Auth, Migrations, Backup, Restore, Logs, Inspection, Secrets, Runtime, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-24 (same-landing amendment for the acceptance of LLP 0081: the rollback posture set gains the `generationRepublish` row — the maintenance-window predecessor republish defined by LLP 0081 §6, distinct from a data rewind because nothing outside the migration fence observed the successor); 2026-07-20 (initial proposal for LLP 0063's hosted minimum profile)
**Related:** LLP 0002, LLP 0007, LLP 0009, LLP 0012, LLP 0014, LLP 0017, LLP 0018, LLP 0023, LLP 0024, LLP 0030, LLP 0031, LLP 0036, LLP 0041, LLP 0046, LLP 0047, LLP 0057, LLP 0060, LLP 0062, LLP 0063, LLP 0070, LLP 0071

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
fields.

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

The first implementation should choose exactly one hosted adapter before this
RFC becomes Accepted. Candidate choices are the existing Cloudflare path under
LLP 0014 or a single-instance container/VM path. The choice must be recorded in
this RFC, including region, storage, TLS, process supervision, artifact store,
log sink, backup store, credential backend, cost boundary, and why its drill is
representative. A local process behind a developer tunnel is not eligible.

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

While this RFC is Draft and no first adapter is chosen and witnessed,
`trusted-single-tenant-app-complete.v1` remains unsupported. Documentation,
local dev, or an API-only deploy is not Step 6 evidence.

## Open questions

1. Is Cloudflare or a single-instance container/VM the first complete hosted
   adapter?
2. Which artifact-signing and external backup stores are mandatory for the base
   profile rather than reported opt-ups?
3. What measured downtime ceiling should the first profile declare?
4. Which control-plane credential store and agent grant format should be the
   paved local operator experience?
