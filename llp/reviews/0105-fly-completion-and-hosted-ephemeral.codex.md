# LLP 0105 review — Codex family


## Round 1 — 2026-07-27

**Reviewer family:** OpenAI Codex
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`
**Reasoning effort:** ultra
**Date:** 2026-07-27
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule
**Target SHA-256:** `5b106fe0dcbdee00b3727d1442d8033ca3f214a3a8b74009f2f92445c01fe31d`
**Capsule SHA-256:** `07aa9f210dd98c5ba7803ab963cf21270abdeffb54fcf9f93d4cb6aa035cd06e`
**Instruction SHA-256:** `9f68f158fd2807c25e5bddec20be40953470728bff2102502109d9d828dff8ce`
**Status:** completed

## 1. Overall assessment

Reviewed target SHA-256 `5b106fe0dcbdee00b3727d1442d8033ca3f214a3a8b74009f2f92445c01fe31d`.

The core design is defensible: one continuously exclusive routed process can safely host process-memory ephemeral state, and a fresh process-boot identity is the right boundary for restart loss. LLP 0105 also preserves the correct nonclaims.

The Plan is not ready, however. Its safety depends on mechanisms that are either unspecified or cannot be expressed through the current closed contracts: continuous routing authority, predecessor/successor head transfer, must-understand wire fencing, migration admission/resume, commit-uncertain lifecycle results, certificate custody on fresh-volume restore, pre-effect spend authority, and protocol-level cleanup.

## 2. Strengths

- The target is deliberately narrow: one routed Machine, bounded downtime, no HA, autoscaling, multi-region, durable presence, or managed SLA. Capability remains unavailable until evidence lands. [LLP 0105 summary and nonclaims](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:13)

- Random, non-authorable `processBootId` is the correct way to prevent restarted room epochs from being compared with their predecessors. Graceful notification is helpful but correctly not relied upon for crash safety. [Authority identity](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:85)

- The persistence exclusions are unusually exact: room maps, queues, rate buckets, boot IDs, and values are excluded from SQLite, volumes, backup, restore, migration, RQS, offline storage, and export. That aligns with LLP 0013’s durable-sync boundary. [Loss and nonclaims](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:138), [LLP 0013 exclusions](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0013-ephemeral-realtime-state.rfc.md:597)

- Auth invalidation, TTL, bounded queues, coalescing, structured failure, and durable-lane priority are inherited rather than forked. The proposed corpus covers auth loss, overflow, durable latency, process loss, restore exclusion, and split-routing refusal. [Conformance corpus](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:302)

- Selecting a target-neutral sticky-memory profile is consistent with LLP 0026’s Phase 4 acceptance requirements: same client surface, two-client convergence, split-routing refusal, resync/republish after restart, and inspection facts. [LLP 0026 Phase 4](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0026-ephemeral-backend-abstraction.plan.md:531)

- The product journey is finite in intent and includes backup, executed restore, rollback, cost, cleanup, and an explicit ban on fixture evidence satisfying remote rows. [Product journey](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:277)

## 3. Concerns

### 1. Critical — MATERIAL — Routing exclusivity is observed, not continuously enforced

**Evidence**

The Plan re-reads the roster during activation and says capability becomes false before later ephemeral operations, but defines no expiring fact, refresh path, runtime gate, or final-send check that makes this continuous. [Routing and activation](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:118)

The current driver derives the app from the hostname, chooses the first started Machine or simply the first Machine, and emits one `resourceId`; it does not reject additional Machines or describe routes, process groups, autostart, or autoscaling. [Current Fly observation](/private/tmp/snapback-llp0105-r1.s3GYjd/packages/snapback-cli/adapters/fly-machines-vm-driver.mjs:113), [observation validation](/private/tmp/snapback-llp0105-r1.s3GYjd/packages/snapback-cli/deployment-control.mjs:1262)

LLP 0098 already identifies a silently started second process as fatal to this profile. [LLP 0098 warning](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0098-hosted-edge-adapter.spec.md:483)

Current Fly documentation exposes cordon/uncordon effects, but its documented Machine properties do not expose an equivalent cordon-state field. Fly Proxy can also start a stopped or suspended Machine when autostart is enabled. Thus “exactly one routed” is not yet a proven read-back predicate. [Fly Machines API](https://fly.io/docs/machines/api/machines-resource/), [Fly Proxy autostart](https://fly.io/docs/reference/fly-proxy-autostop-autostart/)

**Resolution criteria**

- Define a closed routed-roster predicate covering all Machines, service mappings, process groups, health admission, stopped-but-autostartable Machines, and policies capable of creating or routing another Machine.
- Provide either an app-wide provider-enforced creation/routing fence or a short-lived signed routing authority checked at connection grant, subscribe, publish/delete, drain, and final frame send.
- On expiry or drift, withdraw hosted-ephemeral capability, stop admission, fence existing sockets, and clear clients.
- Remotely introduce a second routed or autostartable Machine after healthy activation and prove established and new operations fail closed.

### 2. Critical — MATERIAL — Restore cutover lacks a safe route, socket, and control-head handoff

**Evidence**

`restoreActivate` removes the predecessor route, routes the successor, opens admission, and only then retires the predecessor. Route removal is not shown to terminate established predecessor WebSockets, so two memory authorities may remain usable during cutover. [Restore activation](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:248)

LLP 0072 places the sole authoritative head in the exact Machine’s metadata and requires lease/current-version serialization. It explicitly says failure to preserve the head through replacement invalidates the profile. [Fly/Tigris authority](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0072-trusted-single-tenant-control-plane.rfc.md:224)

The current lease and observation contracts do not carry both predecessor and successor identities, provider versions, route state, or head digests. Moreover, Fly’s documented metadata and cordon examples omit the lease-nonce guard used by full Machine updates, making metadata bypass and route serialization unproven. [Lifecycle response schema](/private/tmp/snapback-llp0105-r1.s3GYjd/schemas/vm-adapter.lifecycle-response.schema.json:205), [Fly Machines API](https://fly.io/docs/machines/api/machines-resource/)

**Resolution criteria**

- Specify every durable predecessor-head/successor-head and route state, including recovery after lost responses.
- Withdraw predecessor ephemeral capability, close admission, send the boundary, force-close/drain sockets, and stop the predecessor before successor capability becomes true.
- Prove zero predecessor sockets and no predecessor effect authority before opening the successor.
- Retain live contention, expiry, stale-version, metadata-bypass, and route-readback evidence.
- If Fly cannot provide a safe authority handoff, move the canonical head to a stable external single-writer authority and account for its cost and availability.

### 3. Critical — MATERIAL — The lifecycle mapping does not fit the existing closed protocol

**Evidence**

The Plan promises no private dialect but names `rollbackGeneration`, `restoreInactive`, and `restoreActivate`; v1 admits only `rollback`, `restoreBackupInactive`, and `activateRestoredGeneration`. [Plan mapping](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:177), [closed operation enum](/private/tmp/snapback-llp0105-r1.s3GYjd/schemas/vm-adapter.lifecycle-request.schema.json:3)

Restore promises fresh stream, restore, admission, and ephemeral authorities, while the current validator requires destination database and stream identities to equal the immutable destination descriptor. [Restore semantics](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:234), [restore validator](/private/tmp/snapback-llp0105-r1.s3GYjd/packages/snapback-cli/deployment-control.mjs:2254)

`stageRelease` is supposed to persist a migration approval, but the request carries no LLP 0099 approval/admission/rehearsal artifact or target-owned executor job. LLP 0099 requires durable target-side enqueue/resume; the CLI may only submit, observe, or cancel. [LLP 0099 executor contract](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0099-container-vm-migration-executor-profile.spec.md:83)

The declared idempotence tuple is unstable: `inputSha256` includes `attempt`, lease, and an absolute local path, while resume increments `attempt`. The response has only `ok`, so it cannot report commit-uncertain reconciliation. The controller also automatically rolls back after any later failure, including after public effects may have opened, contrary to LLP 0072. [Lifecycle invocation](/private/tmp/snapback-llp0105-r1.s3GYjd/packages/snapback-cli/deployment-control.mjs:2276), [resume and rollback](/private/tmp/snapback-llp0105-r1.s3GYjd/packages/snapback-cli/deployment-control.mjs:3529)

**Resolution criteria**

- Version the descriptor, plan, lifecycle request/response, observation, receipt, and restore-translation contracts where v1 is insufficient.
- Use exact operation names or normatively map every semantic name to one existing operation.
- Introduce stable per-step effect identities and semantic digests excluding retry metadata, leases, and local paths.
- Represent ambiguous/commit-uncertain outcomes and reconcile provider/control facts before stale-plan rejection or another effect.
- Carry migration approval, admission, rehearsal, executor job, checkpoint, and terminal receipt identities.
- Record the effect-open boundary durably; failures after it become degraded and require fresh authority rather than automatic rollback.
- Inject interruption before and after every provider write, migration transition, head update, route change, backup, restore write, and lease release.

### 4. High — MATERIAL — The authority wire transition and client recovery contract are incomplete

**Evidence**

The Plan says old clients and servers fail capability negotiation but defines no new wire token, offer/echo, or refusal matrix. `snapback.v1` currently covers the entire connection-scoped surface; `ConnectionGrant` and ephemeral HTTP outcomes are open, so old clients may silently ignore additive authority fields. [Governing amendment](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:34), [LLP 0094 closure matrix](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0094-wire-envelope-contract.spec.md:651)

Only snapshot/upsert/remove/resync frames are authority-bound. Requests, publish/delete results, socket acknowledgements, and errors are omitted, permitting predecessor responses to arrive after a successor grant. [Authority identity](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:104)

“Current after republish” does not distinguish observer currentness from publisher currentness or define a callback, ownership race, or acknowledgement rule. The Contract adapter also deliberately retains expired entries while stale/disconnected, contrary to LLP 0013’s universal TTL backstop. [Contract TTL behavior](/private/tmp/snapback-llp0105-r1.s3GYjd/packages/snapback-contract/index.mjs:3225), [LLP 0013 TTL rule](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0013-ephemeral-realtime-state.rfc.md:194)

Finally, the sample grant exposes raw Machine and boot IDs while the stated custody rule says those require gated inspection. [Grant and custody](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:87)

**Resolution criteria**

- Define a new wire token or must-understand authority offer/echo with an old/new client/server cross-product.
- Specify the digest algorithm, domain separator, canonical bytes, textual encoding, and equality rules.
- Bind every request and every success/error/acknowledgement to the expected authority or exact grant lineage.
- Define fresh-snapshot observer currentness separately from authority-acknowledged publisher currentness and provide a first-party republish registration contract.
- Enforce TTL expiry in live, stale, disconnected, partitioned, and authority-loss states across every shipped client arm.
- Publish an explicit custody matrix; ordinary grants should preferably receive only the opaque authority digest.

### 5. High — MATERIAL — Fresh-volume restore does not preserve TLS or hosted-auth custody

**Evidence**

Ordinary replacement relies on reattaching the volume containing `/data/caddy`, but destructive restore creates a fresh volume and restores only SQLite and protected artifacts. No source is named for Caddy’s account, certificate, and private key. [Backup and restore](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:215), [TLS custody](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:258)

Fly Volumes are local to one physical server and attach one-to-one with Machines; a fresh volume is not an automatic continuation of the old one. [Fly Volumes](https://fly.io/docs/volumes/overview/)

The existing fixture stores hosted admission under `/data`, while the proposed volume layout moves durable state under that namespace. That risks retaining restore-invalid authority unless runtime projections move to `/run`. [Current entrypoint](/private/tmp/snapback-llp0105-r1.s3GYjd/demos/competitive-checkpoint/acceptance/hosted-edge/entrypoint.sh:25)

The five-minute hosted-admission renewal path also remains provider-unowned in the current guide, and LLP 0105 does not assign its Fly supervisor, delivery channel, key/floor rotation, or failure recovery. [Hosted admission guide](/private/tmp/snapback-llp0105-r1.s3GYjd/guide/deploying/releases.md:261)

**Resolution criteria**

- Separate in-place update, same-volume Machine replacement, and fresh-volume destructive restore as distinct lifecycle trains.
- Define either a separately encrypted/permissioned Caddy-state restore component or an exact reissuance mechanism with limits, credentials, and failure posture.
- Define a digest-pinned non-routed restore helper that mounts and writes the fresh volume.
- Keep admission/key projections in non-backed-up runtime storage and rotate all restore authorities.
- Assign hosted-admission renewal custody and prove operation beyond the renewal interval, expiry withdrawal, replacement, and recovery.
- Prove certificate account/key continuity—or explicitly narrow the claim to reissuance—without relying on a staging certificate as proof of production TLS.

### 6. High — MATERIAL — Exact resource and credential binding cannot be represented

**Evidence**

The Plan requires registration to pin app, roster, Machine, volume, certificate, image, route, registry, and Tigris identities. The closed descriptor carries only provider/account/region/origin plus one credential and state-store reference. [Target binding requirement](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:73), [descriptor schema](/private/tmp/snapback-llp0105-r1.s3GYjd/schemas/target.descriptor.schema.json:16)

The current driver instead discovers the app from the hostname and selects one Machine. The current Tigris witness consumes ambient AWS credentials inside the application Machine, without role separation for backup, artifacts, control state, audit, logs, registry, or cleanup. [Fly driver](/private/tmp/snapback-llp0105-r1.s3GYjd/packages/snapback-cli/adapters/fly-machines-vm-driver.mjs:113), [Tigris witness](/private/tmp/snapback-llp0105-r1.s3GYjd/demos/competitive-checkpoint/acceptance/drill/backup-to-tigris.sh:15)

**Resolution criteria**

- Add a versioned Fly binding for organization/app, active incarnation, complete roster, volume, services/routes, autoscale posture, registry, bucket/prefixes, issuer, and ownership provenance.
- Model replaceable Machine identity in the external head rather than mutating an immutable target identity silently.
- Define separate credential handles and fingerprints for Fly control, registry, artifact, backup, control, audit, logs, admission, replay floor, and cleanup.
- Prove cross-role denial and eliminate hostname/first-Machine discovery from every effect path.

### 7. High — MATERIAL — Remote evidence and structured-log claims remain self-asserted

**Evidence**

LLP 0072 requires package-owned, content-addressed raw evidence and a versioned reducer; two equal reads establish stability only. [LLP 0072 remote evidence](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0072-trusted-single-tenant-control-plane.rfc.md:416)

The current verifier trusts adapter-supplied URI, digest, byte count, and `verified:true`. The driver converts two equal Machine-event reads directly into `remoteProviderAttestation`, without retaining reopenable raw responses. [Evidence validation](/private/tmp/snapback-llp0105-r1.s3GYjd/packages/snapback-cli/deployment-control.mjs:2196), [driver attestation](/private/tmp/snapback-llp0105-r1.s3GYjd/packages/snapback-cli/adapters/fly-machines-vm-driver.mjs:221)

The logs implementation reads only Machine events and asserts zero drops and no backpressure without an independent source/export counter, whereas the Plan promises structured application/control export. [Current logs](/private/tmp/snapback-llp0105-r1.s3GYjd/packages/snapback-cli/adapters/fly-machines-vm-driver.mjs:253)

**Resolution criteria**

- Define a closed raw-evidence artifact/store and versioned Fly reducer owned by the package/control plane.
- Retain request/response digests, resource/account identity, provider revision, request ID, server/capture time, credential fingerprint, TLS facts, and freshness challenges.
- Add negative tests showing canonical URLs, repeated reads, or `verified:true` cannot mint remote qualification.
- Select a real structured sink/export path with pinned credentials, retention, capacity, redaction, cost, cleanup, and independent delivered/dropped/delayed counters.
- Give `snapback.hosted-product-journey.v1` a closed schema, content identity, and independent verifier that reopens every subordinate artifact.

### 8. High — MATERIAL — The clean-package journey is not yet an executable product path

**Evidence**

The packed CLI excludes `adapters/`, despite requiring an absolute canonical driver path and digest. [Package contents](/private/tmp/snapback-llp0105-r1.s3GYjd/packages/snapback-cli/package.json:6), [driver validation](/private/tmp/snapback-llp0105-r1.s3GYjd/packages/snapback-cli/deployment-control.mjs:611)

The cold-install proof currently exercises only an activation-ineligible local package. The hosted fixture still instructs `fly deploy --remote-only` from the repository and uses mutable Ubuntu/APT/rustup/Caddy inputs. [Current Fly fixture](/private/tmp/snapback-llp0105-r1.s3GYjd/demos/competitive-checkpoint/acceptance/hosted-edge/fly.toml:11), [Dockerfile](/private/tmp/snapback-llp0105-r1.s3GYjd/demos/competitive-checkpoint/acceptance/hosted-edge/Dockerfile:18)

LLP 0105 does not choose local BuildKit versus a Fly remote builder, or account for builder resources and credentials.

**Resolution criteria**

- Pack the reviewed adapter at a stable CLI-owned path and add a public target constructor that pins it automatically.
- Run the complete hosted command family outside the repository with no sibling imports or repo-private scripts.
- Specify the OCI builder, architecture, base-image digests, dependency pins, registry authentication, immutable push/read-back algorithm, and cleanup.
- If a remote builder is used, inventory its app/Machine, spend, credentials, and retained artifacts.
- Record staged-tarball versus public-registry and same-host versus independently provisioned-machine evidence honestly.

### 9. High — MATERIAL — Spend and destructive cleanup are neither pre-authorized nor closed-protocol operations

**Evidence**

Cost is reported after deployment, backup, restore, and rollback. LLP 0072 requires a short-lived maximum-spend/destructive grant before provisioning. The current remote-drill plan intentionally has no apply path. [Plan cost reporting](/private/tmp/snapback-llp0105-r1.s3GYjd/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:273), [current guide boundary](/private/tmp/snapback-llp0105-r1.s3GYjd/guide/deploying/releases.md:125)

Restore temporarily requires predecessor and successor Machines and volumes, so “fixed one-Machine capacity” is not peak billable inventory.

The lifecycle enum contains no destroy, retire, withdraw, or cleanup operation, despite the Plan forbidding private lifecycle dialects. Cleanup also targets the fixed `snapback-drill` name without defining disposable ownership protection.

Fly itself provides no soft billing ceiling or billing alerts; volumes bill while stopped, and Tigris survives app deletion. Therefore a “configured maximum monthly boundary” can only be a Snapback refusal guard, not a provider-enforced cap. [Fly cost management](https://fly.io/docs/about/cost-management/)

**Resolution criteria**

- Require a one-use, expiring spend/destructive grant before remote build, upload, provisioning, certificate activity, backup writes, or restore.
- Bind maximum concurrent Machines/volumes, builder resources, registry/object bytes, snapshots, logs, egress, IPs, certificate attempts, and total drill cost.
- Add closed plan/confirm/apply cleanup operations and a pre-effect ownership inventory.
- Use uniquely named disposable resources or require an exact ownership sentinel before destructive action.
- Verify absence after provider convergence, revoke temporary credentials last, and emit a non-success residual-resource receipt with continuing cost if cleanup is incomplete.

### 10. Medium — DETAIL — Current acceptance schemas and accounting have concrete inconsistencies

**Evidence**

The implementation emits maintenance receipt kind `backup` and outcome `backedUp`, but the schema admits neither. [Receipt producer](/private/tmp/snapback-llp0105-r1.s3GYjd/packages/snapback-cli/deployment-control.mjs:2753), [receipt schema](/private/tmp/snapback-llp0105-r1.s3GYjd/schemas/maintenance.receipt.schema.json:124)

Adding an authority digest to every frame also changes outbox, retained-byte, and 64-KiB frame accounting, which the Plan does not mention.

**Resolution criteria**

- Align the maintenance receipt producer and closed schema and include it in package proof.
- Charge authority bytes consistently in room, queue, coalesced, snapshot, resync, and frame limits.
- Add boundary fixtures for the enlarged message forms.

## 4. Suggestions

- Add four normative tables: provider primitive/evidence, identity and credential custody, lifecycle crash recovery, and cleanup ownership/cost.
- Separate in-place update, same-volume replacement, and fresh-volume restore throughout the lifecycle and acceptance sections.
- Extend the existing remote-drill plan and package proof instead of creating parallel spend or installation dialects.
- Explicitly forbid Fly suspend for this profile, or define suspend/resume as an authority transition; Fly may preserve process memory across suspension.
- Keep raw provider evidence owner-only while publishing a separately derived redacted projection.
- Classify `snapback-drill` as either adopted infrastructure or disposable evidence infrastructure; do not let one target alternate implicitly between both roles.

## 5. Open questions

- What documented Fly fact proves a Machine is currently cordoned, and are cordon and metadata mutations fenced by the same lease/current-version authority?
- Does cordoning terminate established WebSockets, or must the predecessor be explicitly drained and stopped?
- What primitive transfers the sole control head from predecessor to successor without a dual-writer interval?
- What writes and authenticates a fresh Fly Volume before the application origin starts?
- Is Caddy state restored as separately protected key material or reissued, and what is the production-rate-limit posture?
- Who supervises hosted-admission renewal and rotates the external replay floor during replacement and restore?
- Which OCI builder and pricing source make the package and cost evidence independently reproducible?
- Does the selected Tigris credential profile provide the required conditional-create, prefix isolation, and cross-role denial semantics?

## 6. Readiness verdict

The Plan has a sound narrow objective and a credible semantic basis, but the routing, handoff, closed-protocol, wire, custody, evidence, spend, and cleanup gaps are material. They need normative resolution, versioned schemas, and interruption/provider fixtures before implementation can safely claim either completed profile.

VERDICT: NOT READY

## Post-bakeoff delta loop, round 3 — 2026-07-28

**Reviewer family:** OpenAI Codex
**Provider / runtime:** Codex subagent, `gpt-5.6-sol`
**Reasoning effort:** ultra
**Date:** 2026-07-28
**Redacted:** no
**Method:** fresh subagent, instruction-restricted to the mutually blind
structurally isolated capsule
**Target SHA-256 vector:** `de1ae53be9eea058e1c0edac95cfcef9074354c244b60af6821bdf66080ed816`
**Capsule SHA-256:** `6bd369e9b91c82bd411cc48c913e493e2f23b5651acb38754383846aa8eef904`
**Instruction SHA-256:** `35c89e6b9da1ac61666c520ab42660c6df40088d6400a83383e8c4d5696e9651`
**Status:** completed

## Overall assessment

The lockstep delta is not yet implementation-ready. It substantially improves provenance, publication ordering, migration custody, qualification authority, and operator security, but several crash/concurrency cuts still require normative invention.

## Strengths

- LLP 0041 defines a strong nine-package candidate → exact-registry proof → dependency-first/CLI-last promotion sequence, including current-default preflight and candidate/post-promotion ledger lineage.
- Qualification refines ordinary `PreparedAuthority` instead of creating a parallel identity system.
- Local source-owned publication and signed packaged attestation are correctly distinct from hosted control-head authority.
- LLP 0099 binds admission policy, verified backup/restore evidence, barrier equality, and signed cancellation generations.
- Claim-family revocation correctly avoids automatic graph rollback after successor writes.
- The documents remain honest: scheduled implementation and remote evidence are not presented as completed capability claims.

## Concerns

1. **MATERIAL · IN-DELTA — Pre-CAS qualification writes have no isolation or failure disposition.**

   LLP 0104 requires hidden served qualification to use the production parser, transaction executor, storage, and serializer, including a durable write-with-activity mutation and replay. Yet pre-CAS failure only deletes or quarantines the candidate graph. Nothing defines whether candidate schema effects or committed rows are visible to predecessor queries/live subscriptions, compatible with predecessor constraints, or removed after failed qualification.

   **Resolution criteria:** Specify either an isolated qualification database/restore identity, or a production-data protocol proving predecessor/candidate schema and write compatibility. Bind that data identity in the grant and receipt; define schema/index activation, visibility, cleanup/retention, crash recovery, and failed-qualification disposition. Tests must prove ordinary callers receive no candidate-only rows or frames before CAS.

2. **MATERIAL · IN-DELTA — The bounded-use protocol is not wire-complete or ordering-complete.**

   `QualificationUseV1` has no closed shape, encoding, size, index/nonce rules, or signature preimage. Query and mutation have a use carrier, but live subscribe and subsequent frames carry only the connection token while LLP 0104 promises nonce-addressable crash replay for every subscription/frame. Connection reopen is likewise unspecified. LLP 0058 says ordinary `PreparedAuthority` comes first while also saying failed auth consumes a reservation; credential failure cannot reach that refinement without another ordering rule. Exact qualification codes, HTTP statuses, and precedence are also left as `SNAPBACK_QUALIFICATION_*`.

   **Resolution criteria:** Define the complete `QualificationUseV1` DTO/header grammar and signature binding; a deterministic replay key for open/reopen, subscribe, and every counted frame; counter domains and exhaustion behavior; exact gate order; which failures consume; atomic journal transitions; retained-result/refusal bounds and GC; and a closed diagnostic/status/precedence matrix. Exercise duplicate, concurrent, disconnect, timeout, crash, and lost-response cases.

3. **MATERIAL · IN-DELTA — The 180-second migration ceiling cannot survive the required interruption classes.**

   LLP 0099 records process-monotonic elapsed intervals and says crash resume reconstructs the remaining budget. A stopped/rebooted/replaced VM cannot account for time spent down from those intervals; its monotonic origin may reset. Resume can therefore undercount downtime and violate both the 135-second forward cutoff and reserved recovery budget. `admissionExpiresAt` also has no consume/expiry transition, and the required action when health misses the cutoff after `published-held` is not pinned.

   **Resolution criteria:** Bind the barrier to a supervisor-signed, boot-independent deadline or conservatively exhaust the budget whenever elapsed time is uncertain. Define admission-expiry semantics and the exact 135/140/180-second transitions before and after publication, including whether an already authorized generation-republish rollback is used. Prove process kill, stop/start, suspend, replacement, partition, and long recovery without deadline reset or late publication.

4. **MATERIAL · IN-DELTA — Capability-only revocation lacks an enforceable publication cut.**

   A failed post-CAS observation merely causes the supervisor to attempt another CAS. If that CAS cannot land, no target-enforced provisional expiry returns the claim to GAP. Nor is there a claim-family epoch captured and rechecked at mutation commit, HTTP publication, live-frame send, or retained subscription rerun. “Functions immediately refuse” does not define hosted-ephemeral withdrawal or a migration already admitted under the profile.

   **Resolution criteria:** Make provisional publication self-expiring unless finalized, or provide an equivalently bounded fail-closed mechanism independent of a successful withdrawal CAS. Define monotone per-family generations captured at admission and rechecked at every externally visible cut. Pin terminal behavior for relation live subscriptions/queued frames, ephemeral rooms/sockets, and new versus already-admitted migrations. Preserve the intended no-automatic-graph-rollback rule.

5. **MATERIAL · IN-DELTA — The operator/root lifecycle is not closed by the deny-by-default registry.**

   Enrollment consumption is described, but bundle minting, certificate renewal, device revocation, root rotation, and root recovery have no exact request variants or command/scope mappings. The closed scope list contains `release.upload`, while the command registry assigns deploy apply one scope even though apply performs the upload; no command owns that listed scope. Root recovery is required but its unsealing authority and lost-root procedure are unspecified.

   **Resolution criteria:** Enumerate closed requests, commands, and scopes for bundle issuance/consumption, renewal, device listing/revocation, release upload, and root rotation/recovery. Define delegation/subset rules, signature preimages, atomic lost-response replay, certificate trust overlap, revocation behavior, and encrypted-root unsealing/recovery custody. Every operation must have exactly one unambiguous authority mapping and recovery test.

6. **MATERIAL · PRE-EXISTING — The auth-invalidation refusal has conflicting HTTP status authority.**

   LLP 0058 requires `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED` to use HTTP 503; LLP 0094’s refusal registry assigns HTTP 400 and different retry semantics.

   **Resolution criteria:** Choose one registered status/retry classification, update both documents and the schema/code registry, and add a cross-transport conformance case.

7. **DETAIL · IN-DELTA — LLP 0094 lacks the hosted-ephemeral wire amendment promised by LLP 0105.**

   The authoritative DTO matrix does not yet register `ephemeralAuthorityProtocol` or `ephemeralAuthorityInstance` across open, HTTP/socket ephemeral families, errors, acknowledgements, resyncs, and drain items.

8. **DETAIL · IN-DELTA — LLP 0058’s closed capability table does not record the two LLP 0104 IDs and their publication predicates/maturity.**

   The qualification amendment refers only to “the two named” requirements, while the allowed implementation context already contains `bounded_children_v1` and `write_activity_v1`.

9. **DETAIL · PRE-EXISTING — LLP 0058’s “current assignment” maturity prose has drifted from the code-owned registry.**

   It still calls relational-query and migration-keyset capabilities experimental, while the allowed `src/manifest.rs` context treats them as stable and carries additional experimental entries.

## Per-target readiness

| Target | Readiness |
|---|---|
| LLP 0041 | **Ready independently.** Its candidate publication and ledger boundary is implementable; downstream carrier publication remains blocked by the set-level issues. |
| LLP 0058 | **Not ready.** Qualification reservation ordering/wire semantics and the pre-existing status conflict remain unresolved. |
| LLP 0094 | **Not ready.** `QualificationUseV1`, exact refusals, and hosted-ephemeral DTO closure are incomplete. |
| LLP 0099 | **Not ready.** The crash-safe deadline and admission-expiry state machine are incomplete. |
| LLP 0104 | **Not ready.** Pre-CAS write isolation, bounded-use replay, and claim-family revocation cuts are incomplete. |
| LLP 0105 | **Not ready.** It inherits the qualification and deadline gaps and lacks closed revocation and operator/root lifecycle protocols. |

## Set-level conclusion

The package-promotion boundary is strong, and no current positive claim is overstated. However, implementing the present text would require security- and correctness-relevant choices at hidden candidate writes, use consumption, reboot-spanning deadlines, post-CAS withdrawal, and operator-root recovery. Those choices must be made in the documents before the six-file lockstep boundary is ready.

I attest that I reviewed `REVIEW_INSTRUCTIONS.md` and all six targets completely inside `/private/tmp/snapback-super-refine-delta-r3.yzhUQ5`, consulted only context files explicitly authorized there, used no network or outside repository/worktree, accessed no prior/Fable/other-reviewer output, and made no edits. The six target hashes matched before and after review.

VERDICT: NOT READY

## Post-bakeoff delta loop, round 2 — 2026-07-28

**Reviewer family:** OpenAI Codex
**Provider / runtime:** Codex subagent, `gpt-5.6-sol`
**Reasoning effort:** ultra
**Date:** 2026-07-28
**Redacted:** no
**Method:** fresh subagent, instruction-restricted to the mutually blind
structurally isolated capsule
**Target SHA-256 vector:** `41b1992927f596ce169ab5ca45432c1a03012637bce865eae9a4a7c039d87d7b`
**Capsule SHA-256:** `436a4c126895025718a26e11e0395388233a78c07b86e66d7ca2b21a0f68786e`
**Instruction SHA-256:** `d43a3c0b73e8abd4118eeb02e0b6c9aff58b30a09a7827eac998fc56277d008d`
**Status:** completed

## Overall assessment

The set is not yet implementation-ready. It establishes a strong publication DAG, preserves ordinary GAP behavior during hidden qualification, and substantially closes legacy certificate custody and hosted cleanup. However, several security- and safety-critical transitions still require implementers to invent normative behavior.

## Strengths

- LLP 0041 provides a coherent nine-package sequence: local tarball proof, candidate-tag publication, public exact-version cold proof, dependency-first default promotion, CLI-root-last promotion, and final closure verification (`0041:172-235`).
- The source-to-OCI provenance chain is explicit and binds packages, binaries, target images, supervisor images, and carrier evidence to one source SHA (`0041:225-235`).
- Candidate qualification is separated from ordinary discovery and routing; ordinary users remain GAP until carrier CAS (`0104:1412-1455`).
- Applicability is partitioned into `pureEvaluator`, `localPersisted`, and `servedHosted`, with mandatory injection matrices rather than informal exemptions (`0104:1457-1488`).
- The public journey correctly places hosted qualification receipts before npm default promotion and carrier publication (`0105:1176-1197`), avoiding a public-evidence cycle.
- The legacy Caddy transition is unusually well bounded: fixed executable and archive path, entry/size/time limits, pinned process identity, quiescence proof, trap-based recovery, native secret handling, zeroization, uncertainty reconciliation, and explicit residual-provider risk (`0105:1199-1250`).
- Cleanup distinguishes disposable hosted resources from the standing supervisor and durable evidence, and requires a delayed destruction grant after sustained post-CAS proof (`0105:1291-1322`).

## Concerns

### 1. MATERIAL / IN-DELTA — Hidden qualification lacks a closed invocation protocol

LLP 0104 defines a signed, one-use `QualificationGrantV1`, but it does not define how that grant enters HTTP query/mutation requests or WebSocket/live-query sessions, how consumption is made durable under concurrency and crashes, or how its scoped capability override joins the existing authorization gate (`0104:1412-1428, 1473-1488`).

That omission crosses existing closed boundaries:

- LLP 0058 requires every function entry path to pass through `PreparedAuthority` and `PreparedInvocation`, with no unregistered gate path (`0058:1177-1215, 1223-1247`).
- LLP 0094 requires new client-visible routes to join the route matrix and already distinguishes HTTP and live/connection authority (`0094:136-158, 222-227`).
- LLP 0104 nevertheless refers only generically to “qualification headers” (`0104:1488`).

The pre-CAS receipt also calls the tested identity the “active-generation” identity (`0104:1482`), although the candidate is expressly not active until carrier CAS. That leaves candidate-versus-predecessor binding ambiguous.

Resolution criteria:

- Specify the exact Rust-owned grant carrier for HTTP and WebSocket/live traffic, including encoding, size limits, signature/key identifier, request/session binding, and refusal behavior.
- Register every qualification entry path in the existing route and gate registries.
- Define an explicit candidate-scoped override inside `PreparedInvocation`; it must not alter ordinary target discovery or active-generation capability state.
- Define atomic budget/one-use consumption for successful, failed, concurrent, disconnected, and crash-replayed mutation and subscription attempts.
- Bind the pre-CAS receipt to `candidateGeneration` and separately record the predecessor active generation.
- Add negative tests proving ordinary callers, stale sessions, replayed grants, wrong function IDs, and wrong candidate digests remain GAP.

### 2. MATERIAL / IN-DELTA — Local/package carrier authority is undefined

The hosted carrier is signed by the standing supervisor and committed through the hosted control head. LLP 0104 then says local/package targets use “the same carrier shape” with a source-committed qualification receipt, but it does not identify the signer, trust root, authoritative head, CAS rule, replay rule, or revocation mechanism for those targets (`0104:1430-1455`).

Because local persisted and pure evaluator applicability is mandatory, this is not an optional implementation detail. An implementation must currently invent what makes a local positive capability claim authoritative.

Resolution criteria:

- Define either a distinct local carrier or a complete local interpretation of `CapabilityPublicationV1`.
- Specify its signer and trust root, canonical bytes, package/binary digest binding, authoritative generation, CAS or immutable-source commitment, replay protection, revocation, and rollback behavior.
- State exactly how the code-owned target capability registry derives positive local support from it without accepting candidate artifacts as authority.
- Test tampered carriers, carriers from another binary, stale generations, old package closures, and rollback after a failed public observation.

### 3. MATERIAL / IN-DELTA — Migration admission and checkpoint ordering is cyclic

LLP 0099 says admission is durably enqueued before any physical step and binds the required backup (`0099:94-98, 232-238`). The same controlling section requires the backup to be complete, read back, restored, and verified before admission (`0099:262-267`).

The governing executor sequence instead places the fence before backup and migration work (`0081:349-351, 460-469`). The current text therefore does not establish whether the backup occurs outside admission, under an admitted job, or under a preliminary fence, nor how source-head drift between backup and admission is prevented.

Resolution criteria:

- Choose one canonical order and state it as a closed state machine.
- If backup precedes admission, define the preliminary fence/lease that prevents source drift and clarify that backup creation is not the prohibited migration physical step.
- If admission precedes backup, bind admission initially to a backup policy and require a signed supplemental checkpoint before the first schema/data batch.
- Define re-admission behavior when source head, schema, lease, or backup identity changes.
- Cover cancellation and crashes before, during, and after backup, with idempotent receipt linkage.

### 4. MATERIAL / IN-DELTA — The 180-second downtime ceiling cannot be enforced as written

Downtime is measured until either successor publication becomes healthy or predecessor reopen becomes healthy. Yet abort begins only after the deadline is reached, at the next safe checkpoint, and predecessor reopen occurs afterward (`0099:252-260`). Thus a failed run can necessarily exceed the stated ceiling.

A rehearsal p95 plus 50% margin is an admission heuristic, not a hard upper bound. The text also provides no maximum batch duration or reserved abort/reopen budget. Cancellation is authoritative in the external supervisor database (`0099:240-248, 279-283`), but the target-side rule does not explicitly define how fresh cancellation state reaches every checkpoint and the final publication barrier during a partition.

Resolution criteria:

- Reserve a measured worst-case abort-and-reopen budget inside 180 seconds and set the forward-execution cutoff earlier by that amount.
- Give every batch a hard interruptible bound or prove a smaller non-interruptible maximum.
- Define persisted monotonic timing and crash-resume accounting.
- Treat rehearsal statistics only as admission evidence, not enforcement.
- Define a signed cancellation generation or head transition that the target must freshly prove at every checkpoint and immediately before publication.
- Specify partition behavior, lost cancellation responses, and reconciliation after uncertain reopen/publication outcomes.

### 5. MATERIAL / IN-DELTA — Enrollment bootstrap and scope enforcement are not closed

LLP 0105 defines device keys, a one-use ten-minute enrollment bundle, operator certificates, mTLS, request signatures, and a command-to-authority table (`0105:1252-1289`). It does not define:

- who signs and issues the enrollment bundle;
- the trust root and canonical signed bytes;
- where one-use consumption is atomically recorded;
- certificate renewal, revocation, and recovery;
- the closed scope vocabulary and exact command-to-scope mapping;
- replay behavior across supervisor recovery.

Those are root authorization semantics, not merely wire implementation details. The table also calls reads “supervisor-signed read request” (`0105:1276`), contradicting the preceding rule that every request carries the device-key signature.

Resolution criteria:

- Define canonical Rust-owned schemas and signature preimages for bundles, certificates, and requests.
- Bind issuance to an identified standing-supervisor root and define the authorized minting path.
- Atomically consume bundle nonce state in the durable external anchor.
- Define renewal, expiry, revocation, key compromise, supervisor recovery, and replay behavior.
- Introduce a closed scope enum and exhaustive command-to-scope registry with deny-by-default tests.
- Correct the read path to device/operator-signed request and supervisor-signed response.

## Detail concerns

- **DETAIL / IN-DELTA:** LLP 0099 retains open questions about cancellation, downtime, checkpointing, and receipts after its controlling amendment says those questions are closed (`0099:285-318`). Mark them historical or replace them with pointers to the controlling decisions.
- **DETAIL / IN-DELTA:** Clarify whether per-entry GAP behavior in LLP 0105 applies only to later validation/revocation or also permits partial initial publication; the executable first-publication sequence currently requires all hosted receipts (`0105:1158-1190`).
- **DETAIL / PRE-EXISTING:** LLP 0041’s status section first says the public workflow has not run, then says it was executed successfully (`0041:417-424`). Reconcile the stale status prose.

## Per-target readiness

- **LLP 0041: READY with editorial cleanup.** Its controlling publication and provenance sequence is sufficiently closed; the contradictory historical status text is not an implementation blocker.
- **LLP 0099: NOT READY.** Admission/checkpoint ordering and enforceable downtime/cancellation semantics remain materially ambiguous.
- **LLP 0104: NOT READY.** Qualification transport/consumption and local carrier authority are not closed.
- **LLP 0105: NOT READY.** It inherits the 0099/0104 gaps, and its public enrollment root and scope enforcement require additional normative decisions.

## Set-level conclusion

The set has the right high-level release order and contains strong custody, provenance, and recovery work. It should not yet authorize implementation or public promotion because the remaining gaps occur precisely at hidden capability admission, persistent publication authority, migration rollback timing, and operator-root authentication. Resolve the five material items together, then re-review the combined state machine and negative-test matrix.

Capsule restriction attestation: I reviewed only files inside `/private/tmp/snapback-super-refine-delta-r2.tHDmV7`. I did not access the source worktree, network, prior or peer reviews, journals, orchestrator notes, or Fable, and I made no edits.

VERDICT: NOT READY

## Round 2 — 2026-07-27

**Reviewer family:** OpenAI Codex
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`
**Reasoning effort:** ultra
**Date:** 2026-07-27
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule; delta-round instructions
**Target SHA-256:** `0f7821dc7919abf69441d59efdce93a6f5b913b525a48676d0a710f8ae7fcf5a`
**Capsule SHA-256:** `fc466535fd68c2ccd57b6da2b02c2f6cb2dc0eb4d981a6981842ec0e5a6c9337`
**Instruction SHA-256:** `6477ff4e3c091e39585f6aa255969e18828c3f05e8ef6daac36218e5ee620f35`
**Status before launch:** pending

