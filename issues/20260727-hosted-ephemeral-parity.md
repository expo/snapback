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

LLP 0105 selected `single-instance-sticky-memory.v1` and completed its
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
`demos/backend-bakeoff/hosted-supervisor-installation.v1.json`.

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
