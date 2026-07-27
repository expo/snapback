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