**Status:** completed
**Verdict:** NOT READY

## Overall assessment

LLP 0105 is substantially stronger and finite in feature scope: one routed Machine, explicit nonclaims, downtime restore, bounded admission, packed OCI evidence, and closed cleanup intent. It is not yet finite at the authority/protocol seams. Several normative claims either contradict landed schemas or omit the state machine needed to select one safe implementation.

I treated the final author reconciliation as normative and did not consult prior reviews or journals. Applying the detail-horizon rule, I did not count command spelling, retry timing, or provider tuning unless it affects authority, wire compatibility, or recoverability.

## Strengths

- The single-routed-Machine eligibility rule is clear and honestly excludes HA, autoscaling, and multi-region inheritance.
- `ephemeralAuthorityInstance` has a domain-separated, canonical digest and reuses the never-reused issuer identity without exposing provider topology.
- Authority change correctly clears room state, rejects predecessor frames, resubscribes, and requires publisher re-establishment.
- Restore is explicitly a downtime handoff, excludes `/run` authority from backup, and forbids concurrent usable memory authorities.
- Same-volume TLS preservation and fresh-volume reissuance are correctly separated.
- Raw evidence/reducer ownership, structured log custody, packed OCI execution, sentinel-protected cleanup, continuing-cost reporting, and profile unavailability on mandatory failure are all good closure directions.

