# Hosted ephemeral-state semantic parity

**Status:** Open  
**Impact:** 5  
**Urgency:** 3  
**Ease:** 1  
**Confidence:** 4  
**Severity:** P1  
**Systems:** Ephemeral state, Hosted runtime, Realtime, Auth, Deployment, Testing  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0013, LLP 0014, LLP 0026, LLP 0053, LLP 0072, LLP 0098

Ephemeral presence is Snapback's clearest differentiator in Signal Desk, but
the capability is local-only. `ephemeralHostedAdapter` is honestly false and
LLP 0026's target-neutral conformance and hosted adapter phases remain open.
Hosted auth admission does not change the runtime's ephemeral target facts.


## Triage (2026-08-26 leftover sweep)

Still open. LLP 0111 is **Accepted** (plan text). `ephemeralHostedAdapter` is still `false` on local-dev and Cloudflare manifests. Remaining gate is the remote restart/republish corpus plus `issues/20260728-hosted-lifecycle-carrier-and-custody-gap.md`, not 0111 review.

## Design gate

Amend LLP 0026 to decide whether the sticky single-instance container/VM
profile may qualify the same process-local authority or whether the first
hosted adapter requires Redis/Durable Objects. Run `llp-super-refine` with
fresh Fable 5 and Codex gpt-5.6-sol reviewers. Cloudflare remains independently
qualified; no blanket hosted inheritance is allowed.

## Desired resolution

- Extract a target-neutral backend conformance corpus before claiming a second
  target.
- Add the chosen hosted adapter/profile and publish verified adapter identity,
  routing/stickiness, authority epoch, limits, overflow, loss/recovery, auth,
  and durable-lane facts through manifest and inspection.
- Preserve identical schema, generated client API, wire kinds, TTL/disconnect
  semantics, lossy/non-durable posture, and open native runtime.
- Define restart/epoch loss and client republish explicitly; ephemeral state
  never enters durable versioning, database backup, migration, or restore.

## Acceptance

- Two-client convergence, update/delete, TTL, socket disconnect, reconnect,
  restart/epoch loss, republish, overflow/resync, auth revocation, rate/size
  limits, and durable-lane priority pass on the real hosted profile.
- Ephemeral publish/delete/expiry never advances durable version or appears in
  backup/restore bytes.
- Remote receipts bind target, release, adapter, authority epoch, limits,
  transport, cleanup, and nonclaims.
- Capability and guide rows become positive only for the exact qualified
  profile; local and Cloudflare facts remain independent.

## Implementation checkpoint — 2026-07-28

LLP 0111 selected `single-instance-sticky-memory.v1` and completed its
three-round Fable 5/Codex super-refine. The authority-instance carrier,
must-understand negotiation, headless/React/Swift/Contract replacement and
republisher paths, and deterministic supervisor core now exist with local
corpora. A sentinel-owned shared supervisor is also live on Fly with one
non-public Machine, one encrypted volume, a private prefix-separated Tigris
store, mTLS, and distinct scoped credentials.

The supervisor's real canonical write proof advanced generation 0 to 1 in the
required order: SQLite `synchronous=FULL`, immutable Tigris mirror, immutable
anchor generation, then an `If-Match` current-anchor update. A stale
conditional write was refused by Tigris, and the restarted Machine recovered
generation 1 and the complete chain to the retained generation-0 root. The
exact evidence is in
`demos/signal-desk/hosted-supervisor-installation.v1.json`.

The hosted capability remains false. The existing `snapback-drill` target uses
the older finite pre-signed hosted-auth chain and currently refuses `/health`
with `SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED`. It has not been registered as a
safe `FlyTargetBindingV2`, moved application SQLite onto the protected volume,
or connected to online supervisor admissions. The full remote restart,
authority-change, empty-snapshot, active-publisher republish, and durable-lane
corpus therefore has not run and this ticket remains open.

The fresh target's dedicated outbound mTLS identity and supervisor admission
listener are now staged and remotely handshake-tested. The listener cannot be
used as a capability shortcut: it mints only after exact bound-roster
read-back, and the current refusal before binding is
`SNAPBACK_HOSTED_TARGET_CLIENT_CERTIFICATE_INVALID`. The legacy Machine was
not altered. A fresh successor binding plus the complete remote restart,
empty-snapshot, republish, durable-priority, and two-routed-Machine refusal
corpus are still required.

