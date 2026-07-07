# LLP 0043: Offline replay and retention

**Type:** RFC
**Status:** Draft
**Systems:** Sync, Storage, Client integration, Auth, API, Realtime, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-07-07 (cross-family review revisions, ratified by Charlie — see
`reviews/0043-offline-replay-retention.claude.md`: claim language aligned with
LLP 0012's parity rule, client-side replay restored per 0008, DK-9 cited
instead of re-enumerated, suppression/conflict machinery restated; initial
same day)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0008, LLP 0010, LLP 0011, LLP 0012, LLP 0034, LLP 0038, LLP 0039

## Summary

This RFC defines the first offline slice for Snapback. It narrows the broad
local-first design in [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)
into two product milestones, plus a named third that stays out of scope:

1. retained authorized query results while offline — the client-side
   realization of LLP 0012's **offline-retained** query class;
2. queued mutation replay when the client reconnects;
3. (later, explicitly out of scope here, mirroring 0008's own pin)
   delta-resume with pending offline mutations.

A note on claims, because LLP 0012 pins the rule: **no local handler execution
means no local-first/parity claim**, and this slice's non-goals exclude local
handler execution. Milestone 1 licenses "your data is readable offline";
milestone 2 licenses "offline edits that replay safely." Neither licenses
"local-first" in the parity sense, and the README's present-tense local-first
language should be softened to match whichever milestone has actually landed —
coordinated with 0012's labeling rules, not around them.

Terminology: "retention" in this document means the **client's** retained
store. LLP 0008 §Retention and Resume is about the *server's* change journal;
this RFC's reconnect path consumes that machinery but does not redefine it.

## Motivation

Snapback's current realtime model is online-class: clients subscribe, receive an
authoritative snapshot, and get live updates while connected. That is valuable
but not local-first.

Offline support also tests auth, sync, conflict, and client-store boundaries in
one place. It is the feature that forces Snapback to prove that optimistic
client behavior and authoritative server replay agree.

## Design

### Client store: DK-9, not a new decision

The store contract is already decided — 0008 DK-9 (ratified 2026-07-02) pins a
store-agnostic client-store interface with **SQLite as the reference
implementation** (expo-sqlite / wa-sqlite); web targets may instead sit on
IndexedDB/OPFS; tests use an in-memory deterministic store. This RFC binds to
DK-9's stored contract rather than re-enumerating it:

- retained authorized result rows per query identity and args;
- opaque `(stream, version)` cursors (LLP 0007's shape — never bare version
  numbers);
- the **authorization epochs** under which results were authorized
  ([LLP 0039](./0039-auth-vertical-slice.rfc.md)), alongside the auth context;
- target profile/capability facts and the schema/artifact hash the results
  were generated against;
- the pending-mutation queue, ordered by a client-local monotonic sequence
  number (0008: ordering uses the sequence, **never a wall clock**);
- diagnostics and stale/resync flags.

### Milestone 1: retained reads

When offline, a subscribed query may return retained rows immediately if:

- the query shape is retainable;
- the result was authorized for the current auth context, and its stored
  authorization epoch is not known-stale;
- the stored `(stream, version)` cursor is valid for the target profile;
- the capability manifest allows retention for that query.

The UI must know the result is retained/stale. Reconnect always asks the server
for a fresh authoritative snapshot or resume path before clearing stale state.
The resume path consumes the retention-floor primitives that already landed on
the server (`resume_requires_resnapshot(from_version)`, the monotonic pruned
watermark) — this RFC is their first real client consumer. Two invalidation
cases are first-class: a schema/artifact change and an `app.reset` that
happened while the client was offline both force resnapshot; retained state
from before either event is never presented as current.

### Milestone 2: queued mutation replay

When offline, a client may enqueue mutation calls with:

- function id and args;
- the captured replay environment — 0008 pins the wire to exactly
  `{generatedIds, now}`;
- the optimistic read baseline;
- auth context fingerprint;
- the client-local sequence number;
- local optimistic patch metadata. Absent local handler execution, the
  optimistic overlay is computed from what the client *can* know: host-plan
  write plans and mutation args (0012 allows optimistic UI from mutation
  args). Overlay application is all-or-nothing per changeset — 0008 pins
  multi-row atomicity after Valet's half-applied-kanban bug.

On reconnect the client follows 0008 §Mutation Replay, which is load-bearing
and client-driven: the client first completes a full resync and waits for the
local replica to reach current, **then** replays each pending mutation in
sequence order against fresh server state under current authority. (Replaying
against an incompletely synced state produces wrong results — 0008's words.)
Two companion rules from 0008 apply verbatim:

- **doc-id suppression:** while a document has an unconfirmed local mutation,
  incoming server deltas for it are dropped even at higher versions; the
  version-cursor dedup alone is not sufficient — a correct client needs both;
- **drop-and-mark-failed:** a mutation whose handler throws on replay is
  dropped and marked failed, never retried.

Success returns authoritative rows and versions. Conflict or denial returns
0008's **typed conflict payload** (LWW-per-field, delete-wins v1 defaults) —
not a generic error — and the client rolls back or rebases the local
optimistic overlay.

### Conflict posture

The first conflict model is server-authoritative replay. Snapback does not need
CRDT merge in this slice. If a queued mutation conflicts, the client should show
the failed mutation and authoritative state, not pretend convergence happened.

### Auth posture

Retained data is scoped to the auth context that received it. A user switch
wipes or quarantines prior retained data — including the pending-mutation
queue — before the new user sees the app (0039/0011's wipe rule). Queued
mutations must not replay under a different user silently; the auth context
fingerprint is checked before replay and a mismatch surfaces
`SNAPBACK_AUTH_STALE_RESULT`-class diagnostics rather than replaying.

## Non-goals

- Full local handler execution parity (and therefore any "local-first" parity
  claim — see Summary).
- CRDT or rich-text merge.
- Peer-to-peer sync.
- Offline assets.
- Delta-resume with pending offline mutations (milestone 3, later — 0008 pins
  it as an explicit separate milestone).
- Retaining unauthorized or admin-bypass results.

## Acceptance

- A todo app shows previously authorized rows while offline with a stale marker.
- A queued offline mutation replays successfully after reconnect and converges to
  the authoritative server result.
- Replay is observably ordered by the client sequence number, and replay does
  not begin until resync-to-current completes.
- While a document has an unconfirmed local mutation, an incoming
  higher-version server delta does not flicker the optimistic state
  (suppression works).
- A conflicting queued mutation fails with the typed conflict payload, is
  dropped (not retried), leaves no ghost duplicate row, and remains visible as
  failed client state.
- A multi-row optimistic changeset applies all-or-nothing locally.
- A client reconnecting from beyond the server's retention floor is forced to
  resnapshot (`resume_requires_resnapshot` exercised end to end).
- A user switch prevents the new user from seeing the prior user's retained
  rows or replaying the prior user's queued mutations.
- A non-retainable query reports a capability diagnostic rather than silently
  acting local-first.

## Open Questions

- Is "retainable" exactly the syncable-live subset 0008 already pins, or a
  strict subset of it in milestone 1? (The broad "which shapes?" question is
  answered by 0008; only this refinement is open.)
- Should retained rows be encrypted at rest on mobile by default?
- How should generated clients expose conflict UI facts without dictating UI?

## Status

Draft. This RFC is the gap-closing slice for the offline/local-first claim.