## MATERIAL concerns

1. **The “exact existing operation names” are not the existing protocol.**

   The normative list includes `observe`, `renewLease`, `uploadArtifact`, `preflightMigration`, `applyMigration`, `activate`, `backup`, `readLogs`, and `reconcile` ([0105 § lifecycle](/private/tmp/snapback-llp0105-r2.jxlSX9/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:460)). The landed protocols instead expose:

   - `doctor | inspect` ([observation schema](/private/tmp/snapback-llp0105-r2.jxlSX9/schemas/vm-adapter.request.schema.json:3))
   - `logs | inspectAdmin` ([query schema](/private/tmp/snapback-llp0105-r2.jxlSX9/schemas/vm-adapter.query-request.schema.json:35))
   - `uploadImmutableRelease`, `compatibilityPreflight`, `createVerifiedBackup`, `activateGeneration`, and the other closed lifecycle names ([lifecycle schema](/private/tmp/snapback-llp0105-r2.jxlSX9/schemas/vm-adapter.lifecycle-request.schema.json:3))

   This directly conflicts with “no alias/private dialect.” Fly also documents Machine-scoped lease create/get/release rather than a separately named provider renewal operation, so `renewLease` needs an explicit semantic mapping. [Fly Machines API](https://fly.io/docs/machines/api/machines-resource/)

   **Resolution criterion:** retain v1 names and add only genuinely new v2 operations, or declare a complete v2 vocabulary with exact schema IDs and a v1→v2 translation table. Define `applyMigration` as admission/observation of LLP 0099’s resident executor, not an independent remote batch executor.

2. **The promised closed v2 carriers and uncertain-effect protocol remain prose-level.**

   The plan names descriptor/request/response/receipt categories but not their schema identifiers, discriminated operation variants, `HostedAdmissionV2` signing input/key binding, semantic-digest canonicalization, or durable effect transition relation ([0105](/private/tmp/snapback-llp0105-r2.jxlSX9/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:471)). A request-level `notApplied | applied | commitUncertain` result is insufficient when one operation performs multiple provider effects with different outcomes. The terminal rule when reconciliation proves neither outcome is also missing.

   **Resolution criterion:** define Rust-owned generated schema IDs, per-operation variants, domain-separated digest/signing formulas, and an intent/effect/terminal journal. Every provider effect needs its own outcome and retained result. An unresolved effect remains blocked and non-success; retry is legal only after proving `notApplied`, while `applied` returns the retained result exactly.

3. **Mutable binding and cross-Machine head transfer are not linearized.**

   `FlyTargetBindingV2` contains mutable Machine, roster, route, image, and credential facts, but has no generation, previous digest, storage location, or CAS rule ([0105](/private/tmp/snapback-llp0105-r2.jxlSX9/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:397)). LLP 0072 places the sole control head in one exact Machine’s configuration ([0072](/private/tmp/snapback-llp0105-r2.jxlSX9/llp/0072-trusted-single-tenant-control-plane.rfc.md:224)). Restore then moves from predecessor to successor without saying which Machine carries the head at each point, which leases are held, or how an app-wide route mutation is serialized by per-Machine leases ([0105](/private/tmp/snapback-llp0105-r2.jxlSX9/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:483)).

   **Resolution criterion:** provide a closed interruption table for every cutover state, naming predecessor/successor leases and versions, canonical head bearer, binding generation/digest, route state, admission state, and legal recovery after lost responses. Prove two-controller contention. If Fly cannot furnish the required app-wide serialization, invoke LLP 0072’s separate single-writer authority fallback.

4. **The online admission supervisor has no execution substrate.**

   The origin has no Fly credential, yet an external signer must re-witness the roster and deliver 60-second routed-Machine admissions every 30 seconds plus five-minute hosted-auth admissions ([0105](/private/tmp/snapback-llp0105-r2.jxlSX9/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:513)). The exact target contains only the origin/Caddy Machine, while LLP 0098 leaves online delivery placement unresolved. A CLI process cannot satisfy “hosted” availability after it exits; putting the signer in the origin would undermine external roster witnessing and credential separation.

   **Resolution criterion:** name the always-on component, deployment and restart model, signing-key custody, authenticated channel, head fencing, package path, availability posture, cost, and cleanup. Acceptance must terminate the invoking CLI, remain publicly serving beyond both renewal intervals, and prove withdrawal and recovery. Otherwise narrow the claim to an operator-attached drill.

5. **Old/new wire compatibility is asserted but not defined.**

   `OpenConnectionRequest` is closed with `deny_unknown_fields` ([server DTO](/private/tmp/snapback-llp0105-r2.jxlSX9/src/server.rs:4113)). Therefore, sending `ephemeralAuthorityProtocol` to an old server rejects the entire open, contradicting the requirement that only ephemeral features disable while durable connection features remain available. LLP 0094 explicitly requires capability proof, fallback, or a new token for new client fields ([closure rule](/private/tmp/snapback-llp0105-r2.jxlSX9/llp/0094-wire-envelope-contract.spec.md:651)).

   The proposal also changes every ephemeral carrier, including closed session DTOs and the flattened ephemeral acknowledgement exception, but does not give an exact placement map. Its clear/resubscribe/republish/currentness behavior is absent from LLP 0095’s closed action vocabulary and the Swift implementation ([LLP 0095](/private/tmp/snapback-llp0105-r2.jxlSX9/llp/0095-client-lifecycle-and-conformance.spec.md:300), [Swift state machine](/private/tmp/snapback-llp0105-r2.jxlSX9/clients/swift/SnapbackClient/Sources/SnapbackClient/StateMachine.swift:10)).

   **Resolution criterion:** specify the four-way client/server negotiation matrix, including how a new client identifies or retries against an old server without losing durable service. Enumerate every request/frame carrier and exact field placement. Amend LLPs 0094/0095, the Rust-owned corpus/action set, and every claimed JS/native/Swift arm, including authority change during drain, acknowledgement, reconnect, and republisher races.

6. **One-use spend authority has no pre-target or cleanup-safe state machine.**

   LLP 0072 consumes a grant with the external-head fence, but 0105 requires authority before remote build or initial provisioning, when no target Machine/head may exist ([0105](/private/tmp/snapback-llp0105-r2.jxlSX9/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:534)). The plan does not decide whether one grant authorizes the whole journey or one semantic effect, how it is reserved across `commitUncertain`, or why cleanup remains authorized after consumption or expiry. Egress is budgeted but has no attribution in the six-name cost vocabulary.

   **Resolution criterion:** define a durable pre-target nonce ledger and closed grant/reservation/consumption states bound to journey, plan, and semantic-effect IDs. Include remaining budget, tariff/currency provenance, explicit egress attribution, uncertain-effect reconciliation, and cleanup-only continuing authority/reserve.

7. **The current target/TLS transition is identity-ambiguous.**

   The current volume contains Caddy state while SQLite and admission remain on rootfs ([0098 evidence](/private/tmp/snapback-llp0105-r2.jxlSX9/llp/0098-hosted-edge-adapter.spec.md:770)). The plan does not distinguish retiring Snapback’s logical target ID from retiring/changing the Fly app or origin. That choice determines whether existing certificates remain applicable. It also does not identify an admissible copy mechanism, quiescence point, or key-custody path under Fly’s one-volume-per-Machine and one-Machine-per-volume model. [Fly Volumes overview](https://fly.io/docs/volumes/overview/)

   **Resolution criterion:** bind exact source/destination target, app, origin, Machine, volume, head, and sentinel identities. If app/origin remain unchanged, say only the Snapback target registration is retired; otherwise require reissuance and DNS/origin cutover. Specify Caddy quiescence, fork/remount or secure intermediary, byte/mode verification, head seeding, rollback, and cleanup receipt.

8. **A mandatory acceptance dependency described as landed is not present.**

   The plan requires an “already-landed comparator receipt” ([0105](/private/tmp/snapback-llp0105-r2.jxlSX9/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:549)), but the comparator ticket is still Open and describes the command and receipt schema as desired work ([ticket](/private/tmp/snapback-llp0105-r2.jxlSX9/issues/20260727-comparator-acceptance-kit.md:1)). No matching command or schema is present, and the implementation sequence omits it.

   **Resolution criterion:** land and name the comparator receipt first, or add its implementation as an explicit blocking phase and keep both profiles unavailable until it passes from a packed install.

## DETAIL concerns

1. **Credential separation is nominal.** Add an exact role→verb→resource matrix, fingerprint-distinctness rules, provider-scope read-back, and wrong-role negative tests. Where Fly/Tigris cannot enforce separation, label it custody separation rather than provider-enforced least privilege.

2. **Raw evidence needs custody and disposition rules.** “Request/response bytes” may contain authorization headers or provider secrets. Each evidence/log artifact needs producer, verifier, canonical redaction or encryption class, retention, `retain | delete` disposition, sentinel/version, and terminal absence evidence. Distinguish retained journey evidence from target-owned temporary prefixes that cleanup removes.

3. **Admission boundary enumeration is incomplete.** The prose says every boundary but omits ephemeral `unsubscribe`, despite it being an effectful operation in the implementation. Enumerate HTTP and socket variants explicitly and prove that an admission loss during a mixed drain cannot deliver stale ephemeral items or block unrelated durable recovery.

## Suggestions

- Put lifecycle/carrier closure, wire evolution, and cross-Machine authority transfer into compact normative matrices, rather than adding more narrative.
- Sequence implementation as: comparator dependency → lifecycle-v2 schema generation → local wire/client corpus → supervisor/control-head implementation → fixture-provider interruption corpus → packed Fly/Tigris journey.
- Reuse LLP 0099’s qualification/executor/corpus gates explicitly so migration work cannot be remotely advertised before the resident executor is qualified.
- Make the acceptance receipt identify the exact governing schema versions and binding generation, not merely artifact digests.

## Open questions

- Is the supervisor a new always-on external control service, and who operates it?
- Where does the mutable binding/head live during Machine replacement?
- Is lifecycle v2 an additive extension or a renamed replacement for v1?
- Is spend authority per journey or per semantic provider effect?
- Does the transition retain the existing Fly app/origin or create new ones?
- Is the comparator kit in this plan’s implementation scope or a prerequisite owned elsewhere?

## Readiness verdict

The intended product boundary is now coherent, but the implementation does not yet have one closed authority graph, one lifecycle vocabulary, or one compatible client transition. Resolve the MATERIAL criteria normatively; the remaining DETAIL items can be completed during schema/test implementation without prescribing low-level provider mechanics.

VERDICT: NOT READY

## Round 3 — 2026-07-27

**Reviewer family:** OpenAI Codex
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`
**Reasoning effort:** ultra
**Date:** 2026-07-27
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule
**Target SHA-256:** `60bf43edb12c99a784a48f6fbd6f3b6130316107dafcc585d3a82d38ea82b03f`
**Capsule SHA-256:** `f9d60997ef75683ce968867c6909dbf695eefe7663a24ff866310c2ff2d97c14`
**Instruction SHA-256:** `9f65e59a46c426975af9b30cb631d53b12e62d09acc7ece6d802f90dba2fab0c`
**Status:** completed

NOT READY. I found five material defects in the controlling Round-2 delta.

1. **MATERIAL / IN-DELTA — Routed-admission loss leaves authenticated serving after the single-instance fact becomes stale.**

   The supervisor checks the complete Fly roster before each 60-second admission, but expiry withdraws only ephemeral capability while authenticated work continues under the five-minute admission ([LLP 0105](/private/tmp/snapback-llp0105-r3.xPcvm7/capsule/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:660)). LLP 0098 makes serialized-authority currency a required live-health fact and says a silently started second instance defeats `globallyFenced` without failing existing admission checks ([§5](/private/tmp/snapback-llp0105-r3.xPcvm7/capsule/llp/0098-hosted-edge-adapter.spec.md:419), [§7](/private/tmp/snapback-llp0105-r3.xPcvm7/capsule/llp/0098-hosted-edge-adapter.spec.md:483)).

   Thus a stale/failed roster observation—or an observed second Machine—can leave durable authenticated traffic admitted after the profile’s load-bearing fact is no longer known.

   Resolution: make fresh exact-roster/single-authority evidence a conjunct of hosted-auth live health, withdrawing all protected HTTP/socket work on zero, multiple, ambiguous, autoscalable, or stale roster state. Add an acceptance case that introduces a second Machine while the older five-minute admission remains valid and proves no authenticated path serves.

2. **MATERIAL / IN-DELTA — The canonical supervisor has no safe storage-loss or failover protocol.**

   The supervisor’s SQLite database is canonical, while Tigris is described only as backup/mirror and expressly not another writer ([LLP 0105](/private/tmp/snapback-llp0105-r3.xPcvm7/capsule/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:646)). The plan does not define backup linearization/RPO, control-volume loss, supervisor incarnation fencing, stale-supervisor exclusion, or recovery/rotation of its Fly, admission-signing, and mTLS keys. Acceptance covers process restart and network loss, not loss or stale restoration of the canonical database.

   Restoring a lagging copy could lose an effect intent, `commitUncertain`, spend reservation, or cleanup authority. A restored supervisor and a revived predecessor could then both possess provider credentials, violating LLP 0072’s one external authority requirement ([LLP 0072](/private/tmp/snapback-llp0105-r3.xPcvm7/capsule/llp/0072-trusted-single-tenant-control-plane.rfc.md:201)).

   Resolution: define the authoritative storage/commit ordering, a provider-enforced supervisor incarnation or leader fence outside the recoverable database, key recovery/rotation, and a rule that stale recovery cannot regress any head, journal, admission floor, or spend state. Test control-volume loss, stale backup restoration, partitioned old/new supervisors, and every journal crash boundary.

3. **MATERIAL / IN-DELTA — Pre-target spend and supervisor bootstrap are circular.**

   Semantic effect IDs require `targetBindingDigest` ([LLP 0105](/private/tmp/snapback-llp0105-r3.xPcvm7/capsule/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:613)), but before the target exists the ledger must reserve spend against an exact closed set of those IDs ([same plan](/private/tmp/snapback-llp0105-r3.xPcvm7/capsule/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:745)). No stable planned-binding-to-real-binding promotion is defined, even though provisioning creates provider-assigned resources.

   There is a second cycle: the supervisor owns the first ledger and cleanup authority, yet its own compute/storage/network and cleanup are included, and neither CLI has direct Fly/Tigris authority. A per-journey supervisor cannot authorize its own creation or delete itself and then verify its absence; a shared supervisor needs a different cost and cleanup model.

   Resolution: define a closed planned binding whose digest and effect IDs survive provider-ID allocation, with exact promotion checks. Separately choose either:

   - a pre-provisioned shared supervisor with prior root authorization and explicit per-journey cost allocation; or
   - a per-journey supervisor created by a distinct bootstrap authority and deleted by an independent cleanup anchor.

4. **MATERIAL / IN-DELTA — The certificate-transfer protocol has contradictory key custody.**

   The transfer key is “held only by the supervisor,” but the successor “reads and verifies” the encrypted artifact and installs its contents ([LLP 0105](/private/tmp/snapback-llp0105-r3.xPcvm7/capsule/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:782)). The successor has no decryption key, while no supervisor-mediated decrypt/stream or recipient-wrapping protocol is specified. Extraction from the predecessor, crash persistence of the one-use key, and plaintext cleanup are also undefined.

   Resolution: select one executable protocol—such as supervisor-only decryption followed by generation-bound mTLS streaming, or a data key wrapped to a successor-only ephemeral key—and specify extraction, interruption replay, plaintext custody, key/object deletion, and stale predecessor/successor refusal tests.

5. **MATERIAL / IN-DELTA — The republisher gate omits a distinct first-party ephemeral carrier.**

   The plan enumerates JS, React, native/Expo, and Swift ([LLP 0105](/private/tmp/snapback-llp0105-r3.xPcvm7/capsule/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:734)), but `@snapback/contract` is Snapback’s richest first-party Contract/Exact path ([LLP 0012](/private/tmp/snapback-llp0105-r3.xPcvm7/capsule/llp/0012-headless-integration-contract.spec.md:44)) and owns distinct swappable ephemeral sources and publish links ([implementation](/private/tmp/snapback-llp0105-r3.xPcvm7/capsule/packages/snapback-contract/index.mjs:3103)). Its returned surface currently has no republisher lifecycle. Treating “JS” as implicitly covering this wrapper is insufficient for a closed qualification inventory.

   Resolution: enumerate every package/carrier explicitly, add Contract delegation or a structured blocking GAP, and run restart/authority-change republish tests through the actual Contract surface.

One non-blocking issue: **DETAIL / IN-DELTA** — `commitUncertain` is named terminal and terminal results are immutable, yet `reconcileEffect` may “transition” it. Specify whether reconciliation appends a second terminal record referencing the immutable uncertain record or whether uncertainty is nonterminal.

Earlier incorrect operation aliases and the “already-landed” comparator wording are **DETAIL / PRE-EXISTING** superseded residue and did not affect the verdict. The controlling v1 operation list matches the Rust enums, and the comparator is correctly reframed as a same-landing packed prerequisite.

No repository files were modified, and no prior review artifacts were consulted.

VERDICT: NOT READY

## Post-bakeoff delta loop, round 1 — 2026-07-28

**Reviewer family:** OpenAI Codex
**Provider / runtime:** Codex subagent, `gpt-5.6-sol`
**Reasoning effort:** ultra
**Date:** 2026-07-28
**Redacted:** no
**Method:** fresh subagent, instruction-restricted to the mutually blind
structurally isolated capsule
**Target SHA-256 vector:** `a33f006d3784c7a1466696a90d73e297260314e0bada023236d61482e79365cd`
**Capsule SHA-256:** `1bb93b1ff4838d8fe2eb8902d489a4170a67e2bc33ef35490168b85634e6633b`
**Instruction SHA-256:** `b0ae0014c12ad5e3df3a948e27656e2b0a0682af6901c1c2eb0c65195147ed0b`
**Status:** completed

## 1. Overall assessment

The coupled design is substantially stronger, honest about current gaps, and close to implementable. However, the new execution sections still contain circular qualification/publication prerequisites and several unclosed authority and recovery boundaries. These are plan defects, not objections to implementation work that the Plans explicitly schedule.

Most notably:

- LLP 0104 requires the candidate graph to execute publicly before the target may support the capabilities needed to install or invoke that graph.
- LLP 0105 requires public-registry cold-install receipts before the nine-package release is published, while LLP 0041 defines those receipts as requiring an already successful publication ledger.
- The legacy certificate bootstrap does not carry forward the required Caddy quiescence/resume protocol or assign an enforceable implementation for locked-memory plaintext custody.
- The public CLI command list has no closed target-registration/enrollment or operator-to-supervisor authority path.
- The migration profile still has unresolved normative choices.
- Cleanup wording conditionally exposes the standing shared supervisor and overstates the currently expired predecessor as a publicly correct fallback.

These prevent the coupled boundary from being ready for implementation as written.

I do not treat the partial Fly driver, missing packaged files, hard-false capability facts, or shallow current journey receipt as standalone defects: the execution plans are allowed to schedule that implementation. The concerns below are places where an implementer would have to invent or change normative behavior.

## 2. Strengths

- LLP 0104 explicitly limits first publication to bounded children plus `existing-owner.v1`, keeps `create-owner.v1` rejected, requires current-source generation, and forbids laundering pre-hardening last-good artifacts.
- Its session-authenticated Signal Desk flow is a meaningful improvement over the development-persona nonclaim and closes a real provenance gap.
- The direct-artifact reconstruction, exact result/cardinality contract, current-incarnation checks, provenance storage typing, and quantitative effect checks form a strong admission boundary.
- LLP 0105 honestly records the expired legacy hosted-auth chain, partial supervisor deployment, unqualified target, and false capability state.
- The standing supervisor remains the intended single writer for control heads, provider effects, spend, cleanup, and admission authority.
- The legacy TLS exception is narrowly scoped to one declared predecessor class, an exact lease, a one-use effect, an attested recipient, and a fixed command rather than arbitrary shell input.
- The hosted receipt correctly demands public-origin evidence, the target-neutral ephemeral corpus, migration, LLP 0104, restore/TLS, cost, inspection, and cleanup rather than accepting a remote-shaped local harness.
- Both documents consistently refuse stable promotion and preserve explicit GAPs until executable evidence exists.

## 3. Concerns with evidence

1. **MATERIAL — IN-DELTA: the LLP 0104 served-qualification gate is circular.**

   LLP 0104 says ordinary codegen refuses the profiles and preserves the last-good graph while both target capabilities remain unsupported (§Implemented landing evidence and §Adversarial closure evidence, lines 1235–1239 and 1310–1314). The bundled Rust target registry likewise hard-codes both profiles unsupported, and target admission rejects required capabilities absent from the positive support set (`src/manifest.rs`, lines 5360–5363 and 6299–6305).

   The new execution plan nevertheless requires current-source generation into the installed graph, a session product invocation, and the public Fly corpus before either capability enters a target support set (lines 1376–1397). LLP 0105 repeats the cycle by requiring LLP 0104 against the same served release before that target advertises the capabilities (lines 1119–1120 and 1133–1137).

   No candidate graph slot, qualification-only authority, or non-advertised served execution lane is defined. An implementation must either advertise early, bypass capability admission, or fail to collect the required evidence.

2. **MATERIAL — IN-DELTA: public cold-install precedes publication, and the nine-package promotion has no safe partial-failure state.**

   LLP 0105 says the public macOS/arm64 and Linux/x64 cold-install receipts must pass before the nine-package release is published (lines 1133–1134). LLP 0041 defines public mode as accepting only a successful publication ledger, downloading exact public-registry tarballs, and checking their ledger-bound identities (lines 14–22). Those conditions cannot both hold.

   The amendment also does not enumerate the nine package identities, exact versions/aliases, dependency pins, or the ninth package relative to LLP 0041’s existing eight-package closure. npm publication and dist-tag movement are not atomic across nine packages, yet no candidate tag, promotion order, or partial-publication stop rule preserves the prior default closure.

   The receipt’s independent source, package, binary, target-image, and supervisor-image digests also need explicit cross-links; a bag of digests does not itself prove that the served binaries are the binaries from the public runtime packages built from the named clean source.

3. **MATERIAL — IN-DELTA: the legacy certificate bootstrap lacks a complete consistency, custody, and crash-recovery protocol.**

   The preceding normative TLS section requires admission withdrawal, Caddy quiescence, and predecessor resume on every pre-head failure (lines 784–794). The new exceptional path reads Caddy state through provider exec but never specifies how Caddy is quiesced, how zero writers are proved, or how it is resumed and publicly TLS-verified after a supervisor crash (lines 1052–1069). Copying live ACME/account state can produce a self-consistent archive format with inconsistent logical contents.

   “Bounded archive” has no byte, member, per-file, decompression, or elapsed-time ceiling. “Locked process memory” and complete zeroization also have no assigned implementation mechanism. The bundled supervisor is Node and its current helper copies plaintext through ordinary `Buffer` operations while only zeroizing the data key; missing extraction code is allowed, but extending that path does not prove locked-memory/no-copy custody.

   The lost-provider-response case is listed as a fixture but has no terminal rule explaining whether the one-use effect is abandoned, reconciled, or safely retried.

4. **MATERIAL — IN-DELTA: the public command and operator-authority surface is not closed end to end.**

   The original product journey requires registering or selecting the exact target (LLP 0105 line 289). The new exhaustive-looking command list has no target registration, planned-binding promotion, target enrollment, supervisor selection, or operator authentication command (lines 1086–1093).

   It also does not state whether legacy certificate extraction is a subeffect of an existing lifecycle operation or a new closed request variant; the bundled Rust v2 lifecycle registry has no such operation. `backup` and `rollback` are presented without the plan/confirm/apply/reconcile grammar used for other effects.

   Consequently, a clean installed CLI has no specified way to bind an operator principal, standing supervisor installation, target/planned binding, spend grant, confirmation, and enrollment without ambient or repository-private state.

5. **MATERIAL — PRE-EXISTING: the migration capability still depends on unresolved normative decisions.**

   LLP 0099 requires G1–G3 before `container-vm-migration-executor.v1` appears in a manifest (lines 202–221), but still leaves the admission point, cancellation race, downtime ceiling, and qualifying pre-apply checkpoint unresolved (lines 236–253).

   LLP 0105’s earlier reconciliation assigns executor-job/checkpoint/receipt carriers, but does not choose enqueue-time versus barrier-time admission or define the initial measurable downtime ceiling. The new served gate nevertheless requires LLP 0099 execution and then advertises the capability. Those are design choices, not merely missing implementation.

6. **MATERIAL — IN-DELTA: cleanup and failure preservation have an unsafe ambiguity.**

   LLP 0105 earlier states that creating or deleting the pre-provisioned shared supervisor is never a journey effect (line 842). The new normative text says the old predecessor *and shared supervisor* are never cleanup targets “until” successor verification and reverse-window closure (lines 1127–1129), grammatically permitting both afterward.

   The reverse-transition window has no exact closing artifact or predicate. Additionally, the checkpoint establishes that the predecessor already returns `SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED` (lines 965–974), so a pre-head failure cannot honestly be described as preserving a currently “publicly correct generation” without qualifying that claim.

7. **DETAIL — IN-DELTA: the retained create-owner acceptance row conflicts with the narrowed publication corpus.**

   Section 8.2 still requires a positive create-scope fixture producing a normalized plan and effect ceiling (lines 827–829), while the new controlling section reserves and rejects `create-owner.v1` and prohibits codegen, manifests, capabilities, Guide material, or receipts from describing it as supported (lines 1360–1367). The new section only declares precedence where it narrows the “implementation sequence,” leaving the executable-acceptance row formally live.

## 4. Concrete resolution criteria

1. **Break the LLP 0104 qualification cycle.**

   Define a versioned candidate-generation state that:

   - is emitted only from current source into a separate digest-addressed slot;
   - cannot replace the active/last-good graph;
   - is executable only under a receipt-bound qualification authority at the public origin;
   - does not appear in ordinary supported capabilities or admit ordinary callers;
   - exercises the identical executor, schema, function, and image bytes that will be promoted; and
   - atomically promotes both capability facts and the candidate graph only after the complete receipt passes.

   Failure must delete or quarantine only the candidate and leave the prior graph/control head unchanged. Tests must prove ordinary clients cannot invoke or discover candidate support.

2. **Define a realizable nine-package publication state machine.**

   Enumerate all nine source names, public aliases, exact versions, tarball hashes, dependency edges, and source SHA. Distinguish immutable candidate publication from default-channel promotion:

   - pack and local-test first;
   - publish immutable exact versions under a non-default candidate tag;
   - create and verify the registry ledger;
   - run both public cold installs against those exact registry versions;
   - promote the root/default closure only after all rows pass; and
   - flip served capabilities only after package promotion succeeds.

   Internal dependencies must pin exact candidate versions so partially moved tags cannot create a mixed closure. Any failure must leave all prior default tags, target support, active graph, and control head unchanged; immutable candidate versions may remain quarantined. The receipt must prove byte equality from clean source through each runtime package into both target and supervisor images.

3. **Close the legacy TLS state machine.**

   Specify:

   - the exact allowlisted Caddy paths, archive format, maximum members, per-file and total clear/ciphertext bytes, timeout, and mode/owner rules;
   - a verified Caddy quiescence/zero-writer step before extraction;
   - an automatic crash-safe resume path with predecessor TLS health proof for every pre-head failure;
   - lease renewal and exact recipient-attestation verification;
   - either source-side encryption before provider response, or a packaged native locked-memory helper with an explicit no-JS-string/no-copy boundary and zeroization evidence;
   - terminal handling for lost response and supervisor crash; and
   - a distinct custody confirmation bound to source, recipient, paths, effect ID, and deletion disposition.

4. **Close the CLI-to-supervisor authority map.**

   Add a mechanical table mapping every public command to:

   - request schema and operation/effect kind;
   - target or planned-binding resolution;
   - operator authentication and supervisor installation fingerprint;
   - required approval, confirmation, lease, spend grant, and migration authority;
   - idempotency/reconciliation behavior; and
   - whether the operation is read-only or supervisor-mutating.

   Add an explicit target register/select/enroll path, or state precisely that `deploy plan` owns planned-binding creation and promotion. Place `legacyCertificateExtraction.v1` under one exact closed lifecycle variant. The clean-package test must construct and submit this flow without repository access or Fly/Tigris credentials in the CLI.

5. **Resolve LLP 0099 before its served row can pass.**

   A dated governing amendment must choose the admission point and cancellation semantics, define an initial downtime ceiling or closed calibration rule, and name the qualifying backup/checkpoint. The remote receipt must bind approval, admission, resident operation ID, backup boundary, interruption samples, terminal receipt, and all nine audience identities before the capability can appear.

6. **Make cleanup disposition unambiguous.**

   State unconditionally that the shared supervisor and immutable evidence prefix are never journey cleanup targets. Define a signed reverse-window-close artifact and exact predicates for withdrawing, retaining, or deleting predecessor Machine/volume/credentials. Failure receipts must report the predecessor’s actual availability and continuing cost; given the expired admission, they may claim preserved data/TLS generation but not currently correct protected serving.

7. **Reconcile create-owner acceptance.**

   Explicitly supersede the positive create-scope row for first publication. Require an existing-owner positive corpus plus create-owner rejection vectors, and move positive create-owner evaluation to its future evaluator/corpus gate.

## 5. Per-target readiness

- **LLP 0104 — NOT READY.** The profile semantics are largely implementation-ready, but the new publication section lacks a non-advertised candidate execution lane and leaves a contradictory create-owner acceptance row.
- **LLP 0105 — NOT READY.** The package/publication order is impossible under LLP 0041’s public-mode definition, and TLS bootstrap, CLI authority, migration admission, and cleanup still require normative decisions.

## 6. Set-level conclusion

The documents now describe the right evidence and mostly the right safety posture, but they do not yet form one finite executable coupled plan. An implementation following them literally must either publish before qualifying, bypass capability authority, obtain public-install evidence before registry publication, or invent sensitive transition and cleanup behavior. Both targets should remain Review with all four capabilities false until the bounded criteria above are incorporated.

I self-attest that I read both complete targets and supporting context only from the immutable capsule at `/private/tmp/snapback-super-refine-delta.c2O390`. I did not access the source worktree, repository outside the capsule, network, prior reviews, journals, Fable output, or another reviewer’s output, and I did not edit any file.

VERDICT: NOT READY