The target onboarding now also places artifact, backup, control-state, audit,
logs, and cleanup Tigris credentials in supervisor custody and projects only
those roles to the supervisor. Live storage probes passed data-role
own-prefix reads, wrong-role denials (including cleanup), non-writer denials,
and cleanup deletion. Tigris cannot
policy-constrain `ListBucket` by prefix, so that cleanup inventory limitation
is explicit in the receipt and remains supervisor-only; it does not expand the
application Machine's outbound mTLS-only custody or make the hosted ephemeral
claim true.

**Signed target-admission progress (2026-07-28):** the supervisor and target
now implement the full dual-signed online envelope locally. `HostedAdmissionV2`
binds the exact target binding/control head/supervisor incarnation/provider
roster/routed Machine/replay and boot generations/expiry; the target rejects
missing, tampered, stale, and replayed authority. Negotiated connection
lineages bind the opaque `eai1.` authority digest, require it on HTTP and
WebSocket requests, and stamp final ephemeral responses and frames. Exact Fly
roster tests cover roster, image, volume, region, route, autostop, and
autostart drift, and the packed renewer preserves and verifies the complete
envelope. These are local code/schema proofs only: the live supervisor image
has not yet been rebuilt from this source and the remote successor,
restart/republish, durable-priority, and destructive corpora remain mandatory.
The ticket remains open and the capability remains false.

**Operator/package closure progress (2026-07-28):** the public CLI tarball now
contains the hosted command registry, Fly driver, and exact v2
binding/control-head/lifecycle schemas; its lifecycle verbs refuse
structurally with `notApplied` until a standing-supervisor executor exists.
The supervisor tarball contains the device-signed, sequenced operator
authority and bounded release-upload core, with retained exact replay and
revocation negatives. Neither module is wired to the live external authority
store or Fly provider executor yet, so this creates no hosted-ephemeral or
hosted-lifecycle claim and does not satisfy the remote corpus.

**Durable operator-transaction progress (2026-07-28):** operator request,
canonical response, sequence, and replay state now enter the standing
supervisor database in one generation through its existing single-writer
commit boundary. The redacted outer journal advances the replay floor without
copying response payloads, exact replay advances neither generation nor floor,
and the complete retained bytes survive the mirror/anchor recovery path.
Missing offline-provisioned operator authority fails closed instead of
inventing a root. This remains a local package proof: no operator listener,
mTLS/operator-certificate binding, supervisor-response intermediate, provider
executor, or live installation update was added, so the capability remains
false and the remote corpus remains required.

**Async provider-transaction progress (2026-07-28):** the retained operator
boundary now has an explicit asynchronous execution path for bounded provider
reads and effects. Authorization completes before the provider promise starts;
a rejected promise advances neither supervisor generation, request journal,
device sequence, nor replay floor; and an awaited canonical response commits
before sequence advancement and exact-replays after mirror/anchor recovery.
The synchronous entry point rejects Promise-returning executors, and a
canonical `null` response now exact-replays instead of being mistaken for a
cache miss. This is still prerequisite code only: it adds no provider
operation, public listener, response signer, root provisioning, live update,
or hosted capability claim.

**Lifecycle carrier correction (2026-07-28):** the generic lifecycle v2
carrier was proven insufficient for the operation-specific desired-state,
receipt, recovery, cutover, and opaque-lease facts required by LLP 0111. All
seventeen operations therefore refuse at
`SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE` before credential resolution or
Fly/Tigris work. This is stronger than the earlier `notApplied until executor`
checkpoint: no executor may run until the separately reviewed
carrier-and-custody gap is closed. The hosted ephemeral capability remains
false, and no remote restart/republish/durable-priority row is credited.

## Triage freshness note (2026-08-01 sweep)

Still valid. The 'amend LLP 0026' design gate is superseded by this
ticket's own 2026-07-28 checkpoint: LLP 0111 selected
single-instance-sticky-memory.v1 — the gate is now LLP 0111's Review
status plus the carrier gap. Both capability manifests still declare
ephemeralHostedAdapter:false (schemas/capability.manifest.local-dev-
sqlite-ibex.json:130; targets/cloudflare/generated/...cloudflare-do-sqlite-
v8.json:37, which also has ephemeralRealtime/WebSocketPublish false).
Note: the CF arm lives in top-level targets/cloudflare/, not src/cloudflare.
A hosted single-instance authority claim also depends on
issues/20260730-0098-single-instance-enforcement.md.
